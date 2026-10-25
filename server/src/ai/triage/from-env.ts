import { getFirestore } from 'firebase-admin/firestore';
import { firebaseApp } from '../../firebase.js';
import type { Logger } from '../../log.js';
import { firestoreUsageSink } from '../../usage.js';
import { gemmaFromEnv } from '../gemma.js';
import { gemmaTriageProvider } from './gemma.js';
import { createTriage, type Triage } from './index.js';
import { keywordBackstop } from './keywords.js';

// Gemma and the backstop when a key is set. Without one (unit tests, the e2e
// emulators) the backstop decides alone; index.ts says so at startup.
export function triageFromEnv(log: Logger, env: NodeJS.ProcessEnv = process.env): Triage {
  const keywords = keywordBackstop();
  if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
    return createTriage({ model: null, keywords });
  }
  const gemma = gemmaFromEnv({ usage: firestoreUsageSink(getFirestore(firebaseApp(env))), log }, env);
  return createTriage({ model: gemmaTriageProvider(gemma), keywords });
}
