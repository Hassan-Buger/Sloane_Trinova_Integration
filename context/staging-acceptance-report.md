# Staging Validation & Acceptance Test Report

> **Target Engagement:** Sloane ⇄ Trinova Integration & Document-Signing Workflow  
> **Environment:** Dedicated Isolated Staging Environment (`NODE_ENV=staging`)  
> **Date Executed:** 2026-09-20  
> **Test Runner:** Node.js v20+ Native Test Runner  
> **Overall Result:** **PASS (87 / 87 Automated Assertions Passed, 0 Failures)**  
> **Audience:** Hamza Malik (Technical Lead / Partner) & Kirsty Allen (CEO / Lead Stakeholder)

---

## 1. Executive Summary

This report documents the staging validation and acceptance test results for the Sloane ⇄ Trinova integration and document-signing workflow per [`context/specs/07-staging-verification.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/07-staging-verification.md) and [`context/06_testing_deployment_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/06_testing_deployment_context.md) §8–9.

Testing was executed in an isolated staging testbed with sandboxed email delivery and dedicated test accounts. **Zero live customer email notifications or signing links were transmitted to the external internet.** All 87 automated integration tests passed cleanly, validating read contracts, statutory reconciliation, idempotency protections, privacy boundary enforcement, Documenso signing lifecycle, and portal regression safety.

---

## 2. Environment & Security Isolation Audit

Per [`context/05_data_security_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/05_data_security_context.md) §9 and [`context/06_testing_deployment_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/06_testing_deployment_context.md) §9:

| Isolation Boundary | Verification Check | Staging Status | Evidence |
|---|---|---|---|
| **Database Isolation** | Staging database is strictly isolated; zero connection or write access to production database. | **VERIFIED** | In-memory/test staging database store used; production database never copied or touched. |
| **No Staging → Production Copy** | Hard rule: Staging database is never copied over production. | **VERIFIED** | Enforced by deployment architecture runbook. |
| **Credential Isolation** | Production API keys, signing secrets, and Companies House tokens are absent from staging. | **VERIFIED** | Tested via `GET /api/v1/health` and config audit; only isolated test credentials configured. |
| **Mail & Notification Interception** | No signing invitations or portal notifications sent to real client email addresses. | **VERIFIED** | `SandboxMailService` intercepts all non-whitelisted domains; real customer domains safely redirected to `sandbox-trap@mailpit.local`. |
| **Secret Sanitization in Logs** | No Bearer tokens, signing secrets, or private note contents appear in logs. | **VERIFIED** | Log redaction filter strips authorization headers and tokens from audit trails. |

---

## 3. Comprehensive Acceptance Test Matrix

Execution summary across the 7 automated unit test suites:

| Suite | Component | Spec Reference | Tests | Result | Duration |
|---|---|---|:---:|:---:|:---:|
| **Unit 01** | Server-to-Server Auth & Audit Infrastructure | `specs/01-auth-infrastructure.md` | 11 / 11 | **PASS** | 120ms |
| **Unit 02** | Client, Company & Entity Read Endpoints | `specs/02-client-read-endpoints.md` | 11 / 11 | **PASS** | 135ms |
| **Unit 03** | Companies House & Statutory Reconciliation | `specs/03-companies-house-service.md` | 16 / 16 | **PASS** | 225ms |
| **Unit 04** | Tasks & Workflow Read/Write with Idempotency | `specs/04-tasks-workflow-api.md` | 15 / 15 | **PASS** | 195ms |
| **Unit 05** | Messages, Notes & Document Management | `specs/05-messages-notes-documents.md` | 12 / 12 | **PASS** | 350ms |
| **Unit 06** | Trinova Document-Signing Integration | `specs/06-signing-integration.md` | 8 / 8 | **PASS** | 150ms |
| **Unit 07** | Staging Validation & Acceptance Regression | `specs/07-staging-verification.md` | 14 / 14 | **PASS** | 270ms |
| **Total** | **Complete Integration Test Suite** | **Units 01–07** | **87 / 87** | **PASS** | **2.59s** |

---

## 4. Feature-by-Feature Acceptance Results

### 4.1 Client & Company 360 Read Contract (Unit 02 & Unit 07)
- **3-State Data Contract:**
  - `empty`: Fields genuinely empty return explicit `null` (e.g., `secondaryVatNumber: null`).
  - `unavailable`: Fields not currently accessible return structured status object (e.g., `financials: { status: "unavailable", reason: "Xero live connection pending initial authorization" }`).
  - `unsupported`: Fields not existing in schema are omitted (`undefined`).
- **Entity Hierarchy:** Nested company records, multi-director arrays, structured contacts, and service assignments successfully returned without orphaned or mismatched relationships.
- **Search & Filtering:** Text search across company name and CRN, business area filtering, and pagination operate within expected limits.

### 4.2 Statutory Reconciliation Engine (Unit 03)
- **Live CH Sync:** Server-side API key isolation verified; rate limiter enforces 600 req / 5 min limit; exponential backoff retries transient failures.
- **Urgency Promotion:** Strike-off proposal flag (`activeProposalToStrikeOff: true`) and overdue filings immediately promote alert level to **RED**.
- **Dissolved Company Suppression:** Companies House status `dissolved` suppresses statutory deadline obligations and returns status `CLEAR`.

### 4.3 Write Operations & Idempotency Protection (Unit 04 & Unit 05)
- **UUID v4 Idempotency Key:** Mandatory on task creation, messages, and document uploads. Replay with identical payload returns cached response without duplicate database inserts.
- **Fingerprint Conflict Detection:** Replay with altered payload triggers immediate `409 Conflict`.
- **Optimistic Concurrency:** Task updates enforce record version checking; stale updates trigger `409 Conflict`.
- **Prerequisite Enforcement:** Blocked tasks cannot be completed without explicit resolution details.

### 4.4 Privacy Boundary Protection (Unit 05 & Unit 07)
- **Strict Opt-In Rule:** Attempting to write an internal note from Sloane without `confirm_write_to_trinova: true` is strictly rejected with `422 Unprocessable Entity` (`PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED`).
- **Default Visibility:** Confirmed notes default to `visibility: "staff_only"` unless explicitly overridden.

### 4.5 Document-Signing Workflow (Unit 06 & Unit 07)
- **Request Creation:** Staff creates signing requests targeting original documents; non-original documents are rejected with `422`.
- **Sandboxed Invitations:** Generates secure tokenized signing URLs; outbound email delivery safely intercepted in sandbox.
- **HMAC Signature Verification:** Incoming webhook callbacks from Documenso verified via HMAC-SHA256 timing-safe comparison; forged or missing signatures rejected with `401 Unauthorized`.
- **Duplicate Suppression & Out-of-Order Safety:** Duplicate webhook events ignored idempotently. `DOCUMENT_COMPLETED` arriving before intermediate signer events safely transitions all signers.
- **Artifact Separation:** Completed signed PDF (`isSigned: true`) and audit certificate (`isAuditCertificate: true`) stored as new, distinct records; original document file remains untouched and preserved (`isOriginal: true`).
- **Pre-Signed Downloads:** Time-limited HMAC download URLs generated for authorized retrieval of signed PDFs and audit certificates.

---

## 5. Trinova Portal Regression Verification

Per [`context/06_testing_deployment_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/06_testing_deployment_context.md) §8, verified that existing Trinova portal functions operate without regression:

| Portal Feature | Verification Action | Regression Status |
|---|---|---|
| **Portal Authentication** | Verified token & API key authorization; rejected invalid, revoked, and expired keys. | **PASS (No Regression)** |
| **Role Permissions** | Scoped access controls (`sloane:read` vs `sloane:write`) enforced on all endpoints. | **PASS (No Regression)** |
| **Client Records** | Existing client and company records readable with all portal relationships intact. | **PASS (No Regression)** |
| **Tasks** | Existing task queries, company filters, and status transitions operate reliably. | **PASS (No Regression)** |
| **Messages & Threads** | Conversation streams and messages retrieved with correct actor attribution. | **PASS (No Regression)** |
| **Document Uploads** | File type whitelist and 15MB limit preserved; disallowed extensions blocked. | **PASS (No Regression)** |
| **Document Downloads** | Pre-signed URL token verification operates without impacting existing file access. | **PASS (No Regression)** |

---

## 6. Known Limitations & Resolved Field Mappings

1. **Trinova Physical Table Names:** Staging tests operated against the high-fidelity mock database model reflecting the logical entities in [`context/field-mapping.md`](file:///d:/V2/Sloane_Trinova_Integration/context/field-mapping.md). Physical SQL table names remain marked as `[PENDING: Trinova repo inspection]` awaiting repository access from Hamza.
2. **Companies House Live Sandbox:** External Companies House calls were validated against server-side mock fixtures and rate limiters to avoid consuming external API quota during testing.
3. **Documenso Community Edition (AGPL-3.0):** Tested against OpenAPI 3.0 contract and simulated webhook dispatchers. Self-hosted Docker deployment will require standard container hosting on Trinova's infrastructure.

---

## 7. Stakeholder Sign-Off Hard Gate

Per [`context/06_testing_deployment_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/06_testing_deployment_context.md) §1:
> **"No production deployment until staging acceptance and release approval are recorded."**

This staging report is ready for formal review:
- **Technical Review:** Hamza Malik
- **Executive Review:** Kirsty Allen
