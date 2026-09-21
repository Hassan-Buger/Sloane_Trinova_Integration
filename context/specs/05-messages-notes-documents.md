# Unit 05: Messages, Internal Notes & Document Management API

## 1. Goal
Implement secure communication, internal note creation, and document management endpoints with idempotency, strict privacy boundary enforcement for Sloane-private notes, and file access authorization.

## 2. Design
- **Read/Write Contracts:** Per `context/04_backend_integration_context.md` §4–5, implement reading message threads/conversations, sending portal messages, adding internal notes, and uploading/downloading documents with access rules preserved.
- **Privacy Boundary (Core Rule):** Per `context/05_data_security_context.md` §2, internal Sloane notes (CEO Brain, private notes) must remain private unless the user explicitly performs an action that writes them to Trinova. There is no automatic background sync.
- **Note Visibility:** Per `04_backend_integration_context.md` §5 & §Open Questions, note creation must explicitly record author, timestamp, and visibility (`staff_only` by default pending stakeholder confirmation).
- **Document Access & Storage:** Per `05_data_security_context.md` §5, file downloads require authorised access (signed URLs). Original documents and uploads must be preserved and validated for MIME type and file size.
- **Idempotency:** Per `04_backend_integration_context.md` §5 & §7, message sending and document uploads require `Idempotency-Key` headers.

## 3. Implementation
### 3.1 Messages & Conversations Endpoints
- Implement `GET /api/v1/companies/{companyId}/conversations` returning thread list.
- Implement `GET /api/v1/conversations/{id}/messages` returning chronologically ordered messages.
- Implement `POST /api/v1/conversations/{id}/messages`:
  - Validate `Idempotency-Key` header.
  - Verify acting user authorization.
  - Create message, record actor ID and UTC timestamp.
  - Trigger portal message notification if recipient is client/staff.

### 3.2 Internal Notes Endpoint
- Implement `POST /api/v1/companies/{companyId}/notes`:
  - Require explicit user confirmation flag in request payload (`confirm_write_to_trinova: true`).
  - Set default visibility to `staff_only` unless client-visibility is explicitly agreed and provided.
  - Persist note, link to company ID, record author ID, and write audit record.
  - Reject automatic or bulk sync payloads without explicit actor intent.

### 3.3 Document Management Endpoints
- Implement `POST /api/v1/companies/{companyId}/documents/upload`:
  - Validate `Idempotency-Key` header.
  - Validate file size (<= 15MB) and whitelisted MIME types (`application/pdf`, images, office docs).
  - Store file securely in private storage (restricted filesystem or private bucket).
  - Record metadata (`id`, `name`, `size`, `mimeType`, `category`, `uploadedBy`, `companyId`).
- Implement `GET /api/v1/documents/{id}/download`:
  - Verify actor has permission to view documents for the associated company.
  - Generate temporary pre-signed URL or stream file through authorized proxy.
  - Log document access event in audit table.

## 4. Dependencies
- Trinova Document, Message, and Note database models.
- File storage driver (local secure disk or S3-compatible driver).
- Idempotency storage from Unit 04.
- Audit logger from Unit 01.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §4 (Write Testing) & §5 (Auth / Security):
- [ ] Message creation requires valid `Idempotency-Key` and prevents duplicate message sending on retry.
- [ ] Internal note creation without explicit write action is rejected.
- [ ] Internal note defaults to `staff_only` visibility.
- [ ] Uploaded document is validated against size limits and disallowed file extensions.
- [ ] Upload with duplicate idempotency key returns existing document metadata without duplicate storage.
- [ ] Unauthorized user cannot download documents from another client/company.
- [ ] Document download generates an audit log record with actor ID and timestamp.
- [ ] Document contents, message bodies, and private note texts are never dumped into general debug logs.
