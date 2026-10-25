import type { Finding } from './ai/pipeline/types.js';
import type { Rental } from './models/rental.js';

export const impactNames = ['tenantsHelped', 'verifiedClausesFlagged', 'moveInReportsWithin5Days', 'depositDollarsCovered'] as const;
export type ImpactTotals = Record<(typeof impactNames)[number], number>;

// Count distinct clauses, not multiple findings on the same clause. Missing
// clauses and model claims without an agreeing verifier are excluded.
export function verifiedClauseCount(findings: Finding[]): number {
  return new Set(findings.filter((f) => f.clauseId && f.ruleId && f.severity === 'unenforceable'
    && (f.basis === 'check' || f.verifier?.verdict === 'agree')).map((f) => f.clauseId)).size;
}

export function moveInImpact(rental: Rental, sealedAt: Date) {
  const days = rental.occupancyDate ? Math.floor((sealedAt.getTime() - Date.parse(rental.occupancyDate)) / 86_400_000) : -1;
  return {
    moveInReportsWithin5Days: days >= 0 && days < 5 ? 1 : 0,
    // Round each deposit down to a $500 bucket before aggregation. No exact
    // deposit value, rental id, or bucket membership is stored in impact/.
    depositDollarsCovered: Math.floor((rental.depositAmount ?? 0) / 500) * 500,
  };
}
