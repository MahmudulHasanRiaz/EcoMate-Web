# Wave-1 Implementation Notes — Critical Safety & Production Hardening

**Date:** 2026-08-03
**Branch:** `claude/peaceful-leavitt-47d1cd` (worktree `peaceful-leavitt-47d1cd`)
**Scope:** Wave-1 of the frozen Meta Tracking implementation plan (Decision Addendum §Implementation Guardrails/Success Criteria). **Identity model unchanged** — external_id stays per-journey; Wave 2 owns identity.
**State:** code-complete, builds + full suites green. Not committed. **No runtime/staging verification yet** (needs credentialed Meta pixel — see Verification Report).

---

## 1. What shipped (per Wave-1 item)

### 1.1 Relay go-live safeguards + health alerts (R1 / I9)
- **New monitoring surface** `GET /tracking/admin/monitoring/health` → `{ relayHealth: { relayEnabled, pendingCount, claimedCount, oldestPendingAgeSec } }`.
  - `relayEnabled` = current `tracking_relay_enabled` setting/env.
  - `oldestPendingAgeSec` = age past-due of the most-overdue PENDING outbox (the claim predicate is `nextAttemptAt <= now`); **this is the alert source** for a stalled pipeline.
- `GET /tracking/admin/monitoring/overview` now also returns `relayHealth` (additive — backward compatible).
- The relay's existing boot warning (`tracking_relay_enabled is not 'true'; relay not started`) remains the operator gate.
- Files: `monitoring.service.ts` (`getRelayHealth`), `monitoring.controller.ts` (`/health`), `monitoring-api.ts` + `monitoring.tsx` (Pipeline Health panel, 60 s auto-refresh).

### 1.2 Monitoring fixes (H4 / I13)
- **Fixed `getDedupKeyUsage` `external_id` metric.** Previously counted snapshots whose `payload.externalId` exists — a field **no capture ever writes** → the row was always 0. Now counts `TrackingContext` rows in the window (every context carries an `external_id`), consistent with the existing fbp/fbc context-count approximation. Response shape unchanged (`{key, events}`) → admin UI keeps working.
- File: `monitoring.service.ts`.

### 1.3 Coverage KPI (H4 / I14)
- **New endpoint** `GET /tracking/admin/monitoring/coverage?hours=N` → `{ coverage: { totalSnapshots, browserOrigin, serverOrigin, browserRatio } }`.
  - `browserOrigin` = outbox rows whose `configSnapshot.source === 'browser'` (the browser-mirror capture path).
  - `browserRatio` = browser-origin / total — the server-side proxy for Pixel↔CAPI mirror-capture reliability. (Meta's own ≥75% coverage target lives in Events Manager and is the authoritative view.)
- Admin "Browser ↔ CAPI Coverage" panel added.
- Files: `monitoring.service.ts` (`getCoverage`), `monitoring.controller.ts` (`/coverage`), admin panel.

### 1.4 7-day event-age guard (R2)
- **Dispatcher** now terminal-DEADs an event whose `event_time` is older than 7 days for web (`action_source` `website`/null) or 62 days for `physical_store` — before any provider send — with the reason recorded on the outbox (`lastError`) and a dispatch-event; it also writes the replay archive (PII-stripped) as usual for DEAD rows.
- **Rationale (Decision B):** Meta rejects a request whose web event_time is older than 7 days; DEAD-with-reason is strictly better than a guaranteed-rejected send (and visible in DLQ/monitoring).
- **Feature flag:** `tracking_event_age_guard` (system_setting) / env `TRACKING_EVENT_AGE_GUARD`, **default ON**.
  - ⚠️ **Deliberate deviation from the "default = current behavior (off)" guardrail:** this is a *safety guard*, not a new capability — it only affects events Meta would reject anyway, so enabling it by default cannot regress valid events. An explicit `'false'` disables it per server. This choice is logged here for the architect.
- Files: `tracking-dispatcher.service.ts` (constants `WEB_EVENT_AGE_DAYS=7`, `OFFLINE_EVENT_AGE_DAYS=62`, guard in `run()`, `ageGuardEnabled()`), `tracking-settings.service.ts` (`isEnabledOrDefault`).

### 1.5 Token log redaction (H4 / I15)
- **New shared util** `sanitize.ts` → `sanitizeProviderText()` strips `access_token=`, `api_secret=`, `accessToken=`, `appsecret=` credential patterns from any provider text before it is persisted (`responseBody`/`errorMsg`).
- Applied in **Meta** (access token in URL query) and **GA4** (api_secret in URL query). TikTok/Google Ads carry no secret in the request URL, so their stored responses are not at the same risk.
- **What this does NOT do (documented):** the Meta token still travels in the Graph request URL query string — that is the officially documented transport (Decision D) and cannot be removed code-side. The primary mitigation remains **infrastructure access-log redaction** (CDN/proxy log scrubbing of `access_token=`/`api_secret=`). This util is defense-in-depth against a provider echoing a credential back.

### 1.6 EMQ quality flags (Decision C)
- **`MetaAdapter.build()`** now:
  - Computes `hasContact` (`em`/`ph`) and `hasOtherIdentity` (`external_id`/`fbp`/`fbc`/`client_ip_address`/`client_user_agent`).
  - **No em/ph + other identity present → still builds** the payload (Meta accepts it, lower EMQ) and tags it `qualityFlags: ['NO_EM_PH']`.
  - **No identity at all → returns `null`** (dispatch `SKIPPED`, the existing refusal path) when the `enforceIdentity` guard is on; in flag-only mode it builds with `['NO_EM_PH','NO_IDENTITY']`.
- **`TrackingProviderAdapter`** gains `ProviderPayload.qualityFlags?: string[]` and optional `AdapterBuildOptions { enforceIdentity? }`; `build()` takes an optional 4th `opts` arg (backward compatible — the other three adapters ignore it).
- **Dispatcher** passes `{ enforceIdentity: await emPhGuardEnabled() }` to `build()`, and appends an **informational `TrackingDispatchEvent`** (`SENDING→SENT`, message `match-key quality: NO_EM_PH`) on a successful flagged send — visible in the per-event monitoring timeline.
- **Feature flag:** `tracking_em_ph_guard` (system_setting) / env `TRACKING_EM_PH_GUARD`, **default ON** (same rationale as the age guard; flag-only fallback preserves the exact prior send-anyway behavior if ever needed).
- Files: `tracking-provider.adapter.ts`, `meta.adapter.ts`, `tracking-dispatcher.service.ts`.

### 1.7 Feature flags
- New setting/env gates (documented for ops):
  - `tracking_event_age_guard` / `TRACKING_EVENT_AGE_GUARD` (default on)
  - `tracking_em_ph_guard` / `TRACKING_EM_PH_GUARD` (default on)
- New `TrackingSettingsService.isEnabledOrDefault(key, default, envKey?)` helper (absent → default; `'true'` → on; else off).
- Health/coverage endpoints are read-only aggregates — no flag needed.
- Admin UI toggles for the two new flags are **not** added in Wave 1 (they are set via the settings API/env; an admin toggle is a low-priority follow-up).

### 1.8 Runtime verification improvements
- The new `/health` + `/coverage` endpoints ARE the runtime-verification surface (alert on relay-off/backlog; measure mirror coverage).
- Regression tests added for every behavior (see Verification Report).
- The live staging verification (Test Events / Events Manager / Payload Helper) is out of scope for the sandbox and documented as a pre-production gate.

---

## 2. Guardrail compliance

| Guardrail | Status |
|---|---|
| Zero regression | Backend 116 suites / 1063 tests green; Admin 31 files / 185 tests green; both builds green. Storefront untouched. |
| Backward compatibility | All API responses additive (`relayHealth` on overview); endpoints new; `build()` 4th arg optional; settings default preserve prior behavior for accepted events; the age guard only affects events Meta would reject. |
| Browser/server parity | Unchanged — no edits to event naming, ids, mirror, or hashing. |
| Replay compatibility | DEAD rows still archive (PII-stripped) + version-pinned; age-guard DEAD is a normal DEAD path (replayable in principle, same event_id). |
| Feature flags | `tracking_event_age_guard`, `tracking_em_ph_guard` (both with env fallback). See §1.4 deviation note (default-on safety guards). |
| Rollback | Both flags can be set `'false'` per server with no deploy; new endpoints are additive; sanitize is inert unless a credential appears; monitoring metric change is cosmetic. |
| Zero downtime | Additive schema-free changes; no migration, no blocking writes; stateless relay/dispatcher. |
| Production data preservation | No data deletes/alters; no schema change; only new reads + new informational dispatch-events. |
| Runtime verification after every major change | Automated tests + builds done; live Meta verification pending credentialed staging (documented). |
| No undocumented behavioral changes | This file is the change log; the only behavior deltas are the two default-on safety guards (both documented) and the informational quality-flag event. |

---

## 3. Files changed

Backend (`apps/backend/src/tracking/`):
- `tracking-settings.service.ts` — `isEnabledOrDefault` (additive).
- `tracking-provider.adapter.ts` — `ProviderPayload.qualityFlags`, `AdapterBuildOptions`, `build()` opts arg.
- `meta.adapter.ts` — EMQ identity guard + flags + sanitize on stored response.
- `ga4.adapter.ts` — sanitize on stored response.
- `tracking-dispatcher.service.ts` — 7-day/62-day age guard (DEAD), `buildOpts` pass-through, quality-flag dispatch event, flag helpers.
- `monitoring.service.ts` — external_id metric fix, `getRelayHealth`, `getCoverage`.
- `monitoring.controller.ts` — `/health`, `/coverage`, overview + relayHealth.
- `sanitize.ts` — NEW credential redaction util.

Admin (`apps/admin/src/features/settings/tracking/`):
- `monitoring-api.ts` — `RelayHealth`, `CoverageStats`, `health()`, `coverage()`, overview `relayHealth`.
- `monitoring.tsx` — Pipeline Health + Browser↔CAPI Coverage panels.
- `monitoring.test.tsx` — mocks + assertions for the new panels.

Tests:
- Backend: `meta.adapter.spec.ts`, `tracking-dispatcher.service.spec.ts`, `monitoring.service.spec.ts`, `monitoring.controller.spec.ts`, `tracking-settings.service.spec.ts`.
- Admin: `monitoring.test.tsx`.
