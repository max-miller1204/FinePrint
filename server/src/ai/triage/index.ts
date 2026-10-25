// Triage and escalation (spec §7.9). Every tenant input that reaches a model
// (a lease, an Ask message, a repair description, a landlord report) is
// checked first. Two providers run side by side: Gemma (26B, enum output) and
// a multilingual keyword backstop. Either one firing escalates to the
// high-stakes handoff (F10, #38): recall over precision.
//
//   triage.check({ source, text, locale })
//     -> GemmaTriageProvider.classify   (the model; may be off or unavailable)
//     -> KeywordBackstop.classify       (code; always runs, EN and ES terms)
//     -> escalate when either category is not "none"

import type { Logger } from '../../log.js';

export const TRIAGE_CATEGORIES = [
  'none',
  'eviction_or_court',
  'lockout',
  'utility_shutoff',
  'retaliation',
  'discrimination',
  'domestic_violence',
  'immediate_danger',
  'self_harm',
] as const;

export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

// Where the text came from. A lease or landlord report is a document that may
// describe eviction in general terms; an Ask message or repair description is
// the tenant speaking about their own situation. Both providers read it.
export const TRIAGE_SOURCES = ['lease', 'ask', 'repair', 'landlord_report'] as const;

export type TriageSource = (typeof TRIAGE_SOURCES)[number];

export interface TriageInput {
  source: TriageSource;
  text: string;
  imageCaptions?: string[];
  // BCP 47, such as `en` or `es-US`. The keyword backstop checks every
  // language whatever the locale, since tenants mix languages.
  locale: string;
}

export interface TriageResult {
  category: TriageCategory;
  confidence: number;
}

export interface TriageOptions {
  signal?: AbortSignal;
  log?: Logger;
}

// Spec §7.9. Other providers (OpenAI Decisions, TypeSafe Jev) would implement
// this too; see docs/triage-providers.md.
export interface TriageProvider {
  readonly name: string;
  classify(input: TriageInput, options?: TriageOptions): Promise<TriageResult>;
}

export interface KeywordResult extends TriageResult {
  // Term ids such as `en.lockout.changed-locks`: ours, never the tenant's text.
  matches: string[];
}

// The backstop is a provider too, with the matched term ids in its answer.
export interface KeywordProvider extends TriageProvider {
  classify(input: TriageInput): Promise<KeywordResult>;
}

export type ModelVerdict =
  | ({ status: 'ok' } & TriageResult)
  // No key configured: the backstop decides alone.
  | { status: 'off' }
  // Every model in the chain failed, or answered off schema. The backstop decides alone.
  | { status: 'unavailable' };

export interface TriageDecision {
  escalate: boolean;
  // The model's category when it fired, else the backstop's, else `none`.
  category: TriageCategory;
  model: ModelVerdict;
  keywords: KeywordResult;
}

export interface Triage {
  check(input: TriageInput, options?: TriageOptions): Promise<TriageDecision>;
}

export function createTriage({ model, keywords }: { model: TriageProvider | null; keywords: KeywordProvider }): Triage {
  return {
    async check(input, { signal, log } = {}) {
      const [verdict, backstop] = await Promise.all([classifyModel(model, input, signal, log), keywords.classify(input)]);
      const modelFired = verdict.status === 'ok' && verdict.category !== 'none';
      const keywordsFired = backstop.category !== 'none';
      const category = modelFired ? verdict.category : backstop.category;
      log?.info('triage', {
        source: input.source,
        escalate: modelFired || keywordsFired,
        category,
        modelStatus: verdict.status,
        modelCategory: verdict.status === 'ok' ? verdict.category : null,
        keywordCategory: backstop.category,
        keywordMatches: backstop.matches.length,
        textChars: input.text.length,
      });
      return { escalate: modelFired || keywordsFired, category, model: verdict, keywords: backstop };
    },
  };
}

// The model failing must never block the check: the backstop still runs, and
// the decision says the model was unavailable. Only an abort propagates.
async function classifyModel(model: TriageProvider | null, input: TriageInput, signal?: AbortSignal, log?: Logger): Promise<ModelVerdict> {
  if (!model) return { status: 'off' };
  try {
    const result = await model.classify(input, { ...(signal ? { signal } : {}), ...(log ? { log } : {}) });
    return { status: 'ok', ...result };
  } catch (err) {
    if (signal?.aborted) throw err;
    log?.warn('triage model unavailable', { provider: model.name, errorName: err instanceof Error ? err.name : 'unknown' });
    return { status: 'unavailable' };
  }
}
