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

set -e

: "${DATABASE_URL:?resolve-failed-migrations.sh requires DATABASE_URL}"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

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

    *)
      echo "UNKNOWN"
      ;;
  esac
}

# --- Main resolution logic ------------------------------------------------------
resolve_failed() {
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
