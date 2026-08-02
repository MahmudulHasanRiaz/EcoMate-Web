# EcoMate Session Summary — Meta CAPI Tracking Redesign + Checkout-Lead Lifecycle

**Date:** 2026-08-02
**Branch:** `main` = `30b67ad6` (all work merged + pushed)
**Purpose:** Hand-off document so a new session can continue the tracking/leads work with full context.

---

## 1. What was built (this + prior sessions)

### Meta Conversions API + Pixel tracking redesign (Phases 0-7)
A full enterprise tracking pipeline replaced the legacy per-provider direct-send services.

| Component | File(s) |
|---|---|
| Browser TrackingClient (ctxId + provider cookies) | `apps/storefront/lib/tracking-client.ts` |
| Browser event firing + mirror | `apps/storefront/lib/tracking.ts` |
| Pixel init | `apps/storefront/components/TrackingScripts.tsx` |
| Idempotent capture (snapshot + outbox in business txn) | `apps/backend/src/tracking/tracking-capture.service.ts` |
| Outbox relay (SKIP LOCKED, gated off by default) | `apps/backend/src/tracking/outbox-relay.service.ts` |
| Provider-independent dispatcher | `apps/backend/src/tracking/tracking-dispatcher.service.ts` |
| Adapters (Meta/TikTok/GA4/GoogleAds) | `apps/backend/src/tracking/adapters/*.adapter.ts` |
| Single hashing abstraction | `apps/backend/src/tracking/tracking.normalizer.ts` |
| Reconciler / DLQ / Replay / Archive | `reconciler.service.ts`, `dlq.service.ts`, `replay.service.ts` |
| Monitoring service + admin page | `monitoring.service.ts`, `apps/admin/src/features/tracking/monitoring-page.tsx` |
| Retention/anonymization + deletion | `retention-cleanup.service.ts`, `tracking-deletion.service.ts` |
| Context merge rules | `apps/backend/src/tracking/context-merge.ts` |
| Status/event constants | `apps/backend/src/tracking/tracking.constants.ts` |

**Schema:** `TrackingContext`, `TrackingSnapshot`, `TrackingOutbox`, `TrackingDispatch`,
`TrackingDispatchEvent`, `TrackingReplayArchive` + `Order.trackingSessionId`. Legacy
`TrackingEvent` table dropped (Phase 3-4). All in `apps/backend/prisma/schema.prisma`.

**Architecture docs:** `docs/superpowers/specs/2026-08-02-ecomate-capi-redesign-design.md` (v2, audit-hardened).

### Checkout-Lead (Incomplete Order) lifecycle — FINALIZED
Business spec + implementation for the sales follow-up queue. **Do not change the core lifecycle.**

**Lifecycle:** `PENDING → CONVERTED` (manual recovery) / `SUPERSEDED` (customer self-purchase) / `NOT_CONVERTED` (dismissed).
- `SUPERSEDED` = "no follow-up needed, customer ordered another way" — neither conversion nor failure; NEVER counted in conversion metrics.
- `convertToOrder` is the ONLY path that marks `CONVERTED`.
- Order-create atomically supersedes matching PENDING leads (ctxId primary, phone fallback time-bounded to configurable `checkout_lead_supersede_phone_window_days`, default 7).
- Manual recovery supersedes the customer's OTHER pending leads too (not converts them).
- **Full spec:** `docs/superpowers/reports/2026-08-02-checkout-lead-lifecycle.md`.
- Constants: `apps/backend/src/checkout-leads/checkout-lead.constants.ts`.

### Other merged work
- **CMS template pages + staff order identity** (from branch `claude/blissful-knuth-e196b6`, merged + resolved): static pages → CMS templates, staff order creation keeps client identity, `guestEmail`, CustomerProfile email + phone-conflict guard, Shipping→Return Pending transition, invoice/sticker templates, download-page rework.
- **Dependabot fix:** `find-my-way` deduped to 9.7.0 (CVE-2026-47219).
- **Bug fixes:** `Picked Up` label typo; product search now finds products by variant SKU + beyond first page.

## 2. Current tracking behavior (verified)

- **Events (browser Pixel + server CAPI, same event_id → dedup):** PageView (Pixel only), ViewContent (product + category), AddToCart, AddToWishlist, InitiateCheckout, AddPaymentInfo, Purchase, Search, CompleteRegistration, Lead, Refund (offline, negative value).
- **Purchase modes:** `instant` = browser + server both fire with `purchase_{orderId}`; `validated` = server only fires when the configured order status is reached, using persisted context (fbp/fbc/ip/ua/external_id) → equal match quality.
- **Product params:** `content_type`, `content_name`, `content_category`, `contents` (id/quantity/item_price), `value`, `currency`, `num_items` sent across events.
- **Test events:** Meta + TikTok test codes gated by `tracking_<provider>_test_mode`; relay must be ON for any dispatch.

## 3. Deploy state + preconditions

- **Phases 0-7 code-complete, merged, pushed.** NOT yet deployed to production (Phase 0 schema was deployed earlier; the full pipeline is on main but relay is OFF by default).
- **To go live on any server:**
  1. `prisma migrate deploy` (validated on disposable DB — no drift).
  2. `tracking_relay_enabled = "true"` (via admin Tracking → Pipeline relay toggle, per-server/DB).
  3. `admin_tracking` feature grant (or `*` license covers it — verified).
- **Known limitations (documented, non-blocking):** `external_id` is per-journey uuid (customer-keyed variant unimplemented → `deleteByCustomerId` can't erase abandoned pre-order contexts); GA4 serverOnly heuristic = `physical_store`; TikTok transient codes 40011/40012 to verify.

## 4. Engineering conventions used

- **Backend:** DTOs + class-validator; `$transaction` for multi-write; thin controllers; `npm run build --workspace=backend`; Jest.
- **AGENTS.md migration rule:** schema change → instant migration + `prisma generate` + atomic commit; NEVER `db push`/`reset` without approval; hand-author migrations if local DB drifted.
- **SDD ledger:** `.superpowers/sdd/progress.md` — per-task completion + review notes (durable recovery map).
- **Skills:** `meta-conversions-tracking` skill (in `.claude/skills/`) — Meta CAPI/Pixel reference for future enhancement.

## 5. Other unmerged branches (NOT merged — separate sessions' work)

`claude/busy-mcclintock-ce4d9e`, `claude/epic-shtern-a786ab`, `claude/jolly-haslett-b10de3`, `claude/laughing-wilson-ce73a6` (and others) — checked out in other worktrees; not part of this work; do not touch unless asked.

## 6. Verification commands

```bash
# backend
(cd apps/backend && npx jest)          # full suite (1042)
(cd apps/backend && npx nest build)
# storefront
(cd apps/storefront && npx vitest run)  # 25
(cd apps/storefront && npm run build)   # note: static-gen ECONNREFUSED warning is environmental (backend not running)
# admin
(cd apps/admin && npx vitest run)       # 185
(cd apps/admin && npm run build)
```
