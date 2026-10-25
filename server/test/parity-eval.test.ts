import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadParityCases, PARITY_LOCALES, parityText, scoreParity, verdictSignature, type ParityRun } from '../../eval/runners/parity.js';
import { loadGoldenCases } from '../../eval/runners/clauses-golden.js';
import type { LeaseAnalysis } from '../src/ai/pipeline/lease.js';
import type { Finding } from '../src/ai/pipeline/types.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../src/rules/loader.js';

const cases = loadParityCases();
// Minimal analysis fixtures isolate the scoring contract from model phrasing.
function perfect(): ParityRun[] {
  return cases.flatMap((c) => PARITY_LOCALES.map((locale) => ({
    id: c.id, locale,
    analysis: { status: 'analyzed', drops: [], findings: c.expected === 'no_flag' ? [] : [{
      ruleId: c.ruleId, severity: c.expected, primaryAssessment: 'violates', verifier: { verdict: 'agree' },
      translations: { [locale]: { title: 'Título', explanation: 'Explicación', action: 'Acción' } },
    }] } as unknown as LeaseAnalysis,
  })));
}
function findings(run: ParityRun): Finding[] {
  if (run.analysis?.status !== 'analyzed') throw new Error('fixture');
  return run.analysis.findings;
}

describe('language parity eval', () => {
  it('has 20 matched cases, 10 violations and 10 look-alikes, from the golden set', () => {
    expect(cases.filter((c) => c.expected !== 'no_flag')).toHaveLength(10);
    expect(cases.filter((c) => c.expected === 'no_flag')).toHaveLength(10);
    const pack = loadRulePack(join(JURISDICTIONS_ROOT, 'va'), { requireVerified: true });
    for (const c of cases) {
      expect(loadGoldenCases().find((g) => g.id === c.id)?.expected).toBe(c.expected === 'no_flag' ? 'no_match' : 'match');
      if (c.expected !== 'no_flag') expect(pack.byId.get(c.ruleId)?.severityIfViolated).toBe(c.expected);
      expect(loadGoldenCases().find((g) => g.id === c.id)?.text).toBe(c.texts.en);
      expect(c.texts.es).not.toBe(c.texts.en);
      expect(c.texts.fr).not.toBe(c.texts.en);
      for (const locale of PARITY_LOCALES) expect(parityText(c, locale)).toContain(c.texts[locale]);
    }
  });
  it('passes complete correct agreement and allows 19/20, but fails 18/20', () => {
    const runs = perfect();
    expect(scoreParity(cases, runs)).toMatchObject({ pass: true, rate: 1, accuracy: 1, complete: true });
    findings(runs[1]!)[0]!.severity = 'ask';
    expect(scoreParity(cases, runs)).toMatchObject({ pass: true, rate: 0.95, accuracy: 0.95 });
    findings(runs[7]!)[0]!.severity = 'ask';
    expect(scoreParity(cases, runs)).toMatchObject({ pass: false, rate: 0.9, accuracy: 0.9 });
  });
  it('does not pass when every locale agrees on the wrong result', () => {
    const runs = perfect();
    for (const r of runs) for (const f of findings(r)) f.severity = 'info';
    expect(scoreParity(cases, runs)).toMatchObject({ pass: false, rate: 1, accuracy: 0.5 });
  });
  it('fails missing, duplicate, unavailable, untranslated, and unverified runs', () => {
    expect(scoreParity(cases, perfect().slice(1)).pass).toBe(false);
    const duplicate = perfect(); duplicate[1] = duplicate[0]!;
    expect(scoreParity(cases, duplicate).pass).toBe(false);
    const failed = perfect(); failed[0]!.analysis = null;
    expect(scoreParity(cases, failed).pass).toBe(false);
    const untranslated = perfect(); findings(untranslated[1]!)[0]!.translations = {};
    expect(scoreParity(cases, untranslated)).toMatchObject({ pass: false, rate: 1, complete: false });
    const unverified = perfect(); findings(unverified[0]!)[0]!.verifier!.verdict = 'unverified';
    expect(scoreParity(cases, unverified).pass).toBe(false);
  });
  it('compares all findings including extra rules and verdict changes', () => {
    const runs = perfect();
    const f = findings(runs[1]!)[0]!;
    findings(runs[1]!).push({ ...f, ruleId: 'OTHER' });
    expect(scoreParity(cases, runs).rows[0]!.parity).toBe(false);
    findings(runs[1]!).pop();
    f.verifier!.verdict = 'disagree';
    expect(scoreParity(cases, runs).rows[0]!.parity).toBe(false);
    const a = runs[0]!.analysis!;
    findings(runs[0]!).push({ ...findings(runs[0]!)[0]!, ruleId: 'OTHER' });
    const reordered = structuredClone(a);
    if (reordered.status !== 'analyzed') throw new Error('fixture');
    reordered.findings.reverse();
    for (const f of reordered.findings) { f.id = 'different-id'; f.clauseId = 'different-clause'; f.titleEn = 'Other prose'; }
    expect(verdictSignature(a)).toBe(verdictSignature(reordered));
  });
});
