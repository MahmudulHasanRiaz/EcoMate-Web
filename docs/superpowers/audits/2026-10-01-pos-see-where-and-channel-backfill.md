# Incident Report — POS "See Where" Reported No Stock (2026-10-01)

Status: **Resolved (code-side)** — awaiting production verification after redeploy

Also covers: the canonical sales-channel backfill that ships in the same release,
and two defects found while verifying it.

## Summary

On the `fxdmostul` production site, opening **See where** for a product that had
no showroom stock returned *"Not available in any other location"* — while the
main warehouse (godown) was in fact full. The alternative-location lookup
filtered on the exact `variantId`, so any warehouse stocking the product under a
**sibling variant** was excluded from the result entirely.

The warehouse was never empty and the stock rows were never wrong. The query
asked a narrower question than the UI was asking.

Measured on the affected site: **99 of 99** affected products were `variable`
products, **99** had no showroom row at all, and **99** held main-warehouse
stock only in variants the showroom had no row for. Simple products were
unaffected because their `variantId` is `NULL` and the filter was skipped.

## Timeline (2026-10-01)

| Time | Event |
|---|---|
| — | Redeploy of all three production stacks completes |
| — | Order list still shows legacy source badges as before (expected) |
| — | Order detail → Others Information shows the four canonical fields blank |
| — | POS: "See where" reports no stock although the godown is full |
| 12:4x | Warehouse census: `main` available=1587, `showroom` available=113 |
| 13:0x | Granularity census — 304/305 main rows are variant-level: mismatch hypothesis **rejected** |
| 13:2x | Drift census — 10 main rows have `reservedQuantity >= quantity` |
| 13:5x | Decisive census — 99/99 affected products confirmed variant-level exclusion |
| 14:0x | Fix shipped: product-level network lookup, per-variant detail, drift clamp |

## Contributing Factors (Root Cause)

1. **Variant-level filter on a product-level question** — `pos-orders.service.ts`
   applied `if (variantId) wherePhysical.variantId = variantId` to the
   alternative-location lookup. "Who else has this product?" is a product-level
   question, but the query asked for one exact variant. Any warehouse holding
   the product under a different variant produced zero rows, and
   `.filter(w => w.available > 0)` then removed everything left, so the UI
   reported "no location has stock".
2. **The same faulty assumption in two places** — `getProductAvailability`
   (the *See where* button) and `validateStock` (the cart's *Items Not
   Available* flow) built their alternative-source lists independently but
   identically. Fixing only one would have left the cart flow still saying
   "no location has stock" at checkout.
3. **`available` allowed to go negative** — `quantity - reservedQuantity` is
   used unclamped, and 10 rows on that site have `reservedQuantity > quantity`
   (reservation drift from historical order/cancel/return handling). A negative
   "available" is meaningless; those rows silently vanished behind
   `.filter(w => w.available > 0)`.
4. **`reserved` not accumulated** — the per-warehouse aggregation summed
   `stock` and `available` across rows but **dropped** `reserved`, so a
   multi-row warehouse reported the last row's reserved value as the total.
5. **Local environment could not reproduce it** — the development database
   held a single variable product whose showroom and godown rows shared variant
   IDs, so every query returned a plausible answer. The bug only appears when a
   product has stock at a location under a variant the showroom has never
   stocked.

## Evidence

Warehouse landscape (production, `fxdmostul`):

```
main     3rd Floor (Mostul)   active=true  available=1587
showroom Fixed Plus (Mostul) active=true  available=113
```

Granularity census — rejects the "stock is stored at the wrong level" theory:

```
 wh_type | all_rows | rows_with_stock | parent_level | variant_level
---------+----------+-----------------+--------------+---------------
 main     |      305 |             302 |            1 |           304
 showroom |       56 |              56 |            1 |            55
```

Only one parent-level row per warehouse, so stock is correctly stored per
variant. The 99 affected products all have **no showroom row at all**, and their
main-warehouse stock sits in variants the showroom never stocked — which is
precisely the case an exact-variant filter discards.

## Resolution

- The alternative-location lookup in both `getProductAvailability` and
  `validateStock` now aggregates at **product level**, so a location is never
  hidden merely because it stocks a sibling variant.
- The exact-variant quantity is still returned (`exactVariantAvailable`,
  `exactVariantStock`) and surfaced in both POS dialogs, because a transfer is
  variant-precise: the cashier is told *"other variant"* and prompted to confirm
  before requesting.
- `available` is clamped at zero, and `reserved` is now accumulated across rows.

Regression coverage: `apps/backend/src/pos/__tests__/pos-product-availability.spec.ts`
(7 cases) — the sibling-variant case that produced the production report, drift
clamping, multi-variant aggregation, showroom exclusion, and simple products.

## Prevention notes

- A "no results" state that is indistinguishable from "no data" is hard to
  diagnose from the UI. The dialogs now distinguish *no location* from *no
  matching variant*.
- The local database could not reproduce this because every variant was stocked
  in the showroom. `prisma/scripts/seed-e2e-test-data.ts` now creates a
  dedicated **godown-only variable product** — no showroom row at all, stock in
  a second warehouse — so the shape that caused the incident exists in
  development and is covered by the test suite.

**Verified:** the seed fixture reproduces the production shape locally
(`variable`, showroom-zero at product level, stock present in `main`), and the
availability endpoint returns `network: [{ warehouseName: "Main Godown",
available: 35, exactVariantAvailable: 35 }]` for it.

---

# Part 2 — Canonical sales-channel backfill (same release)

## Issue

After the redeploy the order list still displayed the legacy source badges and
the **Others Information** dialog showed Channel / Channel Entity / Source /
Acquisition Type as blank for pre-existing orders.

## Cause and resolution — behaviour was correct

This was **not** a defect. The schema migration runs automatically
(`apps/backend/startup.sh` → `npx prisma migrate deploy`), so the four columns
exist but are `NULL` for historical rows. The data migration is a separate
script that is deliberately **not** wired into startup.

- The order list still reading legacy badges is intended: `OrderSourceBadges`
  keeps reading `salesChannel`/`sourcePlatform`/`sourceType`/`sourceEntity`,
  which are preserved unchanged, because legacy consumers and exports still
  depend on them.
- Running the backfill populates the canonical dimensions:

```bash
# dry run first — writes nothing, prints the mapping report
npx tsx prisma/scripts/backfill-sales-channel-mapping.ts
npx tsx prisma/scripts/backfill-sales-channel-mapping.ts --apply
```

Verified safe on the affected site (1012 orders): the dry-run report is
internally consistent (782 WEBSITE + 197 MESSAGING + 4 PHONE_CALL + 11 NULL +
18 POS = 1012), and `DIRECT` (65) stays distinct from `ORGANIC` (28) as the
model requires.

**Not destructive by construction** — the backfill only writes the new columns
plus the `channelMappedAt` marker. `Order.source`, `salesChannel`,
`sourcePlatform`, `sourceType`, `sourceEntity`, attribution blobs, campaign and
click-id data are never read for update or rewritten, so a rollback is not
required and historical meaning is preserved.

### Operational note for future deploys

The schema migration is automatic; **the backfill is not**. Any environment that
adds orders while the canonical columns are still `NULL` will show blank
Channel/Entity/Source/Acquisition in Others Information until the backfill is
run. Two consequences worth remembering:

- The backfill is safe to re-run (it is a no-op once `channelMappedAt` is set)
  and skips orders created after its boundary, so it can be run on a live site.
- `channel IS NULL` must **never** be used as a "not yet migrated" marker. A NULL
  channel is the correct mapping for most historical orders, so that guard would
  skip them permanently. The `channelMappedAt` marker exists for exactly this
  reason.

Run it per environment, in the backend container:

```bash
npx tsx prisma/scripts/backfill-sales-channel-mapping.ts          # dry run
npx tsx prisma/scripts/backfill-sales-channel-mapping.ts --apply
```

---

# Part 3 — Two defects found during verification

## 3a. `SourcePlatform` registry seeded with empty capabilities

Capability filtering (`MESSAGING`) returned nothing, because an early revision
of the backfill script inserted registry rows with `capabilities = []`.

A first fix attempt treated "capabilities is empty" as "uncustomized" and
repaired those rows. **That was wrong**: an operator may legitimately empty a
row's capabilities to withdraw a platform from a channel, and an empty array is
not evidence of an uncustomized row.

Resolution, preserving the operator-customization invariant:

- `ensureDefaults()` is strictly **insert-only** (`skipDuplicates`), and never
  updates an existing row.
- The backfill's seeding step is also insert-only and performs no update.
- The wrongly seeded rows were repaired by a **one-time data fix** that proved
  provenance — placeholder `sortOrder = 500` **and** canonical capabilities
  **and** canonical display name — rather than inferring it. 17 rows had
  `sortOrder` corrected from the placeholder `500` to their canonical values;
  their capabilities had already been set. The script has since been deleted
  now that every environment is repaired.
- Tests assert that a row with `capabilities = []` and a row with custom
  capabilities both survive `ensureDefaults()` unchanged, and that a missing
  default is inserted with canonical capabilities.

Live proof: a row whose capabilities were set to `{}` survived a runtime
`ensureDefaults()` call untouched — the case the rejected fix would have undone.

### 3c. A transfer could be requested for the wrong SKU

Found on production after the "See where" fix landed: opening a variant showed
**23 available** when that variant held fewer, because 23 was the whole
product's total across every variant (`L`, `M`, `XL`, `XXL`).

This was a direct consequence of the product-level fix. The lookup was
correctly widened to product level — but the dialog kept displaying and
sending the **product total** while carrying a single `variantId`. Each variant
is its own SKU with its own inventory rows, so that number could move stock
belonging to a sibling variant.

Resolution, in all three places the confusion appeared:

- **StockLocationsModal** now pre-fills, validates, maxes the input and
  **displays** `exactVariantAvailable` — that variant's own stock. A simple
  product has no `variantId`, so the product total is correct there.
- **The cart's alternative-sources modal** shows the same variant-precise
  figure.
- **`initiateTransfer` validates against the exact variant's inventory at the
  source location** and rejects the request when it cannot be covered. This is
  the real guard: the UI can be bypassed, the API cannot, and it is what stops
  stock moving onto the wrong SKU.

Two regression tests cover the reported shape — 23 available on the product but
3 on the variant is rejected — and the matching accept case.

### 3d. Messenger offered as a separate Source

The messaging source dropdown listed **Messenger** alongside Facebook, which
should not have happened: Messenger is a messaging *surface* of Facebook, not a
distinct advertising platform.

- Meta's Conversions API is driven by **one pixel and one ad account** for both
  Facebook and Messenger traffic, and `utm_source=messenger` resolves to the
  same ad account as `utm_source=facebook`.
- Offering both would let one order claim **two platforms for the same ad**,
  double-counting it in paid attribution and splitting attributed spend.

Resolution: `messenger` was removed from the registry seeds and from the legacy
platform→slug table. `Channel = Messaging` + `Source = Facebook` is the
complete answer for a Messenger order. No order referenced
`sourceSlug = 'messenger'`, so no historical data changed, and the legacy
`salesChannel = MESSENGER` value still maps to `facebook`.

## 3b. CI build failure — `tsc -b` vs `tsc --noEmit`

The admin build failed in CI with three type errors in
`apps/admin/src/features/orders/create.tsx`: an unimported `CardDescription`,
and two `<select>` handlers passing `string` to typed setters.

Cause: verification had used `tsc --noEmit` while CI builds with `tsc -b`.
Verified afterwards with the command CI actually runs, and with the full
four-app build.

### 3e. Every order row showed two overlapping sets of source badges

After the channel backfill ran, each order rendered the new canonical badges
(`Website` · `facebook` · `PAID`) directly beside the legacy ones (`WEBSITE` ·
`FACEBOOK · AD`) — five or six badges where two or three belong.

The new badges had been added *alongside* the legacy ones instead of replacing
them, so the same fact was painted twice and the row became unreadable.

Resolution: the legacy badges are now a **fallback**, rendered only while an
order has no canonical mapping (i.e. before the backfill has run). The legacy
columns themselves are untouched — still stored, still feeding every legacy
filter, report and export; the UI simply stops painting them twice.

---

# Notes on method

Root cause was established from production data, not from reasoning. Five
earlier hypotheses were tested and rejected: variant-granularity mismatch,
product-ID mismatch, warehouse scoping, reservation drift as the primary cause,
and a third SQL variant. Three SQL queries sent for diagnosis were themselves
wrong (`GROUP BY` on a concatenated expression, twice; a misplaced parenthesis,
once) — the one query that mattered was executed locally before being sent.

Once the data showed 99/99 on two independent measures, the fix was written
against that evidence rather than against a plausible story.
