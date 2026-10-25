import { FieldPath, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { firebaseApp } from '../firebase.js';
import { ApiError } from '../errors.js';
import { LedgerEntry, newLedgerEntry } from '../integrity/ledger.js';
import type { Signer } from '../integrity/kms.js';
import { ledgerDocId } from '../storage/firestore.js';

export interface Share {
  id: string;
  rentalId: string;
  scope: ('lease' | 'evidence')[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  pinHash: string | null;
}
export const active = (share: Share, now = Date.now()) => !share.revokedAt && Date.parse(share.expiresAt) > now;
export const shareJson = (s: Share) => ({ id: s.id, rentalId: s.rentalId, scope: s.scope, createdAt: s.createdAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt, requiresPin: s.pinHash !== null });

// All authorization state is shared across Cloud Run instances. Never store a
// raw capability, PIN, IP, full user agent, or request headers here.
export function shareStore(connect: () => Firestore = () => getFirestore(firebaseApp())) {
  const shares = () => connect().collection('shares');
  return {
    async get(id: string): Promise<Share | null> {
      const doc = await shares().doc(id).get();
      return doc.exists ? { ...doc.data(), id } as Share : null;
    },
    async list(rentalId: string): Promise<Share[]> {
      const docs = await shares().where('rentalId', '==', rentalId).get();
      return docs.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Share).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async change(share: Share, uid: string, signer: Signer, revoke: boolean): Promise<void> {
      const db = connect();
      await db.runTransaction(async tx => {
        const rental = db.collection('rentals').doc(share.rentalId);
        const ref = shares().doc(share.id);
        const [owner, stored, last] = await Promise.all([
          tx.get(rental), tx.get(ref), tx.get(rental.collection('ledger').orderBy('seq', 'desc').limit(1)),
        ]);
        if (!owner.exists || owner.get('ownerUid') !== uid) throw new ApiError(404, 'NOT_FOUND', 'No such rental');
        if (revoke && !stored.exists) throw new ApiError(404, 'NOT_FOUND', 'No such share');
        if (revoke && stored.get('revokedAt')) return;
        const head = last.empty ? null : LedgerEntry.parse(last.docs[0]!.data());
        const at = new Date(revoke ? Date.now() : share.createdAt);
        const entry = await newLedgerEntry(signer, head, revoke ? 'share_revoked' : 'share_created', { shareId: share.id }, at);
        tx.create(rental.collection('ledger').doc(ledgerDocId(entry.seq)), entry);
        if (revoke) tx.update(ref, { revokedAt: at.toISOString() });
        else {
          const { id: _, ...fields } = share;
          tx.create(ref, fields);
        }
      });
    },
    // Reserve the attempt BEFORE doing expensive PIN hashing. A global per-link
    // budget prevents distributed guessing without retaining visitor identifiers.
    async attempt(id: string): Promise<boolean> {
      return connect().runTransaction(async tx => {
        const ref = shares().doc(id);
        const doc = await tx.get(ref);
        if (!doc.exists) return false;
        const now = Date.now();
        const window = Number(doc.get('attemptWindow') ?? 0);
        const count = now - window < 15 * 60_000 ? Number(doc.get('attemptCount') ?? 0) : 0;
        if (count >= 5) return false;
        tx.update(ref, { attemptWindow: count === 0 ? now : window, attemptCount: count + 1 });
        return true;
      });
    },
    async grant(id: string, hash: string) {
      await shares().doc(id).collection('sessions').doc(hash).set({ expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60_000) });
    },
    async granted(id: string, hash: string) {
      const doc = await shares().doc(id).collection('sessions').doc(hash).get();
      return doc.exists && (doc.get('expiresAt') as Timestamp).toMillis() > Date.now();
    },
    async log(id: string, userAgentFamily: string) {
      await shares().doc(id).collection('access').add({ at: new Date().toISOString(), userAgentFamily });
    },
    async access(id: string, before?: { at: string; id: string }) {
      let query = shares().doc(id).collection('access').orderBy('at', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (before) query = query.startAfter(before.at, before.id);
      const docs = await query.limit(100).get();
      return { access: docs.docs.map(doc => ({ at: String(doc.get('at')), userAgentFamily: String(doc.get('userAgentFamily')) })), nextBefore: docs.size === 100 ? `${docs.docs.at(-1)!.get('at')}~${docs.docs.at(-1)!.id}` : null };
    },
    async leases(rentalId: string) {
      const docs = await connect().collection('rentals').doc(rentalId).collection('leases').select('locale').get();
      return docs.docs.map(doc => ({ id: doc.id, locale: String(doc.get('locale') ?? 'en') }));
    },
  };
}
export type Shares = ReturnType<typeof shareStore>;
