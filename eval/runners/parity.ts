// #45: same lease case in EN, ES, FR through the production S1 to S9 pipeline.
// No model judges its own translations. Semantic translation QA stays human.
import { readFileSync } from 'node:fs';
import { analyzeLease, type LeaseAnalysis, type LeaseDeps } from '../../server/src/ai/pipeline/lease.js';
import { gemmaTriageProvider } from '../../server/src/ai/triage/gemma.js';
import { createTriage } from '../../server/src/ai/triage/index.js';
import { keywordBackstop } from '../../server/src/ai/triage/keywords.js';
import type { CitationSource } from './citations.js';

export const PARITY_LOCALES = ['en', 'es', 'fr'] as const;
export type ParityLocale = (typeof PARITY_LOCALES)[number];
export const PARITY_GATE = 0.95;
export interface ParityCase {
  id: string;
  ruleId: string;
  expected: 'unenforceable' | 'ask' | 'no_flag';
  texts: Record<ParityLocale, string>;
}
export interface ParityRun {
  id: string;
  locale: ParityLocale;
  analysis: LeaseAnalysis | null;
  error?: string;
}

export function loadParityCases(): ParityCase[] {
  const cases: ParityCase[] = readFileSync(new URL('../datasets/parity.jsonl', import.meta.url), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  if (cases.length !== 20 || new Set(cases.map((c) => c.id)).size !== 20 || cases.some((c) =>
    !c.id || !c.ruleId || !['unenforceable', 'ask', 'no_flag'].includes(c.expected) || PARITY_LOCALES.some((l) => !c.texts?.[l]?.trim()))) {
    throw new Error('parity requires 20 unique cases with expected outcomes and EN/ES/FR texts');
  }
  return cases;
}

// Shared proper name is kept in English, as on an attached DHCD statement.
// Fixed dates make rule versions independent of the day this eval runs.
export function parityText(c: ParityCase, locale: ParityLocale): string {
  const intro = { en: 'Virginia residential lease. The tenant rents this dwelling from the landlord.', es: 'Contrato de arrendamiento residencial de Virginia. El inquilino alquila esta vivienda al arrendador.', fr: 'Bail résidentiel de Virginie. Le locataire loue ce logement au bailleur.' };
  const statement = { en: 'Attached statement:', es: 'Declaración adjunta:', fr: 'Déclaration jointe :' };
  return `${intro[locale]}\n\n${c.texts[locale]}\n\n${statement[locale]} "Tenant Rights and Responsibilities".\n`;
}

// Ignore wording, model IDs, order and segmentation IDs. Keep multiplicity,
// every rule, assessment, verifier verdict, and severity, including info.
export function verdictSignature(a: LeaseAnalysis): string {
  if (a.status !== 'analyzed') return JSON.stringify(a.status === 'escalated' ? [a.status, a.category] : [a.status, a.documentType]);
  return JSON.stringify(a.findings.map((f) => [f.ruleId, f.severity, f.primaryAssessment, f.verifier?.verdict ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function scoreParity(cases: readonly ParityCase[], runs: readonly ParityRun[]) {
  const rows = cases.map((c) => {
    const results = PARITY_LOCALES.map((locale) => {
      const matches = runs.filter((r) => r.id === c.id && r.locale === locale);
      const a = matches.length === 1 ? matches[0]!.analysis : null;
      const analyzed = a?.status === 'analyzed' ? a : null;
      const target = analyzed?.findings.filter((f) => f.ruleId === c.ruleId) ?? [];
      const correct = analyzed !== null && (c.expected === 'no_flag'
        ? target.every((f) => f.severity === 'info' && f.primaryAssessment === 'complies')
        : target.length === 1 && target[0]!.severity === c.expected && target[0]!.primaryAssessment === 'violates' && target[0]!.verifier?.verdict === 'agree');
      const translated = analyzed !== null && (locale === 'en' || (analyzed.findings.every((f) => {
        const t = f.translations[locale];
        return t && [t.title, t.explanation, t.action].every((s) => s.trim().length > 0);
      })));
      const healthy = analyzed !== null && !analyzed.findings.some((f) => f.verifier?.verdict === 'unverified') && !analyzed.drops.some((d) => ['S7', 'S9'].includes(d.stage));
      return { locale, correct, translated, healthy, signature: a ? verdictSignature(a) : null, error: matches[0]?.error ?? null };
    });
    const parity = results.every((r) => r.healthy && r.signature === results[0]!.signature);
    return { id: c.id, ruleId: c.ruleId, expected: c.expected, parity, correct: results.every((r) => r.correct), results };
  });
  const rate = rows.length ? rows.filter((r) => r.parity).length / rows.length : 0;
  const accuracy = rows.length ? rows.filter((r) => r.correct).length / rows.length : 0;
  const complete = cases.length === 20 && runs.length === 60 && rows.every((r) => r.results.every((v) => v.healthy && v.translated));
  return { pass: complete && rate >= PARITY_GATE && accuracy >= PARITY_GATE, rate, accuracy, complete, rows };
}

export async function runParity(deps: LeaseDeps, progress: (line: string) => void = () => {}) {
  const cases = loadParityCases();
  for (const c of cases) if (!deps.pack.byId.has(c.ruleId)) throw new Error(`parity: unknown rule ${c.ruleId}`);
  const triage = deps.triage ?? createTriage({ model: gemmaTriageProvider(deps.gemma), keywords: keywordBackstop() });
  const runs: ParityRun[] = [];
  const outputs: CitationSource[] = [];
  // Sequential: 60 independent analyses share the project's Gemma quota.
  for (const c of cases) for (const locale of PARITY_LOCALES) {
    const text = parityText(c, locale);
    try {
      const analysis = await analyzeLease({ leaseId: c.id, text, locale, term: { start: '2026-11-01', end: '2027-10-31' }, today: '2026-11-01' }, { ...deps, triage });
      runs.push({ id: c.id, locale, analysis });
      if (analysis.status === 'analyzed') outputs.push({ set: 'parity', id: `${c.id}/${locale}`, text, findings: analysis.findings });
      progress(`${c.id}/${locale}: ${analysis.status}`);
    } catch (err) {
      // Keep the denominator and partial evidence. Do not log provider bodies.
      runs.push({ id: c.id, locale, analysis: null, error: err instanceof Error ? err.name : 'UnknownError' });
      progress(`${c.id}/${locale}: error`);
    }
  }
  return { ...scoreParity(cases, runs), runs, outputs };
}
