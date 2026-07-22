# Subdomain Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from path-based routing (`domain.com/admin`, `domain.com/api`, `domain.com/pos`) to subdomain-based routing (`admin.domain.com`, `api.domain.com`, `pos.domain.com`) for TWA/Capacitor compatibility.

**Architecture:** Keep path-based routing as default for backward compatibility. Add env-var-controlled subdomain support. Vite `base` paths become configurable; nginx location blocks remain unchanged (Nginx Proxy Manager handles subdomain routing to containers).

**Tech Stack:** Vite, Docker, Nginx, Nginx Proxy Manager, Cloudflare DNS

## Global Constraints

- Zero data loss — DB and files untouched
- Parallel path-based routing kept during migration for rollback safety
- All changes env-var-driven, no hardcoded values
- Default behavior unchanged (no breaking changes for existing clients)
- TWA/Capacitor compatibility verified via subdomain isolation

---

### Task 1: Make Admin Vite base configurable

**Files:**
- Modify: `apps/admin/vite.config.ts`

**Interfaces:**
- Consumes: `process.env.VITE_BASE` env var (set at build time)
- Produces: Admin built with configurable base path

- [ ] **Step 1: Read current vite.config.ts**

```bash
cat apps/admin/vite.config.ts
```

Expected: `base: '/admin/'` at line 12 (or similar)

- [ ] **Step 2: Make base env-configurable**

Change:
```ts
  base: '/admin/',
```
To:
```ts
  base: process.env.VITE_BASE || '/admin/',
```

This keeps `/admin/` as default (backward compatible). When deploying to subdomain, set `VITE_BASE=/` in the Dockerfile build args or docker-compose env.

- [ ] **Step 3: Update Dockerfile build args**

Modify `apps/admin/Dockerfile`. Add `VITE_BASE` as build arg:

```dockerfile
ARG VITE_BASE=/admin/
ENV VITE_BASE=${VITE_BASE}
```

This keeps `/admin/` as default. The docker-compose env var overrides it when needed.

- [ ] **Step 4: Verify build**

```bash
cd apps/admin && VITE_BASE=/ npx vite build 2>&1 | tail -5
```

Expected: Build succeeds, output assets use root-relative paths (`/assets/...` not `/admin/assets/...`)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/vite.config.ts apps/admin/Dockerfile
git commit -m "feat: make admin Vite base path configurable via VITE_BASE env var"
```

---

### Task 2: Make POS Vite base configurable

**Files:**
- Modify: `apps/pos/vite.config.ts`
- Modify: `apps/pos/Dockerfile`

- [ ] **Step 1: Make base env-configurable**

Same pattern as Task 1:

```ts
  base: process.env.VITE_BASE || '/pos/',
```

- [ ] **Step 2: Update Dockerfile**

```dockerfile
ARG VITE_BASE=/pos/
ENV VITE_BASE=${VITE_BASE}
```

- [ ] **Step 3: Verify build**

```bash
cd apps/pos && VITE_BASE=/ npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/pos/vite.config.ts apps/pos/Dockerfile
git commit -m "feat: make POS Vite base path configurable via VITE_BASE env var"
```

---

### Task 3: Update docker-compose with subdomain env vars

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read current docker-compose.yml admin service**

Check current env vars for the admin service.

- [ ] **Step 2: Update admin service env vars**

```yaml
admin:
  build:
    context: .
    dockerfile: apps/admin/Dockerfile
    args:
      VITE_BASE: "${ADMIN_VITE_BASE:-/admin/}"
  environment:
    VITE_API_URL: "${ADMIN_VITE_API_URL:-/api}"
    VITE_BASE: "${ADMIN_VITE_BASE:-/admin/}"
```

- [ ] **Step 3: Update backend CORS env var**

```yaml
backend:
  environment:
    CORS_ORIGIN: "${CORS_ORIGIN:-https://${CLIENT_DOMAIN}}"
```

Already templated — just document that clients should set:
```
CORS_ORIGIN=https://admin.${CLIENT_DOMAIN},https://pos.${CLIENT_DOMAIN},https://${CLIENT_DOMAIN}
```

- [ ] **Step 4: Update Better Auth URL**

```yaml
BETTER_AUTH_URL: "${BETTER_AUTH_URL:-https://${CLIENT_DOMAIN}}"
```

- [ ] **Step 5: Update storefront env vars**

```yaml
STORE_NEXT_PUBLIC_API_URL: "${STORE_NEXT_PUBLIC_API_URL:-https://${CLIENT_DOMAIN}/api}"
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add subdomain env vars to docker-compose"
```

---

### Task 4: Update backend CORS to accept subdomain origins

**Files:**
- Modify: `apps/backend/src/main.ts`

- [ ] **Step 1: Read current CORS config**

```bash
grep -n -A20 "enableCors" apps/backend/src/main.ts
```

- [ ] **Step 2: Verify CORS is already env-var-driven**

The current code reads from `CORS_ORIGIN` env var with a fallback list. No code change needed — just update the env var value.

Document the expected value for subdomain mode:
```
CORS_ORIGIN=https://admin.fixedplus.com.bd,https://pos.fixedplus.com.bd,https://www.fixedplus.com.bd
```

- [ ] **Step 3: Verify Helmet CSP allows new origins**

Check that the CSP `connectSrc` directive doesn't block the new subdomains:

```bash
grep -A5 "connectSrc\|connect-src" apps/backend/src/main.ts
```

If needed, add `https://api.*` pattern to `connectSrc`.

- [ ] **Step 4: Commit (if changes needed)**

```bash
git add apps/backend/src/main.ts
git commit -m "chore: add subdomain origins to CORS/Helmet CSP"
```

---

### Task 5: Write deployment guide

**Files:**
- Create: `docs/deployment/subdomain-migration-guide.md`

- [ ] **Step 1: Write the per-client deployment guide**

Document the exact steps:

```markdown
# Per-Client Subdomain Deployment Guide

## Prerequisites
- Access to client's Cloudflare DNS
- Access to client's Nginx Proxy Manager
- Access to client's Portainer instance

## Step 1: Cloudflare DNS
Add CNAME records:
| Name | Type | Target |
|------|------|--------|
| api  | CNAME | server-ip |
| admin | CNAME | server-ip |
| pos  | CNAME | server-ip |

## Step 2: Nginx Proxy Manager
Add proxy rules:
| Domain | Forward To |
|--------|-----------|
| api.client.com | http://localhost:4001 |
| admin.client.com | http://localhost:8081 |
| pos.client.com | http://localhost:8082 |

## Step 3: Portainer — Update Environment Variables

### Change these:

| Variable | Old Value | New Value |
|----------|-----------|-----------|
| CORS_ORIGIN | https://${CLIENT_DOMAIN} | https://admin.${CLIENT_DOMAIN},https://pos.${CLIENT_DOMAIN},https://${CLIENT_DOMAIN} |
| ADMIN_VITE_API_URL | /api | https://api.${CLIENT_DOMAIN} |
| STORE_NEXT_PUBLIC_API_URL | https://${CLIENT_DOMAIN}/api | https://api.${CLIENT_DOMAIN} |
| BETTER_AUTH_URL | https://${CLIENT_DOMAIN} | https://api.${CLIENT_DOMAIN} |
| APP_URL | https://${CLIENT_DOMAIN} | https://admin.${CLIENT_DOMAIN} |

### Add these:

| Variable | Value |
|----------|-------|
| ADMIN_VITE_BASE | / |
| POS_VITE_BASE | / |

## Step 4: Redeploy
In Portainer, click "Redeploy" for the stack.

## Step 5: Verify
- [ ] https://admin.client.com loads admin panel
- [ ] https://pos.client.com loads POS
- [ ] https://api.client.com/health returns 200
- [ ] Login works on admin
- [ ] Login works on POS
- [ ] Storefront orders/checkout still works

## Rollback
Change env vars back to path-based values in Portainer and redeploy.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment/subdomain-migration-guide.md
git commit -m "docs: add subdomain migration deployment guide"
```

---

### Task 6: Update storefront API URL flexibility

**Files:**
- Modify: `apps/storefront/lib/api-client.ts` (or wherever `API_URL` is resolved)

- [ ] **Step 1: Check current API URL resolution**

```bash
grep -rn "API_URL\|NEXT_PUBLIC_API_URL" apps/storefront/lib/api-client.ts
```

- [ ] **Step 2: Verify it's already env-configurable**

The storefront likely uses `process.env.NEXT_PUBLIC_API_URL` with a fallback. If it's already reading from env, no change needed. If it has a hardcoded fallback that assumes path-based, update the fallback.

- [ ] **Step 3: Commit (if changes needed)**

```bash
git add apps/storefront/lib/api-client.ts
git commit -m "fix: make storefront API URL resolution subdomain-aware"
```
