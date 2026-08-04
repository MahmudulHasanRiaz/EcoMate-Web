# Wave-2.1 Production Validation Report — Meta Pixel Init & Identity Timing

**Date:** 2026-08-04
**Scope:** final staging-style validation of the Wave-2.1 Meta Pixel initialization and identity timing, plus the requested ADR clarification.
**Method:** (a) deterministic module-level validation of the init/buffering/timing semantics (new `apps/storefront/lib/__tests__/tracking-identity.spec.ts`, fresh module per scenario — passed 5/5); (b) code-trace of the readiness/identity flow; (c) live Meta-side checks (real `fbq` network, Events Manager, Test Events, dedup tab, measured real-page ms) are **UNABLE TO VERIFY in this sandbox** (no running stack / real Pixel credentials) — the exact staging steps and expected results are listed per scenario so the credentialed staging run can confirm them.

---

## 1. Guest Visitor
| Check | Result |
|---|---|
| First PageView sent? | **Yes** — `initMetaPixel()` fires `fbq('init')` + `PageView` synchronously (module test 1). Guests resolve identity immediately (`TrackingScripts` sets `identity.ready=true` with no fetch). |
| Init delay while waiting for identity? | **≈ 0 ms** — guests have **no** identity fetch; `initMetaPixel` is synchronous. No artificial delay by design. (Exact real-page ms needs staging; code-trace shows zero guest dependency on `/tracking/identity`.) |
| Guests negatively affected? | **No** — init runs as soon as pixel id + inline tag are ready; parameterless init (no external_id), identical to pre-Wave-2.1. |

## 2. Authenticated Customer
| Check | Result |
|---|---|
| First PageView includes correct external_id? | **Yes** — `setPixelIdentity(ext)` then `initMetaPixel()` → `fbq('init', id, { external_id })` (module test 2). |
| Subsequent events same identity? | **Yes** — events buffer until init (init-first), then fire; the resolved external_id is the session identity (module test 3). |

## 3. Login Flow (no refresh)
- **Authenticated at page load:** external_id present at init — no refresh needed.
- **Login mid-session after a guest init already ran:** the external_id **cannot** be attached to the current init (Meta supports `external_id` only as an `fbq('init')` parameter; **no reliable re-init**). The next browser event does **not** carry external_id until the next page load. **Dedup still works in the interim via `fbp`/`event_id`.**
- **Result: Issue #1 (documented Meta limitation, not a defect).** No dependency on refresh for users who are authenticated at load; a documented next-load dependency only for the mid-session guest→login transition.

## 4. Logout Flow (no refresh)
- Subsequent events **still fire** (tracking is not stopped) — module test 5.
- The init-time external_id **remains fixed until the next page load** (Meta init-only param). **Result: Issue #2 (minor, Meta-mandated).**

## 5. Slow Identity Endpoint (2–3 s artificial delay)
- Authenticated: init **waits** for the identity resolution; Meta events fired before init are **buffered** (not sent early, not lost) — module test 3.
- After resolution → `initMetaPixel()` runs → PageView + buffered events **flush with the external_id**.
- **Performance:** first PageView delayed by the identity latency; buffered events delayed by the same; **none lost**. (Real 2–3 s measurement requires staging; the buffering semantics are proven deterministically.)

## 6. Identity Endpoint Failure
- **Graceful** — the catch path resolves `identity=null`; `initMetaPixel()` proceeds **without** external_id; PageView and subsequent events still fire (module test 4). Tracking is **not** permanently stopped by an identity lookup failure.

## 7. Ad Blocker (identity OK, Pixel blocked)
- Third-party `connect.facebook.com` / `gtag` / `tiktok` blocked → browser Meta events suppressed; the **same-origin mirror** (`/api/tracking/events`) and **server CAPI** are unaffected → server events delivered. (Code-traced; live blocker run needs staging.)

## 8. Pixel Blocked
- **Server-side CAPI still delivered** — the mirror + dispatcher are independent of `fbq`; identity resolution is server-side per order. (Code-traced.)

## 9. Meta Test Events
- Requires a real (non-prod) Pixel + Events Manager in staging — **UNABLE TO VERIFY here**.
- **Staging steps:** enable `tracking_customer_external_id`, `tracking_relay_enabled`, `tracking_meta_test_mode`; fire a guest + authenticated Purchase; in Events Manager confirm: both Pixel and CAPI events appear, dedup tab shows a single deduplicated Purchase (`event_id purchase_{orderId}` shared), EMQ ≥ 6.0 for the authenticated Purchase (external_id present).

---

## Issues discovered
1. **Issue #1 (Medium, Meta-mandated):** mid-session guest→login cannot attach `external_id` without re-init (Meta init-only parameter). Mitigation: `fbp`/`event_id` dedup continues; external_id applies on the next page load. **No code change** (unsupported by Meta).
2. **Issue #2 (Low, Meta-mandated):** mid-session logout keeps the init-time external_id until the next page load. **No code change.**
3. **No code defects found** in the init/buffering/timing logic — all module-level scenarios passed.

## Performance observations
- **Guest PageView delay: ≈ 0 ms** (no identity fetch; synchronous init).
- **Authenticated first PageView:** delayed by the `/tracking/identity` round-trip (same-origin, typically <300 ms; under an artificial 2–3 s delay the first PageView is delayed by that amount). Events are buffered, not lost.

## Final recommendation
**Production Ready (code-level).** The init/buffering/timing semantics are validated deterministically; no defects found; the two issues are Meta-mandated limitations with documented mitigations. The single remaining gate is a **credentialed staging run** of the live Meta-side items (scenarios 7–9: real Pixel delivery, Events Manager, Test Events, dedup rate) using the steps above — required before production enablement of `tracking_customer_external_id`.

## Deliverables added
- ADR clarification (ADR-6 — `/tracking/identity` is Meta-tracking-scoped, not a general customer identity API; extract to a dedicated Identity domain if future non-tracking consumers require it).
- Validation spec `apps/storefront/lib/__tests__/tracking-identity.spec.ts` (5 scenarios; verification only, no production code change).
- Storefront: `tsc` clean, vitest **5 files / 30 tests pass** (no regression).
