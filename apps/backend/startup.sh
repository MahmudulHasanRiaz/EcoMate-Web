#!/bin/sh

echo "[Startup] Running database migrations..."

attempt=1
max_retries=5

while [ $attempt -le $max_retries ]; do
  output=$(npx prisma migrate deploy 2>&1)
  echo "$output"

  if echo "$output" | grep -q "P3009"; then
    migration=$(echo "$output" | grep "The \`.*\` migration started" | sed "s/.*The \`//;s/\` migration started.*//")
    if [ -n "$migration" ]; then
      echo "[Startup] Resolving failed migration: $migration"
      npx prisma migrate resolve --rolled-back "$migration" 2>&1
      attempt=$((attempt + 1))
    else
      echo "[Startup] Could not parse migration name — giving up"
      break
    fi
  elif echo "$output" | grep -q "All migrations have been successfully applied"; then
    echo "[Startup] Migrations applied successfully"
    break
  else
    echo "[Startup] Migration finished (unexpected status) — continuing"
    break
  fi
done

echo "[Startup] Starting server..."
exec node dist/src/main
