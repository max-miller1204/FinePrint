// The lease analysis pipeline, S1 to S6 (spec §7.3). Gemma interprets; code
// verifies. S7 to S9 (verifier, severity, explanation, translation) are #15;
// the route and SSE stream are #16.
//
//   analyzeLease({ leaseId, text, locale, term? }, { gemma, pack, triage? })
//     S1 triage.check(lease)                  -> stop with the handoff if it escalates
//     S2 gemma `extraction`, per chunk        -> documentType, clause starts, key terms
//        documentType not residential_lease   -> stop: not a lease
//     S3 code: cut clauses at their starts; key terms only if quote and value are found
//     S4 code: every deterministic rule in force, on the verified key terms
//     S5 gemma `mapping`, ~10 clauses a call  -> per clause: ruleIds, assessment, leaseQuote
//     S6 code: clause exists, quote in clause, rule exists and in force, not decided by S4
//
// Budget: at most MAX_CALLS generate() calls for a 12-page lease, and no
// request over MAX_REQUEST_TOKENS, so each one fits in a minute of Gemma's
// 16K input tokens (docs/ai-pipeline.md, gap 3). Requests queue in the
// client's rate limiter, which reports each wait as a `waiting` event.

import { createLogger, type Logger } from '../../log.js';
import { resolveRules, type LeaseTerm, type ResolvedRule } from '../../rules/resolve.js';
import type { IsoDate, RulePack } from '../../rules/types.js';
import type { TextDocument } from '../documents.js';
import type { GemmaClient, GemmaEvent, GenerateResult } from '../gemma.js';
import { mappingInstruction, mappingTask, SEGMENT_INSTRUCTION, segmentTask } from '../prompts/lease.js';
import { mappingSchema, SegmentationSchema, type DocumentType, type Mapping } from '../schemas/lease.js';
import type { Triage, TriageDecision } from '../triage/index.js';
import { assessInjection, notALease, withInjectionFinding, type Injection } from './adversarial.js';
import { runDeterministicChecks } from './checks.js';
import { resolveClauses, resolveKeyTerms } from './resolve.js';
import type { CheckResultForLease, Clause, Drop, KeyTerm, PipelineUsage, TermUsed, VerifiedMapping } from './types.js';
import { verifyMappings } from './verify.js';

export { detectInjection, type Injection } from './adversarial.js';

export const MAX_CALLS = 8;
// Estimated input tokens (gemma.ts, 4 characters a token) per request.
export const MAX_REQUEST_TOKENS = 12_000;
// Spec §7.3: about 10 clauses per mapping call.
export const CLAUSES_PER_BATCH = 10;
// About 10K tokens of lease per S2 call: a 12-page lease is one or two calls.
export const SEGMENT_CHUNK_CHARS = 40_000;
// Output caps (gemma.ts, maxOutputTokens), sized to the work so a looping
// answer is cut off and retried instead of running for minutes, while a long
// lease still fits. Measured on 26B (2026-10-25): S2 writes about 1 token per
// 4.5 characters of lease (1,700 for the 7,837-character synthetic lease), and
// a 12-page lease's 25-clause mapping batches ran past 4,096 tokens, thinking
// included.
const MIN_OUTPUT_TOKENS = 4_096;
const MAX_OUTPUT_TOKENS = 16_384;
const clampOutput = (tokens: number) => Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.ceil(tokens)));

// Twice the measured rate, for clause-dense pages.
export function segmentOutputCap(chunkChars: number): number {
  return clampOutput(chunkChars / 2);
}

export function mappingOutputCap(clauses: number): number {
  return clampOutput(clauses * 400);
}

export interface LeaseInput {
  leaseId: string;
  // The redacted text the device sent.
  text: string;
  locale: string;
  // The rental's dates, used when the lease does not state its own.
  term?: LeaseTerm;
  // The day of the analysis; defaults to today (UTC).
  today?: IsoDate;
}

export type LeaseEvent =
  | { type: 'stage'; stage: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'; label: string; progress: number }
  | { type: 'keyterms'; keyTerms: KeyTerm[] }
  | { type: 'model'; event: GemmaEvent };

export interface LeaseDeps {
  gemma: GemmaClient;
  pack: RulePack;
  // S1. Null skips it (a caller that already ran POST /v1/triage).
  triage?: Triage | null;
  log?: Logger;
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
  onEvent?: (event: LeaseEvent) => void;
}

export type LeaseAnalysis =
  | { status: 'escalated'; triage: TriageDecision; usage: PipelineUsage }
  | { status: 'not_a_lease'; documentType: DocumentType; message: string; injection: Injection; usage: PipelineUsage }
  | {
      status: 'analyzed';
      documentType: 'residential_lease';
      jurisdiction: string;
      term: TermUsed;
      clauses: Clause[];
      keyTerms: KeyTerm[];
      checks: CheckResultForLease[];
      mappings: VerifiedMapping[];
      injection: Injection;
      drops: Drop[];
      usage: PipelineUsage;
    };

// Cuts text into chunks of at most `max` characters, at a blank line when
// there is one in the second half of the chunk, else at a line break.
export function chunkText(text: string, max: number): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  let start = 0;
  while (text.length - start > max) {
    const window = text.slice(start, start + max);
    const half = Math.floor(max / 2);
    let cut = window.lastIndexOf('\n\n');
    if (cut < half) cut = window.lastIndexOf('\n');
    if (cut < half) cut = max;
    chunks.push({ start, end: start + cut });
    start += cut;
  }
  chunks.push({ start, end: text.length });
  return chunks;
}

// Splits clauses into mapping batches: about CLAUSES_PER_BATCH each, fewer
// calls when the budget is short, and never over the token cap.
export function planBatches(clauses: readonly Clause[], budget: number, overheadTokens: number): Clause[][] {
  if (clauses.length === 0) return [];
  const tokens = (c: Clause) => Math.ceil(c.verbatim.length / 4) + 20;
  const room = Math.max(1_000, MAX_REQUEST_TOKENS - overheadTokens);
  const byCount = Math.ceil(clauses.length / CLAUSES_PER_BATCH);
  const byTokens = Math.ceil(clauses.reduce((sum, c) => sum + tokens(c), 0) / room);
  const target = Math.max(byTokens, Math.min(byCount, Math.max(1, budget)));
  const perBatch = Math.ceil(clauses.length / target);

  const batches: Clause[][] = [];
  let batch: Clause[] = [];
  let used = 0;
  for (const clause of clauses) {
    const t = tokens(clause);
    if (batch.length > 0 && (batch.length >= perBatch || used + t > room)) {
      batches.push(batch);
      batch = [];
      used = 0;
    }
    batch.push(clause);
    used += t;
  }
  batches.push(batch);
  return batches;
}

function chooseTerm(keyTerms: readonly KeyTerm[], input: LeaseInput, drops: Drop[]): TermUsed {
  const start = keyTerms.find((t) => t.name === 'leaseStart')?.date ?? null;
  let end = keyTerms.find((t) => t.name === 'leaseEnd')?.date ?? null;
  if (start && end && end < start) {
    drops.push({ stage: 'S3', reason: 'lease_end_before_start', ref: 'leaseEnd' });
    end = null;
  }
  if (start) return { start, end, source: 'lease' };
  if (input.term) return { ...input.term, source: 'input' };
  return { start: input.today ?? new Date().toISOString().slice(0, 10), end: null, source: 'assumed' };
}

export async function analyzeLease(input: LeaseInput, deps: LeaseDeps, { signal, onEvent }: AnalyzeOptions = {}): Promise<LeaseAnalysis> {
  const log = deps.log ?? createLogger(null);
  const { gemma, pack } = deps;
  const usage: PipelineUsage = { calls: 0, promptTokens: 0, outputTokens: 0, models: [], fallback: false };
  const track = <T>(result: GenerateResult<T>) => {
    usage.calls++;
    usage.promptTokens += result.promptTokens;
    usage.outputTokens += result.outputTokens;
    if (!usage.models.includes(result.model)) usage.models.push(result.model);
    usage.fallback ||= result.fallback;
    return result;
  };
  const stage = (s: Extract<LeaseEvent, { type: 'stage' }>['stage'], label: string, progress: number) =>
    onEvent?.({ type: 'stage', stage: s, label, progress });
  const modelEvents = (event: GemmaEvent) => onEvent?.({ type: 'model', event });
  const common = { ...(signal ? { signal } : {}), onEvent: modelEvents, log };
  const done = (analysis: LeaseAnalysis) => {
    log.info('lease pipeline', {
      leaseId: input.leaseId,
      status: analysis.status,
      textChars: input.text.length,
      calls: usage.calls,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      ...(analysis.status === 'analyzed'
        ? {
            clauses: analysis.clauses.length,
            keyTerms: analysis.keyTerms.length,
            violations: analysis.checks.filter((c) => c.outcome === 'violates').length,
            mappings: analysis.mappings.length,
            drops: analysis.drops.length,
            termSource: analysis.term.source,
          }
        : {}),
    });
    return analysis;
  };

  // S1. Triage spends one call of the budget when it asks the model.
  if (deps.triage) {
    stage('S1', 'Checking for urgent problems', 0.05);
    const decision = await deps.triage.check({ source: 'lease', text: input.text, locale: input.locale }, { ...(signal ? { signal } : {}), log });
    if (decision.model.status !== 'off') usage.calls++;
    if (decision.escalate) return done({ status: 'escalated', triage: decision, usage });
  }

  // S2.
  stage('S2', 'Reading your lease', 0.2);
  const chunks = chunkText(input.text, SEGMENT_CHUNK_CHARS);
  const segments = await Promise.all(
    chunks.map(async ({ start, end }, i) => {
      const doc: TextDocument = { id: chunks.length === 1 ? input.leaseId : `${input.leaseId}.part${i + 1}`, text: input.text.slice(start, end) };
      const result = track(
        await gemma.generate('extraction', SegmentationSchema, [doc], {
          task: segmentTask(i + 1, chunks.length),
          instruction: SEGMENT_INSTRUCTION,
          maxOutputTokens: segmentOutputCap(end - start),
          ...common,
        }),
      );
      return result.data;
    }),
  );
  let injection = assessInjection(input.text, segments.some((s) => s.aiInstructions));
  // The first part says what the document is; later parts may be addenda.
  const documentType = segments[0]!.documentType;
  if (documentType !== 'residential_lease') return done({ status: 'not_a_lease', ...notALease(documentType), injection, usage });

  // S3.
  stage('S3', 'Checking quotes against your lease', 0.35);
  const drops: Drop[] = [];
  const clauses = resolveClauses(
    input.text,
    segments.flatMap((s, i) => s.clauses.map((c) => ({ ...c, from: chunks[i]!.start }))),
    drops,
  );
  const keyTerms = resolveKeyTerms(
    input.text,
    clauses,
    segments.flatMap((s) => s.keyTerms),
    drops,
  );
  onEvent?.({ type: 'keyterms', keyTerms });
  injection = withInjectionFinding(injection, clauses);
  const term = chooseTerm(keyTerms, input, drops);
  const resolved = resolveRules(pack.rules, term);
  const inForce = new Map<string, ResolvedRule>(resolved.map((r) => [r.rule.id, r]));

  // S4.
  stage('S4', 'Checking amounts and notice periods', 0.45);
  const checks = runDeterministicChecks(resolved, keyTerms);

  // S5 and S6. Every rule in force goes in the prompt; S4 still overrides
  // the model on the rules it could decide.
  stage('S5', 'Comparing clauses with Virginia law', 0.55);
  const rules = resolved.map((r) => r.rule);
  const mappings: VerifiedMapping[] = [];
  if (rules.length > 0 && clauses.length > 0) {
    const schema = mappingSchema(rules.map((r) => r.id) as [string, ...string[]]);
    const instruction = mappingInstruction(rules);
    const batches = planBatches(clauses, MAX_CALLS - usage.calls, Math.ceil((instruction.length + 2_000) / 4));
    const answers = await Promise.all(
      batches.map(async (batch) => {
        const docs: TextDocument[] = batch.map((c) => ({ id: c.id, text: c.verbatim }));
        const result = track(
          await gemma.generate('mapping', schema, docs, {
            task: mappingTask(batch.map((c) => c.id)),
            instruction,
            maxOutputTokens: mappingOutputCap(batch.length),
            ...common,
          }),
        );
        return { batch, result: result as GenerateResult<{ mappings: Mapping[] }> };
      }),
    );
    stage('S6', 'Checking every citation', 0.75);
    for (const { batch, result } of answers) {
      mappings.push(
        ...verifyMappings(
          result.data.mappings,
          { clauses: new Map(batch.map((c) => [c.id, c])), pack, inForce, checks, model: result.model, fallback: result.fallback },
          drops,
        ),
      );
    }
  }

  return done({
    status: 'analyzed',
    documentType,
    jurisdiction: pack.jurisdiction,
    term,
    clauses,
    keyTerms,
    checks,
    mappings,
    injection,
    drops,
    usage,
  });
}
