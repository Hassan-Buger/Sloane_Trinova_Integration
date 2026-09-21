# Hosting Findings: Shared Infrastructure & Deployment Isolation

> **Authority:** `context/04_backend_integration_context.md` §11 and `context/05_data_security_context.md` §9.  
> **Status:** Stage 0 Architecture & Infrastructure Review Deliverable.

---

## 1. Hosting Architecture Overview

The initial deployment of the Sloane API integration and Trinova signing service is slated to use the **existing shared hosting account** supporting Trinova Accounting's infrastructure. While co-hosting offers cost efficiency during initial rollout, `04_backend_integration_context.md` §11 imposes strict architectural guardrails to prevent noisy-neighbor contention, privilege leaks, and data bleed.

---

## 2. Infrastructure Capacity & Constraints Analysis

| Dimension | Constraint / Baseline | Shared Hosting Risk | Mitigation Requirement |
|---|---|---|---|
| **Compute (CPU)** | Shared vCPU allocation | PDF manipulation, digital signature hashing (SHA-256 / PKI), and background batch reconciliation (Companies House) can spike CPU usage, causing latency on portal web requests. | Offload CPU-heavy tasks (PDF signing, batch CH sync) to asynchronous worker queues or background jobs with throttled concurrency. |
| **Memory (RAM)** | Limited memory per container/cPanel account | In-memory PDF rendering and document manipulation can cause Out-Of-Memory (OOM) aborts. | Enforce maximum upload file size limits (e.g. 15MB); stream files to disk or object storage instead of buffering entire PDFs in RAM. |
| **Database Connections** | Max concurrent MySQL / Postgres connections (often capped at 50–100 on shared setups) | Two applications (Trinova portal + Sloane API) plus background workers competing for connections can quickly exhaust the connection pool. | Deploy strict connection pooling; close connections immediately after query execution; enforce bounded pool sizing per service. |
| **Storage & I/O** | Shared local disk / filesystem | Uncontrolled storage of large signed PDFs, audit certificates, and document attachments can exhaust disk space or inode quotas. | Store original and signed documents in dedicated directory trees with restricted permissions (`0700`); configure scheduled disk-usage monitoring; prepare for external S3-compatible object storage if volume grows. |
| **Network & Rate Limits** | Shared egress IP address | Companies House API enforces a rate limit of 600 requests per 5 minutes per IP. Shared egress could cause rate-limit collisions. | Centralize all Companies House outbound requests through a token-bucket throttler; cache CH results server-side with sensible TTL. |

---

## 3. Deployment Isolation & Boundary Rules

1. **Database Separation (Non-Negotiable):**
   - Sloane's private application data (CEO Brain, private notes, local application state) must reside in a **completely separate database** from Trinova's production database.
   - **Zero Direct Database Access:** Sloane never receives credentials to connect directly to Trinova's database. All shared reads and writes must execute via the authenticated `/api/v1` endpoints.

2. **Operating System & Process Isolation:**
   - Background daemons, API web processes, and cron jobs for the integration layer must execute under an isolated service user or dedicated container environment.
   - File permissions must strictly prevent cross-directory access between the Trinova webroot, Sloane backend, and document signing storage.

3. **Environment Variables & Secret Segregation:**
   - Secrets (`TRINOVA_API_SECRET`, `COMPANIES_HOUSE_API_KEY`, `SIGNING_WEBHOOK_SECRET`, database passwords) must be loaded from secure, server-side environment files located strictly outside the public web root.
   - Staging and production configurations must have dedicated, non-overlapping `.env` definitions.

4. **Configurable Endpoints for Zero-Downtime Migration:**
   - To preserve long-term agility, all base URLs, API routes, and webhook callbacks must be configuration-driven:
     - `TRINOVA_API_BASE_URL`
     - `SLOANE_BACKEND_URL`
     - `SIGNING_SERVICE_URL`
   - This ensures that when Sloane or the signing engine outgrows the shared host, it can be relocated to dedicated cloud infrastructure (e.g. AWS, Render, or a dedicated VPS) by updating environment variables without altering application code.

---

## 4. Staging vs. Production Isolation Checklist

- [ ] **Database Instances:** Dedicated staging database populated with test fixtures and masked data; never connected to production tables.
- [ ] **Email Delivery:** Staging email configured with Mailpit, Mailhog, or sandbox SMTP to prevent test signing links or portal notifications from reaching real clients.
- [ ] **Webhook Endpoints:** Distinct webhook callback URLs for staging and production signing workflows to prevent crosstalk.
- [ ] **Backup & Recovery Verification:** Daily automated database dumps and file-level snapshots verified prior to any migration execution.
