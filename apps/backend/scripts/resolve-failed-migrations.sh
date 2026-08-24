#!/bin/sh
# resolve-failed-migrations.sh
#
# Self-healing pre-flight for `prisma migrate deploy`.
#
# Problem: a single failed migration row in `_prisma_migrations` (started_at set,
# finished_at NULL, rolled_back_at NULL) makes `migrate deploy` refuse to run
# anything (P3009) until a human runs `prisma migrate resolve`. In containers
# that auto-migrate on boot this bricks every redeploy until it is fixed by hand.
#
# This script detects those rows and resolves the KNOWN one(s) safely:
#   - First reconciles the HR-domain base schema (see reconcile-hr-base.sql) so a
#     rolled-back migration can actually re-apply after drift (P3018 fix).
#   - If the migration's DDL verifiably landed  -> `resolve --applied`
#   - If the migration's DDL verifiably did NOT -> `resolve --rolled-back`
#   - Any migration we cannot classify         -> ABORT (fail safe, never guess)
#
# The DDL-present probe per migration lives in probe_ddl(). Add entries there.
# Unknown migrations stop startup with a clear message instead of risking a
# corrupt/incomplete schema from an automated --applied.

set -e

: "${DATABASE_URL:?resolve-failed-migrations.sh requires DATABASE_URL}"

# Reconciliation SQL: recreates the HR-domain BASE objects (enums + tables) to
# the exact applied-state shape the migration chain expects at
# 20260823120001_add_payslip_lifecycle_groundwork, CREATE-if-absent /
# skip-if-exists throughout. Heals the drift that causes P3018 "type ... does
# not exist" when a rolled-back migration is re-applied against a database whose
# base objects never materialised (history recorded applied, schema missing).
# Resolve relative to this script's directory so it works both in the container
# (/app) and when run from the repo checkout (apps/backend).
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RECONCILE_SQL="${SCRIPT_DIR}/reconcile-hr-base.sql"
apply_reconcile() {
  if [ -f "$RECONCILE_SQL" ]; then
    echo "[Startup] Applying HR base reconciliation (heals missing base objects)..."
    if PGOPTIONS='-c client_min_messages=warning' psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$RECONCILE_SQL" 2>&1; then
      echo "[Startup] HR base reconciliation applied (no-op when everything exists)."
    else
      echo "[Startup] FATAL: HR base reconciliation failed."
      exit 1
    fi
  else
    echo "[Startup] WARN: reconciliation file not found at $RECONCILE_SQL — skipping."
  fi
}

# Select migrations that STARTED but never FINISHED and were never rolled back.
# These are the rows that trip P3009.
failed_migrations() {
  psql "$DATABASE_URL" -tAc \
    'SELECT migration_name FROM "_prisma_migrations"
     WHERE "started_at" IS NOT NULL AND "finished_at" IS NULL
       AND "rolled_back_at" IS NULL
     ORDER BY migration_name;'
}

# probe_ddl <migration_name> -> prints "APPLIED" | "NOT_APPLIED" | "UNKNOWN"
#
# A migration is APPLIED when the schema objects it created are present,
# NOT_APPLIED when they are all absent. Anything else (partial/ambiguous) is
# UNKNOWN and the caller must abort rather than guess.
probe_ddl() {
  case "$1" in
    20260823120001_add_payslip_lifecycle_groundwork)
      # DDL: enum PayslipStatus + 'reviewed' + 'partially_paid';
      #      Payslip table + reviewedAt/approvedAt/periodKey columns.
      enum_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'PayslipStatus'
             AND e.enumlabel IN ('reviewed','partially_paid');"
      )"
      col_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'Payslip'
             AND column_name IN ('reviewedAt','approvedAt','periodKey');"
      )"
      if [ "$enum_count" = "2" ] && [ "$col_count" = "3" ]; then
        echo "APPLIED"
      elif [ "$enum_count" = "0" ] && [ "$col_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;
    *)
      echo "UNKNOWN"
      ;;
  esac
}

resolve_failed() {
  # ALWAYS reconcile the HR base first. Production drift can leave a base object
  # missing while every migration row is marked applied (the exact cause of
  # P3018 "type ... does not exist") — the reconciliation creates anything absent
  # and skips anything present, so it heals the schema before we even look at
  # failed rows. Safe to run on every boot (all guards idempotent).
  apply_reconcile

  echo "[Startup] Detecting failed migrations..."
  failures="$(failed_migrations)"
  if [ -z "$failures" ]; then
    echo "[Startup] No failed migrations."
    return 0
  fi

  echo "[Startup] Failed migration(s) found:"
  echo "$failures"

  for m in $failures; do
    state="$(probe_ddl "$m")"
    case "$state" in
      APPLIED)
        echo "[Startup] Migration '$m': DDL is present -> marking as applied."
        npx prisma migrate resolve --applied "$m"
        ;;
      NOT_APPLIED)
        echo "[Startup] Migration '$m': DDL is absent -> marking as rolled back (re-applies on next deploy)."
        npx prisma migrate resolve --rolled-back "$m"
        ;;
      *)
        echo "[Startup] FATAL: cannot safely auto-resolve failed migration '$m'."
        echo "[Startup] Resolve manually: npx prisma migrate resolve --applied|--rolled-back '$m'"
        echo "[Startup] then redeploy."
        exit 1
        ;;
    esac
  done

  echo "[Startup] Failed migrations resolved."
}

resolve_failed
