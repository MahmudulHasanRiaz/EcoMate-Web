# EcoMate Enterprise Meta Tracking — Architecture Discovery Report

**Phase 1 — Discovery Only (no implementation performed)**
**Date:** 2026-08-03
**Branch audited:** `main` tip `19382d51` (worktree `peaceful-leavitt-47d1cd`)
**Scope:** the full marketing-tracking pipeline (Browser → Server → Meta) exactly as it exists in code today.

This report documents **verified implementation + evidence only**. Any comparison against Meta's external documentation, API requirements, EMQ targets, or dedup-window rules is **deferred to Phase 2** (§26) and is deliberately absent from the Discovery sections. Items that could not be verified are marked **NOT FOUND** or **UNABLE TO VERIFY**.

---

## 1. Executive Summary

EcoMate's tracking system has been **fully rewritten** (merged 2026-08-02) from the legacy per-provider direct-send services into an **enterprise transactional-outbox + canonical-snapshot + provider-adapter pipeline**. The old standalone services (`meta-conversions.service`, `tiktok-events.service`, `ga4-measurement.service`, `google-ads.service`, `tracking-queue.processor`) no longer exist; the legacy `TrackingEvent` table is dropped (migration `20260802120000_drop_tracking_event`). One shared pipeline drives Meta, TikTok, GA4, and Google Ads through independent adapters.

**Backbone (verified):**
- **Capture** is idempotent: `TrackingSnapshot.eventId UNIQUE` + `createMany(skipDuplicates)` → a duplicate returns `DEDUPED` and never fails the business transaction.
- **Relay** claims PENDING outbox rows via raw SQL `FOR UPDATE SKIP LOCKED` and enqueues **per-attempt** BullMQ job ids (`${row.id}-${row.attemptCount}`). No colon appears in any real queue job id (the production `:`-in-jobId bug is fixed).
- **Dispatcher** runs each provider independently (`Promise.allSettled`); work-set = only `PENDING/SENDING/RETRY` dispatch rows; terminal rows are never re-sent.
- **Single SHA-256/normalization path** in `TrackingNormalizer` (version 1).
- **Two retry layers**: BullMQ transport (attempts 3, exponential 2 s) + durable DB outbox backoff (1 m → 10 m → 1 h → 6 h → 24 h, max 5 → `DEAD`).
- **Monitoring** (admin + `admin_tracking`): volume, per-provider funnel, DEAD/DLQ, retry histogram, top failures, freshness, dedup-key usage, per-event timeline.

**Notable implementation facts the architect should see early** (behavioral only — no external-spec judgment; each detailed in §26):

| # | Observed behavior in code | Evidence | Confidence |
|---|---|---|---|
| G1 | No dispatch-time dedup-age guard: a browser-confirmed Purchase whose CAPI send is delayed is re-sent without any age check. | dispatcher + meta.adapter | High |
| G2 | No event-age guard in any adapter — a replayed/backed-off event is sent verbatim. | all four adapters | High |
| G3 | `external_id` is a per-journey server-random UUID, not customer-keyed, never sent to the Pixel. | context.service:43; TrackingScripts | High |
| G4 | `successPolicy` is never written into `configSnapshot` → dispatcher always uses `ALL_SENT`. | settings + capture call sites | High |
| G5 | No consent/opt-out gate anywhere (browser or server). | tracking-client / tracking.ts / controller | High |
| G6 | Browser `AddToWishlist`, `AddPaymentInfo`, `Search`, `CompleteRegistration` have no `trackEvent()` call site. | storefront grep | High |
| G7 | Monitoring `external_id` metric reads the `payload.externalId` JSON path, which no capture writes → that row is ~0. | monitoring.service | High |
| G8 | Browser non-Purchase `eventId` is `Date.now() + random` — capture-time dedup cannot collapse a double-mount/double-click. | tracking.ts `generateEventId` | Medium |

---

## 2. Architecture Diagram (text — current implementation)

```
┌────────────────────────── Browser (storefront) ──────────────────────────┐
│ TrackingClient (lib/tracking-client.ts)                                  │
│ • ctxId : localStorage "ecomate_ctx_id" (stable per journey)              │
│ • collectIdentifiers(): cookies _fbp/_fbc/_ga/_ttp + URL fbclid/ttclid/  │
│   gclid → namespaces {meta, tiktok, google}                              │
│ • syncContext() → POST /tracking/context  (throttled; no consent gate)   │
│ trackEvent() (lib/tracking.ts):                                          │
│ • fbq('track', E, data, {eventID}) + ttq.track + gtag                    │
│ • POST /tracking/events  (mirror, same eventId + ctxId + userData)       │
│ Pixel init: fbq('init', metaId) — NO external_id, NO consent              │
└──────────────┬───────────────────────────────▲──────────────────────────┘
               │ syncContext                    │ order-create carries
               │                                │ trackingSessionId = ctxId
               ▼                                │
┌────────────────────────────── Backend (NestJS) ──────────────────────────┐
│ Business layer (orders / checkout-leads)                                 │
│   prisma.$transaction [ business mutation + trackingCapture.capture() ]  │
│     │ idempotent: TrackingSnapshot(eventId UNIQUE, skipDuplicates)       │
│     │ + TrackingOutbox row (snapshotId UNIQUE, priority 10 for           │
│     │   Purchase/Refund else 0)                                          │
│     ▼                                                                   │
│ OutboxRelayService (raw SQL CLAIM ... SKIP LOCKED, 1s interval, batch 50 │
│     gated by tracking_relay_enabled == 'true', OFF by default)           │
│     └─ enqueue BullMQ 'tracking' jobId=${outboxId}-${attemptCount}       │
│        (attempts:3, exponential backoff 2s, removeOnComplete:100 /       │
│         removeOnFail:50)                                                 │
│     ▼                                                                   │
│ TrackingDispatcher — work set = PENDING/SENDING/RETRY dispatch rows only │
│     load snapshot (+ context by ctxId | replay-archive fallback)         │
│     for each enabledProvider (from configSnapshot) who supports():       │
│       adapter.build(snapshot, ctxView, normalizer) → payload             │
│       adapter.send(payload, cfg) — Promise.allSettled, 1500ms timeout    │
│     outbox terminal under successPolicy (default ALL_SENT):              │
│       all SENT/SKIPPED/DEDUPED → SENT   | zero eligible → SENT (NOOP)    │
│       permanent FAILED under ALL_SENT → DEAD | retryable → PENDING       │
│       past 5 attempts → DEAD                                             │
│     DEAD → DLQ mirror + ReplayArchive (PII-stripped, hashed)             │
│                                                                          │
│ Lifecycle / log / services:                                              │
│   TrackingDispatchEvent (append-only transition log)                     │
│   ReconcilerService (60s): stale CLAIMED > 10m → PENDING;                │
│     hung SENDING > 10m → RETRY                                           │
│   ReplayService: DEAD → PENDING (pinned versions; relay is sole enqueuer)│
│   RetentionCleanupService (6h): anonymize 90d / purge outbox 30d /        │
│     purge dispatch 365d / archive + purge snapshot 730d                   │
│   MonitoringController (/tracking/admin/monitoring/*, admin + feature)   │
│   DeletionController (/tracking/admin/delete, GDPR-style)                │
└──────────────┬───────────────────────────────────────────────────────────┘
               ▼  Meta CAPI / TikTok / GA4 MP / Google Ads
```

**PageView split:** the browser fires `fbq('track','PageView')` and the analytics buffer endpoint `/tracking/page-view` (in-memory buffer, flush every 5 s or at 100 rows). **PageView is deliberately excluded from CAPI** — it is a dedicated analytics path, not the outbox pipeline.

---

## 3. Directory Structure

```
apps/backend/src/tracking/
  tracking.module.ts             wiring; BullMQ queues 'tracking' + 'tracking-dlq'
  tracking.controller.ts         public: POST events | context | page-view
  tracking.constants.ts          TRACKING_EVENT_TYPES, status machines, SCHEMA_VERSION
  tracking-capture.service.ts    idempotent snapshot + outbox capture
  tracking-snapshot.types.ts     canonical payload + context-view interfaces
  tracking.normalizer.ts         single SHA-256 hashing/normalization
  tracking-context.service.ts    ctx upsert (serialized FOR UPDATE + merge)
  context-merge.ts               merge rules (rotating vs static ids)
  page-view-buffer.service.ts    analytics buffer (NOT the Meta pipeline)
  outbox-relay.service.ts        SKIP LOCKED claim → BullMQ
  tracking-dispatcher.service.ts dispatcher (pipeline, work-set, outbox terminal)
  tracking-dispatcher.processor.ts  BullMQ worker
  reconciler.service.ts          self-healing stuck-state repair
  dlq.service.ts                 DEAD mirror + stats
  replay.service.ts              archive + DEAD → PENDING replay
  retention-cleanup.service.ts   anonymize / purge / archive, windowed
  tracking-deletion.service.ts   GDPR-style erasure (externalId / customerId)
  monitoring.service.ts          dashboard aggregates
  monitoring.controller.ts       /tracking/admin/monitoring/*
  replay.controller.ts           /tracking/admin/dead + /replay/:snapshotId
  deletion.controller.ts         /tracking/admin/delete
  dto/  track-event, save-context, page-view, replay, deletion
  adapters/  tracking-provider.adapter.ts, index.ts (registry),
             meta.adapter.ts, tiktok.adapter.ts, ga4.adapter.ts,
             google-ads.adapter.ts
  __tests__/ 23 spec files

apps/storefront
  lib/tracking.ts, lib/tracking-client.ts
  components/TrackingScripts.tsx, PageViewTracker.tsx
  public/scripts/tracking.js    — ORPHANED (no <script> reference; see §26 G9)
  lib/__tests__/tracking.spec.ts, tracking-client.spec.ts

storefront config path
  GET /system-settings/storefront (system-settings.controller.ts:224)
  → meta.pixelEnabled / pixelId / purchaseMode / validatedStatus
  (server-cached + storefront ISR revalidate 60s)
  → StorefrontConfigContext → TrackingScripts

apps/admin/src/features/settings/tracking/
  tracking-settings.tsx, monitoring.tsx, monitoring-api.ts,
  tracking-nav.tsx, monitoring.test.tsx

apps/backend/prisma
  models: TrackingContext, TrackingSnapshot, TrackingOutbox,
          TrackingDispatch, TrackingDispatchEvent, TrackingReplayArchive
  Order.trackingSessionId
  migration 20260802120000_drop_tracking_event
  migration 20260802130000_add_snapshot_created_at_index
```

---

## 4. Component Inventory

| Component (file) | Role | Notes / findings |
|---|---|---|
| `TrackingCaptureService` | Idempotent snapshot + outbox capture, inside the business txn | priority 10 for Purchase/Refund else 0; returns `DEDUPED` on `eventId` conflict |
| `TrackingContextService` + `context-merge.ts` | provider-namespaced identifier store; write-once context | FBP/FBC/GA client/gclid/ttclid ROTATING = replace-when-newer, never clear; static ids = first-non-empty |
| `OutboxRelayService` | claim PENDING via SKIP LOCKED + enqueue (DB = source of truth) | 1 s poll, batch 50, per-attempt job id, backoff on enqueue failure |
| `TrackingDispatcherService` + processor | per-provider independent send; outbox state machine | work-set rule; success policy (default ALL_SENT); DEAD → DLQ + archive |
| `TrackingNormalizer` (v1) | sole hashing/normalization | email / phone(BD) / name / zip / city / state / country / externalId; synthetic-email filter |
| `MetaAdapter` (v22.0) | CAPI → graph.facebook.com/…/events | refund = Purchase with negative value; fbp/fbc/ip/ua raw (never hashed) |
| `TikTokAdapter` (v1.3) | business-api.tiktok.com pixel/track | HTTP-200-with-nonzero-code handling; codes 40011/40012 retryable |
| `Ga4Adapter` (mp/collect) | Measurement Protocol | suppresses instant-mode events the browser already fires via gtag, unless `serverOnly` |
| `GoogleAdsAdapter` (offline-conversion) | gtag conversion REST | raw gclid/gbraid; negative-value refund |
| `ReconcilerService` | stuck repair (60 s) | stale CLAIMED > 10 m → PENDING; hung SENDING > 10 m → RETRY |
| `ReplayService` | version-pinned DEAD → PENDING; PII-stripped archive | relay is the sole enqueuer; archive survives 90 d retention |
| `RetentionCleanupService` | 90 d / 30 d / 365 d / 2 y windows | PK-batched loops, no unbounded statements |
| `DlqService` | DEAD mirror + deadCount / dlqDepth stats | removeOnComplete:0, removeOnFail:100 |
| `MonitoringService` | dashboard aggregates | volume, funnel, failures, freshness, dedup-key |
| `DeletionService` | erasure | contexts hard-deleted, snapshot PII nulled |
| `PageViewBufferService` | analytics page-view path | separate from Meta pipeline; **no spec file** |
| storefront `tracking.ts` / `tracking-client.ts` | browser pixel + mirror + ctxId + context | NO consent gate; external_id never set |
| storefront `TrackingScripts.tsx` | lazy-load pixel init | `fbq('init', metaId)` — no external_id |
| storefront `public/scripts/tracking.js` | ORPHANED legacy pixel init | double-fire hazard if ever referenced (§26 G9) |

---

## 5. Event Flow (lifecycle, per event)

Two capture paths funnel to `snapshot + outbox → dispatcher → providers`.

**Server-authoritative (transactional) — Purchase, Refund, Lead:**
- **Purchase** — orders.service.ts:3218, `eventId = purchase_{order.id}`, `ctxId = Order.trackingSessionId`, `eventTime` = order `createdAt`, `actionSource` = `website` or `physical_store`.
  - **instant** (default): captured inside the order-creation transaction; the browser also fires a Pixel Purchase on the thank-you page.
  - **validated**: NOT captured at creation; captured on order-status change when `statusName` ∈ {`tracking_meta_validated_status`, `tracking_tiktok_validated_status`}.
- **Refund** — orders.service.ts:3280, `eventId = refund_{order.id}`, negative `value`. Server-only, never fired by the browser.
- **Lead** — checkout-leads (`fireLeadEvent` → `eventId = lead_{lead.id}`), with a 1-hour cooldown deduped by reading `TrackingSnapshot.payload.customer.phone`. A converted lead produces an **offline `physical_store` Purchase** on `convertToOrder`.
- All of these run as `prisma.$transaction [business mutation + capture]` → capture can never roll back the business txn.

**Browser-originated (mirror / capture):**
- **ViewContent**, **AddToCart**, **AddToWishlist**, **InitiateCheckout**, **AddPaymentInfo**, **Search**, **CompleteRegistration** — fired via `trackEvent` from page components. Each fires the Pixel(s) **and** POSTs `/tracking/events`, which creates its own snapshot + outbox. **PageView is excluded** from CAPI (mapped to nothing).
- **Verified call sites**: ViewContent (ProductDetailClient:457, ArchivePageClient:207), AddToCart (ProductDetailClient:567, VariantPickerModal:138, ProductCard:106), InitiateCheckout (checkout/page:618), Purchase (ThankYouContent:104). **No call site for AddToWishlist / AddPaymentInfo / Search / CompleteRegistration** (G6).

**Termination**: snapshot + outbox → per-provider dispatch → outbox `SENT` (or `DEAD`). Every outbox/dispatch transition appends a `TrackingDispatchEvent` row.

---

## 6. Browser → Server Parity Trace

Per-event parity across the three emit paths (Pixel `fbq`/`ttq`/`gtag`, the mirror POST `/tracking/events`, and any server-authoritative capture). A single checkmark means that path carries the event; the `eventId` column shows what dedup key the browser passes.

| Event | Browser Pixel(s) | Browser mirror POST | Server capture | Shared eventId? | Parity result |
|---|---|---|---|---|---|
| `PageView` | ✅ fbq + gtag (gtag auto) | ❌ excluded (CAPI maps nothing) | ❌ | — | Pixel-only by design |
| `ViewContent` | ✅ | ✅ `view_content` | ❌ (none; mirror is the only server source) | random (browser) | Browser-only → server re-dispatch |
| `AddToCart` | ✅ | ✅ `add_to_cart` | ❌ | random | Browser-only → server re-dispatch |
| `AddToWishlist` | ❌ no call site | ❌ | ❌ | — | Not fired anywhere (G6) |
| `InitiateCheckout` | ✅ | ✅ `initiate_checkout` | ❌ | random | Browser-only → server re-dispatch |
| `AddPaymentInfo` | ❌ no call site | ❌ | ❌ | — | Not fired anywhere (G6) |
| `Purchase` (instant) | ✅ `fbq Purchase` | ✅ `purchase` (dedup no-op) | ✅ transactional `purchase_{orderId}` | ✅ `purchase_{orderId}` | **Shared key → dedup** |
| `Purchase` (validated) | ❌ (gated off) | ❌ (trackEvent skips) | ✅ transactional `purchase_{orderId}` | — | Server-only |
| `Search` | ❌ no call site | ❌ | ❌ | — | Not fired anywhere (G6) |
| `CompleteRegistration` | ❌ no call site | ❌ | ❌ | — | Not fired anywhere (G6) |
| `Lead` | ❌ | ❌ | ✅ `lead_{leadId}` | — | Server-only |
| `Refund` | ❌ | ❌ | ✅ `refund_{orderId}` | — | Server-only |

**Important parity nuances (verified):**
1. For **instant Purchase**, the browser's mirror POST and the order-creation transaction both call `capture()` with the **same** `eventId = purchase_{orderId}`. `TrackingSnapshot.eventId UNIQUE` makes this **capture-once** — whichever lands first wins, the second returns `DEDUPED`. So a browser mirror is sent, but it never creates a second snapshot. This is the D1 fix: Pixel eventID == CAPI event_id == `purchase_{orderId}`.
2. For **browser-only events** (ViewContent/AddToCart/InitiateCheckout), the server has no independent source — the snapshot exists only because the browser mirrored it. If the mirror POST fails or is blocked, the server never knows the event occurred.
3. The mirror body carries `userData.fbp/fbc/url/referrer` (added in `tracking.ts`), but the controller's capture mapping only consumes `email/phone/name/city/state/country/zip` — the `fbp/fbc/url/referrer` keys in the mirror body are **dropped**. The CAPI match keys for those fields come from `TrackingContext` (via `syncContext`), not from the event body.
4. Browser non-Purchase `eventId`s are `Date.now() + random` (G8) — they do not participate in any parity guarantee.

---

## 7. Purchase Lifecycle Trace

### 7a. Instant mode (browser Pixel + server CAPI, shared key)

```
Browser checkout → POST order-create (trackingSessionId = ctxId)
  └─ backend prisma.$transaction:
       Order(create) + Snapshot(purchase_{order.id}) ON CONFLICT-skip + Outbox(PENDING, priority 10)
  └─ 201 Order { id } → browser

Browser thank-you page (ThankYouContent.tsx):
  syncContext()                         → POST /tracking/context (ctxId, fbp/fbc, url, referrer)
  trackEvent('Purchase', sharedData, userData, 'purchase_' + order.id)
     ├─ fbq('track','Purchase',data,{eventID:'purchase_' + order.id})   → Meta Pixel
     └─ POST /tracking/events { eventId:'purchase_'+id, eventName:'purchase', ctxId, … }
          └─ capture() → DEDUPED  (snapshot already created by the order txn)

Backend pipeline:
  Relay claim (SKIP LOCKED) → BullMQ job (per-attempt id)
  Dispatcher: snapshot(purchase_) + context(by ctxId)
     per provider: build() → send() → dispatch row SENT
  outbox → SENT (dispatchedAt)
Meta receives CAPI event_id = 'purchase_' + order.id  (same key the Pixel sent)
```

### 7b. Validated mode (server-only, persisted context)

```
Browser order-create (trackingSessionId = ctxId)  → Order created, NO Purchase snapshot
Browser continues browsing; may close entirely (context already persisted)

Admin changes order → status = configured validated_status
  orders.service firePurchaseValidated() → statusName matches meta/tiktok validated_status
  └─ prisma.$transaction:
       Order(status change) + Snapshot(purchase_{order.id}) + Outbox(PENDING, priority 10)

Relay → Dispatcher → snapshot + context (by Order.trackingSessionId)
  per provider: build() → send() → SENT
```

**Key property (both modes):** `eventTime` = order `createdAt` (business time), never dispatch time; the CAPI event_id is `purchase_{order.id}`; dispatch reaches the providers with the **persisted context** (fbp/fbc/ip/ua/external_id/url) so a validated Purchase has the same match-key set as instant — independent of whether the browser is still open.

---

## 8. Browser Tracking

| Concern | Current implementation |
|---|---|
| Pixel init | `fbq('init', metaId)` inline, `strategy="lazyOnload"` (TrackingScripts.tsx:59). **No `external_id`, no Advanced-Matching userData.** TikTok `ttq.load`, GA4 `gtag config`. |
| Pixel loading | inline snippet creates the fbq queue + injects `fbevents.js`; TikTok injects `events.js`; GA4 injects `gtag.js`. |
| Script injection | `dangerouslySetInnerHTML` lazyOnload, client-side. Also sets `window.__META_ID` / `__TIKTOK_CODE` for the orphan script. |
| SPA handling | Each `useEffect` fires per mount/route; `PageView` fires via the Pixel's automatic tracking + the `page-view` analytics POST (per distinct URL, `requestIdleCallback`). |
| Consent logic | **NONE** (G5). No CMP, no opt-out, no cookie-consent gating of fbq/sync. |
| Trigger logic | `trackEvent` in component effects gated on data presence (items, product, order). Purchase gated by `purchaseMode === 'instant'`. |
| Advanced Matching | Not configured — `fbq('init')` receives no `em`/`ph`. |
| eventID generation | Purchase: caller-passed `purchase_{orderId}`. All other events: `Date.now() + Math.random()` (G8). |
| Cookie access | `getCookie` reads `_fbp` / `_fbc` / `_ga` / `_ttp`; URL params `fbclid` / `ttclid` / `gclid`. |
| Failure handling | Mirror fetch uses `keepalive: true`, `.catch()` logs only. Pixel calls are fire-and-forget. |
| ctxId | `localStorage` `ecomate_ctx_id`, deterministic per journey; regenerated only if localStorage is cleared. |

**Browser Coverage Matrix** (which canonical events actually fire, and via which path):

| Event | Fires? | Call site(s) | Pixel `fbq` | Mirror `/tracking/events` | Server-authoritative | Notes |
|---|---|---|---|---|---|---|
| `PageView` | ✅ | Pixel auto + PageViewTracker | ✅ | ❌ (excluded) | ❌ | analytics buffer path only |
| `ViewContent` | ✅ | ProductDetailClient:457, ArchivePageClient:207 | ✅ | ✅ | ❌ | product (product_group on category) |
| `AddToCart` | ✅ | ProductDetailClient:567, VariantPickerModal:138, ProductCard:106 | ✅ | ✅ | ❌ | 3 call sites |
| `AddToWishlist` | ❌ | — | ❌ | ❌ | ❌ | G6 |
| `InitiateCheckout` | ✅ | checkout/page:618 | ✅ | ✅ | ❌ | fires once per session (initiatedRef) |
| `AddPaymentInfo` | ❌ | — | ❌ | ❌ | ❌ | G6 |
| `Purchase` | ✅ instant / ❌ validated | ThankYouContent:104 | ✅ (instant) | ✅ (dedup no-op) | ✅ | gated by mode |
| `Search` | ❌ | — | ❌ | ❌ | ❌ | G6 |
| `CompleteRegistration` | ❌ | — | ❌ | ❌ | ❌ | G6 |
| `Lead` | ❌ | — | ❌ | ❌ | ✅ (checkout-lead) | server |
| `Refund` | ❌ | — | ❌ | ❌ | ✅ (orders) | server |

---

## 9. Server Tracking

| Concern | Current implementation |
|---|---|
| Endpoints | `POST /tracking/events` (capture/mirror), `POST /tracking/context` (context upsert), `POST /tracking/page-view` (analytics buffer). All **Public** + `@RateLimitPolicy('storefront')` (UNKNOWN tier 100/min, SESSION 300/min, burst 50/10s). |
| Dispatcher | `Promise.allSettled` over eligible providers; outbox terminal decision under `successPolicy` (default ALL_SENT). |
| Queue | BullMQ `tracking`, relay-enqueued, per-attempt job ids. |
| Retry | BullMQ 3× exp (transport) + DB outbox backoff (durable) — see §16. |
| Payload builder | adapter `build()` maps canonical snapshot → provider wire shape. |
| Meta HTTP client | `fetch`, JSON body, `AbortSignal.timeout(1500ms)`. |
| Error handling / timeouts | `DispatchResult {ok, retryable, httpStatus, rawResponse}`; 429 / 5xx / network / timeout → retryable; other 4xx → permanent; raw response truncated to 500 chars. |
| Monitoring | read-only aggregates over the tracking tables (see §18). |

---

## 10. Event Payload Builder (Meta `user_data` + `custom_data`)

`MetaAdapter.build` (v22.0):

| wire field | source | condition / notes |
|---|---|---|
| `em` | `customer.email` → normalizer hash | `undefined` if synthetic/empty |
| `ph` | `customer.phone` → hash(phone, country) | E.164 with country code; BD local → 880 |
| `fn` / `ln` | `customer.firstName` / `lastName` → hash | |
| `ct` / `st` / `cn` / `zp` | city / state / country / zip → hash | zip de-dashed, US ZIP+4 → first 5 |
| `external_id` | `ctx.externalId` → hash | per-journey UUID (G3) |
| `fbp` / `fbc` | `ctx.fbp` / `ctx.fbc` (raw) | never hashed |
| `client_ip_address` | `ctx.ip` (raw, server-derived) | |
| `client_user_agent` | `ctx.userAgent` (raw, server-derived) | |
| `event_source_url` | `ctx.url` | |
| `action_source` | `website` (or `physical_store` for offline) | |
| `custom_data.value / currency / content_ids / content_type / content_name / content_category / contents / num_items / search_string / order_id` | snapshot | only when present; unset → omitted |
| `event_id` | resolved `purchase_` / `refund_` prefix, else snapshot `eventId` | non-order events use the caller's id |

Refund → **`event_name='Purchase'`, `value` negated, distinct `refund_{orderId}` event_id**. Missing customer fields are omitted (never hashed garbage). `test_event_code` is added to the body only when `tracking_meta_test_mode === 'true'` (gated) — see §20.

---

## 11. User Data Mapping (full field table)

| Field | Source path | Emitted as | Hashed? |
|---|---|---|---|
| email | `payload.customer.email` | `user_data.em` | SHA-256 |
| phone | `payload.customer.phone` | `user_data.ph` | SHA-256 (E.164) |
| firstName / lastName | `payload.customer.firstName/lastName` | `user_data.fn`/`ln` | SHA-256 |
| city / state | `payload.customer.city/state` | `user_data.ct`/`st` | SHA-256 |
| country | `payload.customer.country` (default BD) | `user_data.cn` | SHA-256 |
| zip | `payload.customer.zip` | `user_data.zp` | SHA-256 (normalized) |
| external_id | `ctx.externalId` | `user_data.external_id` | SHA-256 |
| fbp / fbc | `ctx.identifiers.meta.fbp/fbc` | `user_data.fbp`/`fbc` | raw (never hashed) |
| client_ip_address | `ctx.ip` (server-derived) | `user_data.client_ip_address` | raw |
| client_user_agent | `ctx.userAgent` (server-derived) | `user_data.client_user_agent` | raw |
| gclid / gbraid | `ctx.gclid` / (not populated) | Google Ads payload | raw |
| gaClientId | `ctx.gaClientId` | GA4 `client_id` | raw |

---

## 12. Parameter Inventory Matrix

Canonical capture field → where each value originates (server capture vs browser mirror) → what the Meta adapter emits. "Browser" = the mirror POST `/tracking/events` body (`customData` / `userData`).

| Canonical field | Server capture (orders / leads) | Browser mirror | Meta wire | Condition |
|---|---|---|---|---|
| `value` | `Order.total` (`Number`) | `customData.value` | `custom_data.value` | present only if defined; negative for Refund |
| `currency` | `'BDT'` | `customData.currency` | `custom_data.currency` | always (server) |
| `content_ids` | items `productId\|comboId`, filtered empty | `customData.content_ids` | `custom_data.content_ids` | present if non-empty |
| `content_type` | `'product'` | `customData.content_type` | `custom_data.content_type` | browser sets; server always product |
| `content_name` | — | `customData.content_name` | `custom_data.content_name` | browser-order pages only |
| `content_category` | — | `customData.content_category` | `custom_data.content_category` | browser only |
| `contents[]` | items `{id, quantity, item_price}` | `customData.contents` | `custom_data.contents` | each item; server price `Number(i.price)` |
| `num_items` | Σ quantities | `customData.num_items` | `custom_data.num_items` | |
| `search_string` | — | `customData.search_string` | `custom_data.search_string` | **never populated** (Search has no call site, G6) |
| `orderId` | `order.id` | `customData.order_id` | `custom_data.order_id` | also drives event_id prefix |
| `customer.email` | order.customer.email / guest | `userData.email` | `user_data.em` (hash) | synthetic → dropped |
| `customer.phone` | order.customer.phone / guestPhone | `userData.phone` | `user_data.ph` (hash) | E.164 |
| `customer.firstName` | order.customer.firstName / guestName | `userData.name` → firstName | `user_data.fn` | browser maps `name` → firstName |
| `customer.lastName` | order.customer.lastName | `userData.lastName` | `user_data.ln` | server Purchase only |
| `customer.city` | shippingAddress.city \| district | `userData.city` | `user_data.ct` | server; Refund does not set city |
| `customer.state` | — (not set server-side) | `userData.state` | `user_data.st` | browser only |
| `customer.country` | `'BD'` default, shipping country | `userData.country` | `user_data.cn` | default BD |
| `customer.zip` | — (not set server-side) | `userData.zip` | `user_data.zp` | browser only |
| `ctx.externalId` | (context, server-generated) | — | `user_data.external_id` (hash) | via context, G3 |
| `ctx.fbp/fbc` | (context via syncContext) | dropped from mirror body | `user_data.fbp/fbc` | raw; not from event body |
| `ctx.ip` / `ctx.userAgent` | request at capture | — | `client_ip_address` / `client_user_agent` | server-derived |
| `ctx.url` | (context) | — | `event_source_url` | via context |

---

## 13. external_id Analysis

| Property | Verified behavior |
|---|---|
| How generated | Server `crypto.randomUUID()` in `TrackingContextService.upsertContext` create branch (tracking-context.service.ts:43). |
| Who generates it | Backend, at context-row creation. |
| Lifecycle | **Per-journey** — one per `ctxId`, created on first `/tracking/context` POST; the update branch never modifies it. |
| Anonymous | Yes — assigned to every context (guests included). |
| Authenticated | **Same per-journey UUID** — not linked to `customerId`. |
| Customer merge | **NOT implemented** (G3). No code binds externalId to a customer profile. |
| Persistence | `TrackingContext.externalId` column. |
| Regeneration | Only when a new `ctxId` creates a new context (e.g. localStorage cleared). |
| Cross-device | None — each device/journey gets a different externalId. |
| Cross-session | None — a new context means a new externalId. |
| Tenant isolation | Single-store platform; no tenant prefix or scoping. |
| DB / cookie / session dependency | DB-bound via the context row; resolved at dispatch through `outbox.ctxId → context`. |
| Pixel sharing | **Not passed to the Pixel** — `fbq('init', metaId)` has no `external_id`. |
| Deletion consequence | Each context owns a unique random externalId → an abandoned pre-order context (no order link) is **not** reachable by `deleteByCustomerId`, because its externalId never appears in an order-linked context. |

**external_id lifecycle diagram:**

```
ctxId first seen (browser POST /tracking/context, ctxId="ecomate_ctx_id")
   │
   ▼
TrackingContext row CREATE
   externalId = crypto.randomUUID()   ← server-generated, per journey
   ip/ua/url/referrer/identifiers     ← from request + browser sync
   │
   ▼  later POST /tracking/context (same ctxId)
TrackingContext UPDATE — identifiers merged (rotate-when-newer), url/referrer refreshed
   externalId UNTOUCHED   (update branch never writes it)
   │
   ▼  dispatch time (outbox → dispatcher → adapter)
buildContextView(ctx) → ctx.externalId
   ▼
normalizer.hashExternalId(externalId) → user_data.external_id (SHA-256) → Meta CAPI
   │
   └─ Never propagated to the Pixel (fbq init has no external_id)
      Never linked to customerId (no merge step exists)
      New ctxId (localStorage cleared) → NEW context → NEW externalId (old orphaned)
```

---

## 14. event_id Analysis

| Property | Behavior |
|---|---|
| Generation | Server callers choose: `purchase_{orderId}` / `refund_{orderId}` / `lead_{leadId}`. Browser non-order events use `Date.now() + random` (G8). |
| Ownership | Business services choose server ids; the browser passes the Purchase id through; for non-Purchase events there is no stable browser key. |
| Storage | `TrackingSnapshot.eventId` (UNIQUE), denormalized onto `TrackingDispatch.eventId` and every `TrackingDispatchEvent`. |
| Propagation | Browser `trackEvent` → Pixel `eventID` **and** POST `/tracking/events` with the same value; server capture reuses it. |
| Browser ↔ Server consistency | **Purchase only** (`purchase_{orderId}` shared). Other events are not parity-constrained. |
| Replay behavior | Replay resets outbox `DEAD → PENDING`; `eventId` unchanged → provider dedup keys are reused. |
| Retry behavior | Same `eventId` on every retry; `providerEventId` column holds it. |
| Uniqueness | `@unique` on `TrackingSnapshot.eventId`. |
| Collision prevention | The UNIQUE constraint turns a second capture into `DEDUPED` (never throws). |
| Reuse policy | Never overridden for the same order; `refund_{orderId}` is distinct. |

**event_id lifecycle diagram (order events):**

```
Business service (orders/leads)
   eventId = purchase_{order.id} | refund_{order.id} | lead_{lead.id}
   │
   ▼  inside prisma.$transaction
capture(): TrackingSnapshot.eventId (UNIQUE, skipDuplicates)
   ├─ inserted → new snapshot → outbox(PENDING) → … dispatch → adapters
   │              providerEventId = eventId → Meta/TikTok event_id (same on retry)
   └─ conflict → DEDUPED (no snapshot/outbox) → existing history preserved
   │
   ▼  browser (instant Purchase): eventID = purchase_{order.id}
fbq('track','Purchase', …, {eventID})  +  mirror POST /tracking/events (same id)
   │
   ▼  replay (DEAD → PENDING) / retry
same eventId reused — provider-side dedup absorbs duplicate sends
```

**event_id lifecycle diagram (browser-only events):**

```
Browser trackEvent('ViewContent'|'AddToCart'|'InitiateCheckout', data)
   eventId = generateEventId() = Date.now() + '-' + Math.random()…   (G8)
   │
   ├─ fbq('track', E, data, {eventID: eventId})
   └─ POST /tracking/events { eventId }  →  capture() → snapshot.eventId = eventId
        (double-mount/double-click → a NEW random id each call → a SECOND snapshot)
```

---

## 15. Deduplication Analysis

1. **Capture**: `eventId UNIQUE` + `createMany(skipDuplicates)` → second capture returns `DEDUPED` (logged; no snapshot/outbox rows) and never fails the business txn.
2. **Per-provider**: `@@unique([snapshotId, provider])` → exactly one dispatch row per provider; retries upsert, never duplicate.
3. **Provider pass-through** (Meta/TikTok): retries reuse the same `event_id`. **GA4 MP and Google Ads have no dedup key** — the dispatcher's work-set rule (never re-run a `SENT` row) plus GA4's instant-mode suppression prevent double-send to them.
4. **Instant Purchase**: Pixel `eventID` + CAPI `event_id` are both `purchase_{orderId}` → capture-once on the server and a shared key on the wire.
5. **`DEDUPED` as a dispatch status is never produced** — it only exists as a capture-time result.
6. Browser-only events are NOT deduplicated across double-mounts/double-clicks (G8).

**Deduplication scenario matrix:**

| Scenario | Mechanism | Outcome |
|---|---|---|
| Duplicate capture, same `eventId` (double-click on Purchase/lead submit, retried order-create) | `TrackingSnapshot.eventId UNIQUE` + `skipDuplicates` | `DEDUPED`, no new snapshot/outbox; existing history preserved; business txn unaffected |
| StrictMode double-mount / double-click on ViewContent/AddToCart/InitiateCheckout | none — `Date.now()+random` each call (G8) | **two snapshots**, two server dispatches |
| Retry of a failed send (same snapshot) | dispatch row upserted on `@@unique([snapshotId, provider])`; same `providerEventId`/`event_id` | single dispatch row, attemptCount++; provider-side dedup absorbs the duplicate send |
| Browser Pixel + server CAPI for the same instant Purchase | shared `purchase_{orderId}` → server capture-once | one snapshot; one `purchase_{orderId}` on the wire |
| Two providers for one snapshot | separate `TrackingDispatch` rows | each provider sent independently, no cross-provider interference |
| Replayed DEAD event | ReplayService resets DEAD→PENDING, `eventId` unchanged | reuses existing dispatch row (work-set), no new snapshot |
| Hung `SENDING` row | Reconciler marks RETRY; work-set re-processes it | only that provider re-attempted; `SENT` providers untouched |
| Delayed instant Purchase (CAPI dispatched long after Pixel) | **no guard** (G1) | risk of double delivery; dedup-window duration is a Phase-2 validation (§26 G1) |

---

## 16. Retry Architecture

| Layer | Mechanism | Config |
|---|---|---|
| Queue (BullMQ transport) | `attempts: 3`, exponential backoff 2000 ms; `removeOnComplete: 100`, `removeOnFail: 50`; per-attempt job id `${outboxId}-${attemptCount}` | set by the relay on each `queue.add` |
| Outbox (durable, DB-owned) | `attemptCount` + `nextAttemptAt`; backoff 1 m → 10 m → 1 h → 6 h → 24 h; **max 5 → `DEAD`**; dispatcher returns `CLAIMED → PENDING` (lock cleared) on retryable failure; survives a full queue/Redis outage | `RETRY_BACKOFF_MS`, `MAX_OUTBOX_ATTEMPTS = 5` |
| Classification | 429 / 5xx / network / timeout → retryable; other 4xx → permanent `FAILED`/`DEAD`. TikTok business codes 40011/40012 retryable, other non-zero codes permanent | each adapter's `send()` |
| Idempotent send | same `providerEventId` reused on every retry | `TrackingDispatch.providerEventId` |

---

## 17. Queue Architecture

| Property | Value |
|---|---|
| Queue type | BullMQ over Redis (`REDIS_URL` / `REDIS_HOST`/`PORT`/`PASSWORD` parsed in queue.module.ts) |
| Source of truth | **DB outbox** — the queue is a delivery envelope only |
| Claim | raw `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, ordered by `priority DESC, nextAttemptAt ASC` |
| Job id | per-attempt `${outboxId}-${attemptCount}` (relay) and `${outboxId}-${attemptCount}-dlq` (DLQ) — **no `:`** (prod fix `05152596`) |
| Priority | `TrackingOutbox.priority` = 10 for Purchase/Refund else 0 |
| Poll cadence | relay interval 1 s, batch 50; enqueue failure releases the lock with backoff |
| Retry (BullMQ) | attempts 3, exponential 2 s |
| Dead-letter | `tracking-dlq` mirror (capped retention) — DB `DEAD` is authoritative |
| Replay of DEAD | `ReplayService` resets DEAD → PENDING; **relay is the sole enqueuer** (the `:replay:0` string is an audit marker, never a real job id) |
| Idempotency | `eventId` / `snapshotId` / `@@unique([snapshotId, provider])`; idempotent outbox insert |

Worker: `@Processor('tracking')` single `WorkerHost`; concurrency is per-instance (horizontal scale = more instances). No explicit per-queue worker concurrency is configured in the module.

---

## 18. Monitoring

Admin page `/mon/settings/tracking/monitoring` (feature-gated `admin_tracking`):
- Volume by eventType (window default 24 h, cap 168 h).
- Per-provider dispatch funnel (`pending/sending/sent/retry/failed/dead/skipped/deduped`) across every registered provider.
- `DEAD` DB count (primary DLQ-depth KPI) + live `tracking-dlq` queue depth.
- Retry histogram (`attemptCount > 0` distribution).
- Top failure messages (`errorMsg` aggregated for FAILED/DEAD, truncated 300 chars).
- Freshness: average + p95 capture → dispatch latency over dispatched outboxes.
- Dedup-key usage: `event_id` / `external_id` / `fbp` / `fbc` (see §26 G7 caveat).
- Per-event timeline from `TrackingDispatchEvent` (search by `eventId`), plus snapshot eventType and outbox status.

All read-only Prisma aggregates — no external metrics stack, no nightly pre-aggregation (the design anticipated a rollup; not implemented). **Alerting** beyond DB/queue state: **NOT FOUND**.

---

## 19. Configuration + Config Dependency Graph

| Kind | Keys / vars |
|---|---|
| DB `system_setting` flags | `tracking_meta_enabled`, `tracking_tiktok_enabled` (legacy alternates `meta_pixel_enabled`, `tiktok_pixel_enabled` read by the storefront config); `tracking_meta_pixel_id`, `tracking_meta_access_token` (SECRET), `tracking_meta_purchase_mode`, `tracking_meta_validated_status`, `tracking_meta_test_mode`, `tracking_meta_test_code`; `tracking_tiktok_pixel_code`, `tracking_tiktok_access_token` (SECRET), `tracking_tiktok_purchase_mode`, `tracking_tiktok_validated_status`, `tracking_tiktok_test_mode`, `tracking_tiktok_test_code`; `tracking_refund_enabled`; `tracking_relay_enabled` |
| Env | `META_PIXEL_ID`, `META_ACCESS_TOKEN`, `TIKTOK_PIXEL_CODE`, `TIKTOK_ACCESS_TOKEN`, `GA_MEASUREMENT_ID`, `GA_API_SECRET`, `GA_ADS_CONVERSION_ID`, `GA_ADS_CONVERSION_LABEL`, `GOOGLE_ADS_CONVERSION_ID`, `GOOGLE_ADS_CONVERSION_LABEL`, `TRACKING_RELAY_ENABLED`, `RETENTION_ENABLED`, Redis (`REDIS_URL`). **Undocumented in `.env.example`**: `REDIS_URL` and `TRACKING_RELAY_ENABLED` (verified by config subagent). |
| Provider enablement | Meta/TikTok = DB setting flag; GA4/google_ads = **env presence** (no DB flag) — reflected in `enabledProviders` in configSnapshot |
| Feature flags | `admin_tracking` (gates replay/monitoring/deletion controllers); `integration_meta`, `offline_conversion` in license-types |
| Storefront config | `GET /system-settings/storefront` exposes `meta.pixelEnabled/pixelId/purchaseMode/validatedStatus` (env fallback `META_PIXEL_ID`). **Access token is never exposed to the browser.** |
| `test_event_code` | honored only when `tracking_<provider>_test_mode === 'true'` — see §20 |

**Config dependency graph:**

```
system_setting (DB) ────────────────┐        env (ConfigService) ─────────────────────┐
   tracking_meta_* / tracking_tiktok_* │   META_*/TIKTOK_*/GA_*/GA_ADS_*/GOOGLE_ADS_* │
        │                              │        │                                    │
        ▼                              │        ▼                                    │
TrackingSettingsService.get(key, envKey)  ← fallback to env when setting absent
        │  buildConfigSnapshot()                      │  buildCfg(provider)
        ▼                                             ▼
outbox.configSnapshot                dispatcher per-provider cfg
  { enabledProviders,                 { pixelId/pixelCode/accessToken/testEventCode,
    normalizerVersion, capturedAt,      measurementId/apiSecret,
    purchaseModes, validatedStatuses }   conversionId/label }
        │                                             │
        ▼                                             ▼
TrackingDispatcher ── work set ──▶ adapters.build()+send()

/settings/storefront (system-settings.controller)
  meta.pixelEnabled/pixelId/purchaseMode/validatedStatus  (env fallback META_PIXEL_ID)
        │
        ▼
storefront config (ISR 60s) → StorefrontConfigContext → TrackingScripts
        │  → setPixelIds / setTrackingConfig → trackEvent gating + pixel init

tracking_relay_enabled (setting | TRACKING_RELAY_ENABLED env)  → OutboxRelayService.start()
RETENTION_ENABLED (env)                                        → RetentionCleanupService
admin_tracking (license feature)                               → Monitoring/Replay/Deletion controllers
REDIS_URL/HOST/PORT/PASSWORD (env)                             → BullModule.forRoot (QueueModule)
```

---

## 20. Browser Test Events Investigation

**Question:** how do test-event codes work today, on the browser and on the server?

**Server (CAPI):** verified path exists and is gated.
- `TrackingSettingsService.getTestEventCode(provider)` (tracking-settings.service.ts:37-41) returns `tracking_{provider}_test_code` **only when** `tracking_{provider}_test_mode === 'true'`. Both are read from DB `system_setting` — **no env fallback** for mode or code.
- `TrackingDispatcherService.buildCfg(provider)` resolves `testEventCode` for `meta` and `tiktok` via `getTestEventCode(...)`.
- `MetaAdapter.send` appends `test_event_code` to the CAPI body **only when** cfg has it (meta.adapter.ts:137); `TikTokAdapter.send` does the same (tiktok.adapter.ts:151).
- GA4 / Google Ads adapters have **no test-code path**.

**Browser (Pixel):** NOT FOUND.
- `fbq('init', metaId)` and every `fbq('track', …)` carry **no test-event code**. There is no browser-side test-mode wiring in `tracking.ts` or `TrackingScripts.tsx`. Browser test events are therefore not configurable from this codebase.

**Config surface (admin):** the tracking-settings page exposes `metaTestMode` / `metaTestCode` and `tiktokTestMode` / `tiktokTestCode` (tracking-settings.tsx) writing the four `tracking_{provider}_test_{mode,code}` settings.

**Summary:** CAPI test codes exist, are gated on a test-mode flag (a leftover code cannot leak into production traffic), and apply to Meta + TikTok only; the browser Pixel has no test-event-code path; GA4/Google Ads have none.

---

## 21. Testing

Coverage is **extensive for the backend module** (23 spec files) but **thin for browser↔server parity and for PageView analytics**.

Backend suite (verified test-case inventory):
- **capture**: idempotent (DEDUPED, no duplicate outbox), priority mapping, caller-supplied transaction.
- **dispatcher**: provider independence, work-set rule (never re-sends SENT), SKIPPED/NOOP, DEAD on ALL_SENT violation and on max-attempts, DLQ mirror + archive best-effort, context-view mapping, BigInt→number eventTime, replay-archive fallback, stuck-CLAIMED release.
- **relay**: SKIP-LOCKED claim, per-attempt job id, lock release on enqueue failure with backoff, disabled-gate (relay off).
- **adapters** (meta/tiktok/ga4/google-ads): wire shape, refund negativity, retryable classification (429/5xx/network/timeout), 500-char truncation, missing-config short-circuit, TikTok HTTP-200-with-code handling.
- **normalizer**: email/phone-BD/zip/name/city normalization, synthetic-email filter, E.164 invariants.
- **context-merge**: rotating replace-when-newer-never-clear, static first-wins, per-key provenance, provider-namespace isolation.
- **retention/deletion**: windowed batching, PII-strip→archive→purge ordering, GDPR delete by externalId/customerId incl. guest orders and abandoned-context recovery.
- **monitoring**: funnel defaulting, p95 freshness, dedup counting, parameter bounds.
- **replay**: archive PII-stripping, version pinning + fallback, DEAD→PENDING, relay-single-enqueue semantics.
- **reconciler**: stale-CLAIMED release with live-dispatch guard, hung-SENDING→RETRY.

**Gaps (no tests):**
- **Browser ↔ server event_id parity end-to-end** — only unit-level; no integration test proving Pixel/CAPI share the same key on a real order.
- **`PageViewBufferService`** — **no spec file exists** (23 specs, none for page-view-buffer).
- **Freshness SLO / load at scale** — not in the suite (load test was deferred in the design).
- Storefront: `tracking-client.spec.ts` (ctxId stability, identifier collection, context POST) and `tracking.spec.ts` exist but do not exercise the uncovered events (G6).
- Admin: only `monitoring.test.tsx`; no settings-page test.

---

## 22. Known Unknowns / Unable to Verify

| Item | Status |
|---|---|
| Is the relay actually running in any production server? (`tracking_relay_enabled` in the prod DB) | **UNABLE TO VERIFY** — per-env toggle |
| Were migrations `20260802120000_drop_tracking_event` and `20260802130000_add_snapshot_created_at_index` deployed? | **UNABLE TO VERIFY** — documented as hand-authored / pending `migrate deploy` |
| Real production env values (tokens, pixel ids, Redis) and load characteristics | **UNABLE TO VERIFY** |
| Whether GA4/TikTok/google_ads are actually enabled in production (env presence) | **UNABLE TO VERIFY** |
| Live monitoring volume / funnel / dedup-key numbers | **NOT FOUND** — no production data view accessible |
| Alerting/notification wiring beyond DB/queue state | **NOT FOUND** |
| Meta Events-Manager coverage — measured server-side, not in our DB | **NOT FOUND** (out of system) |

---

## 23. Questions Requiring Architect Clarification

1. **G1/G2 (dedup-age guard, event-age guard):** both guards are absent from the implementation. Were they deferred, or is the current behavior intended? If absent intentionally, document the duplicate-delivery and stale-send behavior.
2. **G3 (external_id):** is the per-journey random UUID acceptable for launch, or should external_id be customer-keyed? This also affects the `deleteByCustomerId` guarantee for abandoned pre-order contexts.
3. **G4 (successPolicy):** is `ALL_SENT`-only intended, with `ANY_SENT`/`N_SENT` deferred?
4. **G5 (consent/opt-out):** is a CMP/opt-out gate on the roadmap, or is the platform intentionally consent-free?
5. **G6 (coverage):** are AddToWishlist / AddPaymentInfo / Search / CompleteRegistration intentionally not fired?
6. **G8 (browser eventId):** is the "journey-stable logical-action key" for non-Purchase events still desired?
7. **G7 (monitoring):** should the `external_id` dedup-key metric count `TrackingContext.externalId` usage instead of the never-written `payload.externalId` path?
8. **Retention numbers:** confirm the 365 d dispatch retention and 2 y snapshot archive horizon before release.
9. **PageView analytics:** is `PageViewBufferService` (the analytics buffer) in scope for this tracking system, or is it a separate analytics concern?

---

## 24. Potential Risks & Observations (Not Yet Validated)

Each item is a behavioral observation for architect review — not a diagnosed bug, and **no external-spec judgment**. All were cross-verified by an adversarial subagent against the cited code.

1. **G1 — No dispatch dedup-age guard.** Evidence: `tracking-dispatcher.service.ts` (work-set, terminal logic) and `meta.adapter.ts` contain no time-window/dedup-age logic; `DEDUPED` originates only from `tracking-capture.service.ts` (eventId conflict). **Why**: a browser-confirmed instant Purchase whose CAPI send is delayed (outage, replay, validated-mode latency) is still sent → duplicate-delivery risk. Whether the delay exceeds the provider's dedup window is a Phase-2 validation. **Confidence: High.**
2. **G2 — No event-age guard.** Evidence: all four adapters copy `snapshot.eventTime ?? Date.now()/1000` with no age check (meta:99, tiktok:113, ga4:90, google-ads:102). **Why**: replayed/backed-off stale events reach the provider API verbatim. Whether the provider rejects them is a Phase-2 validation. **Confidence: High.**
3. **G3 — external_id per-journey random, not customer-stable, not shared with the Pixel.** Evidence: `tracking-context.service.ts:43`; `TrackingScripts.tsx` `fbq('init')` without external_id. **Why**: cross-device/cross-session identity is not realized; deletion of abandoned pre-order contexts is unreachable because each context owns a unique random externalId. **Confidence: High.**
4. **G4 — successPolicy never written to configSnapshot.** Evidence: `buildConfigSnapshot()` (tracking-settings.service.ts) omits it; all capture call sites use the function; dispatcher defaults `?? 'ALL_SENT'`. **Why**: `ANY_SENT`/`N_SENT` are dead configuration. **Confidence: High.**
5. **G5 — No consent/opt-out gate anywhere.** Evidence: browser `syncContext`/`trackEvent`/`TrackingScripts` always run; backend tracking endpoints have no consent check. **Why**: regulatory exposure if consent is ever required. **Confidence: High.**
6. **G7 — Monitoring external_id metric always ~0.** Evidence: `monitoring.service.ts getDedupKeyUsage` counts snapshots with `payload.externalId`; no capture writes that path (externalId lives on `TrackingContext`). **Why**: misleading dashboard KPI. **Confidence: High.**
7. **G8 — Browser event dedup thin for non-Purchase events.** Evidence: `tracking.ts generateEventId` = `Date.now() + random`. **Why**: double-mount/double-click creates two snapshots capture-time dedup cannot collapse. **Confidence: Medium.**
8. **G9 — Orphan `public/scripts/tracking.js`.** Evidence: no `<script>` references it, but `TrackingScripts.tsx:31-32` still sets `__META_ID`/`__TIKTOK_CODE`. **Why**: if the file is ever referenced again it double-fires PageView. **Confidence: Medium** (latent).
9. **G10 — Meta token in the Graph URL query string.** Evidence: `meta.adapter.ts send()` builds `?access_token=…`. **Why**: proxy/infra access logs may capture the token (not the app logs). **Confidence: Medium.**
10. **G11 — Raw provider response persisted 365 d.** Evidence: `TrackingDispatch.responseBody`/`errorMsg` store up to 500 chars of the provider echo; retention purges dispatch rows at 365 d. **Why**: if a provider ever echoes submitted PII, that PII survives a year. **Confidence: Low–Medium** (truncated).
11. **G12 — Adapter registry rebuilt per dispatch.** Evidence: `buildAdapterRegistry()` is invoked on every dispatch job and in monitoring/replay paths. **Why**: unnecessary allocation/latency under heavy load (the registry is a module-level map). **Confidence: Medium** (performance).
12. **G13 — `PageViewBufferService` untested.** Evidence: no spec file. **Why**: the analytics path has no regression coverage. **Confidence: Low.**

---

## 25. Verification Method

- Every claim was read directly from source during discovery.
- A parallel adversarial subagent re-read the cited files and returned CONFIRMED/PARTIAL for all architecture claims (the only PARTIAL was the replay `queueJobId` marker string, which contains colons but is never passed to BullMQ — the relay/DLQ real job ids are colon-free).
- A separate scan confirmed the legacy direct-send services and the `TrackingEvent` table are fully removed; no code references them. POS and Capacitor have zero tracking code.
- Config/security/performance were cross-checked by a dedicated subagent (env vars, settings keys, secrets, PII exposure, logging).
- The test suite was characterized directly from the spec-file inventory.

**No code was modified during this discovery.**

---

## 26. Meta-Spec Comparison — DEFERRED to Phase 2 (stub)

Per architect instruction, this Discovery report contains **verified implementation and evidence only**. The following comparison work is intentionally **not** performed here and is queued for Phase 2:

- Map each adapter's wire behavior against the provider's documented requirements (field formats, mandatory `em`/`ph` combos, hashing/normalization rules, event-parameter requirements).
- Validate the dedup-window duration for instant-mode Purchase double-count risk (context for §24 G1).
- Validate provider event-age / retention rejection behavior (context for §24 G2).
- Validate Advanced-Matching / `external_id` expectations and EMQ-relevant key coverage (context for §24 G3/G8).
- Validate test-event-code semantics against provider docs (context for §20).
- Validate Event-name coverage and the un-fired events list (context for §24 G6).

Phase 2 will produce a separate comparison report; no conclusion in this Discovery relies on provider-documentation claims.
