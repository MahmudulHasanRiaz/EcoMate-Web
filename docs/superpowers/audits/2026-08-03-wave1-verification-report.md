# Wave-1 Verification Report — Critical Safety & Production Hardening

**Date:** 2026-08-03
**Branch:** `claude/peaceful-leavitt-47d1cd`
**Precondition:** verification ran in a fresh worktree with the repo's `node_modules` symlinked in (no package changes). No database, Redis, or real Meta pixel available in this sandbox.

---

## 1. Automated verification (executed)

| Check | Command | Result |
|---|---|---|
| Backend build (typecheck) | `npx nest build` (apps/backend) | ✅ exit 0 |
| Backend full suite | `npx jest` (apps/backend) | ✅ **116 suites / 1063 tests passed** |
| Modified backend specs (targeted) | dispatcher, meta.adapter, monitoring.service, monitoring.controller, tracking-settings | ✅ 75 + 17 targeted, all green |
| Admin build | `npm run build --workspace=admin` | ✅ exit 0 |
| Admin monitoring test | `npx vitest run .../monitoring.test.tsx` | ✅ 7 passed |
| Admin full suite | `npx vitest run` (apps/admin) | ✅ **31 files / 185 tests passed** |
| Storefront | unchanged in Wave-1 | not run (no storefront edits) |

Regression surface: backend +17 tests, admin +2 assertions vs the pre-Wave baseline; **zero pre-existing tests modified in semantics** (only the monitoring `external_id` assertion updated to the corrected metric, and test mocks extended for the new endpoints/guards).

## 2. What the new tests prove

- **meta.adapter.spec** — EMQ guard: no-identity → `null` (default); `enforceIdentity:false` → flag-only `['NO_EM_PH','NO_IDENTITY']`; no em/ph but external_id+ip → still built + `['NO_EM_PH']`; em present → no flag.
- **tracking-dispatcher.service.spec** — age guard: website event > 7 d → outbox `DEAD` with `event-time guard` reason and **no provider send**; physical_store within 62 d → dispatches; guard off → old event dispatches (backward compatible); adapter `qualityFlags` → informational `match-key quality: NO_EM_PH` dispatch event appended.
- **monitoring.service.spec** — `external_id` dedup row now counts contexts (never the dead `payload.externalId` path); `getRelayHealth` (on/off, pending/claimed, oldest age); `getCoverage` (browser ratio incl. zero-total case).
- **monitoring.controller.spec** — `/health` and `/coverage` endpoints + overview now carries `relayHealth`.
- **tracking-settings.service.spec** — `isEnabledOrDefault` default-true, explicit value, env fallback.
- **admin monitoring.test.tsx** — Pipeline Health + Coverage panels render with the new fields.

## 3. Success-criteria mapping (Decision Addendum S1–S13)

Wave-1 is a hardening wave; the code/automation portion is verified now, the live Meta portion is a pre-production gate:

| Criterion | Wave-1 status |
|---|---|
| S1–S3 Browser/Server Purchase + Pixel/CAPI dedup | **Not applicable to Wave-1** (no identity/parity change). Baseline behavior preserved; regression suites green. |
| S4 EMQ improved | Partially advanced — `NO_EM_PH`/`NO_IDENTITY` are now observable flags + SKIP for degenerate payloads; **EMQ ≥ 6.0 measurement requires Events Manager (staging)**. |
| S5 external_id lifecycle | **Out of Wave-1 scope** (Wave 2). |
| S6 Retry / S7 Replay | Unchanged by Wave-1; existing dispatcher/replay suites green. Age-guard DEAD follows the normal DEAD/replay path. |
| S8 Monitoring verified | ✅ `external_id` metric fixed (no longer always 0); relay health + coverage KPIs added; funnel/volume/freshness suites green. |
| S9 Payload Helper / S10 Events Manager / S11 Test Events | **Staging gate** — requires a real (non-prod) Meta pixel + Events Manager. Documented pre-production checklist in Implementation Notes §1.8. |
| S12 No regression | ✅ Backend 1063 / Admin 185 / both builds green. |
| S13 Production compatibility | ✅ No schema/migration, no downtime, feature flags default-safe, additive endpoints; rollback = set flags `'false'`. |

## 4. Known remaining items (documented, not blocking code)

1. **Live staging verification** (Payload Helper, Events Manager, Test Events, EMQ score, dedup tab) — needs credentialed staging; the single outstanding gate before production.
2. **Admin UI toggles** for `tracking_event_age_guard` / `tracking_em_ph_guard` — follow-up (flags are operable via settings API/env today).
3. **Infrastructure log redaction** for `access_token=`/`api_secret=` in proxy/CDN access logs — ops action (Decision D; code-side sanitize is defense-in-depth only).
4. **Default-on safety guards** — `tracking_event_age_guard` and `tracking_em_ph_guard` default to ON (deliberate, documented; disable with explicit `'false'`). Confirm acceptance at Wave review.

## 5. Rollback / revert

- Each new behavior is a one-flag switch (`'false'`) — no deploy needed to disable.
- New endpoints/fields are additive; removing them is a trivial revert.
- No migration, no data mutation, no identity-model change.

---

**Wave-1 is code-complete and verified (builds + full suites).** Awaiting architect approval before Wave-2 (Identity & Matching) begins.
