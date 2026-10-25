// Live check of the photo damage pipeline (#26) against a real model, on a
// move-in fixture photo. Prints the proposals; fails only when the answer
// breaks a rule code owns: boxes inside the photo, and mold or pests never
// named outright.
//
// Usage (from server/):
//   ../scripts/with-secrets.sh pnpm smoke:damage [photo.jpg]
//
// Exit codes: 0 pass, 1 a check failed, 2 setup error.

import { readFileSync } from 'node:fs';
import { gemmaFromEnv, type GemmaClient } from '../src/ai/gemma.js';
import { analyzeDamage } from '../src/ai/pipeline/damage.js';
import { validBox } from '../src/report/model.js';
import { memoryUsageSink } from '../src/usage.js';

const path = process.argv[2] ?? new URL('../../e2e/fixtures/photos/move-in/01-kitchen-wall.jpg', import.meta.url);
const usage = memoryUsageSink();
let gemma: GemmaClient;
try {
  gemma = gemmaFromEnv({ usage });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
}

const started = Date.now();
const analysis = await analyzeDamage(gemma, { image: readFileSync(path), room: 'Kitchen', checklistItem: 'Walls' });
console.log(JSON.stringify(analysis, null, 2));
console.log(`${analysis.model}${analysis.fallback ? ' (fallback)' : ''}, ${Date.now() - started} ms`);

const problems = analysis.proposals.flatMap((p) => [
  ...(p.box && !validBox(p.box) ? [`${p.id}: box leaves the photo`] : []),
  ...(p.repairPath && /\b(is|has) (mou?ld|pests?)\b/i.test(p.description) ? [`${p.id}: asserts a diagnosis`] : []),
]);
for (const problem of problems) console.error(`FAIL ${problem}`);
process.exit(problems.length > 0 ? 1 : 0);
