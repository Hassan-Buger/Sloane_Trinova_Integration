-- ==============================================================================
-- Migration: 001_initial_schema.sql
-- Description: Core schema for Clients, Companies, Officers, Contacts, Services,
--              Tasks, Messages, Internal Notes, Documents, and Audit Logs.
-- Target: PostgreSQL 14+ / MySQL 8+ compliant DDL
-- ==============================================================================

-- 1. Clients Table (Top-level client entities)
CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    client_type VARCHAR(64) NOT NULL DEFAULT 'SME',
    business_area VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Active',
    assigned_manager_id VARCHAR(64) NOT NULL,
    assigned_manager_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clients_business_area ON clients(business_area);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- 2. Companies Table (Statutory entities / limited companies)
CREATE TABLE IF NOT EXISTS companies (
    id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    company_number VARCHAR(16) NOT NULL UNIQUE,
    business_area VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Active',
    workflow_status VARCHAR(64) NOT NULL DEFAULT 'Active / Review Due',
    assigned_manager VARCHAR(255) NOT NULL,
    accounting_reference_date VARCHAR(16),
    accounts_due_date DATE,
    confirmation_due_date DATE,
    vat_registered BOOLEAN NOT NULL DEFAULT FALSE,
    vat_number VARCHAR(32),
    secondary_vat_number VARCHAR(32),
    paye_registered BOOLEAN NOT NULL DEFAULT FALSE,
    paye_reference VARCHAR(64),
    cis_status VARCHAR(64),
    risk_level VARCHAR(32) NOT NULL DEFAULT 'Low',
    financials_status VARCHAR(32) DEFAULT 'unavailable',
    financials_reason TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_companies_client_id ON companies(client_id);
CREATE INDEX IF NOT EXISTS idx_companies_company_number ON companies(company_number);
CREATE INDEX IF NOT EXISTS idx_companies_workflow_status ON companies(workflow_status);

-- 3. Company Officers Table (Directors, Secretaries, PSCs)
CREATE TABLE IF NOT EXISTS company_officers (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(128) NOT NULL DEFAULT 'Director',
    email VARCHAR(255),
    appointed_on DATE,
    resigned_on DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_officers_company_id ON company_officers(company_id);

-- 4. Contacts Table (Client/Company Primary & Operational Contacts)
CREATE TABLE IF NOT EXISTS company_contacts (
    id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) REFERENCES clients(id) ON DELETE CASCADE,
    company_id VARCHAR(64) REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(64),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contacts_client_id ON company_contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON company_contacts(company_id);

-- 5. Assigned Services Table
CREATE TABLE IF NOT EXISTS company_services (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_services_company_id ON company_services(company_id);

-- 6. Tasks Table (Workflow tasks with idempotency and optimistic locking)
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(64) NOT NULL DEFAULT 'Pending',
    priority VARCHAR(32) NOT NULL DEFAULT 'Normal',
    due_date DATE,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    blocker TEXT,
    assignee_id VARCHAR(64),
    assignee_name VARCHAR(255),
    creator_id VARCHAR(64) NOT NULL,
    creator_name VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(64) UNIQUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_company_id ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_idempotency_key ON tasks(idempotency_key);

-- 7. Internal Notes Table (Strict privacy boundary enforcement)
CREATE TABLE IF NOT EXISTS internal_notes (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    text TEXT NOT NULL,
    visibility VARCHAR(32) NOT NULL DEFAULT 'staff_only',
    author_id VARCHAR(64) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    explicit_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_company_id ON internal_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_notes_visibility ON internal_notes(visibility);

-- 8. Documents Table (Separate storage for originals vs signed versions)
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'General',
    uploaded_by VARCHAR(255) NOT NULL,
    storage_path VARCHAR(512),
    disk_id VARCHAR(64),
    version INTEGER NOT NULL DEFAULT 1,
    is_original BOOLEAN NOT NULL DEFAULT TRUE,
    is_signed BOOLEAN NOT NULL DEFAULT FALSE,
    is_audit_certificate BOOLEAN NOT NULL DEFAULT FALSE,
    signing_request_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_signing_request_id ON documents(signing_request_id);

-- 9. Centralized Audit Log Table (Zero secret logging)
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64) NOT NULL,
    actor_name VARCHAR(255) NOT NULL,
    action VARCHAR(128) NOT NULL,
    method VARCHAR(16) NOT NULL,
    path VARCHAR(512) NOT NULL,
    resource_type VARCHAR(64),
    resource_id VARCHAR(64),
    status_code INTEGER NOT NULL,
    ip VARCHAR(64),
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);
