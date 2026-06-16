# Portainer Deployment Guide — EcoMate

## Prerequisites
- Portainer instance running on your VPS
- Git repository with the codebase
- Domain pointed to VPS IP

## Step 1: Add Git Repository in Portainer
1. Go to **Settings → Git credentials**
2. Add your repo URL and credentials

## Step 2: Create Stack
1. Go to **Stacks → Add stack**
2. Name: `ecomate`
3. Build method: **Repository**
4. Repository URL: `https://github.com/your-org/ecomate-web`
5. Repository reference: `refs/heads/main`
6. Compose path: `docker-compose.yml`

## Step 3: Set Environment Variables
Fill in these environment variables in Portainer's UI:

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | Database password | `your-secure-password` |
| `JWT_SECRET` | JWT signing secret | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | JWT refresh secret | `openssl rand -hex 64` |
| `CORS_ORIGIN` | Allowed CORS origins | `https://mac.riaz.com.bd` |
| `APP_URL` | Backend public URL | `https://mac.riaz.com.bd` |
| `STOREFRONT_URL` | Storefront URL | `https://mac.riaz.com.bd` |
| `STORE_NEXT_PUBLIC_API_URL` | API URL for storefront | `https://mac.riaz.com.bd/api` |

## Step 4: Deploy
Click **Deploy the stack**. Portainer will:
1. Clone the repository
2. Build all Docker images
3. Start PostgreSQL
4. Run database migrations
5. Start backend, storefront, admin, and nginx

## Step 5: Verify
- Storefront: `https://mac.riaz.com.bd`
- Admin: `https://mac.riaz.com.bd/admin`
- API Health: `https://mac.riaz.com.bd/api/health`

## Step 6: Update
1. Go to **Stacks → ecomate → Update**
2. Portainer pulls latest code, rebuilds, and restarts with zero-downtime
