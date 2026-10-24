import { describe, expect, it } from 'vitest';
import { deleteRentalObjects, evidenceBucket, evidenceBucketName, modelCopyPath, originalPath } from '../../src/storage/gcs.js';

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
