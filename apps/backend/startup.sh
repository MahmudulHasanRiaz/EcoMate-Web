#!/bin/sh

echo "[Startup] Running database migrations..."

attempt=1
max_retries=5

while [ $attempt -le $max_retries ]; do
  output=$(npx prisma migrate deploy 2>&1)
  echo "$output"

  if echo "$output" | grep -q "P3018"; then
    migration=$(echo "$output" | grep "Migration name:" | sed "s/.*Migration name: *//;s/ *$//")
    if [ -n "$migration" ]; then
      if echo "$output" | grep -qi "already exists"; then
        echo "[Startup] Table already exists — marking migration as applied: $migration"
        npx prisma migrate resolve --applied "$migration" 2>&1
      else
        echo "[Startup] Migration failed with other error — marking rolled back: $migration"
        npx prisma migrate resolve --rolled-back "$migration" 2>&1
      fi
      attempt=$((attempt + 1))
    else
      echo "[Startup] Could not parse migration name from P3018 — giving up"
      break
    fi
  elif echo "$output" | grep -q "P3009"; then
    migration=$(echo "$output" | grep "The \`" | sed "s/.*The \`//;s/\` migration started.*//")
    if [ -n "$migration" ]; then
      echo "[Startup] Resolving failed migration (rolled back): $migration"
      npx prisma migrate resolve --rolled-back "$migration" 2>&1
      attempt=$((attempt + 1))
    else
      echo "[Startup] Could not parse migration name from P3009 — giving up"
      break
    fi
  elif echo "$output" | grep -q "All migrations have been successfully applied"; then
    echo "[Startup] Migrations applied successfully"
    break
  else
    echo "[Startup] Migration finished — continuing"
    break
  fi
done

echo "[Startup] Starting server..."
exec node dist/src/main
