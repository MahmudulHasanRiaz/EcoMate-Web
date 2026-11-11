-- Manual order item (owner 2026-11-11, Workstream C): an OrderItem may now
-- be a product-less MANUAL line added by staff from Admin order
-- create/edit/detail. `isManual` flags the line; `manualName` is its name
-- snapshot (OrderItem has no other name column — names were always read
-- through the product relation, which is NULL for these lines).
--
-- DDL-only and fail-safe on every client shape (backward-compat rule
-- 2026-10-28): both columns are additive with defaults that make the
-- migration a no-op for every existing row — isManual defaults to false
-- and manualName to NULL, exactly the pre-migration meaning of a product
-- line. No rows are read or rewritten, no existing flow can break, and
-- no new demand is placed on client data. ADD COLUMN with a constant
-- default cannot fail on divergent client data, so no probe_ddl entry is
-- required for this change (the codebase has no probe_ddl convention at
-- this base — drift safety is covered by the migration-safety /
-- deploy-safety suites, which gate additive-only DDL).
ALTER TABLE "OrderItem" ADD COLUMN "isManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderItem" ADD COLUMN "manualName" TEXT;
