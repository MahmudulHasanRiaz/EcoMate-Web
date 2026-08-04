# Wave-2.1 Verification Report — Customer Identity & external_id (Candidate B)

**Date:** 2026-08-04
**Status:** Implemented + verified (builds, full suites). Not committed. Awaiting architect review.
**Depends on:** Wave-2 Audit v2 (frozen); Wave-2.1 Plan Rev-2 (approved — 6 architect corrections incorporated).

---

## 1. What was implemented

### 1.1 Identity model (Correction 1, 2, 4)
- **Schema:** `CustomerProfile.externalId String? @unique` — nullable, opaque UUID, lazily assigned. Additive migration `20260804000000_add_customer_external_id`.
- **`IdentityResolutionService`** (new, centralized — Correction 4): the single authoritative component resolving `external_id` for every channel (Web/Admin/POS/Public API/Mobile flow through the shared capture→dispatcher path). Methods:
  - `ensureForCustomer(customerId, tx?)` — lazy idempotent uuid assignment (P2002-safe).
  - `resolveForOrder(customerId, ctxExternalId)` — **identity-binding at dispatch** (Correction 2): flag ON + customer → stable customer `external_id`; else journey uuid. **No TrackingContext rows are rewritten.**
  - `resolveForShopper(betterAuthUserId)` — the correct shopper source for the Pixel (NOT `/auth/me`, which is the admin UserProfile — Correction 3 verification).
- **Dispatcher:** resolves external_id per order via `IdentityResolutionService`, overriding the journey uuid for order-bound customer events (flag-gated).
- **Capture payloads:** added `customerId` to Purchase/Refund/offline-purchase snapshots (additive) so resolution is per-order.

### 1.2 Merge/split (Correction 1)
- **Not implemented.** The model is future-compatible only: the opaque mutable `externalId` + the centralized resolver means a future merge only reassigns `CustomerProfile.externalId` and every channel follows. No `mergeCustomers`, no split logic, no admin UI in Wave-2.1.

### 1.3 Pixel propagation (Correction 3, verified, no re-init)
- **Verified:** `/auth/me` returns the admin `UserProfile` — NOT the shopper. The shopper's `external_id` belongs to `CustomerProfile` (via `betterAuthUserId`). So a new authenticated route `GET /tracking/identity` was added (tracking controller, global guard, NOT `@Public`), resolving the shopper's CustomerProfile via the Better Auth session → `external_id` (null when flag off / no profile).
- **No Pixel re-init.** Storefront `setPixelIdentity(ext)` sets a load-time global; the inline `fbq('init', metaId, { external_id })` reads it at init. If the identity resolves after lazy-load init, it applies on the next page load (documented limitation — Meta does not support reliable re-init). Guests stay parameterless.

### 1.4 Tenant isolation + license (Correction 5)
- `external_id` is a global UUID → no cross-tenant collision.
- Gated by `tracking_customer_external_id` (settings/env, **default OFF**) — same model as `tracking_relay_enabled`; no new license key required (the tracking feature grant is unchanged). Verified the feature/license model in `packages/shared-types/src/license-types.ts`.

### 1.5 Lifecycle (Correction 6)
Extended and documented in the plan: guest→auth claim (new contexts; no historical rewrite), deletion (unchanged path), re-registration (fresh id), cross-channel continuity (single resolver).

## 2. Files changed (Wave-2.1 scope only)
- Backend: `prisma/schema.prisma` · `prisma/migrations/20260804000000_add_customer_external_id/migration.sql` (new) · `tracking/identity-resolution.service.ts` (new) · `tracking/tracking-dispatcher.service.ts` (resolve via service) · `tracking/tracking.controller.ts` (`GET /tracking/identity`, inject service) · `tracking/tracking.module.ts` (provide+export) · `tracking/tracking-snapshot.types.ts` (`customerId`) · `orders/orders.service.ts` + `checkout-leads/checkout-leads.service.ts` (`customerId` in payload).
- Backend tests: `identity-resolution.service.spec.ts` (new) · `tracking-dispatcher.service.spec.ts` (+identity mock +2 binding tests) · `tracking.controller.spec.ts` (+identity mock +3 route tests).
- Storefront: `lib/tracking.ts` (`setPixelIdentity`, global decl) · `components/TrackingScripts.tsx` (useAuth + identity fetch + init param).

**No unrelated files/modules touched** beyond the above (the feed hotfix from the prior approved task is separate).

## 3. Verification results
| Check | Result |
|---|---|
| Backend build (`nest build`) | pass (exit 0) |
| Backend full suite (`jest`) | **117 suites / 1080 tests pass** (was 116/1064; +1 suite, +16 tests) |
| Storefront typecheck (`tsc --noEmit`) | pass (exit 0) |
| Storefront suite (`vitest run`) | **25/25 pass** |
| Admin | unchanged in Wave-2.1 (flag set via settings/env) |

## 4. Backward compatibility
- Flag OFF (default) → byte-identical behavior: dispatcher falls back to the journey uuid, `/tracking/identity` returns null, Pixel init stays parameterless. Guests unchanged. Event shape/event_id/hashing/dedup unchanged. Schema additive + nullable; no data rewrite.

## 5. Risks/notes
- **Per-dispatch flag read:** `resolveForOrder` checks the settings flag each dispatch (one `systemSetting` read). Minor; flag it for a short-lived cache if TPS grows. Not changed here (scope discipline).
- **Pixel external_id timing:** best-effort at load; documented limitation (no re-init).
- **Deletion coverage:** unchanged (abandoned pre-auth contexts remain out of reach — pre-existing limitation, not worsened). Context rows are not rewritten (identity-binding).

## 6. Awaiting review
Wave-2.1 implemented + verified. **Not committed.** Awaiting architect approval to commit and/or proceed to the next wave (Wave-2.2: consent/opt_out + Advanced Matching + Datacenter). The architect's approval rule: no commit without approval.