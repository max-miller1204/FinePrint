// S8 (spec §7.3): a plain-English title and explanation for each finding,
// checked in code against the reading level (readability.ts): grade 7 or
// lower, grade 5 for Simpler. Findings that fail get one regeneration with a
// stricter instruction. One that still fails, or that the model skipped,
// falls back to the rule's own tenant explanation when that passes, and
// otherwise to a fixed sentence for its severity, so every explanation a
// tenant sees passes the check.
//
// The model writes the words only. Severity, quotes, and citations are set
// before S8 and never change; "what you can do" is the rule's verified text.

import type { TextDocument } from '../documents.js';
import type { GenerateResult } from '../gemma.js';
import { type ExplanationFacts, explanationInstruction, explanationTask } from '../prompts/lease.js';
import { type Explanation, ExplanationSchema } from '../schemas/lease.js';
import type { Severity } from '../../rules/types.js';
import { batchByTokens, clampOutput, MAX_REQUEST_TOKENS, textTokens } from './budget.js';
import type { Ranked } from './findings.js';
import { fleschKincaidGrade, GRADE_TARGET, meetsGrade, type ReadingLevel, words } from './readability.js';
import { SEVERITY_LABEL } from './severity.js';
import type { Drop, ExplanationSource, Finding } from './types.js';
import { isModelFailure, type StageCall } from './verifier.js';

// Every one reads at grade 5 or lower (server/test/lease-pipeline.test.ts).
export const TEMPLATE_TITLE: Record<Severity | 'not_covered', string> = {
  unenforceable: 'This part may not hold up',
  ask: 'Worth asking about',
  info: 'Good to know',
  not_covered: 'Not in our checklist',
};

export const TEMPLATE_EXPLANATION: Record<Severity | 'not_covered', string> = {
  unenforceable: "This part of your lease may go against a state law. If it does, it can't be used against you.",
  ask: 'This part of your lease may be a problem. It is worth asking about it.',
  info: 'This part of your lease is allowed. It is good to know about it.',
  not_covered: 'No rule in our checklist covers this part of your lease. Read it with care, and ask about it if it is not clear.',
};

export const NOT_COVERED_ACTION = 'You can ask your landlord what this part of the lease means.';

const MAX_TITLE_CHARS = 80;

const kind = (f: Ranked) => (f.ruleId === null ? 'not_covered' : f.severity);

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });

// Code's numbers, so the model never has to read an amount out of the lease.
export function checkNumbers(f: Ranked): string | null {
  if (!f.check) return null;
  const { actual, limit, unit } = f.check;
  return unit === 'usd'
    ? `The lease's amount is ${usd(actual)}. The most allowed is ${usd(limit)}.`
    : `The lease gives ${actual} hours' notice. At least ${limit} hours are required.`;
}

function facts(f: Ranked): ExplanationFacts {
  return {
    findingId: f.id,
    label: f.ruleId === null ? 'Not covered' : SEVERITY_LABEL[f.severity],
    rule: f.rule?.tenantExplanation ?? null,
    numbers: checkNumbers(f),
    hasQuote: f.leaseQuote !== null,
  };
}

// A grade check alone passes junk: 26B in `schema` mode once answered
// "text" for both fields (grade -3.4). A title is 2 to 12 words; an
// explanation is at least a real sentence.
const MIN_EXPLANATION_WORDS = 8;
export const usableTitle = (title: string) => {
  const n = words(title).length;
  return n >= 2 && n <= 12 && title.trim().length <= MAX_TITLE_CHARS;
};
export const usableExplanation = (text: string, level: ReadingLevel) => words(text).length >= MIN_EXPLANATION_WORDS && meetsGrade(text, level);

// One or more calls (split only past the token cap) for these findings.
async function ask(findings: readonly Ranked[], level: ReadingLevel, retry: boolean, call: StageCall): Promise<Map<string, Explanation>> {
  const answers = new Map<string, Explanation>();
  const cost = (f: Ranked) => textTokens(f.leaseQuote ?? '') + textTokens(f.rule?.tenantExplanation ?? '') + 60;
  const batches = batchByTokens(findings, cost, MAX_REQUEST_TOKENS - 1_000);
  await Promise.all(
    batches.map(async (batch) => {
      const docs: TextDocument[] = batch.flatMap((f) => (f.leaseQuote ? [{ id: f.id, text: f.leaseQuote }] : []));
      let result: GenerateResult<{ explanations: Explanation[] }>;
      try {
        result = call.track(
          await call.gemma.generate('explanation', ExplanationSchema, docs, {
            task: explanationTask(batch.map((f) => f.id)),
            instruction: explanationInstruction(batch.map(facts), GRADE_TARGET[level], retry),
            maxOutputTokens: clampOutput(batch.length * 200),
            ...call.options,
          }),
        );
      } catch (err) {
        if (!isModelFailure(err)) throw err;
        call.options.log.warn('explanation unavailable', { errorName: err.name, findings: batch.length, retry });
        return;
      }
      const wanted = new Set(batch.map((f) => f.id));
      for (const e of result.data.explanations) if (wanted.delete(e.findingId)) answers.set(e.findingId, e);
    }),
  );
  return answers;
}

const passes = (e: Explanation | undefined, level: ReadingLevel): e is Explanation => !!e && usableTitle(e.title) && usableExplanation(e.explanation, level);

export async function explainFindings(ranked: readonly Ranked[], level: ReadingLevel, call: StageCall, drops: Drop[]): Promise<Finding[]> {
  const chosen = new Map<string, { title: string; explanation: string; source: ExplanationSource }>();
  if (ranked.length > 0) {
    const first = await ask(ranked, level, false, call);
    const failing: Ranked[] = [];
    for (const f of ranked) {
      const e = first.get(f.id);
      if (passes(e, level)) chosen.set(f.id, { title: e.title.trim(), explanation: e.explanation.trim(), source: 'model' });
      else failing.push(f);
    }
    // The one regeneration.
    const second = failing.length > 0 ? await ask(failing, level, true, call) : new Map<string, Explanation>();
    for (const f of failing) {
      const e = second.get(f.id);
      if (passes(e, level)) {
        chosen.set(f.id, { title: e.title.trim(), explanation: e.explanation.trim(), source: 'model_retry' });
        continue;
      }
      drops.push({ stage: 'S8', reason: e || first.has(f.id) ? 'explanation_over_grade' : 'explanation_missing', ref: f.id });
      const ruleText = f.rule?.tenantExplanation;
      const title = [second.get(f.id)?.title, first.get(f.id)?.title].find((t): t is string => !!t && usableTitle(t))?.trim() ?? TEMPLATE_TITLE[kind(f)];
      if (ruleText && meetsGrade(ruleText, level)) chosen.set(f.id, { title, explanation: ruleText, source: 'rule' });
      else chosen.set(f.id, { title, explanation: TEMPLATE_EXPLANATION[kind(f)], source: 'template' });
    }
  }

  return ranked.map(({ rule, ...f }) => {
    const { title, explanation, source } = chosen.get(f.id)!;
    return {
      ...f,
      titleEn: title,
      explanationEn: explanation,
      actionEn: rule?.action ?? NOT_COVERED_ACTION,
      readability: { grade: fleschKincaidGrade(explanation), target: GRADE_TARGET[level], source },
      translations: {},
    };
  });
}
