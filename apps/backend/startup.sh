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

echo "[Startup] Running database migrations..."
npx prisma migrate deploy 2>&1
echo "[Startup] Migrations applied successfully"

if [ "$RUN_SEED" = "true" ]; then
  echo "[Startup] Running database seeding..."
  npx prisma db seed
fi

echo "[Startup] Starting server..."
exec su -s /bin/sh nestjs -c "node dist/src/main"
