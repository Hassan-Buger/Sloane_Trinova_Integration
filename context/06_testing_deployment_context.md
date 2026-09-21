# 06 — Testing, Deployment & Handoff Context

> Authority: this file governs **QA, staging, deployment, monitoring, rollback, and handoff**, drawn directly from the Developer Handoff's staging/production/handoff sections. See `04_backend_integration_context.md` for what's being tested, and `05_data_security_context.md` for the environment-isolation rules referenced throughout.

---

## 1. Delivery sequence

The Handoff's own structure defines this sequence — do not reorder it without a documented reason grounded in the source material:

1. Inspect current infrastructure (Sloane project, Trinova repo/staging access, schema/migration history, sample document with signing workflow — see `04_backend_integration_context.md` §3).
2. Define field mapping (§2 below).
3. Define API contract (`04_backend_integration_context.md` §6).
4. Implement backend integration.
5. Implement signing workflow.
6. Test in staging (§4–5 below).
7. Obtain approval (Hamza and the client, on staging results).
8. Prepare production (§7 below).
9. Deploy.
10. Smoke test.
11. Monitor.
12. Hand off (§9 below).

**No production deployment until staging acceptance and release approval are recorded.** This is a hard gate stated directly in the Handoff, not an implied best practice.

## 2. Field mapping

A required deliverable, produced during the first-stage review (`04_backend_integration_context.md` §3), covering every requested field:

| Column | Description |
|---|---|
| Trinova field | Source table/column or service |
| Sloane field | The corresponding Sloane-side field/concept |
| Direction | Read / Write / Both |
| Type | Data type |
| Required/optional | Whether the field can be null/absent |
| Transformation | Any mapping/formatting logic applied |
| Validation | Rules applied on write |
| Relationship | How the field relates to its parent entity (e.g. company → directors is one-to-many) |

This table must exist before implementation proceeds on affected functionality, and any missing fields, unclear relationships, absent features, or proposed schema changes discovered while building it are flagged to Hamza first — not silently resolved by assumption.

## 3. Read testing

Verify every requested field against Trinova's actual source records, covering:
- All required fields present and correctly typed
- Empty fields (a field that is genuinely blank)
- Unavailable fields (a field Sloane isn't authorised or able to fetch right now)
- Unsupported fields (a field Trinova's schema doesn't have at all)

  — these three states (per `04_backend_integration_context.md` §4) must be distinguishable in test results, not collapsed into one "missing" case.
- Multiple companies per client
- Multiple contacts per client/company
- Multiple directors/shareholders per company
- Pagination
- Filters and sorting
- Review/sign-off items
- Correct client/company relationships on every returned record (no orphaned or mis-attributed records)

## 4. Write testing

Verify, for each write operation defined in `04_backend_integration_context.md` §5:
- Task creation
- Task updates
- Task completion (using Trinova's existing completion rules)
- Internal notes (linked to the correct client/company, author + timestamp recorded)
- Document upload (correct portal location, metadata and access rules preserved)
- Portal messages (correct conversation, acting user recorded)
- Workflow/status changes (only via permitted transitions)

For each, confirm:
- Correct actor recorded
- Correct permissions enforced (the write is rejected for an unauthorised actor)
- Correct visibility in Trinova once written
- Notifications behave correctly (existing portal notifications used where appropriate; no duplicate notifications)
- Audit trail entry created (actor/action/record/time — see `05_data_security_context.md` §6)

## 5. Authentication / security tests

- Invalid credentials rejected
- Expired credentials rejected
- Revoked credentials rejected
- Unauthorized reads rejected
- Unauthorized writes rejected
- Invalid IDs rejected (not silently ignored or defaulted)
- Cross-client access rejected (a credential scoped to one client/company cannot read/write another's records)
- Document access enforced per Trinova's existing document permissions
- No secret exposure (credentials, tokens, private note content) in responses, errors, or logs — see `05_data_security_context.md` §4 and §7
- Replay protection verified (a captured/replayed request or callback does not succeed a second time where it shouldn't)

## 6. Reliability tests

- Timeout behaviour under a slow/unresponsive dependency
- Retry behaviour (bounded, doesn't itself cause duplication)
- Duplicate request handling (idempotency actually prevents duplicate records for task creation, messages, uploads)
- Stale-version / conflict handling (an update against an outdated version is rejected or surfaced, not silently accepted)
- Partial failure behaviour (a multi-record operation that fails partway leaves no inconsistent state, per the transactional requirement in `04_backend_integration_context.md` §7)
- Delayed responses handled without a false failure or false success
- Webhook duplication handled idempotently
- Webhook ordering — out-of-order signing events processed safely (per `04_backend_integration_context.md` §10c)

## 7. Signing acceptance tests

The complete journey, matching the core flow in `04_backend_integration_context.md` §10b:

1. Staff selects client/company
2. Staff selects document
3. Signing request is created with agreed signer details and required fields
4. Signer receives invitation
5. Signer opens the **exact document version**
6. Signer signs
7. Completion is detected (webhook or authenticated polling, per the approved mechanism)
8. Signed document is retrieved and stored, kept separate from the original
9. Audit evidence is stored and linked to the original request
10. Trinova reflects completion, correctly attributed to the right client/company

Also test explicitly:
- Expired invitation (link expiry enforced)
- Reminder delivery (if the approved workflow includes reminders)
- Multiple signers (if the approved workflow requires more than one)
- Signer order enforcement (if the approved workflow requires a specific order)
- Countersignature (if the approved workflow requires staff countersign)
- Duplicate callbacks (processed idempotently, no duplicate "completed" state)
- Delayed callbacks (processed correctly even if they arrive late)
- Invalid callback (rejected — not trusted without verification, per the webhook-authenticity requirement)
- Failed signing (surfaced as an actionable error state, not silently dropped)
- Cancelled signing (reflected correctly in Trinova's status)

**None of these details may be assumed from the sample document alone** — the Handoff explicitly requires confirming signer count/order, required fields, verification, invitation delivery, reminders/expiry, and completion handling with Hamza/the client before implementation (`04_backend_integration_context.md` §10a).

## 8. Regression testing

Confirm existing Trinova functionality is unaffected by the integration and signing work:
- Login
- Roles/permissions
- Client records
- Tasks
- Messages
- Uploads
- Downloads
- Document requests
- Notifications

## 9. Staging

- Dedicated staging configuration: test accounts, test documents, isolated credentials, test email delivery.
- **No signing invitations or portal notifications sent to real clients during testing.**
- Masked production-like data used only where necessary (not a full production data copy by default).
- Staging deliverables for review: a staging demo, test results, known limitations, and the resolved field mapping.
- **Never copy the staging database over production** — this rule appears specifically under production release, guarding against the reverse direction (staging → production) as much as the more obvious production → staging concern.

See `05_data_security_context.md` §9 for the full environment-isolation rule set this section depends on.

## 10. Production readiness

Checklist before deployment:
- Backups prepared — database and affected files
- Restore approach verified
- Migrations reviewed and, where possible, kept compatible with the current portal
- Production secrets configured independently from staging
- Production storage, email, API URLs, and signing callbacks configured independently from staging
- Hosting capacity confirmed
- Health checks in place
- Exact release and rollback steps documented in advance, not improvised at deploy time

## 11. Monitoring

Post-deployment, monitor:
- API failures
- Integration failures (Sloane ⇄ Trinova)
- Signing failures
- Callback/webhook failures
- Application errors generally
- Database issues
- Storage issues
- Resource use
- Notification failures

## 12. Rollback

- Deploy the tested release and required migrations in a controlled sequence, after approval.
- **Protect existing client data** — production deployment never involves copying the staging database over production.
- Run a controlled smoke test with an authorised test record covering: Sloane read/write, portal regression checks, signing request/completion, signed document retrieval, and access checks.
- **If release criteria fail: stop rollout and follow the rollback plan, preserving any new production records and signed documents already created.**

> **If release criteria fail: STOP / ROLLBACK.** Do not continue deployment merely because part of the system works — this is a direct instruction from the source material and overrides any temptation to "finish the rest and fix the failing part later."

## 13. Final handoff

Deliverables required at the end of the engagement:
- Final field mapping
- API documentation and example requests
- Implemented code and migrations
- Environment-variable names, **without secrets**
- Signing solution/licence record
- Approved signing workflow (as confirmed with Hamza/the client)
- Staging evidence
- Production checklist
- Rollback instructions
- Deployment verification summary

**Report progress separately for the two workstreams:** (1) Sloane API integration, and (2) Trinova document signing. Raise blockers and missing scope with Hamza before starting additional work — this applies throughout delivery, not only at the first-stage review.

---

## Open Questions / Decisions Required

- Exact rollback procedure/tooling (database and file-level) — the Handoff requires that it be documented before deployment, but doesn't specify the mechanism (e.g. point-in-time restore, migration-down scripts).
- Exact monitoring/alerting stack — not specified in either source document.
- Precise smoke-test record/scenario to use in production (an "authorised test record" is required; the specific record/company is not named in the source material).
