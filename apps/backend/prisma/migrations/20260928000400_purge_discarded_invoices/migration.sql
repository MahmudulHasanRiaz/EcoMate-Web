-- Permanently remove invoices soft-deleted (state = 'DISCARDED') during the
-- pre-hard-delete discard era. Discard is now a hard delete, so these rows
-- are pure noise: they must vanish from every list, filter, and count.
-- All invoice-scoped children (rows, exceptions, adjustments, activities,
-- snapshots) are removed via onDelete: Cascade.
DELETE FROM "CourierSettlementInvoice" WHERE "state" = 'DISCARDED';
