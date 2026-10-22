/*
  Warnings:

  - A unique constraint covering the columns `[journalEntryId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reversalJournalEntryId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[journalEntryId]` on the table `PayrollPayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reversalJournalEntryId]` on the table `PayrollPayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[journalEntryId]` on the table `SupplierPayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reversalJournalEntryId]` on the table `SupplierPayment` will be added. If there are existing duplicate values, this will fail.

*/
-- NOTE: `prisma migrate dev` also emitted a `DROP INDEX
-- "PhysicalInventoryLedger_reason_trgm_idx"` line. That index is created by
-- migration 20261006090000_ledger_reason_trgm_index and is not (yet) declared
-- in schema.prisma, so it is PRE-EXISTING drift on main — unrelated to Phase 2.
-- Dropping a search index is destructive and out of scope here, so the line was
-- removed: this migration contains ONLY the Phase 2 additive changes.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "reversalJournalEntryId" TEXT;

-- AlterTable
ALTER TABLE "PayrollPayment" ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "reversalJournalEntryId" TEXT;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "reversalJournalEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_journalEntryId_key" ON "Payment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalJournalEntryId_key" ON "Payment"("reversalJournalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_journalEntryId_key" ON "PayrollPayment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_reversalJournalEntryId_key" ON "PayrollPayment"("reversalJournalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_journalEntryId_key" ON "SupplierPayment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_reversalJournalEntryId_key" ON "SupplierPayment"("reversalJournalEntryId");
