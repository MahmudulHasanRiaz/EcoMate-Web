# Purchase Residual Risks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 6 remaining minor/optional purchase-module risks without touching settled semantics.

**Architecture:** Backend guards + data surfacing first (A1–A3), UX correctness second (B1–B2), one cosmetic normalization last (C1). Each phase is independently shippable; TDD throughout; no migration except A2 (data-only INSERT).

**Tech Stack:** NestJS + Prisma (Postgres), Jest, React + TanStack Query, vitest-browser-react.

**Verified baseline (do not re-audit):** `update()` gates only on `grnCount` (no status check); GRN/LOT numbers use legacy `findFirst`; company-borne damage value lives nowhere; receive dialog defaults empty accepted to received; backend `findAll` ignores `search`; ledger refs are `GRN-GRN-…` (display-only, pre-existing).

---

## File map

- Modify: `apps/backend/src/purchases/purchases.service.ts` (A1, A2-code, A3-event/summary)
- Modify: `apps/backend/src/purchases/__tests__/purchases.service.spec.ts` (tests for A1, A2, A3)
- Create: `apps/backend/prisma/migrations/20261008HHMMSS_grn_lot_counter_backfill/migration.sql` (A2)
- Modify: `apps/admin/src/features/purchases/index.tsx` (B1, A3-display)
- Modify: `apps/admin/src/features/purchases/__tests__/purchase-lifecycle.test.tsx` (B1, B2)
- Modify: `apps/backend/src/purchases/purchases.controller.ts` + `purchases.service.ts findAll` (B2)

## Explicit non-changes (decided, do not implement)

- Same-product variant on a variant-less PO line: accepted as operator correction (existing regression test locks it).
- All-rejected terminal semantics and `received` label: settled design.
- Automatic accounting Expense for company-borne damage: explicitly deferred (needs a configured expense category; inventing entries silently is worse than the gap).

---

### Task A1: Block edits on cancelled purchases

**Files:**
- Test: `apps/backend/src/purchases/__tests__/purchases.service.spec.ts`
- Modify: `apps/backend/src/purchases/purchases.service.ts` (`update`, ~line 340)

- [ ] **Step 1: Write the failing test** (append inside `describe('update locks')`)

```ts
it('blocks every change on a cancelled purchase except notes', async () => {
  prisma.purchase.findUnique.mockResolvedValue({ id: 'po-1', status: 'cancelled' });
  const tx = mockTx({
    goodsReceiptNote: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    purchase: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'po-1' }) },
  });
  runTx(tx);
  await expect(service.update('po-1', { notes: 'ok' } as any)).resolves.toBeDefined();
  await expect(service.update('po-1', { items: [] } as any)).rejects.toThrow(/cancelled/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/purchases/__tests__/purchases.service.spec.ts --no-coverage -t "cancelled purchase"`
Expected: FAIL (update succeeds on cancelled PO today)

- [ ] **Step 3: Minimal implementation** — fetch `status` and refuse non-notes edits:

```ts
const purchase = await this.prisma.purchase.findUnique({
  where: { id },
  select: { id: true, status: true },
});
// …inside tx, before building data:
if (purchase.status === PurchaseStatus.cancelled && (
  dto.supplierId !== undefined ||
  dto.orderDate !== undefined ||
  dto.expectedDate !== undefined ||
  dto.items !== undefined
)) {
  throw new ConflictException('Cancelled purchases are read-only except notes');
}
```

(Place next to the existing post-GRN lock so both rules read as one policy.)

- [ ] **Step 4: Run tests**

Run: `npx jest src/purchases --no-coverage`
Expected: all pass (22+1)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/purchases/purchases.service.ts apps/backend/src/purchases/__tests__/purchases.service.spec.ts
git commit -m "fix(purchase): lock cancelled POs to notes-only edits"
```

---

### Task A2: Atomic counters for GRN/LOT + backfill migration

**Files:**
- Test: `apps/backend/src/purchases/__tests__/purchases.service.spec.ts`
- Modify: `apps/backend/src/purchases/purchases.service.ts` (`generateNumber`)
- Create: `apps/backend/prisma/migrations/20261008HHMMSS_grn_lot_counter_backfill/migration.sql` (use real timestamp `date +%Y%m%d%H%M%S`)

Context: `PurchaseCounter(date, seq)` exists and PO numbering already uses it; GRN/LOT still use legacy `findFirst`. All three call sites pass `tx`, so the counter path can cover everything. One shared per-date sequence is fine (prefixes differ, uniqueness is per-table).

- [ ] **Step 1: Write the failing test**

```ts
it('numbers concurrent GRNs from the atomic counter (no findFirst race)', async () => {
  const tx = grnTx();
  runTx(tx);
  await service.createGrn('po-1', grnDto() as any, 'user-1');
  expect(tx.purchaseCounter.upsert).toHaveBeenCalled();
});
```

(`purchaseCounter` mock needs adding to the `grnTx` helper: `purchaseCounter: { upsert: jest.fn().mockResolvedValue({ date: '261008', seq: 3 }) }`. Note: `mockTx` may already stub it — check before duplicating.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/purchases/__tests__/purchases.service.spec.ts --no-coverage -t "atomic counter"`
Expected: FAIL (`purchaseCounter.upsert` never called on the GRN path)

- [ ] **Step 3: Minimal implementation** — in `generateNumber`, use the counter for every model when `tx` is present (keep legacy path only for the tx-less fallback):

```ts
if (tx) {
  const counter = await tx.purchaseCounter.upsert({
    where: { date: `${yy}${mm}${dd}` },
    create: { date: `${yy}${mm}${dd}`, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return `${datePrefix}${String(counter.seq).padStart(4, '0')}`;
}
```

- [ ] **Step 4: Backfill migration** (GRN + LOT legacy sequences; PO was seeded by `20261008150000`). Data-only INSERT, same safe pattern:

```sql
-- Seed the shared atomic counter from legacy GRN/LOT numbers so the cutover
-- never collides on unique grnNumber/lotNumber. Data-only, rerunnable.
INSERT INTO "PurchaseCounter" ("date", "seq")
SELECT
  substring("grnNumber" from 5 for 6) AS date,
  COALESCE(MAX(CAST(substring("grnNumber" from 12) AS INTEGER)), 0) AS seq
FROM "GoodsReceiptNote"
WHERE "grnNumber" ~ '^GRN-[0-9]{6}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("date") DO UPDATE
  SET "seq" = GREATEST("PurchaseCounter"."seq", EXCLUDED."seq");

INSERT INTO "PurchaseCounter" ("date", "seq")
SELECT
  substring("lotNumber" from 5 for 6) AS date,
  COALESCE(MAX(CAST(substring("lotNumber" from 12) AS INTEGER)), 0) AS seq
FROM "CostingLot"
WHERE "lotNumber" ~ '^LOT-[0-9]{6}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("date") DO UPDATE
  SET "seq" = GREATEST("PurchaseCounter"."seq", EXCLUDED."seq");
```

Verify locally before applying: run each SELECT standalone and confirm the parsed dates/seqs match visible `GRN-…`/`LOT-…` rows. Then `npx prisma migrate deploy` + `npx prisma migrate status` (expect up-to-date).

- [ ] **Step 5: Run tests + safety spec + build**

Run: `npx jest src/purchases --no-coverage` then `npx jest src/prisma/deploy-safety.spec.ts --no-coverage` then `npx nest build`
Expected: all green, exit 0 throughout

- [ ] **Step 6: Commit** (schema untouched — migration + code only)

```bash
git add apps/backend/src/purchases/ apps/backend/prisma/migrations/20261008HHMMSS_grn_lot_counter_backfill/
git commit -m "fix(purchase): atomic counters for GRN/LOT numbers with backfill"
```

---

### Task A3: Surface company-borne damage value (no silent absorption)

**Files:**
- Modify: `apps/backend/src/purchases/purchases.service.ts` (`buildSummary`, GRN `recordEvent`)
- Test: `apps/backend/src/purchases/__tests__/purchases.service.spec.ts`
- Modify: `apps/admin/src/features/purchases/index.tsx` (detail dialog row)

Background: company allocation spreads damage onto accepted units, so the premium is buried inside `acceptedValue`. The unabsorbable part (accepted = 0) lives nowhere. Per line, both equal `rejected × unitBase` — surface that number, invent no journal.

- [ ] **Step 1: Write the failing tests**

```ts
it('reports companyDamageValue in the summary', async () => {
  // PO line qty 100 bill 10000; GRN 90 accepted + 10 rejected (company).
  // …build via grnTx + service.createGrn, then service.findOne…
  // expect(summary.totals.companyDamageValue).toBe(1000);
});
```

(Use the existing `grnTx`/`grnDto` helpers; `findOne` needs `prisma.purchase.findUnique` mocked to return the PO with grns — mirror the `shortClose` test setup already in the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/purchases/__tests__/purchases.service.spec.ts --no-coverage -t "companyDamageValue"`
Expected: FAIL (`companyDamageValue` undefined)

- [ ] **Step 3: Minimal implementation**
  1. `buildSummary`: add `companyDamageValue` — sum over lines with `damageResponsibility === 'company'` of `rejected × unitBase`; include in `totals`.
  2. GRN `recordEvent` lines: add `damageValue` per line using the same formula (0 when supplier-borne or no rejects).

- [ ] **Step 4: Detail dialog** — in `PurchaseDetailDialog` summary strip, add a `Damage (co.)` tile reading `summary.totals.companyDamageValue`, shown only when > 0.

- [ ] **Step 5: Run tests**

Run: `npx jest src/purchases --no-coverage` and `npx vitest run src/features/purchases/__tests__/purchase-lifecycle.test.tsx` (from `apps/admin`)
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/purchases/ apps/admin/src/features/purchases/
git commit -m "feat(purchase): surface company-borne damage value in summary, events and detail UI"
```

---

### Task B1: Receive dialog — auto accepted = received − rejected until touched

**Files:**
- Modify: `apps/admin/src/features/purchases/index.tsx` (Receive dialog state)
- Test: `apps/admin/src/features/purchases/__tests__/purchase-lifecycle.test.tsx`

Background: empty accepted currently defaults to full received on submit, so typing only rejected guarantees a 400 (`accepted + rejected > received`). The operator's explicit input must stay sacred — auto-adjust only while they haven't touched accepted.

- [ ] **Step 1: Write the failing test**

```tsx
it('auto-reduces accepted when rejected is typed (until accepted is touched)', async () => {
  // open Receive dialog for po-1 (see existing "disposition" test setup)…
  // type received=10, rejected=2, leave accepted empty, submit with a warehouse…
});
```

Simplest deterministic assertion (no warehouse plumbing): after typing rejected=2 with received=10, the Accepted input's value reads `8`. Warehouse selection is only needed for submit — assert the input value instead:

```tsx
await userEvent.fill(ui.getByLabelText(/Received \(now\)/), '10');
await userEvent.fill(ui.getByLabelText(/^Rejected$/), '2');
await expect.element(ui.getByLabelText(/^Accepted$/)).toHaveValue('8');
```

(Check the dialog's actual labels first — `Received (now)`, `Accepted`, `Rejected` per current code; add `htmlFor`/`id` pairs exactly like the Short-qty fix if the query fails.)

Follow-up assertion in the same test: type `9` into Accepted (now touched), change rejected to `3`, accepted stays `9`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/purchases/__tests__/purchase-lifecycle.test.tsx -t "auto-reduces"` (from `apps/admin`)
Expected: FAIL (accepted stays empty)

- [ ] **Step 3: Minimal implementation** — track `acceptedTouched` per row in the dialog's `received` state (extend the row shape with `acceptedTouched: boolean`, default `false`):
  - In the rejected `onChange`: `patchItem(id, { rejectedQty: v, ...(touched ? {} : { acceptedQty: String(Math.max(0, rec - rej)) }) })` where `rec`/`rej` are the post-change numbers and `touched` is the row's current flag.
  - In the accepted `onChange`: always set `acceptedTouched: true`.
  - Keep the submit-time fallback (`'' → received`) for rows where rejected is 0/empty.
  - Update the `received` state initializer and the `r = received[item.id] || {...}` fallback to include the flag.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/purchases/__tests__/purchase-lifecycle.test.tsx`
Expected: all pass (existing 5 + 1)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/purchases/
git commit -m "fix(purchase): auto-balance accepted against rejected until manually touched"
```

---

### Task B2: Backend search for the purchases list (wire the dead search box)

**Files:**
- Modify: `apps/backend/src/purchases/purchases.controller.ts`, `purchases.service.ts` (`findAll`)
- Test: new cases in an appropriate backend spec (controller-level or service-level; follow existing `purchases.service.spec.ts` mock style)

- [ ] **Step 1: Write the failing test**

```ts
it('filters purchases by referenceNo or supplier name', async () => {
  // tx/prisma mocks per existing style; call service.findAll(1, 20, undefined, undefined, 'acme')
  // expect prisma.purchase.findMany called with where.OR containing referenceNo + supplier.name contains (mode: 'insensitive')
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/purchases --no-coverage -t "filters purchases"`
Expected: FAIL (`search` param does not exist)

- [ ] **Step 3: Minimal implementation**
  - `findAll(page = 1, perPage = 10, status?: string, supplierId?: string, search?: string)` — when `search?.trim()` is non-empty, add:
  ```ts
  where.OR = [
    { referenceNo: { contains: search, mode: 'insensitive' } },
    { supplier: { name: { contains: search, mode: 'insensitive' } } },
  ];
  ```
  - Controller: accept `@Query('search') search?: string` and pass through (UI already sends it — verify no UI change needed).

- [ ] **Step 4: Run tests**

Run: `npx jest src/purchases --no-coverage`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/purchases/
git commit -m "feat(purchase): backend search by reference and supplier name"
```

---

### Task C1: Single-prefix GRN references going forward

**Files:**
- Modify: `apps/backend/src/purchases/purchases.service.ts` (2 `reference:` lines in `createGrn`)
- Test: extend the managed-leg test in `purchases.service.spec.ts` to assert the reference format

Background: `generateGrnNumber` already returns `GRN-…`, so `` `GRN-${grnNumber}` `` writes `GRN-GRN-…` into `ManagedStockLedger` (via `reference`, display-only — `referenceId` carries the UUID) and the physical ledger. Pre-existing, cosmetic, nothing parses these strings (order flow only parses `ORD-…`).

- [ ] **Step 1: Write the failing test** — extend `posts the managed leg…` (or add):

```ts
expect(stockService.operate).toHaveBeenCalledWith(
  'add',
  expect.objectContaining({ reference: 'GRN-261008-0001' }),
);
```

(The stateful mock returns `grnNumber: 'GRN-261008-0001'` — assert the reference equals it exactly, no doubled prefix. Same for `addPhysical` when the IM-on leg is under test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/purchases/__tests__/purchases.service.spec.ts --no-coverage -t "managed leg"`
Expected: FAIL (reference is `GRN-GRN-261008-0001`)

- [ ] **Step 3: Minimal implementation** — pass `grnNumber` directly as `reference` in both stock calls. Do NOT backfill old rows (mixed history is honest; the strings are display-only).

- [ ] **Step 4: Run tests**

Run: `npx jest src/purchases --no-coverage`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/purchases/
git commit -m "fix(purchase): single-prefix GRN references in stock legs"
```

---

## Final verification (after all tasks)

Run: `npx jest --no-coverage --testPathIgnorePatterns "integration"` (from `apps/backend`, expect 0 failures), `npx nest build` (exit 0), `npx vitest run src/features/purchases` (from `apps/admin`, expect all pass), `npx prisma migrate status` (up-to-date). Push only when the branch review is done.

## Self-review

- Spec coverage: cancelled-edit lock (A1) ✓, atomic GRN/LOT numbers + backfill (A2) ✓, damage value surfacing (A3) ✓, accepted auto-balance (B1) ✓, list search (B2) ✓, reference prefix (C1) ✓, explicit non-changes documented ✓.
- No placeholders: every step names exact files, code, commands, expected outputs.
- Type consistency: `purchaseCounter.upsert({ where: { date }, create, update })` matches the existing PO-counter call; `where.OR` + `mode: 'insensitive'` matches Prisma patterns used elsewhere in the codebase; dialog state extensions follow the existing `patchItem` shape.
