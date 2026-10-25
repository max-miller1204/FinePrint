import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCitations } from '../../eval/runners/citations.js';
import { goldenDocument, loadGoldenCases, scoreGolden } from '../../eval/runners/clauses-golden.js';
import { headingAt, loadLeaseCases, scoreLease, summarize } from '../../eval/runners/lease-synthetic.js';
import { leaseText, PLANTS, type Variant } from '../../scripts/make-synthetic-lease.ts';
import { detectInjection, type LeaseAnalysis } from '../src/ai/pipeline/lease.js';
import { runAbsenceChecks, runDeterministicChecks } from '../src/ai/pipeline/checks.js';
import { resolveClauses, resolveKeyTerms } from '../src/ai/pipeline/resolve.js';
import type { Finding } from '../src/ai/pipeline/types.js';
import type { Segmentation } from '../src/ai/schemas/lease.js';
import { keywordBackstop } from '../src/ai/triage/keywords.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../src/rules/loader.js';
import { resolveRules } from '../src/rules/resolve.js';

// The lease eval sets (spec §12, #20). `pnpm eval` runs them against the real
// model; this file gates CI on everything that needs no model: the
// generated leases, their plants, the scoring, and the citations gate.
const PACK_DIR = join(JURISDICTIONS_ROOT, 'va');
const PACK = loadRulePack(PACK_DIR, { requireVerified: true });
const TERM = { start: '2026-11-01', end: '2027-10-31' };
const CASES = loadLeaseCases();
const byId = (id: string) => CASES.find((c) => c.id === id)!;

// What a perfect S2 would say: a start per numbered section, and the key terms.
function segmentation(v: Variant, text: string): Segmentation {
  const clauses = text
    .split('\n\n')
    .filter((p) => /^\d+\. /.test(p))
    .map((p) => ({ heading: p.match(/^\d+\. ([^.]+)\./)![1]!, start: p.split(' ').slice(0, 8).join(' ') }));
  const rent = v === 'clean-alt' ? '$1,650.00' : '$1,500.00';
  const value = (s: string, pattern: RegExp) => s.match(pattern)![0];
  const keyTerms: Segmentation['keyTerms'] = [
    { name: 'monthlyRent', value: rent, quote: `Tenant shall pay monthly rent of ${rent}, in advance, on or before the first (1st) day of each month, without demand.` },
    { name: 'securityDeposit', value: value(PLANTS.deposit.text[v], /\$[\d,.]+\d/), quote: PLANTS.deposit.text[v] },
    { name: 'lateFee', value: value(PLANTS.lateFee.text[v], /\w+ percent \(\d+%\)|\$[\d,.]+\d/), quote: PLANTS.lateFee.text[v] },
    { name: 'maintenanceNoticeHours', value: value(PLANTS.entry.text[v], /[\w-]+ \(\d+\) hours'/), quote: PLANTS.entry.text[v] },
    { name: 'leaseStart', value: 'November 1, 2026', quote: 'The term of this Lease begins on November 1, 2026 and ends on October 31, 2027.' },
    { name: 'leaseEnd', value: 'October 31, 2027', quote: 'The term of this Lease begins on November 1, 2026 and ends on October 31, 2027.' },
  ];
  return { documentType: 'residential_lease', aiInstructions: false, clauses, keyTerms };
}

// A finding on the quote `quote`, for scoring and citation tests.
function finding(text: string, ruleId: string | null, quote: string | null, over: Partial<Finding> = {}): Finding {
  const rule = ruleId ? PACK.byId.get(ruleId)! : null;
  const start = quote === null ? -1 : text.indexOf(quote);
  if (quote !== null && start < 0) throw new Error(`quote not in text: ${quote}`);
  const versions = rule ? rule.versions.slice(0, 1).map((version) => ({ version, from: TERM.start, until: null })) : [];
  return {
    id: 'f1',
    severity: 'unenforceable',
    basis: 'mapping',
    ruleId,
    citation: rule?.citation ?? null,
    sourceUrl: rule?.sourceUrl ?? null,
    checkType: rule?.checkType ?? null,
    versions,
    changes: [],
    statuteQuote: versions[0]?.version.statuteQuote ?? null,
    clauseId: quote === null ? null : 'c1',
    leaseQuote: quote,
    quoteSpan: quote === null ? null : { start, end: start + quote.length },
    primaryAssessment: 'violates',
    primaryModel: 'gemma-4-26b-a4b-it',
    primaryFallback: false,
    verifier: null,
    check: null,
    titleEn: '',
    explanationEn: '',
    actionEn: '',
    readability: { grade: 0, target: 7, source: 'template' },
    translations: {},
    ...over,
  };
}

const analyzed = (findings: Finding[]) => ({ status: 'analyzed', findings }) as unknown as LeaseAnalysis;

describe('lease-synthetic set', () => {
  it('is what scripts/make-synthetic-lease.ts writes', () => {
    for (const c of CASES) expect(c.text, c.id).toBe(leaseText(c.id as Variant).text);
    expect(CASES.map((c) => c.id)).toEqual(['planted', 'clean', 'clean-alt']);
  });

  it('plants the 8 violations of spec §12 in the planted lease only', () => {
    expect(byId('planted').expected.map((e) => e.ruleId).sort()).toEqual([
      'VA_DEPOSIT_CAP',
      'VA_LANDLORD_MAINTAIN_FIT',
      'VA_LATE_FEE_CAP',
      'VA_NO_CONFESSION_OF_JUDGMENT',
      'VA_NO_EXCULPATION_INDEMNITY',
      'VA_NO_LANDLORD_ATTORNEY_FEES',
      'VA_NO_RIGHTS_WAIVER',
      'VA_ROUTINE_MAINTENANCE_NOTICE_72H',
    ]);
    for (const e of byId('planted').expected) expect(byId('planted').text, e.heading).toContain(`\n\n${e.heading} `);
    for (const plant of Object.values(PLANTS)) {
      expect(byId('planted').text).toContain(plant.text.planted);
      expect(byId('clean').text).not.toContain(plant.text.planted);
      expect(byId('clean-alt').text).not.toContain(plant.text.planted);
    }
    expect(byId('clean').expected).toEqual([]);
    expect(byId('clean-alt').expected).toEqual([]);
  });

  it('is about 12 pages, in one S2 chunk', () => {
    for (const c of CASES) {
      expect(c.text.length, c.id).toBeGreaterThan(27_000);
      expect(c.text.length, c.id).toBeLessThan(40_000);
    }
  });

  it('does not trip S1, the injection pattern, or the required-wording check', async () => {
    const backstop = keywordBackstop();
    const resolved = resolveRules(PACK.rules, TERM);
    for (const c of CASES) {
      const k = await backstop.classify({ source: 'lease', text: c.text, locale: 'en' });
      expect(k.category, c.id).toBe('none');
      expect(detectInjection(c.text), c.id).toBe(false);
      expect(runAbsenceChecks(resolved, c.text), c.id).toEqual([]);
    }
  });

  it('gives S4 exactly the three deterministic plants when S2 reads the lease right', () => {
    const resolved = resolveRules(PACK.rules, TERM);
    const violations = (v: Variant) => {
      const text = byId(v).text;
      const seg = segmentation(v, text);
      const drops: never[] = [];
      const clauses = resolveClauses(text, seg.clauses, drops);
      const keyTerms = resolveKeyTerms(text, clauses, seg.keyTerms, drops);
      expect(drops, v).toEqual([]);
      expect(keyTerms, v).toHaveLength(6);
      return runDeterministicChecks(resolved, keyTerms)
        .filter((c) => c.outcome === 'violates')
        .map((c) => c.ruleId)
        .sort();
    };
    expect(violations('planted')).toEqual(['VA_DEPOSIT_CAP', 'VA_LATE_FEE_CAP', 'VA_ROUTINE_MAINTENANCE_NOTICE_72H']);
    expect(violations('clean')).toEqual([]);
    expect(violations('clean-alt')).toEqual([]);
  });
});

describe('lease-synthetic scoring', () => {
  const planted = byId('planted');
  const perfect = planted.expected.map((e) => {
    const plant = Object.values(PLANTS).find((p) => p.ruleId === e.ruleId)!;
    return finding(planted.text, e.ruleId, plant.text.planted, { severity: e.severity });
  });

  it('finds each plant by rule and section', () => {
    expect(headingAt(planted.text, perfect[0]!)).toBe(planted.expected[0]!.heading);
    const s = scoreLease(planted, analyzed(perfect));
    expect(s).toMatchObject({ tp: 8, fp: 0, fn: 0, severityRight: 8, missed: [], wrongSeverity: [] });
  });

  it('counts info findings as not flagged, and a planted rule on the wrong clause as a miss and a false alarm', () => {
    const wrongClause = finding(planted.text, 'VA_NO_RIGHTS_WAIVER', 'Tenant shall not paint, wallpaper, install fixtures');
    const info = finding(planted.text, 'VA_NO_RETALIATION', 'Quiet hours are from 10:00 p.m. to 7:00 a.m.', { severity: 'info' });
    const rest = perfect.filter((f) => f.ruleId !== 'VA_NO_RIGHTS_WAIVER');
    const s = scoreLease(planted, analyzed([...rest, wrongClause, info]));
    expect(s).toMatchObject({ tp: 7, fp: 1, fn: 1, missed: ['VA_NO_RIGHTS_WAIVER'] });
  });

  it('gates recall at 0.9 and precision at 0.85 over the three leases', () => {
    const clean = byId('clean');
    const falseAlarm = finding(clean.text, 'VA_NO_REPAIR_FEES', 'There is no fee for a repair request');
    const sevenOfEight = perfect.slice(1);
    // 8/8 found, 1 false alarm: precision 8/9 = 0.889.
    expect(summarize([scoreLease(planted, analyzed(perfect)), scoreLease(clean, analyzed([falseAlarm]))]).pass).toBe(true);
    // 7/8 found: recall 0.875.
    expect(summarize([scoreLease(planted, analyzed(sevenOfEight))]).pass).toBe(false);
    // 2 false alarms: precision 8/10.
    expect(summarize([scoreLease(planted, analyzed(perfect)), scoreLease(clean, analyzed([falseAlarm, { ...falseAlarm, id: 'f2' }]))]).pass).toBe(false);
    // A lease that was not analyzed fails the set.
    expect(summarize([scoreLease(planted, analyzed(perfect)), scoreLease(clean, null)]).pass).toBe(false);
  });

  it('reports a plant found at the wrong severity', () => {
    const s = scoreLease(planted, analyzed(perfect.map((f) => (f.ruleId === 'VA_NO_RIGHTS_WAIVER' ? { ...f, severity: 'ask' as const } : f))));
    expect(s).toMatchObject({ tp: 8, severityRight: 7, wrongSeverity: ['VA_NO_RIGHTS_WAIVER unenforceable->ask'] });
  });
});

describe('clauses-golden set', () => {
  const cases = loadGoldenCases();

  it('has 60 excerpts, including the five semantic rules planted in the synthetic lease', () => {
    expect(cases).toHaveLength(60);
    for (const ruleId of ['VA_NO_RIGHTS_WAIVER', 'VA_NO_CONFESSION_OF_JUDGMENT', 'VA_NO_EXCULPATION_INDEMNITY', 'VA_NO_LANDLORD_ATTORNEY_FEES', 'VA_LANDLORD_MAINTAIN_FIT']) {
      expect(cases.filter((c) => c.ruleId === ruleId && c.expected === 'match'), ruleId).toHaveLength(2);
      expect(cases.filter((c) => c.ruleId === ruleId && c.expected === 'no_match'), ruleId).toHaveLength(1);
    }
  });

  it('places every excerpt in one document at its offsets', () => {
    const { text, clauses } = goldenDocument(cases);
    for (const c of clauses) expect(text.slice(c.start, c.end)).toBe(c.verbatim);
  });

  it('scores per rule: a flagged match is a TP, a flagged look-alike an FP, other rules are not scored', () => {
    const { text } = goldenDocument(cases);
    const match = cases.find((c) => c.id === 'VA_NO_RIGHTS_WAIVER-01')!;
    const lookalike = cases.find((c) => c.id === 'VA_NO_RIGHTS_WAIVER-03')!;
    const findings = [
      finding(text, match.ruleId, match.text, { clauseId: match.id, verifier: { verdict: 'agree', assessment: 'violates', reasoning: '', model: 'gemma-4-31b-it', fallback: false } }),
      finding(text, lookalike.ruleId, lookalike.text, { clauseId: lookalike.id, severity: 'ask', verifier: { verdict: 'disagree', assessment: 'complies', reasoning: '', model: 'gemma-4-31b-it', fallback: false } }),
      finding(text, 'VA_NO_RETALIATION', match.text, { clauseId: match.id, severity: 'ask' }),
    ];
    const s = scoreGolden(cases, findings);
    expect(s.perRule.find((r) => r.ruleId === 'VA_NO_RIGHTS_WAIVER')).toEqual({ ruleId: 'VA_NO_RIGHTS_WAIVER', tp: 1, fn: 1, fp: 1, tn: 0 });
    expect(s.rows.find((r) => r.id === match.id)?.otherRules).toEqual(['VA_NO_RETALIATION']);
    expect(s.verifierAgreeOnViolations).toEqual({ agree: 1, of: 1 });
    expect(s.verifierAgreeOnLookalikes).toEqual({ agree: 0, of: 1 });
  });
});

describe('citations gate', () => {
  const lease = byId('planted').text;
  const good = finding(lease, 'VA_NO_RIGHTS_WAIVER', PLANTS.waiver.text.planted);
  const run = (findings: Finding[], text = lease) => checkCitations([{ set: 'test', id: 'x', text, findings }], PACK, PACK_DIR);

  it('passes findings whose lease and statute quotes resolve, including every version of a rule that changes mid-term', () => {
    const lateFee = PACK.byId.get('VA_LATE_FEE_CAP')!;
    const twoVersions = finding(lease, 'VA_LATE_FEE_CAP', PLANTS.lateFee.text.planted, {
      basis: 'check',
      versions: lateFee.versions.map((version) => ({ version, from: version.effectiveFrom, until: version.effectiveUntil })),
    });
    const notCovered = finding(lease, null, 'Quiet hours are from 10:00 p.m. to 7:00 a.m.', { severity: 'info', primaryAssessment: 'not_covered' });
    expect(run([good, twoVersions, notCovered])).toMatchObject({ findings: 3, resolved: 3, rate: 1, pass: true, failures: [] });
  });

  it('fails a lease quote that is not the lease text at its span', () => {
    const moved = { ...good, quoteSpan: { start: good.quoteSpan!.start + 1, end: good.quoteSpan!.end + 1 } };
    const reworded = { ...good, leaseQuote: good.leaseQuote!.replace('waives', 'gives up') };
    const r = run([moved, reworded, { ...good, leaseQuote: null, quoteSpan: null }]);
    expect(r.pass).toBe(false);
    expect(r.failures.map((f) => f.problem)).toEqual(['lease quote is not the lease text at its span', 'lease quote is not the lease text at its span', 'no lease quote']);
  });

  it('fails a statute quote, citation, or version that is not the pack and its snapshot', () => {
    const v = good.versions[0]!;
    const editedQuote = { ...v, version: { ...v.version, statuteQuote: `${v.version.statuteQuote} entirely` } };
    const r = run([
      { ...good, statuteQuote: 'Tenants may waive any right.' },
      { ...good, citation: 'Va. Code § 55.1-9999' },
      { ...good, versions: [editedQuote], statuteQuote: editedQuote.version.statuteQuote },
      { ...good, versions: [], statuteQuote: null },
      { ...good, ruleId: 'VA_MADE_UP' },
    ]);
    expect(r.resolved).toBe(0);
    expect(r.failures.map((f) => f.problem)).toEqual([
      "statute quote is not the first version's",
      'citation differs from the pack',
      `version from ${v.version.effectiveFrom} is not in the pack`,
      expect.stringMatching(/^statute quote not verbatim in snapshots\//),
      'no rule version',
      'rule not in the pack',
    ]);
  });

  it('passes an absence finding only when the wording is really missing', () => {
    const withoutStatement = lease.replace(/Tenant Rights and Responsibilities/g, 'tenant handbook');
    const absence = finding(withoutStatement, 'VA_TENANT_RIGHTS_STATEMENT', null, { basis: 'absence', severity: 'ask' });
    expect(run([absence], withoutStatement).pass).toBe(true);
    expect(run([absence], lease).failures.map((f) => f.problem)).toEqual(['required wording is in the lease']);
  });

  it('fails a not_covered finding that carries a citation, and a run with no findings', () => {
    const r = run([{ ...finding(lease, null, 'Quiet hours are from 10:00 p.m. to 7:00 a.m.'), citation: 'Va. Code § 55.1-1208(A)(1)' }]);
    expect(r.failures.map((f) => f.problem)).toEqual(['no rule, but a citation or statute quote']);
    expect(run([])).toMatchObject({ findings: 0, rate: null, pass: false });
  });
});

