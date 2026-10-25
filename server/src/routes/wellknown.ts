import { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import { ApiError } from '../errors.js';
import type { Signer } from '../integrity/kms.js';
import { available } from './seal.js';

// What the app needs to sign in to this deployment's Firebase project. A
// Firebase web API key identifies the project and is safe to publish; it
// grants nothing on its own. Serving it here lets one app build work with any
// organization's server (spec §15.3).
export interface ClientConfig {
  firebase: { apiKey: string; projectId: string; authEmulatorHost?: string };
}

// FIREBASE_API_KEY and the project ID come from deploy.sh. Under the Auth
// emulator the key can be anything, so it is optional there.
export function clientConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClientConfig | null {
  const projectId = env.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT;
  const authEmulatorHost = env.FIREBASE_AUTH_EMULATOR_HOST || undefined;
  const apiKey = env.FIREBASE_API_KEY ?? (authEmulatorHost ? 'fake-api-key' : undefined);
  if (!projectId || !apiKey) return null;
  return { firebase: { apiKey, projectId, ...(authEmulatorHost ? { authEmulatorHost } : {}) } };
}

export function createWellKnown(clientConfig: ClientConfig | null, signer: Signer | null) {
  const wellKnown = new Hono<AppEnv>();

  wellKnown.get('/fineprint-client.json', (c) => {
    if (!clientConfig) {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Sign-in is not set up on this server');
    }
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(clientConfig);
  });

  // The public keys that sign manifests and ledger entries, as a JWK Set
  // (RFC 7517). A signature's `keyId` is a key's `kid`.
  wellKnown.get('/fineprint-keys.json', async (c) => {
    const keys = await available(signer, c.get('log')).publicKeys();
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ keys });
  });

  return wellKnown;
}
