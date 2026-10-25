import { z } from 'zod';
import { CATEGORIES, CONFIDENCES, VERDICTS } from '../ai/schemas/responsibility.js';
import { EvidenceSession } from './evidence.js';

// rentals/{rentalId}/issues/{issueId} (spec §6.1, §7.7): one responsibility
// check. Every reason's citation was resolved by code against the rule pack,
// the lease, or the rental's evidence before it was stored.

const Label = z.string().trim().min(1).max(100);
const DeviceTime = z.iso.datetime({ offset: true });
const Span = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });

export const LeaseCitation = z.object({
  kind: z.literal('lease'),
  // The clause id.
  ref: z.string().min(1),
  leaseId: z.string().min(1),
  heading: z.string().nullable(),
  // A slice of the clause, as the lease has it.
  quote: z.string().min(1),
  // Where the quote is in the lease's redacted text.
  quoteSpan: Span,
});

export const RuleCitation = z.object({
  kind: z.literal('rule'),
  // The rule id.
  ref: z.string().min(1),
  citation: z.string().min(1),
  // The statute text of the version in force on the day of the check.
  quote: z.string().min(1),
  sourceUrl: z.string().min(1),
  effectiveFrom: z.iso.date(),
});

export const EvidenceCitation = z.object({
  kind: z.literal('evidence'),
  // The evidence item id.
  ref: z.uuid(),
  session: EvidenceSession,
  room: Label,
  checklistItem: Label,
  capturedAtDevice: DeviceTime,
  sealedManifestId: z.string().nullable(),
});

export const Citation = z.discriminatedUnion('kind', [LeaseCitation, RuleCitation, EvidenceCitation]);
export type Citation = z.infer<typeof Citation>;

export const Reason = z.object({ text: z.string().min(1), citation: Citation });
export type Reason = z.infer<typeof Reason>;

// How 31B's second opinion went. `not_needed`: the answer was not `high`.
export const VerificationStatus = z.enum(['not_needed', 'agreed', 'disagreed', 'unavailable']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const Issue = z.object({
  id: z.uuid(),
  description: z.string().min(1),
  room: Label.nullable(),
  checklistItem: Label.nullable(),
  // Evidence item ids of the problem's photos, as the tenant attached them.
  photos: z.array(z.uuid()),
  locale: z.string().min(1),
  verdict: z.enum(VERDICTS),
  category: z.enum(CATEGORIES),
  confidence: z.enum(CONFIDENCES),
  reasons: z.array(Reason).max(4),
  whatWouldChange: z.array(z.string().min(1)).max(3),
  // A condition a rent escrow case (§ 55.1-1244) could cover if the landlord
  // does not fix it after written notice. Drives the escrow explainer (#32).
  escrowEligible: z.boolean(),
  verification: z.object({
    status: VerificationStatus,
    model: z.string().nullable(),
    verdict: z.enum(VERDICTS).nullable(),
  }),
  // 26B said `high` and 31B did not agree, so it is `medium` now.
  downgraded: z.boolean(),
  // `primary` is null when there was nothing to cite, so no model was asked.
  models: z.object({ primary: z.string().min(1).nullable(), verifier: z.string().nullable() }),
  // The analyzed lease the clauses came from, if there was one.
  leaseId: z.string().nullable(),
  createdAt: z.date(),
});
export type Issue = z.infer<typeof Issue>;

export const MAX_ISSUE_PHOTOS = 4;
export const MAX_DESCRIPTION_CHARS = 2_000;

// POST /v1/rentals/:id/issues. The room and item name the move-in photos to
// compare with; the photo ids are evidence items already uploaded.
export const CreateIssueInput = z.strictObject({
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS),
  room: Label.optional(),
  checklistItem: Label.optional(),
  photoIds: z
    .array(z.uuid())
    .max(MAX_ISSUE_PHOTOS)
    .default([])
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, { message: 'duplicate photoId' }),
  locale: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
    .default('en'),
});
export type CreateIssueInput = z.infer<typeof CreateIssueInput>;

export function issueJson({ id, createdAt, ...rest }: Issue) {
  return { issueId: id, status: 'checked' as const, ...rest, createdAt: createdAt.toISOString() };
}
