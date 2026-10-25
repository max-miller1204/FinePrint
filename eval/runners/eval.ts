// `pnpm eval` (spec §12, #20): the lease eval sets against the real model,
// then the citations gate over every finding they produced.
//
//   scripts/with-secrets.sh pnpm eval                 # all three; writes docs/eval-results.md
//   pnpm eval --only lease-synthetic                                        # one set (citations still runs on it)
//   pnpm eval --stage-mode extraction=schema,mapping=schema                 # override output modes (models.ts)
//
// Sets:
//   lease-synthetic  the 12-page lease with 8 plants and 2 clean variants,
//                    S1 to S8. Gate: recall >= 0.9 and precision >= 0.85.
//   clauses-golden   60 excerpts through S5, S6, S7, and the severity table.
//                    Per-rule precision and recall, verifier agreement. Report.
//   citations        every finding above: lease quote and statute quote
//                    resolve (citations.ts). Gate: 100%.
//
// The three leases and the golden batches are about 30 minutes on the free
// tier: Gemma's 16K input tokens a minute paces every call. A full run with
// the default output modes rewrites docs/eval-results.md; any other run
// writes out/eval.json only (gitignored). Exits 1 when a gate fails or a
// lease could not be analyzed (a model outage is not a result), 2 on a
// setup error.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gemmaFromEnv, type GemmaClient } from '../../server/src/ai/gemma.js';
import { type OutputMode, type Stage, STAGES } from '../../server/src/ai/models.js';
import { gemmaTriageProvider } from '../../server/src/ai/triage/gemma.js';
import { createTriage } from '../../server/src/ai/triage/index.js';
import { keywordBackstop } from '../../server/src/ai/triage/keywords.js';
import { createLogger } from '../../server/src/log.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../../server/src/rules/loader.js';
import { memoryUsageSink } from '../../server/src/usage.js';
import { checkCitations, type CitationSource, type CitationsResult } from './citations.js';
import { type GoldenResult, runClausesGolden } from './clauses-golden.js';
import { type LeaseSyntheticResult, PRECISION_GATE, RECALL_GATE, runLeaseSynthetic } from './lease-synthetic.js';

const SETS = ['lease-synthetic', 'clauses-golden'] as const;
type SetName = (typeof SETS)[number];

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

const only = arg('--only')?.split(',') as SetName[] | undefined;
const unknownSet = only?.find((s) => !SETS.includes(s));
const modes = new Map<Stage, OutputMode>();
for (const pair of arg('--stage-mode')?.split(',') ?? []) {
  const [stage, mode] = pair.split('=') as [Stage, OutputMode];
  if (!(stage in STAGES) || (mode !== 'schema' && mode !== 'json')) {
    console.error(`setup error: --stage-mode ${pair} (want <stage>=schema|json)`);
    process.exit(2);
  }
  modes.set(stage, mode);
}
if (unknownSet) {
  console.error(`setup error: unknown set ${unknownSet} (${SETS.join(', ')})`);
  process.exit(2);
}
const running = only ?? [...SETS];

const PACK_DIR = join(JURISDICTIONS_ROOT, 'va');
const log = createLogger('eval', (line) => process.stderr.write(`${line}\n`));
const usage = memoryUsageSink();
const stages = Object.fromEntries(Object.entries(STAGES).map(([s, c]) => [s, modes.has(s as Stage) ? { ...c, output: modes.get(s as Stage)! } : c])) as typeof STAGES;
let gemma: GemmaClient;
let pack: ReturnType<typeof loadRulePack>;
try {
  gemma = gemmaFromEnv({ usage, log, stages });
  pack = loadRulePack(PACK_DIR, { requireVerified: true });
} catch (err) {
  console.error(`setup error: ${(err as Error).message}`);
  process.exit(2);
}
const triage = createTriage({ model: gemmaTriageProvider(gemma), keywords: keywordBackstop() });
const progress = (line: string) => console.log(`  ${line}`);
const started = Date.now();

let lease: LeaseSyntheticResult | null = null;
let golden: GoldenResult | null = null;
if (running.includes('lease-synthetic')) {
  console.log('== lease-synthetic');
  lease = await runLeaseSynthetic({ gemma, pack, triage, log }, progress);
}
if (running.includes('clauses-golden')) {
  console.log('== clauses-golden');
  try {
    golden = await runClausesGolden({ gemma, pack, log }, progress);
  } catch (err) {
    console.log(`  [ERR] clauses-golden: ${(err as Error).name}: ${(err as Error).message}`);
  }
}

const sources: CitationSource[] = [
  ...(lease?.outputs.map((o) => ({ set: 'lease-synthetic', ...o })) ?? []),
  ...(golden ? [{ set: 'clauses-golden', ...golden.output }] : []),
];
const citations = checkCitations(sources, pack, PACK_DIR);
const minutes = Math.round((Date.now() - started) / 6000) / 10;

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const frac = (a: number, b: number) => `${a}/${b}`;
const okModels = [...new Set(usage.records.filter((r) => r.outcome === 'ok').map((r) => r.model))];
const fellBack = usage.records.some((r) => r.outcome === 'ok' && r.fallback);
const modeLine = (Object.keys(STAGES) as Stage[])
  .filter((s) => ['extraction', 'mapping', 'verification', 'explanation'].includes(s))
  .map((s) => `${s} ${stages[s].output}`)
  .join(', ');

// The report: printed, and written to docs/eval-results.md on a full default run.
const lines: string[] = [];
const out = (line = '') => lines.push(line);
out(`Run ${new Date().toISOString().slice(0, 10)}, ${minutes} min. Models that answered: ${okModels.join(', ') || 'none'}${fellBack ? ' (a fallback answered at least once)' : ''}. Output modes: ${modeLine}.`);
out();
out('| Set | Metric | Result | Gate |');
out('| --- | --- | --- | --- |');
if (lease) {
  const tp = lease.scores.reduce((n, s) => n + s.tp, 0);
  const fn = lease.scores.reduce((n, s) => n + s.fn, 0);
  const fp = lease.scores.reduce((n, s) => n + s.fp, 0);
  const sev = lease.scores.reduce((n, s) => n + s.severityRight, 0);
  out(`| \`lease-synthetic\` | Recall | ${pct(lease.recall)} (${frac(tp, tp + fn)}) | >= ${RECALL_GATE} ${lease.recall !== null && lease.recall >= RECALL_GATE ? 'pass' : '**fail**'} |`);
  out(`| \`lease-synthetic\` | Precision | ${pct(lease.precision)} (${frac(tp, tp + fp)}) | >= ${PRECISION_GATE} ${lease.precision !== null && lease.precision >= PRECISION_GATE ? 'pass' : '**fail**'} |`);
  out(`| \`lease-synthetic\` | Severity accuracy | ${pct(lease.severityAccuracy)} (${frac(sev, tp)}) | report |`);
}
if (golden) {
  out(`| \`clauses-golden\` | Recall | ${pct(golden.recall)} | report |`);
  out(`| \`clauses-golden\` | Precision | ${pct(golden.precision)} | report |`);
  out(`| \`clauses-golden\` | Verifier agrees on violations | ${frac(golden.verifierAgreeOnViolations.agree, golden.verifierAgreeOnViolations.of)} | report |`);
  out(`| \`clauses-golden\` | Verifier agrees on look-alikes | ${frac(golden.verifierAgreeOnLookalikes.agree, golden.verifierAgreeOnLookalikes.of)} | report |`);
}
out(`| \`citations\` | Findings that resolve | ${pct(citations.rate)} (${frac(citations.resolved, citations.findings)}) | 100% ${citations.pass ? 'pass' : '**fail**'} |`);

if (lease) {
  out();
  out('### lease-synthetic');
  out();
  out('| Lease | Status | Calls | Seconds | Unverified | TP | FP | FN |');
  out('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [i, s] of lease.scores.entries()) {
    const r = lease.runs[i]!;
    out(`| \`${s.id}\` | ${s.status}${r.error ? ` (${r.error})` : ''} | ${r.calls} | ${r.seconds} | ${r.unverified} | ${s.tp} | ${s.fp} | ${s.fn} |`);
  }
  out();
  out('| Rule | TP | FP | FN |');
  out('| --- | --- | --- | --- |');
  for (const r of lease.perRule) out(`| \`${r.ruleId}\` | ${r.tp} | ${r.fp} | ${r.fn} |`);
  out();
  for (const s of lease.scores) {
    for (const f of s.flagged.filter((f) => !f.planted)) out(`- False positive on \`${s.id}\`: \`${f.ruleId}\` ${f.severity} (${f.basis}${f.verifier ? `, verifier ${f.verifier}` : ''}) in ${f.heading ?? 'no clause'}`);
    for (const m of s.missed) out(`- Missed on \`${s.id}\`: \`${m}\``);
    for (const w of s.wrongSeverity) out(`- Wrong severity on \`${s.id}\`: \`${w}\``);
  }
}
if (golden) {
  out();
  out('### clauses-golden');
  out();
  out(`${golden.rows.length} excerpts, ${golden.calls} calls, ${golden.drops} S6 or S7 drops.`);
  out();
  out('| Rule | TP | FN | FP | TN |');
  out('| --- | --- | --- | --- | --- |');
  for (const r of golden.perRule) out(`| \`${r.ruleId}\` | ${r.tp} | ${r.fn} | ${r.fp} | ${r.tn} |`);
  out();
  for (const r of golden.rows) {
    const right = r.expected === 'match' ? r.flagged : !r.flagged;
    if (!right) out(`- \`${r.id}\` (${r.expected}): S5 ${r.assessment ?? 'did not cite the rule'}${r.verifier ? `, verifier ${r.verifier}` : ''}, severity ${r.severity ?? 'none'}`);
  }
  const others = golden.rows.filter((r) => r.otherRules.length > 0);
  if (others.length > 0) out(`- Flags for another rule (not scored): ${others.map((r) => `\`${r.id}\` -> ${r.otherRules.join(', ')}`).join('; ')}`);
}
if (citations.failures.length > 0) {
  out();
  out('### citations failures');
  out();
  for (const f of citations.failures) out(`- \`${f.set}/${f.id}\` ${f.findingId} \`${f.ruleId ?? 'not_covered'}\`: ${f.problem}`);
}

console.log(`\n${lines.join('\n')}\n`);

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../out/eval.json', import.meta.url),
  `${JSON.stringify({ at: new Date().toISOString(), modes: Object.fromEntries(modes), lease, golden, citations: citations satisfies CitationsResult, usage: usage.records }, null, 2)}\n`,
);

const leaseOk = !lease || lease.pass;
const goldenOk = !running.includes('clauses-golden') || golden !== null;
const pass = leaseOk && goldenOk && citations.pass;
if (!only && modes.size === 0) {
  const doc = [
    '# Eval results',
    '',
    '<!-- Written by `pnpm eval` (eval/runners/eval.ts). Do not edit by hand. -->',
    '',
    'The lease eval sets (spec §12, #20), run against the real model. How to run them and what each set means: `docs/ai-pipeline.md`, "Lease eval sets".',
    '',
    `**${pass ? 'PASS' : 'FAIL'}**`,
    '',
    ...lines,
    '',
  ].join('\n');
  writeFileSync(new URL('../../docs/eval-results.md', import.meta.url), doc);
  console.log('wrote docs/eval-results.md');
}
console.log(`${pass ? 'PASS' : 'FAIL'}: lease-synthetic ${lease ? (lease.pass ? 'pass' : 'fail') : 'skipped'}, clauses-golden ${golden ? 'reported' : running.includes('clauses-golden') ? 'error' : 'skipped'}, citations ${pct(citations.rate)} (gate 100%)`);
process.exit(pass ? 0 : 1);
