import { getFirestore } from 'firebase-admin/firestore';
import { firebaseApp } from '../../firebase.js';
import type { Logger } from '../../log.js';
import { firestoreUsageSink } from '../../usage.js';
import { gemmaFromEnv } from '../gemma.js';
import { gemmaTriageProvider } from './gemma.js';
import { createTriage, type Triage } from './index.js';
import { keywordBackstop } from './keywords.js';

// A self-hosted Gemma (`GEMMA_PROVIDER=openai_compatible`, #56) needs no
// Gemini key; the hosted one does.
export function triageModelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GEMMA_PROVIDER === 'openai_compatible' || Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
}

// Gemma and the backstop when a model is configured. Without one (unit tests,
// the e2e emulators) the backstop decides alone; index.ts says so at startup.
export function triageFromEnv(log: Logger, env: NodeJS.ProcessEnv = process.env, makeGemma: typeof gemmaFromEnv = gemmaFromEnv): Triage {
  const keywords = keywordBackstop();
  if (!triageModelConfigured(env)) return createTriage({ model: null, keywords });
  const gemma = makeGemma({ usage: firestoreUsageSink(getFirestore(firebaseApp(env))), log }, env);
  return createTriage({ model: gemmaTriageProvider(gemma), keywords });
}
