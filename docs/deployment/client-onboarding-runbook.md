# Client Onboarding — Operator Runbook

Step-by-step guide for onboarding a new paid client from contract to live deployment.

## Prerequisites

- [ ] Central Portainer instance running
- [ ] GitHub Actions runner configured
- [ ] GHCR (GitHub Container Registry) write access
- [ ] Portainer Agent can connect to client server

---

## Phase 1: Server Provisioning (Operator)

```
Duration: ~30 min
```

1. **Order VPS** — Ubuntu 22.04 or 24.04, minimum:
   - 2 vCPU
   - 4GB RAM
   - 30GB SSD
   - Public IP with DNS A record

2. **Install Portainer Agent**
   ```bash
   curl -L https://downloads.portainer.io/ce2-21/portainer-agent-stack.yml -o agent-stack.yml
   # Edit agent-stack.yml → set AGENT_CLUSTER_PRV_URL if needed
   docker stack deploy --compose-file agent-stack.yml portainer-agent
   ```

3. **Connect to Central Portainer**
   - Open Portainer UI → **Environments** → **Add environment**
   - Select **Agent** → enter client server IP:9001
   - Label: `{client-name}-production`

4. **Configure DNS**
   - Ask client to point `admin.{domain}` and `www.{domain}` to server IP
   - Or set it yourself in the DNS provider

5. **Obtain SSL** (via Nginx reverse proxy or Traefik)
   - If using Nginx: add Let's Encrypt cert
   - If using Portainer's built-in: configure in stack

## Phase 2: GitHub Setup (Operator)

```
Duration: ~10 min
```

6. **Create Portainer Stack Webhook**
   - Portainer UI → **Stacks** → **Add stack**
   - Name: `{client-name}`
   - Method: **Repository**
   - Repository URL: `https://github.com/{org}/EcoMate-Web`
   - Compose path: `docker-compose.yml`
   - Environment variables: fill from Phase 2.1 table below
   - Auto-deploy: enable webhook → copy the webhook URL

7. **Set GitHub Secret**
   - GitHub → EcoMate-Web → Settings → Secrets → Actions
   - `PORTAINER_WEBHOOK_{CLIENT}` = webhook URL from step 6

### Phase 2.1: Portainer Stack Environment Variables

```yaml
# Required
CLIENT_DOMAIN: "client-domain.com"
DATABASE_URL: "postgresql://user:pass@postgres:5432/db"
JWT_SECRET: "<random-64-char-hex>"
JWT_REFRESH_SECRET: "<random-64-char-hex>"
BETTER_AUTH_SECRET: "<random-64-char-hex>"
BETTER_AUTH_URL: "https://admin.client-domain.com"
APP_URL: "https://admin.client-domain.com"
STOREFRONT_URL: "https://www.client-domain.com"
NODE_ENV: "production"

# Mobile Build (optional — skip if client doesn't have mobile license)
MOBILE_BUILDER_GITHUB_TOKEN: "<ghp_xxx>"
MOBILE_BUILDER_CALLBACK_TOKEN: "<shared-secret>"

# Optional
REDIS_URL: "redis://redis:6379"
ADMIN_EMAIL: "admin@client-domain.com"
ADMIN_PASSWORD: "<initial-password>"
```

## Phase 3: Deploy (Operator)

```
Duration: ~15 min (automated)
```

8. **Run GitHub Workflow**
   - GitHub → EcoMate-Web → Actions → **Deploy Client**
   - Select client name → **Run workflow**

9. **Verify Deployment**
   - Wait for workflow completion
   - Check Portainer → Stack → `{client-name}` → all services running
   - Visit `https://admin.{domain}/api/health` → should return 200

## Phase 4: Client Self-Service

```
Duration: ~15 min (client)
```

10. **Client receives:**
    - Admin URL: `https://admin.{domain}`
    - License key (from KeyMate or sales)
    - Admin email/password

11. **Client does:**
    - Visit admin URL → sign in
    - Auto-redirected to license activation
    - Enter license key → features unlocked
    - Go to Settings → Branding → set name, logo, colors
    - (If mobile licensed) Go to Settings → Mobile App → Publish

## Phase 5: Mobile Builder Setup (If Licensed)

```
Duration: ~15 min (operator, one-time)
```

12. **Set up Builder repo:**
    ```bash
    # Create GitHub repo: EcoMate-Mobile-Builder
    # Push existing code
    cd EcoMate-Mobile-Builder
    git init && git add . && git commit -m "initial"
    git remote add origin https://github.com/{org}/EcoMate-Mobile-Builder.git
    git push -u origin main
    ```

13. **Set GitHub Secrets** in Builder repo:
    - `MOBILE_BUILDER_CALLBACK_TOKEN` — must match ERP's value

14. **Set signing secrets** (for Play Store release):
    - `ANDROID_KEYSTORE_BASE64`
    - `ANDROID_KEYSTORE_PASSWORD`
    - `ANDROID_KEY_ALIAS`
    - See `EcoMate-Mobile-Builder/README.md` for key generation

## Verification Checklist

- [ ] Admin login works
- [ ] License activation → features load
- [ ] Branding visible on storefront
- [ ] Mobile App settings page accessible (if licensed)
- [ ] Publish triggers GitHub Action in Builder repo
- [ ] APK builds and uploads back
- [ ] Storefront footer shows download links
- [ ] `/download` page shows app cards
- [ ] APK downloads successfully
- [ ] Play Store/App Store URLs redirect correctly (if configured)

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Stack deploy fails | Missing ENV in Portainer | Fill all required ENV vars |
| License activation fails | License key not registered | Check KeyMate dashboard |
| Mobile build stuck on "running" | GitHub token missing/expired | Update `MOBILE_BUILDER_GITHUB_TOKEN` |
| APK download returns 404 | No build completed yet | Run publish first |
| Footer download buttons missing | License feature not enabled | Check `mobile_distribution` in license |
