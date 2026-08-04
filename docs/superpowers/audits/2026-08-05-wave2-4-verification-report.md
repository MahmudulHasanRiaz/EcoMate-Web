# Wave-2.4 Verification Report — EMQ Monitoring, Watchdog, Health Score

**Date:** 2026-08-05
**Status:** Implemented + verified (builds, full suites). Not committed. Awaiting architect review.
**Depends on:** Wave-2 Audit v2 (Part D — Dataset-Quality-driven ops view); Wave-2.2 (mirror/context fixes raise captured keys).

---

## 1. What was implemented

Closes the server-side **View of EMQ / dispatch quality** recommended in Wave-2 Audit v2 Part D — as an out-of-band reader, never in the hot dispatch path. All metrics are read-only Prisma aggregates; **no schema change** (schema-less via `TrackingDispatchEvent` counts).

### 1.1 `MonitoringService.getQualityRates(hours)` (MON-3)
One consolidated view over the window:
- Terminal funnel: `sent / deduped / failed / dead / retried`
- `replayed` — dispatch events whose `message` is the replay marker (`replay.service.ts`)
- `dedupRate` = deduped/(sent+deduped) · `retryRate` = RETRY transitions / provider dispatch attempts
- Reuses the pending EMQ proxy (`getEmqProxy`) + browser-mirror stats (`getMirrorCapture`)

### 1.2 `MonitoringService.getWatchdog(hours)` (MON-4)
Actionable SDL alerts over the health + quality views, each with `severity` (`critical`/`warning`/`info`):
| Code | Severity | Trigger |
|---|---|---|
| `relay-backlog` | critical | relay on + oldest pending outbox > 60s |
| `redis-down` | critical | Redis (BullMQ) connection lost |
| `queue-down` | critical | queue job counts unreachable |
| `queue-failed-jobs` | warning | failed jobs > 0 |
| `dead-failure-spike` | warning | FAILED + DEAD > 10 in window |
| `retry-rate-high` | warning | retryRate > 20% |
| `emq-match-gap` | warning | ≥ 50% dispatches lack em/ph (flag `tracking_advanced_matching` reminder) |
| `relay-disabled` / `dispatcher-backed-up` | info | config / back-pressure |

### 1.3 `MonitoringService.getHealthScore(hours)` (MON-4)
0–100 composite clamped from the watchdog penalties (plumbing outages = 20, degradation ≤ 10, config = 5), with an A–F grade and the penalty list as the drill-down.

### 1.4 Admin endpoints + UI
- Backend `monitoring.controller.ts`: `GET …/monitoring/quality`, `…/watchdog`, `…/health-score` (admin-only + `admin_tracking` gate, same as the existing monitoring endpoints).
- Admin `monitoring-api.ts`: typed `EmqProxy`, `QualityRates`, `WatchdogViolation`, `HealthScore` + the three calls.
- Admin `monitoring.tsx`: **Health Score** card (score + grade + penalties), **Watchdog Alerts** card (severity-colored list), **EMQ & Dispatch Quality** card (dedup/retry rates, replays, FAILED/DEAD, EMQ gap %, flagged dispatches, sent, windowed). Watchdog + health-score poll every 60s for live ops.

## 2. Files changed (Wave-2.4 scope)
- Backend: `tracking/monitoring.service.ts` (3 methods + types) · `tracking/monitoring.controller.ts` (3 endpoints) · tests `tracking/__tests__/monitoring.service.spec.ts` (+8), `monitoring.controller.spec.ts` (+5).
- Admin: `features/settings/tracking/monitoring-api.ts` · `features/settings/tracking/monitoring.tsx`.

## 3. Verification results
| Check | Result |
|---|---|
| Backend build (`nest build`) | pass (exit 0) |
| Backend full suite (`jest`) | **118 suites / 1118 tests pass** (monitoring.service.spec 20 → 27; +monitoring.controller.spec 16 → 21) |
| Admin typecheck (`tsc --noEmit`) | pass (exit 0) |
| Storefront | unchanged in Wave-2.4 (no regressions: 43/43) |

## 4. Backward compatibility
- Read-only additive endpoints + UI cards; no dispatch-path changes, no schema, no PII surfaced. The internal EMQ proxy remains labelled "internal at-risk rate" — **not** Meta's authoritative Dataset Quality score (that requires the Graph API reader, still out-of-band).

## 5. Risks/notes
- **EMQ proxy ≠ Meta score:** `noEmPhShare` is locally computed from our own `match-key quality:` dispatch events. Recommend wiring the Dataset Quality API reader (Part D) as the authoritative ≥6.0 / coverage ≥75% alert.
- **Thresholds are constants** (`RELAY_STALE_SEC=60`, `DEAD_FAILURE_SPIKE=10`, `RETRY_RATE_MAX=0.2`, `EMQ_GAP_MAX=0.5`) — tune per production baseline.
- `+getQualityRates` runs several aggregate queries per window; fine for a dashboard, not for hot paths.