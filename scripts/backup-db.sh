#!/bin/bash
# EcoMate Database Backup Script
# Usage: bash scripts/backup-db.sh

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_NAME="ecomate_web"
DB_USER="postgres"

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/ecomate_backup_$TIMESTAMP.sql"

echo "Backing up $DB_NAME to $BACKUP_FILE..."
pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "ecomate_backup_*.sql" -mtime +7 -delete

echo "Backup complete. File: $BACKUP_FILE"
echo "Backups directory: $(ls "$BACKUP_DIR" | wc -l | tr -d ' ') files"
