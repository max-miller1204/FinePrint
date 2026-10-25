// The photo damage pipeline (spec §7.5, step 2): one `vision` call on the
// 1536 px model copy, then code turns the answer into proposals the tenant
// reviews. The model never sees or changes the original.
//
//   analyzeDamage(gemma, { image, room, checklistItem })
//     -> generate('vision', DamageResult, [photo, capture_context])
//     -> per item: box [ymin, xmin, ymax, xmax] / 1000 -> {x, y, width, height}, or null
//                  mold_like and pest_sign -> fixed hedged wording, repairPath: true
//     -> DamageAnalysis with the model that answered

import type { Logger } from '../../log.js';
import type { DamageAnalysis, DamageProposal, NormalizedBox } from '../../models/evidence.js';
import type { GemmaClient, GemmaEvent } from '../gemma.js';
import { DAMAGE_INSTRUCTION, DAMAGE_TASK } from '../prompts/damage.js';
import { DamageResult, type DamageType } from '../schemas/damage.js';

export interface DamageInput {
  // The downscaled JPEG, GPS already stripped on device.
  image: Uint8Array;
  room: string;
  checklistItem: string;
}

export interface DamageOptions {
  signal?: AbortSignal;
  onEvent?: (event: GemmaEvent) => void;
  log?: Logger;
  now?: () => Date;
}

// A runaway answer ends here and is retried. Eight items run well under it.
const MAX_OUTPUT_TOKENS = 2_048;

export const LABELS: Record<DamageType, string> = {
  scratch: 'Scratch',
  scuff: 'Scuff',
  dent: 'Dent',
  hole: 'Hole',
  stain: 'Stain',
  crack: 'Crack',
  chip: 'Chip',
  burn: 'Burn mark',
  water_damage: 'Water damage',
  mold_like: 'Looks like it could be mold',
  missing_part: 'Missing part',
  broken: 'Broken',
  pest_sign: 'Could be a sign of pests',
  other: 'Possible damage',
};

// Spec §7.5 step 4: these never assert a diagnosis, so the model's own words
// are replaced, and the app offers the repair request path.
const REPAIR_PATH_NOTE = 'If it is getting worse, you can ask the landlord in writing to fix it (Va. Code § 55.1-1220).';
export const HEDGED: Partial<Record<DamageType, string>> = {
  mold_like: `This might be mold or mildew. FinePrint cannot tell what it is from a photo. ${REPAIR_PATH_NOTE}`,
  pest_sign: `This might be a sign of pests. FinePrint cannot tell from a photo. ${REPAIR_PATH_NOTE}`,
};

// The model may still name mold or pests under another type; those get the
// hedged wording too.
const MOLD_WORDS = /\b(mou?ld|mildew|fung(us|al))/i;
const PEST_WORDS = /\b(pest|roach|cockroach|rodent|mouse|mice|rat|rats|droppings|termite|bed ?bug|infest)/i;

export async function analyzeDamage(gemma: GemmaClient, input: DamageInput, options: DamageOptions = {}): Promise<DamageAnalysis> {
  const { signal, onEvent, log, now = () => new Date() } = options;
  const result = await gemma.generate(
    'vision',
    DamageResult,
    [
      { id: 'photo', image: { mimeType: 'image/jpeg', data: Buffer.from(input.image).toString('base64') } },
      { id: 'capture_context', text: `Room: ${input.room}\nChecklist item: ${input.checklistItem}` },
    ],
    {
      task: DAMAGE_TASK,
      instruction: DAMAGE_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(signal ? { signal } : {}),
      ...(onEvent ? { onEvent } : {}),
      ...(log ? { log } : {}),
    },
  );
  return {
    imageQuality: { ok: result.data.imageQuality.ok, issues: [...new Set(result.data.imageQuality.issues)] },
    proposals: result.data.items.map((item, i) => proposal(item, i)),
    model: result.model,
    fallback: result.fallback,
    at: now().toISOString(),
  };
}

export function proposal(item: DamageResult['items'][number], index: number): DamageProposal {
  const type = reclassify(item.type, item.description);
  const hedged = HEDGED[type];
  return {
    id: `p${index + 1}`,
    type,
    label: LABELS[type],
    description: hedged ?? item.description.trim(),
    severity: item.severity,
    confidence: item.confidence,
    box: item.box ? normalizeBox(item.box) : null,
    repairPath: hedged !== undefined,
  };
}

function reclassify(type: DamageType, description: string): DamageType {
  if (type === 'mold_like' || type === 'pest_sign') return type;
  if (MOLD_WORDS.test(description)) return 'mold_like';
  if (PEST_WORDS.test(description)) return 'pest_sign';
  return type;
}

// [ymin, xmin, ymax, xmax] on 0-1000 to fractions. Swapped corners are put
// right; a box with no area is dropped, and the tenant can draw one.
export function normalizeBox(box: readonly number[]): NormalizedBox | null {
  if (box.length !== 4 || !box.every((v) => Number.isFinite(v))) return null;
  const clamp = (v: number) => Math.min(1000, Math.max(0, v)) / 1000;
  const [y0, x0, y1, x1] = box.map(clamp) as [number, number, number, number];
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  if (width < 0.005 || height < 0.005) return null;
  // The grid is 1/1000, so four places keep every value exact.
  const round = (v: number) => Math.round(v * 10_000) / 10_000;
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}
