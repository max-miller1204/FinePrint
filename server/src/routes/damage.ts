import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { GemmaOutputError, GemmaRequestError, GemmaUnavailableError, type GemmaClient } from '../ai/gemma.js';
import { analyzeDamage } from '../ai/pipeline/damage.js';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { AnnotateEvidenceInput, damageJson, type Evidence } from '../models/evidence.js';
import { isDocumentId, type Store } from '../storage/firestore.js';
import { ownedRental, rentalNotFound } from './evidence.js';
import { guard, readBody } from './rentals.js';

// The 1536 px JPEG copy is a few hundred KB; this leaves room for a busy
// scene without letting an original through.
export const MAX_MODEL_COPY_BYTES = 4 * 1024 * 1024;

const tooLarge = () => {
  throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
};

// Damage review of one evidence photo (spec §7.5, §4.3 F2, §13):
//   POST  /v1/rentals/:id/evidence/:itemId/analyze  Gemma's proposals
//   GET   /v1/rentals/:id/evidence/:itemId/damage   proposals and decisions
//   PATCH /v1/rentals/:id/evidence/:itemId          the tenant's decisions
// The original's bytes, hash, and manifests are never touched: the analyze
// body is the app's downscaled copy, which is sent to the model and not
// kept, and both results live in their own fields. Mounted before the
// rentals routes, whose 16 KB body limit would refuse the photo.
export function createDamage(store: Store, gemma: GemmaClient | null, now: () => Date = () => new Date()) {
  const damage = new Hono<AuthEnv>();

  damage.post('/:id/evidence/:itemId/analyze', bodyLimit({ maxSize: MAX_MODEL_COPY_BYTES, onError: tooLarge }), async (c) => {
    const { rentalId, item } = await reviewable(c.req.param('id'), c.req.param('itemId'), c);
    const type = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'image/jpeg') throw new ApiError(400, 'BAD_REQUEST', 'Send the model copy as image/jpeg');
    const image = new Uint8Array(await c.req.arrayBuffer());
    if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
      throw new ApiError(400, 'BAD_REQUEST', 'Body must be a JPEG');
    }
    const log = c.get('log');
    if (!gemma) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Damage analysis is unavailable');

    let analysis: Awaited<ReturnType<typeof analyzeDamage>>;
    try {
      analysis = await analyzeDamage(gemma, { image, room: item.room, checklistItem: item.checklistItem }, { signal: c.req.raw.signal, log, now });
    } catch (err) {
      if (err instanceof GemmaUnavailableError || err instanceof GemmaOutputError || err instanceof GemmaRequestError) {
        log.warn('damage analysis unavailable', { rentalId, errorName: err.name });
        throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Damage analysis is unavailable');
      }
      throw err;
    }
    // A new analysis keeps decisions on proposals it still has and the
    // boxes the tenant added; the rest would point at nothing.
    const ids = new Set(analysis.proposals.map((p) => p.id));
    const kept = item.tenantAnnotations.filter((a) => a.proposalId === null || ids.has(a.proposalId));
    const updated = await guard(store.updateEvidenceReview(rentalId, item.id, { aiProposal: analysis, tenantAnnotations: kept }));
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'No such evidence item');
    log.info('damage analyzed', {
      rentalId,
      itemId: item.id,
      model: analysis.model,
      proposals: analysis.proposals.length,
      qualityOk: analysis.imageQuality.ok,
    });
    return c.json(damageJson(updated));
  });

  damage.get('/:id/evidence/:itemId/damage', async (c) => {
    const { item } = await reviewable(c.req.param('id'), c.req.param('itemId'), c);
    return c.json(damageJson(item));
  });

  damage.patch('/:id/evidence/:itemId', bodyLimit({ maxSize: 32 * 1024, onError: tooLarge }), async (c) => {
    const { rentalId, item } = await reviewable(c.req.param('id'), c.req.param('itemId'), c);
    const { annotations } = await readBody(c, AnnotateEvidenceInput);
    const proposals = new Set(item.aiProposal?.proposals.map((p) => p.id) ?? []);
    if (annotations.some((a) => a.proposalId !== null && !proposals.has(a.proposalId))) {
      throw new ApiError(400, 'BAD_REQUEST', 'An annotation names a proposal this photo does not have');
    }
    const updated = await guard(store.updateEvidenceReview(rentalId, item.id, { tenantAnnotations: annotations, annotatedAt: now() }));
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'No such evidence item');
    c.get('log').info('evidence annotated', { rentalId, itemId: item.id, annotations: annotations.length });
    return c.json(damageJson(updated));
  });

  async function reviewable(rentalId: string, rawItemId: string, c: Parameters<typeof ownedRental>[0]): Promise<{ rentalId: string; item: Evidence }> {
    const itemId = rawItemId.toLowerCase();
    if (!isDocumentId(rentalId)) throw rentalNotFound();
    await ownedRental(c, store, rentalId);
    const [item] = isDocumentId(itemId) ? await guard(store.getEvidence(rentalId, [itemId])) : [null];
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'No such evidence item');
    if (item.deletedAt !== null) throw new ApiError(409, 'CONFLICT', 'This photo was deleted');
    if (item.receivedAtServer === null) throw new ApiError(409, 'CONFLICT', 'Upload the photo before reviewing it');
    return { rentalId, item };
  }

  return damage;
}
