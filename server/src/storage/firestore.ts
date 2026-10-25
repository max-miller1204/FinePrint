import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { AuthUser } from '../auth.js';
import { firebaseApp } from '../firebase.js';
import { LedgerEntry, type LedgerHead } from '../integrity/ledger.js';
import { Manifest } from '../integrity/manifest.js';
import { Evidence, type EvidenceSession } from '../models/evidence.js';
import { Issue } from '../models/issue.js';
import { LeaseClause, type AnalyzedLease } from '../models/lease.js';
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
  // Null when there is no such rental.
  getRental(id: string): Promise<Rental | null>;
  // `rentals/{rentalId}/evidence/{itemId}` for each id, in order; null for
  // an id with no item.
  getEvidence(rentalId: string, itemIds: string[]): Promise<(Evidence | null)[]>;
  // Creates the items in one atomic batch. Rejects if any already exists, so
  // a concurrent create of the same id loses instead of overwriting.
  createEvidence(rentalId: string, items: Evidence[]): Promise<void>;
  // Sets `receivedAtServer` unless it is already set, and returns the item.
  // Null when there is no such item.
  markEvidenceReceived(rentalId: string, itemId: string, at: Date): Promise<Evidence | null>;
  // Every item of one session, deleted ones included.
  listEvidence(rentalId: string, session: EvidenceSession): Promise<Evidence[]>;
  // The ledger in `seq` order.
  listLedger(rentalId: string): Promise<LedgerEntry[]>;
  // Null when there is no such manifest.
  getManifest(rentalId: string, manifestId: string): Promise<Manifest | null>;
  // Appends one ledger entry in a transaction. `build` gets the current
  // head (null for an empty ledger) and returns the entry plus the writes
  // that land with it. A concurrent append makes the transaction retry, so
  // `build` may run more than once and must not write anything itself.
  appendLedger(rentalId: string, build: (head: LedgerHead | null) => Promise<LedgerAppend>): Promise<LedgerAppend>;
  // The newest analyzed lease (`analyzedAt`) with its clauses in lease
  // order. Null when no lease was analyzed. The lease route (#16) writes them.
  latestLease(rentalId: string): Promise<AnalyzedLease | null>;
  // Creates `rentals/{rentalId}/issues/{issue.id}`.
  createIssue(rentalId: string, issue: Issue): Promise<void>;
  // The ids of every rental the user owns.
  rentalIdsOwnedBy(uid: string): Promise<string[]>;
  // Up to `limit` ids of rentals whose `purgeAfter` is at or before `now`.
  // A rental with no `purgeAfter` is never listed.
  expiredRentalIds(now: Date, limit: number): Promise<string[]>;
  // Deletes the rental and everything under it (evidence, ledger, manifests,
  // and the rest), plus every share link that points at it. Returns how many
  // evidence items it held. Deleting a rental that is gone changes nothing.
  deleteRental(rentalId: string): Promise<{ evidenceItems: number }>;
  // Deletes `users/{uid}`. Nothing changes if there is none.
  deleteUser(uid: string): Promise<void>;
}

export interface LedgerAppend {
  entry: LedgerEntry;
  manifest?: Manifest;
  // Fields set on items, in the same transaction.
  items?: { itemId: string; fields: Partial<Pick<Evidence, 'sealedManifestId' | 'deletedAt'>> }[];
}

// Ledger document ids sort in `seq` order.
export const ledgerDocId = (seq: number) => String(seq).padStart(10, '0');

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
  const evidence = (rentalId: string) => collections().rentals.doc(rentalId).collection('evidence');
  const ledger = (rentalId: string) => collections().rentals.doc(rentalId).collection('ledger');
  const manifests = (rentalId: string) => collections().rentals.doc(rentalId).collection('manifests');
  const leases = (rentalId: string) => collections().rentals.doc(rentalId).collection('leases');
  const issues = (rentalId: string) => collections().rentals.doc(rentalId).collection('issues');

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

    async getRental(id) {
      const snapshot = await collections().rentals.doc(id).get();
      return snapshot.exists ? fromFirestore(id, snapshot.data()!) : null;
    },

    async getEvidence(rentalId, itemIds) {
      if (itemIds.length === 0) return [];
      const { db } = collections();
      const snapshots = await db.getAll(...itemIds.map((id) => evidence(rentalId).doc(id)));
      return snapshots.map((snapshot) => (snapshot.exists ? evidenceFromFirestore(snapshot.id, snapshot.data()!) : null));
    },

    async createEvidence(rentalId, items) {
      const { db } = collections();
      const batch = db.batch();
      for (const item of items) {
        const { id, ...fields } = Evidence.parse(item);
        batch.create(evidence(rentalId).doc(id), toFirestore(fields));
      }
      await batch.commit();
    },

    async markEvidenceReceived(rentalId, itemId, at) {
      const { db } = collections();
      const ref = evidence(rentalId).doc(itemId);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const item = evidenceFromFirestore(itemId, snapshot.data()!);
        if (item.receivedAtServer !== null) return item;
        tx.update(ref, { receivedAtServer: Timestamp.fromDate(at) });
        return { ...item, receivedAtServer: at };
      });
    },

    async listEvidence(rentalId, session) {
      const snapshot = await evidence(rentalId).where('session', '==', session).get();
      return snapshot.docs.map((doc) => evidenceFromFirestore(doc.id, doc.data()));
    },

    async listLedger(rentalId) {
      const snapshot = await ledger(rentalId).orderBy('seq').get();
      return snapshot.docs.map((doc) => LedgerEntry.parse(doc.data()));
    },

    async getManifest(rentalId, manifestId) {
      const snapshot = await manifests(rentalId).doc(manifestId).get();
      return snapshot.exists ? Manifest.parse({ ...fromTimestamps(snapshot.data()!), id: manifestId }) : null;
    },

    async appendLedger(rentalId, build) {
      const { db } = collections();
      return db.runTransaction(async (tx) => {
        const last = await tx.get(ledger(rentalId).orderBy('seq', 'desc').limit(1));
        const head = last.empty ? null : LedgerEntry.parse(last.docs[0]!.data());
        const append = await build(head && { seq: head.seq, entryHash: head.entryHash });
        const entry = LedgerEntry.parse(append.entry);
        // `create`, so two appends of the same seq cannot both land.
        tx.create(ledger(rentalId).doc(ledgerDocId(entry.seq)), entry);
        if (append.manifest) {
          const { id, ...fields } = Manifest.parse(append.manifest);
          tx.create(manifests(rentalId).doc(id), toFirestore(fields));
        }
        for (const { itemId, fields } of append.items ?? []) tx.update(evidence(rentalId).doc(itemId), toFirestore(fields));
        return append;
      });
    },

    async latestLease(rentalId) {
      // A lease still being analyzed has no `analyzedAt`, so the order skips it.
      const newest = await leases(rentalId).orderBy('analyzedAt', 'desc').limit(1).get();
      const lease = newest.docs[0];
      if (!lease) return null;
      const snapshot = await lease.ref.collection('clauses').get();
      const clauses = snapshot.docs.map((doc) => LeaseClause.parse({ ...doc.data(), id: doc.id })).sort((a, b) => a.charStart - b.charStart);
      return { id: lease.id, clauses };
    },

    async createIssue(rentalId, issue) {
      const { id, ...fields } = Issue.parse(issue);
      await issues(rentalId).doc(id).create(toFirestore(fields));
    },

    async rentalIdsOwnedBy(uid) {
      const snapshot = await collections().rentals.where('ownerUid', '==', uid).select().get();
      return snapshot.docs.map((doc) => doc.id);
    },

    async expiredRentalIds(now, limit) {
      const snapshot = await collections()
        .rentals.where('purgeAfter', '<=', Timestamp.fromDate(now))
        .orderBy('purgeAfter')
        .limit(limit)
        .select()
        .get();
      return snapshot.docs.map((doc) => doc.id);
    },

    async deleteRental(rentalId) {
      const { db, rentals } = collections();
      const count = await evidence(rentalId).count().get();
      // Shares are top-level (spec §6.1), each with an `access` subcollection.
      const shares = await db.collection('shares').where('rentalId', '==', rentalId).select().get();
      for (const share of shares.docs) await db.recursiveDelete(share.ref);
      await db.recursiveDelete(rentals.doc(rentalId));
      return { evidenceItems: count.data().count };
    },

    async deleteUser(uid) {
      await collections().users.doc(uid).delete();
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

function fromTimestamps(data: DocumentData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]));
}

function fromFirestore(id: string, data: DocumentData): Rental {
  return Rental.parse({ ...fromTimestamps(data), id });
}

function evidenceFromFirestore(id: string, data: DocumentData): Evidence {
  return Evidence.parse({ ...fromTimestamps(data), id });
}
