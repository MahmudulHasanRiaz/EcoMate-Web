-- D-C actuals-only ledger: VOID-mark legacy cash/UNPAID placeholders (never
-- delete) + backfill blank order recipient snapshots from CustomerProfile.
--
-- Context: order creation used to write a `cash/UNPAID` Payment row for the
-- uncollected remainder. Those rows were never money — the courier collects
-- against the DERIVED due (total − ΣPAID). Creation sites are deleted in code;
-- this migration retires the legacy rows by marking them VOID (a new enum
-- value) with an auditable notes suffix, so sums (all ΣPAID-only) and the
-- Delivered completer (UNPAID-only, now a legal no-op) behave identically.
-- The payment list hides VOID by default; status=VOID stays auditable.
--
-- Expand-only + data backfill: safe on redeploy and re-runnable — every write
-- is guarded (enum ADD VALUE catches duplicate_object; both UPDATEs match zero
-- rows on a second run). Counts are logged via RAISE NOTICE for the PR report.

-- ── 1. VOID enum value (guarded: re-runnable after a crash) ──────────────
DO $$ BEGIN
  ALTER TYPE "PaymentStatus" ADD VALUE 'VOID';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'D-C VOID migration: PaymentStatus VOID already exists — skipping';
END $$;

-- ── 2. VOID-mark placeholders + LOG counts ───────────────────────────────
DO $$ DECLARE
  pre_unpaid integer;
  voided integer;
BEGIN
  SELECT count(*) INTO pre_unpaid FROM "Payment"
    WHERE "gatewayCode" = 'cash' AND "status" = 'UNPAID';
  RAISE NOTICE 'D-C VOID migration: cash+UNPAID placeholder rows before: %', pre_unpaid;

  UPDATE "Payment"
    SET "status" = 'VOID',
        "notes" = COALESCE("notes", '') || ' [placeholder - no money moved]'
    WHERE "gatewayCode" = 'cash' AND "status" = 'UNPAID'
      AND COALESCE("notes", '') NOT LIKE '%[placeholder - no money moved]%';
  GET DIAGNOSTICS voided = ROW_COUNT;
  RAISE NOTICE 'D-C VOID migration: rows VOID-marked: %', voided;
END $$;

-- ── 3. Snapshot backfill, blanks-only, from CustomerProfile + LOG counts ──
-- Fills ONLY blank snapshot columns (NULL or '') on orders linked to a
-- profile; staff-corrected snapshots are untouched. Name splits the way order
-- creation does (first token → firstName, remainder → lastName); email/phone
-- copy directly. Trashed orders are history too — included deliberately.
DO $$ DECLARE
  pre_blank integer;
  filled integer;
BEGIN
  SELECT count(*) INTO pre_blank FROM "Order" o
    WHERE o."customerId" IS NOT NULL
      AND (o."customerFirstName" IS NULL OR o."customerFirstName" = ''
        OR o."customerLastName" IS NULL OR o."customerLastName" = ''
        OR o."customerEmail" IS NULL OR o."customerEmail" = ''
        OR o."customerPhone" IS NULL OR o."customerPhone" = '');
  RAISE NOTICE 'D-C snapshot backfill: linked orders with a blank snapshot field before: %', pre_blank;

  UPDATE "Order" o
    SET "customerFirstName" = CASE
          WHEN (o."customerFirstName" IS NULL OR o."customerFirstName" = '')
           AND NULLIF(split_part(trim(cp."name"), ' ', 1), '') IS NOT NULL
          THEN split_part(trim(cp."name"), ' ', 1)
          ELSE o."customerFirstName" END,
        "customerLastName" = CASE
          WHEN (o."customerLastName" IS NULL OR o."customerLastName" = '')
           AND NULLIF(trim(substring(trim(cp."name")
             FROM length(split_part(trim(cp."name"), ' ', 1)) + 1)), '') IS NOT NULL
          THEN trim(substring(trim(cp."name")
            FROM length(split_part(trim(cp."name"), ' ', 1)) + 1))
          ELSE o."customerLastName" END,
        "customerEmail" = CASE
          WHEN (o."customerEmail" IS NULL OR o."customerEmail" = '')
           AND NULLIF(cp."email", '') IS NOT NULL
          THEN cp."email" ELSE o."customerEmail" END,
        "customerPhone" = CASE
          WHEN (o."customerPhone" IS NULL OR o."customerPhone" = '')
           AND NULLIF(cp."phone", '') IS NOT NULL
          THEN cp."phone" ELSE o."customerPhone" END
    FROM "CustomerProfile" cp
    WHERE o."customerId" = cp."id"
      AND (((o."customerFirstName" IS NULL OR o."customerFirstName" = '')
            AND NULLIF(split_part(trim(cp."name"), ' ', 1), '') IS NOT NULL)
        OR ((o."customerLastName" IS NULL OR o."customerLastName" = '')
            AND NULLIF(trim(substring(trim(cp."name")
              FROM length(split_part(trim(cp."name"), ' ', 1)) + 1)), '') IS NOT NULL)
        OR ((o."customerEmail" IS NULL OR o."customerEmail" = '')
            AND NULLIF(cp."email", '') IS NOT NULL)
        OR ((o."customerPhone" IS NULL OR o."customerPhone" = '')
            AND NULLIF(cp."phone", '') IS NOT NULL));
  GET DIAGNOSTICS filled = ROW_COUNT;
  RAISE NOTICE 'D-C snapshot backfill: orders filled: %', filled;
END $$;
