// Token-bucket limiter for the model API (spec §7.1 principle 5, §14).
// Quota is per project and per model, and input tokens per minute bind before
// requests do (docs/ai-pipeline.md, gap 3), so each model has two buckets:
// one for requests and one for input tokens. Callers wait in FIFO order, so a
// large lease analysis is not starved by a stream of small calls.

import type { ModelLimits } from './ai/models.js';

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

const MINUTE_MS = 60_000;

class Bucket {
  private level: number;
  private updatedAt: number;

  constructor(
    readonly capacity: number,
    private readonly clock: Clock,
  ) {
    this.level = capacity;
    this.updatedAt = clock.now();
  }

  current(): number {
    const now = this.clock.now();
    this.level = Math.min(this.capacity, this.level + ((now - this.updatedAt) * this.capacity) / MINUTE_MS);
    this.updatedAt = now;
    return this.level;
  }

  // Ms until the bucket holds `amount`. A cost larger than the whole bucket
  // waits for a full bucket, then goes into debt, which later callers repay.
  msUntil(amount: number): number {
    const needed = Math.min(amount, this.capacity) - this.current();
    return needed <= 0 ? 0 : Math.ceil((needed * MINUTE_MS) / this.capacity);
  }

  take(amount: number) {
    this.current();
    this.level -= amount;
  }

  // Credits back an overestimate or charges an underestimate.
  adjust(delta: number) {
    this.current();
    this.level = Math.min(this.capacity, this.level - delta);
  }

  empty() {
    this.current();
    this.level = Math.min(this.level, 0);
  }
}

interface ModelState {
  requests: Bucket;
  tokens: Bucket;
  tail: Promise<void>;
}

export interface AcquireOptions {
  signal?: AbortSignal;
  // Called once when the call has to wait, so the SSE stream can say how long.
  onWait?: (waitMs: number) => void;
}

export class RateLimiter {
  private readonly models = new Map<string, ModelState>();

  constructor(
    private readonly limitsFor: (model: string) => ModelLimits,
    private readonly clock: Clock = systemClock,
  ) {}

  // Resolves with the ms spent waiting once one request and `inputTokens`
  // are reserved for `model`.
  acquire(model: string, inputTokens: number, options: AcquireOptions = {}): Promise<number> {
    const state = this.state(model);
    const turn = state.tail.then(() => this.take(state, inputTokens, options));
    state.tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  // After the call, swap the estimate for the count the API reported.
  settle(model: string, estimatedTokens: number, actualTokens: number) {
    this.state(model).tokens.adjust(actualTokens - estimatedTokens);
  }

  // A 429 means the quota is spent elsewhere too (another instance, a smoke
  // run): stop sending to this model until the buckets refill.
  drain(model: string) {
    const state = this.state(model);
    state.requests.empty();
    state.tokens.empty();
  }

  private async take(state: ModelState, inputTokens: number, { signal, onWait }: AcquireOptions): Promise<number> {
    const started = this.clock.now();
    let reported = false;
    for (;;) {
      signal?.throwIfAborted();
      const waitMs = Math.max(state.requests.msUntil(1), state.tokens.msUntil(inputTokens));
      if (waitMs === 0) {
        state.requests.take(1);
        state.tokens.take(inputTokens);
        return this.clock.now() - started;
      }
      if (!reported) {
        onWait?.(waitMs);
        reported = true;
      }
      await this.clock.sleep(waitMs, signal);
    }
  }

  private state(model: string): ModelState {
    let state = this.models.get(model);
    if (!state) {
      const limits = this.limitsFor(model);
      state = {
        requests: new Bucket(limits.requestsPerMinute, this.clock),
        tokens: new Bucket(limits.inputTokensPerMinute, this.clock),
        tail: Promise.resolve(),
      };
      this.models.set(model, state);
    }
    return state;
  }
}
