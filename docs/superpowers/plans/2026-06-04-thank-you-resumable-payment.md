# Thank-You Page Resumable Payment Implementation Plan

> **For agentic workers:** This plan is to be executed in a single session; the user has supplied a detailed spec, file-by-file instructions, and a final report format. Steps are bite-sized to enable precise verification.

**Goal:** Allow customers to resume abandoned bKash / manual payments from the thank-you page via an opaque token, and let admin copy / open / rotate that link from the order detail.

**Architecture:**
- Add `viewToken UUID` to `Order`. Generate on create, accept `?t=` for guest reads (only if `userId == null`).
- Storefront thank-you page becomes a Server Component that fetches the order server-side via the new public-with-token endpoint, then hands off to a client component for resume buttons.
- Admin gets a `CustomerViewCard` showing the thank-you URL with copy / open / rotate controls.

**Tech Stack:** NestJS + Prisma backend, Next.js 16 App Router storefront, TanStack-Query admin (Vite/React).

---

## Task 1 — Backend: Prisma schema + migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (Order model — add `viewToken`)
- Create:  `apps/backend/prisma/migrations/20260604120000_add_order_view_token/migration.sql`

- [ ] Add `viewToken String? @unique` to the `Order` model in `schema.prisma`.
- [ ] Write the migration SQL with `ALTER TABLE` (nullable) + `CREATE UNIQUE INDEX`.

## Task 2 — Backend: OrdersService changes

**Files:**
- Modify: `apps/backend/src/orders/orders.service.ts`

- [ ] Import `randomUUID` from `node:crypto`.
- [ ] In `create()`: include `viewToken: randomUUID()` in the `prisma.order.create` data.
- [ ] Modify `findOne(id, opts?: { token?: string })`:
  - Accept optional `opts` second param
  - After loading, if order has `userId !== null` AND opts.token doesn't match `viewToken`, fall through to normal `throw NotFoundException`
  - Otherwise return order
- [ ] Add `rotateViewToken(orderId)` method.
- [ ] Add `cancelByCustomer(orderId, token)` method (only if status pending, token matches).
- [ ] Add `backfillViewTokens()` admin method.

## Task 3 — Backend: OrdersController + DTO

**Files:**
- Modify: `apps/backend/src/orders/orders.controller.ts`
- Modify: `apps/backend/src/orders/dto/order.dto.ts`

- [ ] Add `CancelOrderDto` (just validation; no body required for our flow, but use a typed body).
- [ ] Update `GET /orders/:id` to accept `?t=` and pass to service.
- [ ] Add `POST /orders/:id/cancel` (public + token).
- [ ] Add `POST /orders/:id/rotate-view-token` (admin).
- [ ] Add `POST /orders/backfill-view-tokens` (admin).

## Task 4 — Backend: bKash callback redirect includes token

**Files:**
- Modify: `apps/backend/src/gateways/bkash-pgw.controller.ts`

- [ ] After order update in success path, look up `viewToken` and append `&t=` to redirect URL.
- [ ] On failure path, also append `&t=` if order found.

## Task 5 — Storefront: API client updates

**Files:**
- Modify: `apps/storefront/lib/api/orders.ts`

- [ ] Add `getOrderForThankYou(orderId, token?)` — public fetcher.
- [ ] Add `cancelOrderByToken(orderId, token)`.
- [ ] Add `resumeBkasPayment(orderId, partialAmount?)` — wraps bKash create.
- [ ] Add `submitManualPaymentProof(orderId, file)` — uses FormData + POST.

## Task 6 — Storefront: Server Component page

**Files:**
- Modify: `apps/storefront/app/checkout/thank-you/page.tsx`

- [ ] Make `ThankYouPage` an async Server Component.
- [ ] Read `searchParams.orderId` and `searchParams.t`.
- [ ] Call `getOrderForThankYou` server-side; on failure, render "Order not found" fallback.
- [ ] Pass order data into `<ThankYouContent>`.

## Task 7 — Storefront: New ThankYou components

**Files:**
- Create: `apps/storefront/components/ThankYou/ResumePaymentButton.tsx`
- Create: `apps/storefront/components/ThankYou/PaymentProofUpload.tsx`
- Create: `apps/storefront/components/ThankYou/CancelOrderButton.tsx`
- Modify: `apps/storefront/app/checkout/thank-you/ThankYouContent.tsx`

- [ ] Build each component per spec (loading state, toast errors, 5MB limit).
- [ ] In `ThankYouContent.tsx`, switch from `useEffect`-based fetch to receiving `order` as prop.
- [ ] Branch on `paymentStatus` × `paymentMethod` and render the correct CTA.

## Task 8 — Admin: API + CustomerViewCard

**Files:**
- Modify: `apps/admin/src/features/orders/api.ts`
- Create:  `apps/admin/src/features/orders/customer-view-card.tsx`
- Modify: `apps/admin/src/routes/_authenticated/op/orders/$id.tsx`

- [ ] Add `rotateViewToken(orderId)` and `backfillViewTokens()` to `ordersApi`.
- [ ] Create `CustomerViewCard` (copy input, copy/open/rotate buttons, confirm dialog).
- [ ] Add a `storefrontUrl` helper in `apps/admin/src/lib/utils.ts`.
- [ ] Insert `<CustomerViewCard order={order} />` in the order detail right column.

## Task 9 — Verify

- [ ] `npx tsc --noEmit` in `apps/storefront` → 0
- [ ] `npx tsc --noEmit` in `apps/backend` → 0
- [ ] `npm run build:skip-tsc` in `apps/admin` → 0
- [ ] Review migration SQL.
- [ ] Manual smoke (or note if dev servers not running).

---

## Deviations to flag in report

- If `orders.service.spec.ts` breaks from signature change, fix it (add `viewToken` to mock order so `findOne` works).
- bKash callback needs the `&t=` query param added in two places (success and failure paths).
- For `submitManualPaymentProof`, we hit the existing public `POST /payments/:orderId` endpoint with JSON body (screenshot as URL after upload via `/upload/image`) OR with a multipart shape. The existing endpoint accepts JSON only — so we need to first upload the file via `/upload/image` (admin-only), OR we need a new public upload route. **Simplest path:** POST the file as multipart to a new public `POST /payments/:orderId/proof` that wraps both upload + payment-record create. Document this in the deviations.
