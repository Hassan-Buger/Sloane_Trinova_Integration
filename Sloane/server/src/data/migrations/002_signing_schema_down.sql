-- ==============================================================================
-- Migration Rollback: 002_signing_schema_down.sql
-- Description: Reverts 002_signing_schema.sql in reverse dependency order.
-- ==============================================================================

DROP TABLE IF EXISTS signing_webhook_events CASCADE;
DROP TABLE IF EXISTS signing_request_signers CASCADE;
DROP TABLE IF EXISTS signing_requests CASCADE;
