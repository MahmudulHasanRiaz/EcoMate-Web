# P11 — Operations (provider-independent) · Evidence

Branch: `feature/central-commerce-p0` · base `d8da115b` (P8) · **NOT committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§10 (sync ops routes), §11 (Sync Center UX), §12 (retention + observability), BR-19, P11 row.
Scope rule honoured: P9 (Shopify live adapter) is BLOCKED on the external
operator prerequisite (live dev store + token) and P10 follows P9 — **no
provider adapter touched**; all Shopify/bridge-specific work stays parked
(see §8 DEFERRED).

## 1. Migration

**None.** Additive only: no schema change, no new migration, no drift.
`ls apps/backend/prisma/migrations/` tail is still
`20260925200000_p8_sales_marketing_channels` (P8). Retention needs none
(purge is deletes-only against existing indexed columns).

## 2. Files

New backend (`apps/backend/src/stores/sync/`):
- `store-sync-logger.ts` — wires the previously unused
  `correlationIdStorage` into the store-sync logger; `currentCorrelationId /
  withCorrelationId / resolveCorrelationId / formatSyncLog / logSync` with
  the §10 field set (runId/storeId/provider/externalObjectId/
  correlationId/durationMs/status/errorCategory + scope/objectType/objectKey).
- `sync-notify.service.ts` — repeated-failure emails via the globally
  available `EmailQueueService` (`@Global QueueModule` → no new import);
  pure `shouldNotifyRepeatedFailure` (fires at 5, then every 10: 5/15/25…);
  recipient `SYNC_FAILURE_NOTIFY_EMAIL → ADMIN_EMAIL → newest superadmin`
  (best-effort); fail-safe — never throws into the engine.
- `sync-retention.service.ts` — BR-19 purge: 30d runs/items, 90d attempts,
  90d RESOLVED/IGNORED issues (OPEN never deleted), 30d webhook deliveries,
  30d health checks; `retentionCutoffs(now)` pure over an injected clock;
  bounded (`RETENTION_PURGE_BATCH = 1000` ids/table/run);
  `isRestoreWriteBlocked()` deferred path; SELF-REPORTING failure
  (FAILED MAINTENANCE run + `RETENTION_PURGE_FAILED` OPEN issue where a
  store exists + error log + best-effort email — never silent).
- `sync-retention.scheduler.ts` — daily BullMQ repeatable `retention-purge`
  (`30 3 * * *`, `Asia/Dhaka`) on `store-maintenance` (§3.3 convention).
- `sync-retry.service.ts` — retry-now / selected / all-eligible / ignore
  with notes; pure `isAttemptEligible` (PENDING/FAILED + nextRetryAt due;
  DEAD excluded from the sweep but explicitly retryable by id; SUCCESS/
  SKIPPED never retried); HTTP path only enqueues (BR-21);
  `executeRetry` re-runs the idempotent engine (SKU-keyed product upsert →
  same remote ref, never a duplicate); ORDER attempts fan out to
  `store-reconcile`.
- `__tests__/store-sync-logger.spec.ts` (5), `__tests__/sync-notify.spec.ts` (6),
  `__tests__/sync-retention.spec.ts` (8), `__tests__/sync-retry.spec.ts` (7).

Modified backend:
- `sync/sync-run.service.ts` — `begin()` resolves ambient correlation id
  (`explicit ?? storage ?? randomUUID`) and logs; `recordItem/recordAttempt`
  accept optional `provider/correlationId` (+`durationMs/externalObjectId`
  on attempts) for the structured log (DB writes keep existing columns —
  no migration); `upsertIssue` documents + proves the compact-state rule and
  fans out best-effort repeat notifications; never throws into callers.
- `sync/sync-ops.controller.ts` — additive only: runs list gains `provider`
  (via `store.kind` relation — SyncRun has no provider column) +
  `initiatedBy` filters and a `widenedWindow`/`provider` alias on every row;
  run detail gains `provider` + `widenedWindow`; attempts list gains
  `status`/`objectType` filters (kept in the 90-day BR-19 window);
  NEW `POST /sync/attempts/:id/retry`, `POST /sync/attempts/retry`,
  `POST /sync/attempts/retry-all`, `POST /sync/attempts/:id/ignore`,
  `GET /sync/health` (grid), `GET /sync/overrides/history` (BR-04 audit
  trail), `GET /sync/retention/status` (policy + last purge),
  `POST /sync/retention/purge` (enqueue-only). All under the existing
  class-level `@Roles` + `@RequiresFeature('admin_sync_center')`.
- `sync/sync.processors.ts` — `StoreMaintenanceProcessor` handles
  `retention-purge` for real (was `RETENTION_DEFERRED_TO_P11`); unknown
  maintenance jobs stay an explicit SKIPPED (never silent).
- `stores.module.ts` — provides `SyncNotifyService, SyncRetentionService,
  SyncRetentionScheduler, SyncRetryService` (+exports, minus no imports —
  `EmailQueueService` resolves via `@Global QueueModule`).

Admin (`apps/admin/src/features/channels/`):
- `sync-api.ts` — additive types (`SyncAttemptResponse`,
  `StoreHealthGridRow`, `RetentionStatusResponse`, `OverrideAuditItem`,
  `widenedWindow/provider/correlationId` on runs); pure
  `isAttemptEligibleUi` (mirrors backend gate); new client methods
  (retry one/selected/all, ignore attempt, health grid, overrides history,
  retention status, trigger purge).
- `sync-hooks.ts` — `useSyncAttempts, useStoreHealthGrid,
  useOverridesHistory, useRetentionStatus, useRetryAttempt,
  useRetryAttempts, useRetryAllAttempts, useIgnoreAttempt,
  useTriggerRetentionPurge`.
- `sync-center.tsx` — Overview gains health grid + retention card;
  History surfaces `widenedWindow` per run; Failed & Retry is now real
  (attempt list with select, Retry now per row gated by eligibility,
  Retry selected, Retry all eligible, Ignore selected with note);
  Issues rows take resolve/ignore with audited notes; new Audit tab
  (override history); run-detail Sheet shows provider + widenedWindow +
  correlation id.
- `sync-api.test.ts` — +1 pure test (`isAttemptEligibleUi` matrix).

## 3. API changes (all additive)

- `GET /sync/runs` — new optional `provider` (store kind) + `initiatedBy`
  filters; each row gains `provider` + `widenedWindow { days, reason }`.
- `GET /sync/runs/:id` — gains `provider` + `widenedWindow`.
- `GET /sync/attempts` — new optional `status` + `objectType` filters.
- NEW (see §2): attempt retry ×3, attempt ignore, health grid, overrides
  history, retention status, retention purge trigger.
- No existing route changed shape (new keys only); no controller passes
  `internal` order options; no new `@RequiresFeature` keys (all reuse
  `admin_sync_center` — no catalog change needed).

## 4. Test + build totals

- Backend jest: **249 suites / 3474 tests PASS** (includes 26 new P11:
  5 logger + 6 notify + 8 retention + 7 retry). Controlled-clock proofs:
  30/90-day cutoffs, per-table purge/keep, restore-deferral, purge
  self-report, 200-failures→1-compact-OPEN-issue, FakeProvider
  transient-then-retry leaves exactly 1 remote product (same ref).
- `npx nest build`: **clean**.
- Admin vitest: **78 files / 767 tests PASS** (incl. +1 P11).
- Admin `npx tsc --noEmit`: **clean**.
- Storefront untouched (no P11 surface) — suite not re-run; no regression
  vector.

## 5. Walkthrough (operator-visible)

1. Sync Center → Overview: health grid lists every store (probe state, open
   issues, active runs, last check) + retention card (BR-19 policy, last
   purge run, Purge now enqueue).
2. History: runs carry provider + window (`window 5d — reconcile backlog`
   style) via `widenedWindow`; Detail Sheet repeats provider, window and
   correlation id.
3. Failed & Retry: attempts (90-day window) with checkboxes; Retry now is
   disabled unless eligible (waiting/terminal explained by tooltip); Retry
   selected / Retry all eligible enqueue RETRY runs; Ignore selected records
   the note on each attempt (SKIPPED + `ignored by operator: …`).
4. Issues: each OPEN issue resolves/ignores WITH a note (`resolveNote`
   persisted); repeated failures (5th, 15th, …) email the ops inbox.
5. Audit: override history shows every Force/Keep with actor + previous
   external/baseline (BR-04 trail).
6. Retention: daily `retention-purge` (03:30 Asia/Dhaka) deletes bounded
   batches; a purge failure pages as FAILED run + `RETENTION_PURGE_FAILED`
   issue + log + email.

## 6. Correlation-id audit (§10 field set)

| Field | SyncRun | SyncRunItem | SyncAttempt | How carried in P11 |
|---|---|---|---|---|
| runId | PK | FK column | nullable FK column | DB + log |
| storeId | column | column | column | DB + log |
| provider (store kind) | via `store` relation | — (no column, no migration) | — (no column) | structured log + API `provider` alias |
| externalObjectId | — (run-level n/a) | column | via `objectKey` (+ explicit log field) | DB (item) / log (attempt) |
| correlationId | **column (now always set)** | — (no column) | — (no column) | DB (run) + log (all) |
| durationMs | n/a | column | — (no column) | DB (item) / log (attempt) |
| status | column | column | column | DB + log |
| errorCategory | column | column | column | DB + log |

Residual gap (accepted, no migration in P11): `provider`/`correlationId`
on items/attempts and `durationMs` on attempts live in logs only. If the
programme later wants them queryable, that is a schema migration outside
P11 — recorded here, not half-built.

## 7. Gaps (honest)

- Live-API/Playwright E2E not run in this pass (unit + contract proofs
  only); recommend the standard harness (`SKIP_LICENSE_CHECK=true`, temp
  scripts in `.tmp-e2e/`) before P12.
- No storefront work (none required by P11).
- Purge-failure issue attaches to the first store row (issues require a
  storeId); storeless deployments keep the FAILED run + log + email only.

## 8. DEFERRED (Shopify / P10-dependent — explicitly NOT in P11)

- P9 Shopify live adapter: custom-app token wiring, Shopify product/
  variant/media/collection calls, `stockStatusFidelity: 'unsupported'`
  LIVE verification (zero-quantity-write assertion against a real dev
  store), `CANCELLED`/`FULFILLED` push, Shopify HMAC webhook vectors with
  delivery id, wizard Shopify path, capability-limitation UX beyond the
  generic notices. BLOCKED on operator prerequisite: live dev store +
  custom-app token (§14/§18). Nothing Shopify-specific was implemented or
  modified here.
- P10 Custom provider (Bridge v1): protocol spec, manifest discovery, HMAC
  signing, order pull/webhook, status push, contact-check, reference-bridge
  conformance suite. Follows P9; untouched here.
- Live dev-store smoke tests (Shopify) and any bridge conformance run.
- Provider-specific fixture replays beyond the FakeProvider vectors used
  for the retry no-duplication proof.
