-- =============================================================================
-- Recovery migration: idempotently ensure all schema objects introduced by
-- migrations AFTER 20260715132458 exist in the live database.
--
-- WHY THIS EXISTS
--   Some production servers are running the current backend image against a
--   database where the migration chain fell out of sync: `_prisma_migrations`
--   records `20260715132458_cycle_safe_reservation_and_combo_snapshot` as
--   applied, but the `OrderStockCycle` (and related) tables are absent. The
--   running code queries those tables and every Order confirm/cancel/return
--   fails with Prisma error P2021 -> 503 "Database setup in progress."
--
--   Because the migration is already recorded as applied, `prisma migrate
--   deploy` would otherwise skip it and never repair the database. This
--   migration is NEWLY pending everywhere, so `prisma migrate deploy` applies
--   it on next container start: broken servers get the missing objects
--   recreated; healthy servers no-op (every statement is guarded).
--
-- SAFETY
--   Pure additive + idempotent. No DROP, no data loss. All CREATE/ADD/INDEX
--   use IF NOT EXISTS; FK constraints are guarded by existence checks; SET
--   NOT NULL only runs when no NULLs exist. Safe to re-run any number of
--   times, on healthy and broken databases alike.
-- =============================================================================

-- =============================================================================
-- 1. Enum types (SecurityEvent uses these; create once, never fail on dup)
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE "SecurityEventSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SecurityEventCategory" AS ENUM ('RATE_LIMIT', 'AUTH', 'FRAUD', 'BLOCK', 'SYSTEM', 'WAF', 'BOT', 'THREAT_INTEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SecurityActorType" AS ENUM ('IP', 'USER', 'SESSION', 'BROWSER_TRUST', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enum values added by later migrations (idempotent; type must already exist)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ManagedStockMovementType') THEN
    ALTER TYPE "ManagedStockMovementType" ADD VALUE IF NOT EXISTS 'RESERVE';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ManagedStockMovementType') THEN
    ALTER TYPE "ManagedStockMovementType" ADD VALUE IF NOT EXISTS 'RELEASE';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchStatus') THEN
    ALTER TYPE "DispatchStatus" ADD VALUE IF NOT EXISTS 'HOLD';
  END IF;
END $$;

-- =============================================================================
-- 2. Tables (stock-cycle family, from 20260715132458)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "OrderStockCycle" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderStockCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderItemComboComponent" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "comboItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "unitQuantity" INTEGER NOT NULL,
    "totalQuantity" INTEGER NOT NULL,
    "managedStockReserved" BOOLEAN NOT NULL DEFAULT false,
    "managedStockDeducted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderItemComboComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComboComponentPhysicalReservation" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComboComponentPhysicalReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComboComponentPhysicalReservationAllocation" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "physicalInventoryId" TEXT NOT NULL,
    "binLocationId" TEXT,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "ComboComponentPhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- 3. Tables (other features added after the stock-cycle migration)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "CourierReportCache" (
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "courierStatus" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourierReportCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityEvent" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "source" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "SecurityActorType" NOT NULL,
    "ipAddress" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "browserTrustId" TEXT,
    "phone" TEXT,
    "trustTier" TEXT,
    "riskScore" INTEGER,
    "metadataVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlationId" TEXT,
    "parentCorrelationId" TEXT,
    "description" TEXT,
    "retentionOverride" BOOLEAN NOT NULL DEFAULT false,
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityEventHourly" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "bucket" TIMESTAMPTZ NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "SecurityEventHourly_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityEventDaily" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "date" DATE NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "SecurityEventDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityBlockDaily" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "date" DATE NOT NULL,
    "blockSource" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "SecurityBlockDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityRetentionPolicy" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "category" "SecurityEventCategory" NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "criticalRetentionDays" INTEGER,
    CONSTRAINT "SecurityRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MobileBuild" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "versionName" TEXT NOT NULL DEFAULT '1.0.0',
    "versionCode" INTEGER NOT NULL DEFAULT 1,
    "artifactPath" TEXT,
    "buildLogUrl" TEXT,
    "triggeredBy" TEXT,
    "triggeredById" TEXT,
    "clientDomain" TEXT,
    "packageId" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileBuild_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BackupJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileKey" TEXT,
    "fileSize" BIGINT,
    "checksum" TEXT,
    "dbDumpSize" BIGINT,
    "filesSize" BIGINT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
);

-- Control plane lives outside public (see its original migration for rationale)
CREATE SCHEMA IF NOT EXISTS "ecomate_control";
REVOKE ALL ON SCHEMA "ecomate_control" FROM PUBLIC;
CREATE TABLE IF NOT EXISTS "ecomate_control"."backup_restore_operation" (
    "operation_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "execution_role" TEXT,
    "source_snapshot" JSONB,
    "catalog_snapshots" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "backup_restore_operation_pkey" PRIMARY KEY ("operation_id"),
    CONSTRAINT "backup_restore_operation_phase_check"
        CHECK ("phase" IN ('preparing', 'database_committed', 'failed_after_commit'))
);
REVOKE ALL ON TABLE "ecomate_control"."backup_restore_operation" FROM PUBLIC;

-- =============================================================================
-- 4. Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS "OrderStockCycle_orderId_idx" ON "OrderStockCycle"("orderId");
CREATE INDEX IF NOT EXISTS "OrderStockCycle_status_idx" ON "OrderStockCycle"("status");
CREATE INDEX IF NOT EXISTS "OrderItemComboComponent_orderItemId_idx" ON "OrderItemComboComponent"("orderItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderItemComboComponent_orderItemId_comboItemId_key" ON "OrderItemComboComponent"("orderItemId", "comboItemId");
CREATE INDEX IF NOT EXISTS "ComboComponentPhysicalReservation_orderId_idx" ON "ComboComponentPhysicalReservation"("orderId");
CREATE INDEX IF NOT EXISTS "ComboComponentPhysicalReservation_status_idx" ON "ComboComponentPhysicalReservation"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "ComboComponentPhysicalReservation_componentId_cycleId_key" ON "ComboComponentPhysicalReservation"("componentId", "cycleId");
CREATE INDEX IF NOT EXISTS "ComboComponentPhysicalReservationAllocation_reservationId_idx" ON "ComboComponentPhysicalReservationAllocation"("reservationId");
CREATE UNIQUE INDEX IF NOT EXISTS "ComboComponentPhysicalReservationAllocation_reservationId_p_key" ON "ComboComponentPhysicalReservationAllocation"("reservationId", "physicalInventoryId");

CREATE UNIQUE INDEX IF NOT EXISTS "CourierReportCache_courier_phone_key" ON "CourierReportCache"("courier", "phone");
CREATE INDEX IF NOT EXISTS "CourierReportCache_phone_idx" ON "CourierReportCache"("phone");
CREATE INDEX IF NOT EXISTS "CourierReportCache_courier_idx" ON "CourierReportCache"("courier");
CREATE INDEX IF NOT EXISTS "CourierReportCache_expiresAt_idx" ON "CourierReportCache"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "SecurityEvent_dedupKey_key" ON "SecurityEvent"("dedupKey");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_timestamp_idx" ON "SecurityEvent"("tenant", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_eventType_timestamp_idx" ON "SecurityEvent"("tenant", "eventType", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_severity_timestamp_idx" ON "SecurityEvent"("tenant", "severity", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_category_severity_timestamp_idx" ON "SecurityEvent"("tenant", "category", "severity", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_ipAddress_timestamp_idx" ON "SecurityEvent"("tenant", "ipAddress", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_userId_timestamp_idx" ON "SecurityEvent"("tenant", "userId", "timestamp");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_correlationId_idx" ON "SecurityEvent"("tenant", "correlationId");
CREATE INDEX IF NOT EXISTS "SecurityEvent_tenant_parentCorrelationId_idx" ON "SecurityEvent"("tenant", "parentCorrelationId");
CREATE INDEX IF NOT EXISTS "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "SecurityEvent_retentionOverride_createdAt_idx" ON "SecurityEvent"("retentionOverride", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SecurityEventHourly_tenant_bucket_eventType_severity_cate_key" ON "SecurityEventHourly"("tenant", "bucket", "eventType", "severity", "category");
CREATE INDEX IF NOT EXISTS "SecurityEventHourly_tenant_bucket_idx" ON "SecurityEventHourly"("tenant", "bucket");
CREATE INDEX IF NOT EXISTS "SecurityEventHourly_tenant_bucket_severity_idx" ON "SecurityEventHourly"("tenant", "bucket", "severity");
CREATE UNIQUE INDEX IF NOT EXISTS "SecurityEventDaily_tenant_date_eventType_severity_categor_key" ON "SecurityEventDaily"("tenant", "date", "eventType", "severity", "category");
CREATE INDEX IF NOT EXISTS "SecurityEventDaily_tenant_date_idx" ON "SecurityEventDaily"("tenant", "date");
CREATE INDEX IF NOT EXISTS "SecurityEventDaily_tenant_date_severity_idx" ON "SecurityEventDaily"("tenant", "date", "severity");
CREATE UNIQUE INDEX IF NOT EXISTS "SecurityBlockDaily_tenant_date_blockSource_targetType_key" ON "SecurityBlockDaily"("tenant", "date", "blockSource", "targetType");
CREATE INDEX IF NOT EXISTS "SecurityBlockDaily_tenant_date_idx" ON "SecurityBlockDaily"("tenant", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "SecurityRetentionPolicy_tenant_category_severity_key" ON "SecurityRetentionPolicy"("tenant", "category", "severity");

CREATE INDEX IF NOT EXISTS "MobileBuild_app_idx" ON "MobileBuild"("app");
CREATE INDEX IF NOT EXISTS "MobileBuild_status_idx" ON "MobileBuild"("status");
CREATE INDEX IF NOT EXISTS "MobileBuild_createdAt_idx" ON "MobileBuild"("createdAt");

CREATE INDEX IF NOT EXISTS "BackupJob_status_idx" ON "BackupJob"("status");
CREATE INDEX IF NOT EXISTS "BackupJob_createdAt_idx" ON "BackupJob"("createdAt");
CREATE INDEX IF NOT EXISTS "BackupJob_type_idx" ON "BackupJob"("type");
-- (Payment / OrderItem.sourceWarehouseId / StockTransfer.indexes are created in
--  section 5 below, after their columns are added.)

-- =============================================================================
-- 5. Columns added by migrations after the stock-cycle migration
-- =============================================================================
ALTER TABLE "CourierCredentials" ADD COLUMN IF NOT EXISTS "pathaoIntegrationSecret" TEXT;
ALTER TABLE "CourierCredentials" ADD COLUMN IF NOT EXISTS "clientContext" TEXT;
ALTER TABLE "CourierCredentials" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "trackingUrl" TEXT;
ALTER TABLE "ProductFeedConfig" ADD COLUMN IF NOT EXISTS "googleProductCategory" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerPaymentId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "sourceWarehouseId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "managedStockReserved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "managedStockDeducted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "requestedBy" TEXT;
ALTER TABLE "ManagedStockLedger" ADD COLUMN IF NOT EXISTS "reservedBefore" INTEGER;
ALTER TABLE "ManagedStockLedger" ADD COLUMN IF NOT EXISTS "reservedAfter" INTEGER;
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "reservedBefore" INTEGER;
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "reservedAfter" INTEGER;
ALTER TABLE "CostingLotConsumption" ADD COLUMN IF NOT EXISTS "cycleId" TEXT;
ALTER TABLE "CostingLotRestoration" ADD COLUMN IF NOT EXISTS "cycleId" TEXT;
CREATE INDEX IF NOT EXISTS "CostingLotConsumption_cycleId_idx" ON "CostingLotConsumption"("cycleId");
CREATE INDEX IF NOT EXISTS "CostingLotRestoration_cycleId_idx" ON "CostingLotRestoration"("cycleId");

-- StockTransfer status default (idempotent; only when the column exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'StockTransfer' AND column_name = 'status') THEN
    ALTER TABLE "StockTransfer" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';
  END IF;
END $$;

-- Indexes for columns added above. Unique ones run inside DO blocks so a
-- data conflict on an existing populated table can never fail the migration.
CREATE INDEX IF NOT EXISTS "OrderItem_sourceWarehouseId_idx" ON "OrderItem"("sourceWarehouseId");
CREATE INDEX IF NOT EXISTS "StockTransfer_orderId_idx" ON "StockTransfer"("orderId");
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Payment_providerPaymentId_key skipped: duplicate values exist';
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "Payment_transactionId_gatewayCode_key" ON "Payment"("transactionId", "gatewayCode");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Payment_transactionId_gatewayCode_key skipped: duplicate values exist';
END $$;

-- =============================================================================
-- 6. PhysicalReservation.cycleId (from 20260715132458) — add, backfill, index
--    Only touches the table when it exists; legacy rows backfilled from a
--    seeded cycle so the NOT NULL/FK constraints can be applied.
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PhysicalReservation') THEN
    ALTER TABLE "PhysicalReservation" ADD COLUMN IF NOT EXISTS "cycleId" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PhysicalReservation') THEN
    INSERT INTO "OrderStockCycle" ("id", "orderId", "status", "createdAt", "updatedAt")
    SELECT DISTINCT
      md5("orderId")::uuid::text,
      "orderId",
      'TERMINATED',
      NOW(),
      NOW()
    FROM "PhysicalReservation" pr
    WHERE EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = pr."orderId")
      AND NOT EXISTS (
        SELECT 1 FROM "OrderStockCycle" osc WHERE osc."orderId" = pr."orderId"
      )
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Legacy cycle seed skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PhysicalReservation') THEN
    UPDATE "PhysicalReservation" pr
    SET "cycleId" = (
      SELECT id FROM "OrderStockCycle" osc
      WHERE osc."orderId" = pr."orderId"
      ORDER BY osc.status ASC, osc."createdAt" DESC
      LIMIT 1
    )
    WHERE pr."cycleId" IS NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Legacy cycle backfill skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PhysicalReservation') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalReservation_orderItemId_cycleId_key" ON "PhysicalReservation"("orderItemId", "cycleId");
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'PhysicalReservation_orderItemId_cycleId_key skipped: duplicate values exist';
END $$;

-- =============================================================================
-- 7. Foreign keys (guarded — only added when missing and both sides exist)
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderStockCycle_orderId_fkey') THEN
    ALTER TABLE "OrderStockCycle" ADD CONSTRAINT "OrderStockCycle_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItemComboComponent_orderItemId_fkey') THEN
    ALTER TABLE "OrderItemComboComponent" ADD CONSTRAINT "OrderItemComboComponent_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItemComboComponent_productId_fkey') THEN
    ALTER TABLE "OrderItemComboComponent" ADD CONSTRAINT "OrderItemComboComponent_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboComponentPhysicalReservation_componentId_fkey') THEN
    ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_componentId_fkey"
      FOREIGN KEY ("componentId") REFERENCES "OrderItemComboComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboComponentPhysicalReservation_warehouseId_fkey') THEN
    ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboComponentPhysicalReservation_cycleId_fkey') THEN
    ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_cycleId_fkey"
      FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboComponentPhysicalReservationAllocation_reservationId_fkey') THEN
    ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_reservationId_fkey"
      FOREIGN KEY ("reservationId") REFERENCES "ComboComponentPhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboComponentPhysicalReservationAllocation_physicalInvent_fkey') THEN
    ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_physicalInvent_fkey"
      FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ComboComponentPhysicalReservationAllocation_binLocationId_fkey') THEN
    ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_binLocationId_fkey"
      FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PhysicalReservation')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhysicalReservation_cycleId_fkey') THEN
    ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_cycleId_fkey"
      FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_sourceWarehouseId_fkey') THEN
    ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sourceWarehouseId_fkey"
      FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockTransfer_orderId_fkey') THEN
    ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- =============================================================================
-- 8. NOT NULL constraints — only applied when the column exists AND no NULLs
--    (mirrors the original guarded patterns; never fails on populated tables)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PhysicalReservation' AND column_name = 'cycleId' AND is_nullable = 'YES')
     AND NOT EXISTS (SELECT 1 FROM "PhysicalReservation" WHERE "cycleId" IS NULL) THEN
    ALTER TABLE "PhysicalReservation" ALTER COLUMN "cycleId" SET NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'CostingLot' AND column_name = 'warehouseId' AND is_nullable = 'YES')
     AND NOT EXISTS (SELECT 1 FROM "CostingLot" WHERE "warehouseId" IS NULL) THEN
    ALTER TABLE "CostingLot" ALTER COLUMN "warehouseId" SET NOT NULL;
  END IF;
END $$;
