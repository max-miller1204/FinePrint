// The `lease-synthetic` eval set (spec §12, #20): the 12-page Virginia lease
// with 8 planted violations and its 2 clean variants
// (scripts/make-synthetic-lease.ts), each through the real lease pipeline,
// S1 to S8. Run by eval.ts; scored here, so the CI test can score a
// scripted analysis the same way.
//
// A finding counts as flagged when it names a rule and its severity is
// `unenforceable` or `ask`: what the tenant is told to act on. It is a true
// positive when its rule matches a planted violation and its lease quote is
// in that plant's section (found by offset in the text, so it does not
// depend on how S2 cut the clauses), and a false positive otherwise, so a
// planted rule found on the wrong clause is both a miss and a false alarm.
// Severity accuracy is over the planted violations found.

import { readFileSync } from 'node:fs';
import type { GemmaClient } from '../../server/src/ai/gemma.js';
import { analyzeLease, type LeaseAnalysis } from '../../server/src/ai/pipeline/lease.js';
import type { Finding } from '../../server/src/ai/pipeline/types.js';
import type { Triage } from '../../server/src/ai/triage/index.js';
import type { Logger } from '../../server/src/log.js';
import type { RulePack } from '../../server/src/rules/types.js';

export type PlantSeverity = 'unenforceable' | 'ask';

export interface LeaseCase {
  id: string;
  file: string;
  locale: string;
  expected: { ruleId: string; heading: string; severity: PlantSeverity }[];
}

export const RECALL_GATE = 0.9;
export const PRECISION_GATE = 0.85;

export function loadLeaseCases(): (LeaseCase & { text: string })[] {
  return readFileSync(new URL('../datasets/lease-synthetic.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LeaseCase)
    .map((c) => ({ ...c, text: readFileSync(new URL(`../datasets/${c.file}`, import.meta.url), 'utf8') }));
}

export interface FlaggedRow {
  findingId: string;
  ruleId: string;
  severity: Finding['severity'];
  basis: Finding['basis'];
  verifier: string | null;
  heading: string | null;
  planted: boolean;
}

export interface LeaseScore {
  id: string;
  status: LeaseAnalysis['status'] | 'error';
  tp: number;
  fp: number;
  fn: number;
  severityRight: number;
  flagged: FlaggedRow[];
  missed: string[];
  // Planted rules found at the wrong severity: `ruleId expected->got`.
  wrongSeverity: string[];
}

// The heading (`12. TITLE.`) of the paragraph a finding's quote starts in,
// or null for a finding with no quote or a paragraph with no heading.
export function headingAt(text: string, f: Pick<Finding, 'quoteSpan'>): string | null {
  if (!f.quoteSpan) return null;
  const start = text.lastIndexOf('\n\n', f.quoteSpan.start);
  return text.slice(start < 0 ? 0 : start + 2).match(/^\d+\.\s[^.\n]+\./)?.[0] ?? null;
}

export function scoreLease(c: LeaseCase & { text: string }, analysis: LeaseAnalysis | null): LeaseScore {
  if (analysis?.status !== 'analyzed') {
    return {
      id: c.id,
      status: analysis?.status ?? 'error',
      tp: 0,
      fp: 0,
      fn: c.expected.length,
      severityRight: 0,
      flagged: [],
      missed: c.expected.map((e) => e.ruleId),
      wrongSeverity: [],
    };
  }
  const flagged: FlaggedRow[] = analysis.findings
    .filter((f): f is Finding & { ruleId: string } => f.ruleId !== null && f.severity !== 'info')
    .map((f) => {
      const heading = headingAt(c.text, f);
      return {
        findingId: f.id,
        ruleId: f.ruleId,
        severity: f.severity,
        basis: f.basis,
        verifier: f.verifier?.verdict ?? null,
        heading,
        planted: c.expected.some((e) => e.ruleId === f.ruleId && e.heading === heading),
      };
    });
  const missed: string[] = [];
  const wrongSeverity: string[] = [];
  let severityRight = 0;
  for (const e of c.expected) {
    const hit = flagged.find((f) => f.planted && f.ruleId === e.ruleId && f.heading === e.heading);
    if (!hit) missed.push(e.ruleId);
    else if (hit.severity === e.severity) severityRight++;
    else wrongSeverity.push(`${e.ruleId} ${e.severity}->${hit.severity}`);
  }
  const tp = flagged.filter((f) => f.planted).length;
  return { id: c.id, status: 'analyzed', tp, fp: flagged.length - tp, fn: missed.length, severityRight, flagged, missed, wrongSeverity };
}

export interface PerRule {
  ruleId: string;
  tp: number;
  fp: number;
  fn: number;
}

export function perRule(scores: readonly LeaseScore[]): PerRule[] {
  const rows = new Map<string, PerRule>();
  const row = (ruleId: string) => rows.get(ruleId) ?? rows.set(ruleId, { ruleId, tp: 0, fp: 0, fn: 0 }).get(ruleId)!;
  for (const s of scores) {
    for (const f of s.flagged) row(f.ruleId)[f.planted ? 'tp' : 'fp']++;
    for (const ruleId of s.missed) row(ruleId).fn++;
  }
  return [...rows.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export interface LeaseSyntheticResult {
  scores: LeaseScore[];
  perRule: PerRule[];
  recall: number | null;
  precision: number | null;
  severityAccuracy: number | null;
  pass: boolean;
  // For the citations gate: each analyzed lease's text and findings.
  outputs: { id: string; text: string; findings: Finding[] }[];
  runs: { id: string; status: string; calls: number; seconds: number; models: string[]; fallback: boolean; unverified: number; error?: string }[];
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function summarize(scores: LeaseScore[]): Pick<LeaseSyntheticResult, 'scores' | 'perRule' | 'recall' | 'precision' | 'severityAccuracy' | 'pass'> {
  const tp = scores.reduce((n, s) => n + s.tp, 0);
  const fp = scores.reduce((n, s) => n + s.fp, 0);
  const fn = scores.reduce((n, s) => n + s.fn, 0);
  const recall = ratio(tp, tp + fn);
  const precision = ratio(tp, tp + fp);
  const severityAccuracy = ratio(
    scores.reduce((n, s) => n + s.severityRight, 0),
    tp,
  );
  const allAnalyzed = scores.every((s) => s.status === 'analyzed');
  const pass = allAnalyzed && recall !== null && recall >= RECALL_GATE && precision !== null && precision >= PRECISION_GATE;
  return { scores, perRule: perRule(scores), recall, precision, severityAccuracy, pass };
}

export interface LeaseSyntheticDeps {
  gemma: GemmaClient;
  pack: RulePack;
  triage: Triage;
  log: Logger;
}

export async function runLeaseSynthetic(deps: LeaseSyntheticDeps, progress: (line: string) => void): Promise<LeaseSyntheticResult> {
  const scores: LeaseScore[] = [];
  const outputs: LeaseSyntheticResult['outputs'] = [];
  const runs: LeaseSyntheticResult['runs'] = [];
  for (const c of loadLeaseCases()) {
    const started = Date.now();
    let analysis: LeaseAnalysis | null = null;
    let error: string | undefined;
    try {
      analysis = await analyzeLease({ leaseId: `lease-synthetic-${c.id}`, text: c.text, locale: c.locale, today: '2026-10-24' }, deps);
    } catch (err) {
      error = `${(err as Error).name}: ${(err as Error).message}`;
    }
    const score = scoreLease(c, analysis);
    scores.push(score);
    const seconds = Math.round((Date.now() - started) / 1000);
    const unverified = analysis?.status === 'analyzed' ? analysis.findings.filter((f) => f.verifier?.verdict === 'unverified').length : 0;
    runs.push({
      id: c.id,
      status: score.status,
      calls: analysis?.usage.calls ?? 0,
      seconds,
      models: analysis?.usage.models ?? [],
      fallback: analysis?.usage.fallback ?? false,
      unverified,
      ...(error ? { error } : {}),
    });
    if (analysis?.status === 'analyzed') outputs.push({ id: c.id, text: c.text, findings: analysis.findings });
    progress(`lease-synthetic ${c.id}: ${score.status}${error ? ` (${error})` : ''}, tp ${score.tp} fp ${score.fp} fn ${score.fn}, ${seconds} s`);
  }
  return { ...summarize(scores), outputs, runs };
}
