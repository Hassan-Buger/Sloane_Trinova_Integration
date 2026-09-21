# Unit 08: Production Release, Rollback Runbook & Final Handoff

## 1. Goal
Prepare production deployment readiness, establish a verifiable rollback runbook, execute controlled smoke tests, configure production monitoring, and compile final engagement handoff deliverables.

## 2. Design
- **Production Gate:** Per `context/06_testing_deployment_context.md` §1 & §10:
  - No production deployment until staging acceptance and release approval from Hamza and the client are recorded.
  - Production secrets, storage, and callbacks are configured independently from staging.
  - Production deployment never involves copying the staging database over production.
- **Rollback Rule (Non-Negotiable):** Per `06_testing_deployment_context.md` §12:
  - If release criteria fail during smoke testing: **STOP / ROLLBACK**.
  - Do not continue deploying partway; preserve any new production records and signed documents already created.
- **Final Handoff Deliverables:** Per `06_testing_deployment_context.md` §13, assemble all 10 handoff artifacts.

## 3. Implementation
### 3.1 Pre-Deployment Verification Checklist
- Confirm verified database backup and restore drill.
- Validate production environment variables (secrets, storage keys, email, signing URL) without committing any secrets to source control.
- Review database migrations for backwards-compatibility with current Trinova portal.

### 3.2 Controlled Deployment Execution
- Deploy versioned API endpoints and signing service background workers.
- Run database migrations in controlled transaction.
- Execute automated smoke test on designated authorized test company record:
  - Sloane read/write API test.
  - Document signing request creation and test completion.
  - Signed document retrieval check.
  - Audit logging verification.

### 3.3 Rollback Runbook & Procedures
- **Step 1:** Stop background workers and set API router to maintenance mode.
- **Step 2:** Roll back code deployment to previous stable release tag.
- **Step 3:** Revert schema migrations using down-migrations or point-in-time database snapshot while preserving records created during the deployment window.
- **Step 4:** Verify portal stability against regression suite.

### 3.4 Telemetry & Final Handoff Package
- Set up monitoring metrics: API error rate, signing callback failures, response latency, resource usage.
- Assemble final handoff package:
  1. Final field mapping (`context/field-mapping.md`).
  2. API documentation & OpenAPI spec.
  3. Implemented code & migrations.
  4. Sanitized environment variable template (`.env.example`).
  5. Signing solution & licence record (Documenso AGPL-3.0).
  6. Approved signing workflow documentation.
  7. Staging evidence & test execution logs.
  8. Production readiness checklist.
  9. Rollback runbook.
  10. Deployment verification summary.

## 4. Dependencies
- Approved staging acceptance from Hamza and Kirsty.
- Production hosting credentials and deployment pipeline access.
- Backup storage and rollback tooling.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §10–13:
- [ ] Database backup created and verified before migration execution.
- [ ] Staging database is strictly protected from being copied over production.
- [ ] Production credentials configured independently from staging.
- [ ] Controlled smoke test passes on designated test record.
- [ ] Rollback steps are tested and ready to execute immediately if criteria fail.
- [ ] Monitoring alerts configured for API failures and signing errors.
- [ ] All 10 final handoff deliverables compiled and verified.
