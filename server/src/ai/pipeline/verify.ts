// S6 (spec §7.3): mechanical verification of S5's answers. For each mapping:
// the clause exists in the batch, its leaseQuote is inside that clause, and
// every rule it cites exists in the pack and has a version in force during
// the lease term. Claims that fail are dropped, never repaired.

import type { ResolvedRule } from '../../rules/resolve.js';
import type { RulePack } from '../../rules/types.js';
import type { Mapping } from '../schemas/lease.js';
import { locateQuote } from './quotes.js';
import type { CheckResultForLease, Clause, Drop, RuleInForce, VerifiedMapping } from './types.js';

export interface VerifyContext {
  // The clauses this batch sent, by id.
  clauses: ReadonlyMap<string, Clause>;
  pack: RulePack;
  // Rules with a version in force during the term (resolveRules).
  inForce: ReadonlyMap<string, ResolvedRule>;
  // S4's answers: a check that ran is authoritative for its rule.
  checks: readonly CheckResultForLease[];
  model: string;
  fallback: boolean;
}

export function verifyMappings(mappings: readonly Mapping[], ctx: VerifyContext, drops: Drop[]): VerifiedMapping[] {
  const decided = new Set(ctx.checks.filter((c) => c.outcome !== 'insufficient_input').map((c) => c.ruleId));
  const verified: VerifiedMapping[] = [];
  const seen = new Set<string>();

  for (const mapping of mappings) {
    const clause = ctx.clauses.get(mapping.clauseId);
    if (!clause) {
      drops.push({ stage: 'S6', reason: 'unknown_clause' });
      continue;
    }
    const span = locateQuote(clause.verbatim, mapping.leaseQuote);
    if (!span) {
      drops.push({ stage: 'S6', reason: 'lease_quote_not_in_clause', ref: clause.id });
      continue;
    }

    // not_covered makes no legal claim, so it cites no rule; one per clause.
    if (mapping.assessment === 'not_covered') {
      const key = `${clause.id}:`;
      if (seen.has(key)) {
        drops.push({ stage: 'S6', reason: 'duplicate_mapping', ref: clause.id });
        continue;
      }
      seen.add(key);
    }

    const rules: RuleInForce[] = [];
    for (const ruleId of mapping.assessment === 'not_covered' ? [] : new Set(mapping.ruleIds)) {
      if (!ctx.pack.byId.has(ruleId)) {
        drops.push({ stage: 'S6', reason: 'unknown_rule', ref: ruleId });
        continue;
      }
      const resolved = ctx.inForce.get(ruleId);
      if (!resolved) {
        drops.push({ stage: 'S6', reason: 'rule_not_in_force', ref: ruleId });
        continue;
      }
      if (decided.has(ruleId)) {
        drops.push({ stage: 'S6', reason: 'superseded_by_check', ref: ruleId });
        continue;
      }
      const key = `${clause.id}:${ruleId}`;
      if (seen.has(key)) {
        drops.push({ stage: 'S6', reason: 'duplicate_mapping', ref: ruleId });
        continue;
      }
      seen.add(key);
      rules.push({ ruleId, versions: resolved.versions, changes: resolved.changes });
    }
    if (mapping.assessment !== 'not_covered' && rules.length === 0) {
      drops.push({ stage: 'S6', reason: 'no_rule_left', ref: clause.id });
      continue;
    }

    const start = clause.start + span.start;
    const end = clause.start + span.end;
    verified.push({
      clauseId: clause.id,
      assessment: mapping.assessment,
      leaseQuote: clause.verbatim.slice(span.start, span.end),
      quoteSpan: { start, end },
      reasoning: mapping.reasoning.trim(),
      rules,
      model: ctx.model,
      fallback: ctx.fallback,
    });
  }
  return verified;
}
