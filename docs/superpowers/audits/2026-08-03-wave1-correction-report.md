# Wave-1 Correction Verification Report

**Date:** 2026-08-04
**Branch/worktree:** `claude/peaceful-leavitt-47d1cd` (uncommitted; tree = Wave-1 + this correction set)
**Status:** Verification report only. No further code changes made at this stage (per Architect instruction).

---

## 1. Checklist of the five requested fixes

| # | Fix | Status |
|---|---|---|
| 1 | **EMQ guard: never skip/suppress dispatch.** Do not return `null`, do not mark `SKIPPED`, based on the current identity model. Wave-1 only emits quality flags + monitoring events + diagnostics. | **Applied** |
| 2 | **Feature-flag defaults.** Only the 7-day event-age guard may be default-ON. The EMQ guard must default OFF / not be enforced until the Wave-2 identity architecture. | **Applied** |
| 3 | **Coverage KPI rename.** Not Meta coverage — rename to "Browser Mirror Capture" (mirror-capture ratio). | **Applied** |
| 4 | **external_id metric rename.** It measures TrackingContext availability, not external_id dedup → `context_external_id`. | **Applied** |
| 5 | **Relay health expansion.** `/health` must report relay + Redis + BullMQ worker + dispatcher, not just `relayEnabled`. | **Applied (code)** — see issue A: associated test not fully migrated → 1 test failing. |

No fix was "Unable to apply". Fix 5 is applied in source; its verification is incomplete (1 failing unit test, described in §5).

---

## 2. Files modified (per fix)

**Fix 1 — EMQ no-skip** (reverted/adjusted the earlier safety guard to diagnostics-only):
- `apps/backend/src/tracking/adapters/meta.adapter.ts` — `build()` no longer returns `null` for identity reasons; emits `qualityFlags: ['NO_EM_PH']` / `['NO_EM_PH','NO_IDENTITY']`; still returns `null` only for unsupported-type / no-dedup-id (legitimate, unrelated to identity).
- `apps/backend/src/tracking/adapters/tracking-provider.adapter.ts` — removed `AdapterBuildOptions`; `build()` back to 3-arg; kept `ProviderPayload.qualityFlags`.
- `apps/backend/src/tracking/tracking-dispatcher.service.ts` — removed `buildOpts`, `emPhGuardEnabled()`, and the `AdapterBuildOptions` import; kept the informational quality-flag dispatch event (monitoring/diagnostics only).
- `apps/backend/src/tracking/__tests__/meta.adapter.spec.ts` — updated to assert diagnostics-only behavior.

**Fix 2 — Flag defaults**:
- `apps/backend/src/tracking/tracking-dispatcher.service.ts` — only `ageGuardEnabled()` remains (`tracking_event_age_guard`, default ON). No `tracking_em_ph_guard` read exists in Wave-1, so the EMQ guard is not enforced; its flag is effectively reserved (default OFF) for Wave-2. No new read introduced.
- (Helper `isEnabledOrDefault` added earlier remains; no default change to it.)

**Fix 3 — Coverage → Browser Mirror Capture**:
- `apps/backend/src/tracking/monitoring.service.ts` — `getCoverage` → `getMirrorCapture`, `browserRatio` → `browserMirrorRatio`, `CoverageStats` → `MirrorCaptureStats`.
- `apps/backend/src/tracking/monitoring.controller.ts` — `/coverage` → `/mirror-capture`.
- `apps/backend/src/tracking/__tests__/monitoring.service.spec.ts` + `monitoring.controller.spec.ts` — renamed tests/endpoints.
- `apps/admin/src/features/settings/tracking/monitoring-api.ts` — `MirrorCaptureStats`, `mirrorCapture()`.
- `apps/admin/src/features/settings/tracking/monitoring.tsx` — "Browser Mirror Capture" card; `monitoringApi.mirrorCapture()`; ratio label "Mirror ratio".
- `apps/admin/src/features/settings/tracking/monitoring.test.tsx` — mock/assertions updated.

**Fix 4 — external_id metric rename**:
- `apps/backend/src/tracking/monitoring.service.ts` — key `'external_id'` → `'context_external_id'` (counts TrackingContext rows); `DedupKeyUsageRow.key` union updated.
- `apps/backend/src/tracking/__tests__/monitoring.service.spec.ts` — assertion updated.
- `apps/admin/src/features/settings/tracking/monitoring-api.ts` — key union updated.
- `apps/admin/src/features/settings/tracking/monitoring.tsx` — card retitled "Identifier Usage"; label map renders `context external_id (availability)` / `fbp (contexts)` / `fbc (contexts)`.
- `apps/admin/src/features/settings/tracking/monitoring.test.tsx` — label assertions updated.

**Fix 5 — Relay health expansion**:
- `apps/backend/src/tracking/monitoring.service.ts` — new `getRuntimeHealth()` returning `{ relay, redis, queue, dispatcher }`; injected `@InjectQueue('tracking')`; `redisConnected()` via `queue.redisVersion`; `getQueueHealth()` via `queue.getJobCounts()`; new types `RedisHealth/QueueHealth/DispatcherHealth/RuntimeHealth`.
- `apps/backend/src/tracking/monitoring.controller.ts` — `/health` now returns `{ relayHealth, redisHealth, queueHealth, dispatcherHealth }`.
- `apps/backend/src/tracking/__tests__/monitoring.controller.spec.ts` — health endpoint test updated to the expanded shape.
- `apps/backend/src/tracking/__tests__/monitoring.service.spec.ts` — runtime-health tests added; **one test not fully migrated (see §5)**.
- `apps/admin/src/features/settings/tracking/monitoring-api.ts` — `HealthResponse`, `RedisHealth`, `QueueHealth`, `DispatcherHealth`.
- `apps/admin/src/features/settings/tracking/monitoring.tsx` — Pipeline Health panel now shows Relay, Redis, Queue (wait/act/failed), Dispatcher sending.

---

## 3. Tests run and results

| Check | Command | Result |
|---|---|---|
| Backend build (typecheck) | `npx nest build` (apps/backend) | **Pass** (exit 0) |
| Affected backend specs | `npx jest` meta.adapter, monitoring.service, monitoring.controller, tracking-dispatcher, tracking-settings | **93 passed, 1 failed** (5 suites: 4 pass, 1 fail) |
| Full backend suite | not re-run after the correction set | **Pending** |
| Admin vitest + admin build | not re-run after the correction set | **Pending** |
| Storefront | no changes in this work | not applicable |

The one failing test is `monitoring.service.spec.ts › getRuntimeHealth degrades redis/queue when the queue is unreachable` (see §5).

---

## 4. Confirmations

- **No unrelated files modified.** `git status` shows only: backend `src/tracking/*` (6 production + 1 new `sanitize.ts`), backend `__tests__/tracking/*` (5), admin `settings/tracking/*` (3), and the two previously-written Wave-1 audit docs. No `package.json`, no schema, no `.env`, no storefront/POS/capacitor files.
- **No existing functionality changed outside the requested scope.** Corrections only (a) removed the previously-introduced EMQ skip back to the architect-approved diagnostics-only behavior, (b) renamed the two metrics/endpoints, (c) expanded the health endpoint. No change to capture, dispatch, retry, replay, dedup keys, hashing, parity, or the 7-day age guard.
- **No duplicate tracking paths introduced.** This set renames/expands existing endpoints and metrics; it adds no new capture or dispatch path. The dispatch/event flow is unchanged.
- **No regressions expected from scoped changes** — full-suite confirmation is pending (see §3).

---

## 5. Unexpected issues found (reported separately, NOT fixed)

1. **Failing unit test (Fix 5 verification gap).** `monitoring.service.spec.ts:298` still calls `queue.getRedisVersion.mockRejectedValue(…)`, but the mocked `queue` object was updated to a `redisVersion` property (there is no `getRedisVersion` anymore — BullMQ exposes `redisVersion`). The other `getRuntimeHealth` tests pass; this degrade test needs one line updated to simulate redis-down via `redisVersion` (e.g. set to `undefined`) and re-run. This is a test-only fix; I did **not** touch it per your instruction.
2. **Stale doc comment (cosmetic, non-behavioral).** `monitoring.service.ts` (~lines 234-237) `getDedupUsage` JSDoc "Approximation note" still reads "`event_id` and `external_id` count snapshots … `external_id` is counted when the raw payload stores one." That description no longer matches the corrected `context_external_id` (TrackingContext-availability) semantics. Documentation-only; no behavior impact. Not changed.

These two are intentionally left unfixed pending your review.

---

## Recommendation

Approve the single-line test fix (#1) plus the stale-comment cleanup (#2), then I will re-run the affected tests, the full backend suite, and the admin vitest + build, and submit a green corrected Wave-1.