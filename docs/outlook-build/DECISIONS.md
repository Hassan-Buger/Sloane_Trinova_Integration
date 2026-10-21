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
| D7.1 | Calendar Clash Detection in Context Scan (§4.3) | Derive Context Scan clash card dynamically from live Microsoft Graph calendar events using pure overlap logic (`detectEventClashes`). | Keeps existing Executive Intelligence Radar functional with real data; renders Schedule Conflict with title and times when overlaps exist, and 'Calendar Schedule Clear' when none exist or 'Outlook Calendar Not Connected' when disconnected. | Task P7.2 |
| D7.2 | Demo Arrays Removal (§5 P7.3) | Eradicated all demo arrays (`DIARY_ITEMS`, `ATTENTION_EMAILS`, `TOP3_ITEMS`, `WAITING_SIGNOFF`, `PEOPLE_WORK`, `ACCOUNTS_TRACKER`, `ACTION_TRACKER`, `VAT_TRACKER`) and `getSeedData()` from UI path. | Eliminates sample data leakage; panels query authenticated `/api/v1` REST APIs or render honest empty states with dynamic pulse metrics. | Task P7.3 |

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

### D7.2: Demo Arrays Removal from UI Path
Per §5 Task P7.3, all static demo arrays have been permanently removed from the frontend UI rendering path:
1. `seed.DIARY_ITEMS` & `seed.ATTENTION_EMAILS`: Replaced with live Graph data endpoints (`GET /api/v1/outlook/diary` and `GET /api/v1/outlook/flagged-emails`) with §4.3 empty states and dynamic radar pills.
2. `seed.TOP3_ITEMS`: Command Centre top priorities are now dynamically ranked from `GET /api/v1/statutory` (sorted by RED urgency, active strike-offs, and overdue accounts), rendering an honest empty state when no urgent items exist.
3. `seed.WAITING_SIGNOFF`: Sign-off panel now queries `GET /api/v1/tasks` (filtered for pending, review, or approval items), displaying an honest empty state (`No items waiting for sign-off`) when empty and connecting `pulseSignoffs` to the live count.
4. `seed.PEOPLE_WORK`: People & Work grid is now dynamically grouped by assignee directly from `GET /api/v1/tasks`, rendering an honest empty state when no tasks exist.
5. `seed.ACCOUNTS_TRACKER`, `seed.ACTION_TRACKER`, `seed.VAT_TRACKER`: Statutory monitor now loads live records from `GET /api/v1/statutory`, derives action items dynamically from RED/AMBER records, displays a clean empty state for VAT filings, and drives `statRadarTracked`, `statRadarRed`, `statRadarClear`, and `statNavBadge` from real data.
6. `getSeedData()` and dynamic `./data/seed.js` imports were completely eradicated from `scripts/app.js`. The entire frontend application runs 100% data-free on logged-out state and exclusively binds to verified backend APIs.
