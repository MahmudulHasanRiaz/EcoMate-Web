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
#   - First runs fix-p2039.sql (P2039 FK repair — must happen before reconciliation)
#   - Then reconciles the HR-domain base schema (see reconcile-hr-base.sql) so a
#     rolled-back migration can actually re-apply after drift (P3018 fix).
#   - If the migration's DDL verifiably landed  -> `resolve --applied`
#   - If the migration's DDL verifiably did NOT -> `resolve --rolled-back`
#   - Any migration we cannot classify         -> ABORT (fail safe, never guess)
#
# The DDL-present probe per migration lives in probe_ddl(). Add entries there.
# Unknown migrations stop startup with a clear message instead of risking a
# corrupt/incomplete schema from an automated --applied.
#
# v2: Added probes for ALL HR-domain migrations (not just payslip_lifecycle_groundwork).
#     Added deduplication for multiple failed rows with the same migration name.
#     Added fix-p2039.sql execution before reconciliation.
# v3: Added probes for all Courier Settlement migrations (20260927/28) so redeploy
#     self-heals settlement migration failures without manual intervention.
# v4: Startup ensures pgcrypto (gen_random_uuid defaults failed silently without it).
#     Smart UNKNOWN recovery for known type-conflict migrations: when a migration
#     failed with P3018 because a db-push-era enum type already exists while none
#     of its tables do, the orphan type is dropped ONLY if no existing table uses
#     it (or every dependent table is empty), then the probe re-runs and the
#     migration resolves as rolled back so deploy retries it. Anything unsafe or
#     unlisted still aborts (fail safe, never guess).

set -e

: "${DATABASE_URL:?resolve-failed-migrations.sh requires DATABASE_URL}"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# --- Step 0a: pgcrypto (idempotent; must precede every migration) -----------------
# Some client DBs lack the extension, so CREATE TABLE with a gen_random_uuid()
# default fails — previously a silent failure that left partial state behind.
ensure_pgcrypto() {
  echo "[Startup] Ensuring pgcrypto extension (gen_random_uuid() defaults)..."
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";' 2>&1; then
    echo "[Startup] pgcrypto ready."
  else
    echo "[Startup] FATAL: could not ensure pgcrypto extension."
    exit 1
  fi
}

# --- Step 0: Fix P2039 (FK constraint repair) -----------------------------------
# Must run BEFORE reconciliation so the FK exists when reconcile checks for it.
fix_p2039() {
  FIX_SQL="${SCRIPT_DIR}/fix-p2039.sql"
  if [ -f "$FIX_SQL" ]; then
    echo "[Startup] Running P2039 FK fix (Employee.betterAuthUser relation)..."
    if PGOPTIONS='-c client_min_messages=warning' psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f "$FIX_SQL" 2>&1; then
      echo "[Startup] P2039 FK fix applied."
    else
      echo "[Startup] WARN: P2039 fix had errors (non-fatal, continuing)."
    fi
  fi
}

# --- Step 1: Reconcile HR base schema -------------------------------------------
apply_reconcile() {
  RECONCILE_SQL="${SCRIPT_DIR}/reconcile-hr-base.sql"
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

# --- Failed migration detection -------------------------------------------------
# Returns unique migration names (deduplicates if same name appears multiple times).
failed_migrations() {
  psql "$DATABASE_URL" -tAc \
    'SELECT DISTINCT migration_name FROM "_prisma_migrations"
     WHERE "started_at" IS NOT NULL AND "finished_at" IS NULL
       AND "rolled_back_at" IS NULL
     ORDER BY migration_name;'
}

# --- DDL probes per migration ---------------------------------------------------
# probe_ddl <migration_name> -> prints "APPLIED" | "NOT_APPLIED" | "UNKNOWN"
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

    20260823130000_add_employment_domain)
      # DDL: enum EmployeeStatus + 'on_leave','suspended';
      #      Employee.reportingToId + EmploymentHistory + WeeklyOff tables.
      emp_status="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'EmployeeStatus'
             AND e.enumlabel IN ('on_leave','suspended');"
      )"
      col_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'Employee' AND column_name = 'reportingToId';"
      )"
      tbl_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public'
           AND tablename IN ('EmploymentHistory','WeeklyOff');"
      )"
      if [ "$emp_status" = "2" ] && [ "$col_count" = "1" ] && [ "$tbl_count" = "2" ]; then
        echo "APPLIED"
      elif [ "$emp_status" = "0" ] && [ "$col_count" = "0" ] && [ "$tbl_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260824000000_add_hr_ledgers)
      # DDL: enums EarningType/DeductionType/LedgerStatus;
      #      EmployeeEarning + EmployeeDeduction tables; SalaryStructure.effectiveTo.
      enum_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_type t WHERE t.typname IN ('EarningType','DeductionType','LedgerStatus');"
      )"
      tbl_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public'
           AND tablename IN ('EmployeeEarning','EmployeeDeduction');"
      )"
      eff_col="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'SalaryStructure' AND column_name = 'effectiveTo';"
      )"
      if [ "$enum_count" = "3" ] && [ "$tbl_count" = "2" ] && [ "$eff_col" = "1" ]; then
        echo "APPLIED"
      elif [ "$enum_count" = "0" ] && [ "$tbl_count" = "0" ] && [ "$eff_col" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260825000000_payroll_lifecycle_and_payments)
      # DDL: PayrollPayment table + Payslip.employeeId_periodKey unique index.
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='PayrollPayment';"
      )"
      idx="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_indexes WHERE indexname='Payslip_employeeId_periodKey_key';"
      )"
      if [ "$tbl" = "1" ] && [ "$idx" = "1" ]; then
        echo "APPLIED"
      elif [ "$tbl" = "0" ] && [ "$idx" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260826000000_add_commissions)
      # DDL: CommissionAmountType enum + CommissionRule + CommissionEarning tables.
      enum="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_type t WHERE t.typname = 'CommissionAmountType';"
      )"
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public'
           AND tablename IN ('CommissionRule','CommissionEarning');"
      )"
      if [ "$enum" = "1" ] && [ "$tbl" = "2" ]; then
        echo "APPLIED"
      elif [ "$enum" = "0" ] && [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260827000000_add_hr_leave)
      # DDL: LeaveStatus enum + LeaveType + LeaveRequest tables.
      enum="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_type t WHERE t.typname = 'LeaveStatus';"
      )"
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public'
           AND tablename IN ('LeaveType','LeaveRequest');"
      )"
      if [ "$enum" = "1" ] && [ "$tbl" = "2" ]; then
        echo "APPLIED"
      elif [ "$enum" = "0" ] && [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260827000001_seed_hr_leave_types)
      # DDL: rows in LeaveType table.
      count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM \"LeaveType\";"
      )"
      if [ "$count" -gt 0 ] 2>/dev/null; then
        echo "APPLIED"
      else
        echo "NOT_APPLIED"
      fi
      ;;

    20260828000000_add_attendance)
      # DDL: AttendanceStatus enum + AttendanceRecord table.
      enum="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_type t WHERE t.typname = 'AttendanceStatus';"
      )"
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='AttendanceRecord';"
      )"
      if [ "$enum" = "1" ] && [ "$tbl" = "1" ]; then
        echo "APPLIED"
      elif [ "$enum" = "0" ] && [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260829000000_add_hr_domain_enums)
      # DDL: EmployeeGender, AttendanceMethod, AttendanceModeSetting, etc. enums.
      enum_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_type t WHERE t.typname IN (
            'EmployeeGender','AttendanceMethod','AttendanceModeSetting',
            'AttendanceSessionSource','BankAccountType','BankVerificationStatus',
            'AttendanceDeviceSyncStatus','AttendanceEventType','AttendanceEventStatus'
          );"
      )"
      if [ "$enum_count" = "9" ]; then
        echo "APPLIED"
      elif [ "$enum_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260829000001_add_employee_hr_profile_fields)
      # DDL: Employee.dateOfBirth, gender, nationality, nidNumber, etc. columns.
      col_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'Employee' AND column_name IN (
             'dateOfBirth','gender','nationality','nidNumber',
             'presentAddress','permanentAddress','emergencyContactName',
             'emergencyContactPhone','emergencyContactRelation',
             'confirmationDate','exitReason','attendanceMethod'
           );"
      )"
      if [ "$col_count" = "12" ]; then
        echo "APPLIED"
      elif [ "$col_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260829000002_add_employee_bank_account)
      # DDL: EmployeeBankAccount table.
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='EmployeeBankAccount';"
      )"
      if [ "$tbl" = "1" ]; then
        echo "APPLIED"
      elif [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260829000003_add_attendance_settings)
      # DDL: AttendanceSettings table.
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='AttendanceSettings';"
      )"
      if [ "$tbl" = "1" ]; then
        echo "APPLIED"
      elif [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260829000004_attendance_day_session_break)
      # DDL: AttendanceDay, AttendanceSession, AttendanceBreak tables.
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public'
           AND tablename IN ('AttendanceDay','AttendanceSession','AttendanceBreak');"
      )"
      if [ "$tbl" = "3" ]; then
        echo "APPLIED"
      elif [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260829000005_add_attendance_adjustment)
      # DDL: AttendanceAdjustment table.
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='AttendanceAdjustment';"
      )"
      if [ "$tbl" = "1" ]; then
        echo "APPLIED"
      elif [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260829000006_add_attendance_device_tables)
      # DDL: AttendanceDevice, DeviceEmployeeMapping, RawAttendanceEvent tables.
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public'
           AND tablename IN ('AttendanceDevice','DeviceEmployeeMapping','RawAttendanceEvent');"
      )"
      if [ "$tbl" = "3" ]; then
        echo "APPLIED"
      elif [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260830000000_hr_hardening_actors)
      # DDL: Payslip.reviewedById, approvedById; SalaryStructure.createdById, updatedById.
      col_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE (table_name = 'Payslip' AND column_name IN ('reviewedById','approvedById'))
              OR (table_name = 'SalaryStructure' AND column_name IN ('createdById','updatedById'));"
      )"
      if [ "$col_count" = "4" ]; then
        echo "APPLIED"
      elif [ "$col_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260830000001_hr_commission_reversal)
      # DDL: CommissionReversal table.
      tbl="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='CommissionReversal';"
      )"
      if [ "$tbl" = "1" ]; then
        echo "APPLIED"
      elif [ "$tbl" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260830000002_hr_payment_void)
      # DDL: PayrollPayment.voidedAt, voidedById, voidReason columns.
      col_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'PayrollPayment'
             AND column_name IN ('voidedAt','voidedById','voidReason');"
      )"
      if [ "$col_count" = "3" ]; then
        echo "APPLIED"
      elif [ "$col_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260831000000_add_hr_phase2_audit_fields)
      # DDL: EmploymentHistoryField enum + personalInformation/employmentInformation/bankAccount;
      #      EmployeeBankAccount.verificationNote.
      enum_vals="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'EmploymentHistoryField'
             AND e.enumlabel IN ('personalInformation','employmentInformation','bankAccount');"
      )"
      col="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'EmployeeBankAccount' AND column_name = 'verificationNote';"
      )"
      if [ "$enum_vals" = "3" ] && [ "$col" = "1" ]; then
        echo "APPLIED"
      elif [ "$enum_vals" = "0" ] && [ "$col" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260927000100_courier_settlement_core)
      # DDL: CourierSettlementInvoiceState enum + CourierSettlementInvoice table.
      enum_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_type t WHERE t.typname = 'CourierSettlementInvoiceState';"
      )"
      tbl_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='CourierSettlementInvoice';"
      )"
      if [ "$enum_count" = "1" ] && [ "$tbl_count" = "1" ]; then
        echo "APPLIED"
      elif [ "$enum_count" = "0" ] && [ "$tbl_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260927000200_courier_settlement_revision_activity)
      # DDL: CourierSettlementActivityAction gains 'ACKNOWLEDGED' enum value.
      enum_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'CourierSettlementActivityAction' AND e.enumlabel = 'ACKNOWLEDGED';"
      )"
      if [ "$enum_count" = "1" ]; then
        echo "APPLIED"
      elif [ "$enum_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260927000300_courier_settlement_adjusted_state)
      # DDL: CourierSettlementInvoiceState gains 'ADJUSTED' + 'RECONCILED' enum values.
      enum_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'CourierSettlementInvoiceState' AND e.enumlabel IN ('ADJUSTED','RECONCILED');"
      )"
      if [ "$enum_count" = "2" ]; then
        echo "APPLIED"
      elif [ "$enum_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260928000100_fix_ledger_funding_type_enum)
      # DDL: MarketingFundingLedger.fundingType cast from TEXT to MarketingFundingType enum.
      col_type="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT udt_name FROM information_schema.columns
           WHERE table_name = 'MarketingFundingLedger' AND column_name = 'fundingType';"
      )"
      if [ "$col_type" = "MarketingFundingType" ]; then
        echo "APPLIED"
      elif [ "$col_type" = "text" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260928000110_align_schema_db_drift)
      # DDL: JournalEntry.marketingPaymentId column dropped.
      col_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'JournalEntry' AND column_name = 'marketingPaymentId';"
      )"
      if [ "$col_count" = "0" ]; then
        echo "APPLIED"
      elif [ "$col_count" = "1" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260928000200_courier_settlement_scalability)
      # DDL: CourierSettlementFinanceRuleVersion table created.
      tbl_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='CourierSettlementFinanceRuleVersion';"
      )"
      if [ "$tbl_count" = "1" ]; then
        echo "APPLIED"
      elif [ "$tbl_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20260928000300_invoice_source_headers)
      # DDL: CourierSettlementInvoice.sourceHeaders column added.
      col_count="$(
        psql "$DATABASE_URL" -tAc \
          "SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'CourierSettlementInvoice' AND column_name = 'sourceHeaders';"
      )"
      if [ "$col_count" = "1" ]; then
        echo "APPLIED"
      elif [ "$col_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20261001000100_hr_shift_preset_and_overtime)
      table_count="$(
        psql "$DATABASE_URL" -t -A -c \
          "SELECT count(*) FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'ShiftPreset';"
      )"
      if [ "$table_count" = "1" ]; then
        echo "APPLIED"
      elif [ "$table_count" = "0" ]; then
        echo "NOT_APPLIED"
      else
        echo "UNKNOWN"
      fi
      ;;

    20261002000100_hr_tasks_and_order_staff_performance)
      table_count="$(
        psql "$DATABASE_URL" -t -A -c \
          "SELECT count(*) FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'TaskTimeEntry';"
      )"
      if [ "$table_count" = "1" ]; then
        echo "APPLIED"
      elif [ "$table_count" = "0" ]; then
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

# --- Smart UNKNOWN recovery: known type-conflict migrations ----------------------
# A failed migration whose enum type already exists (db-push era leftovers)
# while NONE of its tables exist probes as UNKNOWN (type=1, tables=0) and used
# to crash-loop the container. The allowlist below is the ONLY set eligible
# for automatic recovery — anything else still aborts.
#
# NOTE: the directive names the courier row `20260928000000_add_courier_settlement`,
# but no such migration directory exists; the real migration creating
# CourierSettlementInvoiceState + CourierSettlementInvoice is
# `20260927000100_courier_settlement_core`. Both names map to the same entry
# (the nonexistent one can never match a real failed row).
conflict_types_for_migration() {
  case "$1" in
    20260826000000_add_commissions) echo "CommissionAmountType" ;;
    20260827000000_add_hr_leave) echo "LeaveStatus" ;;
    20260828000000_add_attendance) echo "AttendanceStatus" ;;
    20260829000000_add_hr_domain_enums) echo "EmployeeGender AttendanceMethod AttendanceModeSetting AttendanceSessionSource BankAccountType BankVerificationStatus AttendanceDeviceSyncStatus AttendanceEventType AttendanceEventStatus" ;;
    20260928000000_add_courier_settlement|20260927000100_courier_settlement_core) echo "CourierSettlementInvoiceState" ;;
    *) echo "" ;;
  esac
}

# Tables that must ALL be absent for the drop to be considered. Any partial
# table presence means real migration progress -> manual resolution.
conflict_tables_for_migration() {
  case "$1" in
    20260826000000_add_commissions) echo "CommissionRule CommissionEarning" ;;
    20260827000000_add_hr_leave) echo "LeaveType LeaveRequest" ;;
    20260828000000_add_attendance) echo "AttendanceRecord" ;;
    20260928000000_add_courier_settlement|20260927000100_courier_settlement_core) echo "CourierSettlementInvoice" ;;
    *) echo "" ;;
  esac
}

# safe_drop_conflicting_type <type_name> -> 0 if dropped (or already absent
# handling is done by the caller), 1 if unsafe. NEVER drops a type that backs
# data: zero dependents -> drop; otherwise every dependent table must be empty.
# Postgres itself is the backstop — DROP fails if a view/default still needs
# the type, and ON_ERROR_STOP propagates that failure.
safe_drop_conflicting_type() {
  drop_type="$1"
  case "$drop_type" in
    ''|*[!A-Za-z0-9_]*)
      echo "[Startup] FATAL: refusing to handle suspicious type name '$drop_type'."
      return 1
      ;;
  esac
  dep_count="$(psql "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM pg_attribute a
     JOIN pg_class c ON a.attrelid = c.oid
     JOIN pg_type t ON a.atttypid = t.oid
     WHERE t.typname = '$drop_type'
     AND c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace;")"
  dep_count="$(printf '%s' "$dep_count" | tr -d '[:space:]')"
  if [ "$dep_count" = "0" ]; then
    echo "[Startup] Type \"$drop_type\" is used by no existing table -> safe to drop."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DROP TYPE IF EXISTS \"$drop_type\";"
    return $?
  fi
  echo "[Startup] Type \"$drop_type\" backs $dep_count column(s); checking row counts..."
  dep_tables="$(psql "$DATABASE_URL" -tAc \
    "SELECT DISTINCT c.relname FROM pg_attribute a
     JOIN pg_class c ON a.attrelid = c.oid
     JOIN pg_type t ON a.atttypid = t.oid
     WHERE t.typname = '$drop_type'
     AND c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace;")"
  for dep_tbl in $dep_tables; do
    case "$dep_tbl" in
      ''|*[!A-Za-z0-9_]*)
        echo "[Startup] FATAL: refusing to inspect suspicious table name '$dep_tbl'."
        return 1
        ;;
    esac
    dep_rows="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM \"$dep_tbl\";")"
    dep_rows="$(printf '%s' "$dep_rows" | tr -d '[:space:]')"
    if [ "$dep_rows" != "0" ]; then
      echo "[Startup] UNSAFE: table \"$dep_tbl\" uses type \"$drop_type\" and holds $dep_rows row(s) -> will not drop."
      return 1
    fi
    echo "[Startup] Table \"$dep_tbl\" uses type \"$drop_type\" but is empty (0 rows)."
  done
  echo "[Startup] All dependents of \"$drop_type\" are empty -> safe to drop."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DROP TYPE IF EXISTS \"$drop_type\";"
  return $?
}

# recover_type_conflict <migration> -> 0 if the migration is allowlisted AND
# all of its types were safely dropped (or already absent); 1 otherwise.
recover_type_conflict() {
  rc_migration="$1"
  rc_types="$(conflict_types_for_migration "$rc_migration")"
  if [ -z "$rc_types" ]; then
    return 1
  fi
  for rc_tbl in $(conflict_tables_for_migration "$rc_migration"); do
    case "$rc_tbl" in
      ''|*[!A-Za-z0-9_]*)
        echo "[Startup] FATAL: refusing to inspect suspicious table name '$rc_tbl'."
        return 1
        ;;
    esac
    rc_present="$(psql "$DATABASE_URL" -tAc \
      "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='$rc_tbl';")"
    rc_present="$(printf '%s' "$rc_present" | tr -d '[:space:]')"
    if [ "$rc_present" != "0" ]; then
      echo "[Startup] UNSAFE: table \"$rc_tbl\" already exists for failed migration '$rc_migration' -> manual resolution required."
      return 1
    fi
  done
  for rc_type in $rc_types; do
    rc_exists="$(psql "$DATABASE_URL" -tAc \
      "SELECT count(*) FROM pg_type WHERE typname='$rc_type';")"
    rc_exists="$(printf '%s' "$rc_exists" | tr -d '[:space:]')"
    if [ "$rc_exists" = "0" ]; then
      echo "[Startup] Type \"$rc_type\" absent — nothing to drop."
      continue
    fi
    safe_drop_conflicting_type "$rc_type" || return 1
  done
  return 0
}

# --- Main resolution logic ------------------------------------------------------
resolve_failed() {
  # Step 0a: pgcrypto must exist before any migration DDL runs.
  ensure_pgcrypto

  # Step 0: Fix P2039 FK constraint (must happen before reconciliation)
  fix_p2039

  # Step 1: Reconcile HR base schema
  apply_reconcile

  # Step 2: Detect and resolve failed migrations
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
        if recover_type_conflict "$m"; then
          echo "[Startup] Type-conflict recovery done for '$m' — re-probing..."
          state="$(probe_ddl "$m")"
          if [ "$state" = "NOT_APPLIED" ]; then
            echo "[Startup] Migration '$m': DDL is absent after recovery -> marking as rolled back (re-applies on next deploy)."
            npx prisma migrate resolve --rolled-back "$m"
          else
            echo "[Startup] FATAL: migration '$m' still '$state' after type recovery."
            echo "[Startup] Resolve manually: npx prisma migrate resolve --applied|--rolled-back '$m'"
            echo "[Startup] then redeploy."
            exit 1
          fi
        else
          echo "[Startup] FATAL: cannot safely auto-resolve failed migration '$m'."
          echo "[Startup] Resolve manually: npx prisma migrate resolve --applied|--rolled-back '$m'"
          echo "[Startup] then redeploy."
          exit 1
        fi
        ;;
    esac
  done

  echo "[Startup] Failed migrations resolved."
}

# Only auto-run when executed directly (not when sourced by tests, which stub
# `psql` and call individual functions).
if [ "${0##*/}" = "resolve-failed-migrations.sh" ]; then
  resolve_failed
fi
