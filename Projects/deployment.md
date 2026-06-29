# Deployment Guide

## 1. Prerequisites

| Component | Version |
|---|---|
| PostgreSQL | 14+ |
| Ruby | 3.x (KeyMate) |
| Node.js | 18+ (EcoMate) |
| Redis | 6+ |
| Docker | 20+ (optional) |

## 2. KeyMate Server Setup

### 2.1 Clone and Configure

```bash
git clone <keymate-repo> KeyMate-2
cd KeyMate-2/backend

# Install Ruby gems
bundle install --without development test

# Copy environment
cp .env.example .env
# Edit .env with production values
```

### 2.2 Database Configuration

`config/database.yml` (production):

```yaml
production:
  adapter: postgresql
  encoding: unicode
  pool: 25
  url: <%= ENV['DATABASE_URL'] %>
```

### 2.3 Environment Variables

```bash
# Required
DATABASE_URL=postgres://keygen:password@db:5432/keygen_production
REDIS_URL=redis://redis:6379
SECRET_KEY_BASE=<openssl rand -hex 64>
ENCRYPTION_DETERMINISTIC_KEY=<generate from keygen>
ENCRYPTION_PRIMARY_KEY=<generate from keygen>
ENCRYPTION_KEY_DERIVATION_SALT=<generate from keygen>
KEYGEN_EDITION=CE
KEYGEN_MODE=singleplayer
KEYGEN_ACCOUNT_ID=<uuid>
KEYGEN_ADMIN_EMAIL=admin@example.com
KEYGEN_ADMIN_PASSWORD=<password>
KEYGEN_HOST=license.yourdomain.com
KEYGEN_DOMAIN=yourdomain.com
```

### 2.4 Setup and Seed

```bash
# Initialize database and create admin account
bundle exec rake keygen:setup

# Seed EcoMate product data (59 entitlements, 8 plans, 5 metrics)
bundle exec rake keygen:seed_products

# Start web server
bundle exec rails server -b 0.0.0.0 -p 3000

# Start background worker (separate process)
bundle exec sidekiq
```

## 3. EcoMate Server Setup

### 3.1 Clone and Configure

```bash
git clone <ecomate-repo> "EcoMate Web"
cd "EcoMate Web"

# Install dependencies
npm install

# Copy environment
cp .env.example .env
```

### 3.2 Environment Variables

```bash
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/ecomate_web"

# JWT
JWT_SECRET=<openssl rand -hex 64>
JWT_REFRESH_SECRET=<openssl rand -hex 64>  # Must differ from JWT_SECRET
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Server
PORT=4000
CORS_ORIGIN="https://client-store.com,https://admin.client-store.com"
APP_URL="https://client-store.com"

# License KeyMate Connection
LICENSE_KEY=<license-key-from-keymate>
KEYMATE_API_URL="https://license.yourdomain.com/v1/saas"
DOMAIN="client-store.com"

# Optional: API key for auto-verification
KEYMATE_API_KEY=<order-api-token>

# Optional: fallback token (pre-verified JSON cached license)
LICENSE_TOKEN=<jwt-or-cached-json>
```

### 3.3 Database Migrations

```bash
# Run Prisma migrations
npx prisma generate
npx prisma migrate deploy

# Seed initial data (payment gateways auto-seed on first bootstrap)
npx prisma db seed    # optional test data
```

### 3.4 Start Server

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 4. Docker Compose

### 4.1 KeyMate

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: keygen
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: keygen_production
    volumes: [postgres-data:/var/lib/postgresql/data]

  redis:
    image: redis:alpine
    volumes: [redis-data:/data]

  backend-api:
    build: ./backend
    command: web
    ports: ["8089:3000"]
    environment: &env
      DATABASE_URL: postgres://keygen:${POSTGRES_PASSWORD}@db:5432/keygen_production
      REDIS_URL: redis://redis:6379
      SECRET_KEY_BASE: ${SECRET_KEY_BASE}
      KEYGEN_EDITION: CE
      KEYGEN_MODE: singleplayer
      KEYGEN_HOST: license.yourdomain.com

  backend-worker:
    build: ./backend
    command: worker
    environment: *env
```

Deploy:
```bash
docker compose up -d
docker compose exec backend-api bundle exec rake keygen:seed_products
```

### 4.2 EcoMate

EcoMate uses Portainer stack deployment. Sample `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ecomate_web

  redis:
    image: redis:alpine

  backend:
    build: ./apps/backend
    ports: ["4000:4000"]
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/ecomate_web
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      LICENSE_KEY: ${LICENSE_KEY}
      KEYMATE_API_URL: ${KEYMATE_API_URL}
      DOMAIN: ${CLIENT_DOMAIN}
```

## 5. Environment Variables Reference

### KeyMate

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `SECRET_KEY_BASE` | Yes | Rails secret key base |
| `ENCRYPTION_DETERMINISTIC_KEY` | Yes | Keygen encryption key |
| `ENCRYPTION_PRIMARY_KEY` | Yes | Keygen encryption key |
| `ENCRYPTION_KEY_DERIVATION_SALT` | Yes | Keygen encryption salt |
| `KEYGEN_EDITION` | Yes | `CE` or `EE` |
| `KEYGEN_MODE` | Yes | `singleplayer` or `multiplayer` |
| `KEYGEN_ACCOUNT_ID` | Yes | UUID of the admin account |
| `KEYGEN_ADMIN_EMAIL` | Yes | Admin email |
| `KEYGEN_ADMIN_PASSWORD` | Yes | Admin password |
| `KEYGEN_HOST` | Yes | Public hostname for API |
| `KEYGEN_DOMAIN` | Yes | Root domain |
| `KEYGEN_SUBDOMAIN` | No | Subdomain prefix |

### EcoMate

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `JWT_REFRESH_SECRET` | Yes | JWT refresh signing secret |
| `PORT` | No | Server port (default 4000) |
| `CORS_ORIGIN` | No | Allowed CORS origins |
| `APP_URL` | No | App public URL |
| `LICENSE_KEY` | Yes* | KeyMate license key (*or LICENSE_TOKEN) |
| `KEYMATE_API_URL` | Yes* | KeyMate API base URL |
| `DOMAIN` | Yes* | Store domain for domain validation |
| `KEYMATE_API_KEY` | No | Per-order API token for verify calls |
| `LICENSE_TOKEN` | No | JWT fallback when KeyMate unreachable |
| `REDIS_HOST` | No | Redis host (falls back to in-memory) |
| `REDIS_PORT` | No | Redis port |
| `REDIS_PASSWORD` | No | Redis password |
| `META_PIXEL_ID` | No | Facebook/Meta tracking pixel ID |
| `META_ACCESS_TOKEN` | No | Meta API token |
| `TIKTOK_PIXEL_CODE` | No | TikTok tracking pixel code |
| `TIKTOK_ACCESS_TOKEN` | No | TikTok API token |

## 6. nginx / SSL Configuration

```nginx
# KeyMate reverse proxy
server {
    listen 443 ssl;
    server_name license.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/license.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/license.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8089;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# EcoMate reverse proxy
server {
    listen 443 ssl;
    server_name client-store.com;

    ssl_certificate /etc/letsencrypt/live/client-store.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/client-store.com/privkey.pem;

    client_max_body_size 50M;  # for uploads

    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:5173;  # Next.js storefront
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

SSL via Let's Encrypt:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d license.yourdomain.com -d client-store.com
```

## 7. Backup and Restore

### KeyMate

```bash
# Backup
pg_dump -U keygen -h localhost keygen_production > keymate_backup_$(date +%Y%m%d).sql
redis-cli SAVE && cp /var/lib/redis/dump.rdb redis_backup_$(date +%Y%m%d).rdb

# Restore
psql -U keygen -h localhost keygen_production < keymate_backup.sql
```

### EcoMate

```bash
# Backup
pg_dump -U postgres -h localhost ecomate_web > ecomate_backup_$(date +%Y%m%d).sql
cp -r apps/backend/uploads/ uploads_backup_$(date +%Y%m%d)/
cp ~/.ecomate/cache/ cache_backup_$(date +%Y%m%d)/

# Restore
psql -U postgres -h localhost ecomate_web < ecomate_backup.sql
npx prisma migrate deploy  # ensure schema matches
```

### Automated Backup Script

```bash
#!/bin/bash
BACKUP_DIR="/backups/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

pg_dump -U keygen keygen_production | gzip > $BACKUP_DIR/keymate.sql.gz
pg_dump -U postgres ecomate_web | gzip > $BACKUP_DIR/ecomate.sql.gz
tar -czf $BACKUP_DIR/uploads.tar.gz "EcoMate Web/apps/backend/uploads/"

# Keep 30 days, delete older
find /backups -type d -mtime +30 -exec rm -rf {} \;
```

Cron (daily):
```bash
0 3 * * * /usr/local/bin/backup.sh
```
