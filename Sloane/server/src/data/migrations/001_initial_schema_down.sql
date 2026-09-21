-- ==============================================================================
-- Migration Rollback: 001_initial_schema_down.sql
-- Description: Reverts 001_initial_schema.sql in reverse dependency order.
-- ==============================================================================

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS internal_notes CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS company_services CASCADE;
DROP TABLE IF EXISTS company_contacts CASCADE;
DROP TABLE IF EXISTS company_officers CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
