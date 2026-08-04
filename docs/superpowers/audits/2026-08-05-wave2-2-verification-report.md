# Wave-2.2 Verification Report — Context Refresh, Mirror→Context Merge, SPA PageView

**Date:** 2026-08-05
**Status:** Implemented + verified (builds, full suites). Not committed. Awaiting architect review.
**Depends on:** Wave-2 Audit v2 (frozen, Part C steps 2 + 5); Wave-2.1 (shopper identity).

---

## 1. What was implemented

Covers the Wave-2 Audit v2 Part C **steps 2 + 5** (better fbp/fbc coverage + context refresh) and the two ordering defects found in review.

### 1.1 Mirror→context merge on `/tracking/events` (C3 fbp race — step 2)
- **Defect:** the mirror event was the first write of a fresh journey's rotating cookies (fbp/fbc), racing the async `/tracking/context` beacon — a capture with no prior `/context` call yielded an empty context.
- **Fix (backend):** `tracking.controller.ts` now folds `userData.fbp` / `userData.fbc` from every `/tracking/events` body into the journey context via `TrackingContextService.upsertContext` (provider `meta`), best-effort and fire-and-forget so a context failure never fails the event. Guarded to skip when no `ctxId` and no rotating cookies.
- Merge semantics reuse `context-merge.ts` (`ROTATING` set = fbp/fbc/gclid/ttclid/_ga/… → replace-when-newer, never clear), so the beacon and the event can arrive in either order without lost updates.

### 1.2 Context refresh per SPA route (step 5)
- **Storefront** `PageViewTracker.tsx`: `syncContext()` is called on each distinct URL (refresh of url/referrer/ip/ua — `client_ip_address` is a top Meta match key, staleness hurts EMQ), not just first create.
- `lib/tracking.ts` gained `trackPageView()` — fires the browser `PageView` (fbq/ttq/gtag) for subsequent in-SPA route changes (the initial load's PageView stays in the existing init path), de-duped per distinct URL.

### 1.3 Thank-you sync order (C6 correction)
- **Defect (severity: conversion-order):** `ThankYouContent` called `syncContext()` *synchronously after* `trackEvent('Purchase')`, so on a cold journey fbp/fbc could reach the backend *after* the Purchase mirror.
- **Fix:** `syncContext()` now runs **before** `trackEvent('Purchase')`, so the journey context (fbp/fbc/url/referrer) is on the wire first. Combined with 1.1, the Purchase snapshot always has context available at dispatch.

## 2. Files changed (Wave-2.2 scope)
- Backend: `tracking/tracking.controller.ts` (mirror→context merge) · test `tracking/__tests__/tracking.controller.spec.ts` (+2 merge tests).
- Storefront: `lib/tracking.ts` (`trackPageView`, SPA PageView dedupe) · `lib/tracking-client.ts` (context sync per route) · `components/PageViewTracker.tsx` (per-route syncContext + trackPageView) · `app/(main)/checkout/thank-you/ThankYouContent.tsx` (syncContext before Purchase) · tests `lib/__tests__/tracking.spec.ts`, `lib/__tests__/tracking-identity.spec.ts`.

## 3. Verification results
| Check | Result |
|---|---|
| Backend build (`nest build`) | pass (exit 0) |
| Backend full suite (`jest`) | **118 suites / 1118 tests pass** (tracking.controller.spec 19 → 21 tests; +2 merge) |
| Storefront typecheck (`tsc --noEmit`) | pass (exit 0) |
| Storefront suite (`vitest run`) | **43/43 pass** (tracking.spec 7 → 14; tracking-identity 6 → 9) |
| Admin | unchanged in Wave-2.2 |

## 4. Backward compatibility
- Merge is additive and fire-and-forget; beacon and event write to the same ROTATING-set semantics already shipped. Event shape, event_id, hashing, dedup unchanged. No schema change.

## 5. Risks/notes
- **Merge write volume:** one extra best-effort context upsert per browser event with fbp/fbc under the storefront rate-limit policy. Bounded (row-locked per ctxId). Flag for capacity review if browser mirror throughput grows large.
- SPA `trackPageView` is gated by the consent state (see Wave-2.3) — no double-firing, de-duped by URL.