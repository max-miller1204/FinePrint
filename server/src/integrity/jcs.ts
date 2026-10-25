import { createHash } from 'node:crypto';

// RFC 8785 JSON Canonicalization Scheme. What is signed is these exact
// bytes, so a verifier rebuilds them from the JSON alone (spec §8.2).
//
// ECMAScript already serializes numbers and strings the way JCS requires
// (§3.2.2.2, §3.2.2.3), and the default sort compares UTF-16 code units, as
// §3.2.3 orders keys. What JSON cannot carry is refused, not dropped.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS has no representation for a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new TypeError(`JCS cannot canonicalize a ${typeof value}`);
}

export const canonicalBytes = (value: unknown) => Buffer.from(canonicalize(value), 'utf8');

export const sha256Hex = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
