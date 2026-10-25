import type { Finding } from '../ai/pipeline/types.js';
import type { LedgerEntry } from '../integrity/ledger.js';
import type { Manifest } from '../integrity/manifest.js';
import type { Evidence } from '../models/evidence.js';

// A public, redacted projection, never a Rental or a raw lease document.
// Sharing authorizes the capability before building this value. The loader
// type remains a renderer-test injection seam.
export type ReportLoader = (token: string) => Promise<EvidenceReport | null>;
export type ReportFinding = Pick<
  Finding,
  | 'id'
  | 'severity'
  | 'titleEn'
  | 'explanationEn'
  | 'actionEn'
  | 'leaseQuote'
  | 'statuteQuote'
  | 'citation'
  | 'sourceUrl'
  | 'translations'
> & { leaseLocale?: string };
export interface Annotation {
  // Normalized coordinates on the displayed original, never burned in.
  box: { x: number; y: number; width: number; height: number };
  label: string;
  description: string;
  decision: 'confirmed' | 'adjusted' | 'added' | 'rejected';
}
export type ReportExhibit = Pick<
  Evidence,
  | 'id'
  | 'session'
  | 'room'
  | 'checklistItem'
  | 'sha256'
  | 'mime'
  | 'capturedAtDevice'
  | 'receivedAtServer'
  | 'sealedManifestId'
  | 'deletedAt'
  | 'source'
> & {
  // An authorized, short-lived URL supplied by the loader. Null for pending,
  // missing or unsupported previews. Deleted photos are never requested.
  imageUrl: string | null;
  // Optional authorized original-byte GET URL, including HEIC without a
  // preview. Undefined uses imageUrl for backward-compatible loaders.
  originalUrl?: string | null;
  annotations: Annotation[];
};
export interface EvidenceReport {
  city: string | null;
  jurisdiction: string;
  occupancyDate: string | null;
  tenancyEndDate: string | null;
  generatedAt: string;
  timeline: { at: string; label: string; detail: string | null }[];
  leaseLocale: string;
  findings: ReportFinding[];
  exhibits: ReportExhibit[];
  manifests: Manifest[];
  ledger: LedgerEntry[];
  fixture?: boolean;
}

export const acceptedAnnotations = (item: ReportExhibit) => item.annotations.filter((a) => a.decision !== 'rejected');
export function validBox({ x, y, width, height }: Annotation['box']): boolean {
  return (
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}
export function receiptGap(item: ReportExhibit): number | null {
  return item.receivedAtServer
    ? (item.receivedAtServer.getTime() - Date.parse(item.capturedAtDevice)) / 3_600_000
    : null;
}
// Defense in depth for URLs rendered into href/src. No script/data URLs.
export function webUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
