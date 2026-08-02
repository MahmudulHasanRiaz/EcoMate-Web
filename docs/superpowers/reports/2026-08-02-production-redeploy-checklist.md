# Production Re-Deploy Checklist — CAPI Tracking Redesign (Phases 0-7)

**Date:** 2026-08-02
**Source:** `main` = `ff898d14` (51 tracking commits + dispatch label fix)
**Validated on this machine:** all 3 hand-authored migrations applied cleanly to a fresh disposable Postgres (`prisma migrate deploy` → **"No difference detected"**); full suite green (backend 1027, storefront 20, admin 172); backend + storefront + admin builds pass.

---

## 1. What's in this release

| Area | Change |
|---|---|
| Tracking pipeline | Capture→relay→dispatcher→adapters (Meta/TikTok/GA4/Google Ads); legacy provider services retired |
| Context capture | Browser TrackingClient (ctxId + provider cookies/URL), serialized `/tracking/context`, `Order.trackingSessionId` |
| Reliability | Outbox (source of truth), SKIP LOCKED relay, reconciler, DLQ, replay + PII-stripped archive |
| Monitoring | Admin dashboard (`/mon/settings/tracking/monitoring`) + `/tracking/admin/*` endpoints |
| Privacy | Retention/anonymization jobs (90d/30d/1y/2y), GDPR deletion |
| Bug fix | `Picked Up` dispatch label (was `icked Up`) |

## 2. Migrations (3 new since last deploy — validated, now deploy)

| Migration | Type | Safe? |
|---|---|---|
| `20260802084140_add_lead_ctx_id` | additive (CheckoutLead.ctxId + index) | Yes |
| `20260802120000_drop_tracking_event` | DROP TrackingEvent (data retired) | Yes — data already un-used; take a backup first |
| `20260802130000_add_snapshot_created_at_index` | additive (index) | Yes |

## 3. Deploy order + commands

```
1. Backup  →  2. Migrate  →  3. Enable relay + feature  →  4. Deploy images  →  5. Verify
```

```bash
# 1. Backup (MANDATORY — drop_tracking_event is not reversible)
pg_dump -Fc "$PROD_DATABASE_URL" -f backup_$(date +%Y%m%d_%H%M%S).dump

# 2. Migrations (runs in the backend container's startup script too — safe to run here)
cd apps/backend
npx prisma migrate status        # expect: 3 pending (the migrations above), none failed, no drift warning
npx prisma migrate deploy        # expect: "All migrations have been successfully applied."
npx prisma migrate status        # expect: 0 pending

# 3. ⚠️ CRITICAL — go-live flags (must be set, or tracking silently stops)
#    Set system settings / env BEFORE/with the app deploy:
tracking_relay_enabled = "true"          # WITHOUT this: purchases captured to outbox, NEVER dispatched
#    Grant the admin_tracking feature in the license plan (monitoring/replay/deletion endpoints).

# 4. Deploy images built from main@ff898d14 (backend + storefront + admin together)
```

## 4. Post-deploy verification

- [ ] `npx prisma migrate status` → 0 pending, none failed, no drift
- [ ] `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → **"No difference detected"**
- [ ] Backend `/health` OK; app logs show no tracking errors
- [ ] `tracking_relay_enabled=true` in effect — outbox rows reach `SENT` (watch `TrackingOutbox`):
  ```sql
  SELECT status, count(*) FROM "TrackingOutbox" GROUP BY status;
  ```
- [ ] Admin dashboard live: `/mon/settings/tracking/monitoring` shows volumes + funnel (admin_tracking granted)
- [ ] **End-to-end smoke:** place an order on the storefront → context captured → Purchase reaches Meta (Events Manager test pixel) + dispatch row `SENT`
- [ ] `Picked Up` dispatch status renders correctly in admin order detail

## 5. Rollback

| Step | Command |
|---|---|
| Stop relay | `tracking_relay_enabled=false` (captures stop dispatching; purchases no longer sent) |
| Revert schema | Reverse the 3 migrations via a follow-up migration (re-add `TrackingEvent`, drop `CheckoutLead.ctxId`, drop the index) — `drop_tracking_event` is NOT reversible from the backup, so **restore the pg_dump** if needed |
| Revert code | Deploy the pre-tracking image (main @ `4fb2be54`) |

**Rollback triggers (immediate):** migrate deploy fails; app boot/health fails; outbox rows stuck PENDING/CLAIMED with no dispatch progress; Meta Events Manager shows no Purchase events within ~5 min of an order; admin dashboard 403 (feature not granted).

## 6. Go/No-Go

**GO** — migrations validated deterministically, full suite green, checklist above is the deploy procedure. The only production-gated step is the `tracking_relay_enabled=true` flag + `admin_tracking` grant at deploy time.
