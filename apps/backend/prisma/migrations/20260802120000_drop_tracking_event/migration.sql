-- DropTable: retire the legacy TrackingEvent table. The pipeline now records
-- every event as a TrackingSnapshot (capture) + TrackingOutbox (relay), and
-- checkout-leads lead-dedup reads TrackingSnapshot instead of TrackingEvent.
-- The table is an append-only log with no foreign keys and no remaining readers.
-- IF EXISTS tolerates local-db drift (an orphan table not in migration history).
DROP TABLE IF EXISTS "TrackingEvent";
