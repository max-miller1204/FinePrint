// The verifier eval (spec §7.3 S7, §12 `clauses-golden`): every case in
// datasets/clauses-golden.jsonl through the real S7 verifier
// (server/src/ai/pipeline/verifier.ts), as if S5 had said the clause violates
// its rule. A `match` case is a violation, so the verifier should agree; a
// `no_match` case is a look-alike that complies, so it should not.
//
//   cd eval && ../scripts/with-secrets.sh pnpm verifier              # both output modes
//   ../scripts/with-secrets.sh pnpm verifier --mode json              # one mode
//
// Runs each output mode of the `verification` stage (models.ts, `schema` or
// `json`) in batches of 8 checks, the size of a lease's S7 call. Prints, per
// mode: agreement on violations, false agreement on look-alikes, unclear and
// unverified counts, thought tokens, and seconds per call, plus every miss by
// id. Writes out/verifier.json (gitignored). Report only: no gate, but exits
// 1 when a check went unverified (a model outage is not a result).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gemmaFromEnv } from '../../server/src/ai/gemma.js';
import { type OutputMode, STAGES } from '../../server/src/ai/models.js';
import type { Draft } from '../../server/src/ai/pipeline/findings.js';
import type { Clause, Drop, VerifierResult } from '../../server/src/ai/pipeline/types.js';
import { runVerifier, type StageCall } from '../../server/src/ai/pipeline/verifier.js';
import { createLogger } from '../../server/src/log.js';
import { JURISDICTIONS_ROOT, loadRulePack } from '../../server/src/rules/loader.js';
import { resolveRules } from '../../server/src/rules/resolve.js';
import { memoryUsageSink } from '../../server/src/usage.js';

interface Case {
  id: string;
  ruleId: string;
  expected: 'match' | 'no_match';
  text: string;
}

const BATCH = 8;
const TERM = { start: '2026-11-01', end: '2027-10-31' };

const modeArg = process.argv.indexOf('--mode');
const modes: OutputMode[] = modeArg > 0 ? [process.argv[modeArg + 1] as OutputMode] : ['schema', 'json'];
const cases: Case[] = readFileSync(new URL('../datasets/clauses-golden.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));

const pack = loadRulePack(join(JURISDICTIONS_ROOT, 'va'), { requireVerified: true });
const inForce = new Map(resolveRules(pack.rules, TERM).map((r) => [r.rule.id, r]));
const log = createLogger('eval-verifier', (line) => process.stderr.write(`${line}\n`));

function draft(c: Case): Draft {
  const rule = pack.byId.get(c.ruleId)!;
  const resolved = inForce.get(c.ruleId)!;
  return {
    basis: 'mapping',
    ruleId: rule.id,
    citation: rule.citation,
    sourceUrl: rule.sourceUrl,
    checkType: rule.checkType,
    versions: resolved.versions,
    changes: resolved.changes,
    statuteQuote: resolved.versions[0]!.version.statuteQuote,
    clauseId: c.id,
    leaseQuote: c.text,
    quoteSpan: { start: 0, end: c.text.length },
    primaryAssessment: 'violates',
    primaryModel: null,
    primaryFallback: false,
    verifier: null,
    check: null,
    rule,
  };
}

const report: Record<string, unknown> = {};
let unverifiedAny = false;

for (const mode of modes) {
  const usage = memoryUsageSink();
  const gemma = gemmaFromEnv({ usage, log, stages: { ...STAGES, verification: { ...STAGES.verification, output: mode } } });
  const call: StageCall = { gemma, options: { onEvent: () => {}, log }, track: (r) => r };
  const results = new Map<string, VerifierResult>();
  const drops: Drop[] = [];
  const started = Date.now();
  for (let i = 0; i < cases.length; i += BATCH) {
    const batch = cases.slice(i, i + BATCH);
    const clauses = new Map<string, Clause>(batch.map((c) => [c.id, { id: c.id, heading: null, start: 0, end: c.text.length, verbatim: c.text }]));
    const verdicts = await runVerifier(batch.map(draft), clauses, call, drops);
    for (const c of batch) results.set(c.id, verdicts.get(`${c.id}:${c.ruleId}`) ?? { verdict: 'unverified', assessment: null, reasoning: null, model: null, fallback: false });
  }
  const seconds = (Date.now() - started) / 1000;

  const rows = cases.map((c) => ({ id: c.id, expected: c.expected, ...results.get(c.id)! }));
  const matches = rows.filter((r) => r.expected === 'match');
  const lookalikes = rows.filter((r) => r.expected === 'no_match');
  const ok = usage.records.filter((r) => r.outcome === 'ok');
  const summary = {
    mode,
    agreeOnViolations: `${matches.filter((r) => r.verdict === 'agree').length}/${matches.length}`,
    falseAgreeOnLookalikes: `${lookalikes.filter((r) => r.verdict === 'agree').length}/${lookalikes.length}`,
    unclear: rows.filter((r) => r.verdict === 'unclear').length,
    unverified: rows.filter((r) => r.verdict === 'unverified').length,
    models: [...new Set(ok.map((r) => r.model))],
    calls: ok.length,
    requests: usage.records.length,
    invalidOutputs: usage.records.filter((r) => r.outcome === 'invalid_output').length,
    thoughtTokens: ok.reduce((s, r) => s + r.thoughtTokens, 0),
    secondsPerCall: Math.round((ok.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, ok.length) / 1000) * 10) / 10,
    totalSeconds: Math.round(seconds),
  };
  if (summary.unverified > 0) unverifiedAny = true;
  console.log(`\n== verification, ${mode} mode`);
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  for (const r of rows) {
    const right = r.expected === 'match' ? r.verdict === 'agree' : r.verdict === 'disagree';
    if (!right) console.log(`  [miss] ${r.id} expected ${r.expected}, verifier ${r.verdict}`);
  }
  report[mode] = { summary, rows };
}

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../out/verifier.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
process.exit(unverifiedAny ? 1 : 0);
