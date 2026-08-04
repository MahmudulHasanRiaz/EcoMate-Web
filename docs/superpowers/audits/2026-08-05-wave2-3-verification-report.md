# Wave-2.3 Verification Report — Consent / Opt-out / Advanced Matching (Pixel)

**Date:** 2026-08-05
**Status:** Implemented + verified (builds, full suites). Not committed. Awaiting architect review.
**Depends on:** Wave-2 Audit v2 (Part C step 3 — post-consent AM); Wave-2.1 (identity endpoints); Wave-2.2 (context coverage).

---

## 1. What was implemented

Covers the Wave-2 Audit v2 Part C **step 3** (Advanced Matching on Pixel, post-consent) plus the consent/opt-out infrastructure it requires. Everything is flag-gated **default OFF** → zero behavior change until explicitly enabled.

### 1.1 Server — `/tracking/config` (public, read-only)
- New `GET /tracking/config` (public, storefront rate-limit policy) returns `{ consentRequired, advancedMatching, externalIdEnabled }` from settings/env with **no secrets, no provider ids**:
  - `tracking_consent_required` / `TRACKING_CONSENT_REQUIRED` (default false)
  - `tracking_advanced_matching` / `TRACKING_ADVANCED_MATCHING` (default false)
  - externalId readiness delegates to `IdentityResolutionService.isEnabled()`

### 1.2 Server — Advanced Matching hashes on `/tracking/identity`
- `IdentityResolutionService.resolveAdvancedMatching(betterAuthUserId)` (new): flag-gated; when ON and the session is linked to a `CustomerProfile`, returns `{ em?, ph? }` — **SHA-256 hashes via `TrackingNormalizer`** (email trim/lowercase; phone E.164 BD-coded), so browser hashes match server-side hashes byte-for-byte.
- `GET /tracking/identity` response extended to `{ externalId, em?, ph? }` (additive; legacy shape preserved). The storefront calls it ONLY after the visitor granted consent — server flag is the default-off guard, client gating enforces consent.

### 1.3 Storefront — consent/opt-out state machine (`lib/tracking.ts`)
- Module state: `_consentRequired` (false), `_consentGranted` (true), `_optOut` (read from cookie `ecomate_tracking_optout` on client).
- `setConsent(required, granted)` · `setTrackingConsent(granted)` (persists `localStorage.ecomate_tracking_consent` = 'granted'|'revoked') · `isTrackingAllowed()` (`!_optOut && !(consentRequired && !granted)`).
- **Gate:** `trackEvent` (no pixel send, no mirror POST), `initMetaPixel`, and `syncContext` all no-op when `!isTrackingAllowed()`. Consent UI may flip state at any time via `window.__ecomateSetConsent` (exposed by `TrackingScripts`); a revoked state suppresses the pixel on next load.
- `setPixelIdentity(externalId?, em?, ph?)`: extends the armed Meta init with `external_id`, `em`, `ph`; values held for the next load when init already fired (no re-init — documented Wave-2.1 limitation).

### 1.4 Storefront — `TrackingScripts` gating
- On mount, fetches `/tracking/config`; when `consentRequired` is true, grants only if localStorage says `'granted'`; renders nothing (all scripts suppressed) until config resolves AND `isTrackingAllowed()`.
- Identity flow now passes `em`/`ph` into `setPixelIdentity` alongside `externalId`.

## 2. Files changed (Wave-2.3 scope)
- Backend: `tracking/identity-resolution.service.ts` (`resolveAdvancedMatching`) · `tracking/tracking.controller.ts` (`/config`, identity AM) · tests `tracking/__tests__/identity-resolution.service.spec.ts` (+4), `tracking/__tests__/tracking.controller.spec.ts` (+3).
- Storefront: `lib/tracking.ts` (consent state, gating, AM init fields) · `lib/tracking-client.ts` (syncContext gate) · `components/TrackingScripts.tsx` (config fetch, consent decision, `__ecomateSetConsent`, AM identity) · tests `lib/__tests__/tracking.spec.ts` (+7), `lib/__tests__/tracking-identity.spec.ts` (+3).

## 3. Verification results
| Check | Result |
|---|---|
| Backend build (`nest build`) | pass (exit 0) |
| Backend full suite (`jest`) | **118 suites / 1118 tests pass** |
| Storefront typecheck (`tsc --noEmit`) | pass (exit 0) |
| Storefront suite (`vitest run`) | **43/43 pass** |
| Admin | unchanged (flags set via settings/env) |

## 4. Backward compatibility
- All three flags default OFF → identity returns `{ externalId: null }`-shaped legacy payload, Pixel init stays parameterless, no consent UI is required, and browser/mirror events flow exactly as before. Opt-out cookie and localStorage keys are inert when no consent is required.

## 5. Risks/notes
- **No consent UI yet:** the state machine + `__ecomateSetConsent` hook exist, but no banner/cookie-policy component ships in this wave. Consent enforcement becomes active only when `tracking_consent_required` is enabled AND a UI calls the hook.
- **AM + flag timing:** if `tracking_advanced_matching` is toggled on, existing sessions pick it up at next load (config fetched on mount).
- **Phone normalization:** `hashPhone` uses BD default country code (current store market); a multi-country rollout must pass the profile's country (already handled for `ph` via E.164 stored values).
- Per-dispatch/per-request settings reads remain uncached (same note as Wave-2.1; cache if TPS grows).