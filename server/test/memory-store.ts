import type { AuthUser } from '../src/auth.js';
import { LedgerEntry } from '../src/integrity/ledger.js';
import { Manifest } from '../src/integrity/manifest.js';
import { Evidence } from '../src/models/evidence.js';
import { Rental } from '../src/models/rental.js';
import type { Store } from '../src/storage/firestore.js';

// The Store contract without Firestore. The emulator tests run the real one.
export function memoryStore() {
  const rentals = new Map<string, Rental>();
  const users = new Map<string, AuthUser['provider']>();
  // Keyed `rentalId/itemId`.
  const evidence = new Map<string, Evidence>();
  // Keyed by rentalId, in append order.
  const ledgers = new Map<string, LedgerEntry[]>();
  // Keyed `rentalId/manifestId`.
  const manifests = new Map<string, Manifest>();
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
    async listEvidence(rentalId, session) {
      return [...evidence.entries()].filter(([key, item]) => key.startsWith(`${rentalId}/`) && item.session === session).map(([, item]) => structuredClone(item));
    },
    async listLedger(rentalId) {
      return structuredClone(ledgers.get(rentalId) ?? []);
    },
    async getManifest(rentalId, manifestId) {
      return structuredClone(manifests.get(`${rentalId}/${manifestId}`) ?? null);
    },
    async appendLedger(rentalId, build) {
      const entries = ledgers.get(rentalId) ?? [];
      const last = entries.at(-1);
      const append = await build(last ? { seq: last.seq, entryHash: last.entryHash } : null);
      entries.push(LedgerEntry.parse(append.entry));
      ledgers.set(rentalId, entries);
      if (append.manifest) manifests.set(`${rentalId}/${append.manifest.id}`, Manifest.parse(append.manifest));
      for (const { itemId, fields } of append.items ?? []) Object.assign(evidence.get(`${rentalId}/${itemId}`)!, fields);
      return structuredClone(append);
    },
  };
  return { store, rentals, users, evidence, ledgers, manifests };
}
