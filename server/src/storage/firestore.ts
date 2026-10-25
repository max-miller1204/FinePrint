import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { AuthUser } from '../auth.js';
import { firebaseApp } from '../firebase.js';
import { Rental } from '../models/rental.js';
import { User } from '../models/user.js';

// The API is the only reader and writer of Firestore (spec §9.2). Routes go
// through this interface, so unit tests can swap in an in-memory store.
export interface Store {
  // Creates the rental and, on the user's first rental, `users/{uid}`.
  // `build` gets the new rental's id.
  createRental(owner: AuthUser, build: (id: string) => Rental): Promise<Rental>;
  // Reads the rental, passes it to `change`, and writes the result, all in
  // one transaction. `change` may throw to abort; the error is rethrown.
  // Resolves null when there is no such rental.
  updateRental(id: string, change: (current: Rental) => Rental): Promise<Rental | null>;
}

// Firestore document ids: no `/`, not `.` or `..`, not `__reserved__`.
// Anything else in a URL is not one of our ids.
export function isDocumentId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) && !/^__.*__$/.test(id);
}

// Under FIRESTORE_EMULATOR_HOST, firebase-admin talks to the emulator. The
// default connects on first use, so building the app needs no project.
export function firestoreStore(connect: () => Firestore = () => getFirestore(firebaseApp())): Store {
  let db: Firestore | undefined;
  const collections = () => {
    db ??= connect();
    return { db, rentals: db.collection('rentals'), users: db.collection('users') };
  };

  return {
    async createRental(owner, build) {
      const { db, rentals, users } = collections();
      const ref = rentals.doc();
      const rental = Rental.parse(build(ref.id));
      await db.runTransaction(async (tx) => {
        const userRef = users.doc(owner.uid);
        const user = await tx.get(userRef);
        if (!user.exists) {
          const { uid: _, ...fields } = User.parse({
            uid: owner.uid,
            createdAt: rental.createdAt,
            authProvider: owner.provider,
            locale: null,
            readingLevel: null,
            impactOptIn: false,
          });
          tx.create(userRef, toFirestore(fields));
        } else if (user.get('authProvider') !== owner.provider) {
          // An anonymous account that linked Sign in with Apple.
          tx.update(userRef, { authProvider: owner.provider });
        }
        tx.create(ref, toFirestore(withoutId(rental)));
      });
      return rental;
    },

    async updateRental(id, change) {
      const { db, rentals } = collections();
      const ref = rentals.doc(id);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const next = Rental.parse(change(fromFirestore(id, snapshot.data()!)));
        tx.set(ref, toFirestore(withoutId(next)));
        return next;
      });
    },
  };
}

// gRPC UNAVAILABLE and DEADLINE_EXCEEDED: Firestore did not answer, as
// opposed to refusing the request.
export function isUnavailable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 14 || code === 4;
}

function withoutId({ id: _, ...fields }: Rental) {
  return fields;
}

// Dates are stored as Timestamps, which a TTL policy on `purgeAfter` needs.
function toFirestore(fields: Record<string, unknown>): DocumentData {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value instanceof Date ? Timestamp.fromDate(value) : value]));
}

function fromFirestore(id: string, data: DocumentData): Rental {
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]));
  return Rental.parse({ ...fields, id });
}
