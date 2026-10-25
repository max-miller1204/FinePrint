import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/ai/pipeline/types.js';
import { newLease } from '../../src/models/lease.js';
import { newRental } from '../../src/models/rental.js';
import { firestoreStore } from '../../src/storage/firestore.js';

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST)('impact transactions', () => {
  it('counts analysis once, reads consent, and never backfills opted-out work', async () => {
    const store = firestoreStore();
    const owner = { uid: randomUUID(), provider: 'anonymous' as const };
    const rental = await store.createRental(owner, (id) => newRental(id, owner.uid, { jurisdiction: 'VA', city: 'Richmond', phase: 'pre_signing' }, new Date()));
    const finding = { id: 'f1', clauseId: 'c1', ruleId: 'rule', severity: 'unenforceable', basis: 'check', verifier: null } as Finding;
    const create = () => store.createLease(rental.id, (id) => newLease(id, 'VA', { text: 'redacted text', locale: 'en', readingLevel: 'standard' }, new Date()));
    const first = await create();
    const before = await store.getImpact();
    await store.saveLeaseAnalysis(rental.id, { ...first, status: 'analyzed', analyzedAt: new Date() }, [], [finding]);
    expect(await store.getImpact()).toEqual(before);
    await store.setImpactOptIn(owner, true);
    await store.saveLeaseAnalysis(rental.id, { ...first, status: 'analyzed', analyzedAt: new Date() }, [], [finding]);
    expect((await store.getImpact()).verifiedClausesFlagged).toBe(before.verifiedClausesFlagged);
    const second = await create();
    await Promise.all([1, 2].map(() => store.saveLeaseAnalysis(rental.id, { ...second, status: 'analyzed', analyzedAt: new Date() }, [], [finding, { ...finding, id: 'f2' }])));
    expect((await store.getImpact()).verifiedClausesFlagged).toBe(before.verifiedClausesFlagged + 1);
    await store.updateRental(rental.id, (r) => ({ ...r, city: 'Norfolk' }));
    await store.updateLease(rental.id, second.id, (l) => l);
    await store.saveLeaseAnalysis(rental.id, { ...second, status: 'analyzed', analyzedAt: new Date() }, [], [finding]);
    expect((await store.getImpact()).verifiedClausesFlagged).toBe(before.verifiedClausesFlagged + 1);
    await store.setImpactOptIn(owner, false);
    const third = await create();
    await store.saveLeaseAnalysis(rental.id, { ...third, status: 'analyzed', analyzedAt: new Date() }, [], [finding]);
    expect((await store.getImpact()).verifiedClausesFlagged).toBe(before.verifiedClausesFlagged + 1);
  });
});
