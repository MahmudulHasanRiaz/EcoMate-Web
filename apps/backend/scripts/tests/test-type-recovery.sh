#!/bin/sh
# Unit-style tests for the smart UNKNOWN recovery in resolve-failed-migrations.sh.
# Runs with plain `sh` (no DB needed): `psql` is stubbed below and the resolve
# script is sourced with resolution NOT auto-running (see its bottom guard).
#
# Usage: sh apps/backend/scripts/tests/test-type-recovery.sh

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RESOLVE_SH="$SCRIPT_DIR/../resolve-failed-migrations.sh"

pass=0
fail=0

ok() {
  pass=$((pass + 1))
  echo "  ok: $1"
}

nope() {
  fail=$((fail + 1))
  echo "  FAIL: $1"
}

# --- psql stub ---------------------------------------------------------------
# Dispatches on the SQL text (always the last argument). Scenario knobs:
#   MOCK_DEPENDENTS (count, default 0), MOCK_TABLES (space list, default empty),
#   MOCK_ROWS (row count for quoted-table counts, default 0),
#   MOCK_MIG_TABLES (migration-table presence, default 0),
#   MOCK_TYPE_EXISTS (default 1), DROP_RC (DROP exit code, default 0).
# Every DROP TYPE statement is appended to DROP_LOG.
DROP_LOG="$(mktemp)"
psql() {
  sql=""
  has_c=0
  for arg in "$@"; do
    sql="$arg"
    if [ "$arg" = "-c" ]; then has_c=1; fi
  done
  case "$sql" in
    *DROP\ TYPE*)
      printf '%s\n' "$sql" >> "$DROP_LOG"
      return "${DROP_RC:-0}"
      ;;
    *CREATE\ EXTENSION*)
      return 0
      ;;
  esac
  if [ "$has_c" = "1" ]; then
    echo "STUBpsql: unexpected -c query: $sql" >&2
    return 0
  fi
  case "$sql" in
    *SELECT\ DISTINCT\ c.relname*) printf '%s' "${MOCK_TABLES:-}" ; return 0 ;;
    *FROM\ pg_attribute*) printf '%s' "${MOCK_DEPENDENTS:-0}" ; return 0 ;;
    *SELECT\ count\(\*\)\ FROM\ \"*) printf '%s' "${MOCK_ROWS:-0}" ; return 0 ;;
    *FROM\ pg_tables*) printf '%s' "${MOCK_MIG_TABLES:-0}" ; return 0 ;;
    *FROM\ pg_type\ WHERE\ typname*) printf '%s' "${MOCK_TYPE_EXISTS:-1}" ; return 0 ;;
  esac
  echo "STUBpsql: unexpected query: $sql" >&2
  printf '0'
  return 0
}

export DATABASE_URL="mock://test"
# shellcheck disable=SC1090
. "$RESOLVE_SH"

reset_mocks() {
  MOCK_DEPENDENTS=0
  MOCK_TABLES=""
  MOCK_ROWS=0
  MOCK_MIG_TABLES=0
  MOCK_TYPE_EXISTS=1
  DROP_RC=0
  : > "$DROP_LOG"
}

echo "[1] type with no dependents -> drops"
reset_mocks
if safe_drop_conflicting_type "LeaveStatus"; then
  if grep -q 'DROP TYPE IF EXISTS "LeaveStatus";' "$DROP_LOG"; then
    ok "dropped unused type"
  else
    nope "returned 0 but no DROP issued"
  fi
else
  nope "refused a type with zero dependents"
fi

echo "[2] type with non-empty dependent table -> refuses, no drop"
reset_mocks
MOCK_DEPENDENTS=2
MOCK_TABLES="LeaveRequest"
MOCK_ROWS=5
if safe_drop_conflicting_type "LeaveStatus"; then
  nope "dropped a type backing 5 rows"
else
  if [ -s "$DROP_LOG" ]; then
    nope "refused but still issued a DROP"
  else
    ok "refused data-bearing type without dropping"
  fi
fi

echo "[3] type with only empty dependent tables -> drops"
reset_mocks
MOCK_DEPENDENTS=2
MOCK_TABLES="LeaveType LeaveRequest"
MOCK_ROWS=0
if safe_drop_conflicting_type "LeaveStatus"; then
  if grep -q 'DROP TYPE IF EXISTS "LeaveStatus";' "$DROP_LOG"; then
    ok "dropped type with empty dependents"
  else
    nope "returned 0 but no DROP issued"
  fi
else
  nope "refused a type with only empty dependents"
fi

echo "[4] allowlist mapping (migrations -> types, tables)"
reset_mocks
t="$(conflict_types_for_migration 20260827000000_add_hr_leave)"
[ "$t" = "LeaveStatus" ] && ok "hr_leave -> LeaveStatus" || nope "hr_leave maps to '$t'"
t="$(conflict_types_for_migration 20260829000000_add_hr_domain_enums)"
n="$(printf '%s' "$t" | wc -w | tr -d '[:space:]')"
[ "$n" = "9" ] && ok "domain enums -> 9 types" || nope "domain enums maps to $n types"
t="$(conflict_types_for_migration 20260927000100_courier_settlement_core)"
[ "$t" = "CourierSettlementInvoiceState" ] && ok "courier core -> state type" || nope "courier core maps to '$t'"
t="$(conflict_types_for_migration 20261001000100_hr_shift_preset_and_overtime)"
[ -z "$t" ] && ok "unlisted migration -> empty" || nope "unlisted maps to '$t'"
t="$(conflict_tables_for_migration 20260827000000_add_hr_leave)"
[ "$t" = "LeaveType LeaveRequest" ] && ok "hr_leave tables listed" || nope "hr_leave tables = '$t'"

echo "[5] suspicious type name -> refuses without touching the DB"
reset_mocks
if safe_drop_conflicting_type 'LeaveStatus"; DROP TABLE "Employee'; then
  nope "accepted a hostile type name"
else
  [ -s "$DROP_LOG" ] && nope "issued DROP for hostile name" || ok "refused hostile name"
fi

echo "[6] probe default arm unchanged (unknown migration -> UNKNOWN)"
reset_mocks
[ "$(probe_ddl definitely_not_a_migration_xyz)" = "UNKNOWN" ] && ok "default arm intact" || nope "default arm changed"

echo "[7] recover_type_conflict rejects unlisted migration"
reset_mocks
if recover_type_conflict 20261001000100_hr_shift_preset_and_overtime; then
  nope "recovered an unlisted migration"
else
  [ -s "$DROP_LOG" ] && nope "dropped for unlisted migration" || ok "unlisted untouched"
fi

echo "[8] recover_type_conflict refuses when migration tables exist"
reset_mocks
MOCK_MIG_TABLES=1
if recover_type_conflict 20260827000000_add_hr_leave; then
  nope "recovered despite existing tables"
else
  [ -s "$DROP_LOG" ] && nope "dropped despite existing tables" || ok "partial tables stay FATAL-path"
fi

echo "[9] recover_type_conflict happy path drops the orphan type"
reset_mocks
MOCK_MIG_TABLES=0
MOCK_TYPE_EXISTS=1
MOCK_DEPENDENTS=0
if recover_type_conflict 20260827000000_add_hr_leave; then
  grep -q 'DROP TYPE IF EXISTS "LeaveStatus";' "$DROP_LOG" && ok "orphan type dropped" || nope "rc 0 but no DROP"
else
  nope "happy path failed"
fi

echo "[10] recover_type_conflict skips absent types"
reset_mocks
MOCK_MIG_TABLES=0
MOCK_TYPE_EXISTS=0
if recover_type_conflict 20260827000000_add_hr_leave; then
  [ -s "$DROP_LOG" ] && nope "dropped an absent type" || ok "absent type skipped"
else
  nope "absent-type path failed"
fi

rm -f "$DROP_LOG"
echo "----"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
