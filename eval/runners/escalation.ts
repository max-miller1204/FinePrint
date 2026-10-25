// The `escalation` eval (spec §7.9, §12): every case in
// datasets/escalation.jsonl through the real triage, Gemma and the keyword
// backstop side by side. Gate: recall 100% on the combined decision.
//
//   cd eval && op run --env-file ~/.config/fineprint/.env -- pnpm escalation
//   pnpm escalation --keywords-only      # no key, no model calls
//   pnpm escalation --heldout            # datasets/escalation-heldout.jsonl
//
// Prints recall and precision for Gemma alone, the backstop alone, and the
// combined decision, per language, and every miss and false alarm by id.
// Writes the full result to out/escalation.json (gitignored). Exits 1 when
// the combined decision misses a high-stakes case, or when Gemma could not
// answer one (a model outage is not a pass).
//
// --heldout (#90) scores datasets/escalation-heldout.jsonl instead: phrasings
// written without reading the keyword lists (typos, slang, indirect wording,
// mixed EN/ES). It reports only, with no gate, and writes
// out/escalation-heldout.json. Never tune keywords against it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createLogger } from '../../server/src/log.js';
import { gemmaFromEnv } from '../../server/src/ai/gemma.js';
import { gemmaTriageProvider } from '../../server/src/ai/triage/gemma.js';
import { createTriage, type TriageCategory, type TriageDecision, type TriageSource } from '../../server/src/ai/triage/index.js';
import { keywordBackstop } from '../../server/src/ai/triage/keywords.js';
import { memoryUsageSink } from '../../server/src/usage.js';

interface Case {
  id: string;
  expected: TriageCategory;
  source: TriageSource;
  locale: string;
  text: string;
}

interface Row {
  id: string;
  locale: string;
  source: TriageSource;
  expected: TriageCategory;
  decision: TriageDecision;
}

const keywordsOnly = process.argv.includes('--keywords-only');
const heldout = process.argv.includes('--heldout');
const dataset = heldout ? 'escalation-heldout' : 'escalation';
const cases: Case[] = readFileSync(new URL(`../datasets/${dataset}.jsonl`, import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));

// Model call lines go to stderr so stdout stays the report.
const log = createLogger('eval-escalation', (line) => process.stderr.write(`${line}\n`));
const usage = memoryUsageSink();
const triage = createTriage({
  model: keywordsOnly ? null : gemmaTriageProvider(gemmaFromEnv({ usage, log })),
  keywords: keywordBackstop(),
});

const rows: Row[] = [];
const started = Date.now();
for (const [index, c] of cases.entries()) {
  const decision = await triage.check({ source: c.source, text: c.text, locale: c.locale }, { log });
  rows.push({ id: c.id, locale: c.locale, source: c.source, expected: c.expected, decision });
  process.stderr.write(`[${index + 1}/${cases.length}] ${c.id}: ${decision.escalate ? 'escalate' : 'pass'}\n`);
}

type Judge = (row: Row) => boolean | null;
const judges: Record<string, Judge> = {
  gemma: (r) => (r.decision.model.status === 'ok' ? r.decision.model.category !== 'none' : null),
  keywords: (r) => r.decision.keywords.category !== 'none',
  combined: (r) => r.decision.escalate,
};

function score(subset: Row[], judge: Judge) {
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  let unanswered = 0;
  for (const row of subset) {
    const fired = judge(row);
    if (fired === null) {
      unanswered++;
      continue;
    }
    const positive = row.expected !== 'none';
    if (positive && fired) tp++;
    else if (positive) fn++;
    else if (fired) fp++;
    else tn++;
  }
  return {
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    precision: tp + fp === 0 ? null : tp / (tp + fp),
    tp,
    fn,
    fp,
    tn,
    unanswered,
  };
}

const pct = (value: number | null) => (value === null ? '  n/a' : `${(value * 100).toFixed(1).padStart(5)}%`);
const slices: [string, Row[]][] = [
  ['all', rows],
  ['en', rows.filter((r) => r.locale === 'en')],
  ['es', rows.filter((r) => r.locale === 'es')],
];

const report: Record<string, Record<string, ReturnType<typeof score>>> = {};
console.log(`${dataset}: ${cases.length} cases (${rows.filter((r) => r.expected !== 'none').length} high-stakes), ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log('provider   slice  recall  precision  tp  fn  fp  tn  unanswered');
for (const [name, judge] of Object.entries(judges)) {
  if (name === 'gemma' && keywordsOnly) continue;
  report[name] = {};
  for (const [slice, subset] of slices) {
    const s = score(subset, judge);
    report[name][slice] = s;
    console.log(
      `${name.padEnd(10)} ${slice.padEnd(5)} ${pct(s.recall)}  ${pct(s.precision)}    ${[s.tp, s.fn, s.fp, s.tn].map((n) => String(n).padStart(2)).join('  ')}  ${s.unanswered}`,
    );
  }
}

const list = (label: string, ids: string[]) => console.log(`${label}: ${ids.length === 0 ? 'none' : ids.join(', ')}`);
for (const [name, judge] of Object.entries(judges)) {
  if (name === 'gemma' && keywordsOnly) continue;
  list(`${name} misses`, rows.filter((r) => r.expected !== 'none' && judge(r) === false).map((r) => r.id));
  list(`${name} false alarms`, rows.filter((r) => r.expected === 'none' && judge(r) === true).map((r) => r.id));
}
const unanswered = rows.filter((r) => r.decision.model.status === 'unavailable').map((r) => r.id);
if (!keywordsOnly) {
  list('gemma unavailable', unanswered);
  const models = new Map<string, number>();
  for (const record of usage.records) if (record.outcome === 'ok') models.set(record.model, (models.get(record.model) ?? 0) + 1);
  console.log(`answered by: ${[...models].map(([model, n]) => `${model} x${n}`).join(', ') || 'none'}`);
  const wrongCategory = rows.filter(
    (r) => r.expected !== 'none' && r.decision.model.status === 'ok' && r.decision.model.category !== 'none' && r.decision.model.category !== r.expected,
  );
  list('gemma other category (still escalates)', wrongCategory.map((r) => `${r.id}->${r.decision.model.status === 'ok' ? r.decision.model.category : ''}`));
}

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../out/${dataset}.json`, import.meta.url),
  `${JSON.stringify({ at: new Date().toISOString(), keywordsOnly, report, rows: rows.map(({ id, expected, decision }) => ({ id, expected, decision })) }, null, 2)}\n`,
);

const recall = report.combined?.all?.recall;
if (heldout) {
  console.log(`REPORT: combined recall ${pct(recall ?? null).trim()} (held-out, no gate)`);
  process.exit(0);
}
const pass = recall === 1 && (keywordsOnly || unanswered.length === 0);
console.log(`${pass ? 'PASS' : 'FAIL'}: combined recall ${pct(recall ?? null).trim()} (gate 100%)${!keywordsOnly && unanswered.length > 0 ? `, Gemma unavailable on ${unanswered.length}` : ''}`);
process.exit(pass ? 0 : 1);
