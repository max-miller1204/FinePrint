import { getApps, initializeApp, type App } from 'firebase-admin/app';

// The one firebase-admin app that auth, Firestore, and Storage share.

// FIREBASE_PROJECT_ID, else GOOGLE_CLOUD_PROJECT, else GCLOUD_PROJECT (set by
// `firebase emulators:exec`). Undefined means Application Default Credentials
// pick the project.
export function projectIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT;
}

export function firebaseApp(env: NodeJS.ProcessEnv = process.env): App {
  const projectId = projectIdFromEnv(env);
  return getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined);
}
