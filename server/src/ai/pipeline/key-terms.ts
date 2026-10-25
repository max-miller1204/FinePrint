// Lease key terms (spec §7.3 S2 to S4). The model names a term, copies its
// value as the lease writes it ("$1,500", "15%", "twenty-four (24) hours",
// "October 1, 2026"), and quotes the sentence it came from. Code then checks
// that the value is inside the quote and the quote is inside the lease
// (quotes.ts), and turns the value into a number or a date itself. The
// deterministic checks only ever see numbers that code read from the lease.

import type { IsoDate } from '../../rules/types.js';

export const KEY_TERMS = [
  'monthlyRent',
  'securityDeposit',
  'lateFee',
  'damageInsurancePremium',
  'renterInsurancePremium',
  'maintenanceNoticeHours',
  'leaseStart',
  'leaseEnd',
] as const;

export type KeyTermName = (typeof KEY_TERMS)[number];

// What the model is told each term means (prompts/lease.ts).
export const KEY_TERM_DESCRIPTIONS: Record<KeyTermName, string> = {
  monthlyRent: 'the rent for one month, such as "$1,500"',
  securityDeposit: 'the security deposit, whatever the lease calls it, as an amount ("$4,500") or in months of rent ("three months\' rent")',
  lateFee: 'the late fee or late charge for one late payment, as an amount ("$75") or a percent of rent ("15%")',
  damageInsurancePremium: 'a damage insurance premium the tenant pays before moving in, instead of or on top of a deposit',
  renterInsurancePremium: "a renter's insurance premium the tenant pays to the landlord before moving in",
  maintenanceNoticeHours: 'the notice the landlord gives before entering for routine maintenance, such as "24 hours" or "one day"',
  leaseStart: 'the first day of the lease term, such as "October 1, 2026"',
  leaseEnd: 'the last day of the lease term, such as "September 30, 2027"',
};

export type KeyTermUnit = 'usd' | 'hours' | 'date';

export const KEY_TERM_UNITS: Record<KeyTermName, KeyTermUnit> = {
  monthlyRent: 'usd',
  securityDeposit: 'usd',
  lateFee: 'usd',
  damageInsurancePremium: 'usd',
  renterInsurancePremium: 'usd',
  maintenanceNoticeHours: 'hours',
  leaseStart: 'date',
  leaseEnd: 'date',
};

// A parsed value, before anything is derived from another term.
export type ParsedValue =
  | { kind: 'usd'; usd: number }
  // "15%" of the monthly rent.
  | { kind: 'percent_of_rent'; percent: number }
  // "three months' rent".
  | { kind: 'months_of_rent'; months: number }
  | { kind: 'hours'; hours: number }
  | { kind: 'date'; date: IsoDate };

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Digits ("1,500.00", "72") or English number words up to 999 ("seventy-two",
// "one hundred twenty"). A digit form in parentheses wins, as leases often
// write "twenty-four (24)".
export function readNumber(text: string): number | null {
  const paren = /\((\d[\d,]*(?:\.\d+)?)\)/.exec(text);
  const digits = paren?.[1] ?? /\d[\d,]*(?:\.\d+)?/.exec(text)?.[0];
  if (digits !== undefined) {
    // "1,500" but not "1,50" or "15,00".
    if (digits.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits)) return null;
    return Number(digits.replace(/,/g, ''));
  }
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let total = 0;
  let seen = false;
  for (const word of words) {
    if (word in ONES) total += ONES[word]!;
    else if (word in TENS) total += TENS[word]!;
    else if (word === 'hundred' && seen) total *= 100;
    else if (word === 'and' && seen) continue;
    else if (seen) break;
    else continue;
    seen = true;
  }
  return seen ? total : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(year: number, month: number, day: number): IsoDate | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

// "October 1, 2026", "Oct. 1st, 2026", "1st day of October, 2026",
// "10/01/2026", or "2026-10-01". Two-digit years are refused.
export function readDate(text: string): IsoDate | null {
  const t = text.toLowerCase();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
  m = /([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(t);
  if (m && MONTHS.includes(m[1]!.slice(0, 3))) return isoDate(Number(m[3]), MONTHS.indexOf(m[1]!.slice(0, 3)) + 1, Number(m[2]));
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+)?(?:of\s+)?([a-z]{3,9})\.?,?\s+(\d{4})/.exec(t);
  if (m && MONTHS.includes(m[2]!.slice(0, 3))) return isoDate(Number(m[3]), MONTHS.indexOf(m[2]!.slice(0, 3)) + 1, Number(m[1]));
  return null;
}

// The value as written, read for the term's unit. null when it does not
// read as one: the term is then dropped, never guessed.
export function parseValue(name: KeyTermName, value: string): ParsedValue | null {
  const unit = KEY_TERM_UNITS[name];
  const t = value.toLowerCase();
  if (unit === 'date') {
    const date = readDate(value);
    return date ? { kind: 'date', date } : null;
  }
  const n = readNumber(value);
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  if (unit === 'hours') {
    if (/\bdays?\b/.test(t)) return { kind: 'hours', hours: n * 24 };
    if (/\bhours?\b|\bhrs?\b|-hour\b/.test(t)) return { kind: 'hours', hours: n };
    return null;
  }
  // A dollar amount wins over a gloss next to it ("$4,500 (three months' rent)").
  if (/\$|\bdollars?\b|\busd\b/.test(t)) return { kind: 'usd', usd: n };
  if (/%|\bpercent\b|\bper cent\b/.test(t)) return name === 'lateFee' ? { kind: 'percent_of_rent', percent: n } : null;
  if (/\bmonths?'?s?\b.*\brent\b/.test(t)) return name === 'securityDeposit' ? { kind: 'months_of_rent', months: n } : null;
  // A bare number with no unit could be anything ("5" days, "5" percent).
  return null;
}

// Rent-relative values become dollars once the rent is known, in whole cents.
export function toAmount(parsed: ParsedValue, monthlyRentUsd: number | undefined): number | null {
  switch (parsed.kind) {
    case 'usd':
      return parsed.usd;
    case 'hours':
      return parsed.hours;
    case 'percent_of_rent':
      return monthlyRentUsd === undefined ? null : Math.round(monthlyRentUsd * parsed.percent) / 100;
    case 'months_of_rent':
      return monthlyRentUsd === undefined ? null : Math.round(monthlyRentUsd * 100 * parsed.months) / 100;
    case 'date':
      return null;
  }
}
