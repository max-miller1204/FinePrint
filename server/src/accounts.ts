import { getAuth } from 'firebase-admin/auth';
import { firebaseApp } from './firebase.js';

// The Firebase users behind the uids (spec §5.2). Routes go through this
// interface, so unit tests can swap in memory.
export interface Accounts {
  // Removes the Firebase user. Nothing changes if it is already gone.
  deleteUser(uid: string): Promise<void>;
}

export function firebaseAccounts(): Accounts {
  return {
    async deleteUser(uid) {
      try {
        await getAuth(firebaseApp()).deleteUser(uid);
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== 'auth/user-not-found') throw err;
      }
    },
  };
}
