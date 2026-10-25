// The request limits every lease stage shares (docs/ai-pipeline.md, gap 3).

// Estimated input tokens (gemma.ts, 4 characters a token) per request, so
// each one fits in a minute of Gemma's 16K input tokens.
export const MAX_REQUEST_TOKENS = 12_000;

// Output caps (gemma.ts, maxOutputTokens), sized to the work so a looping
// answer is cut off and retried instead of running for minutes, while a long
// lease still fits.
const MIN_OUTPUT_TOKENS = 4_096;
export const MAX_OUTPUT_TOKENS = 16_384;
export const clampOutput = (tokens: number) => Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.ceil(tokens)));

export const textTokens = (text: string) => Math.ceil(text.length / 4);

// Splits items into as few requests as fit `room` estimated tokens each, in
// order. An item bigger than the room still goes, alone.
export function batchByTokens<T>(items: readonly T[], tokens: (item: T) => number, room: number): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let used = 0;
  for (const item of items) {
    const t = tokens(item);
    if (batch.length > 0 && used + t > room) {
      batches.push(batch);
      batch = [];
      used = 0;
    }
    batch.push(item);
    used += t;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
