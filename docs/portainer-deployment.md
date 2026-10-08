# Deployment Runbook — EcoMate Web

> **Source of truth (2026-10-08).** Replaces the old "Portainer builds the
> images" flow: **CI builds images → GHCR; Portainer only pulls.**
> Point-in-time release notes under `docs/superpowers/reports/` are history —
> this file is the live procedure.

## 1. How deployment works

```
GitHub (manual dispatch)                    VPS (Portainer 2.45, CE)
─────────────────────────                    ────────────────────────
ci.yml ──► Build Images ──► GHCR              Deploy Client ──► webhook ──►
(all | backend | storefront |                  Portainer stack pulls
 admin | pos, self-hosted                      images + redeploys
 or github runner)
```

- **Nothing runs on push.** Every workflow is `workflow_dispatch` (manual).
- **CI never deploys.** `ci.yml` only gates (migration-safety, unit tests)
  and pushes `latest` + short-sha tags to GHCR.
- **Deploy = webhook trigger.** `deploy-client.yml` (always `ubuntu-latest`)
  POSTs each selected stack's Portainer webhook. HTTP 2xx means **trigger
  accepted, NOT a healthy deploy** — always confirm the stack in Portainer UI.
- Images are `linux/amd64` (`platform: linux/amd64` in compose). The VPS is
  amd64; the self-hosted Mac runner builds via emulation (slow — prefer the
  `github` runner for speed).

## 2. Repo map

| File | Role |
|---|---|
| `docker-compose.yml` | The stack file. 5 services (postgres, redis, backend, storefront, admin, pos) from GHCR, all env-driven. Deploy this file per client. |
| `portainer/portainer-stack.json` | Portainer custom-template defaults (env list). |
| `.env.example` | Every stack env var with docs. Copy → fill → paste into the stack. |
| `.github/clients.json` | Deploy registry: `{ key: { label, secret } }`. **New client = 1 line here.** |
| `.github/workflows/ci.yml` | Manual builds: `runner` (self-hosted/github) + `all|backend|storefront|admin|pos`. |
| `.github/workflows/build-service-image.yml` | Shared builder (buildx, GHA layer cache per service, push to GHCR). |
| `.github/workflows/deploy-client.yml` | Manual deploys: `all` or per-client checkboxes from `.github/clients.json`. Runs on GitHub runners, never the Mac. |
| `.github/workflows/build-mobile.yml` | Manual mobile builds. |
| `apps/backend/scripts/resolve-failed-migrations.sh` | Self-healing pre-flight for `migrate deploy` (P3009/P3018/P2039). |

## 3. New client onboarding (end-to-end)

1. **GitHub secret:** repo → Settings → Secrets → Actions → add
   `PORTAINER_WEBHOOK_<KEY>` (value = the stack's webhook URL from step 4).
2. **Register the client:** 1 line in `.github/clients.json` + 1 checkbox
   input in `deploy-client.yml` (same key). Resolve/deploy jobs never change.
3. **Portainer stack (Repository method):**
   - GitOps **Source** must exist and validate (Portainer ≥2.43 requires a
     registered source for git stacks; Sources view shows health).
   - **Repository URL must be `https://github.com/MahmudulHasanRiaz/EcoMate-Web`**
     — a sibling repo (e.g. `EcoMate-Landing`) clones fine but has no
     `docker-compose.yml`, and every pull then fails with
     `open /data/compose/<id>/docker-compose.yml: no such file or directory`.
   - Ref `refs/heads/main`, compose path `docker-compose.yml`.
   - Env vars from `.env.example` (JWTs, `POSTGRES_PASSWORD`,
     `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `CLIENT_DOMAIN`,
     ports if several clients share one host).
   - GHCR images are private by default → add a GHCR registry (PAT with
     `read:packages`) in Portainer, or pulls fail with auth errors.
4. **First deploy in the UI until green.** The stack folder
   (`/data/compose/<id>/`) only populates on a successful first deploy.
   Webhook/manual "pull" before that fails with the missing-file error above.
   Only after green: copy the stack webhook URL → step 1 secret → dispatch.
5. **Volumes are per stack** (`postgres-data`, `uploads-data`, `backup-data`,
   `license-data`, …). Deleting a stack keeps volumes unless explicitly
   removed — same-name recreates reattach data. **Never delete
   `license-data`**: keys for licenses/attendance/marketing tokens become
   permanently unreadable.

## 4. Deploy order (production)

```
1. Backup  →  2. migrate deploy  →  3. dispatch Deploy Client  →  4. verify in Portainer
```

```bash
# 1. Backup (MANDATORY)
pg_dump -Fc "$PROD_DATABASE_URL" -f backup_$(date +%Y%m%d_%H%M%S).dump

# 2. Migrations (additive only — schema+migration ship in the same commit)
cd apps/backend
npx prisma migrate status     # expect: 0 pending, none failed
npx prisma migrate deploy     # startup.sh also self-heals via resolve-failed-migrations.sh

# 3. Dispatch: Actions → Deploy Client → tick All or client(s)

# 4. Verify: Portainer stack green, /api/health OK, GHCR tags updated
```

Rollback = redeploy the previous image tag (migrations here are additive).

## 5. Secrets inventory

| Where | What |
|---|---|
| GitHub Actions secrets | `PORTAINER_WEBHOOK_<KEY>` per client (deploy triggers only). |
| Portainer stack env | DB/JWT/auth/app URLs/ports/pixels (see `.env.example`). |
| Portainer registries | GHCR credentials for private image pulls. |
| Portainer GitOps source | Git credentials for the repo (private repo ⇒ required). |

## 6. Troubleshooting (seen in production)

| Symptom | Cause → fix |
|---|---|
| `Cannot connect to the Docker daemon` (build) | Docker Desktop stopped on the Mac → start it; enable "Start at login". Or dispatch with `runner: github`. |
| `open /data/compose/<id>/docker-compose.yml: no such file` + `Unable to retrieve stack file` | Stack dir never populated: wrong repo URL (Landing vs Web), first deploy never green, or webhook fired before first deploy → §3. |
| Webhook returns 204 but stack broken | 204 = trigger accepted only. Check the stack, not the workflow log. |
| `Re-pull image` / `Force redeployment` missing | Business-Edition features (locked on CE). CE path: fix source → recreate → deploy green. |
| Build 15–20 min on github (was ~5) | Docker layer cache miss after lockfile changes (one-time) + ~300 MB Playwright download (now cached) + `all=true` running everything. Tick only needed services. Self-hosted 1h+ is QEMU amd64 emulation — expected. |
| `migrate deploy` P3009 (failed row) | `resolve-failed-migrations.sh` probe rule: DDL landed → `--applied`, else `--rolled-back`. Never `migrate reset` / `db push`. |
| Portainer shows old code after green deploy | `pull_policy: always` is set — check the stack actually redeployed (webhook 204 ≠ proof) and the image tag moved in GHCR. |
