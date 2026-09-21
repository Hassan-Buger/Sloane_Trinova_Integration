# Signing Provider Evaluation: Open-Source Self-Hosted Solutions

> **Authority:** `context/04_backend_integration_context.md` §10a–10d and `context/06_testing_deployment_context.md` §7.  
> **Status:** Stage 0 Deliverable & Hard Stop Gate. Awaiting formal stakeholder confirmation from Hamza and the client before implementing provider-specific signing code.

---

## 1. Executive Summary & Context

Per `04_backend_integration_context.md` §10:
- The client approved an **open-source signing approach**, subject to confirming the selected solution, licence, and workflow.
- "DocuSign" in the project source material specifies the *functional capability requested* (digital document signing, field completion, audit certificates), **not** an instruction to license the commercial DocuSign SaaS.
- **Hard Stop Gate:** No provider-specific signing code may be implemented until Hamza and the client have confirmed the solution, licence terms, and signing workflow.

We have evaluated the two leading maintained, self-hosted, open-source signing solutions:
1. **Documenso Community Edition** (v1.x / v2.x, AGPL-3.0)
2. **OpenSign** (v1.x, AGPL-3.0)

---

## 2. 16-Point Checklist Evaluation

| Checklist Item (`04_backend_integration_context.md` §10d) | Candidate A: Documenso (Community Edition) | Candidate B: OpenSign |
|---|---|---|
| **1. API availability & completeness** | **High:** Comprehensive REST API and OpenAPI 3.0 specification. Complete endpoints for document creation, recipient assignment, field placement, status tracking, document download, and webhook management. | **Moderate / High:** REST API covering document creation, template dispatch, recipient configuration, and download. (Note: In some early OpenSign builds, certain advanced API capabilities required business tokens; self-hosted community builds now support core API flows). |
| **2. Embedding support** | **Supported:** Direct embedded signing via `@documenso/embed` React component or secure iframe URL (`/sign/{token}`). Fits cleanly into Trinova portal layout. | **Supported:** Generates direct signing links that can be loaded in an iframe or redirected from the portal. |
| **3. Licensing & obligations** | **GNU AGPL-3.0:** Strong copyleft license. Requires that if modified and served over a network, the modified source code must be made available under AGPL-3.0. Re-distribution or embedding as an external API microservice alongside Trinova is standard, provided modifications to Documenso core itself are kept compliant. Commercial non-copyleft exceptions require a commercial license from Documenso Inc. | **GNU AGPL-3.0:** Identical copyleft license and obligations. Network interaction with unmodified OpenSign via REST API does not require open-sourcing Trinova, but direct code modifications to OpenSign must be published. |
| **4. Deployment model & requirements** | Containerized via Docker / Docker Compose. Requires Node.js (Next.js), PostgreSQL 14+, Redis (optional for queues/caching), and SMTP. Memory footprint: ~1GB–1.5GB RAM. | Containerized via Docker Compose. Requires Node.js, MongoDB (or PostgreSQL depending on version), Redis, and SMTP. Memory footprint: ~1GB RAM. |
| **5. Data storage location** | 100% on-premise / self-hosted. Stored in local filesystem or S3-compatible bucket; metadata and audit hashes stored in PostgreSQL. Documents never leave customer-controlled infrastructure. | 100% on-premise / self-hosted. Local filesystem / S3 storage; document state in database. Complete data sovereignty. |
| **6. Authentication method** | **API:** Bearer tokens (`API-Key` headers) generated in user settings. **Signer:** Direct unique secure signing tokens transmitted via email or embedded direct URL; optional 2FA/passcode. | **API:** Bearer tokens / API keys. **Signer:** Unique signing URL with optional Email OTP (One-Time Password) verification. |
| **7. Audit trail completeness & export format** | **Excellent:** Generates a tamper-evident Audit Certificate (PDF) appended to the signed document or exported separately, recording IP addresses, email, timestamps (UTC), user agents, field hash values, and cryptographic signature digest. | **Good:** Generates a Completion Certificate PDF recording signer details, timestamps, IP addresses, and document checksums. |
| **8. Signer count & signing order support** | **Full Support:** Multi-signer workflows with explicit sequential order (Signer 1 → Signer 2) or parallel signing. | **Full Support:** Multi-signer workflows supporting sequential or parallel execution. |
| **9. Signer verification method** | Email link with secure access token; optional recipient passcode; email delivery confirmation. | Email link with secure token; Email OTP authentication support. |
| **10. Invitation delivery mechanism** | Automated transactional email via configured SMTP server, or programmatic retrieval of signing URL to send via custom Trinova notification. | Automated email via SMTP, or programmatic signing link generation. |
| **11. Reminders & expiry configuration** | Document expiry dates (e.g. 7, 14, 30 days) and automated reminder schedules configurable per document or globally via background worker. | Expiry date configuration supported; automated reminders via cron/scheduler. |
| **12. Countersignature / staff review** | **Supported:** Workflow can enforce that Trinova staff member is designated as the final recipient in a sequential order to countersign or approve. | **Supported:** Sequential routing allows staff countersignature as the final recipient stage. |
| **13. Completion event delivery** | Real-time Webhooks (`DOCUMENT_COMPLETED`, `DOCUMENT_SIGNED`, `RECIPIENT_SIGNED`, `DOCUMENT_REJECTED`) + authenticated polling endpoint (`GET /api/v1/documents/{id}`). | Webhooks (`document_completed`, `document_signed`) + REST polling endpoint. |
| **14. Webhook security** | **Robust:** Webhook payloads include HMAC signature header (`X-Documenso-Secret` / signature) computed using a shared secret; enables cryptographic verification and replay prevention. | HMAC-SHA256 signature verification supported on webhook endpoints. |
| **15. Known functional limitations vs DocuSign** | - Does not include proprietary DocuSign ID Verification (e.g. UK Passport/Driving Licence biometric scan) out-of-the-box.<br>- SMS delivery requires external Twilio setup.<br>- Advanced conditional logic on PDF fields is simpler than enterprise DocuSign. | - Proprietary identity verification services not bundled.<br>- SMS OTP requires external provider.<br>- UI customization requires CSS overrides or theme configuration. |
| **16. Maintenance status & community** | **Very High:** Top-tier open-source traction (>10k GitHub stars), frequent releases (weekly), active core engineering team, comprehensive OpenAPI docs. | **Moderate / High:** Active development, dedicated community, regular release updates. |

---

## 3. Findings & Recommendation

1. **Recommended Candidate:** **Documenso Community Edition** is the recommended solution. Its architecture (PostgreSQL, TypeScript, Prisma, robust OpenAPI specification, and React embed library) aligns cleanly with modern portal architectures, offers superior audit certificate presentation, and provides out-of-the-box webhook signing security.
2. **Hosting Feasibility on Existing Shared Host:**
   - Deploying Documenso or OpenSign directly on a standard cPanel shared hosting account without Docker support is challenging due to Node.js daemon and database requirements.
   - **Recommended Deployment Options:**
     - **Option A (Container on Shared VPS):** Run Documenso in Docker on a low-cost VPS (e.g. £5–£10/mo Hetzner or DigitalOcean droplet) connected securely via HTTPS API to Trinova.
     - **Option B (Docker on Shared Server):** If the existing host provides Docker/container access, deploy Documenso as a container isolated on the local network.

---

## 4. Hard Stop Questions Pending Stakeholder Approval

Before proceeding to Unit 06 (Document-Signing Implementation), Hamza and the client must confirm:

1. **Solution Selection:** Does the client approve **Documenso Community Edition** as the self-hosted signing solution?
2. **Licence Acknowledgment:** Is the **AGPL-3.0** open-source licence accepted for the signing component?
3. **Workflow Rules for Sample Document:**
   - What document is being targeted first (e.g. Letter of Engagement)?
   - How many signers are required per document (Single signer or Multiple)?
   - Is Trinova staff countersignature required prior to marking the document "Completed"?
   - What is the default expiration period (e.g. 14 days)?
   - Will invitations be sent via Trinova's existing email/portal notification or directly from the signing service's SMTP?
