# Unit 06: Trinova Document-Signing Workflow Integration

> **Hard Stop Gate:** Per `context/04_backend_integration_context.md` §10a, no provider-specific implementation code in this unit may be executed until Hamza and the client formally approve the evaluation findings in `context/signing-provider-evaluation.md`.

## 1. Goal
Implement the end-to-end document signing workflow inside Trinova: creating signing requests, embedding or emailing signing invitations, securely receiving webhook completion callbacks, and storing signed outputs and audit evidence separately from original documents.

## 2. Design
- **Core Workflow:** Per `context/04_backend_integration_context.md` §10b:
  1. Authorised staff member selects client/company and document, creating a request with signer details.
  2. Signer receives invitation/secure link with enforced expiry and recipient access.
  3. Signer completes and signs the exact document version.
  4. Trinova tracks progress and maps provider statuses to portal workflow statuses.
  5. On completion, signed document and audit certificate are retrieved, stored separately, and linked to the request.
- **Integration Controls:** Per `04_backend_integration_context.md` §10c:
  - Original document and completed signed document are **never the same file** — signed files must not overwrite originals.
  - Webhooks must be verified using HMAC signatures; event handling must be idempotent and resilient to duplicate, delayed, or out-of-order deliveries.
  - Do not mark requests completed until provider completion and signed output retrieval are both verified.

## 3. Implementation
### 3.1 Signing Request Orchestrator
- Implement `POST /api/v1/companies/{companyId}/signing-requests`:
  - Verify acting staff permissions.
  - Dispatch document and recipient metadata to the approved signing service (e.g. Documenso API).
  - Create internal signing record in Trinova (`id`, `providerRequestId`, `companyId`, `documentId`, `status: "PENDING"`, `signers`).
  - Generate invitation link or trigger delivery email.

### 3.2 Secure Webhook Handler
- Implement `POST /api/v1/signing/webhooks`:
  - Verify webhook signature header (`X-Documenso-Secret` / HMAC-SHA256) using server-side webhook secret. Reject unverified payloads with `401 Unauthorized`.
  - Check event idempotency (track processed `eventId` / `providerRequestId` + `status`).
  - Handle events safely:
    - `RECIPIENT_SIGNED`: Update recipient progress in Trinova audit records.
    - `DOCUMENT_COMPLETED`: Trigger signed document retrieval workflow.
    - `DOCUMENT_REJECTED` / `EXPIRED`: Update status to `Rejected` / `Expired`.

### 3.3 Document & Audit Evidence Retrieval Service
- Upon `DOCUMENT_COMPLETED` verification:
  - Fetch signed PDF artifact from signing engine API.
  - Fetch standalone Audit Certificate PDF.
  - Store signed PDF in a new storage path (e.g. `/documents/signed/{id}.pdf`), ensuring original file `/documents/originals/{id}.pdf` is unchanged.
  - Store audit certificate alongside signed document.
  - Update Trinova database records, mark signing request `Completed`, and log audit record.

## 4. Dependencies
- Approved self-hosted signing instance (Documenso Community Edition).
- Server configuration: `SIGNING_API_URL`, `SIGNING_API_KEY`, `SIGNING_WEBHOOK_SECRET`.
- File storage driver and PDF validator.
- Idempotency and audit subsystems.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §7 (Signing Acceptance Tests):
- [ ] Staff member can create a signing request for a company document.
- [ ] Signer receives invitation with secure, time-limited token.
- [ ] Webhook handler cryptographically validates payload signature and rejects forged payloads.
- [ ] Duplicate webhook deliveries are handled idempotently without duplicate record processing.
- [ ] Out-of-order events (e.g. completion arriving before recipient event) are processed safely.
- [ ] Completed signed PDF is stored separately from the original document.
- [ ] Original document is completely unmodified after signing.
- [ ] Tamper-evident audit certificate PDF is retrieved and linked to the record.
- [ ] Trinova portal status accurately reflects signing progress (`Pending` → `Signed`).
- [ ] Failed or rejected signing attempts surface clear error status rather than false completion.
