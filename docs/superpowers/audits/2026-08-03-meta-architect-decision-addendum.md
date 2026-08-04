# EcoMate Meta Tracking — Architect Decision Addendum (Phase-2)

**Final addendum resolving Decisions A–G. Evidence only — no implementation.**
**Date:** 2026-08-03
**Inputs:** the three Architect-approved technical baselines (Discovery, Browser Runtime, Server Runtime, Compliance Audit) + official Meta documentation fetched fresh (Best Practices, Using the API, Parameters, custom-data reference, Dataset Quality API, dedup Pixel↔CAPI).

---

## Decision A — external_id Architecture

**Do not assume customer-keyed is best.** Here is a dedicated External Identity Architecture with candidate evaluation.

### Requirements
- anonymous visitors, guest checkout, authenticated users, guest→customer creation, customer merge/split, deleted customers, imported/migrated customers, tenant isolation, cross-device identity, privacy, GDPR deletion, replay, historical attribution.

### Candidate architectures

| # | Model | Cross-session | Cross-device | Guest coverage | Privacy | Merge/split | Delete | Complexity |
|---|---|---|---|---|---|---|---|---|
| A1 | **Per-journey UUID (current)** | ✗ | ✗ | ✓ (per journey) | ✓ (anonymous, non-PII) | n/a | trivial | **0** |
| A2 | **CustomerProfile.id as external_id** | ✓ | ✓ (in) | ✗ (guests have no id) | Weak (leaks internal id) | reuse | rotate | Low |
| A3 | **PII-derived hash (sha256 email / sha256 phone)** | ✓ | ✓ | Partial (phone only) | Weak (hash of PII, changes on edit) | breaks on edit | rotate | Low |
| A4 | **Stable non-PII UUID per customer** (new `CustomerProfile.externalId`), guest = phone-derived UUID, journey-uuid fallback | ✓ | ✓ (in) | ✓ (phone) | ✓ Strong | merge/rotate | rotatable | Medium |

### Analysis per lifecycle event
- **Anonymous:** A1/A4 → per-journey uuid (non-PII), no change. A2/A3 → none.
- **Guest checkout:** A4 keys the order event's external_id by a deterministic UUID derived from the normalized phone → a returning guest (same phone) dedups across bookings without exposing the phone. A2 → no guest coverage (gap). A3 → phone hash is PII-ish + breaks if guest edits field.
- **Customer created after guest checkout:** A4 merge — on registration/checkout with a known customer, the profile's stable externalId is adopted; prior guest-phone-derived history remains linkable only if Meta matched by em/ph (not by external_id) — acceptable, documented.
- **Merge:** A4 — adopt the primary's externalId (or regenerate) on profile merge; rehash from the canonical record. A2/A1 similar but A4 doesn't disturb the internal FK.
- **Split:** A4 — regenerate a new externalId for the split profile.
- **Delete (GDPR):** all — delete/rotate the externalId and strip snapshot PII (existing DeletionService). Replay deliberately unaffected (replay uses archived payload hashes, not live external_id).
- **Imported/migrated customers:** A4 — backfill a `trackingExternalId` uuid deterministically at import.
- **Tenant isolation:** single-store platform today; A4's externalId is scoped per CustomerProfile (already tenant-namespaced). A UUID carries no cross-tenant collision risk.
- **Privacy:** A4 uses non-PII UUIDs (not raw phone/email); only SHA-256 goes to Meta. Aligns with Meta's "external_id... hashing recommended."

### Recommendation: **A4 — stable non-PII external_id (per-customer), guest = phone-derived UUID, per-journey fallback.**
- Add `CustomerProfile.externalId` (uuid, non-PII).
- Resolve at capture (order/has): `customer.externalId` → else guest-phone-derived deterministic UUID → else journey `ctx.externalId`.
- Emit hashed `user_data.external_id` from the resolved value.
- **Pixel share: do NOT enable now.** Sharing a stable external_id with the Pixel is the strongest form of identity broadcast and there is no consent gate yet (I16). Keep the schema + resolution capable, gate Pixel `fbq('init', …, {external_id})` behind the future consent/opt-in. (This keeps the privacy posture today; cross-session server identity still improves.)
- Merge/split/delete/import rules above.

**Trade-offs vs A1:** loses the "maximum privacy by default" anonymity for a small, non-identifying stable code. **Backward compat:** additive column + capture-time resolution; old snapshots unchanged; replay unaffected. **Regression risk:** low (the change is at capture resolution + Pixel gating). Not implemented — this is the recommended plan.

---

## Decision B — 48-hour Dedup Guard: is it a realistic production risk?

### Evidence (official, updated)
- Meta dedup window = **48 h** (documented; events only deduplicated if the second arrives within 48 h of the first `event_id`).
- **New hard limit:** `event_time` may be "up to 7 days before you send an event"; **anything older → "we return an error for the entire request and process no events."** (Using the API). We send batch = 1, so an offending event is a whole-request loss, not a batch-wide loss.
- Our architecture: capture-time configSnapshot + relay off-by-default + retry backoff 1m→24h (max 5) + event_time = order.createdAt.

### Realistic scenarios
| Scenario | Likelihood (this ERP, relay properly enabled) | Impact |
|---|---|---|
| Happy path: relay ON, 1 s poll → instant Purchase dispatches ~1 s after the browser Pixel | Very high convenience; **near-zero** | none |
| Relay enabled but >48 h behind (operator defect / misconfig left OFF for days) | Low–Medium (relay is OFF by default; ops must enable) | 48 h < → not deduped → **double-count**; >7 d → **event lost** |
| Long queue/Redis outage >48 h (outbox persists) | Low | delayed → non-dedup / lost |
| Validated Purchase (no browser Pixel) whose dispatch is late > 7 d | Low (validated_across) | **event lost** |

### Probability assessment
Under correct operation the 48 h double-count probability is **very low** (<1% of a month of orders). It only materializes when the relay is off/lag >48 h — an **operational** failure, not a steady-state design failure. The **7-day event_time hard rejection** is a distinct, higher-value data-loss risk (esp. validated Purchases with event_time = order.createdAt older than 7 days).

### Decision
- **Do NOT build a browser-confirmed 48hup dedup guard.** Server-side you cannot observe Meta's Pixel receipt time; a "browser-confirmed marker" is lossy (the mirror is often DEDUPED) and the added complexity exceeds the (rare) double-count benefit.
- **DO ship a trivial 7-day event-age guard:** at dispatch, if a web event's `event_time` is more than 7 days in the past, skip/`DEAD` it (and log), because Meta will hard-reject it. This prevents a real data-loss path and harms nothing (a legitimately older web event would be rejected anyway). Low risk, high value.
- **Primary control = operational:** relay enabled with a go-live gate + PENDING freshness alert (I9) + a dedup-rate KPI (I14). Those keep dispatch within the 2d window in steady state. **Business impact benefit > complexity** only for the 7-day guard; the 48h guard itself is **not** worth the added complexity.

---

## Decision C — em-or-ph Guard: official Meta evidence

### Question
Are events with `external_id` + `fbp` + `event_id` + `client_ip_address` + `client_user_agent` (but **no em/ph**) rejected, ignored, accepted, or lower?

### Official evidence (Best Practices page)
- "An event is considered invalid if it only includes information that consists of one of the following combinations (or a subset thereof):" `ct+country+st+zp+ge+client_user_agent`; `db+client_user_agent`; `fn+ge`; `ln+ge`. The listed combos do **not** include `external_id`, `fbp`, `event_id`, `client_ip_address`, `client_user_agent`.
- Therefore the combination above is **not in the invalid set → it is ACCEPTED.**
- Non-compliant consequence: such an event is "valid but lower match quality" — "unmatched events can still be used for basic measurement only" (not attribution/ad delivery).
- Best Practices also says: "Also include the `external_id` and `event_id` event parameters for all events" — external_id is treated as a supported key.

### Conclusion for the guard
- **rejected:** NO (unless user_data degenerates to an exact restricted combo).
- **ignored / accepted:** yes, accepted — lower EMQ.
- The earlier I1 framing (in the audit) overstated the risk: the real danger is *limited* to the case where an order/lead has **no email AND no phone AND no external_id AND no fbp** (e.g., no context). For a typical contact-less order with a context (external_id+fbp present) the event is **accepted with lower EMQ**.
- **Verdict: implement a guard, but as an EMQ/quality control, not a hard rejection.** Recommended: in `MetaAdapter.build()`, when no `em` and no `ph` resolve, still send the event (it is accepted via external_id/fbp) but **flag it** (dispatch message + monitoring) and, if there is genuinely no identity (no external_id, no fbp, no IP/UA), mark it `SKIPPED` to avoid emitting a near-empty, rejected-risk payload. This is evidence-based: don't drop events that Meta accepts.

---

## Decision D — Meta Access Token: Authorization: Bearer?

### Official evidence (Using the API page)
- "**Attach your generated secure access token using the `access_token` query parameter to the request.**"
- Curl example authenticates via `-F 'access_token=<ACCESS_TOKEN>'`.
- **No `Authorization: Bearer` header is documented for the `/events` endpoint** on the official Conversions API page.

### Decision
- Do NOT switch to `Authorization: Bearer` — it is **not** the documented mechanism for this endpoint (the earlier "Meta also accepts Bearer" claim was not backed by these official docs).
- **Keep:** current `?access_token=` query parameter.
- **Mitigation:** recommend infrastructure log redaction (CDN/proxy access-log scrubbing of the `access_token` query param) + ensure TLS. This fully addresses the token-in-log exposure without diverging from the documented API.

---

## Decision E — num_items on unsupported events

### Official evidence
- custom-data reference: "`num_items` — **Use only with `InitiateCheckout` events.**"
- The docs do **not** state that sending `num_items` on other events causes any rejection, warning, or error to a compliant payload; unknown/misused parameters are not rejected at the API level (a fully-malformed user_data combo is, via Decision C's list, but `num_items` isn't one).

### Verdict
- Sending `num_items` on Purchase/Refund is **accepted and ignored** — no rejection, no documented warning.
- **Recommendation:** keep it harmless (it adds noise, not value); optionally clean it for meta/OOT hygiene. **No urgent action.** Low impact; schedule with other hygiene (P4).

---

## Decision F — SPA PageView

### Business evaluation for an ERP storefront
- We fire Meta `fbq('track','PageView')` **once per hard load** today; SPA routes do not add a PageView.
- What matters for conversion tracking: Purchase / AddToCart / InitiateCheckout / ViewContent. PageView is a low-value, no-pixel-attribution signal.
- We already record per-unique-URL page-views in our own analytics buffer (`/tracking/page`), which gives per-route page metrics without Meta.

### Decision
- **Do NOT implement per-route SPA PageView.** 
- **Why:** for an ERP storefront, per-route PageView enriches no conversion/optimization (Meta uses the strong conversion events; PageView is not used for important lookup), adds event volume/noise, and there is **no measurable benefit** to a conversion-keyboard. The page-level pageview data already in our buffer covers the analytics use-case.
- Revisit only if a future need (e.g., Meta custom-audience on page colleagues) material.

---

## Decision G — Risk Matrix (replaces the self-scored 6.9/10)

The numeric score is removed. This is the **official implementation backlog** (Critical→Low, with business impact and priority + effort).

### Critical — block go-live / data loss
| ID | Risk | Business impact | Priority | Effort |
|---|---|---|---|---|
| R1 (I9) | Relay OFF by default → no CAPI dispatch / silent stall | All server tracking/losted; accumulating PENDING | P0 | 1d (goto-live gate + startup alert + health KPI) |
| R2 (7-day) | Web event with `event_time` > 7 d → Meta **whole-request rejection** (data-point) | **Event lost** (esp. validated Purchases) | P0 | 1d (dispatch age guard: skip/DEAD if > 7 d, log) |
| R3 (I1) | No em-or-ph → degenerate payloads (validated per C) | Invalid/empty if no identity at all; lower EMQ always | P0 | 1d (build() flag or SKIP when no identity; EMQ flag) |

### High
| ID | Risk | Business impact | Priority | Effort |
|---|---|---|---|---|
| H1 (I5) | external_id per-journey not-keyed/not-in-Pixel | No cross-session identity/dedup; weak deletePath | P1 | M-L (external_id arch, Decision A, Pixel gated) |
| H2 (I15) | Meta token in URL query | infra log exposure | P0 | 1 (log redaction) |
| H3 (I16) | No consent/opt | compliance if regulated | P3 | M-L |
| H4 (I13/I14) | broken ext metric; no coverage KPI | no observability → blind to dedup rate | P | S-M |

### Medium
| ID | Risk | Business impact | Priority | Effort |
|---|---|---|---|---|
| M1 (I3/I11) | server lacks zp/st/ln | EMQ | P2 | S |
| M2 (I6) | No Advanced Matching (defer behind consent) | browser EMQ | P3 | M |
| M3 (I12) | con stale / deep-link missing | EMQ | P2 | S |
| M4 (I7) | browser non-Purchase random event_id | dedup-key coverage/overlap | P2 | M |
| M5 (I18) | SPA PageView only hard-load | (no change — Decision F) | ... | — |

### Low (hygiene) — P4
L1 IPv4/IP pinned · L2 registry hoist + worker concurrency · L3 num_items (E, harmless)

---

---

## Implementation Guardrails (mandatory constraints)

Every implementation change in the upcoming phase MUST satisfy all of the following. A change that violates a guardrail is not approved.

1. **Zero regression** — the full backend (Jest), storefront (Vitest), and admin (Vitest) suites must remain green; existing tracking tests must never be weakened or deleted to accommodate a change.
2. **Backward compatibility** — no breaking changes to public API contracts (order DTO, `/tracking/*` endpoints), DB schema semantics, or any payload shape consumed by adapters/monitoring/replay. New fields are additive only.
3. **Browser/server parity preservation** — the shared dedup keys must stay intact: Pixel `eventID` == CAPI `event_id` for order events (`purchase_{orderId}`, `refund_{orderId}`), and the browser mirror must keep mirroring the same `event_id`. Any change to event naming or ids must preserve this parity.
4. **Replay compatibility** — `TrackingReplayArchive` payload shape and pinned `versions` must remain consumable by the current replay path; replaying an archived event must still dispatch. Any hashing/normalization change requires a `normalizerVersion` bump and must not break replay of older archives.
5. **Feature flags where appropriate** — every new behavior (external_id resolution A4, 7-day event-time guard, em-or-ph flag, monitoring metric fixes) ships behind a setting/env gate using the established `tracking_*` system_setting pattern, with the **default = current behavior** (off / no-op) so rollout is controlled and reversible per server.
6. **Rollback strategy** — each change must be revertible: feature flags disable new behavior without a deploy; schema changes are additive with reversible steps; no destructive migrations; the previous tagged behavior must be a one-flag switch.
7. **Zero downtime** — no breaking deploys; migrations are additive and non-blocking (PK-batched, per the established retention pattern); relay/dispatcher are stateless so multiple instances can roll independently.
8. **Production data preservation** — never delete or alter production tracking data outside the established retention/deletion policies; no data-loss flags; `managedStockQuantity`/order/accounting invariants untouched (tracking is additive).
9. **Runtime verification after every major change** — each implementation unit must run backend build + tests and storefront build + tests; for any change that alters the live payload/identity path, verify in staging with a real (non-prod) pixel via Test Events / Events Manager before production.
10. **No undocumented behavioral changes** — every behavior change ships with a changelog note and updates the relevant baseline doc; no silent changes to event semantics, dedup keys, hashing, retention, or payload fields.

---

## Implementation Success Criteria (objective acceptance)

Implementation is **complete only when every item below is verified**. Each item is a gate: nothing ships until it passes.

| # | Criterion | How verified |
|---|---|---|
| S1 | Browser Purchase verified | Pixel fires Purchase with `eventID = purchase_{orderId}`; the mirror POST is capture-deduped (no second snapshot). |
| S2 | Server Purchase verified | CAPI event arrives with `event_id = purchase_{orderId}` and complete `user_data` (em/ph/fn/ct/country/external_id/fbp/fbc/ip/ua). |
| S3 | Pixel/CAPI dedup verified | Events Manager dedup tab shows the test Purchase deduplicated (single count) — no double-count. |
| S4 | Event Match Quality improved | EMQ ≥ 6.0 for web Purchase/Refund in staging (Events Manager EMQ score). |
| S5 | external_id lifecycle verified | A4 behavior confirmed end-to-end: anonymous → journey UUID; guest → phone-derived UUID; authenticated → customer UUID; merge/split/delete correct; Pixel share still gated off. |
| S6 | Retry verified | Simulated 5xx → outbox backoff (1m→…) → relay re-claim → SENT; same `providerEventId` throughout; no duplicate dispatch rows. |
| S7 | Replay verified | DEAD outbox → admin replay → re-dispatch with same `event_id`/`event_time`; archive fallback works after retention; provider dedup absorbs. |
| S8 | Monitoring verified | Volume/funnel/freshness/dedup metrics reflect the test events; the `external_id` dedup metric is non-zero (fix verified); DEAD/DLQ stats correct. |
| S9 | Payload Helper validation passed | Meta Payload Helper validates Purchase, Refund, AddToCart payloads with no errors. |
| S10 | Events Manager healthy | Events received, connection method correct, no dropped/invalid events in the test window. |
| S11 | Test Events healthy | `test_event_code` flow (gated) shows the event in the Test Events tool. |
| S12 | No regression | Full suites green: backend (1042+), storefront (25+), admin (185+); existing tracking tests untouched. |
| S13 | Production compatibility preserved | No downtime, no data changes, feature flags default to current behavior, rollback path proven on staging. |

---

**ARCHITECTURE FREEZE.** The four baselines (Architecture Discovery, Browser Runtime, Server Runtime, Compliance Audit) plus this Addendum (Decisions A–G, Implementation Guardrails, Success Criteria) are the frozen, official technical baseline of the Meta Tracking Platform. No further research or architecture modification until implementation planning begins. Implementation is approved only when every Success Criterion (S1–S13) is verified and all Guardrails hold. No code was modified during the research and architecture phase.