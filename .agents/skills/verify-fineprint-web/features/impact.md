# Opt-in impact counters

`PATCH /v1/me/impact` accepts only `{ impactOptIn: boolean }`, authenticated
as the account making the choice. It works before a rental exists. The
server defaults to false. `GET /impact` is public server-rendered HTML,
with no cookies, scripts, external assets, or client-side analytics.

`tests/web/impact.e2e.ts` covers validation, auth, concurrent repeat opt-ins,
opt-out, first move-in seals, repeat seals, no backfill, $500 lower-bound
buckets, aggregate-only storage, deletion, public HTML, zero totals, dark
mode, reduced motion, and maximum safe integer totals at 320 px.
`server/test/impact.test.ts` checks clause eligibility and UTC boundaries;
`server/test/emulator/impact.test.ts` proves analysis persistence, consent,
and duplicate completions against Firestore.

Counters live at `impact/{counterName}` with only `value`. Consent and
idempotency flags stay on the existing private user, rental, and lease
documents and disappear with them. No event collection is created. Only
future actions count. A first move-in seal processes that rental once,
including when opted out; existing manifests prevent historical backfill.
A lease completion processes each analysis once. Counters and the
underlying action commit together, reading consent in that transaction.

The five-day figure measures occupancy days 0 through 4 in UTC and is not
presented as a statutory objection deadline. Deposit dollars are rounded
down per rental to $500 before addition. Missing amounts add no dollars.
Unbuilt objection, repair, and actual legal-aid handoff workflows are
explicitly marked not tracked, not zero. No API accepts client increments.

Turning consent off stops future additions. Anonymous past totals remain
after opting out or deleting everything. One account counts once across
repeated toggles; a new account after deletion cannot be deduplicated
without retaining personal data. No historical activity is backfilled.

## Explore charter

impact|web|skeptic|Try to increment without consent, impersonate another account, send arbitrary metric names or amounts, and count one seal twice. Check /impact without authentication at 320px, with zero and extreme values. Confirm unbuilt metrics are labeled not tracked and no private data or tracking requests are exposed.

## Integration proof

After integrating PR 119's Evidence Report, the combined full web gate passed
41 tests in 12 files (two existing live-model skips), exit 0, including smoke,
impact, and all five report tests. Proof: `.e2e/proof/impact-main-merge`.
