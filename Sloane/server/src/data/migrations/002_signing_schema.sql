-- ==============================================================================
-- Migration: 002_signing_schema.sql
-- Description: Schema for Documenso Document Signing requests, signers,
--              and cryptographic webhook deduplication.
-- Target: PostgreSQL 14+ / MySQL 8+ compliant DDL
-- ==============================================================================

-- 1. Signing Requests Table
CREATE TABLE IF NOT EXISTS signing_requests (
    id VARCHAR(64) PRIMARY KEY,
    provider VARCHAR(64) NOT NULL DEFAULT 'documenso',
    provider_request_id VARCHAR(128) NOT NULL UNIQUE,
    company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    document_id VARCHAR(64) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    requested_by VARCHAR(255) NOT NULL,
    requested_by_id VARCHAR(64) NOT NULL,
    signed_document_id VARCHAR(64) REFERENCES documents(id) ON DELETE SET NULL,
    audit_certificate_id VARCHAR(64) REFERENCES documents(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signing_req_company_id ON signing_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_signing_req_document_id ON signing_requests(document_id);
CREATE INDEX IF NOT EXISTS idx_signing_req_status ON signing_requests(status);
CREATE INDEX IF NOT EXISTS idx_signing_req_provider_id ON signing_requests(provider_request_id);

-- 2. Signing Request Signers Table
CREATE TABLE IF NOT EXISTS signing_request_signers (
    id VARCHAR(64) PRIMARY KEY,
    signing_request_id VARCHAR(64) NOT NULL REFERENCES signing_requests(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(64) NOT NULL DEFAULT 'Signer',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    invitation_token VARCHAR(128) NOT NULL UNIQUE,
    invitation_url VARCHAR(512) NOT NULL,
    signed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signers_request_id ON signing_request_signers(signing_request_id);
CREATE INDEX IF NOT EXISTS idx_signers_email ON signing_request_signers(email);
CREATE INDEX IF NOT EXISTS idx_signers_token ON signing_request_signers(invitation_token);

-- 3. Webhook Deduplication & Event Tracker
CREATE TABLE IF NOT EXISTS signing_webhook_events (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    provider VARCHAR(64) NOT NULL DEFAULT 'documenso',
    provider_request_id VARCHAR(128),
    signing_request_id VARCHAR(64) REFERENCES signing_requests(id) ON DELETE CASCADE,
    payload_fingerprint VARCHAR(64) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON signing_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_id ON signing_webhook_events(provider_request_id);
