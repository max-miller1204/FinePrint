// S9 (spec §7.3, §7.1 principle 4): English first, translate last. When the
// locale is not English, one call translates each finding's title,
// explanation, and action, which S8 and the rule pack wrote and checked in
// English. Lease and statute quotes are never sent, so they stay
// byte-identical; text inside quotation marks in what is sent must come back
// unchanged too. A finding whose translation is missing or changed a quote
// keeps only its English.

import type { TextDocument } from '../documents.js';
import type { GenerateResult } from '../gemma.js';
import { translationInstruction, translationTask } from '../prompts/lease.js';
import { TranslationSchema } from '../schemas/lease.js';
import { batchByTokens, clampOutput, MAX_REQUEST_TOKENS, textTokens } from './budget.js';
import type { Drop, Finding } from './types.js';
import { isModelFailure, type StageCall } from './verifier.js';

export function isEnglish(locale: string): boolean {
  return /^en(?:[-_]|$)/i.test(locale.trim());
}

// "es" -> "Spanish", "es-MX" -> "Mexican Spanish"; the tag itself if ICU has no name.
export function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale.replace('_', '-')) ?? locale;
  } catch {
    return locale;
  }
}

// Text inside straight or curly double quotes.
export function quotedSegments(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => (m[1] ?? m[2])!);
}

const FIELDS = ['titleEn', 'explanationEn', 'actionEn'] as const;

export async function translateFindings(findings: readonly Finding[], locale: string, call: StageCall, drops: Drop[]): Promise<Finding[]> {
  if (findings.length === 0 || isEnglish(locale)) return [...findings];
  const language = languageName(locale);

  // One document per distinct text: findings on the same rule share an action.
  const ids = new Map<string, string>();
  for (const f of findings) for (const field of FIELDS) if (!ids.has(f[field])) ids.set(f[field], `t${ids.size + 1}`);
  const docs: TextDocument[] = [...ids].map(([text, id]) => ({ id, text }));

  const translated = new Map<string, { text: string; model: string; fallback: boolean }>();
  const batches = batchByTokens(docs, (d) => textTokens(d.text) + 10, (MAX_REQUEST_TOKENS - 1_000) / 2);
  await Promise.all(
    batches.map(async (batch) => {
      let result: GenerateResult<{ translations: { id: string; text: string }[] }>;
      try {
        result = call.track(
          await call.gemma.generate('translation', TranslationSchema, batch, {
            task: translationTask(
              batch.map((d) => d.id),
              language,
            ),
            instruction: translationInstruction(language),
            // A translation runs longer than its English, and Spanish takes more tokens.
            maxOutputTokens: clampOutput(batch.reduce((sum, d) => sum + textTokens(d.text) * 3 + 20, 0)),
            ...call.options,
          }),
        );
      } catch (err) {
        if (!isModelFailure(err)) throw err;
        call.options.log.warn('translation unavailable', { errorName: err.name, texts: batch.length });
        return;
      }
      const wanted = new Set(batch.map((d) => d.id));
      for (const t of result.data.translations) {
        if (wanted.delete(t.id) && t.text.trim()) translated.set(t.id, { text: t.text.trim(), model: result.model, fallback: result.fallback });
      }
    }),
  );

  return findings.map((f) => {
    const parts = FIELDS.map((field) => ({ english: f[field], out: translated.get(ids.get(f[field])!) }));
    if (parts.some((p) => !p.out)) {
      drops.push({ stage: 'S9', reason: 'translation_missing', ref: f.id });
      return f;
    }
    // A translation far shorter or longer than its English is not one
    // (26B in `schema` mode once gave "explicación" for a whole explanation).
    if (parts.some((p) => p.out!.text.length < p.english.length / 2 || p.out!.text.length > p.english.length * 3 + 20)) {
      drops.push({ stage: 'S9', reason: 'translation_rejected', ref: f.id });
      return f;
    }
    if (parts.some((p) => quotedSegments(p.english).some((q) => !p.out!.text.includes(q)))) {
      drops.push({ stage: 'S9', reason: 'translation_quote_changed', ref: f.id });
      return f;
    }
    const [title, explanation, action] = parts.map((p) => p.out!);
    return {
      ...f,
      translations: {
        ...f.translations,
        [locale]: { title: title!.text, explanation: explanation!.text, action: action!.text, model: explanation!.model, fallback: parts.some((p) => p.out!.fallback) },
      },
    };
  });
}
