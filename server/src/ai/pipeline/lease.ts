// The lease analysis pipeline, S1 to S9 (spec §7.3). Gemma interprets; code
// verifies. The route and SSE stream are #16.
//
//   analyzeLease({ leaseId, text, locale, term? }, { gemma, pack, triage? })
//     S1 triage.check(lease)                  -> stop with the handoff if it escalates
//     S2 gemma `extraction`, per chunk        -> documentType, clause starts, key terms
//        documentType not residential_lease   -> stop: not a lease
//     S3 code: cut clauses at their starts; key terms only if quote and value are found
//     S4 code: every deterministic rule in force, on the verified key terms
//     S5 gemma `mapping`, token-packed calls  -> per clause: ruleIds, assessment, leaseQuote
//     S6 code: clause exists, quote in clause, rule exists and in force, not decided by S4
//     S7 gemma `verification` (31B), S5 violations only -> its own reading of clause against statute
//        code: severity table (severity.ts); findings sorted and numbered
//     S8 gemma `explanation`, all findings  -> title, explanation; grade check, one regeneration
//     S9 gemma `translation` if locale is not English -> title, explanation, action; quotes untouched
//
// Budget: S1 to S5 make at most ANALYSIS_CALLS generate() calls for a
// 12-page lease, and S7 to S9 usually four more (verifier, explanation, its
// regeneration, translation), MAX_CALLS in all. No request is over
// MAX_REQUEST_TOKENS, so each one fits in a minute of Gemma's 16K input
// tokens (docs/ai-pipeline.md, gap 3); S7 runs on 31B's own quota. Requests
// queue in the client's rate limiter, which reports each wait as a
// `waiting` event.

import { z } from 'zod';
import { createLogger, type Logger } from '../../log.js';
import { resolveRules, type LeaseTerm, type ResolvedRule } from '../../rules/resolve.js';
import type { IsoDate, RulePack } from '../../rules/types.js';
import { DOCUMENT_RULE, documentParts, type TextDocument } from '../documents.js';
import { estimateInputTokens, JSON_RULE, type GemmaClient, type GemmaEvent, type GenerateResult } from '../gemma.js';
import { mappingInstruction, mappingTask, SEGMENT_INSTRUCTION, segmentTask } from '../prompts/lease.js';
import { mappingSchema, SegmentationSchema, type DocumentType, type Mapping } from '../schemas/lease.js';
import type { Triage, TriageCategory, TriageDecision } from '../triage/index.js';
import { assessInjection, notALease, withInjectionFinding, type Injection } from './adversarial.js';
import { clampOutput, MAX_OUTPUT_TOKENS, MAX_REQUEST_TOKENS } from './budget.js';
import { runAbsenceChecks, runDeterministicChecks } from './checks.js';
import { explainFindings } from './explain.js';
import { draftFindings, rankFindings } from './findings.js';
import type { ReadingLevel } from './readability.js';
import { resolveClauses, resolveKeyTerms } from './resolve.js';
import { isEnglish, translateFindings } from './translate.js';
import type { CheckResultForLease, Clause, Drop, Finding, KeyTerm, PipelineUsage, TermUsed, VerifiedMapping } from './types.js';
import { runVerifier, type StageCall } from './verifier.js';
import { verifyMappings } from './verify.js';

export { detectInjection, type Injection } from './adversarial.js';
export { MAX_REQUEST_TOKENS };
// S1 to S5.
export const ANALYSIS_CALLS = 8;
// Every stage.
export const MAX_CALLS = 12;
// Historical batch size used by the golden excerpt benchmark.
export const CLAUSES_PER_BATCH = 10;
// About 10K tokens of lease per S2 call: a 12-page lease is one or two calls.
export const SEGMENT_CHUNK_CHARS = 40_000;
// Output caps (budget.ts). Measured on 26B (2026-10-25): S2 writes about 1
// token per 4.5 characters of lease (1,700 for the 7,837-character synthetic
// lease), and a 12-page lease's 25-clause mapping batches ran past 4,096
// tokens, thinking included.

// Twice the measured rate, for clause-dense pages.
export function segmentOutputCap(chunkChars: number): number {
  return clampOutput(chunkChars / 2);
}

const MAPPING_TOKENS_PER_CLAUSE = 400;

export function mappingOutputCap(clauses: number): number {
  return clampOutput(clauses * MAPPING_TOKENS_PER_CLAUSE);
}

export interface LeaseInput {
  leaseId: string;
  // The redacted text the device sent.
  text: string;
  locale: string;
  // The user's setting (spec §6.1 users.readingLevel): grade 7, or grade 5 for `simpler`.
  readingLevel?: ReadingLevel;
  // The rental's dates, used when the lease does not state its own.
  term?: LeaseTerm;
  // The day of the analysis; defaults to today (UTC).
  today?: IsoDate;
}

export type LeaseEvent =
  | { type: 'stage'; stage: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9'; label: string; progress: number }
  | { type: 'keyterms'; keyTerms: KeyTerm[] }
  // One per finding, in display order, once S8 (and S9) are done.
  | { type: 'finding'; finding: Finding }
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
  // `by: 'triage'` is S1. `by: 'document_type'` is S2 calling it a court or
  // eviction paper that S1 did not catch; `triage` is then S1's decision
  // (not escalated), or null when S1 was skipped.
  | { status: 'escalated'; by: 'triage' | 'document_type'; category: TriageCategory; triage: TriageDecision | null; usage: PipelineUsage }
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
      findings: Finding[];
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

// Includes the document rule and JSON schema that the client adds in json mode.
// Reserving the schema is also conservative when mapping uses schema mode.
export function mappingOverheadTokens(instruction: string, schema: z.ZodType): number {
  const system = [DOCUMENT_RULE, instruction, `${JSON_RULE}\n${JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw' }))}`].join('\n\n');
  return estimateInputTokens(system, []);
}

// Fill each request in lease order until its input or output allowance is full.
// A clause larger than the input room goes alone, never dropped or cut in half.
export function planBatches(clauses: readonly Clause[], overheadTokens: number): Clause[][] {
  const batches: Clause[][] = [];
  let batch: Clause[] = [];
  let used = overheadTokens + Math.ceil(mappingTask([]).length / 4);
  const base = used;
  for (const clause of clauses) {
    // Include escaped document tags and the id repeated in mappingTask.
    const cost = estimateInputTokens('', documentParts([{ id: clause.id, text: clause.verbatim }], '')) + Math.ceil((clause.id.length + 2) / 4);
    const outputFits = (batch.length + 1) * MAPPING_TOKENS_PER_CLAUSE <= MAX_OUTPUT_TOKENS;
    if (batch.length > 0 && (used + cost > MAX_REQUEST_TOKENS || !outputFits)) {
      batches.push(batch);
      batch = [];
      used = base;
    }
    batch.push(clause);
    used += cost;
  }
  if (batch.length > 0) batches.push(batch);
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
            findings: analysis.findings.length,
            unenforceable: analysis.findings.filter((f) => f.severity === 'unenforceable').length,
            ask: analysis.findings.filter((f) => f.severity === 'ask').length,
            info: analysis.findings.filter((f) => f.severity === 'info').length,
            unverified: analysis.findings.filter((f) => f.verifier?.verdict === 'unverified').length,
            drops: analysis.drops.length,
            termSource: analysis.term.source,
          }
        : {}),
    });
    return analysis;
  };

  // S1. Triage spends one call of the budget when it asks the model.
  let s1: TriageDecision | null = null;
  if (deps.triage) {
    stage('S1', 'Checking for urgent problems', 0.05);
    const decision = await deps.triage.check({ source: 'lease', text: input.text, locale: input.locale }, { ...(signal ? { signal } : {}), log });
    if (decision.model.status !== 'off') usage.calls++;
    s1 = decision;
    if (decision.escalate) return done({ status: 'escalated', by: 'triage', category: decision.category, triage: decision, usage });
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
  // Recall over precision (spec §7.9): a court paper S1 missed still gets the handoff.
  if (documentType === 'court_or_eviction_notice') return done({ status: 'escalated', by: 'document_type', category: 'eviction_or_court', triage: s1, usage });
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
  injection = withInjectionFinding(injection, clauses, input.locale);
  const term = chooseTerm(keyTerms, input, drops);
  const resolved = resolveRules(pack.rules, term);
  const inForce = new Map<string, ResolvedRule>(resolved.map((r) => [r.rule.id, r]));

  // S4.
  stage('S4', 'Checking amounts and notice periods', 0.45);
  const checks = runDeterministicChecks(resolved, keyTerms);
  const absences = runAbsenceChecks(resolved, input.text);

  // S5 and S6. Every rule in force goes in the prompt; S4 still overrides
  // the model on the rules it could decide.
  stage('S5', 'Comparing clauses with Virginia law', 0.55);
  const rules = resolved.map((r) => r.rule);
  const mappings: VerifiedMapping[] = [];
  if (rules.length > 0 && clauses.length > 0) {
    const schema = mappingSchema(rules.map((r) => r.id) as [string, ...string[]]);
    const instruction = mappingInstruction(rules);
    const batches = planBatches(clauses, mappingOverheadTokens(instruction, schema));
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
          {
            clauses: new Map(batch.map((c) => [c.id, c])),
            pack,
            inForce,
            checks,
            absent: absences.map((a) => a.ruleId),
            model: result.model,
            fallback: result.fallback,
          },
          drops,
        ),
      );
    }
  }

  // S7, then the severity table.
  stage('S7', 'Getting a second opinion on legal findings', 0.8);
  const call: StageCall = { gemma, options: common, track };
  const drafts = draftFindings(pack, checks, absences, mappings, keyTerms);
  const verdicts = await runVerifier(drafts, new Map(clauses.map((c) => [c.id, c])), call, drops);
  const ranked = rankFindings(drafts, verdicts);

  // S8 and S9.
  stage('S8', 'Writing it in plain language', 0.88);
  let findings = await explainFindings(ranked, input.readingLevel ?? 'standard', call, drops);
  if (!isEnglish(input.locale)) {
    stage('S9', 'Translating', 0.95);
    findings = await translateFindings(findings, input.locale, call, drops);
  }
  for (const finding of findings) onEvent?.({ type: 'finding', finding });

  return done({
    status: 'analyzed',
    documentType,
    jurisdiction: pack.jurisdiction,
    term,
    clauses,
    keyTerms,
    checks,
    mappings,
    findings,
    injection,
    drops,
    usage,
  });
}
