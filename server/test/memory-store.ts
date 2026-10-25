import type { AuthUser } from '../src/auth.js';
import { LedgerEntry } from '../src/integrity/ledger.js';
import { Manifest } from '../src/integrity/manifest.js';
import type { Clause, Finding } from '../src/ai/pipeline/types.js';
import { Evidence } from '../src/models/evidence.js';
import { Issue } from '../src/models/issue.js';
import { Lease } from '../src/models/lease.js';
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
  // Keyed `rentalId/leaseId`.
  const leases = new Map<string, Lease>();
  const leaseResults = new Map<string, { clauses: Clause[]; findings: Finding[] }>();
  // Keyed `rentalId/issueId`.
  const issues = new Map<string, Issue>();
  let nextId = 1;
  const store: Store = {
    async setImpactOptIn() {},
    async getImpact() { return { tenantsHelped: 0, verifiedClausesFlagged: 0, moveInReportsWithin5Days: 0, depositDollarsCovered: 0 }; },
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
    async updateEvidenceReview(rentalId, itemId, fields) {
      const item = evidence.get(`${rentalId}/${itemId}`);
      if (!item) return null;
      Object.assign(item, Evidence.parse({ ...item, ...structuredClone(fields) }));
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
    async latestLease(rentalId) {
      const analyzed = [...leases.entries()]
        .filter(([key, lease]) => key.startsWith(`${rentalId}/`) && lease.status === 'analyzed')
        .sort(([, a], [, b]) => (b.analyzedAt?.getTime() ?? 0) - (a.analyzedAt?.getTime() ?? 0));
      const newest = analyzed[0];
      if (!newest) return null;
      const [key, lease] = newest;
      return structuredClone({ id: lease.id, clauses: leaseResults.get(key)?.clauses ?? [] });
    },
    async createIssue(rentalId, issue) {
      const key = `${rentalId}/${issue.id}`;
      if (issues.has(key)) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
      issues.set(key, Issue.parse(issue));
    },
    async rentalIdsOwnedBy(uid) {
      return [...rentals.values()].filter((rental) => rental.ownerUid === uid).map((rental) => rental.id);
    },
    async expiredRentalIds(now, limit) {
      return [...rentals.values()]
        .filter((rental) => rental.purgeAfter !== null && rental.purgeAfter <= now)
        .slice(0, limit)
        .map((rental) => rental.id);
    },
    async deleteRental(rentalId) {
      let evidenceItems = 0;
      for (const key of [...evidence.keys()]) {
        if (!key.startsWith(`${rentalId}/`)) continue;
        evidence.delete(key);
        evidenceItems += 1;
      }
      for (const key of [...manifests.keys()]) if (key.startsWith(`${rentalId}/`)) manifests.delete(key);
      for (const key of [...issues.keys()]) if (key.startsWith(`${rentalId}/`)) issues.delete(key);
      for (const key of [...leases.keys()]) {
        if (!key.startsWith(`${rentalId}/`)) continue;
        leases.delete(key);
        leaseResults.delete(key);
      }
      ledgers.delete(rentalId);
      rentals.delete(rentalId);
      return { evidenceItems };
    },
    async deleteUser(uid) {
      users.delete(uid);
    },
    async createLease(rentalId, build) {
      const lease = Lease.parse(build(`lease-${nextId++}`));
      leases.set(`${rentalId}/${lease.id}`, lease);
      return structuredClone(lease);
    },
    async getLease(rentalId, leaseId) {
      return structuredClone(leases.get(`${rentalId}/${leaseId}`) ?? null);
    },
    async updateLease(rentalId, leaseId, change) {
      const current = leases.get(`${rentalId}/${leaseId}`);
      if (!current) return null;
      const next = Lease.parse(change(structuredClone(current)));
      leases.set(`${rentalId}/${leaseId}`, next);
      return structuredClone(next);
    },
    async saveLeaseAnalysis(rentalId, lease, clauses, findings) {
      // A JSON round trip, as Firestore stores it.
      leases.set(`${rentalId}/${lease.id}`, Lease.parse(structuredClone(lease)));
      leaseResults.set(`${rentalId}/${lease.id}`, JSON.parse(JSON.stringify({ clauses, findings })));
    },
    async listAskLeases(rentalId) {
      return [...leases.entries()].filter(([key, l]) => key.startsWith(`${rentalId}/`) && l.status === 'analyzed').map(([, l]) => l).slice(0, 10);
    },
    async getLeaseResults(rentalId, leaseId) {
      return structuredClone(leaseResults.get(`${rentalId}/${leaseId}`) ?? { clauses: [], findings: [] });
    },
  };
  return { store, rentals, users, evidence, ledgers, manifests, leases, leaseResults, issues };
}
