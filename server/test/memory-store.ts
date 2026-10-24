import type { AuthUser } from '../src/auth.js';
import { Rental } from '../src/models/rental.js';
import type { Store } from '../src/storage/firestore.js';

// The Store contract without Firestore. The emulator tests run the real one.
export function memoryStore() {
  const rentals = new Map<string, Rental>();
  const users = new Map<string, AuthUser['provider']>();
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
  };
  return { store, rentals, users };
}
