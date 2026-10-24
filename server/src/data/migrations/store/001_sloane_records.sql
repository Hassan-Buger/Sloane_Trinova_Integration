-- ==============================================================================
-- Store migration 001: Sloane's saved data
-- Works on both SQLite and PostgreSQL (plain SQL only).
--
-- Every list Sloane keeps (businesses, clients added in Sloane, tasks, notes, documents,
-- history, team, deadlines, private notes, audit log) is stored as one row per record.
-- `data` holds the record as JSON; `position` keeps the order the list was in.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS sloane_records (
    collection VARCHAR(64) NOT NULL,
    record_id VARCHAR(160) NOT NULL,
    position BIGINT NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (collection, record_id)
);

CREATE INDEX IF NOT EXISTS idx_sloane_records_collection ON sloane_records(collection, position);

CREATE TABLE IF NOT EXISTS sloane_meta (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL
);
