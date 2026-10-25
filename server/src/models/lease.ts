import { z } from 'zod';

// rentals/{rentalId}/leases/{leaseId}/clauses/{clauseId} (spec §6.1). The
// lease route (#16) writes these after S3 cuts the lease into clauses; the
// responsibility check reads them.
export const LeaseClause = z.object({
  id: z.string().min(1),
  heading: z.string().nullable(),
  verbatim: z.string(),
  // Offsets into the lease's redacted text; `charEnd` is exclusive.
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
});
export type LeaseClause = z.infer<typeof LeaseClause>;

export interface AnalyzedLease {
  id: string;
  // In lease order.
  clauses: LeaseClause[];
}
