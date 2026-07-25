#!/bin/sh
set -e

echo "[Startup] Ensuring mobile-builds directory permissions..."
mkdir -p /app/mobile-builds/.tmp /app/mobile-builds/storefront/android /app/mobile-builds/admin/android /app/mobile-builds/pos/android
chown -R 1001:1001 /app/mobile-builds 2>/dev/null || chmod -R 777 /app/mobile-builds

echo "[Startup] Running database migrations..."
npx prisma migrate deploy 2>&1
echo "[Startup] Migrations applied successfully"

if [ "$RUN_SEED" = "true" ]; then
  echo "[Startup] Running database seeding..."
  npx prisma db seed
fi

echo "[Startup] Starting server..."
exec node dist/src/main
