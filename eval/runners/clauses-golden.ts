// The `clauses-golden` eval set (spec §12, #20): the 60 excerpts in
// datasets/clauses-golden.jsonl, 10 a call, as clauses of one document,
// through the lease pipeline's S5 mapping, S6 checks, S7 verifier, and the
// severity table, exactly as analyzeLease runs them (no S4: excerpts have no
// key terms). Run by eval.ts. Report only.
//
// Per rule: a `match` excerpt is a true positive when it gets an
// `unenforceable` or `ask` finding for its rule, and a `no_match` look-alike
// with one is a false positive. Flags for other rules are counted, not
// scored: an excerpt can touch more than one rule. Verifier agreement is
// over the excerpts where S5 said `violates` for the excerpt's own rule.
// `pnpm verifier` measures S7 alone, as if S5 had said violates every time.

import { readFileSync } from 'node:fs';
import type { TextDocument } from '../../server/src/ai/documents.js';
import type { GemmaClient } from '../../server/src/ai/gemma.js';
import { CLAUSES_PER_BATCH, mappingOutputCap } from '../../server/src/ai/pipeline/lease.js';
import { draftFindings, rankFindings } from '../../server/src/ai/pipeline/findings.js';
import type { Clause, Drop, Finding, VerifiedMapping } from '../../server/src/ai/pipeline/types.js';
import { runVerifier, type StageCall } from '../../server/src/ai/pipeline/verifier.js';
import { verifyMappings } from '../../server/src/ai/pipeline/verify.js';
import { mappingInstruction, mappingTask } from '../../server/src/ai/prompts/lease.js';
import { mappingSchema, type Mapping } from '../../server/src/ai/schemas/lease.js';
import type { Logger } from '../../server/src/log.js';
import { resolveRules } from '../../server/src/rules/resolve.js';
import type { RulePack } from '../../server/src/rules/types.js';

export interface GoldenCase {
  id: string;
  ruleId: string;
  expected: 'match' | 'no_match';
  text: string;
}

// The synthetic lease's term, so every rule has a version in force.
const TERM = { start: '2026-11-01', end: '2027-10-31' };

export function loadGoldenCases(): GoldenCase[] {
  return readFileSync(new URL('../datasets/clauses-golden.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

// The excerpts as one document, a blank line apart, so every quote has an
// offset the citations gate can check.
export function goldenDocument(cases: readonly GoldenCase[]): { text: string; clauses: Clause[] } {
  const clauses: Clause[] = [];
  let text = '';
  for (const c of cases) {
    if (text) text += '\n\n';
    clauses.push({ id: c.id, heading: null, start: text.length, end: text.length + c.text.length, verbatim: c.text });
    text += c.text;
  }
  return { text: `${text}\n`, clauses };
}

export interface GoldenRow {
  id: string;
  ruleId: string;
  expected: GoldenCase['expected'];
  flagged: boolean;
  // S5's assessment for the excerpt's own rule, or null when S5 did not cite it.
  assessment: string | null;
  verifier: string | null;
  severity: string | null;
  otherRules: string[];
}

export interface GoldenResult {
  rows: GoldenRow[];
  perRule: { ruleId: string; tp: number; fn: number; fp: number; tn: number }[];
  recall: number | null;
  precision: number | null;
  verifierAgreeOnViolations: { agree: number; of: number };
  verifierAgreeOnLookalikes: { agree: number; of: number };
  calls: number;
  drops: number;
  output: { id: string; text: string; findings: Finding[] };
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function scoreGolden(cases: readonly GoldenCase[], findings: readonly Finding[]): Omit<GoldenResult, 'calls' | 'drops' | 'output'> {
  const rows: GoldenRow[] = cases.map((c) => {
    const own = findings.find((f) => f.clauseId === c.id && f.ruleId === c.ruleId);
    const others = findings.filter((f) => f.clauseId === c.id && f.ruleId !== null && f.ruleId !== c.ruleId && f.severity !== 'info');
    return {
      id: c.id,
      ruleId: c.ruleId,
      expected: c.expected,
      flagged: own !== undefined && own.severity !== 'info',
      assessment: own?.primaryAssessment ?? null,
      verifier: own?.verifier?.verdict ?? null,
      severity: own?.severity ?? null,
      otherRules: others.map((f) => f.ruleId!),
    };
  });
  const perRule = [...new Set(cases.map((c) => c.ruleId))].sort().map((ruleId) => {
    const mine = rows.filter((r) => r.ruleId === ruleId);
    const count = (expected: GoldenCase['expected'], flagged: boolean) => mine.filter((r) => r.expected === expected && r.flagged === flagged).length;
    return { ruleId, tp: count('match', true), fn: count('match', false), fp: count('no_match', true), tn: count('no_match', false) };
  });
  const tp = perRule.reduce((n, r) => n + r.tp, 0);
  const fn = perRule.reduce((n, r) => n + r.fn, 0);
  const fp = perRule.reduce((n, r) => n + r.fp, 0);
  const verified = (expected: GoldenCase['expected']) => {
    const subset = rows.filter((r) => r.expected === expected && r.assessment === 'violates');
    return { agree: subset.filter((r) => r.verifier === 'agree').length, of: subset.length };
  };
  return {
    rows,
    perRule,
    recall: ratio(tp, tp + fn),
    precision: ratio(tp, tp + fp),
    verifierAgreeOnViolations: verified('match'),
    verifierAgreeOnLookalikes: verified('no_match'),
  };
}

export interface GoldenDeps {
  gemma: GemmaClient;
  pack: RulePack;
  log: Logger;
}

export async function runClausesGolden({ gemma, pack, log }: GoldenDeps, progress: (line: string) => void): Promise<GoldenResult> {
  const cases = loadGoldenCases();
  const { text, clauses } = goldenDocument(cases);
  const resolved = resolveRules(pack.rules, TERM);
  const inForce = new Map(resolved.map((r) => [r.rule.id, r]));
  const rules = resolved.map((r) => r.rule);
  const schema = mappingSchema(rules.map((r) => r.id) as [string, ...string[]]);
  const instruction = mappingInstruction(rules);
  let calls = 0;
  const call: StageCall = {
    gemma,
    options: { onEvent: () => {}, log },
    track: (r) => {
      calls++;
      return r;
    },
  };
  const drops: Drop[] = [];
  const mappings: VerifiedMapping[] = [];
  for (let i = 0; i < clauses.length; i += CLAUSES_PER_BATCH) {
    const batch = clauses.slice(i, i + CLAUSES_PER_BATCH);
    const docs: TextDocument[] = batch.map((c) => ({ id: c.id, text: c.verbatim }));
    const result = call.track(
      await gemma.generate('mapping', schema, docs, {
        task: mappingTask(batch.map((c) => c.id)),
        instruction,
        maxOutputTokens: mappingOutputCap(batch.length),
        ...call.options,
      }),
    );
    mappings.push(
      ...verifyMappings(
        (result.data as { mappings: Mapping[] }).mappings,
        { clauses: new Map(batch.map((c) => [c.id, c])), pack, inForce, checks: [], absent: [], model: result.model, fallback: result.fallback },
        drops,
      ),
    );
    progress(`clauses-golden S5 ${Math.min(i + CLAUSES_PER_BATCH, clauses.length)}/${clauses.length}`);
  }
  const drafts = draftFindings(pack, [], [], mappings, []);
  const verdicts = await runVerifier(drafts, new Map(clauses.map((c) => [c.id, c])), call, drops);
  progress(`clauses-golden S7: ${verdicts.size} checks`);
  // rankFindings is the severity table; S8's text is not scored here.
  const findings = rankFindings(drafts, verdicts).map(
    (r): Finding => ({ ...r, titleEn: '', explanationEn: '', actionEn: '', readability: { grade: 0, target: 7, source: 'template' }, translations: {} }),
  );
  return { ...scoreGolden(cases, findings), calls, drops: drops.length, output: { id: 'clauses-golden', text, findings } };
}
