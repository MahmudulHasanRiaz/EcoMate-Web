# CAPI Tracking Pipeline — Phases 3-4: Capture → Relay → Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new pipeline the running one — capture business events as idempotent **snapshots + outbox rows** inside the business transaction, relay outbox → queue, and dispatch via the **provider adapters** (Phase 2) into per-provider `TrackingDispatch` rows — then retire the legacy provider services and `TrackingEvent`.

**Architecture:** Combines roadmap Phases 3 + 4 into one deployable milestone: capture without a dispatcher would leave purchases un-sent (regression), so capture + relay + dispatcher land together. Design reference: spec v2 §4.2/§4.3/§4.4/§4.7/§4.8/§5/§7.4/§9.

**Tech Stack:** NestJS 11, Prisma 7, BullMQ, Jest. Additive-then-retiring.

## Global Constraints

- **Backend rules:** DTOs with `class-validator`; `$transaction` for multi-write; thin controllers; `npm run build --workspace=backend` before completion; Jest for behavior changes.
- **AGENTS.md:** schema change → instant migration (Phase 3-4 DROPs `TrackingEvent` after data migration; commit schema+migration atomically).
- **Design invariants:** capture is **idempotent** — `ON CONFLICT (eventId) DO NOTHING` and it must NEVER fail the business transaction (a duplicate capture is logged `DEDUPED`). Outbox claim uses raw SQL `FOR UPDATE SKIP LOCKED RETURNING`. Job id = `${outboxId}:${attemptCount}` (per-attempt unique). Dispatcher work set = non-terminal dispatch rows only (never re-send SENT/DEAD/SKIPPED/DEDUPED). Success policy terminal (zero-eligible → SENT; policy-impossible → FAILED→DEAD). Every reset clears `lockedAt`/`lockedBy`. `TrackingDispatchEvent` logs every transition.
- **No double-send:** until this milestone, the legacy `tracking.track()` → queue → legacy services path is the running one. This milestone **switches** business flows to capture and the dispatcher to the adapters, then **removes** the legacy provider services.

---
## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/backend/src/tracking/tracking-capture.service.ts` | Create | `capture(event, tx?)` — idempotent snapshot+outbox insert |
| `apps/backend/src/tracking/outbox-relay.service.ts` | Create | SKIP LOCKED claim → enqueue (per-attempt jobId, lock release) |
| `apps/backend/src/tracking/tracking-dispatcher.service.ts` | Create | Consume outbox jobs → adapters → dispatch rows/events |
| `apps/backend/src/tracking/tracking-dispatcher.processor.ts` | Create (or repurpose queue processor) | BullMQ worker for outbox jobs |
| `apps/backend/src/tracking/adapters/index.ts` | Modify | `buildAdapterRegistry()` consumed by dispatcher |
| `apps/backend/src/tracking/tracking.module.ts` | Modify | register capture/relay/dispatcher; remove legacy service providers at retire step |
| `apps/backend/src/tracking/tracking.controller.ts` | Modify | `/tracking/events` → capture (with ctxId) |
| `apps/backend/src/orders/orders.service.ts` | Modify | purchase/refund → transactional capture (idempotent) |
| `apps/backend/src/checkout-leads/checkout-leads.service.ts` | Modify | Lead → transactional capture |
| `apps/backend/src/tracking/dto/track-event.dto.ts` | Modify | add `ctxId?` |
| Delete (retire) | Modify | `meta-conversions.service.ts`, `tiktok-events.service.ts`, `ga4-measurement.service.ts`, `google-ads.service.ts`, `tracking-queue.service.ts` (or repurpose) |
| `apps/backend/prisma/schema.prisma` + migration | Modify | DROP `TrackingEvent` (after data-migrate) |
| `apps/backend/src/tracking/__tests__/*.spec.ts` | Create/Modify | per-task tests |

---
### Task 1: TrackingCaptureService — idempotent snapshot + outbox

**Files:** Create `apps/backend/src/tracking/tracking-capture.service.ts`, `__tests__/tracking-capture.service.spec.ts`.

**Interfaces:**
- Produces: `TrackingCaptureService.capture(input: { eventId, eventType, orderId?, ctxId?, eventTime, actionSource?, payload, configSnapshot? }, prismaOrTx): Promise<{ status: 'CAPTURED' | 'DEDUPED' }>`.
- Uses `createMany({ skipDuplicates: true })` for the snapshot (eventId unique) and the outbox (snapshotId unique); on skip → `DEDUPED`, never throws.

- [ ] **Step 1: Write the failing test** — captures snapshot+outbox; second call with same eventId → `DEDUPED`, no new rows, does not throw; outbox has `configSnapshot`, `status PENDING`, `nextAttemptAt` set.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `capture` runs inside a `$transaction` (or uses the passed tx); `snapshot.createMany({ data, skipDuplicates: true })`; if count 0 → DEDUPED; else `outbox.createMany({ data: [{ snapshotId, configSnapshot, ... }], skipDuplicates: true })`. Build `payload` from the canonical input (customer + value/currency/items — raw, provider-agnostic, no hashes).
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(tracking): add idempotent snapshot+outbox capture`

---
### Task 2: OutboxRelayService — SKIP LOCKED claim + enqueue

**Files:** Create `apps/backend/src/tracking/outbox-relay.service.ts`, `__tests__/outbox-relay.service.spec.ts`.

**Interfaces:**
- Produces: `OutboxRelayService.poll(batchSize?, instanceId?): Promise<number>` — claims up to N `PENDING` rows via raw SQL `UPDATE ... SET status='CLAIMED', lockedAt=now(), lockedBy=$1 WHERE id IN (SELECT id FROM "TrackingOutbox" WHERE status='PENDING' AND "nextAttemptAt"<=now() AND "lockedAt" IS NULL ORDER BY priority DESC, "nextAttemptAt" ASC LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING id, "snapshotId"`, enqueues one BullMQ job per row with `jobId = ${outboxId}:${attemptCount}`; on enqueue failure releases the lock (status back to PENDING, `lockedAt=NULL`, `lockedBy=NULL`). Returns count enqueued.
- `start()`/`stop()` interval loop, **gated by config `tracking_relay_enabled`** (default false until the dispatcher is wired — but in this milestone it's enabled when the dispatcher lands; keep the flag so the milestone can be deployed with the flag toggled).

- [ ] **Step 1: Write the failing test** — with a mocked prisma `$queryRaw` returning rows, the relay enqueues one job per row with the right jobId and updates claim; on a thrown enqueue error it releases the lock (assert the updateMany call). `poll` returns the count.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — raw-SQL claim + `trackingQueue.add('send', job, { jobId, removeOnComplete: 100, removeOnFail: 50, attempts: 3, backoff: { type: 'exponential', delay: 2000 } })`. The job payload carries `{ snapshotId, eventId, orderId, ctxId, attemptCount }`.
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(tracking): add outbox relay with SKIP LOCKED claim`

---
### Task 3: Wire business capture — orders + leads

**Files:** Modify `orders.service.ts`, `checkout-leads.service.ts`, `tracking.module.ts`; add specs.

**Interfaces:**
- Consumes: `TrackingCaptureService` (Task 1), `TrackingContextService.getByCtxId` (Phase 1), `TrackingSettingsService` (Phase 0).
- Produces: `buildAndSendPurchaseEvent` → `capture({ eventId: 'purchase_{orderId}', eventType: 'Purchase', orderId, ctxId: order.trackingSessionId, eventTime: order.createdAt seconds, actionSource, payload: { value, currency, content_ids, contents, num_items, order_id, customer } , configSnapshot })` inside the SAME `$transaction` as the order/status mutation. `fireRefundEvent` → `capture({ eventId: 'refund_{orderId}', eventType: 'Refund', value: -total, ... })`. Checkout-leads → `capture({ eventId: 'lead_{id}', eventType: 'Lead', ... })`.

- [ ] **Step 1:** Read the three call sites (orders ~1292, ~1827, ~3131; checkout-leads ~205, ~469). 
- [ ] **Step 2: Write the failing test** — capture is invoked with the correct eventId/payload/ctxId from `buildAndSendPurchaseEvent` (mocked `TrackingCaptureService`), and it runs inside the business transaction; the legacy `tracking.track()` call is removed from these paths.
- [ ] **Step 3: Implement** — replace `await this.tracking.track({...})` with transactional capture. Keep the `TrackingContextService` context read for `savedCtx`. The `configSnapshot` captures enabled providers + purchase mode + validated status + normalizer version at this moment (build from `TrackingSettingsService`).
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(orders): capture purchase/refund snapshots transactionally`

---
### Task 4: TrackingDispatcher — outbox → adapters → dispatch rows

**Files:** Create `apps/backend/src/tracking/tracking-dispatcher.service.ts`, `tracking-dispatcher.processor.ts`; Modify `adapters/index.ts`, `tracking.module.ts`; add specs.

**Interfaces:**
- Consumes: outbox jobs (Task 2), `TrackingCaptureService`/snapshot read, `TrackingContextService.getByCtxId`, `buildAdapterRegistry()` (Phase 2), `TrackingSettingsService`.
- Produces: `TrackingDispatcher.process(job)`:
  1. Read the snapshot + linked context (by snapshot.ctxId).
  2. For each **enabled** provider in `configSnapshot` whose adapter `supports(eventType)` (and GA4 `serverOnly` rule): create/upsert a `TrackingDispatch` (PENDING) with `@@unique([snapshotId, provider])`, `providerEventId` = the payload's dedup key, and pinned `adapterVersion/providerApiVersion/payloadVersion/normalizerVersion`.
  3. `Promise.allSettled` the sends — provider failures never block others. Each provider advances its own dispatch row + appends a `TrackingDispatchEvent`.
  4. **Work set:** only dispatch rows in `PENDING/SENDING/RETRY` are processed — never re-run SENT/DEAD/SKIPPED/DEDUPED.
  5. **Outbox terminal:** all eligible SENT/SKIPPED/DEDUPED → SENT; zero eligible → SENT (NOOP); required provider DEAD under ALL_SENT → FAILED→DEAD (policy-impossible); retryable failure → outbox `CLAIMED→PENDING` (attemptCount++, nextAttemptAt, **clear lockedAt/lockedBy**).
- `processor` = a BullMQ worker on the `tracking` queue calling `dispatcher.process(job)`.

- [ ] **Step 1: Write the failing test** — a fake adapter set: one SENT + one FAILED → outbox stays retryable, SENT provider NOT re-run on the next process (work-set); GA4 `supports('Purchase')` false (instant) → SKIPPED/no row; zero eligible → SENT; `TrackingDispatchEvent` rows appended for each transition; `@@unique` prevents duplicate dispatch rows (upsert not create).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** per the above. Use `TRACKING_EVENT_TYPES`, `OUTBOX_STATUS`, `DISPATCH_STATUS` constants (Phase 0).
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(tracking): add outbox dispatcher with provider-independent dispatch`

---
### Task 5: Browser `/tracking/events` → capture + ctxId

**Files:** Modify `tracking.controller.ts`, `dto/track-event.dto.ts`; add spec.

**Interfaces:**
- Consumes: `TrackingCaptureService`.
- Produces: `POST /tracking/events` now **captures** (snapshot+outbox) instead of calling `tracking.track()` (the old direct-enqueue). `TrackEventDto` gains `ctxId?`; the controller passes `req.ip` + user-agent + `body.ctxId` into the capture. The browser already sends `ctxId` (Phase 1 Task 6).

- [ ] **Step 1: Write the failing test** — POST with an event captures a snapshot+outbox (mocked capture) with ip/UA/ctxId; the old queue enqueue is gone.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS.** `npm run build`. **Commit** `feat(tracking): capture browser events via /tracking/events`

---
### Task 6: Retire legacy services + `TrackingEvent`

**Files:** Delete `meta-conversions.service.ts`, `tiktok-events.service.ts`, `ga4-measurement.service.ts`, `google-ads.service.ts`; repurpose/remove `tracking-queue.service.ts` + `tracking-queue.processor.ts` (the dispatcher worker replaces it); migrate checkout-leads `TrackingEvent` lead-dedup to a `TrackingSnapshot` lookup; DROP `TrackingEvent` via migration; update `tracking.module.ts` providers.

**Interfaces:**
- Consumes: the dispatcher now owns all provider sends (Task 4); `PageViewBufferService` unchanged.
- Produces: clean module with capture/relay/dispatcher/context/settings/adapters; `TrackingEvent` dropped.

- [ ] **Step 1:** Grep all references to the legacy services + `TrackingEvent`; move checkout-leads dedup to `trackingSnapshot.findFirst({ where: { eventType: 'Lead', orderId: <phone>, createdAt: { gte: <1h> } } })`.
- [ ] **Step 2: Write the failing test** — module builds without the legacy providers; no `tracking.track()` callers remain; `TrackingEvent` not referenced anywhere.
- [ ] **Step 3: Implement** — delete the legacy files; wire `TrackingQueueProcessor` → dispatcher (or replace with `TrackingDispatcherProcessor`); run `npx prisma migrate dev --name drop_tracking_event` (data already retired — no rows are read post-migration); `npx prisma generate`.
- [ ] **Step 4: Run full backend test suite + build.** **Commit** `refactor(tracking): retire legacy provider services and drop TrackingEvent` (schema+migration atomic).

---
## Self-Review Notes

- **Spec coverage:** Tasks 1-2 = §4.2/§4.3/§4.8 (capture + relay); Task 3 = §5 capture-in-business-txn; Task 4 = §4.4/§4.7 (dispatcher, work set, success policy, dispatch events); Task 5 = browser capture; Task 6 = retire legacy + DROP `TrackingEvent`.
- **Type consistency:** `TrackingCaptureService.capture` input matches `TrackingSnapshotPayload` (Phase 2) + `configSnapshot` (Phase 0); dispatcher consumes `buildAdapterRegistry()` (Phase 2); `OUTBOX_STATUS`/`DISPATCH_STATUS` constants (Phase 0) everywhere.
- **Safety:** capture never fails the business txn; relay lock release clears `lockedAt/lockedBy`; dispatcher work set prevents double-send to GA4/Ads; per-attempt jobId avoids BullMQ collision.
- **Migration:** one — DROP `TrackingEvent` (post data-retirement).
