import { createHash } from 'node:crypto';
import type { EvidenceObjects } from '../src/storage/gcs.js';

// The evidence bucket without Cloud Storage. `put` stands in for the app's
// PUT to the upload URL; the emulator tests run the real one.
export function memoryObjects() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const issued: string[] = [];
  const store: EvidenceObjects = {
    async uploadTarget(path, { contentType, sha256 }, now) {
      issued.push(path);
      return {
        method: 'PUT',
        url: `https://storage.test/upload/${path}`,
        headers: { 'Content-Type': contentType, 'x-goog-content-sha256': sha256 },
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      };
    },
    async stat(path) {
      const object = objects.get(path);
      return object ? { bytes: object.body.length, contentType: object.contentType } : null;
    },
    async sha256(path) {
      const object = objects.get(path);
      if (!object) throw Object.assign(new Error('No such object'), { code: 404 });
      return createHash('sha256').update(object.body).digest('hex');
    },
    async remove(path) {
      objects.delete(path);
    },
    async removeRental(rentalId) {
      for (const path of [...objects.keys()]) if (path.startsWith(`rentals/${rentalId}/`)) objects.delete(path);
    },
  };
  const put = (path: string, body: Buffer, contentType = 'image/heic') => objects.set(path, { body, contentType });
  return { store, objects, issued, put };
}
