# CAPI Tracking Pipeline — Phase 5: Reconciliation, DLQ, Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline self-healing and recoverable — a `ReconcilerService` that repairs stuck rows, a trimmed DLQ, a `ReplayService` + PII-stripped `TrackingReplayArchive` for version-pinned re-dispatch, the lock-release backoff fix, and the storefront Purchase `event_id` parity fix (single-authoritative dedup).

**Architecture:** Phase 5 of the approved design (`docs/superpowers/specs/2026-08-02-ecomate-capi-redesign-design.md`, §4.9/§4.10/§7.3/§8/§12). The pipeline (Phases 3-4) already handles retry/backoff in the dispatcher + outbox; this phase adds the durable repair layer + replay + observability of DEAD rows.

**Tech Stack:** NestJS 11, Prisma 7, BullMQ, Jest.

## Global Constraints

- **Backend rules:** DTOs with `class-validator`; `$transaction` for multi-write; thin controllers; `npm run build --workspace=backend` before completion; Jest.
- **AGENTS.md:** schema change → instant migration (Phase 5 adds the `TrackingReplayArchive` table — commit schema+migration atomic; hand-author per rule 7 if the local DB is drifted).
- **Design invariants (§4.9):** every reconciliation reset/release clears `lockedAt`/`lockedBy` and sets `nextAttemptAt`; `PENDING` older than threshold → re-claim; `CLAIMED` no progress > X → reset; `SENDING` hung > X → retryable. Replay pins `schemaVersion/adapterVersion/providerApiVersion/payloadVersion/normalizerVersion` from the dispatch/archive records; `DEAD → PENDING` with a fresh `attemptCount`; job id carries a replay nonce.
- **Privacy (§12):** `TrackingReplayArchive` stores a PII-stripped payload + configSnapshot + versions (hashed match keys only); raw data stays in the 90-day window.

---
## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/backend/src/tracking/reconciler.service.ts` | Create | Self-healing scheduled job (stuck rows) |
| `apps/backend/src/tracking/replay.service.ts` | Create | Version-pinned re-dispatch of DEAD/archived events |
| `apps/backend/src/tracking/replay.controller.ts` | Create | Admin endpoint(s) to trigger replay + list DEAD |
| `apps/backend/src/tracking/outbox-relay.service.ts` | Modify | lock-release backoff fix |
| `apps/backend/src/tracking/dto/*.ts` | Create | Replay DTO (admin) |
| `apps/backend/prisma/schema.prisma` + migration | Modify | Add `TrackingReplayArchive` |
| `apps/storefront/lib/tracking.ts` | Modify | Purchase `event_id` parity (`purchase_{orderId}`) |
| `apps/storefront/app/(main)/checkout/thank-you/ThankYouContent.tsx` | Modify | pass deterministic event_id to trackEvent |
| `apps/backend/src/tracking/__tests__/*.spec.ts` | Create | per-task tests |

---
### Task 1: Lock-release backoff + ReconcilerService

**Files:** Modify `outbox-relay.service.ts`; Create `reconciler.service.ts`; tests.

**Interfaces:**
- `OutboxRelayService.releaseLock(id)` — on enqueue failure: status `PENDING`, `attemptCount++`, `nextAttemptAt = now + backoff(attemptCount)` (1m/10m/1h/6h/24h), `lockedAt/lockedBy = null` (fixes the hot retry loop Minor).
- `ReconcilerService.reconcile(now)`:
  - `PENDING` with `nextAttemptAt <= now - 5m` (relay missed it) → claim-eligible (no-op; relay picks it up) — log.
  - `CLAIMED` with `lockedAt < now - 10m` and no dispatch progress → reset to `PENDING`, clear lock, set `nextAttemptAt`.
  - `SENDING` dispatch rows with `updatedAt < now - 10m` → mark `RETRY` (retryable) — the dispatcher work set re-processes them.
- `start()`/`stop()` interval (e.g. 60s), `OnModuleInit/OnModuleDestroy`.

- [ ] **Step 1:** Write failing tests (release sets backoff + clears lock; reconciler resets a stale CLAIMED row clearing lock; re-claims a stale PENDING; marks hung SENDING → RETRY).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. `npm run build`. **Commit** `feat(tracking): add reconciler + outbox lock-release backoff`

---
### Task 2: DLQ queue + trim

**Files:** Modify `tracking.module.ts` (register `tracking-dlq` queue); modify the dispatcher/relay to mirror exhausted jobs; tests.

**Interfaces:**
- A `tracking-dlq` BullMQ queue; exhausted outbox jobs (after BullMQ `attempts: 3` + outbox `DEAD`) mirror to the DLQ for ops visibility with a **trim policy** (`removeOnComplete: 0`, capped — or the mirror job removes itself after writing a DB note). The **DB `DEAD` outbox/dispatch counts are the primary DLQ-depth KPI** (dashboard reads those).
- Expose `getDlqStats()` (count of `DEAD` outbox rows + DLQ queue depth) for the Phase 6 dashboard.

- [ ] **Step 1:** Write failing test (DEAD outbox rows counted; mirror enqueues to the DLQ; DLQ jobs trimmed).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. `npm run build`. **Commit** `feat(tracking): add trimmed DLQ + DEAD stats`

---
### Task 3: ReplayService + TrackingReplayArchive + admin endpoint

**Files:** Create `replay.service.ts`, `replay.controller.ts`, `dto/replay.dto.ts`; add `TrackingReplayArchive` to `schema.prisma` + migration; tests.

**Interfaces:**
- `ReplayService.replay(snapshotId)`:
  1. Read the `TrackingReplayArchive` row (or the live snapshot if within retention).
  2. Pin `adapterVersion/providerApiVersion/schemaVersion/payloadVersion/normalizerVersion` from the archive's `versions`; resolve the adapter from the registry (recorded version if registered, else current with a version-mismatch warning).
  3. Reset the outbox `DEAD → PENDING` with a fresh `attemptCount`, set `nextAttemptAt`, clear lock; re-enqueue with a replay nonce job id (`${outboxId}:replay:${attemptCount}`).
  4. Append a `TrackingDispatchEvent` (replay).
- **Archive write:** on an outbox reaching `DEAD`, persist a `TrackingReplayArchive` row: `{ snapshotId, eventId, eventType, eventTime, archivedPayload: <PII-stripped payload — replace customer.email/phone with hashes>, configSnapshot, versions: { schemaVersion, adapterVersion, providerApiVersion, payloadVersion, normalizerVersion } }`. (The dispatcher writes this at DEAD time.)
- **Admin endpoints** (`@Roles('admin')` + `@RequiresFeature` as the codebase pattern):
  - `GET /tracking/admin/dead` — list DEAD outbox rows (id, eventId, eventType, lastError, versions).
  - `POST /tracking/admin/replay/:snapshotId` — trigger `replay(snapshotId)`.
- `TrackingReplayArchive` model per design §15 (snapshotId unique, eventId, eventType, eventTime BigInt, archivedPayload Json, configSnapshot Json, versions Json, archivedAt) + indexes.

- [ ] **Step 1:** Write failing tests (archive written on DEAD; replay pins version, resets outbox, re-enqueues with nonce; admin endpoints auth + trigger; PII stripped in archive).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement + migration (`npx prisma migrate dev --name add_tracking_replay_archive`, or hand-author per rule 7).
- [ ] **Step 4:** Run → PASS. `npm run build`. **Commit** `feat(tracking): add replay service + replay archive + admin endpoints`

---
### Task 4: Storefront Purchase event_id parity (single-authoritative dedup)

**Files:** Modify `apps/storefront/lib/tracking.ts`, `apps/storefront/app/(main)/checkout/thank-you/ThankYouContent.tsx`; storefront tests.

**Interfaces:**
- The browser Pixel Purchase must use the SAME dedup key as the server capture (`purchase_{orderId}`) so Meta dedups Pixel + CAPI (design §6 instant mode). Currently `trackEvent('Purchase', ...)` generates a random eventID.
- Fix: add an optional `eventId` override to `trackEvent(event, data, userData, eventId?)`; `ThankYouContent` passes `purchase_${order.id}` (the order id is available there). The `/tracking/events` mirror already carries the same eventId.

- [ ] **Step 1:** Write failing storefront test (trackEvent with eventId override uses it for fbq eventID + the mirror POST).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run storefront tests + build. **Commit** `fix(storefront): use purchase_<orderId> event_id for Purchase dedup`

---
## Self-Review Notes

- **Spec coverage:** Tasks 1-2 = §4.9/§7.3 (reconciler + DLQ); Task 3 = §4.10/§8/§12 (replay + archive + version pinning); Task 4 = §6/§9 instant-mode dedup parity.
- **Type consistency:** `TrackingReplayArchive` schema matches §15; `versions` JSON shape matches the dispatch version columns; replay nonce jobId follows the `${outboxId}:<attempt>` pattern.
- **Safety:** replay only re-dispatches within the provider send/dedup window (§4.10 scope); archive is PII-stripped (privacy §12).
- **Migration:** one — `TrackingReplayArchive` (additive).
