# Return/Exchange Detail Pages + Scan-Mode Return Batching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, directive-mandated single-commit flow) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rich return/exchange detail pages, a full-width context-aware scan-mode list, and staged (never-instant), persisted, batch-executed RETURN_RECEIVE scans.

**Architecture:** Backend feeds everything in ONE request per surface: `GET /returns/:id` embeds the original order (customer snapshot + item snapshots) so the return detail joins coverage client-side; `POST /scanner/resolve` embeds item previews (name/sku/image/qty) on orders, dispatches and linked return/exchange legs so staged-row expansion needs no extra requests. Admin reuses the shared `StagedList` row pattern (extended with phone + contact actions + chevron expansion) and reuses the order-detail page wholesale for exchanges (no fork). RETURN_RECEIVE scans stage into a localStorage-persisted list with stage-time validation and a re-validating batch executor.

**Tech Stack:** NestJS + Prisma (backend), React 19 + TanStack Router/Query + shadcn/ui + vitest-browser (admin).

**Spec:** Owner directive `/superpowers` 2026-10-20 (pre-approved; encoded below as Global Constraints + acceptance criteria).

## Global Constraints (from the directive — verbatim rules)

- Branch `feat/return-detail-scan-batch` from current `origin/main`. ONE commit. NEVER push (owner pushes).
- Reuse `CustomerContactActions` (`@/components/customer-contact-actions`) — never rebuild contact buttons.
- Follow the existing `StagedList`/`StagedRow` pattern for return staging — do not invent a new one.
- Exchange detail: compose from shared order-detail components; do NOT fork-duplicate the order detail page.
- Expanded scan-row data comes from the ALREADY-FETCHED scan outcome payload — no extra request per expand.
- Return-purpose expansion shows the RETURN's line items (products IN THE RETURN, images + quantities); sticker/other purposes show the MAIN ORDER's line items.
- Persist the staged return list under localStorage key `ecomate:scanner:return-staged`; clear with confirm; process re-validates at process time.
- Accidental-error spotter language: "This return covers X of Y items from ORD-…" — FULL shows "FULL — all Y items", PARTIAL shows "PARTIAL — X of Y items".
- 100% responsive on all screens.
- Repo rules: schema edit → migration mandatory (no `db push`); schema+migration+tests ship together; backend `nest build` after any backend .ts change; admin `npx tsc --noEmit` + full vitest after admin changes.
- AGENTS.md banner rule (still in force): "This phone number is blocked for storefront ordering." — irrelevant here but phone formatting must use snapshot phones as-is.

## Review Focus (inputs most likely to bite a person)

| # | Input | Expected behavior | Pinned by test |
|---|-------|-------------------|----------------|
| 1 | Return whose `items` is EMPTY (courier-sourced) | Detail never divides by zero / shows "quantities unknown — courier never reports the split; confirm at mark-received" instead of X of Y | Admin return-detail test — courier-shaped fixture |
| 2 | PARTIAL return that covers every ordered item (the owner's real accident) | Red warning banner "covers ALL Y items" — cannot be mistaken as fine | Admin return-detail test |
| 3 | RETURN_RECEIVE scan of an already-RESTOCKED return → stage → process | Stage row shows warning "Already received"; process leaves it with reason (duplicate outcome) — never mutates twice | Backend purpose test + admin batch test |
| 4 | Staged return rows survive refresh/disconnect | localStorage restore lists unprocessed rows verbatim, no network call needed | Admin scanner persistence test |
| 5 | Exchange order detail opened by a PUBLIC/customer view token | `exchangeOfOrder` (original order's items/customer) must be stripped for non-admin; staff only | Backend orders.spec (public shape) |
| 6 | Mixed batch (1 success + 1 failure + 1 already-received) | Successes leave the list; failures stay; duplicate leaves; per-item results recorded in feed | Admin batch test |

---

### Task 1: Backend — Return.createdBy column + migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (model Return)
- Create: `apps/backend/prisma/migrations/<ts>_return_created_by/migration.sql`
- Modify: `apps/backend/src/returns/returns.service.ts` (`createInner`, `get`)
- Test: `apps/backend/src/returns/returns.service.spec.ts`

**Interfaces:**
- Produces: `Return.createdBy: string|null` (staff email or free-text performer); `create(dto, performedBy?)` continues to accept the same signature — controller/exchange callers unchanged.

- [x] **Step 1: Schema + migration (DDL-only, additive).** Add to `model Return`: `createdBy String?` with comment "Staff email of the return creator (null for webhook-sourced rows)". Generate migration via `npx prisma migrate dev --name return_created_by` — must apply cleanly (no drift). Exact SQL expected: `ALTER TABLE "Return" ADD COLUMN "createdBy" TEXT;`
- [x] **Step 2: Write service test first** — extend spec: `create()` with `performedBy: 'a@b.c'` persists `createdBy: 'a@b.c'` on the return row (assert `return.create` call data); without performedBy → `createdBy: null`.
- [x] **Step 3: Implement** — `createInner` data adds `createdBy: performedBy ?? null`; `get()` returns `createdBy` via spread (free) — no other change.
- [x] **Step 4: `npx prisma validate` + `npx nest build` clean; run `npx jest src/returns --silent` green.**

### Task 2: Backend — GET /returns/:id deep include (order customer + item snapshots)

**Files:**
- Modify: `apps/backend/src/returns/returns.service.ts` (`get`)
- Test: `apps/backend/src/returns/returns.service.spec.ts`

**Interfaces:**
- Produces on `GET /returns/:id`: `order` = `{ id, displayId, kind, createdAt, customerFirstName, customerLastName, guestName, customerPhone, guestPhone, customer: {id,name,email,phone}, items: [{ id?, productId, variantId, quantity, price, product: {id,name,sku,images}, variant: {id,sku,image,images, attributeValues(+attribute)} }] }`. Return row keeps scalar `items` Json and `createdBy`.

- [x] **Step 1: Test first** — spec asserts `prisma.return.findUnique` called with `include.order.select` containing `customer` + `items` (product/variant selects); response keeps `ret.order` through.
- [x] **Step 2: Implement** — change `get()` include to the shape above. NO per-item queries (one findUnique total; keep the 2 existing best-effort lookups for exchangeOrder/refund).
- [x] **Step 3: `npx jest src/returns --silent` green + `npx nest build` clean.**

### Task 3: Backend — scanner resolve payload enrichment

**Files:**
- Modify: `apps/backend/src/scanner/scanner.types.ts`
- Modify: `apps/backend/src/scanner/scanner-resolver.ts`
- Modify: `apps/backend/src/scanner/purposes/return-receive.purpose.ts`
- Test: `apps/backend/src/scanner/scanner.service.spec.ts` (+ purpose-specific assertions)

**Interfaces:**
- Produces (additive types, all optional so existing consumers stay valid):
  - `ScanItemPreview { name: string; variantLabel?: string; sku?: string|null; image?: string|null; quantity: number; price?: number }`
  - `OrderPreview.items?: ScanItemPreview[]` (order lines)
  - `DispatchPreview.items?: ScanItemPreview[]` (the order's lines)
  - `ScanLinkedCandidate` gains `statusPlus`: keep `kind/id/displayId/status` and add `image?: string|null`, `coversUnits?: number`, `orderUnits?: number`, `orderDisplayId?: string`, `processable?: boolean`, `reason?: string|null`, `items?: ScanItemPreview[]` (RETURN legs = returned goods; EXCHANGE legs = exchange order's new goods).
- Consumes: `orderRowFacts`/resolver item include extension — the order/dispatch previews embed items from the SAME fetch (resolver queries already fetch order rows; extend `items` select only).

- [x] **Step 1: Tests first**
  - resolver: order-number scan returns `order.items` (name/sku/image/qty/price) — plain + variant lines; dispatch scan returns `dispatches[0].items` from the same order row.
  - return-receive resolve (single leg): candidate carries `items` (returned line entries incl image+quantity), `coversUnits` (Σ return qty), `orderUnits` (Σ order qty), `processable: true`, `orderDisplayId`.
  - RESTOCKED/`stockReconciled` leg: `processable: false`, reason "Already received — stock was restored earlier." (wording mirrors backend duplicate).
  - exchange leg: carries the exchange order's items; `processable: true` (info-only), trashed exchange excluded.
  - CLOSED returns still excluded (existing rule).
- [x] **Step 2: Implement**
  - Add exported `orderItemPreview(it: any): ScanItemPreview|null` helper in scanner-resolver.ts (name = product name via `variant.product.name ?? product.name`; variantLabel via attributeValues `name: value` join; image = variant.image → first(variant.images) via `resolveImage`-like logic → first(product.images); graphics rules copied from packing.service `firstOf` approach; price = Number(item.price)).
  - Extend both resolver order includes so items embed product/variant subselects (single query each path, no N+1).
  - `toOrderPreview`/`toDispatchPreview` map `items` via the helper (cap 50 lines).
  - `linkedCandidates(orderId, ctx)` — fetch order line quantities once (single `order.findUnique` select) for `orderUnits`; build product/variant lookup `findMany`s ONLY when legs exist; compute per-leg fields; keep exactly one `Promise.all` pair (returns + exchanges with `include: { status: true, items: { include: product/variant } }`).
  - `resolve()` passes the outcome `order?.itemCount` context if available but computes numbers self-contained (they must not depend on the shape).
- [x] **Step 3: `npx jest src/scanner --silent` green; `npx nest build` clean.**

### Task 4: Backend — exchange parent include on order detail (staff-only)

**Files:**
- Modify: `apps/backend/src/orders/orders.service.ts` (`findOne` include + non-admin strip)
- Test: `apps/backend/src/orders/__tests__` (orders.service public-shape spec — check existing file covering public token shape; add assertion there or new spec under `src/orders`)

**Interfaces:**
- Produces: `GET /orders/:id` (staff) embeds `exchangeOfOrder: { id, displayId, kind, status, subtotal, shippingCharge, discount, discountType, total, items: [{ productId, variantId, quantity, price, product: {id,name,sku,images}, variant: {id,sku,image,images} }] }` for EXCHANGE-child orders; absent/null for all others (free).
- Produces: non-admin (public/customer token) responses strip `exchangeOfOrder` entirely (type of include kept out of public shape).

- [x] **Step 1: Test first** — staff shape (isAdmin) contains `exchangeOfOrder.items[0].product.name`; customer-token shape does NOT contain `exchangeOfOrder` relation data beyond the plain FK `exchangeOfOrderId`… Actually keep FK visibility as-is today; only the new relation is stripped. Assert staff sees items; token path returns undefined `exchangeOfOrder`.
- [x] **Step 2: Implement** — add include branch `exchangeOfOrder: { include: { status: { select: { id, name, color? } }, items: { select: { productId, variantId, quantity, price, product: {...}, variant: {...} } } } }` (select parent scalars + items minimal); in `findOne` after computing `isAdmin`: `if (!isAdmin) (order as any).exchangeOfOrder = null` BEFORE `transformOrder`.
- [x] **Step 3: `npx jest src/orders/__tests__ src/orders --silent` targeted green; `npx nest build` clean.**

### Task 5: Admin — Return detail page rebuild

**Files:**
- Modify: `apps/admin/src/features/returns/detail.tsx` (full rebuild, keep action handlers)
- Modify: `apps/admin/src/features/returns/api.ts` (ReturnDetail extends `order` payload typing)
- Test: `apps/admin/src/features/returns/return-detail.test.tsx` (rewrite + extend)

**Interfaces:**
- Consumes: Task 2 payload (`ret.order.customer…`, `ret.order.items[]`, `ret.items[]` Json, `ret.createdBy`), Task 1 `createdBy`.
- Produces: `ReturnDetail` renders:
  1. Header — displayId (mono), color-coded FULL/PARTIAL/EXCHANGE badge (FULL=rose, PARTIAL=amber, EXCHANGE=violet), status badge, source badge, stock label badge, created date, "Created by {createdBy}" (fallback '—').
  2. Coverage panel (accident-spotter) — big line: `This return covers X of Y items from ORD-…` computed as X=Σ return items qty, Y=Σ order items qty; FULL → "FULL — all Y items" green; PARTIAL → "PARTIAL — X of Y items" amber; EXCHANGE type → "EXCHANGE — X of Y items" violet; unknown X (courier empty items) → "Coverage quantities not confirmed — the courier never reports the split; confirm exact quantities at mark-received."; contradiction warnings (never silent): PARTIAL and X ≥ Y → red doc-text "PARTIAL return covers ALL Y ordered items — verify this is not a FULL-return mistake."; FULL and X < Y → red "FULL return covers only X of Y — some ordered items are missing."
  3. Customer card — snapshot name (order display helpers `getCustomerDisplayName`/`getCustomerPhone`), phone as `tel:` link + `CustomerContactActions phone` (shared component) + secondary phone when present.
  4. Line items card — per ORDER line joined with returned qty by `${productId}::${variantId}`: SafeImage thumb (variant thumb / product image fallback), product name + variant label (`variantLabel`), sku, qty returned × unit price, line subtotal; "returned 0 of N" for unreturned lines (partial context); keeps the "quantities unknown" note only for empty courier rows.
  5. Original-order link (existing) + exchange-order link + refund payment-list deep link (existing).
  6. All existing action buttons preserved (Check status; Mark received).
- Responsive: single column < md; 2-col content md+; text truncates; images fixed 40px.

- [x] **Step 1: Rewrite tests first** (browser-render, existing mock pattern): fixture extends detail with `order.items` (product w/ images + variant) + `createdBy`; assert coverage line text, customer name + phone + WhatsApp `a[href^="https://wa.me/"]`, line item name/sku/qty/price, PARTIAL-covers-all warning (via fixture variant test), courier-empty-items note, created date + createdBy.
- [x] **Step 2: Implement** the page per Interfaces.
- [x] **Step 3: `npx tsc --noEmit` in apps/admin clean; `npx vitest run src/features/returns` green.**

### Task 6: Admin — order detail page extracted + exchange composition (B)

**Files:**
- Create: `apps/admin/src/features/orders/order-detail-page.tsx` (mechanical move of `routes/_authenticated/op/orders/$id.tsx` component body; imports rewritten from relative `./xxx` to `@/features/orders/xxx`)
- Modify: `apps/admin/src/routes/_authenticated/op/orders/$id.tsx` → thin route wrapper (`Route.useParams()` + `<OrderDetailPage id backTo backLabel>`)
- Create: `apps/admin/src/features/exchanges/detail.tsx` (REWRITE — was fork) → `ExchangeDetailRoute`: reads `id`, renders `<OrderDetailPage id backTo='/op/exchanges' backLabel='Exchanges' />`
- Create: `apps/admin/src/features/exchanges/exchange-order-section.tsx` (exchange-specific section, rendered inside the shared page)
- Modify: `apps/admin/src/features/orders/order-detail-page.tsx` renders `<ExchangeOrderSection order={order}/>` when `order.kind === 'EXCHANGE'`
- Test: `apps/admin/src/features/exchanges/exchange-detail.test.tsx` (rewrite: renders OrderDetailPage-priced exchange view), guard `apps/admin/src/features/orders/...` untouched tests still pass.

**Interfaces:**
- Produces: `OrderDetailPage(props?: { id?: string; backTo?: string; backLabel?: string })` — default props reproduce today's orders detail exactly (`backTo` default '/op/orders', label 'Back'); `id` falls back to route params when unset.
- Consumes: Task 4 `exchangeOfOrder` include + payments scalar `sourceOrderId/sourcePaymentId/appliedCreditAmount` + `exchangedCreditAmount/settlementStatus/settlementDelta/settlementSettledAt/exchangeScope` scalars + `linkedReturn` query (`deriveExchangeType`) when `exchangeScope` unknown.
- `ExchangeOrderSection` sections: (1) Type chip: exchangeScope FULL/PARTIAL (fallback derive), original-order link; (2) Goods comparison: OLD section vs NEW section — original lines (with qty) vs exchange lines (with qty) — reuse the same lambda shapes as return detail images; (3) Billing: original recorded paid (`exchangeOfOrder` total is NOT the paid amount — use original `total` + payments of source… NO: display `exchangedCreditAmount` (credit consumed), `settlementDelta` (+ collect / − refund pending), settlementStatus label (SETTLED_DUE/EXACT/REFUND + settledAt); (4) Source payment link: first payment with `sourceOrderId` else `sourcePaymentId` → link to original order detail (`/op/orders/$id`) labeled "Source payment · ORD-…".
- Non-EXCHANGE orders: section absent — zero visual delta on normal orders (guard: only render when kind==='EXCHANGE').

- [x] **Step 1: Move the component** (route → feature file), fix relative imports, keep everything byte-equivalent otherwise; route wrapper renders it with props; admin `tsc` clean.
- [x] **Step 2: ExchangeOrderSection tests first** (exchange fixture: `exchangeScope: 'PARTIAL'`, exchangedCreditAmount 350, settlementDelta +150, payments incl. sourceOrderId); assert type chip PARTIAL, old/new items both listed, billing rows text, source-payment link href `/op/orders/o1`.
- [x] **Step 3: Implement section + render gate.**
- [x] **Step 4: Rewrite `exchange-detail.test.tsx`** to render ExchangeDetailRoute (mock router `useParams` → id, mock apiClient: `/orders/ex-1` full payload + `/returns?…`). Assert order elements (displayId, customer, items, timeline presence via "Courier Dispatch History" title), Exchange badge (section), plus sections above; assert back link target `/op/exchanges`.
- [x] **Step 5: `npx tsc --noEmit` clean; `npx vitest run src/features/exchanges src/features/orders + src/features/returns/scanner subsets` green.**

### Task 7: Admin — StagedList evolution (phone + contact + chevron expansion)

**Files:**
- Modify: `apps/admin/src/features/scanner/staged-list.tsx`
- Test: new `apps/admin/src/features/scanner/staged-list.test.tsx`

**Interfaces:**
- `StagedRow` gains: `phone?: string` (snapshot phone rendered `tel:`, beside `CustomerContactActions`), `destKind?: 'return'` (external-link routes to `/op/returns/$id` when set — caller's `orderHref` callback reads it; default stays `/op/orders/$id`), and optional `expand?: { heading?: string; items?: ExpandItem[]; note?: string }`.
- `ExpandItem { name: string; sub?: string; image?: string|null; quantity?: number; price?: string }`.
- `Link` behavior: external-link icon uses `orderHref` (already a prop; add `primaryLinkTitle` fn? keep `Open order` label but caller chooses href — label derived from `kind` param the CALLER passes; simplest: `openLabel?: (row: StagedRow) => string` default `Open order …`).
- Row layout (44px, virtualization unchanged): number ▸ primary (mono) ▸ secondary ▸ customer name ▸ phone (tel link, compact) + CustomerContactActions ▸ meta (md+) ▸ status badge (sm+) ▸ link ▸ remove ▸ chevron (only when expand data) — expansion opens a floating panel BELOW the row (max-h 320 scroll; safe-image thumb; name/sub/qty/price rows; heading = heading text; note rendered as text) — panel never affects virtualized geometry; closes on outside click/Escape/legend… (no legend).
- Mobile: phone + contact hidden < sm (already the pattern for meta/status), visible ≥ sm.

- [x] **Step 1: Tests first** — row renders phone as `href="tel:017…"`, WhatsApp anchor, chevron button toggles expansion panel listing items (image alt + name + qty), expansion click-outside closes, list without expand data renders NO chevron.
- [x] **Step 2: Implement.**
- [x] **Step 3: `npx vitest run src/features/scanner` green.**

### Task 8: Admin — scanner page: full width + context-aware expansion wiring + RETURN_RECEIVE staging

**Files:**
- Modify: `apps/admin/src/features/scanner/index.tsx`
- Modify: `apps/admin/src/features/orders/api.ts` (types: `ScanItemPreview`, `ScanOrderPreview.items`, `ScanDispatchPreview.items`, `ScanLinkedCandidate` enrichment — mirror backend names)
- Test: `apps/admin/src/features/scanner/scanner-page.test.tsx` (rewrite RETURN_RECEIVE suite + new staging/persistence/batch suite)

**Interfaces:**
- Consumes: staged-list Task 7; scan outcome shapes Task 3.
- Produces (UI behavior):
  - C1: container `mx-auto w-full max-w-2xl` → `w-full` (full available width).
  - C2/C3: staged order/dispatch/sticker rows get `expand` from outcome payload: ORDER_STATUS+STICKER staged rows → expand = order items; dispatch stage rows → expand = order items of that dispatch; link stays order detail for those.
  - D1: RETURN_RECEIVE single-leg + picker-Select stages instead of `runExecute` (never instant execute for RETURN_RECEIVE).
  - Stage row payload: `key=leg.id, primary=leg.displayId, secondary=leg.orderDisplayId, status=leg.status, processable?, reason?, phone=order customerPhone, customerName, items (leg.items)`, `destKind: 'return'` (return legs) — link → `/op/returns/:id` (returns) or `/op/orders/:id` (exchanges).
  - D2: validation on stage: `processable===false` → warning row w/ reason (Amber row tint class + "Needs attention" chip in list footer summary); processable → green rows. Feed records `warning`/`success` stage event with the reason.
  - D3: duplicate scan → feed "Already staged" duplicate (existing StagedList dedupe mechanics mirrored).
  - D4: persistence: `ecomate:scanner:return-staged` — `useState` initializer loads + JSON-guard; `useEffect` persists on every change (max 200 rows). NOT cleared on mode switch (selectMode keeps it).
  - D5: Clear via StagedList's built-in confirm (clearConfirm secondary text mentions unprocessed).
  - D6/D7: `processReturns` — disabled when 0 processable; button label `Process returns (N ready · M need attention)`; on click `setBusy`, sequential `scannerApi.scan({ purpose:'RETURN_RECEIVE', identifier: row.identifier, returnId|exchangeId } )` per row from the CURRENT list state (re-validation free of stale rows); per result `record(res)`; success/duplicate rows removed (feed recording preserves outcome); error/warning rows stay + row's `reason` replaced with the live error message; feed records each failure.
- Two-step-guard: `selection` panel flow for multi-leg uses staged pick (not execute).

- [x] **Step 1: Tests first** — full directive matrix:
  - single leg scan → staged row visible, ZERO `/scanner/scan` calls, row shows RTN id + customer + phone + WhatsApp.
  - duplicate scan → feed "Already staged".
  - RESTOCKED leg (processable false via linked candidate) → warning row + reason text; footer shows "M need attention".
  - refresh keeps list: re-render ScannerPage with localStorage seeded (`ecomate:scanner:return-staged`) → rows restored without `/scanner/resolve`.
  - clear button + confirm dialog text.
  - Process returns mixed batch: 1 success (row leaves), 1 error (row stays with reason), 1 duplicate (leaves); assert scan payload per row (identifier + returnId/exchangeId); feed items recorded.
  - sticker staged row expand → order items; ORDER_STATUS row expand → order items; RETURN staged row expand → RETURN items NOT order items (fixture shapes differentiate).
- [x] **Step 2: Implement** in index.tsx (+ api.ts types).
- [x] **Step 3: `npx tsc --noEmit` clean; `npx vitest run src/features/scanner` green.**

### Task 9: Full regression + live smoke + single commit

- [x] Backend: `npx jest --silent` full suite; `npx nest build`; `npx prisma migrate status` (all applied, no drift).
- [x] Admin: `npx tsc --noEmit`; `npx vitest run` full suite.
- [x] Live smoke (`.tmp-e2e/return-scan-e2e.js`, deleted after): API — create return for seeded order → GET detail shows customer+items+coverage fields; scanner resolve RETURN_RECEIVE payload includes items/processable; stage→(no execute)→process→RESTOCKED; duplicate stage warning. Browser — scanner page full-width on 1440px; staged return row expansion shows return items; process batch toast; return detail page renders coverage panel + customer + line items.
- [x] Purge ALL test residue (returns/orders/products/notifications created for the smoke).
- [x] Single commit on `feat/return-detail-scan-batch` (schema+migration+backend+admin+tests+docs): `git add <explicit paths>` then `feat(returns,exchanges,scanner): rich detail pages, context-aware scan rows, staged return batching`. NEVER push.

## DoD (change-completeness gate, restated)

1. Schema change (Return.createdBy) ships with migration in the SAME commit ✔ Task 1
2. API shape changes (returns get, scanner resolve, orders findOne) → consumers updated ONLY in admin (sole consumer) + tests ✔ Tasks 2–8
3. Redeploy-affecting changes: additive DDL migration only — safe; no env/compose changes ✔
4. Backend `nest build` + full jest green; admin `tsc` + full vitest green before commit ✔ Task 9
5. No new runtime dependency; no new order status; no role-bypass; context exemption unchanged ✔
