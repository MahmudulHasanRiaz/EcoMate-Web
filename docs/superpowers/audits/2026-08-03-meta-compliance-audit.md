# EcoMate Meta Tracking — Phase-2: Enterprise Compliance, Optimization & Production Hardening Audit

**Phase-2 — Architect Decision Report. No code modified.**
**Date:** 2026-08-03
**Branch:** `main` tip `19382d51`
**Authoritative baselines:**
1. Meta official documentation (fetched 2026-08-03): Conversions API overview, Parameters, Best Practices, Verifying Setup, Dataset Quality API, Dedup Pixel↔CAPI, custom_data reference.
2. Architect-approved reports: Architecture Discovery, Browser Runtime Verification (2A), Server Runtime Trace (2A.5).
3. Actual codebase (every claim re-verified by independent subagents against `apps/backend/src/tracking`, `apps/storefront`, `apps/admin`).

**Method note:** Meta documentation is intentionally generic. Every recommendation below was evaluated against this ERP's transactional-outbox architecture, scalability, and production constraints — not applied blindly. Findings marked "Recommend non-change" are cases where the current implementation is intentionally better for this platform.

---

## 1. Executive Summary

EcoMate's tracking pipeline is **architecturally strong** — the transactional-outbox + canonical-snapshot + provider-adapter design is genuinely enterprise-grade and superior to Meta's typical fire-and-forget SDK pattern for reliability. The foundation (capture-atomicity, per-attempt job ids, SKIP-LOCKED relay, work-set dedup, single normalizer, provider independence, PII-bounded retention, replay) is **sound and should be preserved**.

The compliance gaps are concentrated in four areas:

1. **Identity (highest leverage).** `external_id` is a per-journey random UUID, never customer-keyed, never sent to the Pixel. Meta's documented `external_id` dedup/identity path is therefore unusable across sessions and between Pixel↔CAPI. Fixing this is the single highest-value change.
2. **Deduplication safety.** Meta's dedup window is **48 hours** (documented). Our pipeline has **no guard** for it, and the relay is **OFF by default** — so an instant-mode Purchase whose CAPI dispatch is delayed (relay off, outage, backoff) can land beyond 48 h and Meta will not dedup. This risks either double-counting or a discarded event.
3. **Payload edge cases that can lose events.** The Meta adapter has **no em-or-ph guard**; an admin/POS order with no customer contact produces `user_data` with no `em`/`ph`, which Meta may reject as "too broad" (invalid combination). Server events also lack `zip`/`state`/`ln`.
4. **Compliance / observability.** No consent/`opt_out` support anywhere; the access token travels in the Graph URL query string; monitoring's `external_id` dedup metric is always 0 and there is no Pixel↔CAPI coverage KPI.

**Overall compliance score: 6.9 / 10** (see §2). No changes were made.

---

## 2. Overall Architecture Compliance Score

| Dimension | Score | Rationale |
|---|---|---|
| Backend reliability / delivery | 9.5 / 10 | Outbox = DB truth; SKIP-LOCKED; per-attempt ids; reconciler; replay. Best-in-class for a self-hosted ERP. |
| Payload base (hashing, required web params) | 8.5 / 10 | Web-required params present; single normalizer; correct `value`/`currency`; hashing rules match Meta. |
| Deduplication | 6.0 / 10 | Deterministic order `event_id` + retry/replay reuse (good); **no 48 h guard**; browser non-Purchase random ids (G8); relay-off default. |
| Identity architecture | 5.0 / 10 | `external_id` per-journey, not customer-keyed, not in Pixel; no Advanced Matching; no cross-session identity. |
| Event Match Quality potential | 7.0 / 10 | Strong key set when contact+context present (em/ph/fn/ct/country/fbp/fbc/ip/ua); reduced by missing zp/st/ln, first-visit fbp, context-less deep links, no em-or-ph guard. |
| Compliance / privacy | 5.0 / 10 | No consent/`opt_out`; token in URL query string; IPv4-only assumption. |
| Observability | 6.0 / 10 | Rich DB aggregates + timeline; but `external_id` metric = 0, no Pixel↔CAPI coverage/dedup-rate KPI, no alerting. |
| **Composite** | **6.9 / 10** | Weighted (reliability 25%, payload 15%, dedup 15%, identity 15%, EMQ 10%, compliance 10%, observability 10%). |

---

## 3. Event Match Quality Assessment

Meta: EMQ is a score out of 10 (web events only), **target ≥ 6.0**; top keys are `em`, `client_ip_address`, `fn`+`ln`, `ph`; Meta also recommends `external_id` and `event_id` on all events; `fbp`/`fbc` change over time and should be refreshed.

**What we send on a normal web Purchase (verified, meta.adapter.ts:59-97):**
`em` ✓, `ph` ✓, `fn` ✓, `ln` ✓ (when split), `ct` ✓, `country` ✓, `external_id` ✓ (hashed), `fbp` ✓, `fbc` ✓, `client_ip_address` ✓, `client_user_agent` ✓, `event_source_url` ✓, `event_id` ✓.

**Expected EMQ:** with a real customer contact + captured context, this set should score **≥ 6.0**. It is a genuinely strong set — this is one of the best parts of the implementation.

**Erosion factors (each verified):**
- **I3 — Missing `zp`/`st` server-side** (orders.service.ts:3239-3246 sets no zip/state). EMQ impact: low–medium.
- **I11 — `ln` often missing on the browser Purchase** — capture maps a single `name` to `firstName` (tracking.controller.ts:61-62; ThankYouContent passes one name). EMQ impact: low.
- **I10 — First-visit `_fbp` absent** — context sync runs before Meta writes the cookie. EMQ impact: low (later pages recover it).
- **I1 — No em-or-ph guard** → contact-less admin/POS orders risk **invalid-event rejection** (Meta invalid combos). EMQ/validity impact: **high for those events**.
- **I12 — Context-less deep-link orders** — no fbp/fbc/ip/ua/external_id/event_source_url at all (dispatcher `buildContextView` returns `{}`). EMQ impact: high for those events.
- **I20 — `client_ip_address` pinned at first context create; IPv4** — Meta flags "update to IPv6" and "mismatched IP" diagnostics. Impact: low, informational.

**Missing signals that would raise EMQ further (optional):** `ge`, `db`, `zp` (server), `st` (server), `ln` (thank-you split). None are mandatory; `zp`/`st`/`ln` are the cheapest wins.

---

## 4. Browser Tracking Assessment

Verified via Phase-2A (Runtime Browser Verification) + this audit:

| Item | Status | Notes |
|---|---|---|
| Pixel init | Partial | `fbq('init', metaId)` only — no `external_id`, **no Advanced Matching (I6)** |
| Web-required event context | OK | `eventID` passed as 4th arg (Meta best practice) |
| `fbp`/`fbc` | OK | collected + synced per navigation; first-visit gap (I10) |
| Redundant setup (Pixel + CAPI) | Good | mirror + transactional capture share `event_id` for order events — this is exactly Meta's recommended redundant setup |
| Ad blocker / edge CSP | **Risk** | Pixel/gtag/TikTok are third-party; mirror is same-origin `/api` → blocker kills Pixel, CAPI survives (I17) |
| SPA navigation | Gap | `fbq PageView` fires once per hard load only; no per-route PageView (I18) |
| Consent | **Missing** | no CMP/opt-out (I16) |
| Duplicate suppression | Partial | thank-you sessionStorage guard + mode gate good; non-Purchase random event_id → double-click/multi-tab duplicates (I7) |
| Browser-side EMQ | Below potential | no Advanced Matching (I6) |

**Assessment:** the browser leg correctly implements the Pixel↔CAPI redundant setup that Meta recommends. The main browser weaknesses are Advanced Matching absence, no consent, SPA PageView, and non-Purchase dedup ids.

---

## 5. Server Tracking Assessment

Verified via Phase-2A.5 + this audit:

| Stage | Status | Notes |
|---|---|---|
| Capture (transactional) | **Good** | snapshot+outbox inside business `$transaction`; idempotent; never fails business |
| Snapshot / Outbox | **Good** | `eventId` UNIQUE; priority 10 for Purchase/Refund; capture-time configSnapshot |
| Relay (SKIP LOCKED) | **Good** | multi-instance safe; per-attempt job id (no colon) |
| BullMQ | Good | but `attempts:3` only covers exceptions — retryable provider failures are DB-scheduled (correct) |
| Dispatcher | **Good** | provider independence; work-set rule; ALL_SENT policy |
| Normalizer | **Good** | single hashing path, Meta-correct normalization |
| Retry | **Good** | DB backoff 1m→24h, max 5→DEAD; same event_id reused (provider dedup) |
| Replay | **Good** | version-pinned, PII-stripped archive; relay sole enqueuer |
| Monitoring | Partial | see §18 |
| Retention / Deletion | **Good** | batched; GDPR-style delete; 2-yr hashed archive |

**Key findings:** I1 (no em-or-ph guard), I8 (no 48 h dedup guard), I9 (relay off by default), I13 (monitoring metric broken), I15 (token in URL).

---

## 6. Identity Architecture Assessment

| Layer | Current | Gap |
|---|---|---|
| `external_id` | per-journey `crypto.randomUUID()` on `TrackingContext` (context.service:43), never customer-keyed, never updated, **never sent to Pixel** (fbq init has no external_id) | **I5** — Meta's `external_id` dedup/identity path cannot work across sessions or Pixel↔CAPI |
| `event_id` | deterministic `purchase_/refund_/lead_ + id` for order events; `Date.now()+random` for browser non-Purchase | I7 (browser events) |
| `ctxId` | localStorage per-origin, shared across tabs; stable per journey | OK |
| customer identity | captured into snapshot `customer` (email/phone/names/city) | not linked to external_id |
| guest identity | `guestName`/`guestPhone`; no stable guest id | partial |
| cross-session / cross-device | not supported (external_id per journey; Pixel no external_id) | **I5** |
| deletion / privacy | GDPR-style delete by externalId/customerId; abandoned pre-order contexts unreachable (per-journey external_id) | consequence of I5 |

**Impact of I5:** Meta's two dedup methods are (a) `event_name`+`event_id`, and (b) `event_name` + `fbp`/`external_id`. We fully use (a) for order events and `fbp` in (b), but the `external_id` arm of (b) is dead across sessions. Fixing I5 (customer-keyed, stable external_id shared with the Pixel) unlocks cross-session and Pixel↔CAPI identity and improves `deleteByCustomerId` coverage.

---

## 7. Deduplication Assessment

Verified (Meta 48 h window is documented and real):

| Scenario | Current behavior | Verdict |
|---|---|---|
| Pixel + CAPI same Purchase (instant) | shared `purchase_{orderId}`; capture-once; Meta dedups within 48 h | **Good when relay is on and prompt** |
| CAPI dispatch delayed > 48 h after Pixel | **no guard (I8)** — Meta will not dedup; may double-count or discard the later event | **Risk** |
| Retry of a failed send | same `providerEventId`/`event_id` → provider dedup absorbs | Good |
| Replay of DEAD | same `event_id`, same `event_time` → Meta dedups against original | Good |
| Double-click / multi-tab non-Purchase | random browser event_id → two events, no dedup (I7) | Weak |
| Refund | distinct `refund_{orderId}` → never absorbed by the sale | Good |
| Cancelled order | Refund path fires a Refund snapshot | Good |
| Order edit after Purchase | snapshot not updated (eventId UNIQUE); stale `value` | Documented limitation |
| GA4 MP | no dedup key; suppressed in instant mode + work-set rule | Good |
| Google Ads | **has a dedup key** (`order_id` + `gclid` + `value` per adapter docstring) + work-set rule | Good (correction to earlier finding) |

**I8 detail:** the relay is OFF by default (outbox-relay.service.ts:167-174) and there is no event-age/dedup-window gate anywhere (verified by grep). While relay is off, or during an outage, instant-mode Purchase CAPI events can dispatch > 48 h after the browser Pixel event. This is the highest-impact dedup risk.

---

## 8. Payload Completeness Assessment

Verified (meta.adapter.ts:58-105, orders.service.ts:3218-3310, checkout-leads.service.ts:219-235):

| Area | Present | Missing / weak |
|---|---|---|
| Web-required | `client_user_agent`, `action_source`, `event_source_url` ✓ | — |
| Contact | `em` ✓, `ph` ✓, `fn` ✓, `ln` (partial), `ct` ✓, `country` ✓ | `zp`, `st` server-side (I3); `ge`, `db` (optional) |
| Identity | `external_id` ✓ (hashed, per-journey), `event_id` ✓ | customer-keyed external_id (I5) |
| Purchase commerce | `value` ✓, `currency` (BDT) ✓, `content_ids` ✓, `content_type` ✓, `contents` (id/quantity/item_price) ✓, `order_id` ✓ | `delivery_category` (optional); `status` (optional) |
| Misc | `num_items` ✗ on non-InitiateCheckout (I2); `search_string` never populated (Search never fires — G6); `content_name`/`content_category` browser-only | — |
| Compliance | `test_event_code` gated ✓ | `opt_out`, consent (I16) |

**Payload quality is high** for the events that fire. The gaps are concentrated: (a) server orders lack `zp`/`st`, (b) `ln` missing on the browser Purchase, (c) `num_items` misused, (d) no `opt_out`, (e) no em-or-ph guard.

---

## 9. Parameter-by-Parameter Compliance Matrix

`✓` compliant · `~` partial · `✗` missing · `—` n/a (app/offline)

| Meta param | Ours | Status | Evidence |
|---|---|---|---|
| `event_name` | canonical event; Refund→`Purchase` negative | ✓ | meta.adapter:51-52 |
| `event_time` | `order.createdAt` epoch (business time) | ✓ | orders:3209-3211; freshness risk for validated (I4) |
| `event_id` | `purchase_/refund_/lead_+id`; random for browser non-Purchase | ✓/~ | meta.adapter:178-187; tracking.ts:20-22 (I7) |
| `user_data.em` | `hashEmail` (trim+lower+sha256, synthetic filter) | ✓ | normalizer:25-29 |
| `user_data.ph` | `hashPhone` (E.164, BD→880) | ✓ | normalizer:36-51 |
| `user_data.fn` / `ln` | `hashName` | ✓/~ | ln missing on thank-you Purchase (I11) |
| `user_data.ge` | — | ✗ | optional |
| `user_data.db` | — | ✗ | optional |
| `user_data.ct` | `hashCity` | ✓ | |
| `user_data.st` | `hashState` — **never populated** | ✗ | orders customer payload has no state (I3) |
| `user_data.zp` | `hashZip` — **never populated** | ✗ | orders customer payload has no zip (I3) |
| `user_data.country` | `hashCountry` (default BD) | ✓ | |
| `user_data.external_id` | `hashExternalId(ctx.externalId)` per-journey | ~ | not customer-keyed, not in Pixel (I5) |
| `user_data.fbp` / `fbc` | raw from context | ✓/~ | first-visit fbp absent (I10) |
| `user_data.client_ip_address` | raw from context, server-derived | ✓ | pinned at first create; IPv4 (I20) |
| `user_data.client_user_agent` | raw from context | ✓ | |
| `user_data.opt_out` | — | ✗ | I16 |
| `event_source_url` | `ctx.url` | ✓/~ | staleness/deep-link (I12) |
| `action_source` | `website` / `physical_store` | ✓ | orders:3213-3214 |
| `data_processing_options` | — | ✗ | US-state privacy; likely not needed for BD |
| `custom_data.value` | numeric order total | ✓ | required for Purchase; Lead omits (correct) |
| `custom_data.currency` | `BDT` ISO-4217 | ✓ | |
| `custom_data.content_ids` | product ids | ✓ | |
| `custom_data.content_type` | `product` | ✓ | |
| `custom_data.contents` | `{id, quantity, item_price}` | ✓ | correct Meta subfields |
| `custom_data.content_name` | browser ViewContent only | ~ | not on CAPI Purchase |
| `custom_data.content_category` | browser only | ~ | |
| `custom_data.num_items` | sent on Purchase/Refund too | ~ | InitiateCheckout-only per Meta (I2) |
| `custom_data.search_string` | never populated | ✗ | Search never fires (G6) |
| `custom_data.order_id` | `order.id` | ✓ | |
| `custom_data.status` | — | ✗ | optional |
| `custom_data.delivery_category` | — | ✗ | optional |
| `test_event_code` | gated by test_mode flag | ✓ | D10 fixed |

---

## 10. Missing Parameters

| Param | Why it matters | Recommendation |
|---|---|---|
| `user_data.external_id` (customer-keyed, in Pixel) | enables cross-session + Pixel↔CAPI dedup (I5) | customer-keyed stable external_id |
| `user_data.st` / `zp` on server events | EMQ (I3) | map `shippingAddress.district`→`st`, zip→`zp` |
| `user_data.ln` on thank-you Purchase | EMQ (I11) | split `name` into fn/ln |
| `custom_data.search_string` | Meta Search event param | only relevant if Search fires (G6) |
| `user_data.opt_out` | consent/compliance (I16) | send when user opted out |
| `event_source_url` freshness | attribution (I12) | sync context before the Purchase event |

Optional (skip): `ge`, `db`, `delivery_category`, `status`, `data_processing_options` (not applicable to BD).

---

## 11. Weak Parameters

| Param | Issue | Severity |
|---|---|---|
| `num_items` | sent on Purchase/Refund; Meta documents InitiateCheckout-only. Harmless but non-compliant. | Low |
| `external_id` | per-journey random — technically present, semantically weak. | High |
| `ln` | often missing on browser Purchase. | Low |
| `event_source_url` / `client_ip_address` | context-staleness (pinned at first sync; sync-after-Purchase race). | Medium |
| `event_time` | business-time (correct) but can be stale for validated Purchases dispatched late. | Medium |

---

## 12. Potentially Harmful Parameters

| Param | Why it may be harmful | Verdict |
|---|---|---|
| `value` negative on Refund-as-Purchase | Meta has no web Refund; a negative-value Purchase is a deliberate mapping. It may be excluded from some attribution views, but it correctly nets revenue. | Keep (documented), monitor ROAS. |
| `num_items` on non-InitiateCheckout | Meta may ignore; no harmful effect verified. | Low risk. |
| No `em`/`ph` at all (contact-less orders) | **Meta may reject the event as invalid** (too-broad combos). This is the only "harmful" payload state. | Fix with I1 guard. |

---

## 13. Recommended Improvements

Numbered issues (severity: High/Med/Low). Each includes evidence, risk, impact, root cause, and options.

### I1 — No em-or-ph guard → invalid-event risk [HIGH]
- **Evidence:** meta.adapter.ts:59-78 builds `user_data.em/ph` only if present; no guard; dispatcher:337 calls `build()` unconditionally; admin/POS orders can carry no email+no phone (order.dto.ts:28,41,42; orders.service.ts:3184-3192 → payload 3240-3241).
- **Risk:** Meta rejects events whose customer info is too broad (no em/ph) — verified invalid combos in Meta docs.
- **Impact:** dropped Purchase/Refund events for contact-less admin/POS orders. Data loss + under-reporting.
- **Root cause:** design assumed contact always present; no adapter-level validity guard.
- **Options:** (a) enforce in `MetaAdapter.build()` — if no em/ph, return `null` → dispatch `SKIPPED` with reason (pipeline already supports SKIPPED); (b) enrich at capture from order/context; (c) send the event anyway and flag in monitoring.
- **Recommended:** (a) — return `null`/`SKIPPED` when neither em nor ph resolves, surfacing in `TrackingDispatchEvent` and monitoring; optionally fall back to `external_id`+`fbp` when present (Meta's fbp/external_id matching does not require em/ph).
- **Trade-offs:** SKIPPED means the event never reaches Meta — but an invalid event would be dropped anyway, and the SKIPPED path is observable + replayable. **Backward compat:** safe (only affects previously-invalid events). **Regression risk:** low.

### I8 — No 48 h dedup-window guard [HIGH]
- **Evidence:** no event-age/dedup-window gate anywhere (grep verified); relay gated off by default (outbox-relay:167-174); Meta's 48 h window documented.
- **Risk:** instant-mode CAPI Purchase dispatched > 48 h after the Pixel event → Meta will not dedup → double-count or discard.
- **Impact:** revenue double-counting during relay-off/outage/backoff periods.
- **Root cause:** the pipeline was built for durability, not for Meta's dedup-window semantics.
- **Options:** (a) browser-confirmation marker — the browser mirror POST for Purchase returns DEDUPED; capture "browserEchoAt" and guard dispatch; (b) rely on `event_id` + monitor dedup rate; (c) enforce relay-on + freshness SLO.
- **Recommended:** minimal phase-3: record when a browser-confirmed Purchase mirror arrives, and skip/flag CAPI dispatch older than 48 h vs that marker; plus enable relay + add dedup-rate KPI. Full guard is complex because we cannot observe Meta's receipt time — the marker approach is the best local proxy.
- **Trade-offs:** marking DEDUPED can drop a legitimately-needed CAPI event if the Pixel was itself lost (ad blocker). **Regression risk:** must be gated to browser-confirmed instant purchases only.

### I5 — external_id per-journey, not customer-keyed, not in Pixel [HIGH]
- **Evidence:** context.service:43; update branch never touches it; fbq init has no external_id (F8/F9 verified).
- **Risk/Impact:** cross-session and Pixel↔CAPI identity impossible; `deleteByCustomerId` misses abandoned pre-order contexts; Meta's external_id arm unused.
- **Root cause:** Phase-1 shipped the journey-uuid fallback; customer-keying was documented as a known limitation.
- **Options:** (a) store a stable `externalId` on `CustomerProfile`, set at registration/checkout, propagated to `TrackingContext`; (b) derive a stable hash (e.g., sha256 of customer id) at capture; (c) keep per-journey (status quo).
- **Recommended:** (a) — customer-keyed external_id merged at checkout, with the journey-uuid as guest fallback; pass the SAME value to the Pixel via `fbq('init', id, { external_id })` and to CAPI (hashed). This unlocks Meta's external_id dedup and cross-device identity.
- **Trade-offs:** needs an identity-merge point (checkout sets customerId + externalId); guests remain per-journey. **Migration:** additive column/merge; backfill optional. **Rollback:** revert propagation, keep per-journey. **Regression risk:** low if the merge is only additive; monitor dedup-rate improvement.

### I9 — Relay OFF by default + no go-live gate [MEDIUM]
- **Evidence:** outbox-relay.service.ts:167-174; no seed for the flag.
- **Impact:** while off, ALL CAPI dispatch stalls (outbox rows sit PENDING); combined with I8, late dispatch breaks dedup.
- **Recommended:** go-live checklist (enable per-server), health KPI (PENDING count + max age), and a startup warning when the flag is off. Non-change in mechanism — change in operations.

### I16 — No consent / opt_out [HIGH if regulated]
- **Evidence:** no consent gate anywhere; no `opt_out` param (F24 verified).
- **Impact:** if the platform ever serves consent-regulated regions (GDPR), events are collected without a legal basis; Meta itself discards events under consent policies.
- **Recommended (deferred):** add an `opt_out` param plumbed from a consent signal, and a capture gate. For BD-only operation today, document as a known non-blocking gap.
- **Trade-off:** consent gate would reduce tracking coverage for opted-out users (expected). Regression risk: none if default is "tracking on" (current behavior).

### I2 — num_items on non-InitiateCheckout [LOW]
- **Evidence:** meta.adapter.ts:88 unconditional; orders:3234/3299; ThankYouContent:86.
- **Recommended:** restrict `num_items` to InitiateCheckout in the adapter (or accept as harmless). Non-blocking.

### I3 — server events lack zip/state [MEDIUM]
- **Evidence:** orders.service.ts:3239-3246 (no zip/state); :3304-3308 (Refund: phone/firstName/country only).
- **Recommended:** map `shippingAddress.district`→`st`, shipping zip→`zp`; Refund to carry city/country too. Small EMQ win.

### I11 — ln missing on browser Purchase [LOW]
- **Recommended:** split the single `name` into `firstName`/`lastName` before capture (normalizer already has `splitName`).

### I12 — context staleness / context-less deep links [MEDIUM]
- **Evidence:** ThankYouContent:104 then :107 (syncContext AFTER Purchase); deep-link thank-you may have no context.
- **Recommended:** move `syncContext()` before `trackEvent('Purchase')` on the thank-you; and ensure `/tracking/context` is called on checkout mount (it already is on every navigation). Long-term: context refresh at dispatch if missing.

### I7 — browser non-Purchase random event_id [MEDIUM]
- **Evidence:** tracking.ts:20-22,111.
- **Recommended:** journey-stable logical-action key (`eventType_ctxId_productId`) per the original design §4.12, so double-clicks/multi-tab collapse. Improves dedup-key usage (Meta's overlap metric).

### I13 — monitoring external_id metric always 0 [MEDIUM]
- **Evidence:** monitoring.service.ts:192-197 counts `payload.externalId`, which no capture writes (F21).
- **Recommended:** count `TrackingContext.externalId` rows (usage) instead; also surface the fbp/fbc coverage correctly.

### I14 — no Pixel↔CAPI coverage / dedup-rate KPI [MEDIUM]
- **Evidence:** monitoring endpoints are DB aggregates only (F22); Meta measures ≥75% coverage server-side.
- **Recommended:** add a mirror-beacon success proxy (browser mirror POST count vs snapshot count) and a dedup-rate estimate; the Meta-side dedup tab remains the authoritative view.

### I15 — Meta token in URL query string [MEDIUM]
- **Evidence:** meta.adapter.ts:121-123.
- **Recommended:** verify whether Meta accepts `Authorization: Bearer` for `/events` (it does for the broader Graph API); if so, move the token to the header; otherwise keep query-param and ensure infra logs redact the URL. Minimal change: document + redact logs.

### I6 — No Advanced Matching on the Pixel [MEDIUM]
- **Evidence:** fbq init with only pixel id (F9).
- **Recommended:** gated behind consent (I16): pass hashed `em`/`ph` to `fbq('init', …, {em, ph})` when known. Without a consent gate, adding AM increases PII exposure — so defer until I16 or add AM with the external_id change.

### I4 — validated Purchase `event_time` staleness [MEDIUM]
- **Evidence:** event_time = order.createdAt; validated Purchases can dispatch days later (orders:3209-3211; F7).
- **Impact:** an order validated 7+ days after creation sends an old `event_time`; Meta freshness expectations flag delay (Real Time..Weekly). 
- **Recommended:** document; for validated mode consider capping (skip if `event_time` too old) or accepting (Meta processes within its window). Non-blocking; monitor freshness KPI.

### I18 — SPA PageView once per hard load [LOW-MEDIUM]
- **Evidence:** TrackingScripts:60; no router hook (F26).
- **Recommended:** add a per-route `fbq('track','PageView')` on route change if per-page PageViews are desired (many apps intentionally avoid this to reduce noise). Non-change acceptable if page-view analytics via the buffer suffices.

### I20 — IPv4 / IP pinned at first context create [LOW]
- **Evidence:** context.service:45 (create only); F20.
- **Recommended:** refresh ip/ua on context update (currently never); verify `trustProxy` so `req.ip` is the client, not the proxy; support IPv6 (Meta diagnostic).

### I21 — Refund as negative-value Purchase — **KEEP** (non-change)
- Meta has no web Refund; a negative-value `Purchase` with distinct `refund_{orderId}` is a sound, documented mapping. Keep; monitor ROAS treatment.

### I22 — Search/AddPaymentInfo/CompleteRegistration/AddToWishlist never fire (G6) [MEDIUM]
- Coverage gap from Discovery. Recommended: implement call sites if those funnels matter; otherwise document as intentional.

---

## 14. Recommended Non-Changes (keep current implementation)

| Design | Why it stays | Why it's superior to a naive "Meta-recommended" approach |
|---|---|---|
| Transactional outbox + snapshot (DB = truth) | Proven reliable; survives Redis/queue outage | Meta's fire-and-forget SDK pattern loses events; our outbox never does |
| Capture inside business `$transaction` | atomic, idempotent | never fails the order |
| SKIP-LOCKED relay + per-attempt job ids | multi-instance safe, no job-id collision | simpler approaches double-enqueue |
| Work-set rule (never re-run SENT/SKIPPED/DEDUPED) | required for GA4/Google Ads double-send prevention | Meta generic guidance doesn't cover multi-provider |
| Single normalizer (one hashing path) | Meta-correct, one edit per rule change | duplicated hashing was the legacy defect (D5) |
| Provider independence (`allSettled`) | one provider's failure never blocks others | generic guidance would couple providers |
| Deterministic order `event_id` (purchase_/refund_/lead_) | capture-once + Meta dedup | matches Meta best practice exactly |
| Retry/replay reuse same `event_id` | provider-side dedup absorbs duplicates | correct |
| PII-stripped ReplayArchive + version pinning | 2-yr replay vs 90-d retention | beyond Meta's own tooling |
| Gated `test_event_code` | stale code can't leak to prod | D10 fix, superior to raw pass-through |
| `action_source` website/physical_store | correct per channel | |
| Refund-as-negative-Purchase | documented, dedup-safe | |

---

## 15. Architecture Improvements (proposed, not implemented)

1. **Customer-keyed `external_id` (I5)** — the central identity improvement. Store on `CustomerProfile`, propagate to `TrackingContext` at checkout/auth, share with Pixel `fbq('init', …, {external_id})`, hash in CAPI. Guests keep journey-uuid. Unlocks cross-session dedup + `deleteByCustomerId` coverage.
2. **em-or-ph validity guard (I1)** — adapter returns `null`/`SKIPPED` when no identity signal resolves; surface in monitoring. Optionally fall back to `external_id`/`fbp` matching.
3. **48 h dedup-window guard (I8)** — browser-confirmation marker + age guard on instant-mode CAPI Purchase; enable relay as the primary mitigation.
4. **Consent/`opt_out` (I16)** — capture a consent flag; gate capture and/or set `opt_out`; required before any regulated region or Advanced Matching.
5. **Payload enrichment (I3/I11)** — zip/state/ln from order/shipping + `splitName`; cheap EMQ win.

## 16. Performance Improvements

| Item | Change | Impact |
|---|---|---|
| Adapter registry | hoist `buildAdapterRegistry()` to a module-level const (currently rebuilt per dispatch job) | small latency win under load |
| BullMQ worker concurrency | set explicit `concurrency` on the `tracking` processor (currently default 1 per instance) | higher throughput on dispatcher instances |
| Relay batch | `batchSize` config (already param) — tune with load | freshness SLO |
| Monitoring aggregates | move heavy histogram/top-failure to a nightly rollup (design anticipated) | dashboard latency |

## 17. Reliability Improvements

| Item | Change |
|---|---|
| Go-live gate | enable relay per-server with a startup warning when off (I9) |
| Health KPI | PENDING-count + max-age alert (stalled pipeline detection) |
| DEAD alerting | alert on DEAD count growth (currently DB-only visibility) |
| Context refresh | refresh `ip`/`userAgent` on context update (I20) |
| Freshness SLO | capture→dispatch avg+p95 alert (already measurable) |

## 18. Monitoring Improvements

- **Fix I13:** `external_id` dedup metric → count `TrackingContext.externalId` usage; add `fbp`/`fbc` coverage correctly.
- **Add I14:** mirror-beacon success (browser mirror vs snapshot) and a dedup-rate proxy; reference Meta's Events Manager dedup tab as the authoritative view.
- **Add:** per-event-type freshness (capture→dispatch) already exists; add event-age-at-dispatch to surface I4/I8.

## 19. Production Hardening Recommendations

1. **Enable relay deliberately** (I9) with a go-live checklist; never ship with outbox rows accumulating silently.
2. **Token handling (I15):** move Meta token to `Authorization: Bearer` if Meta accepts it for `/events`; else keep query-param and redact infra logs.
3. **`trustProxy`/IPv6 (I20):** ensure client IP is the real client; accept IPv6.
4. **Staging certification:** before enabling relay in prod, run Test Events + Payload Helper on staging; verify dedup-rate and EMQ ≥ 6.0 for Purchase/Refund.
5. **Consent (I16):** if any regulated region is in scope, gate capture before collecting further.
6. **Document validated-mode staleness (I4)** and order-edit immutability as known limitations.

## 20. Prioritized Action Plan

| Priority | Item | Why now | Effort |
|---|---|---|---|
| P0 | I1 em-or-ph guard | prevents dropped events for contact-less orders | S |
| P0 | I9 relay go-live gate + PENDING health alert | prevents silent stall + late-dispatch dedup break (I8) | S |
| P0 | I15 token handling | security | S |
| P0 | I13/I14 monitoring metric fix + coverage proxy | observe the pipeline before scaling | S-M |
| P1 | I5 customer-keyed external_id (+ Pixel share) | highest identity/dedup leverage | M-L |
| P1 | I8 48 h dedup guard (browser-confirmed marker) | revenue double-count protection | M |
| P2 | I3 zip/state + I11 ln + I12 sync-before-Purchase | EMQ wins | S |
| P2 | I7 journey-stable browser event_id | dedup-key usage/overlap | M |
| P3 | I16 consent/opt_out (if regulated) | compliance | M-L |
| P3 | I6 Advanced Matching (gated behind consent) | browser EMQ | M |
| P4 | I2 num_items scoping; I18 SPA PageView; I20 IPv6/IP refresh | hygiene | S |
| P4 | I16-adjacent monitoring rollup, registry hoist, worker concurrency | perf/scale | S |

**Legend:** S ≤ 1 day, M 1–3 days, L 3–7 days (implementation phase, not this audit).

---

## Appendix — Verification log

All findings were independently re-verified by four subagents against the code, with the Meta doc facts supplied inline. Verdicts: F1–F15, F17, F19–F27 CONFIRMED; F16 PARTIAL (Google Ads has an `order_id`-based dedup key — corrected in §7); F18 PARTIAL (invalid-combination risk confirmed for admin/POS no-contact orders, refuted for leads — `fireLeadEvent` returns early without a phone). No code was modified.
