import type { Store } from './storage/firestore.js';
import type { EvidenceObjects } from './storage/gcs.js';

// What leaves the server when a rental goes (spec §9.2). One path serves
// both "Delete everything" and the scheduled purge, so they cannot drift.

// Bytes first, then the records: if the second step fails, the rental is
// still listed and the next attempt finishes the job.
export async function removeRental(store: Store, objects: EvidenceObjects, rentalId: string): Promise<{ evidenceItems: number }> {
  await objects.removeRental(rentalId);
  return store.deleteRental(rentalId);
}

export interface Receipt {
  deletedAt: string;
  rentals: number;
  evidenceItems: number;
}

// Everything the user has: each rental with its photos and shares, then the
// user record. The caller deletes the Firebase user last, so a failed run
// can be retried with the same token.
export async function deleteEverything(store: Store, objects: EvidenceObjects, uid: string, now: Date): Promise<Receipt> {
  const ids = await store.rentalIdsOwnedBy(uid);
  let evidenceItems = 0;
  for (const id of ids) evidenceItems += (await removeRental(store, objects, id)).evidenceItems;
  await store.deleteUser(uid);
  return { deletedAt: now.toISOString(), rentals: ids.length, evidenceItems };
}

// Most rentals one run removes. The scheduler calls again tomorrow for any
// left over, and `more` tells the caller there are some.
export const PURGE_BATCH = 100;

// Removes rentals whose `purgeAfter` has passed.
export async function purgeExpired(store: Store, objects: EvidenceObjects, now: Date, limit = PURGE_BATCH): Promise<{ purged: number; more: boolean }> {
  const ids = await store.expiredRentalIds(now, limit + 1);
  const batch = ids.slice(0, limit);
  for (const id of batch) await removeRental(store, objects, id);
  return { purged: batch.length, more: ids.length > limit };
}
