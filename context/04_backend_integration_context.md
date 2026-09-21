# 04 — Backend Integration Context

> Authority: this file is derived from the **Developer Handoff** (`Trinova_Sloane_Developer_Instructions.docx`) — the authoritative source for production backend/API/signing architecture. Where the HTML prototype shows related current-state behaviour (e.g. the Companies House browser call), it is cited for contrast only. See `05_data_security_context.md` for the security/audit rules that apply throughout this file, and `06_testing_deployment_context.md` for how all of this gets verified.

---

## 0. Workstreams and responsibility split

Two workstreams, one delivery team:
1. **Sloane ⇄ Trinova API integration** — connect the existing Trinova client portal to Sloane through secure APIs.
2. **Document signing in Trinova** — add a signing workflow to Trinova itself.

Both go through staging first; production only after Hamza and the client approve staging results. **Sloane's interface and functionality remain Kirsty's developer's (Kirsty herself, per the Handoff) responsibility** — this workstream's job is backend, API connection, integration support, and the Trinova signing workflow, coordinating API contracts without rebuilding Sloane's UI.

## 1. System boundary

```
Sloane (frontend + its own backend)
        │
        │  authenticated API calls only
        ▼
Trinova API  ──►  Trinova database (source of truth for shared data)

Sloane private database  ◄── Sloane-only data (never touched by Trinova)
```

**No direct database access from Sloane into Trinova — stated explicitly and without exception, even where both applications share a hosting account.** All reads and writes flow through authenticated APIs.

## 2. Trinova source of truth

Trinova is authoritative for: shared client/company records, tasks, messages, documents, and workflow status. Sloane keeps a **separate database for its own private application data** (CEO Brain, private notes — see `05_data_security_context.md` for the full ownership model). If a fact is available from Trinova, Sloane must read it from Trinova rather than maintaining a parallel copy that can drift.

## 3. First-stage review (must happen before implementation)

Per the Handoff, before writing integration code:
1. Obtain the current Sloane project, Trinova repository and staging access, schema/migration history, and a sample document with the required signing workflow.
2. Inspect existing Trinova routes, authentication, client/company relationships, document storage, tasks, messages, status rules, and audit records. **Reuse existing portal validation and permissions** rather than reimplementing them.
3. Prepare a **field mapping** — for every requested field: source table/column or service, relationship, data type, null handling, read/write permission, and an example response using test data. (Full deliverable spec in `06_testing_deployment_context.md`.)
4. **Flag missing fields, unclear relationships, absent features, and proposed schema changes to Hamza before starting additional work.** Do not invent data or silently expand scope.

The review's output — field mapping, API contract, hosting findings, signing recommendation, dependencies, delivery sequence — must have open questions confirmed before implementing the affected functionality. This is a hard gate, not a suggestion.

## 4. API read contract

Data Sloane must be able to read from Trinova, structured per entity. Fields/edge cases below are exactly what the Handoff specifies — do not add fields it doesn't mention without flagging them as new scope.

| Entity | Required data | Relationship | Purpose | Edge cases to handle |
|---|---|---|---|---|
| Clients / Companies | Stable client ID, stable company ID, company name, company number | A client may have multiple companies | Identity — the anchor for everything else | Multiple companies per client must be supported and correctly structured; agree the exact shape |
| Directors / Shareholders | Director/shareholder details, linked to company | Company → many directors/shareholders | Identity/compliance context | Multiple directors/shareholders per company must be supported; agree structure |
| Contacts | Main contact details | Client/company → contact(s) | Who to reach | Multiple contacts per client must be supported; agree structure |
| Services | Services provided | Client/company → service(s) | What Trinova does for this client | — |
| Team assignment | Assigned team member per service | Service → team member | Who owns the work | — |
| Workflow | Current workflow/status | Client/company or task-level | Where work stands | Use permitted/existing status values only — do not invent new statuses |
| Tasks | Outstanding tasks | Client/company → tasks | Work queue | — |
| Document requests | Outstanding document requests | Client/company → requests | Pending client asks | — |
| Messages / Conversations | Messages, conversation threads | Client/company → conversation(s) → messages | Communication history | Agree structure for multiple message threads per client |
| Documents | Uploaded documents, including authorised access to file contents | Client/company → documents | File access | Access must be authorised, not open-by-default |
| Activity | Latest client activity | Client/company → activity feed | Recency context | — |
| Review / sign-off items | Items waiting for review or sign-off | Client/company → item(s) | What's pending decision | This is the read-only counterpart to the signing workflow (§9) — Sloane reads status here, it does not create or action signing itself |

**Cross-cutting read requirements:**
- Every record returned must be **correctly linked to its client/company ID** — no orphaned or ambiguously-attributed records.
- **Distinguish an empty value from unavailable or unsupported data.** These are three different things and must not be collapsed: a field that is genuinely blank in Trinova, a field that exists but Sloane isn't authorised/able to fetch right now, and a field Trinova's schema doesn't support at all. (The prototype's `fmt()` collapsing "no date" to an em-dash is an acceptable *display* simplification for a single date field — it must not become the pattern for API responses, where these three states need to remain distinguishable to the caller.)
- **Do not infer missing business records.** If Trinova doesn't have a value, the API must say so, not synthesize one.

## 5. API write contract

| Operation | Requirements |
|---|---|
| Create / update task | Uses existing completion rules for marking complete; validated server-side |
| Complete task | Must use Trinova's existing completion rules, not a Sloane-invented status |
| Add internal note | Linked to the correct client/company; records author and timestamp; **agree whether the note is staff-only or client-visible** (open question, not assumed) |
| Upload document | Goes into the correct client portal location; preserves metadata and access rules |
| Send portal message | Within the correct conversation; records the acting user |
| Update workflow/status | Only via permitted transitions and existing portal rules — no bypassing Trinova's own state machine |

For every write operation:
- **Authorization:** check the authorised actor before allowing the write.
- **Validation:** validated server-side, not trusted from the client.
- **Actor:** every write records who performed it (a real acting user, not a generic "Sloane" identity, where Trinova's model supports per-user attribution).
- **Audit:** actor/action/record/time recorded on every write (see `05_data_security_context.md` §Audit logging).
- **Idempotency:** required specifically for task creation, messages, and uploads — operations where a retried request could duplicate a record.
- **Failure handling:** return clear failures rather than claiming an unsuccessful action succeeded.

**Privacy rule that governs writes specifically:** internal Sloane notes must remain private unless the user explicitly selects an action to write them into Trinova — writing to Trinova is always an explicit, opt-in user action, never an automatic sync of private content. Use existing Trinova portal notifications where appropriate, and avoid duplicate notifications (i.e. don't fire a Trinova notification and a separate Sloane notification for the same event without reason).

## 6. API design

- **Versioned contract**, e.g. `/api/v1`. Final route naming follows the existing Trinova application's conventions, not a Sloane-invented scheme.
- Covers: clients/companies, tasks, requests, conversations/messages, documents, activity, review items, notes, workflow updates.
- Document, for every endpoint: request/response schema, required fields, validation rules, allowed status values, pagination, filters, sort order, timestamp format, error codes, authentication.
- **Use stable IDs, never names, as record references** — this directly closes the gap identified in `03_frontend_context.md`, where the prototype currently matches records by name string.

## 7. Reliability

- **Timeouts** on every outbound call.
- **Controlled retries** (bounded, not infinite) for transient failures.
- **Rate/request limits** — bounded pagination and request limits, both incoming (protecting Trinova) and as a client calling Trinova.
- **Idempotency keys** specifically for task creation, messages, and uploads.
- **Stale update detection** — using record versions or an equivalent conflict check; do not allow a stale client-side edit to silently clobber a newer server value.
- **Transactions** where an operation touches related records, so a partial failure can't leave inconsistent state.
- **Partial failure behaviour:** always return a clear failure signal — never report success for an action that didn't fully complete.

## 8. Authentication

- **Server-to-server only** — requests are authenticated server-to-server with **scoped, revocable credentials**.
- Credentials are kept **out of browser code and out of repositories** (see `05_data_security_context.md` §Secrets).
- Every read, write, and file download **checks the authorised actor and records access**.
- Staging and production credentials/environments are kept separate (see `06_testing_deployment_context.md` §Staging and §Production readiness).

## 9. Companies House (backend integration)

**Current prototype behaviour** (documented fully in `01_product_context.md` §Statutory Monitor and `03_frontend_context.md` §`syncCompaniesHouse()`): the browser fetches directly from `https://api.company-information.service.gov.uk`, using a Basic-auth header built from an API key typed into the page and cached in `sessionStorage`.

**Why this is unsuitable for production:** it puts a real, revocable-but-currently-exposed API credential in client-executed code, visible to anyone with browser dev tools access to that session, and ties the sync action to whichever browser tab happens to have the key cached — there is no server-side record of who ran a sync or when, beyond the client-rendered "last sync" text.

**Required backend/server-side architecture:**
- The Companies House API key is held **server-side only**, in Sloane's (or the shared hosting's, per §11) backend configuration — never sent to or requested from the browser.
- The backend exposes its own endpoint(s) that the frontend calls to trigger/poll a sync; the backend performs the actual Companies House call.
- Data fields to reconcile (matching what the prototype already computes, now sourced server-side): **company status, status detail, next accounts due, accounts overdue, confirmation statement due, confirmation statement overdue, checked timestamp.**
- The existing reconciliation *logic* (live overrides spreadsheet/tracker dates when available; spreadsheet-only rows stay visible; dissolved companies suppressed from filing alerts; active strike-off proposal or CH-overdue flags promoted to RED) is a proven business rule worth preserving server-side, not something to redesign from scratch.

## 10. Document signing — complete backend workflow

**Framing, stated explicitly in the Handoff:** the client approved an **open-source signing approach**, subject to confirming the selected solution, licence, and workflow. "DocuSign" in the source material names the *capability being requested*, not an instruction to integrate the commercial DocuSign service. **Do not begin provider-specific implementation until the selection is confirmed.**

### 10a. Signing selection and approval (must happen before implementation)

- Evaluate a **maintained, self-hosted, open-source** solution against the supplied document and signing workflow.
- Confirm the needed API, embedding, audit record, and export features exist in the specific edition being evaluated (some open-source signing tools gate features by edition/licence tier).
- Report: product/version, licence and applicable obligations, deployment requirements, data storage locations, authentication method, and any functional limitations — with **authoritative licence and feature references** (i.e. cite the vendor's own docs/licence text, don't assert from memory).
- Confirm, and do not assume from the sample document alone: signer count and order, required fields, signer verification method, invitation delivery, reminders/expiry, completion handling, and whether staff must review or countersign.
- **Show Hamza the proposed workflow and obtain client confirmation of the solution/licence and workflow before implementing it.**
- **Do not claim equivalence with every DocuSign feature or compliance requirement** — report actual capabilities and gaps honestly.

### 10b. Core signing flow to implement

1. An authorised Trinova staff member selects the client/company and document, then creates a signing request with the agreed signer details and required fields.
2. The signer receives an invitation or accesses a secure signing link through the agreed channel. Link expiry and recipient access are enforced according to the approved workflow.
3. The signer reviews the **exact document version**, completes required fields, and submits their signature through the selected solution.
4. Trinova tracks signing progress and shows the request against the correct client/company. Provider statuses are mapped to agreed portal statuses, including failure and expiry where the provider supports them.
5. On completion, the signed document is stored or securely retrieved, along with available audit evidence. Both are linked to the original request and client/company, and authorised users can download them.

### 10c. Signing integration controls

- **Preserve the original document and the completed signed version separately — never overwrite signed files.**
- Retain: provider request ID, signer details, timestamps, document version, and audit evidence.
- **Verify webhook authenticity where supported; otherwise use authenticated polling.** Either way, event processing must be **idempotent**, and must safely handle **duplicate, delayed, and out-of-order** updates.
- **Do not mark a request completed until provider completion and the signed output are both verified.** Retry failed document retrieval; show an actionable pending/error state rather than a silent failure.
- Apply Trinova's existing document permissions to invitations, signed outputs, and audit files. Validate file types and sizes. Store files privately; keep secrets server-side.

### 10d. Signing provider evaluation checklist

Use this checklist against any candidate self-hosted open-source solution — do not select a provider, as none is named in the source material:

- API availability and completeness (create request, check status, retrieve signed document, webhooks)
- Embedding support (can the signing UI be embedded in/linked from Trinova cleanly)
- Licensing (exact licence, commercial-use terms, any edition gating of needed features)
- Deployment model (self-hosted requirements: infra, dependencies, maintenance burden)
- Data storage location (where documents/signatures/audit data physically live)
- Authentication method (how the solution authenticates API callers and signers)
- Audit trail completeness and export format
- Signer count and signer-order support
- Signer verification method
- Invitation delivery mechanism
- Reminders and expiry configuration
- Countersignature / staff review support
- Completion event delivery (webhook vs poll) and its security model
- Webhook security (signature verification, replay protection)
- Known functional limitations vs the supplied sample document's requirements
- Maintenance status / activity of the open-source project itself (a prerequisite implied by "maintained self-hosted open-source solution")

## 11. Hosting

- **Use the existing hosting account initially**, but only after checking: available compute, memory, database connections, storage, and deployment isolation.
- Keep services, credentials, environment variables, and databases **separate**, even while co-hosted.
- **Keep API URLs and credentials configurable** so Sloane can move to another hosting account later without redesigning the integration.
- Sloane must remain accessible only to its authorised private user, regardless of hosting arrangement.
- Staging and production environments are configured independently (secrets, storage, email, API URLs, signing callbacks) — see `06_testing_deployment_context.md`.

---

## Open Questions / Decisions Required

Genuinely unresolved per the source material — do not invent answers to these:

- Exact API authentication mechanism (the Handoff specifies the *properties* required — scoped, revocable, server-to-server — not a specific scheme such as OAuth2/mTLS/API keys).
- Final API endpoint naming (must follow the existing Trinova application's conventions, which have not been documented here — this requires inspecting the live Trinova codebase per §3).
- Final signing provider, licence, and exact deployment model (explicitly gated behind the evaluation-and-approval process in §10a — no candidate is named in either source).
- Exact database technology for Sloane's private store (not specified).
- Exact infrastructure/hosting provider beyond "the existing hosting account, checked for capacity" (not named).
- Whether a Trinova portal note written by Sloane is staff-only or client-visible by default (explicitly flagged in the Handoff as something to "agree," not decided).
- The precise structure for multiple companies/contacts/directors/shareholders/message threads (the Handoff says to "agree the structure," it does not define one — see also `01_product_context.md`'s note on the prototype's flat `dirs` field, which is not that structure).
- Full field mapping itself — this document lists *categories* of required fields per the Handoff; the literal source table/column mapping is a first-stage deliverable not yet produced (see §3 and `06_testing_deployment_context.md`).
