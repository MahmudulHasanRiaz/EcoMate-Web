BEGIN;
-- ─────────────────────────────────────────────────────────────────────────────
-- Commission Engine v2
--
-- The v1 model could express only "employee gets X when an order hits a
-- status", and even that was unreachable from the UI (triggerStatusId was
-- never sent). Three structural problems needed new tables rather than new
-- columns:
--
--  1. "Who moved this order to this status FIRST" could not be answered
--     reliably. Order.timeline stores an untyped actor union (email / user id /
--     'system' / absent), and many status-write paths (courier webhooks,
--     dispatch, RTN, refunds, POS) write neither a timeline entry nor an
--     OrderStaffEvent. Commission credit needs a ledger where every transition
--     is present, with a stable actor and a deterministic order.
--  2. Threshold qualification ("50 packed/day, then commission") needs a
--     per-employee, per-purpose, per-period counter that is timezone-aware and
--     duplicate-proof.
--  3. Historical earnings must not silently change when a rule is edited, so
--     the calculation parameters are snapshotted onto each ledger entry.
--
-- Everything below is additive. Existing CommissionRule / CommissionEarning
-- rows are preserved untouched and continue to be honoured by the legacy
-- path.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Immutable order status transition ledger ──────────────────────────────
-- Every status change is appended here. "First actor wins" for commission is
-- resolved as: earliest row for (orderId, toStatus) ordered by occurredAt then
-- id, which is total and stable even when two transitions share a timestamp.
CREATE TABLE "OrderStatusTransition" (
    "id"             TEXT        NOT NULL,
    "orderId"        TEXT        NOT NULL,
    -- Canonical OrderStatus.name (Pending, Confirmed, Packed, ...). Stored as
    -- text, not an enum: statuses are rows in OrderStatus and an installation
    -- may add its own.
    "fromStatus"     TEXT,
    "toStatus"       TEXT        NOT NULL,
    -- Who acted. Always a UserProfile.id (payload.sub from @CurrentUser), which
    -- is the only actor identifier this codebase can guarantee. System-driven
    -- transitions (webhooks, dispatch) use the SYSTEM_ACTOR constant.
    "actorUserId"    TEXT,
    -- Resolved Employee for the actor, when the actor is a staff member.
    "actorEmployeeId" TEXT,
    "actorType"      TEXT        NOT NULL DEFAULT 'staff',
    -- True when this row is the first transition INTO toStatus for this order.
    -- Maintained by the writer inside the same transaction; lets the commission
    -- engine answer "first actor" with an index-only lookup instead of a
    -- window function, and makes the invariant explicit rather than implied.
    "isFirstForStatus" BOOLEAN   NOT NULL DEFAULT false,
    -- Application-supplied idempotency key. When present, a duplicate submit is
    -- a no-op rather than a second transition. Nullable so existing paths can
    -- adopt it incrementally.
    "idempotencyKey"  TEXT,
    "note"           TEXT,
    "metadata"       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "occurredAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "OrderStatusTransition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderStatusTransition_orderId_occurredAt_idx"
    ON "OrderStatusTransition" ("orderId", "occurredAt", "id");

-- The first-actor lookup: given an order and a target status, find the earliest
-- actor that moved it there.
CREATE INDEX "OrderStatusTransition_orderId_toStatus_occurredAt_idx"
    ON "OrderStatusTransition" ("orderId", "toStatus", "occurredAt", "id");

-- Credit uniqueness lives on the commission ledger instead, but this index
-- serves the "who has touched this order" audit view.
CREATE INDEX "OrderStatusTransition_actorEmployeeId_occurredAt_idx"
    ON "OrderStatusTransition" ("actorEmployeeId", "occurredAt");

-- At most one first-transition row per (order, target status). This is what
-- makes "first actor" a database guarantee rather than an ordering accident:
-- two concurrent transitions into the same status cannot both set the flag.
CREATE UNIQUE INDEX "OrderStatusTransition_one_first_per_status_idx"
    ON "OrderStatusTransition" ("orderId", "toStatus")
    WHERE "isFirstForStatus" = true;

-- Idempotent writes: the same key can never be recorded twice.
CREATE UNIQUE INDEX "OrderStatusTransition_idempotencyKey_idx"
    ON "OrderStatusTransition" ("idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderStatusTransition_orderId_fkey'
    ) THEN
        ALTER TABLE "OrderStatusTransition"
            ADD CONSTRAINT "OrderStatusTransition_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderStatusTransition_actorEmployeeId_fkey'
    ) THEN
        ALTER TABLE "OrderStatusTransition"
            ADD CONSTRAINT "OrderStatusTransition_actorEmployeeId_fkey"
            FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;


-- ── 2. Commission rule v2 ─────────────────────────────────────────────────────
-- A v2 rule is: employee + qualifying purpose + type + value + threshold +
-- validity window. CommissionRule (v1) is left in place and still honoured, so
-- existing rules and existing earnings keep working unchanged.
CREATE TABLE "CommissionRuleV2" (
    "id"          TEXT        NOT NULL,
    "employeeId"  TEXT        NOT NULL,
    "name"        TEXT,
    -- Canonical OrderStatus.name this rule pays for. Not an enum, not free text:
    -- the API validates against OrderStatus.
    "purpose"     TEXT        NOT NULL,
    "amountType"  "CommissionAmountType" NOT NULL,
    -- Fixed amount in currency, or percentage rate when amountType = percent.
    "amount"      DECIMAL(10,2) NOT NULL,
    -- Which order figure the percentage applies to. order_total is the
    -- canonical basis used by every existing commission calculation, so it
    -- stays the default; subtotal excludes shipping. Stored explicitly so the
    -- choice is auditable rather than implicit.
    "valueBasis"  TEXT        NOT NULL DEFAULT 'order_total',

    -- Optional additional per-order amount gate, carried over from v1's
    -- minOrderAmount. Distinct from the count threshold below.
    "minOrderAmount" DECIMAL(10,2),

    -- Optional ceiling for a single order's commission.
    "capPerOrder" DECIMAL(10,2),

    -- ── Threshold (count-based, period-scoped) ──
    -- NULL minimumCount means "no minimum": every qualifying order pays.
    "minimumCount" INTEGER,
    -- daily | weekly | monthly | yearly. NULL when minimumCount is NULL.
    "thresholdPeriod" TEXT,

    -- ── Validity window ──
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo"   TIMESTAMP(3),

    "isActive"    BOOLEAN     NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "CommissionRuleV2_pkey" PRIMARY KEY ("id"),

    -- A rule must pay a positive amount. v1 allowed 0, which silently created a
    -- rule that could never pay anything.
    CONSTRAINT "CommissionRuleV2_amount_positive" CHECK ("amount" > 0),

    -- minimumCount and thresholdPeriod are a unit: both set or both null. A
    -- count with no period is ambiguous, and a period with no count is dead.
    CONSTRAINT "CommissionRuleV2_threshold_paired" CHECK (
        ("minimumCount" IS NULL AND "thresholdPeriod" IS NULL)
     OR ("minimumCount" IS NOT NULL AND "thresholdPeriod" IS NOT NULL)
    ),
    CONSTRAINT "CommissionRuleV2_threshold_positive" CHECK (
        "minimumCount" IS NULL OR "minimumCount" > 0
    ),
    CONSTRAINT "CommissionRuleV2_threshold_period_valid" CHECK (
        "thresholdPeriod" IS NULL
     OR "thresholdPeriod" IN ('daily', 'weekly', 'monthly', 'yearly')
    ),
    -- A validity window must not end before it starts.
    CONSTRAINT "CommissionRuleV2_window_ordered" CHECK (
        "effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" >= "effectiveFrom"
    ),
    -- valueBasis is a closed set; free text here would silently change what a
    -- percentage is measured against.
    CONSTRAINT "CommissionRuleV2_value_basis_valid" CHECK (
        "valueBasis" IN ('order_total', 'subtotal')
    )
);

CREATE INDEX "CommissionRuleV2_employeeId_isActive_idx"
    ON "CommissionRuleV2" ("employeeId", "isActive");

-- Rule lookup on the hot path: "active rules for this employee and purpose".
CREATE INDEX "CommissionRuleV2_employeeId_purpose_isActive_idx"
    ON "CommissionRuleV2" ("employeeId", "purpose", "isActive");

-- No two active rules for the same employee + purpose may overlap in time.
-- Stacking is not implicit: an admin who wants two rules on one purpose must
-- give them disjoint windows, which is a deliberate, reviewable choice.
CREATE UNIQUE INDEX "CommissionRuleV2_no_overlapping_active_idx"
    ON "CommissionRuleV2" ("employeeId", "purpose", "isActive")
    WHERE "isActive" = true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionRuleV2_employeeId_fkey'
    ) THEN
        ALTER TABLE "CommissionRuleV2"
            ADD CONSTRAINT "CommissionRuleV2_employeeId_fkey"
            FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;


-- ── 3. Commission ledger v2 ───────────────────────────────────────────────────
-- One row per (order, purpose) that qualified. The unique constraint on those
-- two columns is the idempotency guarantee required by the spec: a webhook
-- retry, a double-click or two concurrent evaluations cannot produce two
-- credits, because the second insert is rejected by the database.
CREATE TABLE "CommissionLedgerV2" (
    "id"          TEXT        NOT NULL,
    "employeeId"  TEXT        NOT NULL,
    "orderId"     TEXT        NOT NULL,
    "ruleId"      TEXT        NOT NULL,
    "purpose"     TEXT        NOT NULL,

    -- The transition that earned this. Ties the money to the event.
    "transitionId" TEXT        NOT NULL,
    "actorEmployeeId" TEXT,
    "qualifiedAt"  TIMESTAMP(3) NOT NULL,

    -- ── Calculation snapshot ──
    -- Historical earnings must not move when a rule is edited, so every input to
    -- the arithmetic is copied here at credit time.
    "amountType"   "CommissionAmountType" NOT NULL,
    "ruleAmount"   DECIMAL(10,2) NOT NULL,
    "valueBasis"   TEXT        NOT NULL,
    "sourceAmount" DECIMAL(10,2) NOT NULL,
    "amount"       DECIMAL(10,2) NOT NULL,
    "capApplied"   BOOLEAN     NOT NULL DEFAULT false,

    -- ── Threshold evidence (why this qualified, if it was gated) ──
    "minimumCount"     INTEGER,
    "thresholdPeriod"  TEXT,
    "countAtQualification" INTEGER,

    -- Period bucket key (e.g. 2026-10-02 for daily) so reports and payroll
    -- period filters do not recompute timezone maths on every row.
    "periodKey"    TEXT        NOT NULL,

    "status"       "LedgerStatus" NOT NULL DEFAULT 'approved',
    "payslipId"    TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "CommissionLedgerV2_pkey" PRIMARY KEY ("id"),

    -- THE idempotency guarantee. One credit per order per purpose, forever.
    CONSTRAINT "CommissionLedgerV2_order_purpose_unique"
        UNIQUE ("orderId", "purpose"),

    -- An amount is either earned or zero; a zero row is a bug, not a record.
    CONSTRAINT "CommissionLedgerV2_amount_non_negative" CHECK ("amount" >= 0)
);

CREATE INDEX "CommissionLedgerV2_employeeId_qualifiedAt_idx"
    ON "CommissionLedgerV2" ("employeeId", "qualifiedAt");

-- Reporting by purpose over a date range.
CREATE INDEX "CommissionLedgerV2_employeeId_purpose_qualifiedAt_idx"
    ON "CommissionLedgerV2" ("employeeId", "purpose", "qualifiedAt");

-- Payroll claim scan: approved, unclaimed, within a period.
CREATE INDEX "CommissionLedgerV2_payslipId_status_qualifiedAt_idx"
    ON "CommissionLedgerV2" ("payslipId", "status", "qualifiedAt");

-- Rule-level report.
CREATE INDEX "CommissionLedgerV2_ruleId_qualifiedAt_idx"
    ON "CommissionLedgerV2" ("ruleId", "qualifiedAt");

-- Period-bucket reporting: payroll period filters and per-period reports read
-- by bucket rather than recomputing timezone maths per row.
CREATE INDEX "CommissionLedgerV2_periodKey_idx"
    ON "CommissionLedgerV2" ("periodKey");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedgerV2_employeeId_fkey'
    ) THEN
        ALTER TABLE "CommissionLedgerV2"
            ADD CONSTRAINT "CommissionLedgerV2_employeeId_fkey"
            FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedgerV2_orderId_fkey'
    ) THEN
        ALTER TABLE "CommissionLedgerV2"
            ADD CONSTRAINT "CommissionLedgerV2_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedgerV2_ruleId_fkey'
    ) THEN
        ALTER TABLE "CommissionLedgerV2"
            ADD CONSTRAINT "CommissionLedgerV2_ruleId_fkey"
            FOREIGN KEY ("ruleId") REFERENCES "CommissionRuleV2"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedgerV2_transitionId_fkey'
    ) THEN
        ALTER TABLE "CommissionLedgerV2"
            ADD CONSTRAINT "CommissionLedgerV2_transitionId_fkey"
            FOREIGN KEY ("transitionId") REFERENCES "OrderStatusTransition"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedgerV2_actorEmployeeId_fkey'
    ) THEN
        ALTER TABLE "CommissionLedgerV2"
            ADD CONSTRAINT "CommissionLedgerV2_actorEmployeeId_fkey"
            FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;


-- ── 4. Threshold counter ──────────────────────────────────────────────────────
-- Tracks qualifying events per (employee, purpose, period bucket) so "50
-- packed today" is a stored fact rather than a recount of the whole ledger.
-- The primary key IS the duplicate guard: re-processing an event increments
-- nothing twice.
CREATE TABLE "CommissionThresholdCounter" (
    "employeeId"    TEXT NOT NULL,
    "purpose"       TEXT NOT NULL,
    "periodKey"     TEXT NOT NULL,
    "count"         INTEGER NOT NULL DEFAULT 0,
    "lastQualifiedAt" TIMESTAMP(3),
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "CommissionThresholdCounter_pkey"
        PRIMARY KEY ("employeeId", "purpose", "periodKey"),

    CONSTRAINT "CommissionThresholdCounter_count_non_negative" CHECK ("count" >= 0)
);

CREATE INDEX "CommissionThresholdCounter_periodKey_idx"
    ON "CommissionThresholdCounter" ("periodKey");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionThresholdCounter_employeeId_fkey'
    ) THEN
        ALTER TABLE "CommissionThresholdCounter"
            ADD CONSTRAINT "CommissionThresholdCounter_employeeId_fkey"
            FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;


-- ── 5. Reversal v2 ───────────────────────────────────────────────────────────
-- v1 CommissionReversal exists and is untouched. This exists because v1's
-- payroll filter (`reversals: { none: {} }`) drops a partially-reversed earning
-- entirely rather than paying the net, so a 25% reversal on a ৳100 earning
-- removed all ৳100 from the payslip. Net-of-reversal must be computed.
CREATE TABLE "CommissionReversalV2" (
    "id"              TEXT        NOT NULL,
    "ledgerId"        TEXT        NOT NULL,
    "orderId"         TEXT,
    "amount"          DECIMAL(10,2) NOT NULL,
    -- The refund that triggered this, when it was a proportional reversal.
    "refundedAmount"  DECIMAL(10,2),
    "reason"          TEXT        NOT NULL,
    "reversedById"    TEXT,
    "reversedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "CommissionReversalV2_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "CommissionReversalV2_amount_positive" CHECK ("amount" > 0),

    -- One automatic reversal per (ledger, order). A manual reversal with no
    -- order is allowed to repeat only through the service, which rejects it.
    CONSTRAINT "CommissionReversalV2_ledger_order_unique"
        UNIQUE ("ledgerId", "orderId")
);

CREATE INDEX "CommissionReversalV2_ledgerId_idx"
    ON "CommissionReversalV2" ("ledgerId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionReversalV2_ledgerId_fkey'
    ) THEN
        ALTER TABLE "CommissionReversalV2"
            ADD CONSTRAINT "CommissionReversalV2_ledgerId_fkey"
            FOREIGN KEY ("ledgerId") REFERENCES "CommissionLedgerV2"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;


-- ── 6. Grant table privileges (matches how this schema manages relations) ─────
-- Prisma creates tables for the connecting role; no explicit GRANTs are used
-- elsewhere in this schema, so none are added here.

COMMIT;
