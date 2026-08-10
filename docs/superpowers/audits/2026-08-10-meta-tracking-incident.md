# Incident Report — Meta Matching Degradation (2026-08-10)

Status: **Resolved (code-side)** — validation pending next payment-data sample

## Summary

Meta Events Manager reported a sharp drop in event **match quality** (error 2804050
pattern: missing identity / no match key / IP+UA-only dedup). Investigation traced the
degradation to a confluence of capture, mirror, and synthesis defects rather than a
single outage. All defects are now fixed in code with tests; the data accumulated
during the incident remains low-match but is retained (no destructive cleanup).

## Timeline (2026-08-10)

| Time | Event |
|---|---|
| early | Monitoring (MON-3/MON-4) shows DLQ depth climb, dead outbox rows ≈ 9 000 |
| am | Watchdog flags mirror-collapse signal: server-capture share >> browser mirror |
| am | Meta Events Manager shows match-quality drop on Purchase/ViewContent |
| pm | Forensic audit of capture → context → dispatch → adapter chain (this follow-up) |
| pm | Fixes shipped: mirror fold-in, fbc synthesis, opt-out guard, Meta skipReason, coverage/dedup metrics |

## Contributing Factors (Root Cause)

1. **Mirror context loss** — the browser mirror path only upserted `trackingContext`
   when `fbp`/`fbc` were present. Mirror events without cookies (`fbclid`-only traffic,
   blocked third-party cookies) were written directly via `create()`, producing
   context rows **without** `storefrontThirdParty` index data → IP/UA missing at
   dispatch when the payload had no `customer` block → Meta got nothing to match on.
2. **No `fbc` synthesis** — `fbclid` arrives on most Meta-click sessions, but the
   cookie layer only wrote `fbc` when the browser supplied one. The first-party
   `_fbp`/`_fbc` bridge was added later; fbclid → fbc (`fb.1.<ts>.<fbclid>`) was
   never synthesized, so click sessions shipped with no click ID at all after
   third-party cookies were blocked (2804050 family).
3. **First-party cookies not settled** — storefront did not set `_fbp`/`_fbc` itself;
   relied on Meta's third-party pixel cookies, which are dropped by Safari/ITP and
   blocked browsers. No resync of `_fbc` from existing `_fbp`, no `online` flush on
   reconnection — the browser mirror saw only "unknown" identity.
4. **Skip events not marked** — the Meta adapter's guard (no identity at all) threw a
   synthetic error consumed by the dispatcher as a generic "failed dispatch"; the
   outbox row carried no `skipReason`, so `tracking_dispatch_event` recorded
   FAILED and retried, and the DLQ piled up with events that could **never** match.
5. **Dedup rate mis-measured** — `dedupRate` read dispatch rows with status
   `DEDUPED`, which by construction is always 0 (dedup happens at capture, before
   dispatch). The metric could not see the capture-level `eventId` UNIQUE skips.
6. **No identity/context coverage metrics** — nothing measured the share of captures
   carrying `em`, `ph`, `ip`, `ua` over a window; the degradation was invisible in
   dashboards until Events Manager flipped.

## Fixes Shipped

- **Mirror context fold-in** — every mirror event now upserts context, merging
  identity fields regardless of cookie presence (`reconciler.service.ts`).
- **`fbclid` → `fbc` synthesis** — `tracking-time.ts` synthesizes
  `fb.1.<epoch-ms>.<fbclid>` when only `fbclid` is present.
- **Storefront first-party cookies** — sets `_fbp`/`_fbc` itself, resyncs `fbc` from
  existing `_fbp`, flushes pending events on `online` (`storefront /lib/tracking.ts`).
- **Server-side opt-out guard** — backend skips capture when the opt-out cookie is
  set (previously client-side only).
- **Meta adapter 2804050 guard** — when no identity keys exist (`em`, `ph`, `dn`,
  `ct`, `st`, `zp`, `cn`, ip/ua from context), the adapter emits a structured
  skipReason (`no-identity-meta-2804050`) instead of a generic failure; dispatcher
  writes it to the outbox and does **not** retry the unmatchable event.
- **`splitName` + device extra** — `first_name`/`last_name` split from full name;
  `device` object included in server-side `user_data`.
- **MON-3 corrections** — `dedupRate` now reads capture-dedup dispatch events
  (`message: 'capture dedup'`), mirror/EMQ proxies added to quality rates.
- **MON-4 additions** — identity coverage (per-field ratio over snapshot payloads
  and context rows) + watchdog signals: `mirror-collapse`,
  `identity-coverage-low`, `context-coverage-low`, `dlq-depth-high`; admin UI
  supports card drilled to coverage numbers + skip-reason counts.

## Verification

- Backend: `jest` 121 suites / 1182 tests green; `nest build` clean.
- Admin: `tsc -b` clean.
- Storefront: `tsc --noEmit` clean; vitest 5 files / 43 tests green.
- New coverage + watchdog specs assert shape & thresholds (`monitoring.service.spec.ts`).

## Open Items

- Validate match quality on next Purchase/ViewContent sample in Events Manager
  (≥75% target; `emq-match-gap` watchdog signal tracks the EMQ-degraded share).
- Replay dead outbox rows selectively after the fix deploy (rows with
  `skip_reason = 'no-identity-meta-2804050'` need **no** replay — opt them out of
  the replayer; only rows with real identity are worth replaying).
- Pin Meta `user_data` flush: ensure server-side dispatch includes context ip/ua
  after mirror fold-in fix (covered by monitor signals).

## DLQ Recovery (after deploy)

The 8 559-event DEAD population was caused by the TikTok 40002 timestamp
rejection (now fixed) plus the Meta 2804050 no-identity failures. The per-row
replay path is duplicate-safe by construction: a provider whose dispatch row is
already terminal SENT is never re-POSTed (work-set rule), and Meta/TikTok dedup
by `event_id` server-side. Classification + safe batch recovery ships as
`POST /tracking/admin/replay/bulk?limit=N` (admin-only, feature-gated):

1. Scans the DEAD outbox queue **oldest-first**, bounded (default 200, hard cap
   500 per pass — repeat the call for the full population).
2. Loads each snapshot payload (falling back to the PII-stripped replay archive
   after retention).
3. Excludes rows with **no identity keys** (`em/ph/fn/ln/ct/st/zp/cn`) — the
   2804050 family is intentionally unmatchable, and post-fix they would only
   route to a terminal SKIPPED row. Replaying them buys nothing (quota + noise).
4. Resets the rest DEAD -> PENDING through the existing `ReplayService.replay()`
   — attemptCount reset, replay-nonce job id, single relay dispatch. Rows that
   leave DEAD mid-pass are counted (`skippedNotDead`), never double-replayed.
5. Returns `{ scanned, excludedNoIdentity, replayed, skippedNotDead }`.

Execute as: `curl -X POST .../tracking/admin/replay/bulk?limit=500` repeated
until `scanned` is small; verify Event Manager/DLQ depth (`dlq-depth-high`
signal) drains and `excludedNoIdentity` dominates on the last pass.

## Ownership

- Files touched: `tracking-time.ts`, `reconciler.service.ts`, `dispatcher.service.ts`,
  `meta.adapter.ts`, `monitoring.service.ts`, storefront `lib/tracking.ts`,
  admin monitoring dashboards/specs.