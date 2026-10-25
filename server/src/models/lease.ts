import { z } from 'zod';
import type { Injection } from '../ai/pipeline/adversarial.js';
import type { Clause, Drop, Finding, KeyTerm, PipelineUsage, TermUsed } from '../ai/pipeline/types.js';
import type { TriageCategory, TriageDecision } from '../ai/triage/index.js';
import type { DocumentType } from '../ai/schemas/lease.js';

// rentals/{rentalId}/leases/{leaseId} (spec §6.1), with its `clauses` and
// `findings` subcollections. The text is the redacted text the device sent;
// the redaction map never leaves the device.

// About 60 pages of lease text, the same cap as POST /v1/triage.
export const MAX_LEASE_TEXT = 200_000;

// `pending` until a stream claims it, `running` while one runs it, then one
// of the pipeline's outcomes, or `failed` when no model answered.
export const LeaseStatus = z.enum(['pending', 'running', 'analyzed', 'escalated', 'not_a_lease', 'failed']);
export type LeaseStatus = z.infer<typeof LeaseStatus>;

export const FINISHED: ReadonlySet<LeaseStatus> = new Set(['analyzed', 'escalated', 'not_a_lease']);

// The pipeline's own types; the pipeline built them, so they are not parsed again.
const json = <T>() => z.custom<T>((value) => value !== undefined);

export const Lease = z.object({
  id: z.string().min(1),
  redactedText: z.string().min(1).max(MAX_LEASE_TEXT),
  locale: z.string().min(1),
  readingLevel: z.enum(['standard', 'simpler']),
  pageCount: z.number().int().positive().nullable(),
  ocrConfidence: z.number().min(0).max(1).nullable(),
  status: LeaseStatus,
  // When a stream claimed it; a claim older than STALE_CLAIM_MS is free again.
  startedAt: z.date().nullable(),
  analyzedAt: z.date().nullable(),
  jurisdiction: z.string(),
  // The rule pack's verifiedThrough date.
  rulePackVersion: z.string().nullable(),
  // Every model that answered, primary first.
  models: z.array(z.string()),
  documentType: json<DocumentType>().nullable(),
  term: json<TermUsed>().nullable(),
  keyTerms: json<KeyTerm[]>(),
  injection: json<Injection>().nullable(),
  // `escalated`: what stopped the analysis. The app shows the handoff (#38).
  escalation: json<{ by: 'triage' | 'document_type'; category: TriageCategory; triage: TriageDecision | null }>().nullable(),
  // `not_a_lease`: the message the app shows.
  message: z.string().nullable(),
  // `failed`: the error code the stream sent.
  errorCode: z.string().nullable(),
  // Ids and reasons only, never text.
  drops: json<Drop[]>(),
  usage: json<PipelineUsage>().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Lease = z.infer<typeof Lease>;

// A claim this old belongs to a stream that died without letting go.
export const STALE_CLAIM_MS = 15 * 60 * 1000;

const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

// POST /v1/rentals/:id/leases. The text is already redacted on the device.
export const CreateLeaseInput = z.strictObject({
  text: z.string().trim().min(1).max(MAX_LEASE_TEXT),
  locale: z.string().regex(BCP47).default('en'),
  readingLevel: z.enum(['standard', 'simpler']).default('standard'),
  pageCount: z.number().int().positive().max(1_000).optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
});
export type CreateLeaseInput = z.infer<typeof CreateLeaseInput>;

export function newLease(id: string, jurisdiction: string, input: CreateLeaseInput, now: Date): Lease {
  return {
    id,
    redactedText: input.text,
    locale: input.locale,
    readingLevel: input.readingLevel,
    pageCount: input.pageCount ?? null,
    ocrConfidence: input.ocrConfidence ?? null,
    status: 'pending',
    startedAt: null,
    analyzedAt: null,
    jurisdiction,
    rulePackVersion: null,
    models: [],
    documentType: null,
    term: null,
    keyTerms: [],
    injection: null,
    escalation: null,
    message: null,
    errorCode: null,
    drops: [],
    usage: null,
    createdAt: now,
    updatedAt: now,
  };
}

// What GET /v1/rentals/:id/leases/:leaseId returns. The text stays out: the
// app has it, and the clauses quote all of it.
export function leaseJson({ redactedText: _, startedAt: _s, analyzedAt, createdAt, updatedAt, ...rest }: Lease, clauses: Clause[], findings: Finding[]) {
  return {
    ...rest,
    analyzedAt: analyzedAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    clauses,
    findings,
  };
}
