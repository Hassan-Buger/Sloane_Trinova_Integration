# Architecture & Scope Decisions (Sloane ⇄ Outlook Integration)

This document records architectural decisions, scope approvals, and deviations for the Microsoft Outlook integration.

## Table of Decisions

| Decision ID | Area | Decision | One-line Rationale | Approval / Checkpoint |
|---|---|---|---|---|
| D0.1 | Identity Scopes (§3.2) | **Option A (recommended)**: Request `openid profile email` in addition to `offline_access`, `Mail.Read`, `Calendars.Read`. | Extracts name and email from verified `id_token` claims without requiring additional Graph network hops or broader `User.Read` directory permissions. | **Checkpoint H2** (Human approval required before Phase 3) |
| D0.2 | Token Store Location (§5 P2.1) | Store encrypted tokens at `server/data-private/outlook-vault.json` (overridable via `OUTLOOK_VAULT_PATH`). | Isolates encrypted vault outside web-accessible roots with gitignored status and strict filesystem permissions (0700 dir, 0600 file). | Checkpoint P2.1 |
| D0.3 | Callback Cookie Handling (§4.2) | `/api/v1/integrations/outlook/callback` does not require the session cookie; actor identity is bound via single-use `state` parameter with 10m TTL. | Browsers omit `SameSite=Strict` cookies on cross-site redirects from Microsoft; state-to-actor binding prevents auth drops without degrading cookie security. | Checkpoint P3.2 |
| D0.4 | Revocation Wording (§4.1) | Dialog explicitly clarifies local data/token deletion and directs user to `https://myapps.microsoft.com` to revoke Microsoft-side app consent. | Graph API provides no delegated token revocation endpoint; honest UI transparency prevents false security assumptions. | Checkpoint P5.5 / P7.5 |
| D0.5 | Client Secret Expiry (§3.1) | Maximum 180-day lifecycle from creation in Entra ID; reminder scheduled at 150 days for rotation. | Prevents silent service disruption caused by expired Azure client secrets and enforces credential hygiene. | **Checkpoint H1** (Awaiting Entra registration details) |

## Detailed Decision Notes

### D0.1: Identity Scopes (H2 Checkpoint)
- **Option A (Selected Recommendation):**
  - Scopes: `offline_access`, `Mail.Read`, `Calendars.Read`, `openid`, `profile`, `email`.
  - Account email is parsed from `preferred_username` or `email` claim in `id_token`.
  - Display name is parsed from `name` claim in `id_token`.
  - Validation: Token signature verified against Microsoft tenant JWKS keyset (cached in memory).
  - Advantage: Zero additional Graph API calls; minimal delegated surface area.
- **Option B (Alternative):**
  - Scopes: `offline_access`, `Mail.Read`, `Calendars.Read`, `User.Read`.
  - Account info fetched via `GET https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName`.

### D0.2: Vault Architecture
- Encryption: AES-256-GCM.
- IV: Random 96-bit (12 bytes) per write, never reused.
- Integrity: 128-bit GCM authentication tag verified on read.
- Key: 256-bit (32 bytes) loaded from `OUTLOOK_TOKEN_ENC_KEY` environment variable. Refuses to start Outlook features if missing or invalid key length.
- Atomicity: Writes to temporary file in `data-private/`, performs `fsync`, and renames to target vault file.

### D0.3: OAuth Callback Security
- `state`: 32 cryptographically secure random bytes generated with `crypto.randomBytes(32).toString('base64url')`.
- In-memory state store with 10-minute sliding TTL.
- Single-use consumption: `state` is deleted immediately upon lookup to prevent replay attacks and double-click race conditions.
- `code_challenge`: S256 PKCE challenge computed from high-entropy `code_verifier`.

### D0.4: Disconnect & Token Purge
- Disconnect permanently purges the owner's encrypted token bundle and connection metadata from `server/data-private/outlook-vault.json`.
- Disconnect flushes all cached diary and flagged-email responses for the actor.
- UI displays guidance directing user to Microsoft My Apps to delete cloud-side tenant consent.
