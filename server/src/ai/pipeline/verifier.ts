// S7 (spec §7.3): the independent legal verifier. `gemma-4-31b-it` sees each
// clause S5 says violates a rule, and the exact words of that rule's statute,
// and nothing else: no rule summary, no S5 assessment or reasoning, no other
// clause. It gives its own reading; code turns that into agree (it also found
// a violation), disagree, or unclear.
//
// When no model answers (31B's transient 5xx, docs/ai-pipeline.md gap 5),
// the findings are `unverified` and the analysis goes on: the severity table
// then gives them `ask`, never `unenforceable`.

import type { Logger } from '../../log.js';
import type { TextDocument } from '../documents.js';
import { GemmaOutputError, GemmaRequestError, GemmaUnavailableError, type GemmaClient, type GemmaEvent, type GenerateResult } from '../gemma.js';
import { type StatuteText, verifierInstruction, verifierTask } from '../prompts/lease.js';
import { type VerifierAssessment, type VerifierCheck, verifierSchema } from '../schemas/lease.js';
import { batchByTokens, clampOutput, MAX_REQUEST_TOKENS, textTokens } from './budget.js';
import { type Draft, needsVerifier, pairKey } from './findings.js';
import type { Clause, Drop, VerifierResult, VerifierVerdict } from './types.js';

// What every model stage after S6 gets from analyzeLease.
export interface StageCall {
  gemma: GemmaClient;
  options: { signal?: AbortSignal; onEvent: (event: GemmaEvent) => void; log: Logger };
  track: <T>(result: GenerateResult<T>) => GenerateResult<T>;
}

// A model that could not give a valid answer. Anything else (an abort, a
// bug) still fails the analysis.
export function isModelFailure(err: unknown): err is GemmaUnavailableError | GemmaOutputError | GemmaRequestError {
  return err instanceof GemmaUnavailableError || err instanceof GemmaOutputError || err instanceof GemmaRequestError;
}

const VERDICT: Record<VerifierAssessment, VerifierVerdict> = { violates: 'agree', complies: 'disagree', unclear: 'unclear' };

// 31B in `json` mode thinks before it answers; the cap covers both.
export const verifierOutputCap = (checks: number) => clampOutput(checks * 400);

export function statuteText(draft: Draft): StatuteText {
  const quotes = draft.versions.map((v) => ({ quote: v.version.statuteQuote, from: v.from, until: v.until }));
  // A version change that leaves the quoted words alone is one text.
  const versions = quotes.every((q) => q.quote === quotes[0]?.quote) ? quotes.slice(0, 1) : quotes;
  return { ruleId: draft.ruleId!, citation: draft.citation!, versions };
}

interface Pair {
  clause: Clause;
  statute: StatuteText;
}

export async function runVerifier(drafts: readonly Draft[], clauses: ReadonlyMap<string, Clause>, call: StageCall, drops: Drop[]): Promise<Map<string, VerifierResult>> {
  const pairs = new Map<string, Pair>();
  for (const d of drafts) {
    if (!needsVerifier(d)) continue;
    const clause = clauses.get(d.clauseId);
    if (clause && !pairs.has(pairKey(d.clauseId, d.ruleId))) pairs.set(pairKey(d.clauseId, d.ruleId), { clause, statute: statuteText(d) });
  }
  const results = new Map<string, VerifierResult>();
  if (pairs.size === 0) return results;

  const cost = (p: Pair) => textTokens(p.clause.verbatim) + textTokens(p.statute.versions.map((v) => v.quote).join(' ')) + 40;
  const batches = batchByTokens([...pairs.values()], cost, MAX_REQUEST_TOKENS - 1_000);
  await Promise.all(
    batches.map(async (batch) => {
      const statutes = [...new Map(batch.map((p) => [p.statute.ruleId, p.statute])).values()];
      const docs: TextDocument[] = [...new Map(batch.map((p) => [p.clause.id, { id: p.clause.id, text: p.clause.verbatim }])).values()];
      const checks = batch.map((p) => ({ clauseId: p.clause.id, ruleId: p.statute.ruleId }));
      const wanted = new Set(checks.map((c) => pairKey(c.clauseId, c.ruleId)));
      let result: GenerateResult<{ checks: VerifierCheck[] }>;
      try {
        result = call.track(
          await call.gemma.generate('verification', verifierSchema(statutes.map((s) => s.ruleId) as [string, ...string[]]), docs, {
            task: verifierTask(checks),
            instruction: verifierInstruction(statutes),
            maxOutputTokens: verifierOutputCap(checks.length),
            ...call.options,
          }),
        );
      } catch (err) {
        if (!isModelFailure(err)) throw err;
        call.options.log.warn('verifier unavailable', { errorName: err.name, checks: checks.length });
        return;
      }
      for (const answer of result.data.checks) {
        const key = pairKey(answer.clauseId, answer.ruleId);
        // An answer for a check it was not asked, or a second answer: ignored.
        if (!wanted.delete(key)) continue;
        results.set(key, {
          verdict: VERDICT[answer.assessment],
          assessment: answer.assessment,
          reasoning: answer.reasoning.trim(),
          model: result.model,
          fallback: result.fallback,
        });
      }
      for (const key of wanted) drops.push({ stage: 'S7', reason: 'verifier_no_answer', ref: key });
    }),
  );
  return results;
}
