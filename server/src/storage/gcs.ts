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
// Content-Type.
export async function signedUploadUrl(bucket: Bucket, path: string, contentType: string, now = Date.now()): Promise<string> {
  const [url] = await bucket.file(path).getSignedUrl({ version: 'v4', action: 'write', contentType, expires: now + SIGNED_URL_TTL_MS });
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
