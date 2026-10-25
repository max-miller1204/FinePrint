// S4 (spec §7.3): the pack's deterministic rules, run in code on the lease's
// verified key terms. No model is involved, so a violation found here needs
// no second opinion (severity table: deterministic violation is unenforceable).

import { CHECKS, isCheckName, runCheck, type CheckInputs } from '../../rules/checks.js';
import type { ResolvedRule } from '../../rules/resolve.js';
import type { KeyTermName } from './key-terms.js';
import type { CheckResultForLease, KeyTerm } from './types.js';

export function runDeterministicChecks(resolved: readonly ResolvedRule[], keyTerms: readonly KeyTerm[]): CheckResultForLease[] {
  const byName = new Map(keyTerms.map((term) => [term.name as string, term]));
  const results: CheckResultForLease[] = [];
  for (const { rule, versions, changes } of resolved) {
    if (rule.checkType !== 'deterministic' || !rule.deterministic) continue;
    const { fn, inputs } = rule.deterministic;
    // The loader refuses unknown checks; a pack built some other way gets none.
    if (!isCheckName(fn)) continue;
    const values: Record<string, number | undefined> = {};
    const used: KeyTerm[] = [];
    for (const input of inputs) {
      const term = byName.get(input);
      if (term?.amount == null) continue;
      values[input] = term.amount;
      used.push(term);
    }
    const result = runCheck(fn, values as CheckInputs);
    results.push({
      ruleId: rule.id,
      versions,
      changes,
      fn,
      outcome: result.outcome,
      unit: CHECKS[fn].unit,
      ...(result.limit !== undefined ? { limit: result.limit } : {}),
      ...(result.actual !== undefined ? { actual: result.actual } : {}),
      keyTerms: used.map((term) => term.name as KeyTermName),
      clauseIds: [...new Set(used.map((term) => term.clauseId))],
    });
  }
  return results;
}
