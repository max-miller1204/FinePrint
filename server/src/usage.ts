// One record per model request, for cost and quota tracking (spec §6.1, §14).
// Records hold counts, ids, and timings only: never a prompt, a document, or
// an answer.

import type { Firestore } from 'firebase-admin/firestore';
import type { Stage } from './ai/models.js';

export type UsageOutcome =
  // The answer parsed and matched the schema.
  | 'ok'
  // The API answered, but the output was not valid JSON for the schema.
  | 'invalid_output'
  // HTTP 429 or 5xx; the client backs off and tries again, or falls back.
  | 'retryable_error'
  // Any other failure, such as HTTP 400.
  | 'error';

export interface UsageRecord {
  stage: Stage;
  // The model that was asked. Differs from the role's first choice on a fallback.
  model: string;
  // True when `model` is not the first model in the stage's chain.
  fallback: boolean;
  outcome: UsageOutcome;
  httpStatus: number | null;
  attempt: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  latencyMs: number;
  waitedMs: number;
  at: string;
}

export interface UsageSink {
  record(record: UsageRecord): Promise<void>;
}

// `usage/{yyyy-mm-dd}/calls/{autoId}`. Spec §6.1 writes `usage/{yyyy-mm-dd}/{autoId}`,
// but Firestore paths alternate collection and document, so the day document
// holds a `calls` subcollection.
export function firestoreUsageSink(db: Firestore): UsageSink {
  return {
    async record(record) {
      await db.collection('usage').doc(record.at.slice(0, 10)).collection('calls').add(record);
    },
  };
}

export function memoryUsageSink(): UsageSink & { records: UsageRecord[] } {
  const records: UsageRecord[] = [];
  return {
    records,
    async record(record) {
      records.push(record);
    },
  };
}
