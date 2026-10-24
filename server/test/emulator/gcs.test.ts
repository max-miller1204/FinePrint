import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { deleteRentalObjects, evidenceBucket, evidenceBucketName, gcsObjects, modelCopyPath, originalPath } from '../../src/storage/gcs.js';

// Runs under `pnpm test:emulator`, with the Storage emulator.

describe('evidence paths and bucket name', () => {
  it('follow the spec §6.2 layout', () => {
    expect(originalPath('r1', 'e1')).toBe('rentals/r1/evidence/e1.heic');
    expect(modelCopyPath('r1', 'e1')).toBe('rentals/r1/model/e1.jpg');
    expect(evidenceBucketName({ GCLOUD_PROJECT: 'demo-fineprint' })).toBe('demo-fineprint-evidence');
    expect(evidenceBucketName({ GCLOUD_PROJECT: 'demo-fineprint', GCS_EVIDENCE_BUCKET: 'other' })).toBe('other');
    expect(() => evidenceBucketName({})).toThrow();
  });
});

describe.runIf(process.env.FIREBASE_STORAGE_EMULATOR_HOST)('evidence bucket against the Storage emulator', () => {
  it('deletes every object of one rental and no other', async () => {
    const bucket = evidenceBucket();
    await Promise.all(
      [originalPath('r1', 'e1'), modelCopyPath('r1', 'e1'), originalPath('r10', 'e2')].map((path) => bucket.file(path).save(Buffer.from('bytes'))),
    );
    await deleteRentalObjects(bucket, 'r1');
    const [left] = await bucket.getFiles({ prefix: 'rentals/' });
    expect(left.map((file) => file.name)).toEqual([originalPath('r10', 'e2')]);
  });

  it('refuses an id that would widen the delete', async () => {
    await expect(deleteRentalObjects(evidenceBucket(), '')).rejects.toThrow();
    await expect(deleteRentalObjects(evidenceBucket(), '../x')).rejects.toThrow();
  });
});

describe.runIf(process.env.FIREBASE_STORAGE_EMULATOR_HOST)('evidence uploads against the Storage emulator', () => {
  it('takes one PUT at the upload URL, then reports the stored size, type, and SHA-256', async () => {
    const objects = gcsObjects();
    const path = originalPath('r-upload', crypto.randomUUID());
    const body = Buffer.from('photo bytes for the emulator');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const target = await objects.uploadTarget(path, { contentType: 'image/heic', sha256, bytes: body.length }, new Date());
    expect(target).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/heic', 'x-goog-content-sha256': sha256 } });
    // The simulator reaches the emulator at the host the server uses.
    expect(new URL(target.url).host).toBe(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
    // What the app does: no credentials, just the URL and its headers.
    const put = await fetch(target.url, { method: 'PUT', headers: target.headers, body });
    expect(put.status).toBe(200);

    expect(await objects.stat(path)).toEqual({ bytes: body.length, contentType: 'image/heic' });
    expect(await objects.sha256(path)).toBe(sha256);
    await objects.remove(path);
    expect(await objects.stat(path)).toBeNull();
  });
});
