import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { getStorage } from 'firebase-admin/storage';
import { firebaseApp, projectIdFromEnv } from '../firebase.js';
import { isDocumentId } from './firestore.js';

// Evidence photos in Cloud Storage (spec §6.2). The bucket has no public
// access: clients upload and read only through short-lived signed URLs.
// Under FIREBASE_STORAGE_EMULATOR_HOST, firebase-admin talks to the emulator.

export type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

export const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

// GCS_EVIDENCE_BUCKET, else `{project}-evidence`.
export function evidenceBucketName(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GCS_EVIDENCE_BUCKET) return env.GCS_EVIDENCE_BUCKET;
  const projectId = projectIdFromEnv(env);
  if (!projectId) throw new Error('Set GCS_EVIDENCE_BUCKET or a project ID to name the evidence bucket');
  return `${projectId}-evidence`;
}

export function evidenceBucket(env: NodeJS.ProcessEnv = process.env): Bucket {
  return getStorage(firebaseApp(env)).bucket(evidenceBucketName(env));
}

// The original as captured, never modified.
export const originalPath = (rentalId: string, itemId: string) => `rentals/${rentalId}/evidence/${itemId}.heic`;
// The 1536 px long-edge copy sent to Gemma.
export const modelCopyPath = (rentalId: string, itemId: string) => `rentals/${rentalId}/model/${itemId}.jpg`;
// Checked, so a bad id can never widen a prefix delete.
function rentalPrefix(rentalId: string) {
  if (!isDocumentId(rentalId)) throw new Error('Not a rental id');
  return `rentals/${rentalId}/`;
}

// A V4 URL the app PUTs the bytes to. The upload must send the same
// Content-Type and, when `sha256` is given, `x-goog-content-sha256`: both
// are signed, so a request without them is refused. Cloud Storage does not
// hash the body against that header on a signed-URL PUT (checked on Cloud
// Run, tests/deployed/evidence.e2e.ts), so `complete` hashing the stored
// bytes is what rejects other bytes (spec §5.3).
export async function signedUploadUrl(bucket: Bucket, path: string, contentType: string, now = Date.now(), sha256?: string): Promise<string> {
  const [url] = await bucket.file(path).getSignedUrl({
    version: 'v4',
    action: 'write',
    contentType,
    expires: now + SIGNED_URL_TTL_MS,
    ...(sha256 === undefined ? {} : { extensionHeaders: { 'x-goog-content-sha256': sha256 } }),
  });
  return url;
}

// A V4 URL for the app or the web report to GET the bytes.
export async function signedReadUrl(bucket: Bucket, path: string, now = Date.now()): Promise<string> {
  const [url] = await bucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: now + SIGNED_URL_TTL_MS });
  return url;
}

// Every object of a rental, for "Delete everything" and the purge.
export async function deleteRentalObjects(bucket: Bucket, rentalId: string): Promise<void> {
  await bucket.deleteFiles({ prefix: rentalPrefix(rentalId) });
}

// Where the app sends one original: a URL and the headers it must send with
// it, exactly.
export interface UploadTarget {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface DeclaredObject {
  contentType: string;
  sha256: string;
  bytes: number;
}

// The evidence bucket as the routes use it. Unit tests swap in memory.
export interface EvidenceObjects {
  uploadTarget(path: string, declared: DeclaredObject, now: Date): Promise<UploadTarget>;
  // Null when nothing is stored at `path`.
  stat(path: string): Promise<{ bytes: number; contentType: string | null } | null>;
  // Reads the stored bytes and hashes them. Cloud Storage keeps MD5 and
  // CRC32C, never SHA-256, so this is the only way to know the stored hash.
  sha256(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  // Every object of one rental, originals and model copies. "Delete
  // everything" and the purge call it.
  removeRental(rentalId: string): Promise<void>;
}

// Signed URLs need a service account key or IAM signBlob, which the Storage
// emulator has neither of, and it serves no XML API PUT. Under the emulator
// the server opens a resumable upload session instead: its URL takes one PUT
// of the whole body, like a signed URL. The emulator checks no hash on
// upload, so the hash on `complete` is what catches a mismatch there.
export function gcsObjects(bucket: () => Bucket = () => evidenceBucket(), env: NodeJS.ProcessEnv = process.env): EvidenceObjects {
  const emulated = Boolean(env.FIREBASE_STORAGE_EMULATOR_HOST ?? env.STORAGE_EMULATOR_HOST);
  let cached: Bucket | undefined;
  const files = () => (cached ??= bucket());

  return {
    async uploadTarget(path, { contentType, sha256 }, now) {
      const expiresAt = new Date(now.getTime() + SIGNED_URL_TTL_MS).toISOString();
      const headers = { 'Content-Type': contentType, 'x-goog-content-sha256': sha256 };
      if (emulated) {
        const [url] = await files()
          .file(path)
          .createResumableUpload({ metadata: { contentType } });
        return { method: 'PUT', url, headers, expiresAt };
      }
      const url = await signedUploadUrl(files(), path, contentType, now.getTime(), sha256);
      return { method: 'PUT', url, headers, expiresAt };
    },

    async stat(path) {
      try {
        const [metadata] = await files().file(path).getMetadata();
        return { bytes: Number(metadata.size), contentType: metadata.contentType ?? null };
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code === 404) return null;
        throw err;
      }
    },

    async sha256(path) {
      const hash = createHash('sha256');
      await pipeline(files().file(path).createReadStream(), hash);
      return hash.digest('hex');
    },

    async remove(path) {
      await files().file(path).delete({ ignoreNotFound: true });
    },

    async removeRental(rentalId) {
      await deleteRentalObjects(files(), rentalId);
    },
  };
}
