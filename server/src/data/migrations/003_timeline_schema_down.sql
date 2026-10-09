-- ==============================================================================
-- Rollback Migration: 003_timeline_schema_down.sql
-- Description: Drops timeline_events table and associated indexes.
-- ==============================================================================

DROP INDEX IF EXISTS idx_timeline_company_id;
DROP INDEX IF EXISTS idx_timeline_source_external;
DROP INDEX IF EXISTS idx_timeline_client_visibility;
DROP INDEX IF EXISTS idx_timeline_client_type;
DROP INDEX IF EXISTS idx_timeline_client_occurred;

DROP TABLE IF EXISTS timeline_events;
