# Unit 01: Server-to-Server Auth & Audit Infrastructure

## 1. Goal
Establish secure, server-to-server authentication middleware with scoped, revocable credentials for all Sloane ⇄ Trinova API endpoints, and implement central audit logging capturing actor, action, record, and timestamp on all requests.

## 2. Design
- **Authentication & Authorization:** Per `context/04_backend_integration_context.md` §8 and `context/05_data_security_context.md` §3–4, authentication must be server-to-server, with credentials kept out of browser code and version control. Every read, write, and file download must check the authorised actor.
- **Audit Logging:** Per `context/05_data_security_context.md` §6–7, every write operation and access event must record actor, action, target record ID, and UTC timestamp. Credentials, private notes, document contents, and tokens must be strictly redacted from all application logs.

## 3. Implementation
### 3.1 Authentication Middleware
- Implement token-based or API-key-based server-to-server authentication verifying `Authorization: Bearer <token>` or `X-Trinova-API-Key`.
- Support credential revocation without code changes via server configuration or revocable token storage.
- Reject requests with missing, invalid, or expired credentials with `401 Unauthorized`.
- Reject requests lacking necessary read/write scopes with `403 Forbidden`.

### 3.2 Audit Logging Interceptor
- Intercept all incoming API requests post-authentication.
- Record the acting user identifier (`actor_id`), action descriptor, target entity type and entity ID, and high-precision ISO 8601 UTC timestamp.
- Store audit records in a dedicated audit log table/store.

### 3.3 Log Sanitization Filter
- Enforce strict redaction of sensitive request fields:
  - Auth headers / Bearer tokens
  - Passwords and API secrets
  - Private note contents (`notes`, `brain`)
  - Document payloads / binary streams

## 4. Dependencies
- Web application framework (e.g. Node.js Express / Fastify or PHP / Laravel depending on Trinova stack).
- Cryptographic library for timing-safe signature/token verification.
- Audit database access or persistent append-only log store.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §5 (Authentication / Security Tests):
- [ ] Requests without authorization header return `401 Unauthorized`.
- [ ] Requests with invalid credentials return `401 Unauthorized`.
- [ ] Requests with revoked credentials return `401 Unauthorized`.
- [ ] Valid credentials allow access to authorized endpoints.
- [ ] Requests outside granted scope return `403 Forbidden`.
- [ ] Audit entry is generated for every write request containing actor, action, record, and timestamp.
- [ ] Access logs do not contain credentials, tokens, or private note contents.
- [ ] Timing-safe comparison is used during credential validation.
