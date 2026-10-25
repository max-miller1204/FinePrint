// The `adversarial` eval set (spec §7.10, §12): datasets/adversarial.jsonl.
// Read by the live runner (adversarial.ts) and by the CI gate in
// server/test/adversarial.test.ts.
//
// A case is either its own `text`, or a `base` document with `insert` put in
// as a new paragraph after the paragraph that contains `after`.

import { readFileSync } from 'node:fs';

export type AdversarialKind = 'injection' | 'clean' | 'non_lease' | 'disguised';

export interface AdversarialCase {
  id: string;
  kind: AdversarialKind;
  locale: string;
  expected: { status: 'analyzed' | 'not_a_lease' | 'escalated'; injection: boolean };
  text?: string;
  base?: 'lease-synthetic';
  after?: string;
  insert?: string;
}

const BASES: Record<NonNullable<AdversarialCase['base']>, URL> = {
  'lease-synthetic': new URL('../../server/test/fixtures/lease-synthetic.txt', import.meta.url),
};

export function loadAdversarialCases(): AdversarialCase[] {
  return readFileSync(new URL('../datasets/adversarial.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

export function caseText(c: AdversarialCase): string {
  if (c.text !== undefined) return c.text;
  if (!c.base) throw new Error(`${c.id}: no text and no base`);
  const base = readFileSync(BASES[c.base], 'utf8');
  if (c.insert === undefined) return base;
  const at = c.after === undefined ? -1 : base.indexOf(c.after);
  if (at < 0) throw new Error(`${c.id}: anchor not found in ${c.base}`);
  const end = base.indexOf('\n', at);
  const cut = end < 0 ? base.length : end;
  return `${base.slice(0, cut)}\n\n${c.insert}${base.slice(cut)}`;
}
