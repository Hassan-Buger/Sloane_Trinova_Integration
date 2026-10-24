-- Rollback for store migration 001. This DELETES everything Sloane has saved.
DROP INDEX IF EXISTS idx_sloane_records_collection;
DROP TABLE IF EXISTS sloane_records;
DROP TABLE IF EXISTS sloane_meta;
