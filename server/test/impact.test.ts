import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/ai/pipeline/types.js';
import { moveInImpact, verifiedClauseCount } from '../src/impact.js';
import type { Rental } from '../src/models/rental.js';
describe('impact eligibility', () => {
  it('counts distinct verified clauses and excludes unsupported claims', () => {
    const f = { clauseId: 'c1', ruleId: 'rule', severity: 'unenforceable', basis: 'mapping', verifier: { verdict: 'agree' } } as Finding;
    expect(verifiedClauseCount([f, f, { ...f, clauseId: 'c2', basis: 'check', verifier: null }, { ...f, clauseId: 'c3', verifier: null }, { ...f, clauseId: null }, { ...f, clauseId: 'c4', severity: 'ask' }])).toBe(2);
  });
  it('uses calendar days and rounds deposits down before aggregation', () => {
    const rental = { occupancyDate: '2026-08-01', depositAmount: 1499.99 } as Rental;
    expect(moveInImpact(rental, new Date('2026-08-05T23:59:59Z'))).toEqual({ moveInReportsWithin5Days: 1, depositDollarsCovered: 1000 });
    for (const date of ['2026-07-31', '2026-08-06']) expect(moveInImpact(rental, new Date(date)).moveInReportsWithin5Days).toBe(0);
    expect(moveInImpact({ ...rental, occupancyDate: null, depositAmount: null }, new Date())).toEqual({ moveInReportsWithin5Days: 0, depositDollarsCovered: 0 });
  });
});
