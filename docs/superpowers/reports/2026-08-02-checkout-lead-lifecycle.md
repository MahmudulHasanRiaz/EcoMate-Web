# Checkout-Lead (Incomplete Order) Lifecycle — Architecture Spec

**Date:** 2026-08-02
**Status:** Approved design (foundation for CRM / Sales Follow-up / Analytics / Facebook CAPI)

## 1. Purpose

The Incomplete-Orders (Checkout Leads) feature is a **Sales Follow-up queue** — NOT an
extension of Order History. It captures genuinely abandoned checkouts so staff can
recover them. Orders and Leads follow **completely separate lifecycles**; the only
relationship between them is a **manual recovery** (admin converts a lead into an order).

## 2. Lifecycle

```
                 ┌── CONVERTED      Manual recovery (admin/staff follow-up → order)
 PENDING ────────┼── SUPERSEDED     Customer self-purchase (customer ordered on their own)
                 └── NOT_CONVERTED  Dismissed / expired (no follow-up)
         └── DELETED                (admin/hard delete)
```

| Status | Meaning | Set by | Conversion? |
|---|---|---|---|
| `PENDING` | Awaiting follow-up | Lead capture | — |
| `CONVERTED` | Manual recovery — admin converted the lead into an order | `convertToOrder` / `updateStatus('CONVERTED')` | **YES** (the only conversion) |
| `SUPERSEDED` | **No further follow-up needed — the customer already made a successful order another way.** Neither a conversion nor a failure. | Order-create (atomic supersede) | **NO — never** |
| `NOT_CONVERTED` | Dismissed / expired — no follow-up, did not convert | `updateStatus('NOT_CONVERTED')` | NO |

## 3. `SUPERSEDED` semantics (concern #1)

`SUPERSEDED` means: *"this lead no longer needs follow-up because the customer has
already purchased by another path."*

- It is **not a Conversion** (no `convertedOrderId`, no `convertedAt`, no conversion
  tracking event, no offline Purchase).
- It is **not a Failure** — the customer was not lost; they converted elsewhere.
- In **Reporting / Analytics / UI** it is a **distinct category**, never counted in
  Lead-Conversion or Sales-Conversion metrics.
- `convertToOrder` is the **only** path that marks a lead `CONVERTED`.

## 4. Auto-close matching logic (concern #2) + customer-level rule (concern #3)

When a customer successfully places an order, the order transaction **atomically**
closes every `PENDING` lead matching the order, by:

1. **Primary — `ctxId`**: the same checkout session (`Order.trackingSessionId ==
   CheckoutLead.ctxId`). Precise, session-scoped.
2. **Fallback — `phone`**: the order's guest phone and/or customer-profile phone
   (normalized, deduped). Closes abandoned leads sharing that phone.

**Customer-level follow-up philosophy (intentional, explicit):** because the customer
has now purchased, **no follow-up is needed on ANY of their previous pending leads,
regardless of which session they abandoned**. Example:

- 10:00 abandon (product A) → lead L1 (ctxId S1)
- 12:00 abandon (product B) → lead L2 (ctxId S2)
- 15:00 customer places an order (ctxId S3, same phone) → **L1 and L2 both SUPERSEDED**

Both close because the customer is now a customer. This is the deliberate rule — a
purchased customer is removed from the follow-up queue wholesale.

### Edge cases

| Scenario | Result |
|---|---|
| Same session, same phone | Closed (ctxId + phone both match) |
| Different session, same phone (multiple abandons) | **All** closed (customer-level) |
| Same session, different phone (guest changed phone) | Closed (ctxId) |
| Lead already `CONVERTED` / `NOT_CONVERTED` / `DELETED` | **Never touched** (only `PENDING`) |
| Order with neither ctxId nor phone | Nothing closed |
| Shared phone (family member) | Another member's pending lead with the same phone is also closed — **known tradeoff**, acceptable because it is a silent supersede (not counted as a conversion anywhere) |

## 5. Matching robustness (concern #6)

- Never **link** (set `convertedOrderId`) on a self-purchase — only a manual
  `convertToOrder` sets that. Phone fallback therefore cannot fabricate a false
  "converted from order X" link.
- `ctxId` is the reliable session identity; phone is the business identity used only
  as a fallback for sessions without a ctxId and for the customer-level close.

## 6. Reporting (concern #5)

`GET /checkout-leads/summary` returns separate counts (never mixed):

| Metric | Status(es) |
|---|---|
| `pending` | PENDING |
| `converted` | CONVERTED (manual only) |
| `superseded` | SUPERSEDED (self purchase) |
| `dismissed` | NOT_CONVERTED (dismissed/expired) |
| `deleted` | DELETED |

Admin UI shows each as its own filter chip + count. `SUPERSEDED` is never added to
`converted` in any metric.

## 7. Facebook CAPI (concern #7)

| Journey | Event |
|---|---|
| Abandoned checkout → lead | `Lead` (website) |
| Manual recovery (convertToOrder) | Offline `Purchase` (`action_source=physical_store`, `purchase_{orderId}`) |
| Customer self-order | `Purchase` (website) only — **no** Lead-Conversion event, no offline purchase |
| Lead `SUPERSEDED` (self-order closes it) | **no event** (silent — the Lead was already counted once) |

## 8. Future CRM compatibility (concern #4)

The status set (`PENDING/CONVERTED/SUPERSEDED/NOT_CONVERTED`) maps directly to a CRM
pipeline and keeps analytics + CAPI reporting clean. A lead is a customer-relationship
record; `convertedOrderId` is the single, explicit link to the order system — created
only by manual recovery.
