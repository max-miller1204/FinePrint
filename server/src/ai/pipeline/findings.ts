// From S4, S6, and S7 to findings (spec §7.3, §6.1). Each S4 violation, each
// missing required wording, and each rule of each kept S5 mapping becomes one
// draft; once S7 has answered, the severity table decides each severity and
// the drafts are sorted and numbered. S8 and S9 add the words.

import type { Rule, RulePack, Severity } from '../../rules/types.js';
import type { AbsenceResult } from './checks.js';
import { SEVERITY_RANK, severityFor } from './severity.js';
import type { CheckResultForLease, Finding, KeyTerm, RuleInForce, VerifiedMapping, VerifierResult } from './types.js';

// Everything a finding has before S8 writes its words.
export type Draft = Omit<Finding, 'id' | 'severity' | 'titleEn' | 'explanationEn' | 'actionEn' | 'readability' | 'translations'> & {
  // The rule, for S8's facts and the action text; null when no rule covers the clause.
  rule: Rule | null;
};

export type Ranked = Draft & { id: string; severity: Severity };

// The key a draft is verified under: one clause against one rule.
export const pairKey = (clauseId: string, ruleId: string) => `${clauseId}:${ruleId}`;

export const UNVERIFIED: VerifierResult = { verdict: 'unverified', assessment: null, reasoning: null, model: null, fallback: false };

function ruleFields(rule: Rule, inForce: RuleInForce) {
  return {
    ruleId: rule.id,
    citation: rule.citation,
    sourceUrl: rule.sourceUrl,
    checkType: rule.checkType,
    versions: inForce.versions,
    changes: inForce.changes,
    statuteQuote: inForce.versions[0]?.version.statuteQuote ?? null,
    rule,
  };
}

export function draftFindings(
  pack: RulePack,
  checks: readonly CheckResultForLease[],
  absences: readonly AbsenceResult[],
  mappings: readonly VerifiedMapping[],
  keyTerms: readonly KeyTerm[],
): Draft[] {
  const drafts: Draft[] = [];
  const terms = new Map(keyTerms.map((t) => [t.name as string, t]));

  for (const check of checks) {
    if (check.outcome !== 'violates') continue;
    const rule = pack.byId.get(check.ruleId);
    // The first key term the rule reads (the fee, the deposit, the notice) is
    // what the tenant sees quoted; the rent it is measured against is not.
    const term = check.keyTerms.map((name) => terms.get(name)).find(Boolean);
    if (!rule || !term) continue;
    drafts.push({
      ...ruleFields(rule, check),
      basis: 'check',
      clauseId: term.clauseId,
      leaseQuote: term.quote,
      quoteSpan: term.quoteSpan,
      primaryAssessment: 'violates',
      primaryModel: null,
      primaryFallback: false,
      verifier: null,
      check: check.limit !== undefined && check.actual !== undefined ? { limit: check.limit, actual: check.actual, unit: check.unit } : null,
    });
  }

  for (const absence of absences) {
    const rule = pack.byId.get(absence.ruleId);
    if (!rule) continue;
    drafts.push({
      ...ruleFields(rule, absence),
      basis: 'absence',
      clauseId: null,
      leaseQuote: null,
      quoteSpan: null,
      primaryAssessment: 'violates',
      primaryModel: null,
      primaryFallback: false,
      verifier: null,
      check: null,
    });
  }

  for (const m of mappings) {
    const common = {
      basis: 'mapping' as const,
      clauseId: m.clauseId,
      leaseQuote: m.leaseQuote,
      quoteSpan: m.quoteSpan,
      primaryAssessment: m.assessment,
      primaryModel: m.model,
      primaryFallback: m.fallback,
      verifier: null,
      check: null,
    };
    if (m.assessment === 'not_covered') {
      drafts.push({
        ...common,
        ruleId: null,
        citation: null,
        sourceUrl: null,
        checkType: null,
        versions: [],
        changes: [],
        statuteQuote: null,
        rule: null,
      });
      continue;
    }
    for (const inForce of m.rules) {
      const rule = pack.byId.get(inForce.ruleId);
      if (rule) drafts.push({ ...common, ...ruleFields(rule, inForce) });
    }
  }
  return drafts;
}

// The drafts S7 checks: S5 `violates` only (the table needs no verifier for
// anything else, and S4 and absence findings are code).
export function needsVerifier(d: Draft): d is Draft & { clauseId: string; ruleId: string } {
  return d.basis === 'mapping' && d.primaryAssessment === 'violates' && d.clauseId !== null && d.ruleId !== null;
}

// Applies S7's answers and the severity table, then sorts by severity and
// lease position (a finding with no quote last) and numbers them f1, f2, ...
export function rankFindings(drafts: readonly Draft[], verdicts: ReadonlyMap<string, VerifierResult>): Ranked[] {
  const withSeverity = drafts.map((d) => {
    const verifier = needsVerifier(d) ? (verdicts.get(pairKey(d.clauseId, d.ruleId)) ?? UNVERIFIED) : null;
    const severity = severityFor({
      basis: d.basis,
      assessment: d.primaryAssessment,
      verdict: verifier?.verdict ?? null,
      cap: d.rule?.severityIfViolated ?? null,
    });
    return { ...d, verifier, severity };
  });
  withSeverity.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.quoteSpan?.start ?? Number.MAX_SAFE_INTEGER) - (b.quoteSpan?.start ?? Number.MAX_SAFE_INTEGER) ||
      (a.ruleId ?? '').localeCompare(b.ruleId ?? ''),
  );
  return withSeverity.map((d, i) => ({ ...d, id: `f${i + 1}` }));
}
