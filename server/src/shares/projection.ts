import type { EvidenceReport, ReportExhibit } from '../report/model.js';
import type { Store } from '../storage/firestore.js';
import type { Share, Shares } from './store.js';

// Explicit allowlists: never spread a rental, lease, or evidence record into
// the public view. Lease text and tenant identity are not part of this model.
export async function projectReport(share: Share, store: Store, shares: Shares, token: string, origin: string): Promise<EvidenceReport | null> {
  const rental = await store.getRental(share.rentalId);
  if (!rental) return null;
  const evidenceScope = share.scope.includes('evidence');
  const ledger = evidenceScope ? await store.listLedger(rental.id) : [];
  const manifestIds = [...new Set(ledger.filter(e => e.type === 'manifest_sealed').map(e => String(e.payload.manifestId)))];
  const manifests = (await Promise.all(manifestIds.map(id => store.getManifest(rental.id, id)))).filter(m => m !== null);
  const evidence = evidenceScope ? (await Promise.all(['move_in', 'move_out', 'incident'].map(session => store.listEvidence(rental.id, session as 'move_in' | 'move_out' | 'incident')))).flat() : [];
  const exhibits: ReportExhibit[] = evidence.map(item => ({
    id: item.id, session: item.session, room: item.room, checklistItem: item.checklistItem,
    sha256: item.sha256, mime: item.mime, capturedAtDevice: item.capturedAtDevice,
    receivedAtServer: item.receivedAtServer, sealedManifestId: item.sealedManifestId,
    deletedAt: item.deletedAt, source: item.source,
    imageUrl: !item.deletedAt && item.receivedAtServer ? new URL(`/r/${token}/photos/${item.id}`, origin).href : null,
    // The tenant's decisions only, never Gemma's raw proposals (spec §7.5
    // step 3). The page drops rejected ones; deleted photos show none.
    annotations: item.deletedAt ? [] : item.tenantAnnotations.map(a => ({ box: a.box, label: a.label, description: a.description, decision: a.decision })),
  }));
  const findings: EvidenceReport['findings'] = [];
  if (share.scope.includes('lease')) {
    for (const lease of await shares.leases(rental.id)) {
      const results = await store.getLeaseResults(rental.id, lease.id);
      for (const f of results.findings) findings.push({
        id: `${lease.id}-${f.id}`, leaseLocale: lease.locale, severity: f.severity, titleEn: f.titleEn, explanationEn: f.explanationEn,
        actionEn: f.actionEn, leaseQuote: f.leaseQuote, statuteQuote: f.statuteQuote,
        citation: f.citation, sourceUrl: f.sourceUrl, translations: f.translations,
      });
    }
  }
  return {
    city: rental.city, jurisdiction: rental.jurisdiction, occupancyDate: rental.occupancyDate,
    tenancyEndDate: rental.tenancyEndDate, generatedAt: new Date().toISOString(),
    timeline: rental.occupancyDate ? [{ at: rental.occupancyDate, label: 'Occupancy date', detail: 'Date supplied by the tenant' }] : [],
    leaseLocale: 'en', findings, exhibits, manifests, ledger,
  };
}
