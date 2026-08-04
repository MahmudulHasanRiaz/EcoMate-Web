# Wave-2 — Enterprise Meta Conversions API Architecture Audit, Gap Analysis & Hardening Plan

**Date:** 2026-08-04
**Type:** Audit + Planning. **No code changed in this phase.**
**Baseline (all architect-approved/frozen):** Architecture Discovery · Browser Runtime (2A) · Server Runtime Trace (2A.5) · Compliance Audit (Phase 2) · Architect Decision Addendum (A–G, Guardrails, Success Criteria) · Wave-1 (corrected, verified).
**References:** Meta official docs (Conversions API Overview, Parameters, Best Practices, Verifying Setup, Dataset Quality API, Dedup Pixel↔CAPI, custom_data) captured verbatim in the Compliance Audit; the frozen baseline for code evidence.

Everything below is either from the verified/frozen baseline, from the actual code (file:line cited), or Meta official guidance (cited). Runtime-only unknowns are marked UNABLE TO VERIFY (needs credentialed staging).

---

# Part 1 — Current Architecture Audit (Phase 1)

> Document: event generation, browser lifecycle, server lifecycle, dispatcher, queue, retry, monitoring, diagnostics, identity generation, event ids, customer ids, cookie handling, session handling, payload generation, dispatch timing, failure handling.

## 1.1 Flow map (verified in phases 2A/2A.5)

```
Browser (storefront)
  ctxId (localStorage ecomate_ctx_id) + syncContext() -> POST /tracking/context
  trackEvent(E, data, userData, eventId?)
    fbq('track',E,data,{eventID}) + ttq.track + gtag   (third-party)
    POST /tracking/events (mirror, same-origin /api rewrite, keepalive)
  order-create carries trackingSessionId = ctxId
Backend
  prisma.$transaction [ business mutation + TrackingCaptureService.capture() ]
    TrackingSnapshot(eventId UNIQUE, skipDuplicates) + TrackingOutbox(priority 10 Purchase/Refund else 0)
  OutboxRelayService  raw SQL CLAIM ... FOR UPDATE SKIP LOCKED (1s, batch 50)
    gate: tracking_relay_enabled === 'true'  (OFF by default)  [+ 7-day age guard]
    enqueue BullMQ 'tracking'  jobId=${outboxId}-${attemptCount}
  TrackingDispatcher  work-set PENDING/SENDING/RETRY; Promise.allSettled
    adapter.build(snapshot, ctx, normalizer, opts) -> payload; adapter.send(payload, cfg)
    outbox terminal ALL_SENT: SENT | zero-eligible NOOP | DEAD(4xx/age/retries)
    DEAD -> DLQ mirror + ReplayArchive(PII-stripped)
  TrackingDispatchEvent (append-only) every transition
  Reconciler (60s) stale CLAIMED->PENDING, hung SENDING->RETRY
  ReplayService DEAD->PENDING (relay sole enqueuer)
  RetentionCleanup (6h) 90d anonymize / 30d outbox / 365d dispatch / 730d archive+purge
  Deletion admin externalId/customerId
  Monitoring  /health (relay/redis/queue/dispatcher) + overview/failures/freshness/dedup/mirror-capture/timeline
```

## 1.2 Layer-by-layer (evidence cited)

- **Event generation:** two paths — server-authoritative transactional (Purchase/Refund/Lead via `orders.service.ts:3218/3280`, `checkout-leads.ts:219/497`), browser-origin mirror (`tracking.controller.ts` POST /events). PageView is analytics-only (`page-view-buffer`), excluded from CAPI.
- **Browser lifecycle (2A):** lazyOnload boot (fbq stub synchronous), init `fbq('init',metaId)` no external_id/no AM, `trackEvent` queue-buffer + flush, mirror + Pixel + gtag fan-out; thank-you fires Purchase *then* syncContext (2A C6).
- **Server lifecycle (2A.5):** capture -> snapshot/outbox -> relay claim -> BullMQ -> dispatcher -> adapters -> dispatch rows -> outbox terminal; retry/replay/DEAD traces defined.
- **Identity generation:** `TrackingContext.externalId = crypto.randomUUID()` per-journey (context.service:43); `ctxId` browser localStorage; `Order.trackingSessionId == ctxId`.
- **Event ids:** server `purchase_/refund_/lead_ + id` (deterministic); browser non-Purchase `Date.now()+random`.
- **Cookies/session:** `_fbp/_fbc/_ga/_ttp` read via `collectIdentifiers()` + URL fbclid/ttclid/gclid; stored on TrackingContext `identifiers`.
- **Payload generation:** canonical snapshot (raw PII) -> normalizer (single SHA-256) -> per-provider wire shape; web-required params present (`client_user_agent/action_source/event_source_url`).
- **Dispatch timing:** eventTime = business time (order.createdAt); relay ~1s; freshness captured in monitoring.
- **Failure handling:** retryable (5xx/429/timeout) -> outbox backoff; permanent (4xx) -> DEAD; exception -> Bunq retry; reconciler hangs.

## 1.3 Verdict
Architecture is structurally sound and enterprise-grade for **delivery reliability** (outbox=DB truth, idempotent capture, SKIP LOCKED, per-attempt ids, work-set dedup, single normalizer, PII-bounded retention, replay). The weaknesses are concentrated in identity, dedup-window safety (non-Purchase dedup), EMQ edge inputs, and observability — detailed in Part 2.

---

# Part 2 — Gap Analysis & Severity Matrix (Phase 2)

Rule: every finding = root cause, business impact, technical impact, Meta impact, scalability impact, recommended solution. Severity: Critical/High/Medium/Low.

| ID | Severity | Root cause | Business impact | Technical impact | Meta impact | Scalability | Recommended |
|---|---|---|---|---|---|---|---|
| G-I5 | **Critical** | external_id per-journey random, not customer-keyed, not sent to Pixel (context.service:43; TrackingScripts:59) | No cross-session/cross-device attribution; GDPR delete misses abandoned contexts | identity unlinked; deleteByCustomerId incomplete | disables Meta external_id dedup + AM external_id matching | no per-customer identity across scale | customer-keyed external_id (Part 3, =Decision A) |
| G-I8 | **High** | no 48h dedup-window guard; relay OFF by default (outbox-relay:167) | double-count Purchase on delayed CAPI (outage/backoff) | excursion from deterministic dedup | Meta won't dedup outside 48h | grows with outage duration | relay go-live + dedup-rate KPI + (deferred) 48h guard |
| G-I7 | **High** | browser non-Purchase event_id random (tracking.ts:20) | duplicates on double-click/refresh/multi-tab (ViewContent/AddToCart/IC) | low dedup-key usage/overlap | Meta dedup key non-deterministic there | duplicate event volume | journey-stable logical id (Wave-3) |
| G-I1 | **High** | no em/ph guard (partially Wave-1: diagnostics-only) | contact-less admin/POS orders rejected as too-broad | invalid events sent | may reject/ignore | grows with POS volume | after Wave-2 identity, enforce em-or-ph via external_id/fbp fallback |
| G-I16 | High (if regulated) | no consent/opt_out | compliance exposure | no opt_out param | Meta discards under consent policies | — | consent gate + opt_out (Wave-3) |
| G-I9 | Medium | relay off default + no alert | silent stall | no alarm | delayed events miss dedup | backlog | health alert (Wave-1 ✅) + ops checklist |
| G-I13 | Medium | monitoring external_id metric read dead path | misleading KPI | wrong signal | — | — | fixed in Wave-1 (context_external_id) ✅ |
| G-I14 | Medium | no coverage/mirror-rate KPI | can't see browser loss | — | Meta measures coverage naturally | — | added Wave-1 mirror-capture ✅ |
| G-I15 | Medium | Meta token in Graph URL query | infra log token exposure | — | acceptable transport | — | infra log redaction (Wave-1 sanitize is defense-in-depth) |
| G-I3/I11 | Medium | server events miss zp/st/ln | lower EMQ | weak keys | fewer match signals | proportional | zip/state/ln from order+shipping (Wave-3) |
| G-I4 | Medium | validated Purchase event_time = order.createdAt | stale freshness / possible drop | freshness | event too old | none | document; optionally cap |
| G-I6 | Medium | no Advanced Matching on Pixel | browser events rely on fbp/IP only | lower browser EMQ | lower browser match | grows | AM gated behind consent (Wave-2/3) |
| G-I2 | Low | num_items sent on non-IC events | Meta may ignore | non-compliant | ignored | none | scope num_items (Wave-3) |
| G-I10 | Low | first-visit _fbp absent | first-visit EMQ | context w/o fbp | lower fbp coverage | first visit only | refresh context (Wave-3) |
| G-I12 | Low-Med | event_source_url/context staleness | attribution slightly off | stale ip/ua/url | lower quality | grows with delay | sync-before-purchase + context refresh |
| G-I18 | Low-Med | SPA PageView once per hard load | no per-route PageView | — | lower PageView counts | — | optional per-route PageView (Wave-3) |
| G-I20 | Low | IPv4 + ip pinned at first create | IP diag flags | — | IPv6 request | — | trustProxy + refresh ip/ua |

---

# Part 3 — Identity Resolution Audit (Phase 3)

## 3.1 Current (verified)
- `external_id` = per-journey `crypto.randomUUID()` at context create; never customer-keyed; never updated; **never passed to Pixel**.
- `ctxId` = browser localStorage, stable per journey; `Order.trackingSessionId == ctxId`.
- Customer identity: `customerId` on order + snapshot `customer{email,phone,...}`; guest = `guestPhone/guestName`.
- **No customer merge/split, no authenticated-vs-anonymous linkage, no cross-device continuity.**

## 3.2 Is the current external_id strategy appropriate for a scalable ERP?
**No.** Per-identity, stable across sessions/devices, is required for:
- cross-session dedup (Decision C reasoning; Meta external_id matching),
- cross-device attribution,
- GDPR `deleteByCustomerId` completeness (covers abandoned pre-order contexts),
- EMQ via stable `external_id` (Meta recommends external_id on all events).

A per-journey uuid fundamentally cannot satisfy these for an ERP with real customer accounts. **This is the single highest-value change**, already selected as **Decision A → option customer-keyed external_id**.

## 3.3 Recommended architecture (customer-keyed external_id) — NOT implemented, awaiting approval
**Why:** gives one stable hashed identity per customer; guests get a deterministic (phone/email-derived) or journey-uuid fallback; merges on checkout.

Candidate architectures compared:
| Option | Continuity | Multi-device | Merge/split | Abandoned-context delete | Meta compat | Cost |
|---|---|---|---|---|---|---|
| A. Per-journey uuid (current) | ✗ | ✗ | n/a | ✗ | external_id unusable | 0 |
| B. CustomerProfile.externalId uuid, set at checkout, propagated to context + Pixel | ✓ after signup | ✓ | add a merge column | ✓ | ✓ | Medium |
| C. Derived hash (sha256 of customerId) | ✓ after signup | ✓ | ✗ (unreversible) | ✓ | ✓ | Low |
| D. Deterministic from email/phone (PHI) | ✓ pre-auth | ✓ | reshuffle on merge | ✓ | ✓ | Low-Med |

**Recommendation: Option B** (stored customer uuid) — reversible merge/split lifecycle, clean deletion, no PII in the key, matches Meta's expectation of a stable external_id you already chose.

**Trade-offs:** an identity-merge point is required (checkout/auth writes `CustomerProfile.externalId`); guests keep per-journey uuid until they authenticate; deletion must null the customer externalId on request.

**Migration strategy:** additive — add `CustomerProfile.externalId` (migration), backfill existing customers, propagate to context (new field) and to Pixel `fbq('init', ..., {external_id})`; **feature-flag** behind `tracking_customer_external_id` (default off) per Guardrail 5; then monitor dedup-rate/EMQ uplift.

**Backward compatibility:** flag-default-off; per-journey uuid remains for guests; no existing event shape change (external_id is opaque).

**Meta compatibility:** Meta's external_id (hashed) + fbp becomes the dedup-path (b) — currently unusable, becomes usable; AM can later carry it.

**Production risk:** the merge point can race (two contexts → one customer) — must serialize per customer; low regressions if additive.

---

# Part 4 — Event ID Audit (Phase 4)

## 4.1 Created / lifecycle / scope
- Server order/lead: `purchase_{id}` / `refund_{id}` / `lead_{id}` (created in the capture input). Lifecycle: snapshot.eventId (UNIQUE) → dispatch.providerEventId → adapter wire event_id → reused on retry/replay.
- Browser non-Purchase: `Date.now()+random` (`generateEventId`, tracking.ts:20-22); passed to Pixel `eventID` and mirror.
- Browser Purchase: caller passes `purchase_{orderId}` (ThankYouContent:104).

## 4.2 Failure scenarios (every case that can produce a bad id)
| Scenario | Outcome | Where |
|---|---|---|
| duplicate id (order re-submit) | capture `DEDUPED` (no new snapshot) — **safe** | capture.service:skipDuplicates |
| duplicate Purchase id (browser mirror + server txn race) | one snapshot, other DEDUPED — **safe** | same |
| **regenerated non-Purchase id** (refresh/double-click/multi-tab) | **new random id → new snapshot → duplicate** | tracking.ts:20 (G-I7) |
| mismatched browser/server (Purchase) | **none** — both use `purchase_{orderId}` | parity held |
| missing id | build() returns null (no dedup id) → **SKIPPED** | meta.adapter:55 |
| replay | same eventId reused → **safe** | replay.service keeps id |
| retry | same eventId → **safe** | dispatch reuses providerEventId |

Verdict: order events deterministic and safe; **non-Purchase browser events are the only duplicate-producing case** (fix = journey-stable id, Wave-3 G-I7).

---

# Part 5 — Browser Pixel Audit (Phase 5)

Investigate why browser events may not appear in Meta Test Events. Verified causes (2A):
1. **Ad-blocker / edge CSP** blocks third-party `connect.facebook.com`/`gtag` — Pixel suppressed while same-origin CAPI mirror survives → "browser missing, CAPI present" (G-I25). **Real failure, not diagnostics.**
2. **No test-mode on Pixel** — browser sends no test_event_code; Test Events tooling for browser events requires Meta-side config. **Likely a diagnostics/misconfig, not a delivery fault.**
3. **SPA PageView only on hard load** — per-route PageView absent (G-I18), can look like missing PageViews.
4. **First-visit `_fbp` absent** — EMQ, not absence.
5. **No Advanced Matching** — browser events carry only fbp/IP (G-I6).
6. Queue-drop race (single-provider pre-script window); thank-you sync AFTER Purchase; order-missing guard (2A C4/C6/C8).
7. No consent gate.

**Verdict:** genuine failures (ad-block) + genuine gaps (AM, AM-carry, consent) mix with **misleading Test-Events diagnostics** (no browser test code, SPA PageView). Distinct from server gaps.

---

# Part 6 — Server Event Audit (Phase 6)
Full per-field compliance was produced in the Compliance Audit (matrix §9). Summary: web-required params present; hashing correct; value/currency correct; weak = zp/st/ln missing server-side; `num_items` on non-IC; no opt_out; Refund negative-value mapping (kept, documented). No new findings. **EMQ-driving fields (em/ph/fn/ct/country/external_id/fbp/fbc/ip/ua) present on normal web orders.**

---

# Part 7 — Browser/Server Deduplication Audit (Phase 7) — HIGHEST PRIORITY

## 7.1 Dedup mechanism (verified)
- Event-level: `TrackingSnapshot.eventId UNIQUE` + skipDuplicates → capture-once; Meta event_name+event_id match within 48h.
- Per-provider: `@@unique([snapshotId,provider])`; work-set rule never re-sends SENT.
- Order events share `purchase_{orderId}` between Pixel eventID and CAPI event_id.

## 7.2 Scenario matrix (determine double-count outcome)
| Scenario | Browser | Server | Result |
|---|---|---|---|
| Browser first, then Server (instant) | Pixel fires purchase_id | txn captures purchase_id, ~1s dispatch | 1 snapshot; Meta dedup within 48h → **single** |
| Server first, then Browser | txn captures purchase_id | — | mirror DEDUPED; Meta dedup → **single** |
| Simultaneous | both | both | eventId UNIQUE → one wins; Meta dedup → **single** |
| Slow browser (thank-you late) | Purchase may not fire | CAPI present | **single** (CAPI only); coverage gap |
| Slow/queue server (relay OFF/outage) | Pixel present | CAPI >48h late | **Meta non-dedup → double** (G-I8) |
| Retry then success | — | same event_id | Meta dedup absorbs → **single** |
| Refresh (non-Purchase) | new random id | new snapshot | **duplicate** (G-I7) |
| Double-click (non-Purchase) | two random ids | two snapshots | **duplicate** (G-I7) |
| Network timeout (mirror fails) | Pixel yes | no mirror (non-order) | **single Pixel**, CAPI-coverage gap |
| Page close before Purchase | Pixel may not fire | CAPI captured | **single** (CAPI), coverage gap |
| Multiple tabs (non-Purchase) | per-tab events | per-tab snapshots | **duplicate** non-Purchase |
| Mobile browser | same as desktop; OS kill | CAPI present | coverage gap if Pixel killed |
| Guest checkout | Pixel + guest identity | CAPI guest → dedup | **single** |
| Logged-in checkout | Pixel + customer | CAPI customer → dedup | **single** |
| Offline recovery | Pixel lost offline | CAPI sent later (≤48h) | **single** (no both) |
| Replay (manual/auto) | — | same event_id re-sent | work-set skips SENT → **no dup** |

**Double-count risks:** exactly two classes —
- **(R-A)** CAPI delayed >48h after Pixel (relay-off/outage/backoff) → Meta non-dedup → double Purchase (HIGH, G-I8).
- **(R-B)** non-Purchase browser events random id → refresh/double-click/multi-tab duplicates (MEDIUM, G-I7).
Order events (Purchase/Refund/Lead) are deterministic-safe under all normal paths.

---

# Part 8 — Idempotency Audit (Phase 8)
| Layer | Idempotency | Dup dispatch? |
|---|---|---|
| Application (capture) | eventId UNIQUE skipDuplicates | no — DEDUPED |
| Database | unique on snapshot/outbox/dispatch | no |
| Queue (relay) | per-attempt job id; lock released on enqueue fail | no double enqueue (SKIP LOCKED) |
| Dispatcher | work-set PENDING/SENDING/RETRY; upsert dispatch | no re-send of SENT |
| Retry | same providerEventId | provider dedup absorbs |
| Redis | delivery only; DB is truth | outage-safe |
| Background jobs | relay only claims PENDING | reconciler guards live dispatch |
| Manual replay | same event_id, DEAD→PENDING only | work-set skips SENT providers |
| Automatic replay | same path | no dup |
**Dup dispatch possible?** Only a hung-but-live send being released by the reconciler racing a live retry — mitigated by the reconciler's "no SENDING/RETRY recent" guard (verified). Otherwise no duplicate dispatch of an already-SENT provider.

---

# Part 9 — Retry & Queue Audit (Phase 9)
- Two layers: BullMQ attempts (exceptions) + DB outbox backoff (provider 5xx), max 5 → DEAD. Verified (2A.5 R1).
- Weak points: (a) retryable-only 429/5xx — a transient TikTok code outside {40011,40012} is permanent; (b) 48h-window + long backoff (max 24h step) can push a Purchase beyond dedup when combined with multiple failures (edge of R-A); (c) no per-provider retry-cap distinct significant. Recommend: keep; add dedup-rate alert covering R-A.

---

# Part 10 — Cookie & Session Audit (Phase 10)
- `_fbp/_fbc/_ga/_ttp` read at context sync; ROTATING replace-when-newer, never clear (context-merge.ts:24).
- Expiration: Meta-managed; we don't set/refresh; first-visit fbp gap (I10); ip pinned at first create (I20).
- Session: ctxId localStorage; no server-side session; browser migration (new device) → new ctxId → new external_id → identity continuity lost until authentication (fixed by Part 3).
- Consent: none.
**Improvement:** refresh ip/ua/fbp on each context update (currently only create); tie external_id to customer on auth (Part 3).

---

# Part 11 — Event Match Quality (Phase 11)
**Estimate:** normal web Purchase with customer contact + captured context → **~7/10** (em/ph/fn/ct/country/external_id/fbp/fbc/ip/ua + event_id). Reduced cases: first-visit (no fbp), context-less deep link (high), no-contact (invalid risk), missing zp/st/ln. Target ≥6.0 (Meta). 
**Lever ordering:** (1) stable external_id (Part 3) — biggest; (2) zp/st/ln enforcement (Wave-3); (3) context refresh + sync-before-purchase; (4) Advanced Matching (post-consent).

---

# Part 12 — Monitoring Audit (Phase 12)
Wave-1 added relay/redis/queue/dispatcher health + mirror-capture + corrected external_id. Capability vs requirement:
| Detect | Yes/No | Gap |
|---|---|---|
| missing browser events | partial | mirror-capture ratio only; no Pixel-echo | 
| missing server events | partial | no coverage vs expected volume |
| failed dedup | No | Meta-side only (Events Manager) |
| payload validation errors | partial | top-failures; no Payload Helper in-loop |
| missing cookies (fbp/fbc) | partial | context counts; no per-option coverage |
| identity mismatch | No | requires Meta dedup/EMQ views |
| retry failures | Yes (retry histogram) | — |
| queue failures | Yes (Wave-1 health) | — |
**Gap:** a true browser-coverage and dedup-rate KPI requires a broadcaster echo/browser-confirmation marker — recommend (Wave-3) a `browserEchoAt` recorded when mirror confirms, enabling coverage + R-A alert.

---

# Part 13 — Production Safety (Phase 13)
- Scalability: relay batch/concurrency configurable; BW single relay timer per app (one instance) — multi-instance safe via SKIP LOCKED; worker concurrency per-instance. OK.
- Race conditions: reconciler guarded; capture ON CONFLICT; work-set. OK.
- Redis failure: outbox = DB truth; relay releases lock; no loss. OK.
- DB failure: capture in business txn → order fails correctly. OK.
- Queue failure: lock release + backoff. OK.
- Deployment safety: Wave-1 flags default-safe; age guard default-on (documented); additive. **Only risk**: relay actual state in prod unknown (UNABLE TO VERIFY).

# Part 14 — Performance (Phase 14)
- Redis ops: relay claim (1/s + per row enqueue); BullMQ. Low.
- DB ops: capture inside txn; monitoring = groupBy/counts. Acceptable; note `buildAdapterRegistry()` rebuilt per dispatch job (small) — hoistable (minor).
- API latency: adapter 1500ms timeout; single-event. OK.
- **Throughput:** purchase/refund prioritized (priority 10) so browser-event flood cannot starve business events. OK.

# Part 15 — Security & Privacy (Phase 15)
- Hashing single-path SHA-256; raw PII bounded to context/snapshot, ephemeral hashed payloads.
- Logging clean (no PII). Secrets in DB+env, never logged. **Token in Graph URL query (G-I15)** → infra redaction.
- `opt_out`/consent absent (G-I16). Retention/deletion to spec. 
- **Recommendation:** consent gate + opt_out before any regulated region; keep single normalizer; never persist raw provider echoes beyond 500-char sanitized.

---

# Deliverables (consolidated)

1. **Current architecture** — Part 1.
2. **Gap analysis** — Part 2 matrix.
3. **Severity matrix** — Part 2 (Critical: identity); High: dedup/debug/EMQ; Medium/Low listed.
4. **Root causes** — Part 2 (per finding).
5. **Risk assessment** — R-A (48h double), R-B (non-Purchase dup), identity gaps, compliance.
6. **Improvement opportunities** — Parts 3, 7, 10-12.
7. **Alternative architectures** — Part 3.3 (identity options A-D).
8. **Migration strategy** — Part 3.3 (additive, flag-gated).
9. **Backward compatibility analysis** — Part 3.3 + Guardrails; all additive/flag-gated.
10. **Production risk analysis** — Part 13.
11. **Recommended implementation order** — see Wave Roadmap below.

## Recommended implementation order (gated waves)
- **Wave-2 (this):** identity architecture (Part 3) — customer-keyed external_id + merge/delete + Advanced Matching gated + consent/opt_out + browser-coverage/echo KPI + AM. [Approval first]
- **Wave-3 (Optimization):** payload hygiene (zp/st/ln, num_items), journey-stable browser event_id (kills R-B), context freshness, remaining monitoring.
- **Post-wave ops:** relay go-live checklist + dedup-rate alert (R-A), infra log redaction.

---

# Specification challenges & decisions to confirm
Rule: I challenge/confirm only with evidence. Items needing explicit approval:
1. **Identity (Part 3):** adopt **Option B customer-keyed external_id** (stored uuid) + merge/delete + feature-flag propagation to Pixel. This is the single biggest EMQ/dedup/identity win. Trade-offs documented.
2. **Non-Purchase browser event_id (Wave-3):** journey-stable logical id — kills R-B duplicates. Confirm it is desired over the current random id (it reduces Meta event-volume noise).
3. **48h guard (R-A):** I recommend NOT implementing a hard 48h skip in this phase (it can drop a legitimately-needed CAPI event if the browser Pixel was itself lost). Instead: **enable relay + add a browser-echo coverage/dedup-rate alert** (cheaper, safer) and monitor. Confirm.
4. **Default-on safety guards** (Wave-1): age guard + EMQ-diagnostics are default-on; confirmed acceptable earlier; reconfirmed here.
5. **No further implementation until approval** of the above (per the Decision Rule).

---

**Wave-2 audit is the deliverable. No code was changed.** Awaiting architect approval of the identity architecture (Part 3) and the decisions above before Wave-2 implementation begins.