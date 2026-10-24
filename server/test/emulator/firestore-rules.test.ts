import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

// Runs under `pnpm test:emulator`, which starts the Firestore emulator and
// sets FIRESTORE_EMULATOR_HOST. Clients must never read or write Firestore
// (spec §9.2): only the API does, through the Admin SDK.

const rules = readFileSync(join(import.meta.dirname, '..', '..', '..', 'firestore.rules'), 'utf8');

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST)('Firestore rules', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-fineprint', firestore: { rules } });
    // Real documents, so a denial is the rules and not a missing doc.
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore();
      await setDoc(doc(db, 'users/alice'), { authProvider: 'anonymous' });
      await setDoc(doc(db, 'rentals/r1'), { ownerUid: 'alice', jurisdiction: 'VA' });
      await setDoc(doc(db, 'rentals/r1/evidence/e1'), { sha256: 'abc' });
      await setDoc(doc(db, 'shares/t1'), { rentalId: 'r1' });
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  const clients = [
    ['a signed-out client', () => env.unauthenticatedContext().firestore()],
    ['the owner, signed in anonymously', () => env.authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous' } }).firestore()],
    ['another signed-in user', () => env.authenticatedContext('mallory').firestore()],
  ] as const;

  describe.each(clients)('%s', (_, client) => {
    it.each(['users/alice', 'rentals/r1', 'rentals/r1/evidence/e1', 'shares/t1', 'impact/leases'])('cannot read %s', async (path) => {
      await assertFails(getDoc(doc(client(), path)));
    });

    it.each(['users', 'rentals', 'shares'])('cannot list %s', async (path) => {
      await assertFails(getDocs(collection(client(), path)));
    });

    it('cannot create, update, or delete', async () => {
      const db = client();
      await assertFails(setDoc(doc(db, 'users/new'), { authProvider: 'anonymous' }));
      await assertFails(setDoc(doc(db, 'rentals/r2'), { ownerUid: 'alice' }));
      await assertFails(updateDoc(doc(db, 'rentals/r1'), { phase: 'ended' }));
      await assertFails(deleteDoc(doc(db, 'rentals/r1/evidence/e1')));
    });
  });
});
