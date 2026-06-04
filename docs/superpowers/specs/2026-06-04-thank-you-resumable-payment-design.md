# Thank-You Page Resumable Payment + Admin Customer Link — Design Spec

**Date:** 2026-06-04
**Status:** Approved
**Scope:** Customer resume payment from thank-you page; admin copy/open customer view link

## Goals

1. When an order is placed but payment is **pending** (bKash closed, failure, or
   partial), the thank-you page offers a **"Complete Payment"** action that reopens
   the bKash flow (or manual upload for send-money) without losing the order.
2. Admin can **copy** the customer's thank-you link from the order detail panel,
   and **open it in a new tab**, so they can assist with abandoned payments.
3. The customer link is **opaque** (token-based) so a leaked URL cannot enumerate
   other orders. Admin can **rotate the token** if needed.

## Out of scope

- Order cancellation flow (separate feature; admin can already cancel from panel)
- Refund / partial refund flows
- Webhook-based async payment verification (existing PGW callback is sufficient)
- Email/SMS payment reminders (future)
- Customer account payment history (already exists at `/account/orders`)

## Data model

### Prisma — Order model

Add field:
```prisma
viewToken   String?  @unique  // UUIDv4; nullable for backward compat
```

On order `create()` (in `orders.service.ts`), generate `viewToken = randomUUID()` and
persist with the order. Old orders get `viewToken = null` (can be backfilled lazily on
first read; admin can manually trigger via `POST /orders/backfill-view-tokens`).

## Backend

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET /orders/:id` | public if `?t=token` matches | Get order for thank-you page |
| `POST /orders/:id/rotate-view-token` | admin | Generate new viewToken, return new URL |
| `POST /orders/:id/cancel` | public if `?t=token` matches | Customer cancels own order (only if `status='pending'`) |
| `POST /orders/backfill-view-tokens` | admin | One-time backfill for old orders |

### Resume payment flow

For bKash orders: thank-you page calls existing public `POST /payments/bkash/create`
with `orderId` (no new endpoint needed). The bKash controller already returns a redirect
URL when invoked this way.

For manual/send-money orders: thank-you page shows file upload, submits via existing
public `POST /payments/:orderId` (line 29 of `payments.controller.ts`).

For COD orders: no resume button shown.

For partial payments: same bKash flow with `partialAmount` override (computed from
`order.total - sum(payments.verified.amount)`).

### Files

**Backend:**
- `apps/backend/prisma/schema.prisma` — add `viewToken String? @unique` to `Order`
- `apps/backend/prisma/migrations/<timestamp>_add_order_view_token/migration.sql` (NEW)
- `apps/backend/src/orders/orders.service.ts`
  - `create()` generates `viewToken = randomUUID()` and includes in `data`
  - New `rotateViewToken(orderId)` method
  - `findOne(id, opts)` accepts `{ token?: string }` and bypasses auth if token matches
  - New `cancelByCustomer(orderId, token)` method (only if `status='pending'`)
  - New `backfillViewTokens()` admin method
- `apps/backend/src/orders/orders.controller.ts`
  - `GET /orders/:id` accepts `?t=` param, uses public path if matched
  - `POST /orders/:id/rotate-view-token` (admin)
  - `POST /orders/:id/cancel` (public + token)
  - `POST /orders/backfill-view-tokens` (admin)
- `apps/backend/src/orders/dto/order.dto.ts` — add `CancelOrderDto`, response includes
  `viewToken` for the creator

**Storefront:**
- `apps/storefront/lib/api/orders.ts`
  - `getOrderForThankYou(orderId, token?)` — public fetcher
  - `cancelOrderByToken(orderId, token)` — public cancel
  - `resumeBkasPayment(orderId, partialAmount?)` — wraps bKash create
  - `submitManualPaymentProof(orderId, file)` — wraps manual upload

- `apps/storefront/app/checkout/thank-you/page.tsx`
  - Server Component; reads `searchParams.orderId`, `searchParams.t`
  - Fetches order server-side via `getOrderForThankYou`
  - Passes to `<ThankYouContent>` client component

- `apps/storefront/app/checkout/thank-you/ThankYouContent.tsx`
  - Branches on `paymentStatus`:
    - `paid` → "Thank you" message + order summary
    - `pending` + gateway=bKash → "Complete Payment" button
    - `pending` + gateway=bKash manual → "Upload Proof" form
    - `pending` + gateway=COD → confirmation only
    - `partial` → "X paid, pay remaining Y" + button
    - `failed` → "Payment failed. Try again?" + button
  - All resume buttons call appropriate API and redirect

- `apps/storefront/components/ThankYou/ResumePaymentButton.tsx` (NEW)
  - "Pay with bKash" or "Pay Remaining" CTA
  - Loading state during redirect prep
  - Error toast on failure

- `apps/storefront/components/ThankYou/PaymentProofUpload.tsx` (NEW)
  - File input, drag-drop optional
  - Image preview, size limit 5MB
  - Submit → `submitManualPaymentProof`
  - Success → "Awaiting verification" message

- `apps/storefront/components/ThankYou/CancelOrderButton.tsx` (NEW)
  - Confirm dialog
  - Calls `cancelOrderByToken`
  - Redirects to homepage on success

**Admin:**
- `apps/admin/src/features/orders/customer-view-card.tsx` (NEW)
  - Card showing full thank-you URL in a copyable input
  - "Copy" button (clipboard API)
  - "Open in new tab" button
  - "Rotate Token" button (admin only, with confirm)

- `apps/admin/src/routes/_authenticated/op/orders/$id.tsx`
  - Insert `<CustomerViewCard order={order} />` in the order detail layout

- `apps/admin/src/features/orders/api.ts`
  - Add `rotateViewToken(orderId)` method
  - Add `backfillViewTokens()` method (admin tool)

## URL formats

Customer thank-you URL:
```
{STOREFRONT_URL}/checkout/thank-you?orderId={order.id}&t={viewToken}
```

Admin can construct this from order data:
```ts
const url = `${storefrontUrl}/checkout/thank-you?orderId=${order.id}&t=${order.viewToken}`;
```

## Security considerations

- `viewToken` is a UUIDv4 (122 bits entropy) — unguessable.
- Token check happens server-side; client cannot bypass.
- `viewToken` can be rotated (invalidates old URL).
- Public `GET /orders/:id` only works with `?t=` token AND if order belongs to a
  guest (`userId == null`). If `userId != null`, requires auth.
- Public `POST /orders/:id/cancel` only works with `?t=` token AND if `status='pending'`.

## Acceptance criteria

- Customer closes bKash → thank-you page shows "Complete Payment" button → click
  → bKash tab reopens → success → thank-you page refreshes → "Thank you" message.
- Customer submits manual payment proof → status updates to `pending_verification` →
  message shown.
- Admin opens order detail → sees "Customer View" card with copyable URL.
- Admin clicks "Open" → thank-you page loads in new tab, same content customer sees.
- Admin clicks "Rotate Token" → old URL shows "Invalid link" page; new URL works.
- No regression to existing paid order flow.

## Edge cases

- Order with no `viewToken` (old) → admin can backfill via `POST /orders/backfill-view-tokens`.
- Order in `cancelled` state → no resume button; "Order cancelled" message.
- Order in `shipped` or `delivered` state → no resume button; "Order complete" message.
- bKash API rate limit → show error toast with retry, don't loop.
- File too large → reject with size error before upload.

## Risk / rollback

- DB migration adds nullable column — safe, no data loss.
- If `viewToken` rotation breaks customer link, admin can manually reset via DB.
- Public endpoints with token can be disabled by requiring auth (toggle in env).
