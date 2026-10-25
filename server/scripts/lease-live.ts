// Live check of the lease pipeline, S1 to S6 (#14), against a real model:
// the synthetic lease (test/fixtures/lease-synthetic.txt) must yield its
// three planted deterministic violations in 8 calls or fewer, and a variant
// with those amounts fixed must yield none. Planted semantic clauses are
// reported, not gated: their precision and recall gate is the lease eval
// set's (#20).
//
// Usage (from server/):
//   op run --env-file ../.env -- pnpm smoke:lease
//
// Exit codes: 0 pass, 1 a check failed, 2 setup error.

import { readFileSync } from 'node:fs';
import { gemmaFromEnv, type GemmaClient } from '../src/ai/gemma.js';
import { analyzeLease, MAX_CALLS, type LeaseEvent } from '../src/ai/pipeline/lease.js';
import { gemmaTriageProvider } from '../src/ai/triage/gemma.js';
import { createTriage } from '../src/ai/triage/index.js';
import { keywordBackstop } from '../src/ai/triage/keywords.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../src/rules/loader.js';
import { memoryUsageSink } from '../src/usage.js';

const LEASE = readFileSync(new URL('../test/fixtures/lease-synthetic.txt', import.meta.url), 'utf8');
// The same lease with the three deterministic plants fixed (the semantic ones stay).
const AMOUNTS_FIXED = LEASE.replace('fifteen percent (15%)', 'five percent (5%)')
  .replace('$4,500.00 (three months\' rent)', '$1,500.00 (one month\'s rent)')
  .replace('twenty-four (24) hours\'', 'seventy-two (72) hours\'');

const PLANTED_CHECKS = ['VA_DEPOSIT_CAP', 'VA_LATE_FEE_CAP', 'VA_ROUTINE_MAINTENANCE_NOTICE_72H'];
const PLANTED_SEMANTIC: Record<string, string> = {
  VA_NO_RIGHTS_WAIVER: '19. WAIVER',
  VA_NO_CONFESSION_OF_JUDGMENT: '20. CONFESSION',
  VA_NO_EXCULPATION_INDEMNITY: '17. LIABILITY',
  VA_NO_LANDLORD_ATTORNEY_FEES: '21. ATTORNEY',
  VA_LANDLORD_MAINTAIN_FIT: '10. MAINTENANCE',
};

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

let failed = false;
const check = (ok: boolean, label: string) => {
  if (!ok) failed = true;
  console.log(`[${ok ? 'ok ' : 'ERR'}] ${label}`);
};

for (const [name, text, expected] of [
  ['synthetic', LEASE, PLANTED_CHECKS],
  ['amounts-fixed', AMOUNTS_FIXED, []],
] as const) {
  console.log(`\n== ${name} lease (${text.length} chars)`);
  const started = Date.now();
  const recordsBefore = usage.records.length;
  const onEvent = (e: LeaseEvent) => {
    if (e.type === 'stage') console.log(`  ${e.stage} ${e.label}`);
    if (e.type === 'model' && e.event.type !== 'waiting') console.log(`  model ${JSON.stringify(e.event)}`);
    if (e.type === 'model' && e.event.type === 'waiting') console.log(`  waiting ${Math.round(e.event.waitMs / 1000)} s for ${e.event.model}`);
  };
  let analysis: Awaited<ReturnType<typeof analyzeLease>>;
  try {
    analysis = await analyzeLease({ leaseId: `lease-${name}`, text, locale: 'en', today: '2026-10-24' }, { gemma, pack, triage }, { onEvent });
  } catch (err) {
    check(false, `${name}: ${(err as Error).name}: ${(err as Error).message}`);
    continue;
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const requests = usage.records.length - recordsBefore;
  console.log(`  ${analysis.usage.calls} calls (${requests} requests), ${analysis.usage.promptTokens} in / ${analysis.usage.outputTokens} out tokens, ${seconds} s, models ${analysis.usage.models.join(', ')}${analysis.usage.fallback ? ' (FALLBACK)' : ''}`);
  check(analysis.status === 'analyzed', `${name}: status ${analysis.status}`);
  if (analysis.status !== 'analyzed') continue;

  console.log(`  term ${analysis.term.start} to ${analysis.term.end} (${analysis.term.source}), ${analysis.clauses.length} clauses, injection ${analysis.injection.detected}`);
  for (const t of analysis.keyTerms) console.log(`  key term ${t.name} = ${JSON.stringify(t.value)} -> ${t.amount ?? t.date} (${t.clauseId})`);
  for (const c of analysis.checks) console.log(`  S4 ${c.ruleId}: ${c.outcome}${c.limit !== undefined ? ` (limit ${c.limit}, actual ${c.actual} ${c.unit})` : ''}`);
  for (const m of analysis.mappings) {
    const heading = analysis.clauses.find((c) => c.id === m.clauseId)?.heading;
    console.log(`  S5 ${m.clauseId} ${JSON.stringify(heading)} ${m.assessment} [${m.rules.map((r) => r.ruleId).join(', ')}] ${JSON.stringify(m.leaseQuote.slice(0, 80))}`);
  }
  const dropCounts = new Map<string, number>();
  for (const d of analysis.drops) dropCounts.set(`${d.stage} ${d.reason}`, (dropCounts.get(`${d.stage} ${d.reason}`) ?? 0) + 1);
  for (const [reason, n] of dropCounts) console.log(`  dropped ${n} x ${reason}`);

  const violations = analysis.checks.filter((c) => c.outcome === 'violates').map((c) => c.ruleId).sort();
  check(JSON.stringify(violations) === JSON.stringify([...expected].sort()), `${name}: deterministic violations ${JSON.stringify(violations)}`);
  check(analysis.usage.calls <= MAX_CALLS, `${name}: ${analysis.usage.calls} calls <= ${MAX_CALLS}`);
  check(analysis.term.source === 'lease' && analysis.term.start === '2026-11-01' && analysis.term.end === '2027-10-31', `${name}: lease term read from the lease`);

  if (name === 'synthetic') {
    let found = 0;
    for (const [ruleId, heading] of Object.entries(PLANTED_SEMANTIC)) {
      const clause = analysis.clauses.find((c) => c.verbatim.startsWith(heading));
      const hit = analysis.mappings.find((m) => m.clauseId === clause?.id && m.rules.some((r) => r.ruleId === ruleId) && m.assessment !== 'complies');
      if (hit) found++;
      console.log(`  [${hit ? 'hit' : 'miss'}] planted ${ruleId}${hit ? ` (${hit.assessment})` : ''}`);
    }
    console.log(`  REPORT: planted semantic clauses found ${found}/${Object.keys(PLANTED_SEMANTIC).length}`);
  }
}

console.log(failed ? '\nFAIL' : '\nPASS');
process.exit(failed ? 1 : 0);
