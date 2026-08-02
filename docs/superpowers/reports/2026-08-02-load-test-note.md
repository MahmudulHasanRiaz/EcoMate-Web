# Load-Test Note — Tracking Pipeline Freshness SLO

**Date:** 2026-08-02
**Phase:** 7 (final) — validation documentation (ops-run, manual)

## SLO

Design §11: **p95 capture→dispatch < 60s** under sustained load (relay poll ~1s + queue latency; Purchase/Refund claimed with priority). Validated below before relying on it in production.

## Prerequisites

- A disposable/staging Postgres + Redis (NOT production).
- Backend built from the tracking branch, `tracking_relay_enabled=true`, at least one provider enabled (Meta with a test pixel, or a stub adapter) so the dispatcher actually sends.
- `npm run build --workspace=backend` clean.

## Procedure (ops-run script)

1. **Seed synthetic events.** Insert N outbox rows (e.g. 5,000) with varied `priority` (mostly 0, 10% Purchase/Refund at 10) via a one-off script against the staging DB:
   - `trackingSnapshot` rows (eventId `loadtest_{i}`, eventType alternating Purchase/AddToCart, eventTime now, payload `{ value: 1, currency: 'BDT' }`).
   - `trackingOutbox` rows (snapshotId, status `PENDING`, `nextAttemptAt = now`, `configSnapshot` with the enabled providers + priority).
2. **Start the backend** (relay + dispatcher + a stub or test provider adapter that returns 2xx).
3. **Measure.** Query the drain + freshness:
   ```sql
   -- drain progress
   SELECT status, count(*) FROM "TrackingOutbox" GROUP BY status;
   -- freshness of dispatched rows
   SELECT
     round(avg(extract(epoch from ("dispatchedAt" - "createdAt")))::numeric, 2) AS avg_sec,
     percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch from ("dispatchedAt" - "createdAt"))) AS p95_sec
   FROM "TrackingOutbox"
   WHERE "dispatchedAt" IS NOT NULL;
   ```
4. **Pass criteria:** all rows reach a terminal state (`SENT`, or `DEAD` if the stub is configured to fail) within a few minutes; `p95_sec < 60`.
5. **Repeat with a burst** (double the seed volume) to confirm no backpressure plateau; watch Redis queue depth (`bull:tracking:*` job counts) and Postgres lock waits.

## What this validates

- Relay claim throughput + dispatcher concurrency (no single-poller ceiling).
- Purchase/Refund priority ordering (they drain before the browser-event flood).
- No stuck `CLAIMED` rows (reconciler + relay + dispatcher work together).
- The outbox terminal rules (SENT/NOOP/DEAD) don't leave rows behind.

## Known caveats (from reviews)

- Real provider latencies (Meta ~<600ms typical, 1500ms timeout) are not exercised with a stub; add one real provider (Meta test pixel) to the load run if end-to-end latency matters.
- The relay is gated OFF by default (`tracking_relay_enabled`); this test requires it ON.
- p95 uses the `dispatchedAt - createdAt` outbox window; the dashboard `getFreshness` uses the same fields.
