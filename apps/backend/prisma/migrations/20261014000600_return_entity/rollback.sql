-- Rollback for 20261014000600_return_entity.
--
-- The migration is ADD-ONLY (new enums + new tables), so rollback is a pure
-- drop. Order of operations matters: drop the FK-dependent table first, then
-- the counter table, then the now-unreferenced enum types.
--
-- DATA WARNING: dropping "Return" deletes every Return row + every
-- ReturnCounter sequence row. Only run on a database whose Return data is
-- disposable (dev / sandbox). On production, export Return rows first.

-- DropForeignKey
ALTER TABLE "Return" DROP CONSTRAINT IF EXISTS "Return_orderId_fkey";

-- DropTable
DROP TABLE IF EXISTS "Return";

-- DropTable
DROP TABLE IF EXISTS "ReturnCounter";

-- DropEnum (in reverse creation order; safe — no other table uses them)
DROP TYPE IF EXISTS "ReturnSource";
DROP TYPE IF EXISTS "ReturnStatus";
DROP TYPE IF EXISTS "ReturnType";
