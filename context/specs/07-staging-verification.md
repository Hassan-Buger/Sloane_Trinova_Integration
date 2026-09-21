# Unit 07: Staging Validation & Acceptance Testing

## 1. Goal
Execute comprehensive end-to-end integration, security, and regression testing in the isolated staging environment using test accounts and masked data, producing verified test results for stakeholder sign-off.

## 2. Design
- **Environment Isolation:** Per `context/05_data_security_context.md` §9 and `context/06_testing_deployment_context.md` §9:
  - Staging credentials and databases are strictly isolated from production.
  - Test signing and email use sandboxed delivery (e.g. Mailpit/Mailhog) — **no signing invitations or portal notifications sent to real clients**.
  - Staging database is never copied over production.
- **Regression Safety:** Per `06_testing_deployment_context.md` §8, verify that existing Trinova portal features (login, roles, client records, tasks, messages, uploads) continue operating without regression.

## 3. Implementation
### 3.1 Test Fixture Setup
- Provision dedicated staging test fixtures (seed test clients, companies, officers, contacts).
- Configure sandbox email delivery (`MAIL_HOST=mailpit`).
- Configure staging signing sandbox instance.

### 3.2 Automated Test Suite Execution
- Run read contract test suite (verifying Unit 02).
- Run statutory reconciliation test suite (verifying Unit 03).
- Run write and idempotency test suite (verifying Units 04 & 05).
- Run signing callback test suite (verifying Unit 06).
- Run security/auth matrix (verifying Unit 01).

### 3.3 Regression & Staging Demo Package
- Execute manual and automated regression checklist on Trinova portal views.
- Assemble staging deliverables for Hamza and the client:
  - Demonstration recording/walkthrough of signing flow and Sloane API reads.
  - Complete automated test execution report.
  - Known limitations and resolved field mapping.

## 4. Dependencies
- Deployed staging environment.
- Test runner and HTTP integration test framework (e.g. Vitest / Jest / PHPUnit / Postman / Newman).
- Sandbox SMTP server.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §8–9:
- [ ] Staging environment uses isolated database with zero production credentials.
- [ ] No emails or notifications are delivered to real client email addresses.
- [ ] All Read tests (Unit 02) pass.
- [ ] All Write tests with idempotency (Units 04 & 05) pass.
- [ ] End-to-end document signing workflow executes successfully on test documents.
- [ ] Existing Trinova portal features (login, staff roles, task views, document views) pass regression check.
- [ ] Staging acceptance report and demo are ready for review by Hamza and Kirsty.
