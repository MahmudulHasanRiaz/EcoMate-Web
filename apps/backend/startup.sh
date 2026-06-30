#!/bin/sh

echo "[Startup] Running database migrations..."
if npx prisma migrate deploy 2>&1; then
  echo "[Startup] Migrations applied successfully"
else
  echo "[Startup] Migration failed — starting server anyway"
fi

echo "[Startup] Starting server..."
exec node dist/src/main
