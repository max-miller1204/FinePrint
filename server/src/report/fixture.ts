import { readFile } from 'node:fs/promises';
import { sha256Hex } from '../integrity/jcs.js';
import { newLedgerEntry } from '../integrity/ledger.js';
import type { Signer } from '../integrity/kms.js';
import { sealManifest } from '../integrity/manifest.js';
import { newEvidence } from '../models/evidence.js';
import { JURISDICTIONS_ROOT, loadRulePacks } from '../rules/loader.js';
import type { EvidenceReport, ReportExhibit, ReportFinding } from './model.js';

export const fixturePhoto = () =>
  readFile(new URL('../../../e2e/fixtures/photos/move-in/01-kitchen-wall.jpg', import.meta.url));
export const FIXTURE_TOKEN = 'fixture';
export type FixtureVariant = 'demo' | 'worst' | 'empty' | 'one';
export const fixtureVariant = (value?: string): FixtureVariant =>
  value === 'worst' || value === 'empty' || value === 'one' ? value : 'demo';
export const fixturesEnabled = (env = process.env) => env.REPORT_FIXTURES === '1' && !!env.FIRESTORE_EMULATOR_HOST;

// Synthetic data, opt-in only with emulators. All signatures and photo hashes
// are real and use the same local key published by this server.
export async function fixtureReport(signer: Signer): Promise<EvidenceReport> {
  const photo = await fixturePhoto();
  const items = Array.from({ length: 3 }, (_, i) => ({
    ...newEvidence(
      {
        itemId: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        session: 'move_in',
        room: ['Kitchen', 'Bathroom', 'Bedroom'][i]!,
        checklistItem: ['Wall', 'Tile', 'Door'][i]!,
        sha256: sha256Hex(photo),
        bytes: photo.length,
        mime: 'image/jpeg',
        capturedAtDevice: `2026-08-14T15:12:0${i}-04:00`,
        deviceUptimeMs: 81233411 + i,
        source: i === 1 ? 'imported' : 'in_app_camera',
        appVersion: '1.0.0',
      },
      'fixture-only',
      new Date('2026-08-14T19:12:00Z'),
    ),
    receivedAtServer: new Date(i === 0 ? '2026-08-16T20:12:00Z' : '2026-08-14T19:15:00Z'),
  }));
  const at = new Date('2026-08-16T20:15:00Z');
  const manifest = await sealManifest(signer, {
    id: '20000000-0000-4000-8000-000000000001',
    rentalId: 'synthetic-rental',
    kind: 'move_in',
    items,
    head: null,
    at,
  });
  const sealed = await newLedgerEntry(
    signer,
    null,
    'manifest_sealed',
    { manifestId: manifest.id, sha256: manifest.sha256, items: items.length },
    at,
  );
  const deleted = await newLedgerEntry(
    signer,
    sealed,
    'evidence_deleted',
    { itemId: items[2]!.id, sha256: items[2]!.sha256 },
    new Date('2026-09-02T12:00:00Z'),
  );
  const rule = loadRulePacks(JURISDICTIONS_ROOT, { requireVerified: true }).get('VA')!.byId.get('VA_DEPOSIT_CAP')!;
  const finding: ReportFinding = {
    id: 'f1',
    severity: 'unenforceable',
    titleEn: 'Security deposit exceeds two months’ rent',
    explanationEn: rule.tenantExplanation,
    actionEn: rule.action,
    leaseQuote: "Tenant shall deliver a security deposit equal to three months' rent.",
    statuteQuote: rule.versions[0]!.statuteQuote,
    citation: rule.citation,
    sourceUrl: rule.sourceUrl,
    translations: {},
  };
  return {
    fixture: true,
    city: 'Richmond',
    jurisdiction: 'VA',
    occupancyDate: '2026-08-14',
    tenancyEndDate: '2027-08-13',
    generatedAt: '2026-09-03T12:00:00Z',
    timeline: [
      { at: '2026-08-14', label: 'Occupancy began', detail: null },
      {
        at: at.toISOString(),
        label: 'Move-in evidence sealed',
        detail: 'Three capture records signed by the server.',
      },
      {
        at: deleted.at,
        label: 'Photo deleted by tenant',
        detail: 'The signed record remains in the ledger.',
      },
    ],
    leaseLocale: 'en',
    findings: [finding],
    manifests: [manifest],
    ledger: [sealed, deleted],
    exhibits: items.map(
      (item, i): ReportExhibit => ({
        ...item,
        imageUrl: null,
        sealedManifestId: manifest.id,
        deletedAt: i === 2 ? new Date(deleted.at) : null,
        annotations:
          i === 0
            ? [
                {
                  box: { x: 0.2, y: 0.25, width: 0.35, height: 0.3 },
                  label: 'Wall mark',
                  description: 'Mark present at move-in.',
                  decision: 'confirmed',
                },
                {
                  box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
                  label: 'Rejected suggestion',
                  description: 'Not included in the report.',
                  decision: 'rejected',
                },
              ]
            : [],
      }),
    ),
  };
}
export function varyFixture(base: EvidenceReport, variant: FixtureVariant, origin: string): EvidenceReport {
  const report = structuredClone(base);
  if (variant === 'empty')
    return {
      ...report,
      city: null,
      occupancyDate: null,
      tenancyEndDate: null,
      timeline: [],
      findings: [],
      exhibits: [],
      ledger: [],
      manifests: [],
    };
  if (variant === 'one') {
    report.exhibits = report.exhibits.slice(0, 1);
    // Keep the signed artifacts intact: filtered data never rewrites history.
  }
  if (variant === 'worst') {
    report.city = 'San Buenaventura (Ventura), منطقة متعددة اللغات';
    report.findings = Array.from({ length: 25 }, (_, i) => ({
      ...report.findings[0]!,
      id: `f${i + 1}`,
      translations: {
        es: {
          title: 'Información sobre el depósito de seguridad y las condiciones de devolución al finalizar el contrato',
          explanation: 'Puede pedir que se reduzca el depósito de seguridad. '.repeat(10),
          action: 'Pida una copia de los términos por escrito.',
          model: 'fixture',
          fallback: false,
        },
      },
      leaseQuote: `${report.findings[0]!.leaseQuote}\n${'Additional terms apply to the security deposit and its return at the end of the tenancy. '.repeat(18)}`,
    }));
    report.exhibits = Array.from({ length: 120 }, (_, i) => ({
      ...report.exhibits[i % 3]!,
      id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      sealedManifestId: i < 3 ? report.exhibits[i]!.sealedManifestId : null,
      room:
        i % 2 ? 'Habitación principal y espacio de almacenamiento compartido' : '共同使用のキッチンとダイニングルーム',
      checklistItem: 'IMG_20260814_151200_HDR_portrait_original_unmodified.HEIC',
      annotations: report.exhibits[0]!.annotations,
    }));
  }
  report.exhibits = report.exhibits.map((item) => ({
    ...item,
    imageUrl: item.deletedAt ? null : `${origin}/r/${FIXTURE_TOKEN}/photos/kitchen`,
  }));
  return report;
}
