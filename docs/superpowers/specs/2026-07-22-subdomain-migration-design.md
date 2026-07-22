# Subdomain Migration: Path-based → Subdomain-based Routing

**Date:** 2026-07-22
**Status:** Approved design

## Goal

Migrate from single-domain path-based routing to subdomain-based routing for TWA/Capacitor compatibility across iOS and Android apps.

| Service | Current | Target |
|---------|---------|--------|
| Storefront | `domain.com` | `domain.com` (unchanged) |
| Backend API | `domain.com/api` | `api.domain.com` |
| Admin | `domain.com/admin` | `admin.domain.com` |
| POS | `domain.com/pos` | `pos.domain.com` |

## Architecture

All four services run in Docker on the same server. Nginx Proxy Manager handles subdomain → container routing. Existing path-based routing stays parallel until fully migrated.

```
Cloudflare DNS
  ├── domain.com → server IP
  ├── api.domain.com → server IP       NEW
  ├── admin.domain.com → server IP     NEW
  └── pos.domain.com → server IP       NEW

Nginx Proxy Manager
  ├── domain.com → storefront:3001
  ├── api.domain.com → backend:4001    NEW
  ├── admin.domain.com → admin:8081    NEW
  └── pos.domain.com → pos:8082        NEW

Existing path-based (kept for rollback):
  ├── domain.com/api/* → backend
  ├── domain.com/admin/* → admin
  └── domain.com/pos/* → pos
```

## Changes Required

### 1. Vite Config Changes

**`apps/admin/vite.config.ts`**
```ts
// Currently: base: '/admin/'
// Change to env-conditional:
base: process.env.VITE_BASE || '/admin/',
```

**`apps/pos/vite.config.ts`**
```ts
// Currently: base: '/pos/'
// Change to env-conditional:
base: process.env.VITE_BASE || '/pos/',
```

When deploying to subdomain, set `VITE_BASE=/` in the Docker build env.

### 2. Backend CORS (`apps/backend/src/main.ts`)

Add subdomain origins to CORS allowlist. Currently reads from `CORS_ORIGIN` env var — just update the env var value:

```
CORS_ORIGIN=https://admin.fixedplus.com.bd,https://pos.fixedplus.com.bd,https://www.fixedplus.com.bd
```

### 3. Nginx Configs

**`apps/admin/nginx.conf`** — Currently:
```nginx
location /admin { try_files $uri $uri/ /admin/index.html; }
```
After subdomain deployment:
```nginx
location / { try_files $uri $uri/ /index.html; }
```

**`apps/pos/nginx.conf`** — Same pattern.

Remove `/api/` proxy blocks from both admin and POS nginx when API moves to its own subdomain.

### 4. Docker Compose Env Vars

Key env var changes in `docker-compose.yml`:

```yaml
# CORS — allow new subdomains
CORS_ORIGIN: "${CORS_ORIGIN:-https://admin.${CLIENT_DOMAIN},https://pos.${CLIENT_DOMAIN},https://${CLIENT_DOMAIN}}"

# Better Auth
BETTER_AUTH_URL: "https://api.${CLIENT_DOMAIN}"

# Admin build-time
ADMIN_VITE_API_URL: "https://api.${CLIENT_DOMAIN}"

# Storefront runtime
STORE_NEXT_PUBLIC_API_URL: "https://api.${CLIENT_DOMAIN}"
STORE_NEXT_PUBLIC_STOREFRONT_URL: "https://${CLIENT_DOMAIN}"

# App URLs
APP_URL: "https://admin.${CLIENT_DOMAIN}"
STOREFRONT_URL: "https://${CLIENT_DOMAIN}"
```

### 5. Cookie Configuration

Better Auth cookies default to current host origin. On subdomain, cookies are scoped to that subdomain. For API (`api.domain.com`), the refresh token cookie is already httpOnly and scoped to `/api/auth/` path. No change needed — users will re-authenticate once.

## Deployment Steps (per client)

1. **Cloudflare DNS**: Add CNAME records — `api`, `admin`, `pos` → server IP
2. **Nginx Proxy Manager**: Add proxy rules for each new subdomain:
   - `api.domain.com` → `http://backend:4001`
   - `admin.domain.com` → `http://admin:8081`
   - `pos.domain.com` → `http://pos:8082`
3. **Portainer**: Update env vars as specified above, click Redeploy
4. **Verify**: Test each subdomain loads correctly
5. **Optional**: Remove old path-based nginx rules after confirmation

## Rollback

Change env vars back to path-based URLs in Portainer and redeploy. Nginx Proxy Manager still has the old path-based rules — no downtime.

## Risk Assessment

| Area | Risk | Mitigation |
|------|------|------------|
| Data loss | None | DB/Redis/files untouched |
| Session loss | Medium | Users re-login once |
| API downtime | Low | Both old and new URLs work in parallel during migration |
| TWA/PWA | None | Subdomains are required for Capacitor/TWA scope separation |
