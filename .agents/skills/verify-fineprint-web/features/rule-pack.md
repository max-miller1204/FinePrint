# Rule pack

The legal rules every lease check cites (spec §7.4, #12). Data only:
`jurisdictions/<state>/rules/*.json`, each quoting a dated statute snapshot
in `jurisdictions/<state>/snapshots/`. Legal checks come from here, never
from model memory. No route of its own: the lease pipeline (#14) reads it
through `server/src/rules/`. How to add a state:
[`jurisdictions/TEMPLATE/README.md`](../../../../jurisdictions/TEMPLATE/README.md).

## Sub-features

- Schema: `jurisdictions/schema/rule.schema.json` (JSON Schema 2020-12).
  `checkType: "deterministic"` requires `deterministic: { fn, inputs }`,
  and other types forbid it. `verifiedBy` and `verifiedAt` come together.
  Each version has `effectiveFrom`, `effectiveUntil` (exclusive, or
  `null`), `statuteQuote`, and `snapshotFile`.
- Loader: `loadRulePacks()` / `loadRulePack(dir, { requireVerified })` in
  `server/src/rules/loader.ts`. It throws `RulePackError` with every issue
  when a file fails the schema, a quote is not verbatim in its snapshot's
  text (the header doesn't count), versions overlap or are out of order, an
  open-ended version is not last, the file name is not `<id>.json`, the
  id or `jurisdiction` does not match the folder, or the deterministic
  check is unknown or its inputs are wrong. `verifiedThrough` is the oldest
  `verifiedAt`, or `null` while any rule is unverified.
- Check registry: `server/src/rules/checks.ts`: `lateFeeCap`,
  `securityDepositCap`, `depositPlusInsuranceCap`,
  `maintenanceNoticeHours`. Pure functions on verified key terms, money in
  integer cents. Each returns `violates`, `complies`, or
  `insufficient_input` (missing, negative, or NaN), with `limit` and
  `actual`.
- Resolver: `server/src/rules/resolve.ts`. `versionsForTerm(rule, { start,
  end })` returns every version in force at some point of the lease term
  (`end` is the inclusive last day; `null` for a periodic tenancy), each
  with the slice of the term it covers. `resolveRules` adds `changes[{ on,
  quoteChanged }]` for rules that change mid-lease. `versionOn(rule,
  date)` is S6's "is this version in force on that day" check.
- Snapshots: `node scripts/refresh-snapshots.ts` re-fetches every snapshot
  from law.lis.virginia.gov and prints `ok`, `CHANGED` (with the changed
  paragraphs), `NEW` (a version on the page with no snapshot), or `GONE`.
  It exits 1 when anything differs. `--write` writes new dated files and
  names the rules to re-check. `--add <url> <state>` snapshots a new section.
- Pack today: `VA_LATE_FEE_CAP` (§ 55.1-1204(E)) with both versions, before
  and after July 1, 2027. It is unverified; #13 adds the rest of the
  rules and a person's verification.

## How to get to it (user POV)

Not reachable from a route yet. The first caller is `POST
/v1/rentals/:id/leases` (#14): S4 runs the registry, S5 puts every rule's
`summaryForModel` in the prompt, and S6 checks each cited rule version
against the lease dates.

## Driving it with e2e

No e2e test until a route reads the pack. `server/test/rules.test.ts`
covers it under `pnpm test`: it loads the real packs, checks the resolver
(both § 55.1-1204 versions for an October 2026 to October 2027 lease, the
exclusive and inclusive boundaries, open-ended terms, gaps, bad dates), runs
every check (including the cent that tips 10% over), breaks a scratch copy
of the pack one way at a time, runs `scripts/check-jurisdictions.ts` against
a snapshot whose subsection E was reworded (exit 1), and parses a fixture of
a two-version law.lis.virginia.gov page.

## Proof

`pnpm check:jurisdictions` prints `jurisdictions: 3 JSON file(s) parse, 2
rule(s) valid with quotes in their snapshots` and exits 0 (the VA rule and
the TEMPLATE example). `node scripts/refresh-snapshots.ts` prints `ok` for
both 55.1-1204 snapshots and exits 0 while the site's text is unchanged.

## Charters

None until a route reads the pack. The lease route's charter (#14) covers it.
