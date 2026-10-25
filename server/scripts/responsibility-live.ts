// Live check of the responsibility check (#31) against a real model, on
// balanced cases (spec §7.11): a broken heater must be likely the
// landlord's, a window a guest broke likely the tenant's. The ambiguous case
// is reported, not gated: the `responsibility` eval set (#50) gates accuracy.
// The synthetic lease's clauses go in, so lease citations are exercised too.
//
// Usage (from server/):
//   ../scripts/with-gemini-key.sh pnpm smoke:responsibility
//
// Exit codes: 0 pass, 1 a check failed, 2 setup error.

import { readFileSync } from 'node:fs';
import { gemmaFromEnv, type GemmaClient } from '../src/ai/gemma.js';
import { checkResponsibility } from '../src/ai/pipeline/responsibility.js';
import type { Verdict } from '../src/ai/schemas/responsibility.js';
import { gemmaTriageProvider } from '../src/ai/triage/gemma.js';
import { createTriage } from '../src/ai/triage/index.js';
import { keywordBackstop } from '../src/ai/triage/keywords.js';
import type { AnalyzedLease } from '../src/models/lease.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../src/rules/loader.js';
import { memoryUsageSink } from '../src/usage.js';

const TEXT = readFileSync(new URL('../test/fixtures/lease-synthetic.txt', import.meta.url), 'utf8');

// The fixture's numbered clauses ("10. MAINTENANCE."), cut where S3 would cut them.
function clausesOf(text: string): AnalyzedLease {
  const starts = [...text.matchAll(/^(\d+)\. ([A-Z'][A-Z0-9' -]+)\./gm)];
  return {
    id: 'lease-synthetic',
    clauses: starts.map((m, i) => {
      const charStart = m.index;
      const charEnd = starts[i + 1]?.index ?? text.length;
      return { id: `c${i + 1}`, heading: m[2]!, verbatim: text.slice(charStart, charEnd).trim(), charStart, charEnd: charStart + text.slice(charStart, charEnd).trim().length };
    }),
  };
}

const CASES: { name: string; description: string; expected: Verdict | null }[] = [
  {
    name: 'heater',
    description: 'The heater in my bedroom stopped working last night. It is January and the apartment is very cold. I did not do anything to it.',
    expected: 'likely_landlord',
  },
  {
    name: 'guest-window',
    description: 'My friend was visiting and threw a baseball inside. It hit the living room window and cracked the glass.',
    expected: 'likely_tenant',
  },
  {
    name: 'ceiling-stain',
    description: "There is a brown stain on the bedroom ceiling. I don't know how long it has been there or what caused it.",
    expected: null,
  },
];

const usage = memoryUsageSink();
let gemma: GemmaClient;
let pack: ReturnType<typeof loadRulePack>;
try {
  gemma = gemmaFromEnv({ usage });
  pack = loadRulePack(`${JURISDICTIONS_ROOT}/va`, { requireVerified: true });
} catch (err) {
  console.error(`setup error: ${(err as Error).message}`);
  process.exit(2);
}
const triage = createTriage({ model: gemmaTriageProvider(gemma), keywords: keywordBackstop() });
const lease = clausesOf(TEXT);

let failed = false;
const check = (ok: boolean, label: string) => {
  if (!ok) failed = true;
  console.log(`[${ok ? 'ok ' : 'ERR'}] ${label}`);
};

for (const { name, description, expected } of CASES) {
  console.log(`\n== ${name}`);
  const started = Date.now();
  let result: Awaited<ReturnType<typeof checkResponsibility>>;
  try {
    result = await checkResponsibility({ description, locale: 'en', today: '2026-10-25', lease, moveIn: [] }, { gemma, pack, triage });
  } catch (err) {
    check(false, `${name}: ${(err as Error).name}: ${(err as Error).message}`);
    continue;
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  if (result.status === 'escalated') {
    check(false, `${name}: escalated as ${result.triage.category} (model ${JSON.stringify(result.triage.model)})`);
    continue;
  }
  console.log(`  ${result.verdict} / ${result.category} / ${result.confidence}${result.downgraded ? ' (downgraded)' : ''}, verifier ${result.verification.status}${result.verification.verdict ? ` (${result.verification.verdict})` : ''}`);
  console.log(`  ${result.usage.calls} calls, ${result.usage.promptTokens} in / ${result.usage.outputTokens} out tokens, ${seconds} s, models ${result.usage.models.join(', ')}${result.usage.fallback ? ' (FALLBACK)' : ''}`);
  for (const r of result.reasons) {
    const c = r.citation;
    const where = c.kind === 'lease' ? `${c.ref} ${JSON.stringify(c.quote.slice(0, 70))}` : c.ref;
    console.log(`  reason [${c.kind} ${where}] ${r.text}`);
  }
  for (const s of result.whatWouldChange) console.log(`  would change: ${s}`);
  for (const d of result.drops) console.log(`  dropped ${d.reason}${d.ref ? ` (${d.ref})` : ''}`);
  console.log(`  escrowEligible ${result.escrowEligible}`);

  check(result.reasons.length > 0, `${name}: ${result.reasons.length} cited reasons`);
  check(result.confidence !== 'high' || result.verification.status === 'agreed', `${name}: high only with 31B agreeing`);
  if (expected) check(result.verdict === expected, `${name}: verdict ${result.verdict}, expected ${expected}`);
  else console.log(`  REPORT: ${name} verdict ${result.verdict}`);
}

console.log(failed ? '\nFAIL' : '\nPASS');
process.exit(failed ? 1 : 0);
