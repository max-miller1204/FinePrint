import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { GemmaClient } from '../ai/gemma.js';
import { GemmaOutputError, GemmaUnavailableError } from '../ai/gemma.js';
import { checkResponsibility, moveInRecords } from '../ai/pipeline/responsibility.js';
import type { Triage } from '../ai/triage/index.js';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { CreateIssueInput, Issue, issueJson } from '../models/issue.js';
import type { RulePack } from '../rules/types.js';
import { isDocumentId, type Store } from '../storage/firestore.js';
import { ownedRental, rentalNotFound } from './evidence.js';
import { guard, readBody } from './rentals.js';

export interface IssueDeps {
  // Shared with triage, so one rate limiter sees every call. Null: no model
  // is configured, and a check that does not escalate answers 503.
  gemma: GemmaClient | null;
  // By jurisdiction ("VA"). A rental elsewhere is checked with no rules.
  rulePacks: ReadonlyMap<string, RulePack>;
  triage: Triage;
}

// POST /v1/rentals/:id/issues (spec §4.3 F4, §7.7, §13): the responsibility
// check. Mounted next to the rentals routes, whose 16 KB body limit covers
// this path too. Danger, self-harm, or abuse stops the check: nothing is
// stored, and the answer is the triage decision, so the app opens the
// handoff sheet (#38) instead of a verdict. Any other escalation (a lockout,
// no heat) gets the verdict with `triage` attached, and the app offers both.
export function createIssues(store: Store, deps: IssueDeps, now: () => Date = () => new Date()) {
  const issues = new Hono<AuthEnv>();

  issues.post('/:id/issues', async (c) => {
    const rentalId = c.req.param('id');
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    const input = await readBody(c, CreateIssueInput);
    const rental = await ownedRental(c, store, rentalId);
    const log = c.get('log');

    const photoIds = input.photoIds.map((id) => id.toLowerCase());
    const photos = await guard(store.getEvidence(rentalId, photoIds));
    for (const photo of photos) {
      if (!photo) throw new ApiError(404, 'NOT_FOUND', 'No such evidence item');
      if (photo.deletedAt !== null) throw new ApiError(409, 'CONFLICT', 'This photo was deleted');
      if (photo.receivedAtServer === null) throw new ApiError(409, 'CONFLICT', 'Upload the photo before checking it');
    }

    const room = input.room ?? null;
    const checklistItem = input.checklistItem ?? null;
    const [lease, moveIn] = await guard(Promise.all([store.latestLease(rentalId), room === null ? [] : store.listEvidence(rentalId, 'move_in')]));
    const at = now();

    let result: Awaited<ReturnType<typeof checkResponsibility>>;
    try {
      result = await checkResponsibility(
        {
          description: input.description,
          locale: input.locale,
          today: at.toISOString().slice(0, 10),
          lease,
          moveIn: moveInRecords(moveIn, room, checklistItem),
        },
        { gemma: deps.gemma, pack: deps.rulePacks.get(rental.jurisdiction) ?? null, triage: deps.triage, log },
        { signal: c.req.raw.signal },
      );
    } catch (err) {
      // Every model in the chain failed, or none is configured: the app retries later.
      if (err instanceof GemmaUnavailableError || err instanceof GemmaOutputError) {
        log.warn('responsibility check unavailable', { rentalId, errorName: err.name });
        throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'The model is unavailable');
      }
      throw err;
    }

    if (result.status === 'escalated') return c.json({ status: 'escalated', triage: result.triage });

    const issue = Issue.parse({
      id: randomUUID(),
      description: input.description,
      room,
      checklistItem,
      photos: photoIds,
      locale: input.locale,
      verdict: result.verdict,
      category: result.category,
      confidence: result.confidence,
      reasons: result.reasons,
      whatWouldChange: result.whatWouldChange,
      escrowEligible: result.escrowEligible,
      verification: result.verification,
      downgraded: result.downgraded,
      models: result.models,
      leaseId: lease?.id ?? null,
      createdAt: at,
    });
    await guard(store.createIssue(rentalId, issue));
    log.info('issue created', { rentalId, issueId: issue.id, photos: photoIds.length });
    return c.json({ ...issueJson(issue), triage: result.triage }, 201);
  });

  return issues;
}
