#!/bin/sh

echo "[Startup] Running database migrations..."

max_retries=5
attempt=1

while [ $attempt -le $max_retries ]; do
  output=$(npx prisma migrate deploy 2>&1)
  exit_code=$?
  echo "$output"

  if [ $exit_code -eq 0 ]; then
    echo "[Startup] Migrations applied successfully"
    break
  fi

  # Extract migration name from P3018/P3009 error format:
  #   "The migration `20260625201147_add_accounting_integration` was not applied"
  #   "The `20260625201147_add_accounting_integration` migration failed"
  migration=$(echo "$output" | sed -n 's/.*The migration `\([^`]*\)`.*/\1/p' | head -1)
  if [ -z "$migration" ]; then
    migration=$(echo "$output" | sed -n 's/.*The `\([^`]*\)` migration.*/\1/p' | head -1)
  fi

  if [ -z "$migration" ]; then
    echo "[Startup] Could not parse migration name — cannot auto-resolve. Giving up."
    exit 1
  fi

  # P3018 = migration not applied but DB already has objects → mark as applied
  if echo "$output" | grep -q "P3018"; then
    echo "[Startup] P3018 — objects already exist, marking migration as applied: $migration"
    npx prisma migrate resolve --applied "$migration" 2>&1
  else
    echo "[Startup] Migration failed — marking as rolled back: $migration"
    npx prisma migrate resolve --rolled-back "$migration" 2>&1
  fi

  attempt=$((attempt + 1))
  [ $attempt -le $max_retries ] && echo "[Startup] Retrying migration (attempt $attempt/$max_retries)..."
done

echo "[Startup] Starting server..."
exec node dist/src/main
