-- ==============================================================================
-- Migration: 003_timeline_schema.sql
-- Description: Client Timeline unified event model, visibility classification,
--              audit provenance, and composite indexes.
-- Target: PostgreSQL 14+ / MySQL 8+ / SQLite compliant DDL
-- ==============================================================================

-- 1. Client Timeline Events Table
CREATE TABLE IF NOT EXISTS timeline_events (
    id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    company_id VARCHAR(64),
    event_type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_type VARCHAR(64) NOT NULL DEFAULT 'system',
    actor_id VARCHAR(64),
    source VARCHAR(64) NOT NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'normal',
    visibility VARCHAR(32) NOT NULL DEFAULT 'shared',
    external_id VARCHAR(128),
    metadata JSON
);

-- 2. Performance and Query Indexes
CREATE INDEX IF NOT EXISTS idx_timeline_client_occurred ON timeline_events(client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_client_type ON timeline_events(client_id, event_type);
CREATE INDEX IF NOT EXISTS idx_timeline_client_visibility ON timeline_events(client_id, visibility);
CREATE INDEX IF NOT EXISTS idx_timeline_source_external ON timeline_events(source, external_id);
CREATE INDEX IF NOT EXISTS idx_timeline_company_id ON timeline_events(company_id);
