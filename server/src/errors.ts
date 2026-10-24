import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'HASH_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL';

// The one error shape every route returns (spec §13).
// `retryInMs` is present only when the client should retry after a wait.
export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; retryInMs?: number };
}

// Throw from any handler; the app's error handler turns it into the envelope.
// `message` is sent to the client, so it must never contain user content.
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly retryInMs: number | undefined;

  constructor(status: ContentfulStatusCode, code: ErrorCode, message: string, options: { retryInMs?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryInMs = options.retryInMs;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryInMs === undefined ? {} : { retryInMs: this.retryInMs }),
      },
    };
  }
}
