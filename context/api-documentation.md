# Trinova Integration API Reference & Documentation

> **Service:** Sloane ⇄ Trinova Backend REST Integration & Signing Service  
> **API Version:** `v1` (`/api/v1`)  
> **Protocol:** HTTPS / REST / JSON (UTF-8)  
> **Authority:** [`context/04_backend_integration_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/04_backend_integration_context.md), [`context/05_data_security_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/05_data_security_context.md), [`context/06_testing_deployment_context.md`](file:///d:/V2/Sloane_Trinova_Integration/context/06_testing_deployment_context.md) §13

---

## 1. Authentication & Security

All private endpoints require scoped server-to-server credentials passed via standard HTTP headers:
- `Authorization: Bearer <API_KEY>`
- *Or:* `X-Trinova-API-Key: <API_KEY>`

### Authorization Scopes
| Scope | Purpose | Permitted Endpoints |
|---|---|---|
| `sloane:read` | Read-only access to portal entities | Client 360, company details, statutory monitor, task lists, message streams, document metadata, audit queries. |
| `sloane:write` | Write and mutation access | Task creation/updates/completion, workflow status transitions, confirmed internal notes, document uploads, signing requests. |

### Error Codes
| Status Code | Error Code | Description |
|---|---|---|
| `401 Unauthorized` | `AUTHENTICATION_REQUIRED` | Missing or malformed authentication header. |
| `401 Unauthorized` | `INVALID_CREDENTIAL` | Credential not recognized. |
| `401 Unauthorized` | `CREDENTIAL_REVOKED` | Key has been revoked. |
| `401 Unauthorized` | `CREDENTIAL_EXPIRED` | Key expired. |
| `403 Forbidden` | `INSUFFICIENT_SCOPE` | Key lacks the required scope (e.g. attempting a write with `sloane:read`). |
| `404 Not Found` | `RESOURCE_NOT_FOUND` | Target client, company, or task does not exist. |
| `409 Conflict` | `IDEMPOTENCY_CONFLICT` | Replay of `Idempotency-Key` with a different payload. |
| `409 Conflict` | `VERSION_CONFLICT` | Optimistic concurrency conflict (stale update). |
| `422 Unprocessable` | `VALIDATION_ERROR` | Request payload fails schema validation. |
| `422 Unprocessable` | `PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED` | Note submitted without explicit opt-in confirmation flag. |

---

## 2. Core Architectural Protocols

### 2.1 Idempotent Mutations
All write requests creating new resources (`POST /api/v1/tasks`, `POST /api/v1/conversations/:id/messages`, `POST /api/v1/companies/:id/documents/upload`, `POST /api/v1/companies/:id/signing-requests`) require an `Idempotency-Key` header with a valid **UUID v4**:
```http
Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
```
- Replays with identical payload return the cached response without creating duplicate records.
- Replays with differing payloads trigger `409 Conflict`.

### 2.2 Three-State Data Contract
Read responses strictly distinguish missing data:
1. **Empty (`null`):** Field exists in schema, but record has no value (e.g. `secondaryVatNumber: null`).
2. **Unavailable (Object):** Field exists, but cannot currently be loaded from external source (e.g. `financials: { status: "unavailable", reason: "Xero live connection pending initial authorization" }`).
3. **Unsupported (`absent`):** Field is not part of the schema (omitted entirely).

### 2.3 Strict Privacy Boundary
Sloane-private notes and CEO Brain data are **never automatically synced** to Trinova. Any note written to Trinova requires an explicit user confirmation flag:
```json
{
  "text": "Agreed quarterly review fee confirmed with Sarah Jenkins.",
  "confirm_write_to_trinova": true,
  "visibility": "staff_only"
}
```
If `confirm_write_to_trinova` is missing or `false`, the server rejects the write with `422 Unprocessable Entity`.

---

## 3. Endpoints Reference

### 3.1 Health & Verification
- `GET /api/v1/health`: Public service health check.
- `GET /api/v1/auth/verify`: Protected endpoint verifying caller credentials, active scopes, and actor profile.

### 3.2 Clients & Companies Read API
- `GET /api/v1/clients`: Paginated list of clients with `businessArea` and `search` filters.
- `GET /api/v1/clients/:id`: Full client details including nested structured company entities and contacts.
- `GET /api/v1/companies/:id`: Detailed company 360 record including directors array, services array, accounting reference date, statutory deadlines, VAT/PAYE/CIS registration, and financial indicators.

### 3.3 Statutory Reconciliation & Companies House
- `GET /api/v1/statutory`: Reconciled statutory deadlines sorted by urgency level (`RED`, `AMBER`, `GREEN`, `CLEAR`).
- `GET /api/v1/statutory/:companyNumber`: Single company statutory filing status.
- `POST /api/v1/statutory/sync`: Triggers live Companies House synchronization (server-side API key, rate-limited to 600 req / 5 min).

### 3.4 Tasks & Workflow
- `GET /api/v1/tasks`: Filter tasks by `companyId`, `assigneeId`, or `status`.
- `POST /api/v1/tasks`: Create task (requires `Idempotency-Key`, `companyId`, `title`).
- `PATCH /api/v1/tasks/:id`: Update task with version concurrency check.
- `POST /api/v1/tasks/:id/complete`: Complete task (enforces prerequisite check: blocked tasks require resolution details).
- `POST /api/v1/companies/:id/workflow`: Update company workflow status transition.

### 3.5 Communications, Notes & Documents
- `GET /api/v1/companies/:id/conversations`: List conversation threads for a company.
- `GET /api/v1/conversations/:id/messages`: Chronological message stream.
- `POST /api/v1/conversations/:id/messages`: Send portal message (requires `Idempotency-Key`).
- `POST /api/v1/companies/:id/notes`: Add internal note (requires `confirm_write_to_trinova: true`, defaults to `staff_only`).
- `POST /api/v1/companies/:id/documents/upload`: Upload document (max 15MB, MIME whitelist, preserves original version).
- `GET /api/v1/documents/:id/download-token`: Generate time-limited (15-min) HMAC-SHA256 download URL.
- `GET /api/v1/documents/download`: Stream binary document file via pre-signed token.

### 3.6 Trinova Document Signing (Documenso Engine)
- `POST /api/v1/companies/:id/signing-requests`: Create signing request targeting an original document with recipient signers.
- `GET /api/v1/companies/:id/signing-requests`: List signing requests for a company.
- `GET /api/v1/signing-requests/:id`: Detailed signing request status.
- `POST /api/v1/signing/webhooks`: Secure Documenso webhook receiver verified via `X-Documenso-Signature` (HMAC-SHA256).
- `GET /api/v1/signing-requests/:id/signed-document`: Authorized pre-signed download token for completed signed PDF.
- `GET /api/v1/signing-requests/:id/audit-certificate`: Authorized pre-signed download token for tamper-evident audit trail certificate.

### 3.7 Audit Log
- `GET /api/v1/audit/logs`: Search centralized audit entries with actor, action, resource, and timestamp.
