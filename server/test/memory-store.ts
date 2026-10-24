import type { AuthUser } from '../src/auth.js';
import { Evidence } from '../src/models/evidence.js';
import { Rental } from '../src/models/rental.js';
import type { Store } from '../src/storage/firestore.js';

// The Store contract without Firestore. The emulator tests run the real one.
export function memoryStore() {
  const rentals = new Map<string, Rental>();
  const users = new Map<string, AuthUser['provider']>();
  // Keyed `rentalId/itemId`.
  const evidence = new Map<string, Evidence>();
  let nextId = 1;
  const store: Store = {
    async createRental(owner, build) {
      const rental = Rental.parse(build(`rental-${nextId++}`));
      users.set(owner.uid, owner.provider);
      rentals.set(rental.id, rental);
      return rental;
    },
    async updateRental(id, change) {
      const current = rentals.get(id);
      if (!current) return null;
      const next = Rental.parse(change(structuredClone(current)));
      rentals.set(id, next);
      return next;
    },
    async getRental(id) {
      return structuredClone(rentals.get(id) ?? null);
    },
    async getEvidence(rentalId, itemIds) {
      return itemIds.map((id) => structuredClone(evidence.get(`${rentalId}/${id}`) ?? null));
    },
    async createEvidence(rentalId, items) {
      if (items.some((item) => evidence.has(`${rentalId}/${item.id}`))) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
      for (const item of items) evidence.set(`${rentalId}/${item.id}`, Evidence.parse(item));
    },
    async markEvidenceReceived(rentalId, itemId, at) {
      const item = evidence.get(`${rentalId}/${itemId}`);
      if (!item) return null;
      if (item.receivedAtServer === null) item.receivedAtServer = at;
      return structuredClone(item);
    },
  };
  return { store, rentals, users, evidence };
}
