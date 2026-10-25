// What the `vision` stage asks the model for (spec §7.5). Boxes come back in
// Gemma's native detection format, [ymin, xmin, ymax, xmax] on a 0-1000 grid;
// pipeline/damage.ts turns them into the report's normalized boxes.

import { z } from 'zod';

export const QUALITY_ISSUES = ['blurry', 'too_dark', 'overexposed', 'too_far', 'obstructed', 'not_a_room'] as const;
export const DAMAGE_TYPES = [
  'scratch',
  'scuff',
  'dent',
  'hole',
  'stain',
  'crack',
  'chip',
  'burn',
  'water_damage',
  'mold_like',
  'missing_part',
  'broken',
  'pest_sign',
  'other',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export const DAMAGE_SEVERITIES = ['minor', 'moderate', 'major'] as const;
export const DAMAGE_CONFIDENCES = ['low', 'medium', 'high'] as const;

export const MAX_PROPOSALS = 8;

export const DamageResult = z.object({
  imageQuality: z.object({
    ok: z.boolean(),
    issues: z.array(z.enum(QUALITY_ISSUES)),
  }),
  items: z
    .array(
      z.object({
        type: z.enum(DAMAGE_TYPES),
        description: z.string().max(160).describe('One short phrase, such as "scuff on wall, about 10 cm".'),
        severity: z.enum(DAMAGE_SEVERITIES),
        box: z
          .array(z.number().int().min(0).max(1000))
          .length(4)
          .optional()
          .describe('[ymin, xmin, ymax, xmax] on a 0-1000 grid over the whole image.'),
        confidence: z.enum(DAMAGE_CONFIDENCES),
      }),
    )
    .max(MAX_PROPOSALS),
});
export type DamageResult = z.output<typeof DamageResult>;
