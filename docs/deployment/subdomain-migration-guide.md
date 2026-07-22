# Per-Client Subdomain Deployment Guide

## Prerequisites

- Access to client's Cloudflare DNS account
- Access to client's Nginx Proxy Manager (NPM)
- Access to client's Portainer instance

## Overview

| Service | Current | Target |
|---------|---------|--------|
| Storefront | `domain.com` | `domain.com` (unchanged) |
| Backend API | `domain.com/api` | `api.domain.com` |
| Admin Panel | `domain.com/admin` | `admin.domain.com` |
| POS | `domain.com/pos` | `pos.domain.com` |

## Step 1: Cloudflare DNS

Add CNAME records pointing to the server IP:

| Name | Type | Target |
|------|------|--------|
| `api` | CNAME | `<server-ip>` |
| `admin` | CNAME | `<server-ip>` |
| `pos` | CNAME | `<server-ip>` |

Existing `domain.com` and `www` records remain unchanged.

## Step 2: Nginx Proxy Manager

Add new proxy rules:

| Domain | Forward To | Scheme | WebSockets |
|--------|-----------|--------|------------|
| `api.domain.com` | `http://localhost:4001` | http | No |
| `admin.domain.com` | `http://localhost:8081` | http | No |
| `pos.domain.com` | `http://localhost:8082` | http | No |

Existing `domain.com` rule (pointing to storefront) remains unchanged.

## Step 3: Portainer — Update Stack Env Vars

Navigate to your stack in Portainer, open **Environment variables**.

### Change these existing variables:

| Variable | Old Value | New Value |
|----------|-----------|-----------|
| `CORS_ORIGIN` | `https://${CLIENT_DOMAIN}` | `https://admin.${CLIENT_DOMAIN},https://pos.${CLIENT_DOMAIN},https://${CLIENT_DOMAIN}` |
| `ADMIN_VITE_API_URL` | `/api` | `https://api.${CLIENT_DOMAIN}` |
| `STORE_NEXT_PUBLIC_API_URL` | `https://${CLIENT_DOMAIN}/api` | `https://api.${CLIENT_DOMAIN}` |
| `BETTER_AUTH_URL` | `https://${CLIENT_DOMAIN}` | `https://api.${CLIENT_DOMAIN}` |
| `APP_URL` | `https://${CLIENT_DOMAIN}` | `https://admin.${CLIENT_DOMAIN}` |

### Add these new variables:

| Variable | Value |
|----------|-------|
| `ADMIN_VITE_BASE` | `/` |
| `POS_VITE_BASE` | `/` |
| `CSP_CONNECT_SRC` | `https://api.${CLIENT_DOMAIN}` |

## Step 4: Rebuild & Redeploy

In Portainer, click **Redeploy** for the stack. The images will rebuild with the new `VITE_BASE` values, producing root-relative assets for admin and POS.

## Step 5: Verify

After redeploy, test each endpoint:

```bash
# API health
curl https://api.client.com/api/health
# Expected: {"status":"ok"}

# Admin loads
curl -s -o /dev/null -w "%{http_code}" https://admin.client.com/
# Expected: 200

# POS loads
curl -s -o /dev/null -w "%{http_code}" https://pos.client.com/
# Expected: 200

# Storefront still works
curl -s -o /dev/null -w "%{http_code}" https://www.client.com/
# Expected: 200
```

Then test in browser:
- [ ] Login to admin at `https://admin.client.com`
- [ ] View orders, products
- [ ] Login to POS at `https://pos.client.com`
- [ ] Storefront browsing and checkout

## Rollback

To roll back to path-based routing:

1. Change env vars back to path-based values (the "Old Value" column above)
2. Set `ADMIN_VITE_BASE=/admin/` and `POS_VITE_BASE=/pos/`
3. Remove NPM rules for subdomains
4. Redeploy in Portainer

The existing path-based Nginx rules inside the containers still work — no downtime during rollback.
