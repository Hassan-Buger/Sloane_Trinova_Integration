# Sloane ⇄ Trinova Integration: Master Build Plan

> **Authority:** `BUILD_LOOP_PROMPT.md` §Stage 1 and `context/06_testing_deployment_context.md` §1.  
> **Status:** Active Master Build Plan.

---

## 1. Overview & Delivery Sequence

This build plan decomposes the backend integration, security, and document-signing work into discrete, verifiable units adhering strictly to the sequencing rules in `context/06_testing_deployment_context.md` §1:
1. Field Mapping (`context/field-mapping.md`) — Completed in Stage 0.
2. API Contract & Auth Infrastructure (Unit 01).
3. Backend Read Endpoints (Unit 02).
4. Companies House Server-Side Service (Unit 03).
5. Backend Write Endpoints: Tasks & Workflow (Unit 04).
6. Backend Write Endpoints: Messages, Notes & Documents (Unit 05).
7. Trinova Document-Signing Integration (Unit 06) — *Hard stop gate pending approval*.
8. Staging Validation & Acceptance (Unit 07).
9. Production Preparation, Deployment Runbook & Monitoring (Unit 08).

---

## 2. Unit Roster

| Unit ID | Spec File | Title | Boundary / Scope | Status | Blockers |
|---|---|---|---|---|---|
| **Unit 01** | [`01-auth-infrastructure.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/01-auth-infrastructure.md) | Server-to-Server Auth & Audit Infrastructure | Security, middleware, token validation, audit logging | **Completed** (11/11 tests pass) | None |
| **Unit 02** | [`02-client-company-read.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/02-client-company-read.md) | Client, Company & Entity Read Endpoints | Read API contract, structured relations, empty/unavailable handling | **Completed** (11/11 tests pass) | None |
| **Unit 03** | [`03-companies-house-backend.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/03-companies-house-backend.md) | Server-Side Companies House Reconciliation | External service, secure credentials, caching, deadline logic | **Completed** (16/16 tests pass) | None |
| **Unit 04** | [`04-tasks-workflow-read-write.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/04-tasks-workflow-read-write.md) | Tasks & Workflow Read/Write with Idempotency | Tasks, status transitions, idempotency keys, completion rules | **Completed** (15/15 tests pass) | None |
| **Unit 05** | [`05-messages-notes-documents.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/05-messages-notes-documents.md) | Messages, Internal Notes & Document Management | Communications, file upload/download, note visibility, audit | **Completed** (12/12 tests pass) | None |
| **Unit 06** | [`06-signing-integration.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/06-signing-integration.md) | Trinova Document-Signing Workflow Integration | Self-hosted signing API, invitations, webhooks, audit PDFs | **Completed** (8/8 tests pass) | None (Approved Documenso AGPL-3.0) |
| **Unit 07** | [`07-staging-verification.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/07-staging-verification.md) | Staging Validation & Acceptance Testing | Test fixtures, masked data, end-to-end integration tests | **Completed** (14/14 tests pass) | None |
| **Unit 08** | [`08-production-release.md`](file:///d:/V2/Sloane_Trinova_Integration/context/specs/08-production-release.md) | Production Release, Rollback Runbook & Monitoring | Deployment runbook, monitoring telemetry, handoff package | **Completed** (7/7 smoke gates pass) | Ready for human release gate sign-off |

---

## 3. Standing Execution Rules

During implementation of any unit in Stage 2, the following non-negotiable rules apply:
1. **No direct database access:** Sloane reads and writes Trinova data only via versioned `/api/v1` REST endpoints.
2. **Stable IDs throughout:** Never use entity names as primary record lookups.
3. **Empty vs. Unavailable vs. Unsupported:** Read endpoints must cleanly differentiate these states.
4. **Idempotency keys:** Required on all task creation, message sending, and document uploads.
5. **No secrets in frontend or code:** Keep credentials strictly in server-side environment variables.
6. **Privacy boundary:** Sloane-private content (CEO Brain, private client notes) is never automatically synced to Trinova.
7. **Document security:** Original documents and signed outputs are stored separately; signed files never overwrite originals.
8. **Rollback guarantee:** If production smoke tests fail, deployment stops immediately and executes the documented rollback plan.
