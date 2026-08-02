# CAPI Tracking Pipeline — Phase 7: Retention, Anonymization, Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the privacy/retention policy — scheduled, batched jobs that anonymize aged `TrackingContext`, null aged `TrackingSnapshot.payload`, purge terminal outboxes and old dispatch rows, archive-then-purge 2-year-old snapshots, and an admin deletion workflow — plus a documented load-test note for the freshness SLO.

**Architecture:** Phase 7 (final) of the approved design (`docs/superpowers/specs/2026-08-02-ecomate-capi-redesign-design.md`, §12). All jobs run in **PK-batched loops** (short transactions, autovacuum-friendly) with the retention indexes from Phase 0 (`@@index([lastSeenAt])` on context, `@@index([createdAt])` on dispatch/dispatch-event/outbox/snapshot). The `TrackingReplayArchive` (Phase 5) preserves replayability beyond raw-data retention.

**Tech Stack:** NestJS 11, Prisma 7, Jest.

## Global Constraints

- **Backend rules:** DTOs with `class-validator`; thin controllers; `@Roles('admin')` + `@RequiresFeature('admin_tracking')`; `npm run build --workspace=backend`; Jest.
- **Design §12 retention policy (verbatim targets):**
  | Data | Retention | Action |
  |---|---|---|
  | `TrackingContext` | 90 days | Anonymize (null `identifiers`, `ip`, `userAgent`, `url`, `referrer`; keep `ctxId`/`externalId`/timestamps) |
  | `TrackingSnapshot.payload` | 90 days | Null `payload`; keep `eventId`/`eventType`/`orderId`/`eventTime` |
  | `TrackingOutbox` | 30 days after terminal | Purge |
  | `TrackingDispatch` / `TrackingDispatchEvent` | 1 year | Purge |
  | `TrackingSnapshot` / `TrackingContext` rows | 2 years | Archive (ReplayArchive) then purge |
- **AGENTS.md:** no schema change expected (all columns exist from Phase 0); if a column is missing, schema+migration atomic.
- **Privacy:** anonymize → raw PII nulled; never log PII; deletion keeps dedup keys (`eventId`/`orderId`) but removes PII.

---
## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/backend/src/tracking/retention-cleanup.service.ts` | Create | Scheduled batched retention jobs |
| `apps/backend/src/tracking/tracking-deletion.service.ts` | Create | GDPR-style deletion by externalId/customer |
| `apps/backend/src/tracking/deletion.controller.ts` | Create | Admin deletion endpoint |
| `apps/backend/src/tracking/__tests__/*.spec.ts` | Create | per-task tests |

---
### Task 1: RetentionCleanupService — scheduled batched jobs

**Files:** Create `retention-cleanup.service.ts` + spec.

**Interfaces:**
- `runCleanup()` — runs each job in sequence, each in **PK-batched loops** (batch size 1000, short transactions):
  1. `anonymizeContexts()` — `trackingContext.updateMany` in batches: rows `lastSeenAt < now-90d` and `identifiers != {}` → set `identifiers: {}, ip: null, userAgent: null, url: null, referrer: null` (keep ctxId/externalId/timestamps). Loop by `id` batches (find ids then updateMany where id in batch + the predicate).
  2. `nullSnapshotPayloads()` — `trackingSnapshot` rows `createdAt < now-90d` and `payload != null` → `payload: null` (batched).
  3. `purgeTerminalOutboxes()` — `trackingOutbox` where `status IN ('SENT','DEAD')` and `dispatchedAt < now-30d` → delete (batched). Also purge the matching `TrackingDispatchEvent` for those outbox snapshotIds.
  4. `purgeOldDispatches()` — `trackingDispatch` + `trackingDispatchEvent` where `createdAt < now-1y` → delete (batched).
  5. `archiveAndPurgeSnapshots()` — snapshots `createdAt < now-2y` AND not already archived: for each, if the outbox reached a terminal state (i.e. replay might be wanted) write a `TrackingReplayArchive` (eventId/eventType/eventTime + PII-stripped payload via the normalizer + configSnapshot + versions if known), then delete the snapshot + its outbox + dispatch rows. Batched.
- `start()`/`stop()` interval (e.g. every 6 hours — matches the existing `RetentionCleanupService` cadence in the codebase for other tables) with `OnModuleInit/OnModuleDestroy`; a `RETENTION_ENABLED` config gate (default true).
- `OnModuleInit` runs `runCleanup()` once at boot then on interval.

TDD: spec first (mocked prisma — each job issues the batched updateMany/deleteMany with the right predicates; context anonymize nulls identifiers/ip/ua/url/referrer but keeps ctxId/externalId; snapshot payload nulled; outbox purge only terminal+30d; dispatch 1y; archive-then-purge 2y writes ReplayArchive first). Confirm FAIL → implement → PASS → `npm run build --workspace=backend` clean → commit `feat(tracking): add retention/anonymization cleanup jobs`.

---
### Task 2: DeletionService + admin endpoint

**Files:** Create `tracking-deletion.service.ts`, `deletion.controller.ts`, DTO; spec.

**Interfaces:**
- `DeletionService.deleteByExternalId(externalId: string)`: delete `TrackingContext` rows where `externalId = <id>`; for `TrackingSnapshot` rows linked to orders whose context had that externalId (or `payload.customer` matching), null the PII in `payload` (keep eventId/orderId for dedup). Return `{ contextsDeleted, snapshotsAnonymized }`.
- `DeletionService.deleteByCustomerId(customerId: string)`: resolve the customer's `externalId` (if stored on the context) then delegate; also anonymize any snapshot payloads whose `orderId` maps to that customer's orders.
- Admin endpoint: `POST /tracking/admin/delete` body `{ externalId? | customerId? }` (class-validator DTO, at least one), gated `@Roles('admin')` + `@RequiresFeature('admin_tracking')`, returns the counts.
- Batched where large.

TDD: spec first (delete context by externalId; anonymize snapshot payload PII; counts; validation — missing both ids → 400). Confirm FAIL → implement → PASS → build clean → commit `feat(tracking): add admin deletion workflow`.

---
### Task 3: Wire + full-suite + load-test note

**Files:** Modify `tracking.module.ts` (register cleanup + deletion + controller); add/adjust specs; write `docs/superpowers/reports/2026-08-02-load-test-note.md`.

**Interfaces:**
- Register `RetentionCleanupService`, `DeletionService`, `DeletionController` in the module.
- Run the FULL backend suite + build.
- Write a short load-test note: how to validate the freshness SLO (Phase 3-4) — e.g. a script that creates N synthetic outbox rows, runs the relay+dispatcher, measures capture→dispatch latency p95 < 60s, and checks the outbox drains. Document the command/approach (manual, ops-run) rather than an automated test.

- [ ] **Step 1:** Wire the module. Run the full backend suite + build → PASS.
- [ ] **Step 2:** Write the load-test note.
- [ ] **Step 3:** Commit `feat(tracking): wire retention + deletion; document load test`.

---
## Self-Review Notes

- **Spec coverage:** Task 1 = §12 retention/anonymization jobs (all 5 policies, batched); Task 2 = §12 deletion workflow; Task 3 = wiring + §11 freshness-SLO validation note.
- **Type consistency:** `TrackingReplayArchive` (Phase 5) reused for archive-then-purge; `normalizer` PII-stripping reused; status constants for terminal checks.
- **Privacy:** anonymize nulls raw PII; deletion keeps dedup keys; batched jobs avoid long locks.
- **Migration:** none expected (all columns exist from Phase 0).
