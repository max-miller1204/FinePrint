import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import type { AuthUser } from '../auth.js';
import { firebaseApp } from '../firebase.js';
import { LedgerEntry, type LedgerHead } from '../integrity/ledger.js';
import { Manifest } from '../integrity/manifest.js';
import type { Clause, Finding } from '../ai/pipeline/types.js';
import { Evidence, type EvidenceSession } from '../models/evidence.js';
import { Issue } from '../models/issue.js';
import { Lease, type AnalyzedLease } from '../models/lease.js';
import { Rental } from '../models/rental.js';
import { impactNames, type ImpactTotals, verifiedClauseCount, moveInImpact } from '../impact.js';
import { User } from '../models/user.js';

// The API is the only reader and writer of Firestore (spec §9.2). Routes go
// through this interface, so unit tests can swap in an in-memory store.
export interface Store {
  setImpactOptIn(owner: AuthUser, optedIn: boolean): Promise<void>;
  getImpact(): Promise<ImpactTotals>;
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
  // The newest lease whose status is `analyzed`, with its clauses in lease
  // order. Null when no lease was analyzed.
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
  // `rentals/{rentalId}/leases/{leaseId}`. `build` gets the new lease's id.
  createLease(rentalId: string, build: (id: string) => Lease): Promise<Lease>;
  // Null when there is no such lease.
  getLease(rentalId: string, leaseId: string): Promise<Lease | null>;
  // Like updateRental: one transaction, and `change` may throw to abort.
  updateLease(rentalId: string, leaseId: string, change: (current: Lease) => Lease): Promise<Lease | null>;
  // Writes the finished lease with its clauses and findings in one batch,
  // replacing any clauses and findings it had.
  saveLeaseAnalysis(rentalId: string, lease: Lease, clauses: Clause[], findings: Finding[]): Promise<void>;
  listAskLeases(rentalId: string): Promise<Lease[]>;
  // In lease order and display order.
  getLeaseResults(rentalId: string, leaseId: string): Promise<{ clauses: Clause[]; findings: Finding[] }>;
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

  const increment = (tx: FirebaseFirestore.Transaction, name: string, value: number) => {
    if (value > 0) tx.set(collections().db.collection('impact').doc(name), { value: FieldValue.increment(value) }, { merge: true });
  };
  return {
    async getImpact() {
      const snapshots = await collections().db.getAll(...impactNames.map((name) => collections().db.collection('impact').doc(name)));
      return Object.fromEntries(snapshots.map((doc, i) => [impactNames[i], doc.get('value') ?? 0])) as ImpactTotals;
    },
    async setImpactOptIn(owner, optedIn) {
      const { db, users } = collections();
      await db.runTransaction(async (tx) => {
        const ref = users.doc(owner.uid);
        const user = await tx.get(ref);
        const counted = user.get('impactCounted') === true;
        tx.set(ref, user.exists ? { impactOptIn: optedIn, impactCounted: counted || optedIn } : {
          createdAt: Timestamp.now(), authProvider: owner.provider, locale: null, readingLevel: null,
          impactOptIn: optedIn, impactCounted: optedIn,
        }, { merge: true });
        if (optedIn && !counted) increment(tx, 'tenantsHelped', 1);
      });
    },
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
        tx.set(ref, toFirestore(withoutId(next)), { merge: true });
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
        const rentalRef = collections().rentals.doc(rentalId);
        const rental = await tx.get(rentalRef);
        const user = await tx.get(collections().users.doc(rental.get('ownerUid')));
        const priorMoveIn = append.manifest?.kind === 'move_in'
          ? await tx.get(manifests(rentalId).where('kind', '==', 'move_in').limit(1)) : null;
        if (append.manifest?.kind === 'move_in' && !rental.get('impactMoveInProcessed')) {
          // Record processing even when opted out: no retroactive counting.
          tx.update(rentalRef, { impactMoveInProcessed: true });
          if (user.get('impactOptIn') === true && priorMoveIn?.empty) {
            const totals = moveInImpact(fromFirestore(rentalId, rental.data()!), append.manifest.sealedAt);
            increment(tx, 'moveInReportsWithin5Days', totals.moveInReportsWithin5Days);
            increment(tx, 'depositDollarsCovered', totals.depositDollarsCovered);
          }
        }
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
      // Escalated and not-a-lease results have an `analyzedAt` too, so the
      // newest few are checked for one that was analyzed.
      const newest = await leases(rentalId).orderBy('analyzedAt', 'desc').limit(10).get();
      const lease = newest.docs.find((doc) => doc.get('status') === 'analyzed');
      if (!lease) return null;
      const snapshot = await lease.ref.collection('clauses').orderBy('order').get();
      const clauses = snapshot.docs.map((doc) => {
        const { order: _, ...fields } = doc.data();
        return { ...fields, id: doc.id } as Clause;
      });
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

    async createLease(rentalId, build) {
      const ref = leases(rentalId).doc();
      const lease = Lease.parse(build(ref.id));
      await ref.create(leaseToFirestore(lease));
      return lease;
    },

    async getLease(rentalId, leaseId) {
      const snapshot = await leases(rentalId).doc(leaseId).get();
      return snapshot.exists ? leaseFromFirestore(leaseId, snapshot.data()!) : null;
    },

    async updateLease(rentalId, leaseId, change) {
      const { db } = collections();
      const ref = leases(rentalId).doc(leaseId);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const next = Lease.parse(change(leaseFromFirestore(leaseId, snapshot.data()!)));
        tx.set(ref, leaseToFirestore(next), { merge: true });
        return next;
      });
    },

    async saveLeaseAnalysis(rentalId, lease, clauses, findings) {
      const { db } = collections();
      const ref = leases(rentalId).doc(lease.id);
      // Analysis and aggregate changes commit together. Consent is read in the
      // same transaction, so an opt-out racing completion causes a retry.
      await db.runTransaction(async (tx) => {
        const previous = await tx.get(ref);
        const oldClauses = await tx.get(ref.collection('clauses').select());
        const oldFindings = await tx.get(ref.collection('findings').select());
        const rental = await tx.get(collections().rentals.doc(rentalId));
        const user = await tx.get(collections().users.doc(rental.get('ownerUid')));
        for (const doc of [...oldClauses.docs, ...oldFindings.docs]) tx.delete(doc.ref);
        for (const [order, { id, ...fields }] of clauses.entries()) tx.set(ref.collection('clauses').doc(id), plain({ ...fields, order }));
        for (const [order, { id, ...fields }] of findings.entries()) tx.set(ref.collection('findings').doc(id), plain({ ...fields, order }));
        if (!previous.get('impactProcessed') && !previous.get('analyzedAt') && user.get('impactOptIn') === true) {
          increment(tx, 'verifiedClausesFlagged', verifiedClauseCount(findings));
        }
        tx.set(ref, { ...leaseToFirestore(Lease.parse(lease)), impactProcessed: true });
      });
    },

    async listAskLeases(rentalId) {
      const snapshot = await leases(rentalId).where('status', '==', 'analyzed').limit(10).get();
      return snapshot.docs.map(doc => leaseFromFirestore(doc.id, doc.data()));
    },

    async getLeaseResults(rentalId, leaseId) {
      const ref = leases(rentalId).doc(leaseId);
      const [clauses, findings] = await Promise.all([ref.collection('clauses').orderBy('order').get(), ref.collection('findings').orderBy('order').get()]);
      const read = <T>(doc: { id: string; data(): DocumentData }) => {
        const { order: _, ...fields } = doc.data();
        return { ...fields, id: doc.id } as T;
      };
      return { clauses: clauses.docs.map((doc) => read<Clause>(doc)), findings: findings.docs.map((doc) => read<Finding>(doc)) };
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

// Firestore refuses `undefined`; the pipeline's objects are plain JSON otherwise.
function plain(value: Record<string, unknown>): DocumentData {
  return JSON.parse(JSON.stringify(value));
}

function leaseToFirestore({ id: _, ...fields }: Lease): DocumentData {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      value instanceof Date ? Timestamp.fromDate(value) : value === null || typeof value !== 'object' ? value : JSON.parse(JSON.stringify(value)),
    ]),
  );
}

function leaseFromFirestore(id: string, data: DocumentData): Lease {
  return Lease.parse({ ...fromTimestamps(data), id });
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
