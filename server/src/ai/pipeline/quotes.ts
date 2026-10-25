// Quote resolution (spec §7.3 S3). The model copies text out of the lease;
// code finds each copy in the lease text and keeps only what it finds. A
// quote the model rephrased or invented resolves to nothing and is dropped,
// so every quote a tenant sees is a slice of their own lease.
//
// Matching is literal, after folding only what OCR and typing vary on:
// whitespace runs, curly quotes, dashes, the ellipsis character, and soft
// hyphens. Case, words, and numbers must match exactly.

export interface Span {
  // Offsets into the original text; `end` is exclusive.
  start: number;
  end: number;
}

interface Normalized {
  text: string;
  // Original offset of each normalized character.
  offsets: number[];
}

// Curly single and double quotes, primes, and the hyphen and dash family.
const FOLD: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u2032': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2033': '"',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
};

function normalize(text: string): Normalized {
  let out = '';
  const offsets: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\u00AD') continue;
    if (/\s/.test(ch)) {
      // One space for any run, and none at the start.
      if (!space && out.length > 0) {
        out += ' ';
        offsets.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    if (ch === '\u2026') {
      out += '...';
      offsets.push(i, i, i);
      continue;
    }
    out += FOLD[ch] ?? ch;
    offsets.push(i);
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1);
    offsets.pop();
  }
  return { text: out, offsets };
}

// The model reads the lease through documentParts(), which defangs
// `<document` as `&lt;document`; a quote of that text is a quote of the original.
function unescapeQuote(quote: string): string {
  return quote.replace(/&lt;(\/?)(document)/gi, '<$1$2');
}

// Shorter quotes match too easily by accident to prove anything.
export const MIN_QUOTE_CHARS = 8;

export interface LocateOptions {
  // Search from this offset of the haystack on.
  from?: number;
  minChars?: number;
}

// The first place the quote appears in the haystack, or null. A quote that
// skips words with "..." matches when every fragment is verbatim, in order;
// the span then runs from the first fragment to the last, so the tenant sees
// the words that were skipped too.
export function locateQuote(haystack: string, quote: string, { from = 0, minChars = MIN_QUOTE_CHARS }: LocateOptions = {}): Span | null {
  const hay = normalize(haystack);
  const candidates = [normalize(unescapeQuote(quote)).text];
  // Some answers wrap the quote in quotation marks of their own.
  const inner = /^"(.*)"$/s.exec(candidates[0]!)?.[1]?.trim();
  if (inner) candidates.push(inner);

  const fromIndex = hay.offsets.findIndex((offset) => offset >= from);
  if (fromIndex < 0) return null;
  for (const needle of candidates) {
    if (needle.replace(/\.\.\./g, '').trim().length < minChars) continue;
    const fragments = needle
      .split('...')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    const at = findFragments(hay.text, fragments, fromIndex);
    if (!at) continue;
    return { start: hay.offsets[at.start]!, end: hay.offsets[at.end - 1]! + 1 };
  }
  return null;
}

// Each fragment after the one before. A fragment of a word or two could
// match anywhere, so every fragment after the first needs MIN_FRAGMENT_CHARS.
const MIN_FRAGMENT_CHARS = 12;

function findFragments(hay: string, fragments: readonly string[], fromIndex: number): Span | null {
  if (fragments.length === 0) return null;
  if (fragments.length > 1 && fragments.some((f) => f.length < MIN_FRAGMENT_CHARS)) return null;
  // The first occurrence of the first fragment leaves the most room for the
  // rest: if they are not after it, they are not after a later one either.
  const start = hay.indexOf(fragments[0]!, fromIndex);
  if (start < 0) return null;
  let end = start + fragments[0]!.length;
  for (const fragment of fragments.slice(1)) {
    const at = hay.indexOf(fragment, end);
    if (at < 0) return null;
    end = at + fragment.length;
  }
  return { start, end };
}

// Case-insensitive containment after the same folding, for a key term's
// value inside its own quote ("$1,500" in "rent of $1,500 per month").
export function containsText(haystack: string, needle: string): boolean {
  const n = normalize(needle).text.toLowerCase();
  return n.length > 0 && normalize(haystack).text.toLowerCase().includes(n);
}
