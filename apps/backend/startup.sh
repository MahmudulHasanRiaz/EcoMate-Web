#!/bin/sh
set -e

echo "[Startup] Ensuring mobile-builds directory permissions..."
mkdir -p /app/mobile-builds/.tmp /app/mobile-builds/storefront/android /app/mobile-builds/admin/android /app/mobile-builds/pos/android
chown -R 1001:1001 /app/mobile-builds

echo "[Startup] Ensuring private backup storage permissions..."
BACKUP_DIR="${BACKUP_STORAGE_DIR:-/app/backup-storage}"
BACKUP_TMP_DIR="${BACKUP_WORK_DIR:-$BACKUP_DIR/work}"
if [ "$BACKUP_DIR" = "/app/backup-storage" ]; then
  case "$BACKUP_TMP_DIR" in
    /app/backup-storage|/app/backup-storage/*) ;;
    *)
      echo "[Startup] BACKUP_WORK_DIR must stay inside /app/backup-storage"
      exit 1
      ;;
  esac
  mkdir -p "$BACKUP_DIR" "$BACKUP_TMP_DIR"
  chown -R 1001:1001 "$BACKUP_DIR"
else
  if [ ! -d "$BACKUP_DIR" ] || [ ! -d "$BACKUP_TMP_DIR" ]; then
    echo "[Startup] Custom backup directories must be pre-created and mounted"
    exit 1
  fi
  echo "[Startup] Custom backup directories must be writable by UID 1001"
fi

echo "[Startup] Resolving failed migrations (self-heal before migrate deploy)..."
# Reads the same DATABASE_URL env the migrate step uses. A failed migration row
# would otherwise block `migrate deploy` (P3009) on every redeploy until fixed by
# hand; this resolves known ones safely and aborts on unknowns.
./resolve-failed-migrations.sh
npx prisma migrate deploy 2>&1
echo "[Startup] Migrations applied successfully"

if [ "$RUN_SEED" = "true" ]; then
  echo "[Startup] Running database seeding..."
  npx prisma db seed
fi

echo "[Startup] Starting server..."

# Heap ceiling.
#
# Without this, Node uses its default old-space (~256MB here) and the process is
# killed during startup with "Ineffective mark-compacts near heap limit /
# JavaScript heap out of memory" while Prisma loads the 186-table schema. The
# crash happened during route mapping, before the server ever accepted traffic,
# so it presented as an unexplained migration/redeploy failure.
#
# Overridable so a larger host can raise it without editing this file. Must stay
# below the container memory limit in docker-compose.yml, or the kernel OOM-kills
# the process before Node's own ceiling is reached. Pass the flag through `su`
# so it reaches node, not just the shell.
: "${NODE_MAX_OLD_SPACE_SIZE:=1280}"
export NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE} ${NODE_OPTIONS:-}"
echo "[Startup] NODE_OPTIONS=${NODE_OPTIONS}"

exec su -s /bin/sh nestjs -c "NODE_OPTIONS='${NODE_OPTIONS}' node dist/src/main"
