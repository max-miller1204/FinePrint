import { z } from 'zod';

// rentals/{rentalId} (spec §6.1). Every other object belongs to a rental.

export const RentalPhase = z.enum(['pre_signing', 'move_in', 'living', 'move_out', 'ended']);
export type RentalPhase = z.infer<typeof RentalPhase>;

// A US state code. Only Virginia has legal checks; evidence tools work
// anywhere (spec §4.2).
const Jurisdiction = z.string().regex(/^[A-Z]{2}$/);
// City and county only, never a street address (spec §6.3).
const Place = z.string().trim().min(1).max(100);
// A calendar date, `YYYY-MM-DD`, with no time zone.
const CalendarDate = z.iso.date();
// US dollars, to the cent.
const Dollars = z.number().nonnegative().max(1_000_000).multipleOf(0.01);

// Kept one year past the end of the tenancy (spec §9.1). A Firestore TTL
// policy on `purgeAfter` deletes the rental then.
export const RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export const Rental = z.object({
  id: z.string().min(1),
  ownerUid: z.string().min(1),
  jurisdiction: Jurisdiction,
  city: Place.nullable(),
  county: Place.nullable(),
  phase: RentalPhase,
  occupancyDate: CalendarDate.nullable(),
  tenancyEndDate: CalendarDate.nullable(),
  monthlyRent: Dollars.nullable(),
  depositAmount: Dollars.nullable(),
  purgeAfter: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Rental = z.infer<typeof Rental>;

// POST /v1/rentals. Unknown fields are rejected, so a client can never set
// `ownerUid` or `purgeAfter`.
export const CreateRentalInput = z
  .strictObject({
    jurisdiction: Jurisdiction,
    city: Place.optional(),
    county: Place.optional(),
    phase: RentalPhase.default('pre_signing'),
    occupancyDate: CalendarDate.optional(),
    tenancyEndDate: CalendarDate.optional(),
    monthlyRent: Dollars.optional(),
    depositAmount: Dollars.optional(),
  })
  // Virginia's independent cities are in no county, so either one is enough.
  .refine((input) => input.city !== undefined || input.county !== undefined, { path: ['city or county'] });
export type CreateRentalInput = z.infer<typeof CreateRentalInput>;

// PATCH /v1/rentals/:id: dates, rent, deposit, phase (spec §13). `null`
// clears a field.
export const PatchRentalInput = z
  .strictObject({
    phase: RentalPhase.optional(),
    occupancyDate: CalendarDate.nullable().optional(),
    tenancyEndDate: CalendarDate.nullable().optional(),
    monthlyRent: Dollars.nullable().optional(),
    depositAmount: Dollars.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { path: [] });
export type PatchRentalInput = z.infer<typeof PatchRentalInput>;

export function purgeAfter(tenancyEndDate: string | null): Date | null {
  return tenancyEndDate === null ? null : new Date(Date.parse(`${tenancyEndDate}T00:00:00Z`) + RETENTION_DAYS * DAY_MS);
}

// ISO dates compare as strings.
export function datesInOrder({ occupancyDate, tenancyEndDate }: Pick<Rental, 'occupancyDate' | 'tenancyEndDate'>): boolean {
  return occupancyDate === null || tenancyEndDate === null || occupancyDate <= tenancyEndDate;
}

export function newRental(id: string, ownerUid: string, input: CreateRentalInput, now: Date): Rental {
  const tenancyEndDate = input.tenancyEndDate ?? null;
  return {
    id,
    ownerUid,
    jurisdiction: input.jurisdiction,
    city: input.city ?? null,
    county: input.county ?? null,
    phase: input.phase,
    occupancyDate: input.occupancyDate ?? null,
    tenancyEndDate,
    monthlyRent: input.monthlyRent ?? null,
    depositAmount: input.depositAmount ?? null,
    purgeAfter: purgeAfter(tenancyEndDate),
    createdAt: now,
    updatedAt: now,
  };
}

export function patchRental(rental: Rental, patch: PatchRentalInput, now: Date): Rental {
  const next = { ...rental, ...patch, updatedAt: now };
  return { ...next, purgeAfter: purgeAfter(next.tenancyEndDate) };
}

// What the API returns. `ownerUid` stays on the server.
export function rentalJson({ ownerUid: _, purgeAfter, createdAt, updatedAt, ...rest }: Rental) {
  return {
    ...rest,
    purgeAfter: purgeAfter?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
