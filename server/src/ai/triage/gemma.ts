// GemmaTriageProvider (spec §7.9): the `triage` stage, on 26B at `minimal`
// thinking with an enum response schema.

import { z } from 'zod';
import type { Document } from '../documents.js';
import type { GemmaClient } from '../gemma.js';
import { TRIAGE_INSTRUCTION, triageTask } from '../prompts/triage.js';
import { TRIAGE_CATEGORIES, type TriageProvider } from './index.js';

export const TriageSchema = z.object({
  category: z.enum(TRIAGE_CATEGORIES),
  confidence: z.number().min(0).max(1),
});

// A 12-page lease is about 30K tokens, two minutes of 26B's 16K input tokens
// per minute (docs/ai-pipeline.md, gap 3). A summons or notice says what it is
// on its first page, so the model reads the head; the keyword backstop reads
// everything.
export const MODEL_TEXT_CHARS = 8_000;

export function gemmaTriageProvider(gemma: GemmaClient): TriageProvider {
  return {
    name: 'gemma',
    async classify({ source, text, imageCaptions = [], locale }, { signal, log } = {}) {
      const docs: Document[] = [{ id: source, text: text.slice(0, MODEL_TEXT_CHARS) }];
      if (imageCaptions.length > 0) docs.push({ id: 'image_captions', text: imageCaptions.join('\n') });
      const { data } = await gemma.generate('triage', TriageSchema, docs, {
        task: triageTask(source, locale),
        instruction: TRIAGE_INSTRUCTION,
        ...(signal ? { signal } : {}),
        ...(log ? { log } : {}),
      });
      return data;
    },
  };
}
