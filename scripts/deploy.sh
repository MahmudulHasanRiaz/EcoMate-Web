#!/bin/bash
set -e

echo "=== EcoMate Deployment Script ==="

# Check if .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found! Copy .env.example to .env and fill in values."
  exit 1
fi

# Load env vars
set -a
source .env
set +a

# Pull latest code
if [ -d .git ]; then
  echo "Pulling latest code..."
  git pull origin main
fi

# Build and deploy
echo "Building and deploying with Docker Compose..."
docker compose build --no-cache
docker compose up -d

# Wait for health checks
echo "Waiting for services to be healthy..."
sleep 10

# Check health
echo "Checking health..."
curl -f http://localhost:4000/api/health || echo "Warning: Backend health check failed"
curl -f http://localhost:3000/ || echo "Warning: Storefront health check failed"
curl -f http://localhost:80/ || echo "Warning: Admin health check failed"

echo "=== Deployment complete! ==="
