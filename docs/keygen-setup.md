# Keygen CE Setup Guide

Deploy self-hosted Keygen license server via Docker, configure admin access, create products/policies, and generate API credentials.

## 1. Deploy Stack

### Portainer (recommended)

1. Create a new stack from `portainer/keygen/docker-compose.yml`
2. Copy `portainer/keygen/.env.example` → `.env` and fill values
3. Deploy the stack

### CLI

```bash
docker compose -f portainer/keygen/docker-compose.yml --env-file portainer/keygen/.env up -d
```

## 2. Create Admin Account

SSH into the keygen container and create an admin user:

```bash
docker exec -it keygen bash -c "rails runner 'User.create(email: \"admin@ecomate.com\", password: \"SECURE_PASSWORD\", role: \"admin\")'"
```

Save the admin email and password securely.

## 3. Create Product

```bash
curl -X POST https://license.yourdomain.com/v1/products \
  -H "Authorization: Bearer $KEYGEN_API_KEY" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "products",
      "attributes": {
        "name": "EcoMate Enterprise"
      }
    }
  }'
```

Save the returned `productId`.

## 4. Create License Policy

```bash
curl -X POST https://license.yourdomain.com/v1/policies \
  -H "Authorization: Bearer $KEYGEN_API_KEY" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "policies",
      "attributes": {
        "name": "Enterprise Plan",
        "productId": "PRODUCT_ID",
        "requireFingerprint": true,
        "maxMachines": 3,
        "checkInInterval": 604800,
        "scheme": "ed25519"
      }
    }
  }'
```

Replace `PRODUCT_ID` with the ID from step 3.

## 5. Generate API Key

```bash
curl -X POST https://license.yourdomain.com/v1/tokens \
  -H "Authorization: Bearer $KEYGEN_ADMIN_TOKEN" \
  -H "Content-Type: application/vnd.api+json"
```

Save the returned token — this is your Keygen API key for GitHub Actions and app integration.

## 6. Create License Policy for FIXEDPLUS

Repeat step 4 with name `"Fixed Plus Plan"` and adjust `maxMachines` and other attributes as needed.

## Environment Variables

| Variable | Description |
|---|---|
| `KEYGEN_DB_PASSWORD` | Postgres password |
| `KEYGEN_SECRET_KEY` | Run `openssl rand -hex 64` to generate |
| `KEYGEN_HOST` | Public URL of the license server |
| `KEYGEN_ACCOUNT_ID` | Keygen account UUID |
