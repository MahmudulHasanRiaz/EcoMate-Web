# CAPI Tracking Pipeline — Phase 2: Normalizer + Provider Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the single hashing/normalization abstraction and the provider-agnostic adapter layer — `TrackingNormalizer` + `TrackingProviderAdapter` interface + registry, and Meta/TikTok/GA4/Google Ads adapters that transform a canonical snapshot + context into provider payloads and send them.

**Architecture:** Phase 2 of the approved design (`docs/superpowers/specs/2026-08-02-ecomate-capi-redesign-design.md`, §4.5/§4.6/§8/§17). Additive only: new files under `apps/backend/src/tracking/adapters/` + `tracking.normalizer.ts`. The legacy `meta-conversions.service.ts` / `tiktok-events.service.ts` / `ga4-measurement.service.ts` / `google-ads.service.ts` stay untouched until Phase 3-4 (the dispatcher consumes the adapters, then the legacy services are retired). Snapshots do not exist as DB rows until Phase 3 — the adapters are built and tested against canonical **types** + fixtures.

**Tech Stack:** NestJS 11, Node 18+ (fetch), Jest.

## Global Constraints

- **Backend rules:** DTOs with `class-validator`; `$transaction` for multi-write; thin controllers; run `npm run build --workspace=backend` before completion; Jest for behavior changes.
- **Design invariants (§4.5/§4.6):** hashing/normalization lives ONLY in `TrackingNormalizer` — no adapter implements its own hashing. Snapshots are canonical (no provider fields/hashed values). Adapters are versioned (`version`, `providerApiVersion`). `DispatchResult.retryable` = `false` for 4xx/validation, `true` for 5xx/429/timeout. Refund mapping is per-provider. GA4 suppresses server MP for browser-fired instant events.
- **Settings:** adapters read config via `TrackingSettingsService` (Phase 0): `get`, `isEnabled`, `getTestEventCode`.
- **No migration:** Phase 2 adds no schema change.

---
## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/backend/src/tracking/tracking.normalizer.ts` | Create | Single SHA-256 hashing + normalization abstraction, `version` |
| `apps/backend/src/tracking/tracking-snapshot.types.ts` | Create | Canonical snapshot payload + context-view types |
| `apps/backend/src/tracking/adapters/tracking-provider.adapter.ts` | Create | `TrackingProviderAdapter` interface + `DispatchResult` + registry |
| `apps/backend/src/tracking/adapters/meta.adapter.ts` | Create | Meta CAPI adapter |
| `apps/backend/src/tracking/adapters/tiktok.adapter.ts` | Create | TikTok Events API adapter |
| `apps/backend/src/tracking/adapters/ga4.adapter.ts` | Create | GA4 Measurement Protocol adapter |
| `apps/backend/src/tracking/adapters/google-ads.adapter.ts` | Create | Google Ads offline conversion adapter |
| `apps/backend/src/tracking/adapters/index.ts` | Create | Registry assembly (all adapters + `getAdapter`) |
| `apps/backend/src/tracking/__tests__/*.spec.ts` | Create | Per-task unit tests |

---
### Task 1: TrackingNormalizer + canonical types

**Files:**
- Create: `apps/backend/src/tracking/tracking.normalizer.ts`
- Create: `apps/backend/src/tracking/tracking-snapshot.types.ts`
- Create: `apps/backend/src/tracking/__tests__/tracking.normalizer.spec.ts`

**Interfaces:**
- Produces:
  - `TrackingNormalizer` with `version: number`, `hashEmail(email): string | undefined`, `hashPhone(phone, countryCode?): string | undefined`, `hashName(name): string | undefined`, `hashCity/State/Zip/Country`, `hashExternalId`, `isSyntheticEmail(email): boolean`, `splitName(full): {firstName,lastName}`, `normalizeZip(zip): string`.
  - Types: `TrackingSnapshotPayload` (canonical business data), `TrackingContextView` (session identifiers + ip/ua/url/referrer/externalId).
- Consumed by: all adapters (Tasks 3-6).

- [ ] **Step 1: Write the failing test** — hashEmail trims+lowercases then SHA-256; hashPhone adds country code (BD 11-digit `01…` → `8801…`), strips non-digits/`+`, handles already-coded; hashName lowercase no punctuation; normalizeZip removes dash/space + US first-5; isSyntheticEmail catches `cust_`, all-numeric, and `+`-tagged; splitName; normalizer.version is a positive integer.

- [ ] **Step 2: Run → FAIL** (module not found).
- [ ] **Step 3: Implement `tracking.normalizer.ts`** — SHA-256 via `node:crypto` `createHash('sha256').update(normalized).digest('hex')`. Phone: strip `\D`, restore leading `0` for 10-digit BD, prefix `880`, always return E.164-with-country. Zip: lowercase, remove spaces/dash, US first 5 digits. Synthetic filter incl. `+`-tagged addresses.
- [ ] **Step 4: Implement `tracking-snapshot.types.ts`**:
```ts
export interface SnapshotContentItem { id: string; quantity: number; item_price?: number; }
export interface TrackingSnapshotPayload {
  orderId?: string;
  value?: number;
  currency?: string;
  content_ids?: string[];
  contents?: SnapshotContentItem[];
  num_items?: number;
  search_string?: string;
  customer?: { email?: string; phone?: string; firstName?: string; lastName?: string; city?: string; state?: string; country?: string; zip?: string; };
}
export interface TrackingContextView {
  externalId?: string;
  ip?: string;
  userAgent?: string;
  url?: string;
  referrer?: string;
  fbp?: string;
  fbc?: string;
  gaClientId?: string;
  gclid?: string;
  ttclid?: string;
  // future providers extend this view at the adapter boundary
}
```
- [ ] **Step 5: Run → PASS.** Run `npm run build --workspace=backend`. **Commit** `feat(tracking): add TrackingNormalizer + canonical snapshot types`

---
### Task 2: TrackingProviderAdapter interface + registry

**Files:**
- Create: `apps/backend/src/tracking/adapters/tracking-provider.adapter.ts`
- Create: `apps/backend/src/tracking/adapters/index.ts`
- Create: `apps/backend/src/tracking/__tests__/tracking-provider.adapter.spec.ts`

**Interfaces:**
- Consumes: `TrackingSnapshotPayload`, `TrackingContextView` (Task 1), `TrackingNormalizer` (Task 1).
- Produces:
```ts
export interface DispatchResult { ok: boolean; retryable: boolean; providerEventId?: string; httpStatus?: number; rawResponse?: string; }
export interface TrackingProviderAdapter {
  readonly provider: string;
  readonly version: number;
  readonly providerApiVersion: string;
  supports(eventType: string): boolean;
  build(snapshot: TrackingSnapshotPayload, ctx: TrackingContextView, normalizer: TrackingNormalizer): ProviderPayload | null;
  send(payload: ProviderPayload, cfg: ProviderConfig): Promise<DispatchResult>;
}
export interface ProviderConfig { [key: string]: string | undefined; }
```
  Plus a registry: `registerAdapter(adapter)`, `getAdapter(provider, version?)`, `listAdapters()`.

- [ ] **Step 1: Write the failing test** — a fake adapter registers; `getAdapter` returns it; `getAdapter('meta', 999)` falls back to the latest registered meta version; `supports` gating works.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Registry = `Map<string, TrackingProviderAdapter[]>` (provider → versions, newest last); `getAdapter(provider, version?)` returns the requested version or the latest.
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(tracking): add provider adapter interface + versioned registry`

---
### Task 3: Meta adapter

**Files:**
- Create: `apps/backend/src/tracking/adapters/meta.adapter.ts`
- Create: `apps/backend/src/tracking/__tests__/meta.adapter.spec.ts`

**Interfaces:**
- Consumes: Task 1 + Task 2. Config keys (via `TrackingSettingsService`): `tracking_meta_enabled`, `tracking_meta_pixel_id` (+ env `META_PIXEL_ID`), `tracking_meta_access_token` (+ env `META_ACCESS_TOKEN`), `tracking_meta_test_mode`/`tracking_meta_test_code`.
- Produces: a `MetaAdapter` implementing `TrackingProviderAdapter` (`provider: 'meta'`, `providerApiVersion: 'v22.0'`), `supports` = standard web events incl. `Purchase`, `Refund` (negative-value mapping), `AddToCart`, `InitiateCheckout`, `ViewContent`, `Lead`, `Search`, `AddPaymentInfo`, `CompleteRegistration`; `build` → Meta CAPI payload (event_name/event_id/event_time/action_source/event_source_url/user_data hashed via normalizer/custom_data); `send` → `POST https://graph.facebook.com/v22.0/{pixelId}/events?access_token=` with retryable detection (`4xx → retryable:false`, `429/5xx/timeout → retryable:true`).

- [ ] **Step 1: Write the failing test** — `build` produces the correct `user_data` (em/ph/fn/ln/ct/cn/zp/st hashed; fbp/fbc/client_ip_address/client_user_agent raw; external_id hashed-or-raw per normalizer), custom_data (value/currency/content_ids/contents/order_id), `event_source_url` from ctx.url, action_source `website`; `Refund` maps to negative `value` + distinct `event_id`; `send` returns `{ok:true}` on 2xx and `{ok:false, retryable:false}` on 400 and `{ok:false, retryable:true}` on 500 (mock fetch).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — port the payload/hashing logic from `meta-conversions.service.ts` into `build` (replacing its inline hashing with the normalizer) and the retry-aware HTTP into `send`. Reference: `apps/backend/src/tracking/meta-conversions.service.ts`.
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(tracking): add Meta CAPI adapter`

---
### Task 4: TikTok + GA4 adapters

**Files:**
- Create: `apps/backend/src/tracking/adapters/tiktok.adapter.ts`
- Create: `apps/backend/src/tracking/adapters/ga4.adapter.ts`
- Create: `apps/backend/src/tracking/__tests__/tiktok.adapter.spec.ts`
- Create: `apps/backend/src/tracking/__tests__/ga4.adapter.spec.ts`

**Interfaces:**
- **TikTok** (`provider: 'tiktok'`, `providerApiVersion: 'v1.3'`): config `tracking_tiktok_pixel_code` (+env `TIKTOK_PIXEL_CODE`), `tracking_tiktok_access_token` (+env `TIKTOK_ACCESS_TOKEN`), `tracking_tiktok_enabled`. `supports` = web events; `Purchase`→`CompletePayment`; `build` → `{pixel_code, event, event_id, timestamp, context:{ip, user_agent, page:{url, referrer}, user:{email/phone_number/external_id/first_name/last_name/city/state/zip/country (hashed)}}, properties}`; `send` → `POST https://business-api.tiktok.com/open_api/v1.3/pixel/track/` with `Access-Token` header.
- **GA4** (`provider: 'ga4'`, `providerApiVersion: 'mp/collect'`): config `GA_MEASUREMENT_ID`, `GA_API_SECRET` (env). **Dispatch policy (§4.6):** `supports(eventType)` returns `false` for events the browser already fires via gtag in instant mode (`ViewContent`, `AddToCart`, `InitiateCheckout`, `AddPaymentInfo`, `Search`, `CompleteRegistration`, `Purchase`) — server MP is only for validated/offline events with no browser counterpart (per config). `build` → `{client_id: ctx.gaClientId || ctx.externalId, events:[{name, params:{value, currency, items, ...}}]}`; `send` → `POST https://www.google-analytics.com/mp/collect?measurement_id=&api_secret=`.

- [ ] **Step 1: Write failing tests** for both (build shapes + hashing; GA4 dispatch policy: `supports('Purchase')` false in instant mode, true for a validated/offline marker; send retryable detection).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — port from `tiktok-events.service.ts` / `ga4-measurement.service.ts`, using the normalizer.
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(tracking): add TikTok + GA4 adapters`

---
### Task 5: Google Ads adapter + registry assembly

**Files:**
- Create: `apps/backend/src/tracking/adapters/google-ads.adapter.ts`
- Create: `apps/backend/src/tracking/__tests__/google-ads.adapter.spec.ts`
- Modify: `apps/backend/src/tracking/adapters/index.ts` (register all four)

**Interfaces:**
- **Google Ads** (`provider: 'google_ads'`): config `GOOGLE_ADS_CONVERSION_ID` (+ `gclid`/`gbraid` from ctx). `supports` = `Purchase` (and `Refund` negative) only. `build` → offline conversion payload (`conversionAction`, `gclid`/`gbraid`, hashed identifiers `em`/`ph` per Google's offline-conversion hashing, `conversionDateTime`, `value`, `currency`, `order_id`); `send` → the existing `google-ads.service.ts` conversion endpoint pattern. **Refund** → negative-value conversion, distinct `event_id`.
- **Registry:** `apps/backend/src/tracking/adapters/index.ts` exports `buildAdapterRegistry()` returning a registry with Meta, TikTok, GA4, Google Ads registered.

- [ ] **Step 1: Write failing tests** (build shape; registry contains all 4 providers; `getAdapter('meta')` resolves).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — port from `google-ads.service.ts`; assemble registry.
- [ ] **Step 4: Run → PASS.** `npm run build --workspace=backend`. **Commit** `feat(tracking): add Google Ads adapter + assemble provider registry`

---
## Self-Review Notes

- **Spec coverage:** Task 1 = §4.5 normalizer + §4.2 canonical payload types; Task 2 = §4.6 interface + versioned registry; Tasks 3-5 = Meta/TikTok/GA4/Google Ads adapters incl. §4.6 dispatch policy (GA4 suppress) + refund mapping (Meta/Ads negative-value, distinct event_id) + §8 versioning.
- **Type consistency:** `TrackingSnapshotPayload`/`TrackingContextView` (Task 1) feed `build(snapshot, ctx, normalizer)` (Task 2) → all adapters. `DispatchResult` shape consistent. `getTestEventCode`/`isEnabled` from `TrackingSettingsService` (Phase 0) used by `send` configs.
- **Placeholders:** none — each step has complete code.
- **Migration:** none (additive).
- **Non-goal:** legacy provider services are NOT removed here (retired in Phase 3-4 when the dispatcher consumes adapters).
