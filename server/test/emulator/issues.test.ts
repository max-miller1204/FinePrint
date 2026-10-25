import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import type { GemmaClient } from '../../src/ai/gemma.js';
import { GEMMA_26B } from '../../src/ai/models.js';
import { createTriage } from '../../src/ai/triage/index.js';
import { keywordBackstop } from '../../src/ai/triage/keywords.js';
import { createApp } from '../../src/app.js';
import { firebaseApp } from '../../src/firebase.js';

// Runs under `pnpm test:emulator`. The real Firestore store end to end: the
// check reads the newest analyzed lease's clauses and writes the issue. The
// model is a fake, so the run needs no key.

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

async function signUpAnonymously(): Promise<{ idToken: string }> {
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signUp: ${res.status}`);
  return res.json() as Promise<{ idToken: string }>;
}

const CLAUSE = '7. REPAIRS. Landlord shall keep the heating system in good repair.';

// Cites the clause, so the answer only survives if the store returned it.
const gemma: GemmaClient = {
  async generate(_stage, schema) {
    const data = schema.parse({
      verdict: 'likely_landlord',
      category: 'landlord_maintenance',
      confidence: 'medium',
      reasons: [{ text: 'Your lease says the landlord keeps the heat in repair.', citation: { kind: 'lease', ref: 'lease.c7', quote: 'keep the heating system in good repair' } }],
      whatWouldChange: ['If you broke it, it would likely be yours to fix.'],
      escrowEligibleCondition: true,
    });
    return { data, model: GEMMA_26B, fallback: false, promptTokens: 1, outputTokens: 1 };
  },
};

describe.runIf(authHost && process.env.FIRESTORE_EMULATOR_HOST)('issues against the emulators', () => {
  const app = createApp({ logSink: () => {}, gemma, triage: createTriage({ model: null, keywords: keywordBackstop() }) });
  const db = () => getFirestore(firebaseApp());
  const send = (path: string, idToken: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // The first Firestore calls of a file wait for the emulator to warm up,
  // which can pass the 5 s default on a busy machine.
  it('cites the newest analyzed lease and stores the issue', { timeout: 20_000 }, async () => {
    const { idToken } = await signUpAnonymously();
    const { id } = await (await send('/v1/rentals', idToken, { jurisdiction: 'VA', city: 'Richmond' })).json();
    const leases = db().collection(`rentals/${id}/leases`);
    const seed = db().batch();
    seed.set(leases.doc('old'), { status: 'analyzed', analyzedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')) });
    seed.set(leases.doc('old').collection('clauses').doc('c7'), { heading: 'REPAIRS', verbatim: 'An older lease.', start: 0, end: 15, order: 0 });
    seed.set(leases.doc('new'), { status: 'analyzed', analyzedAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00Z')) });
    seed.set(leases.doc('new').collection('clauses').doc('c7'), { heading: 'REPAIRS', verbatim: CLAUSE, start: 500, end: 500 + CLAUSE.length, order: 0 });
    // Newer, but not a lease: it is skipped.
    seed.set(leases.doc('menu'), { status: 'not_a_lease', analyzedAt: Timestamp.fromDate(new Date('2026-10-01T00:00:00Z')) });
    // Still being analyzed: no analyzedAt yet, so it is not the newest.
    seed.set(leases.doc('pending'), { status: 'running', analyzedAt: null });
    await seed.commit();

    const res = await send(`/v1/rentals/${id}/issues`, idToken, { description: 'The heater stopped working.' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ leaseId: 'new', verdict: 'likely_landlord', escrowEligible: true });
    expect(body.reasons[0].citation).toEqual({
      kind: 'lease',
      ref: 'c7',
      leaseId: 'new',
      heading: 'REPAIRS',
      quote: 'keep the heating system in good repair',
      quoteSpan: { start: 527, end: 565 },
    });

    const stored = (await db().doc(`rentals/${id}/issues/${body.issueId}`).get()).data();
    expect(stored).toMatchObject({ description: 'The heater stopped working.', verdict: 'likely_landlord', leaseId: 'new', photos: [] });
    expect(stored?.createdAt).toBeInstanceOf(Timestamp);
  });
});
