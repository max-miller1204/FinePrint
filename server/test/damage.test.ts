import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Document } from '../src/ai/documents.js';
import { GemmaUnavailableError, type GemmaClient, type GenerateOptions } from '../src/ai/gemma.js';
import { GEMMA_26B, STAGES, type Stage } from '../src/ai/models.js';
import { normalizeBox, proposal } from '../src/ai/pipeline/damage.js';
import { toResponseSchema } from '../src/ai/response-schema.js';
import { DamageResult } from '../src/ai/schemas/damage.js';
import { createApp } from '../src/app.js';
import type { VerifyIdToken } from '../src/auth.js';
import { InvalidTokenError } from '../src/auth.js';
import { localSigner } from '../src/integrity/kms.js';
import { acceptedAnnotations, validBox } from '../src/report/model.js';
import { projectReport } from '../src/shares/projection.js';
import type { Share, Shares } from '../src/shares/store.js';
import { originalPath } from '../src/storage/gcs.js';
import { memoryObjects } from './memory-objects.js';
import { memoryStore } from './memory-store.js';

const fakeVerifier: VerifyIdToken = async (token) => {
  if (token === 'alice' || token === 'mallory') return { uid: token, provider: 'anonymous' };
  throw new InvalidTokenError('invalid');
};

const original = Buffer.from('the original HEIC bytes, never sent to the model');
// A JPEG's magic number, then anything: the fake model never decodes it.
const modelCopy = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('downscaled copy')]);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const itemId = '6f1c2a5e-8d3b-4c7a-9e21-0b4f5d6a7c88';

const answer = {
  imageQuality: { ok: true, issues: [] },
  items: [
    { type: 'scuff', description: 'scuff on wall, about 10 cm', severity: 'minor', box: [100, 200, 300, 500], confidence: 'high' },
    { type: 'mold_like', description: 'black mold in the corner', severity: 'moderate', box: [600, 700, 800, 900], confidence: 'medium' },
    { type: 'stain', description: 'mouse droppings near the baseboard', severity: 'minor', confidence: 'low' },
  ],
};

function fakeGemma(result: unknown = answer) {
  const calls: { stage: Stage; schema: z.ZodType; docs: readonly Document[]; options: GenerateOptions }[] = [];
  const gemma: GemmaClient = {
    async generate(stage, schema, docs, options) {
      calls.push({ stage, schema, docs, options });
      if (result instanceof Error) throw result;
      return { data: schema.parse(result), model: GEMMA_26B, fallback: false, promptTokens: 400, outputTokens: 90 };
    },
  };
  return { gemma, calls };
}

async function setup({ gemma = fakeGemma(), withModel = true } = {}) {
  const memory = memoryStore();
  const objects = memoryObjects();
  const app = createApp({
    logSink: () => {},
    verifyIdToken: fakeVerifier,
    store: memory.store,
    objects: objects.store,
    signer: localSigner(),
    gemma: withModel ? gemma.gemma : null,
  });
  const send = (method: string, path: string, as: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const rentalId = ((await (await send('POST', '/v1/rentals', 'alice', { jurisdiction: 'VA', city: 'Richmond' })).json()) as { id: string }).id;
  const record = {
    itemId,
    room: 'Kitchen',
    checklistItem: 'Walls',
    sha256: sha256(original),
    bytes: original.length,
    mime: 'image/heic',
    capturedAtDevice: '2026-08-14T15:12:03-04:00',
    deviceUptimeMs: 81233411,
    source: 'in_app_camera',
    appVersion: '1.0.0 (12)',
  };
  expect((await send('POST', `/v1/rentals/${rentalId}/evidence`, 'alice', { items: [record] })).status).toBe(201);
  const receive = async () => {
    objects.put(originalPath(rentalId, itemId), original);
    expect((await send('POST', `/v1/rentals/${rentalId}/evidence/${itemId}/complete`, 'alice')).status).toBe(200);
  };
  const analyze = (as = 'alice', body: Buffer = modelCopy, contentType = 'image/jpeg') =>
    app.request(`/v1/rentals/${rentalId}/evidence/${itemId.toUpperCase()}/analyze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${as}`, 'Content-Type': contentType },
      body: new Uint8Array(body),
    });
  const annotate = (annotations: unknown[], as = 'alice') => send('PATCH', `/v1/rentals/${rentalId}/evidence/${itemId}`, as, { annotations });
  return { app, send, memory, objects, rentalId, receive, analyze, annotate, calls: gemma.calls };
}

describe('POST /v1/rentals/:id/evidence/:itemId/analyze', () => {
  it('sends the model copy to the vision stage and stores normalized proposals', async () => {
    const { analyze, receive, calls, memory, rentalId } = await setup();
    await receive();
    const res = await analyze();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.itemId).toBe(itemId);
    expect(body.sha256).toBe(sha256(original));
    expect(body.analysis.model).toBe(GEMMA_26B);
    expect(body.analysis.imageQuality).toEqual({ ok: true, issues: [] });
    const [scuff] = body.analysis.proposals;
    expect(scuff).toEqual({
      id: 'p1',
      type: 'scuff',
      label: 'Scuff',
      description: 'scuff on wall, about 10 cm',
      severity: 'minor',
      confidence: 'high',
      box: { x: 0.2, y: 0.1, width: 0.3, height: 0.2 },
      repairPath: false,
    });
    expect(body.annotations).toEqual([]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.stage).toBe('vision');
    const photo = calls[0]!.docs.find((d) => d.id === 'photo');
    expect(photo && 'image' in photo ? Buffer.from(photo.image.data, 'base64') : null).toEqual(modelCopy);
    expect(photo && 'image' in photo ? photo.image.mimeType : null).toBe('image/jpeg');
    // The room labels are tenant text, so they go as a document, not the task.
    expect(calls[0]!.docs.find((d) => d.id === 'capture_context')).toMatchObject({ text: expect.stringContaining('Kitchen') });
    expect(calls[0]!.options.task).not.toContain('Kitchen');

    const [stored] = await memory.store.getEvidence(rentalId, [itemId]);
    expect(stored!.aiProposal!.proposals).toHaveLength(3);
  });

  it('never asserts mold or pests, and points those to the repair path', async () => {
    const { analyze, receive } = await setup();
    await receive();
    const { analysis } = await (await analyze()).json();
    const [, mold, pest] = analysis.proposals;
    expect(mold).toMatchObject({ type: 'mold_like', label: 'Looks like it could be mold', repairPath: true });
    expect(mold.description).not.toMatch(/black mold/);
    expect(mold.description).toMatch(/might be mold/);
    expect(mold.description).toMatch(/55\.1-1220/);
    // Named pests under another type are caught too.
    expect(pest).toMatchObject({ type: 'pest_sign', label: 'Could be a sign of pests', repairPath: true, box: null });
    expect(pest.description).not.toMatch(/mouse droppings/);
  });

  it('refuses a photo that has not been received, one that is not a JPEG, and another user', async () => {
    const { analyze, receive, calls } = await setup();
    expect((await analyze()).status).toBe(409);
    await receive();
    expect((await analyze('alice', original)).status).toBe(400);
    expect((await analyze('alice', modelCopy, 'image/heic')).status).toBe(400);
    expect((await analyze('mallory')).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses a body larger than a model copy', async () => {
    const { analyze, receive } = await setup();
    await receive();
    const big = Buffer.concat([modelCopy, Buffer.alloc(4 * 1024 * 1024)]);
    expect((await analyze('alice', big)).status).toBe(413);
  });

  it('answers 503 when no model answers or none is configured', async () => {
    const down = await setup({ gemma: fakeGemma(new GemmaUnavailableError('vision', [GEMMA_26B])) });
    await down.receive();
    expect((await down.analyze()).status).toBe(503);
    const none = await setup({ withModel: false });
    await none.receive();
    expect((await none.analyze()).status).toBe(503);
  });
});

describe('PATCH /v1/rentals/:id/evidence/:itemId', () => {
  const box = { x: 0.2, y: 0.1, width: 0.3, height: 0.2 };

  it('stores the tenant decisions beside the AI proposals', async () => {
    const { analyze, receive, annotate, memory, rentalId } = await setup();
    await receive();
    await analyze();
    const res = await annotate([
      { proposalId: 'p1', decision: 'confirmed', box, label: 'Scuff', description: 'scuff on wall, about 10 cm', severity: 'minor' },
      { proposalId: 'p2', decision: 'adjusted', box: { x: 0.65, y: 0.55, width: 0.3, height: 0.3 }, label: 'Dark spots', description: 'Dark spots on ceiling' },
      { proposalId: 'p3', decision: 'rejected', box: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, label: 'Not damage' },
      { proposalId: null, decision: 'added', box: { x: 0, y: 0.8, width: 0.2, height: 0.2 }, label: 'Chip', description: 'Chipped tile' },
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.annotations).toHaveLength(4);
    expect(body.analysis.proposals).toHaveLength(3);
    expect(body.annotatedAt).toEqual(expect.any(String));
    const [stored] = await memory.store.getEvidence(rentalId, [itemId]);
    expect(stored!.tenantAnnotations.map((a) => a.decision)).toEqual(['confirmed', 'adjusted', 'rejected', 'added']);
    expect(stored!.aiProposal!.proposals[1]!.box).toEqual({ x: 0.7, y: 0.6, width: 0.2, height: 0.2 });
  });

  it('leaves the original, its hash, and the sealed manifest unchanged', async () => {
    const { analyze, receive, annotate, memory, objects, rentalId, send } = await setup();
    await receive();
    const sealed = await (await send('POST', `/v1/rentals/${rentalId}/seal`, 'alice', { session: 'move_in' })).json();
    const before = (await memory.store.getEvidence(rentalId, [itemId]))[0]!;
    const manifestBefore = await memory.store.getManifest(rentalId, sealed.manifest.manifestId);

    await analyze();
    expect((await annotate([{ proposalId: 'p1', decision: 'confirmed', box, label: 'Scuff' }])).status).toBe(200);

    const after = (await memory.store.getEvidence(rentalId, [itemId]))[0]!;
    expect(after.sha256).toBe(before.sha256);
    expect(after.sha256).toBe(sha256(original));
    expect(after.gcsPath).toBe(before.gcsPath);
    expect(after.sealedManifestId).toBe(sealed.manifest.manifestId);
    expect(await objects.store.sha256(originalPath(rentalId, itemId))).toBe(sha256(original));
    expect(await memory.store.getManifest(rentalId, sealed.manifest.manifestId)).toEqual(manifestBefore);
    // The model copy is not stored next to the original.
    expect([...objects.objects.keys()]).toEqual([originalPath(rentalId, itemId)]);
  });

  it('refuses decisions on proposals the photo does not have, and malformed boxes', async () => {
    const { analyze, receive, annotate } = await setup();
    await receive();
    // Before analysis, only added boxes.
    expect((await annotate([{ proposalId: 'p1', decision: 'confirmed', box, label: 'Scuff' }])).status).toBe(400);
    expect((await annotate([{ proposalId: null, decision: 'added', box, label: 'Scuff' }])).status).toBe(200);
    await analyze();
    expect((await annotate([{ proposalId: 'p9', decision: 'confirmed', box, label: 'Scuff' }])).status).toBe(400);
    expect((await annotate([{ proposalId: null, decision: 'confirmed', box, label: 'Scuff' }])).status).toBe(400);
    expect((await annotate([{ proposalId: 'p1', decision: 'added', box, label: 'Scuff' }])).status).toBe(400);
    expect(
      (
        await annotate([
          { proposalId: 'p1', decision: 'confirmed', box, label: 'A' },
          { proposalId: 'p1', decision: 'rejected', box, label: 'B' },
        ])
      ).status,
    ).toBe(400);
    expect((await annotate([{ proposalId: null, decision: 'added', box: { x: 0.9, y: 0, width: 0.2, height: 0.1 }, label: 'Off' }])).status).toBe(400);
    expect((await annotate([{ proposalId: null, decision: 'added', box, label: 'Scuff' }], 'mallory')).status).toBe(403);
  });

  it('keeps added boxes and still-valid decisions when the photo is analyzed again', async () => {
    const { analyze, receive, annotate, memory, rentalId } = await setup();
    await receive();
    await analyze();
    await annotate([
      { proposalId: 'p3', decision: 'rejected', box, label: 'Not damage' },
      { proposalId: null, decision: 'added', box, label: 'Chip' },
    ]);
    await analyze();
    const [stored] = await memory.store.getEvidence(rentalId, [itemId]);
    expect(stored!.tenantAnnotations).toHaveLength(2);
  });
});

describe('report projection', () => {
  const box = { x: 0.2, y: 0.1, width: 0.3, height: 0.2 };

  it('carries the tenant decisions, never raw proposals, and the page drops rejected ones', async () => {
    const { analyze, receive, annotate, memory, rentalId } = await setup();
    await receive();
    await analyze();
    await annotate([
      { proposalId: 'p1', decision: 'confirmed', box, label: 'Scuff', description: 'scuff on wall' },
      { proposalId: 'p3', decision: 'rejected', box, label: 'Rejected box' },
    ]);
    const share: Share = { id: 'x', rentalId, scope: ['evidence'], createdAt: '', expiresAt: '', revokedAt: null, pinHash: null };
    const report = await projectReport(share, memory.store, {} as Shares, 'token', 'https://report.test');
    const [exhibit] = report!.exhibits;
    expect(exhibit!.annotations).toEqual([
      { box, label: 'Scuff', description: 'scuff on wall', decision: 'confirmed' },
      { box, label: 'Rejected box', description: '', decision: 'rejected' },
    ]);
    expect(acceptedAnnotations(exhibit!).map((a) => a.label)).toEqual(['Scuff']);
    expect(exhibit!.annotations.every((a) => validBox(a.box))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Looks like it could be mold');
  });
});

describe('damage pipeline', () => {
  it('normalizes [ymin, xmin, ymax, xmax] boxes and drops empty ones', () => {
    expect(normalizeBox([100, 200, 300, 500])).toEqual({ x: 0.2, y: 0.1, width: 0.3, height: 0.2 });
    expect(normalizeBox([300, 500, 100, 200])).toEqual({ x: 0.2, y: 0.1, width: 0.3, height: 0.2 });
    expect(normalizeBox([100, 100, 100, 400])).toBeNull();
  });

  it('keeps other damage as the model described it', () => {
    expect(proposal({ type: 'crack', description: ' hairline crack ', severity: 'minor', confidence: 'low' }, 4)).toMatchObject({
      id: 'p5',
      label: 'Crack',
      description: 'hairline crack',
      box: null,
      repairPath: false,
    });
  });

  it('runs on the vision stage and converts to a response schema', () => {
    expect(STAGES.vision).toEqual({ role: 'primary', thinking: 'minimal', output: 'schema' });
    expect(() => toResponseSchema(DamageResult)).not.toThrow();
  });
});
