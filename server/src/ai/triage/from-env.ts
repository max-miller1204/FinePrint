import { getFirestore } from 'firebase-admin/firestore';
import { firebaseApp } from '../../firebase.js';
import type { Logger } from '../../log.js';
import { firestoreUsageSink } from '../../usage.js';
import { gemmaFromEnv, type GemmaClient } from '../gemma.js';
import { gemmaTriageProvider } from './gemma.js';
import { createTriage, type Triage } from './index.js';
import { keywordBackstop } from './keywords.js';

// A self-hosted Gemma (`GEMMA_PROVIDER=openai_compatible`, #56) needs no
// Gemini key; the hosted one does.
export function triageModelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GEMMA_PROVIDER === 'openai_compatible' || Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
}

// The one Gemma client the app's model-backed routes share, so its rate
// limiter sees every call. Null without a model (unit tests, the e2e
// emulators); index.ts says so at startup.
export function modelFromEnv(log: Logger, env: NodeJS.ProcessEnv = process.env, makeGemma: typeof gemmaFromEnv = gemmaFromEnv): GemmaClient | null {
  if (!triageModelConfigured(env)) return null;
  return makeGemma({ usage: firestoreUsageSink(getFirestore(firebaseApp(env))), log }, env);
}

// Gemma and the backstop when there is a model; the backstop alone without.
export function triageWith(gemma: GemmaClient | null): Triage {
  return createTriage({ model: gemma ? gemmaTriageProvider(gemma) : null, keywords: keywordBackstop() });
}

export function triageFromEnv(log: Logger, env: NodeJS.ProcessEnv = process.env, makeGemma: typeof gemmaFromEnv = gemmaFromEnv): Triage {
  return triageWith(modelFromEnv(log, env, makeGemma));
}
