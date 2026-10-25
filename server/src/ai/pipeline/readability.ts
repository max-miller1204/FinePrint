// S8's reading-level check (spec §7.3, §12 `readability`): the
// Flesch-Kincaid grade of an English explanation, counted in code.
//
//   grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
//
// Syllables are estimated from vowel groups, as most readability tools do;
// the estimate is within one syllable on almost every English word, which
// moves a three-sentence grade by a fraction of a level.

export type ReadingLevel = 'standard' | 'simpler';

// Spec §7.3 S8: grade 7 or lower; grade 5 for Simpler.
export const GRADE_TARGET: Record<ReadingLevel, number> = { standard: 7, simpler: 5 };

const WORD = /[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g;

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  // A number reads as one word here; amounts are short in plain explanations.
  if (w.length === 0) return 1;
  if (w.length <= 3) return 1;
  // A silent final e, es, or ed ("rules", "makes", "signed"), but not a
  // spoken one ("table", "boxes", "charges", "wanted").
  const trimmed = /[^aeiouy]les?$/.test(w)
    ? w.replace(/^y/, '')
    : w
        .replace(/(?<![td])ed$/, '')
        .replace(/(?<!(?:[sxzcg]|[cs]h))es$|e$/, '')
        .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, groups);
}

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

// Sentence ends: . ! ? followed by a space, a closing quote, or the end. A
// period inside a number ("$1,500.00") is not one.
export function sentenceCount(text: string): number {
  const ends = text.trim().match(/[.!?]+(?=["'”’)]*(?:\s|$))/g)?.length ?? 0;
  return Math.max(1, ends);
}

export function fleschKincaidGrade(text: string): number {
  const list = words(text);
  if (list.length === 0) return 0;
  const syl = list.reduce((sum, w) => sum + syllables(w), 0);
  const grade = 0.39 * (list.length / sentenceCount(text)) + 11.8 * (syl / list.length) - 15.59;
  return Math.round(grade * 10) / 10;
}

export function meetsGrade(text: string, level: ReadingLevel): boolean {
  return text.trim().length > 0 && fleschKincaidGrade(text) <= GRADE_TARGET[level];
}
