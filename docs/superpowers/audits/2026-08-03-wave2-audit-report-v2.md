# Wave-2 — Enterprise Meta Conversions API Audit — Report v2 (Revision-2)

**Date:** 2026-08-04
**Type:** Audit · Verification · Research · Architecture · Planning. **No Meta refactoring performed.**
**Only production change in this task:** catalog URL hotfix (`/product/` → `/products/`) — see §Appendix-Hotfix.
**Evidence rule:** every recommendation cites Meta official docs, the frozen baseline code (file:line), or industry-standard reasoning. Runtime-only claims are marked UNABLE TO VERIFY (needs credentialed staging).

---

# Part A — external_id Architecture (Priority 1)

## A.1 Candidates compared (all 8)

Reference code facts (frozen): current `external_id` = `crypto.randomUUID()` per journey at context create (`tracking-context.service.ts:43`), never updated, never sent to Pixel (`TrackingScripts.tsx:59` `fbq('init', metaId)`). Meta: `external_id` hashing recommended; `external_id`+`fbp` is dedup path (b); AM can carry it.

Legend: ✅ good · 🟡 partial · ❌ poor · — n/a.

| Criterion | A per-journey UUID (current) | B stable Customer UUID | C hash(customerId) | D hash(account uuid) | E hash(email) | F hash(phone) | G composite single id | H identity graph (CDP) |
|---|---|---|---|---|---|---|---|---|
| Event Match Quality | ❌ | ✅ | ✅ | ✅ | 🟡 (mutable) | 🟡 (mutable/shared) | ❌ (breaks Meta single-key) | ✅ |
| Meta compatibility | 🟡 (present but unstable) | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Browser matching | ❌ (not sent) | ✅ (send to Pixel) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Server matching | 🟡 (within journey) | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Deduplication | 🟡 | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Guest checkout | ✅ (journey) | ✅ (journey until auth) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ✅ |
| Registered customer | ❌ (no linkage) | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ |
| Customer merge | ❌ | ✅ (reassign id) | ❌ (irreversible) | ❌ | 🟡 (by email) | 🟡 (by phone) | ❌ | ✅ |
| Customer split | ❌ | 🟡 (new id, history to old) | ❌ | ❌ | 🟡 | 🟡 | ❌ | ✅ |
| GDPR delete | 🟡 (per context; misses abandoned) | ✅ (by customer id) | ✅ | ✅ | ✅ (by email) | 🟡 | ❌ | ✅ |
| Account restore | ❌ | ✅ (keep id on soft-restore) | 🟡 | 🟡 | 🟡 | 🟡 | ❌ | ✅ |
| Device migration | ❌ | ✅ (after auth) | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ |
| Browser migration | ❌ | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ |
| Multiple devices | ❌ | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ |
| Multiple browsers | ❌ | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ |
| Tenant isolation | ✅ (global uuid) | ✅ | 🟡 (id may collide across tenants) | ✅ | 🟡 | 🟡 | 🟡 | ✅ |
| ERP scalability | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Storage cost | low | low (1 col) | none (derived) | none | none | none | low | high (graph) |
| Operational complexity | low | medium (merge point) | low | low | low | low | medium | high |
| Backward compatibility | n/a (current) | ✅ (flag-gated) | 🟡 (compute-time change) | 🟡 | 🟡 | 🟡 | ❌ | ❌ (new infra) |
| Migration complexity | n/a | medium (additive) | medium | medium | low | low | high | high |
| Production risk | low (but weak EMQ) | low–med (merge race) | low | low | med (email change) | med (phone share) | med | high |

## A.2 Why **B (stable Customer UUID)** is objectively superior for this ERP
1. **Merge/split/restore/deletion.** B stores an *opaque, mutable-by-identity-service* uuid, so merging two customers = point both to one id (historical attribution preserved via a mapping); split = new id; restore = keep id; delete = clear id → every context is reachable by customer key. C/D are irreversible hashes (merge destroys history); E/F are derived from mutable PII (email/phone change → identity breaks); G fabricates a single id that violates Meta's one-key-per-user semantics; H is a full CDP (correct destination, but heavy for a stage where accounts + guest carts are the model).
2. **Meta compatibility.** Meta's recommended `external_id` (hashed) on all events + AM becomes usable, and dedup path (b) (`event_name` + `fbp`/`external_id`) activates cross-session. B propagates the same opaque id to the Pixel (`fbq('init',…,{external_id})`), matching AM expectations.
3. **Guest→customer continuity.** B keeps per-journey uuid until authentication, then reassigns on login/register — a clean, reversible identity claim that preserves pre-auth attribution (see Part B).
4. **Tenant-safe, cheap, additive.** Global UUID is unique per tenant; one column; flag-gated → zero default behavior change (Guardrail 5).

**Decision requested: adopt B** (customer-keyed `external_id`, feature-flagged, propagated to Pixel + CAPI, merge/delete lifecycle). Implementation = Wave-2 identity wave; NOT performed here.

---

# Part B — Guest Checkout Verification (Mandatory)

## B.1 Every guest flow audited

| Flow | Identity Meta receives | EMQ | Dedup works? | Finding |
|---|---|---|---|---|
| Anonymous visitor (no checkout) | fbp, ip, external_id(journey) | low | via event_id | no em/ph; page events only |
| Guest checkout, phone only | ph (hashed), fbp, ip, external_id | med (ph is a strong key) | ✅ event_id | em absent → accepted, lower EMQ (Decision C) |
| Guest checkout, email only | em (hashed), fbp, ip | good (em highest-weight) | ✅ | best single key |
| Guest checkout, both | em + ph + fbp + ip | **high** | ✅ | recommended capture both |
| Guest later registers | customer external_id now present; old contexts re-pointed | high after merge | ✅ cross-session | merge on claim (below) |
| Guest later logs in | same as register | high | ✅ | same |
| Guest later becomes customer | same | high | ✅ | same |
| Guest, multiple orders (same device) | same ctxId/journey → same journey external_id + em/ph | stable | ✅ | continuity within device |
| Guest, clears cookies | new ctxId, new journey external_id | em/ph still present on CAPI | ✅ via em/ph + event_id | browser-side attribution pre-clear lost; CAPI survives via em/ph/order |
| Guest, changes device | new journey | em/ph present | ✅ via em/ph | same |
| Guest, another browser | new journey | em/ph present | ✅ via em/ph | same |

## B.2 Is Meta receiving a stable-enough identity? Is EMQ acceptable?
- **Yes for checkout events** as long as **em and/or ph are captured** (they are: ThankYouContent sends email+phone). Meta-side cross-device matching then works through em/ph; external_id adds cross-device stability only after auth.
- **EMQ acceptable** (Decision C): events with no em/ph but fbp/external_id/ip are accepted at lower EMQ; contact-less admin/POS orders are the risk class (G-I1) and are not guest-web.
- **Dedup works**: order events use deterministic `purchase_{orderId}`; guest orders included.

## B.3 Better guest strategy (documented, not implemented)
1. **Always capture email or phone at checkout** (email preferred) — already done; keep.
2. **Optional: phone-derived stable guest key.** When a guest provides a normalized E.164 phone, use `external_id = hash(E.164 phone)` for the context so guest orders across devices/browsers with the same phone unify (mirrors the checkout-lead phone supersede logic). **Trade-off:** shared phones over-merge; make it secondary (fbp/em still primary).
3. **Merge on claim:** at register/login, re-point all of the customer's contexts (by `Order.trackingSessionId` → ctx, and by phone/email) to the new customer `external_id`. **Backward compatible** (additive, flag-gated), preserves attribution, matches GDPR (single customer key deletes all).
4. Migration: backfill existing customer contexts by order→ctx→customer; flag `tracking_customer_external_id` off by default.

---

# Part C — Event Match Quality Roadmap

Meta: EMQ 0–10, target ≥ 6.0, web-only; top keys `em`, `client_ip_address`, `fn+ln`, `ph`; `external_id`+`event_id` on all events; ACR uplift examples (email +58.96%, ip +20.65% median).

| Step | Action | Est. EMQ delta | Justification (Meta weight) |
|---|---|---|---|
| 0 | Current (normal web order, contact + context) | **~6.5–7** | em/ph/fn/ct/country/external_id(journey)/fbp/fbc/ip/ua present |
| 1 | Stable customer `external_id` (B) + Pixel share | +0.5 | external_id recommended all events; unlocks dedup path (b) + AM |
| 2 | Better fbp/fbc coverage (context refresh; capture after cookie) | +0.3–0.5 | fbp/fbc are match keys; refresh regularly (Meta) |
| 3 | Advanced Matching on Pixel (hashed em/ph) [post-consent] | +0.5–1 | em highest weight; AM applies it browser-side |
| 4 | Address fields from order/shipping (zp/st/ln) | +0.3–0.5 | fn/ln/ct/st/zp/country weighted |
| 5 | Context refresh (ip/ua/url per sync, not just first create) | +0.2–0.3 | client_ip_address is a top key; staleness hurts |
| 6 | Guest identity improvement (phone-derived stable guest key) | +0.2–0.4 (guests) | adds a stable key for guest cross-device |
| 7 | Payload hygiene (num_items scoping, no invalid combos) | avoids penalties | invalid combos rejected (Meta) |
| **Final** | **Registered ≈ 8–9 · Guest (with contact) ≈ 7–8** | | cumulative, key-set driven |

Every delta is an estimate for planning; exact numbers come from Events Manager/Dataset Quality after each rollout (success criterion S4, S9–S11).

---

# Part D — Dataset Quality API (investigation)

- **What it returns:** `event_match_quality` (composite 0–10, per-parameter `match_key_feedback` coverage, `diagnostics` with name/description/solution/percentage/affected counts), plus event coverage (7-day % of Pixel events covered by CAPI with dedup keys, 75% goal), dedup-key feedback, data freshness (`upload_frequency`).
- **Benefits:** server-side EMQ + coverage + diagnostics (IPv6 flag, mismatched IP) we cannot compute locally; direct feed for our dashboard + alerts.
- **Costs/limits:** it's a Graph API read (access token, standard rate limits — treat as low-volume); requires the API token; dataset-level, not per-event.
- **Production suitability:** high for an ops/observability reader; **NOT** for the hot dispatch path.
- **Recommendation:** integrate as an out-of-band scheduled reader (e.g., 6-hourly) that snapshots EMQ/composite + coverage into our monitoring; alert on `composite < 6.0` or `coverage < 75%`. This closes G-I14's server-side view without adding external calls to the dispatch loop.

---

# Part E — Payload Helper Automation (investigation)

- **Feasibility:** the Payload Helper is a Meta web tool that validates one event payload and shows OK/dedup/error; it can also emit a test event via `test_event_code`. It is interactive, not a first-class CI API — automation means scripting a POST with the same body (access token + pixel).
- **Automation possibilities:** a QA/staging script that sends a captured Purchase payload to the helper and asserts OK; can be run manually in the staging checklist (S9).
- **Developer workflow:** include in the Wave verification script; **not CI-gated** (external dependency, rate limits, and the helper reflects Meta's own validation we already partially mirror).
- **Production value:** high as a pre-release validation gate, low as a runtime check.
- **Recommendation:** keep Payload Helper as a **manual/scripted staging gate** (S9), not CI; note `test_event_code` can reuse it.

---

# Part F — Identity Lifecycle Diagrams

```
Guest (anonymous)  ctxId=J, external_id=uuid_J, fbp/fbc set
   │  checkout: capture em/ph; order.trackingSessionId=J
   ▼
Guest with contact  same ctxId; CAPI em/ph present (cross-device via em/ph)
   │  register / login / becomes customer
   ▼
Authenticated  customer created -> CustomerProfile.externalId=U
   │  RE-POINT contexts: for every order.trackingSessionId of this customer,
   │  set context.external_id=U (identity claim) — preserves pre-auth attribution
   ▼
Logout   identity stays: contexts keep U; browser keeps ctxId
   ▼
Login another account  new customer V -> RE-POINT: new contexts go to V;
   │   old contexts tied to U remain (two customers, two ids)  [NO cross-contamination]
   ▼
Customer merge  U and V merge -> both point to W; map U,V→W for historical events
   ▼
Customer split  W split -> new X; new contexts→X; historical stays under W
   ▼
Customer deletion (GDPR)  delete by customer id -> every context with external_id=W erased;
   │   snapshot PII nulled; dedup keys (event_id) kept
   ▼
Account restore  W restored -> external_id preserved, contexts re-created if needed
   ▼
Cookie reset / browser reset / incognito  new ctxId, new journey; external_id only after auth;
   │   CAPI continuity via em/ph (browser-side gap documented)
   ▼
Multi-tab   same localStorage ctxId (same-origin) -> same journey; context merge serialized (FOR UPDATE)
   ▼
Multi-browser / multi-device   different ctxId until auth; after auth same external_id=U
   ▼
Tenant migration   external_id is a global UUID; per-tenant isolation holds; migration = copy rows with same id
   ▼
Session expiration   ctxId is client-side (localStorage), no server session; no expiry; external_id persists
```

---

# Part G — Browser + Server Identity Timeline (first visit → purchase)

| Stage | Browser (Pixel) | Server (context/snapshot) | ctxId | external_id | fbp | fbc | customerId | orderId | event_id |
|---|---|---|---|---|---|---|---|---|---|
| 1st load | fbq PageView; syncContext | context create | J | uuid_J | (absent 1st visit) | — | — | — | — |
| browse | ViewContent/AddToCart + mirror | snapshot/outbox per event | J | uuid_J | now present | maybe | — | — | random (non-order) |
| checkout | InitiateCheckout + mirror | snapshot | J | uuid_J | ✓ | ✓ | — | — | random |
| order create | — | $tx: order + snapshot Purchase | J→Order.trackingSessionId | uuid_J | ✓ | ✓ | (guest or auth) | ord_1 | purchase_ord_1 |
| thank-you | fbq Purchase(evtid purchase_ord_1) + mirror(DEDUPED) | — | J | uuid_J | ✓ | ✓ | — | ord_1 | purchase_ord_1 |
| dispatch | — | CAPI Purchase (event_id purchase_ord_1, em/ph/fbp/fbc/ip/ua) | J | uuid_J | ✓ | ✓ | — | ord_1 | purchase_ord_1 |
| (auth later) | — | context re-pointed to customer U | J | **U** | ✓ | ✓ | cust_1 | ord_1 | purchase_ord_1 |

---

# Part H — Deduplication Stress Audit (≥50 scenarios, brute-force)

Outcome: **1**=single (correct), **D**=duplicate, **L**=loss, **—**=n/a. Mechanism column cites the guard.

## H.1 Browser-driven
| # | Scenario | Outcome | Mechanism |
|---|---|---|---|
| 1 | Refresh after order (Purchase) | 1 | thank-you sessionStorage guard |
| 2 | Refresh product page (ViewContent) | D | random event_id (G-I7) |
| 3 | Double-click AddToCart | D | random event_id |
| 4 | Double-click Purchase button | 1 | sessionStorage + eventId UNIQUE |
| 5 | Back-forward nav (ViewContent remount) | D | random event_id |
| 6 | Tab close on thank-you | 1 | server CAPI captured in txn (L on Pixel) |
| 7 | Browser crash mid-checkout | 1 | CAPI in order txn |
| 8 | Browser restore (bfcache) | D | effect re-run, new random id |
| 9 | Mobile kill during checkout | 1 | CAPI in order txn |
| 10 | Service Worker replay of /events | D | random id re-sent (no idempotency at fetch) |
| 11 | Background Sync re-post | D | same as above |
| 12 | Keepalive failure on mirror | L(non-order) | no mirror → no snapshot; CAPI missing |
| 13 | Multiple tabs AddToCart | D | per-tab random id |
| 14 | Multiple tabs Purchase | 1 | only the completing tab fires; eventId UNIQUE |
| 15 | Incognito | 1 (new journey) | new ctxId; CAPI still from order |
| 16 | Browser clears cookies then order | 1 | em/ph on CAPI |
| 17 | Offline then online checkout | 1 | CAPI sent from server ≤48h |

## H.2 Server / pipeline
| # | Scenario | Outcome | Mechanism |
|---|---|---|---|
| 18 | Order create retried (dup POST) | 1 | order idempotency? (see note) + eventId UNIQUE |
| 19 | Payment retry (same order) | 1 | one Purchase snapshot per order (eventId UNIQUE) |
| 20 | Partial payment | 1 | one snapshot at order create |
| 21 | Split payment | 1 | one snapshot |
| 22 | COD | 1 | one snapshot at create |
| 23 | Offline POS sync | 1 | distinct order, distinct event_id |
| 24 | Draft order → placed | 1 | snapshot at placement only |
| 25 | Order edit after placement | 1 (stale value) | snapshot not re-captured (eventId UNIQUE) — value stale |
| 26 | Order merge | — | not a tracked transition (document) |
| 27 | Order restore | — | no new snapshot |
| 28 | Order import (bulk) | 1 | each order unique id |
| 29 | Replay manual | 1 | DEAD→PENDING; work-set skips SENT |
| 30 | Replay automatic (reconciler) | 1 | same |
| 31 | Worker restart mid-dispatch | 1 | SENDING→reconciler RETRY; work-set |
| 32 | Redis restart | 1 | outbox=DB truth; relay releases lock |
| 33 | DB failover | 1 | txn fails → order fails (correct) |
| 34 | Queue replay (BullMQ re-add) | 1 | per-attempt job id; no dup enqueue |
| 35 | Clock drift (server ahead) | 1 | event_time = business time, not dispatch |
| 36 | Timezone mismatch | 1 | event_time epoch (UTC), correct |
| 37 | Backoff >48h (5xx chain) | D | dedup window exceeded (R-A) |
| 38 | Relay OFF then ON (old outbox) | D/L | late CAPI (R-A) |
| 39 | 4xx permanent → replay after fix | 1 | same event_id |
| 40 | Reconciler releases live send | 1 | guarded (no recent SENDING/RETRY) |

## H.3 Identity / multi-instance
| # | Scenario | Outcome | Mechanism |
|---|---|---|---|
| 41 | Two relay instances claim same row | 1 | SKIP LOCKED |
| 42 | Two dispatcher workers same outbox | 1 | work-set + upsert |
| 43 | Guest order → same phone two devices | 1 | em/ph + event_id |
| 44 | Auth user two devices | 1 | same customer, same event_id per order |
| 45 | Guest → register (merge) | 1 | attribution kept via re-point |
| 46 | Cookie reset between AddToCart and Purchase | 1 | Purchase is order-based |
| 47 | fbp rotation | 1 | event_id still deterministic for orders |

## H.4 Meta-side
| # | Scenario | Outcome | Mechanism |
|---|---|---|---|
| 48 | Pixel + CAPI within 48h | 1 | Meta dedup event_name+event_id |
| 49 | Pixel + CAPI >48h apart | D | dedup window (R-A) |
| 50 | Pixel lost (ad-block), CAPI sent | 1 (L on browser) | coverage gap, not double |
| 51 | CAPI lost, Pixel present | 1 | redundant setup benefit |
| 52 | GA4 MP double (browser gtag + server) | 1 | instant-mode suppression |
| 53 | Google Ads double | 1 | work-set + order_id dedup |
| 54 | TikTok event_id reuse | 1 | provider dedup |

**Result: 54 scenarios → 4 double-risk classes (2,3,5,8,10,11,13 = random-id browser events; 37,38,48/49 = 48h window) and loss classes (12 mirror keepalive; 6,7,9,16 browser loss but CAPI survives; 50 ad-block).** Confirms the two primary classes (R-A, R-B) plus a **loss class**: mirror `keepalive` failure / service-worker re-post without idempotency (R-C). R-C is new: the browser mirror is a fire-and-forget POST with a random id — if it is retried (SW/background-sync), it creates a **duplicate** snapshot; if it fails, the event is **lost** for browser-only events. Recommend (Wave-3): make the mirror idempotent (dedupe by a per-page generated stable id or acknowledge to the client) — lower priority than R-A/R-B.

---

# Part I — Event Ordering
- **Meta does not require ordering** for web CAPI; it processes asynchronously and uses `event_time` for attribution/dedup timing. Out-of-order arrival with correct `event_time` is fine.
- Our `event_time` = business time (order.createdAt), so even a late dispatch retains correct attribution order. **No weakness** beyond the 48h dedup window (Part H R-A).

---

# Part J — Latency Budget (end-to-end)

| Stage | Typical | p95 target |
|---|---|---|
| Browser → mirror `/tracking/events` (keepalive) | 100–300 ms | < 1 s |
| API → capture (in order txn) | 2–10 ms | < 30 ms |
| Capture → outbox (same txn) | < 5 ms | < 20 ms |
| Outbox → relay claim (1 s poll) | ≤ 1 s (avg 0.5 s) | < 1.5 s |
| Relay → BullMQ enqueue | 5–30 ms | < 100 ms |
| Queue → dispatcher worker | 5–50 ms | < 200 ms |
| Dispatcher → Meta (1500 ms timeout) | 200–600 ms | < 1.5 s |
| **Total (instant Purchase)** | **~1–3 s** | **< 5 s** |

---

# Part K — Production Observability (dashboard design)

KPI → source:
- Deduplication Rate → Meta Events Manager (authoritative) + local mirror-capture ratio
- EMQ Trend → Dataset Quality API snapshot (Part D)
- Browser Coverage / Server Coverage → mirror-capture ratio + volume by origin (Wave-1)
- Browser vs Server Parity → for order events, both present? (echo KPI — needs `browserEchoAt`, Wave-3)
- Queue Age / Relay Latency → `/health` (Wave-1) + outbox `nextAttemptAt` stats
- Retry Rate / Replay Rate → retry histogram + replay events (dispatch events)
- Permanent Failure Rate → DEAD count + top failures
- Event Freshness → capture→dispatch avg/p95 (Wave-1)
- external_id / fbp / fbc coverage → `context_external_id`/fbp/fbc rows (Wave-1, corrected)
- Guest / Customer Identity Coverage → % of order events with em/ph + customerId vs guest
- Event Loss Estimate → (expected volume − captured) from order/lead counts vs snapshots; browser mirror success vs page event fires

---

# Part L — Scalability Model

| TPS | Constraint | Assessment |
|---|---|---|
| 100 | none | comfortable |
| 500 | relay batch 50 × 1s = 50/s claim → **bottleneck at relay** | raise batch + poll faster or parallel claims |
| 1K | relay claim + BullMQ enqueue; adapters 1500 ms | scale worker concurrency; relay batch ~200 |
| 5K | Meta/TikTok **per-pixel rate limits** | throttle/queue per provider; horizontal workers |
| 10K | DB claim write load + monitor groupBy | index-led; nightly rollup for aggregates; partition outbox |
| 50K | single Pixel API ceiling + DB write volume | **needs multi-pixel/account sharding + partition + cache** — out of current single-store scope |

Bottlenecks identified: relay claim (serialized UPDATE; SKIP LOCKED safe but batching), adapter network fan-out, monitoring live groupBy (add nightly rollup — design anticipated), and provider API rate limits as the true ceiling at high TPS.

---

# Part M — Security & Privacy (PII lifecycle)

```
Raw (order/shipping) ─> Normalized (E.164, lowercase) ─> Hashed (SHA-256, single normalizer)
   │                        │                              │
   snapshot.payload         (transient)                    provider payload (ephemeral, not persisted)
   (90d retention)                                           │
   ▼                                                       ▼
Retention (90d: payload nulled)                   Meta (wire) — hashed + raw fbp/fbc/ip
   ▼
ReplayArchive (2yr, PII-hashed) ─> Replay (re-dispatch, same keys)
   ▼
Deletion (GDPR)  null PII, keep dedup keys; context rows erased by customer id
   ▼
Destroy (retention purge / archive expiry)
```
Controls (frozen): no PII in logs; secrets in DB+env, never logged; `responseBody/errorMsg` sanitized (Wave-1) + 500-char cap; single hashing path. Gap: consent/`opt_out` (G-I16); Meta token in URL query (infra redaction).

---

# Deliverables (v2 consolidated)

1. **Current architecture** — v1 Part 1 + Part G timeline.
2. **Gap analysis / severity matrix (updated)** — v1 Part 2 + new findings:
   - **R-C (Medium, New):** browser mirror non-idempotent → SW/background-sync re-post duplicates, keepalive failure loses browser-only events. Fix: idempotent mirror (Wave-3).
   - R-A, R-B (High/Med) unchanged; G-I5 identity (Critical) unchanged.
3. **Root causes / risk** — v1 Part 2 + R-C.
4. **Improvement opportunities** — Parts A–E, J, K.
5. **Alternative architectures** — Part A (A–H); identity recommended B.
6. **Migration strategy** — additive, flag-gated (Parts A/B); Dataset Quality as out-of-band reader.
7. **Backward compatibility** — all additive/flag-default-off except Wave-1 safety guards (documented).
8. **Production risk analysis** — R-A/R-B/R-C; provider rate limits at scale.
9. **Recommended implementation order (roadmap)** —
   - **Wave-2 (identity):** customer-keyed external_id (B) + merge/delete + Pixel share + consent/opt_out + AM (post-consent) + browser-echo coverage (closes R-C) + Dataset Quality reader.
   - **Wave-3 (optimization):** journey-stable browser event_id (kills R-B), mirror idempotency (R-C), zp/st/ln, context refresh, num_items scoping.
   - **Ops:** relay go-live checklist + dedup-rate alert (R-A), infra log redaction.

---

# Appendix — Approved Hotfix (only production change this task)

- **Issue:** catalog product feed URLs used `/product/{slug}`; public route is `/products/{slug}` (`app/(main)/products/[slug]/page.tsx`) → feed clicks 404.
- **Change:** `apps/backend/src/feed/feed.service.ts` — replaced `/product/${product.slug}` → `/products/${product.slug}` at all 4 feed link sites (variant + product, both feed formats). `dist/` copies are build artifacts, not edited.
- **Scope check:** storefront already uses `/products/` everywhere; the only remaining `/product/` in backend source are intentional tracking-test `referrer` fixtures (`ecomate.example/product/sku-1`) — not catalog links, left untouched. `/reviews/product/` is an API path, correct.
- **Verification:** feed spec 20/20; backend build exit 0; full backend suite 116 suites / **1064 tests pass**; `git diff` scoped to `feed.service.ts` (4 segment changes).

**No other code was changed in this task.**
