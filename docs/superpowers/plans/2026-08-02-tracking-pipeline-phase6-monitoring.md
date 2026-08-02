# CAPI Tracking Pipeline — Phase 6: Admin Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A functional Admin monitoring dashboard for the tracking pipeline — backend aggregate endpoints + a React admin page showing volume, dispatch funnel, DEAD/DLQ, retry histogram, dedup usage, freshness, and a per-event timeline.

**Architecture:** Phase 6 of the approved design (`docs/superpowers/specs/2026-08-02-ecomate-capi-redesign-design.md`, §14). KPIs are "pure Prisma over the new tables + BullMQ job counts — no external metrics stack"; heavy aggregations may use nightly pre-aggregation (deferred to a later optimization — live queries over the existing indexes are fine at this phase's volume). The `admin_tracking` feature key (Phase 5) gates the endpoints.

**Tech Stack:** NestJS (backend), React 19 + TanStack Query + Vitest (admin).

## Global Constraints

- **Backend rules:** DTOs with `class-validator`; thin controllers; `@Roles('admin')` + `@RequiresFeature('admin_tracking')`; `npm run build --workspace=backend`; Jest.
- **Admin rules:** `npm run build --workspace=admin`; Vitest for targeted tests; follow the existing admin settings-page patterns (`apps/admin/src/features/settings/...`).
- **Privacy:** endpoints return aggregates + sanitized error messages only — no raw PII, no provider tokens.

---
## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/backend/src/tracking/monitoring.service.ts` | Create | Aggregate queries over tracking tables |
| `apps/backend/src/tracking/monitoring.controller.ts` | Create | `/tracking/admin/monitoring/...` endpoints |
| `apps/admin/src/features/settings/tracking/monitoring.tsx` | Create | Admin page (KPIs + timeline search) |
| `apps/admin/src/features/settings/tracking/index.tsx` | Modify | route/entry to the monitoring page |
| `apps/backend/src/tracking/__tests__/monitoring.service.spec.ts` | Create | tests |

---
### Task 1: MonitoringService — aggregate queries

**Files:** Create `apps/backend/src/tracking/monitoring.service.ts` + spec.

**Interfaces:**
- `getVolumeByEventType(hours: number): Promise<Array<{ eventType: string; count: number }>>` — `trackingSnapshot.groupBy` by eventType over the last N hours.
- `getDispatchFunnel(provider: string, hours: number): Promise<{ pending, sending, sent, retry, failed, dead, skipped, deduped }>` — `trackingDispatch.groupBy` by status.
- `getDeadStats(): Promise<{ deadCount: number; dlqDepth: number }>` — reuse `DlqService.getStats()` (Phase 5).
- `getRetryHistogram(): Promise<Array<{ attemptCount: number; count: number }>>` — dispatch groupBy attemptCount (nonzero).
- `getTopFailures(limit = 10): Promise<Array<{ errorMsg: string; count: number }>>` — dispatch groupBy errorMsg (non-null, truncated to a safe length).
- `getFreshness(hours: number): Promise<{ avgCaptureToDispatchSec: number; p95CaptureToDispatchSec: number }>` — over dispatched outboxes, avg/percentile of `dispatchedAt - createdAt`.
- `getDedupKeyUsage(hours: number): Promise<Array<{ key: string; events: number }>>` — snapshot `payload`-path counts for `event_id`/`external_id`/`fbp` presence (simplified: count snapshots where payload contains the key, plus context fbp/fbc presence).

- [ ] **Step 1:** Write failing tests (mocked prisma groupBy/count) for each method's shape + the DLQ reuse.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (Prisma `groupBy`, `count`, `aggregate _avg`, and a JS percentile for p95).
- [ ] **Step 4:** Run → PASS. `npm run build --workspace=backend`. **Commit** `feat(tracking): add monitoring aggregate queries`

---
### Task 2: MonitoringController — admin endpoints

**Files:** Create `apps/backend/src/tracking/monitoring.controller.ts`; register in `tracking.module.ts`; spec.

**Interfaces:**
- `@Roles('admin')` + `@RequiresFeature('admin_tracking')` on the controller (same guard pattern as the replay controller).
- `GET /tracking/admin/monitoring/overview?hours=24` → `{ volumeByEventType, dispatchFunnel, deadStats }`.
- `GET /tracking/admin/monitoring/failures?limit=10` → `{ topFailures, retryHistogram }`.
- `GET /tracking/admin/monitoring/freshness?hours=24` → `{ avgCaptureToDispatchSec, p95CaptureToDispatchSec }`.
- `GET /tracking/admin/monitoring/dedup?hours=24` → `{ keyUsage }`.
- Each returns only aggregate/sanitized data (no PII, no tokens).

- [ ] **Step 1:** Write failing controller spec (auth guard metadata + handlers call the service).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. `npm run build --workspace=backend`. **Commit** `feat(tracking): add admin monitoring endpoints`

---
### Task 3: Admin monitoring page

**Files:** Create `apps/admin/src/features/settings/tracking/monitoring.tsx`; wire into the tracking settings entry; spec.

**Interfaces:**
- A React page (TanStack Query) calling the four endpoints, rendering:
  - Volume by event type (simple bar list).
  - Per-provider dispatch funnel (pending/sending/sent/retry/failed/dead/skipped/deduped counts).
  - DEAD count + DLQ depth.
  - Retry histogram + top failures.
  - Freshness (avg/p95 seconds).
  - Dedup key usage.
- A per-event timeline search box: input `eventId`/`orderId` → `GET /tracking/admin/monitoring/...` (add a `timeline?eventId=` endpoint to the controller returning the `TrackingDispatchEvent` rows for that snapshot, if not already present).
- Follow the existing admin settings-page patterns (layout, data fetching, loading/error states).

- [ ] **Step 1:** Write a failing Vitest (the page renders the KPI sections with mocked fetch/query).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the page + wire the route.
- [ ] **Step 4:** Run admin tests + `npm run build --workspace=admin`. **Commit** `feat(admin): add tracking monitoring dashboard`

---
## Self-Review Notes

- **Spec coverage:** Tasks 1-2 = §14 data layer + endpoints; Task 3 = §14 page (KPIs + timeline). Nightly rollup is a documented deferral (live queries are fine at this volume).
- **Privacy:** all endpoints return aggregates/sanitized errors — no PII/tokens (§12).
- **Auth:** `@Roles('admin')` + `@RequiresFeature('admin_tracking')` (feature registered in Phase 5).
- **Type consistency:** `DlqService.getStats()` reused for DEAD/DLQ; `DispatchStatus` constants drive the funnel.
