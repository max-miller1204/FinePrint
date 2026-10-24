import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../src/ratelimit.js';

function fakeClock(): Clock {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
}

const limits = () => ({ requestsPerMinute: 30, inputTokensPerMinute: 16_000 });

describe('RateLimiter', () => {
  it('lets 30 requests through a minute, then spaces them 2 s apart', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    const waits: number[] = [];
    for (let i = 0; i < 32; i++) waits.push(await limiter.acquire('m', 10));
    expect(waits.slice(0, 30).every((w) => w === 0)).toBe(true);
    expect(waits.slice(30)).toEqual([2_000, 2_000]);
  });

  it('budgets input tokens, and reports the wait', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    expect(await limiter.acquire('m', 12_000)).toBe(0);
    const reported: number[] = [];
    // 8,000 more tokens needs 4,000 refilled: 15 s at 16K per minute.
    expect(await limiter.acquire('m', 8_000, { onWait: (ms) => reported.push(ms) })).toBe(15_000);
    expect(reported).toEqual([15_000]);
  });

  it('runs a request larger than the bucket once the bucket is full, and charges the debt', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    await limiter.acquire('m', 1_000);
    // 31K tokens (a 12-page lease) waits for a full bucket: 1,000 tokens is 3.75 s.
    expect(await limiter.acquire('m', 31_000)).toBe(3_750);
    // The bucket is at -15,000, so even a small call waits for the debt.
    expect(await limiter.acquire('m', 1_000)).toBe(60_000);
  });

  it('keeps separate buckets per model', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    await limiter.acquire('a', 16_000);
    expect(await limiter.acquire('b', 16_000)).toBe(0);
  });

  it('settles the estimate against the reported count', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    await limiter.acquire('m', 16_000);
    limiter.settle('m', 16_000, 4_000);
    expect(await limiter.acquire('m', 12_000)).toBe(0);
  });

  it('waits after a drain (a 429)', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    limiter.drain('m');
    expect(await limiter.acquire('m', 0)).toBe(2_000);
  });

  it('serves callers in order', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    await limiter.acquire('m', 16_000);
    const order: string[] = [];
    await Promise.all([
      limiter.acquire('m', 8_000).then(() => order.push('big')),
      limiter.acquire('m', 10).then(() => order.push('small')),
    ]);
    expect(order).toEqual(['big', 'small']);
  });

  it('stops waiting when the signal aborts, and the next caller still runs', async () => {
    const limiter = new RateLimiter(limits, fakeClock());
    await limiter.acquire('m', 16_000);
    const controller = new AbortController();
    controller.abort(new Error('client left'));
    await expect(limiter.acquire('m', 8_000, { signal: controller.signal })).rejects.toThrow('client left');
    expect(await limiter.acquire('m', 4_000)).toBe(15_000);
  });
});
