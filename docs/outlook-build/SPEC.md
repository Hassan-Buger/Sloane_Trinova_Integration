<USER_REQUEST>
# LOOP PROMPT — Sloane: Kirsty-Controlled Outlook Connection (Microsoft Graph)

> Paste this whole document into a coding agent running inside the repository root
> (`Sloane_Trinova_Integration-main/`). The agent works in a loop: each iteration does ONE
> task from `docs/outlook-build/PROGRESS.md`, proves it, records evidence, and stops only
> when every acceptance item is verified or a human checkpoint is reached.

---

## 0. Mission

Give Kirsty Allen full, visible control of **her own** Microsoft Outlook connection inside the
Sloane CEO Command Centre. Today the dashboard prints "Outlook Connected" as static HTML, and the
"Today's Diary" and "Emails Sloane thinks need you" panels show sample data from `scripts/data/seed.js`
and `server/src/data/db.js`. None of that is connected to Microsoft. Replace it with a real,
server-side Microsoft Graph integration that she can connect, configure, sync, reconnect and
disconnect herself.

Nothing else changes. Keep the existing panel design and the existing flagged-email priority logic.

---

## 1. Ground truth from the audit (do not re-discover, but verify each item before you rely on it)

| Area | Current state | Where |
|---|---|---|
| Outlook integration | **Does not exist.** No OAuth, no Graph, no token storage. | repo-wide |
| "Outlook Connected" label | Static text | `index.html` ~line 238 |
| "Connected" pill on diary | Static text | `index.html` ~line 316 |
| Diary panel data | `DIARY_ITEMS` from seed | `scripts/data/seed.js` ~194, rendered `scripts/app.js` ~808–820 |
| Flagged-email panel data | `ATTENTION_EMAILS` from seed (fields `title`, `sub`, `priority`) | `scripts/data/seed.js` ~205, `scripts/app.js` ~855 |
| Sample Outlook timeline events | Hard-coded `source: "outlook"` records | `server/src/data/db.js` ~555 |
| Login email pre-filled | Placeholder in HTML, default in code, default in remember-me getter | `index.html` ~61, `scripts/services/auth.js` ~16 and ~182 |
| Client data in logged-out HTML | Client names appear in static markup (e.g. "Woofington" at `index.html` ~262, ~299, ~494) | `index.html` |
| Static data publicly served | `scripts/` is whitelisted for anonymous GET, so `scripts/data/seed.js` (client names, emails) is downloadable while logged out | `server/src/app.js` ~187 |
| Demo credential fallbacks | `password123` hash, committed API key, committed token secret used when env vars are missing | `server/src/server.js` ~42–49, `server/src/config.js` ~79–94 |
| Session cookie | `SameSite=Strict` — **the browser will NOT send it on the redirect back from Microsoft** | `server/src/services/sessionStore.js` `formatSessionCookie` |
| API token in browser | Trinova bearer token saved to `localStorage` | `scripts/services/api.js` ~56–63 |
| Idempotency keys | Generated with `Math.random()` per call; UI never reuses a key | `scripts/services/api.js` ~82 |
| Persistence | Runtime data lives in the in-memory `mockDb` object; restart loses everything | `server/src/data/db.js` |
| Tests | 139 passing; several assert the demo `password123` login works | `server/tests/unit01-auth-audit.test.js` (case 1.1.7) |
| Frontend tests | None | — |

Run `cd server && npm test` before changing anything and record the baseline count in `PROGRESS.md`.

---

## 2. Non-negotiable rules (violating any of these = task failed, regardless of tests)

1. **All Microsoft Graph calls happen server-side.** The browser never calls `graph.microsoft.com`
   and never receives a Microsoft token.
2. **Tokens (access and refresh) are stored server-side only, encrypted at rest** (AES-256-GCM,
   random 96-bit IV per write, auth tag verified on read), keyed to the owner's account
   (`actor_kirsty_allen`). The encryption key comes from an environment variable, never from the repo.
3. **Tokens must never appear in:** page source, `localStorage`, `sessionStorage`, any API response,
   any log line, any audit record, any error message, or any test output. Test this explicitly
   (see §6.3).
4. **No dashboard data is served to a logged-out request.** Every data route returns 401 without a
   valid session. The static HTML shell and JS bundle must contain **zero** client names, emails,
   diary entries, deadlines, or sample records.
5. **Remove the pre-filled login email everywhere** (placeholder, `defaultUser.email`, remember-me
   default). The login form starts empty.
6. **No API keys or credentials in any file served to the browser.** Remove the Trinova bearer token
   from `localStorage` (it must not be stored client-side at all in this phase).
7. **Remove the demo fallbacks.** If `SLON_OWNER_EMAIL`, `SLON_OWNER_PASSWORD_HASH`, the API key, or
   the token secret is missing, the server **refuses to start** with a message naming the variable
   (never printing a value). Remove the `password123` hash, the committed API keys, and the committed
   token secret from source. Update tests to generate their own bcrypt hash in a fixture.
8. **Never report "Connected" unless a live connection exists.** The status is computed from the
   stored connection record and a successful last Graph call, not hard-coded.
9. **Never fail silently.** Every failure maps to a visible state in the UI (see §4.4).
10. **Only the scopes in §3.2 are requested.** Any deviation must be recorded in `DECISIONS.md` and
    approved by a human checkpoint before it is implemented.
11. **Do not send, reply to, move, delete, or modify mail or calendar.** Read-only Graph calls only.
12. **Do not fabricate evidence.** A checkbox may only be ticked with a pasted command output,
    test name, or screenshot path in `docs/outlook-build/evidence/`.

---

## 3. Microsoft app registration and scopes

### 3.1 Human checkpoint H1 — app registration (the agent cannot do this)

If `docs/outlook-build/H1_app_registration.md` does not record a client ID, the agent writes
`BLOCKED.md` with these exact steps for Kirsty or her Microsoft 365 administrator, then stops:

1. Azure portal → **Microsoft Entra ID** → **App registrations** → **New registration**.
   - Name: `Sloane Command Centre`
   - Supported account types: **"Accounts in this organizational directory only"** if Kirsty's
     mailbox is in the Trinova Microsoft 365 tenant. Use "multitenant + personal" only if her
     mailbox is a personal Microsoft account.
   - Redirect URI, platform **Web**:
     - `http://localhost:4000/api/v1/integrations/outlook/callback` (development)
     - `https://<production-host>/api/v1/integrations/outlook/callback` (production)
2. **Certificates & secrets** → **New client secret**. Record the expiry date in `DECISIONS.md`
   (calendar reminder to rotate before it expires).
3. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** →
   add the scopes in §3.2.
4. If the tenant requires admin consent for these scopes, a tenant administrator must grant it.
   Record whether it was needed.
5. Provide the values to the server environment (never commit them):
   `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID` (`common` only for personal
   accounts; otherwise the tenant GUID), `OUTLOOK_REDIRECT_URI`, `OUTLOOK_TOKEN_ENC_KEY`
   (32 random bytes, base64; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

### 3.2 Scopes

Requested scopes (exactly these, unless a deviation is approved):

| Scope | Why |
|---|---|
| `offline_access` | Obtains a refresh token so the dashboard can sync without Kirsty signing in each time. |
| `Mail.Read` | Lists mail folders and reads flagged messages for the "Emails Sloane thinks need you" panel. |
| `Calendars.Read` | Reads today's calendar events for the diary panel. |

**Deviation to decide at checkpoint H2:** the brief asks for the account holder name and email
address. Those are not covered by the three scopes above. Two options:

- **Option A (recommended):** add `openid`, `profile`, `email`. These are identity scopes that grant
  no mailbox or calendar data access. The name and email come from the signed `id_token` claims
  (`name`, `preferred_username`), verified against the JWKS for the tenant. No extra Graph call.
- **Option B:** add `User.Read` and call `GET /me?$select=displayName,mail,userPrincipalName`.

Write the chosen option in `DECISIONS.md`. Do not proceed to §5 Phase 3 without it.

---

## 4. Required behaviour

### 4.1 Settings section — "Email & Calendar (Outlook)"

Add a new card in the Settings view. Keep the existing visual language (tokens in `styles/tokens.css`,
components in `styles/components.css`).

Fields and controls, in this order:

- **Status line**, one of:
  - `Not connected` (no connection record)
  - `Connected` (live record, last Graph call succeeded)
  - `Reconnect your Outlook` (refresh token rejected, `invalid_grant`, or consent revoked)
  - `Sync error — <short reason>` (transient Graph failure; show the last successful sync time)
- **Connected account**: email address, account holder name (from §3.2 option chosen), last sync time
  (absolute time in Europe/London plus relative, e.g. "12:04 — 3 min ago").
- **Button: `Connect Outlook account`** (shown when not connected or reconnect required). Starts the
  OAuth flow (§4.2).
- **Toggle: Email sync** (on/off, persisted server-side).
- **Toggle: Calendar (diary) sync** (on/off, persisted server-side).
- **Folder selection**: multi-select listing the account's mail folders (from `GET /me/mailFolders`).
  Default selection: `Inbox` only. Persisted server-side as folder IDs. Show the folder display names.
- **Button: `Sync now`** — runs an immediate sync of enabled sources; disabled while a sync runs.
- **Button: `Disconnect`** — opens a confirm dialog (use the existing modal component with focus trap).
  Dialog text must say: this deletes Sloane's copy of your Outlook access and clears diary and email
  data from the dashboard; to fully remove Sloane's access from your Microsoft account, use
  https://myapps.microsoft.com (or the link Microsoft shows under your account's connected apps).
  **Do not claim Microsoft has revoked anything.** Graph has no endpoint that revokes a single
  delegated refresh token; the honest behaviour is local deletion plus the link above.

### 4.2 OAuth 2.0 authorization code flow with PKCE

- `GET /api/v1/integrations/outlook/connect` (requires an active session). Generates:
  - `state` (32 random bytes, base64url)
  - `code_verifier` (43–128 chars, base64url) and `code_challenge` (S256)
  - `nonce` (if `openid` is requested)
  Stores `{ state → { verifier, nonce, actorId, createdAt } }` **in server memory with a 10-minute TTL,
  single use**. Responds with `302` to
  `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` with `response_type=code`,
  `response_mode=query`, `client_id`, `redirect_uri`, `scope` (space-separated, from §3.2),
  `state`, `code_challenge`, `code_challenge_method=S256`, `nonce` if applicable, `prompt=select_account`.
- `GET /api/v1/integrations/outlook/callback`:
  - **Must not require the session cookie.** `SameSite=Strict` cookies are not sent on the
    cross-site redirect from Microsoft. Identify the owner from the `state` entry (`actorId`), not from
    the cookie. Document this in `DECISIONS.md`.
  - Reject if `error` is present (user cancelled, consent denied) → redirect to the dashboard with a
    readable reason; never store anything.
  - Reject unknown, expired, or reused `state`.
  - Exchange `code` at `.../oauth2/v2.0/token` with `grant_type=authorization_code`, `code_verifier`,
    `client_secret`, `redirect_uri`. Timeout 10 s. Validate the response contains `refresh_token`
    (if not, `offline_access` was not granted → error state).
  - Validate `id_token` signature against the tenant JWKS (cache keys), `aud`, `iss`, `exp`, `nonce`
    (Option A) — or call Graph `/me` (Option B).
  - Persist the encrypted token bundle and a connection record (§5 Phase 2).
  - Redirect to the dashboard Settings section with `?outlook=connected`.
- Callback must be idempotent against double-clicks: a second identical callback with a consumed
  `state` returns a readable "This sign-in link was already used" message and changes nothing.

### 4.3 Data panels

- **Diary panel** (`GET /api/v1/outlook/diary?date=today`): `GET /me/calendarView` with
  `startDateTime`/`endDateTime` covering today in Europe/London, header
  `Prefer: outlook.timezone="GMT Standard Time"`, `$select=subject,start,end,location,isAllDay,showAs`,
  `$orderby=start/dateTime`. Map to the **existing** `DIARY_ITEMS` item shape so the existing renderer
  is unchanged. Keep the existing "clash" logic (`app.js` ~1208) working from real events, or remove
  the clash card if it cannot be derived from real data — record which in `DECISIONS.md`.
- **Flagged-email panel** (`GET /api/v1/outlook/flagged-emails`): for each selected folder,
  `GET /me/mailFolders/{id}/messages?$filter=flag/flagStatus eq 'flagged'&$select=subject,from,receivedDateTime,importance,webLink&$orderby=receivedDateTime desc&$top=25`.
  Merge, sort newest first, cap at 25. **Read the existing priority logic** in `app.js` (~855 and the
  `ATTENTION_EMAILS` rendering) and map Graph fields into the same `{ title, sub, priority }` shape
  using that logic (e.g. `importance: high` → `High`). Do not invent new priority rules.
- **Empty state** (not connected, or the relevant toggle is off): show exactly
  `Connect your Outlook to see this here` (or, for a switched-off source, `Calendar sync is off` /
  `Email sync is off`). Never show sample data as a fallback.
- Cache each user's Graph responses in memory for **2 minutes maximum**, keyed by actor and resource.
  Clear the cache on disconnect and on sync-now.

### 4.4 Token lifecycle and failure states

- Single-flight refresh: concurrent requests share one refresh promise per connection. Never fire
  two refreshes at once (Microsoft rotates refresh tokens).
- On a Graph `401` → refresh once and retry once. On refresh `invalid_grant` → set status to
  `reconnect_required`, stop calling Graph, and return `OUTLOOK_RECONNECT_REQUIRED`.
- On `429` or `503` → honour `Retry-After` (cap 60 s), then surface `Sync error — Microsoft is busy, try again shortly`.
- On network timeout (8 s per Graph call) → `Sync error — could not reach Microsoft`.
- Rotated refresh tokens must be re-encrypted and written atomically (write temp file, `fsync`,
  rename). A crash mid-write must not corrupt the vault.

---

## 5. Build plan (phases, tasks, done-criteria)

Each task has an ID. The loop works tasks in order. A task is done only when **every** done-criterion
has evidence in `docs/outlook-build/evidence/<ID>.txt`.

### Phase 0 — Baseline and decisions
- **P0.1** Create `docs/outlook-build/` with `PROGRESS.md` (checklist of every task ID here),
  `DECISIONS.md`, `evidence/`.
  Done: files exist; baseline `npm test` output recorded (expect 139 pass).
- **P0.2** Record decisions: identity option (§3.2 A or B), token store location (§5 P2.1), callback
  cookie handling (§4.2), revocation wording (§4.1), client-secret expiry date.
  Done: each decision has a one-line rationale and the human approval reference for H2.
- **P0.3** Take a baseline browser snapshot (screenshot + `view-source` text dump) of the current
  logged-out page to `evidence/baseline/`. Use Playwright if available; if Chromium cannot be
  installed, record the reason and use `curl` for the source dump.
  Done: baseline artifacts saved.

### Phase 1 — Security blockers that gate this feature
- **P1.1** Remove demo fallbacks (§2.7). Startup fails naming missing variables. Remove committed
  secrets from `config.js`, `server.js`, `signingService.js`. Update test 1.1.7 and any test that
  depends on `password123`; add a test fixture that generates a bcrypt hash at runtime.
  Done: `npm test` green; grep for `password123`, `tn_sec_live`, `tn_storage_secret`,
  `documenso_webhook_secret_hmac_2026`, `ch_test_server_key` returns **no** matches in `src/` or `scripts/`.
- **P1.2** Remove the login pre-fill (§2.5). Also remove the default-email fallback in
  `getRememberedEmail`. Remember-me may store the email only after a successful login.
  Done: page source contains no `kirsty` string; a test or Playwright assertion checks the field is empty.
- **P1.3** Make the logged-out shell data-free. Strip all client names, amounts, deadlines, and
  sample rows from `index.html`; the dashboard markup is populated only after a session check.
  Done: `curl -s http://localhost:4000/ | grep -iE "woofington|jenkins|alpha delta|cfi|R GB|@|kirsty"` returns nothing.
- **P1.4** Stop serving `scripts/data/` publicly. Move `seed.js` out of the static tree (or delete it
  if the standalone adapter is removed). Update the static whitelist in `server/src/app.js` so
  `scripts/data/` returns 404 anonymously. Remove sample Outlook events from `server/src/data/db.js`.
  Done: `curl -i http://localhost:4000/scripts/data/seed.js` → 404; logged-out `curl` of every static
  file contains no personal data (see §6.1 script).
- **P1.5** Remove the Trinova bearer token from `localStorage` (`scripts/services/api.js`). The API
  calls use the session cookie only. Remove the `sloane_anthropic_api_key` cleanup logic if it is
  no longer needed.
  Done: after login and a full page exercise, `localStorage` and `sessionStorage` contain no key whose
  value looks like a token (test asserts keys ⊆ an allowlist of UI preferences).
- **P1.6** Mark the `/api/v1/test/mutate` endpoint dev-only (mount only when `NODE_ENV !== 'production'`).
  Done: route returns 404 in production mode.

### Phase 2 — Encrypted token vault and connection store
- **P2.1** Implement `server/src/services/outlookVault.js`:
  - `encrypt(plaintext) / decrypt(blob)` with AES-256-GCM. Output `{ v:1, iv, tag, ct }` base64.
  - Key from `OUTLOOK_TOKEN_ENC_KEY`; refuse to start the Outlook feature if it is missing or not 32 bytes
    (the rest of the server still starts; the Outlook status shows `not_configured`).
  - File path from `OUTLOOK_VAULT_PATH` (default `server/data-private/outlook-vault.json`). That
    directory is **outside** the static root and listed in `.gitignore`. Create with mode `0700`; file
    `0600`.
  - Atomic writes (temp file, `fsync`, rename).
  Done: tests for round-trip, tampered ciphertext rejected, wrong key rejected, file contents contain
  no plaintext substring of a known test token, file mode `0600`.
- **P2.2** Connection record schema (stored encrypted with the tokens, single record for the owner):
  `{ actorId, status: 'connected'|'reconnect_required'|'error', accountEmail, displayName, tenantId,
  scopes[], refreshToken, accessToken, accessTokenExpiresAt, emailSyncEnabled, calendarSyncEnabled,
  mailFolderIds[], connectedAt, lastSyncAt, lastError }`.
  Done: repository functions `getConnection/saveConnection/deleteConnection`, unit-tested.

### Phase 3 — OAuth connect and callback
- **P3.1** PKCE + state store with TTL and single use (§4.2). Unit tests: expiry, reuse, unknown state.
- **P3.2** `GET .../connect` (session required) and `GET .../callback` (no cookie required, state-bound).
  Use a mocked Microsoft token endpoint in tests (inject `fetch`). Cover: success, user-denied `error`,
  missing `refresh_token`, bad `id_token` signature, expired state, replayed callback, token endpoint 500.
  Done: all paths tested; success path stores encrypted bundle and sets `status: connected`.
- **P3.3** Option A: JWKS fetch with cache and `id_token` verification. Option B: `GET /me`. Record which.

### Phase 4 — Graph client and token lifecycle
- **P4.1** `server/src/services/graphClient.js`: `get(path, {headers, timeoutMs})`, base
  `https://graph.microsoft.com/v1.0`, bearer from the vault, single-flight refresh, one retry on 401,
  `invalid_grant` → `reconnect_required`, 429/503 handling, 8 s timeout. Inject `fetch` for tests.
  Done: tests for each branch in §4.4, including concurrent-refresh test (one refresh call for N parallel
  requests) and rotated-refresh-token persistence.
- **P4.2** Add Outlook-specific logging hygiene: extend `sanitizer.js` redaction keys with
  `access_token`, `refresh_token`, `id_token`, `client_secret`, `code_verifier`. Done: a unit test logs
  an object containing those keys and asserts `[REDACTED]`.

### Phase 5 — Settings API
- **P5.1** `GET /api/v1/integrations/outlook/status` → `{ status, accountEmail, displayName, lastSyncAt,
  lastError, emailSyncEnabled, calendarSyncEnabled, mailFolderIds, scopes }`. **Never** includes tokens.
- **P5.2** `PATCH /api/v1/integrations/outlook/settings` → validates booleans and that `mailFolderIds`
  are real folder IDs (fetched from Graph). Empty folder list is rejected with `422`.
- **P5.3** `GET /api/v1/integrations/outlook/folders` → `[{ id, displayName, unreadItemCount }]`.
- **P5.4** `POST /api/v1/integrations/outlook/sync` → runs enabled sources now; returns counts and
  `lastSyncAt`; `409` if a sync is already running.
- **P5.5** `POST /api/v1/integrations/outlook/disconnect` → deletes the vault record, clears the
  in-memory Graph cache, sets status `not_connected`; returns the wording from §4.1 for the UI.
  Done: after disconnect, `grep -c refresh_token` on the vault file is 0 (or the file is removed when
  empty), and the next diary/flagged call returns `OUTLOOK_NOT_CONNECTED`.
- **P5.6** CSRF for all state-changing routes (`connect` is GET but redirects only; `settings`,
  `sync`, `disconnect` are POST/PATCH): require `Origin` to match an allowed origin **and** a custom
  header `X-Requested-With: sloane`. Done: test rejects a missing or foreign Origin with 403.

### Phase 6 — Data endpoints
- **P6.1** `GET /api/v1/outlook/diary` and `GET /api/v1/outlook/flagged-emails` per §4.3. Both require
  session; both return the empty-state code when not connected or when the toggle is off.
- **P6.2** Mapping functions are pure and unit-tested with fixture Graph responses. Include a fixture
  with a subject containing `<script>` to prove the frontend escapes it (frontend test in Phase 7).
- **P6.3** Keep the per-user 2-minute cache (§4.3). Test that a disconnect clears it.

### Phase 7 — Frontend
- **P7.1** Settings card per §4.1. Render every state: not connected, connected, reconnect required,
  sync error, syncing, disconnected-after-confirm. Use `escapeHtml` for every server string.
- **P7.2** Command Centre: remove the hard-coded `Outlook Connected` label (index ~238), the static
  `Connected` pill (index ~316), and the `DIARY_ITEMS` / `ATTENTION_EMAILS` reads. The panels call the
  new endpoints after session check and render the existing markup with real data or the empty state.
  The "Outlook Radar" pill shows only when connected.
- **P7.3** Remove every remaining import of demo arrays from the UI path if they are no longer used
  (`DIARY_ITEMS`, `ATTENTION_EMAILS`, `WAITING_SIGNOFF`, `TOP3_ITEMS`, `PEOPLE_WORK`, etc.). If a panel
  such as "Waiting for signoff" still needs data, it must come from the API or show its empty state —
  never sample rows. List every removal in `DECISIONS.md`.
- **P7.4** Keep Client 360, Add Business Area, CEO Brain and Ask Sloane working against the API
  (`/api/v1/clients`, `/api/v1/companies/:id/notes`, `/api/v1/ai/ask`, etc.). Where the frontend
  currently uses local seed data for these, switch to the API. This is the largest-risk item; split it
  into sub-tasks in `PROGRESS.md` and verify each by hand in the browser.
- **P7.5** Disconnect confirm dialog and reconnect banner (use `ModalManager`; ESC closes; focus trapped).

### Phase 8 — Verification and report
- **P8.1** Automated: `cd server && npm test` green. Add a frontend smoke test (Playwright or a
  DOM-level test) for: empty login field, logged-out view contains no personal data, the Settings
  states render.
- **P8.2** Run the §6 verification script and save output to `evidence/P8.2.txt`.
- **P8.3** Human checkpoint H3: Kirsty connects her real account, verifies diary and flagged emails,
  disconnects, and confirms the empty state. The agent prepares `docs/outlook-build/H3_checklist.md`
  and stops.
- **P8.4** Produce the final report (§8).

---

## 6. Verification

### 6.1 Logged-out leak check (run in a fresh process with no cookies)

```bash
# Start with NO sample data reachable and real secrets supplied via env
BASE=http://localhost:4000
for path in / /index.html /scripts/app.js /scripts/services/api.js /scripts/services/auth.js \
            /scripts/data/seed.js /styles/views.css /api/v1/clients /api/v1/tasks \
            /api/v1/outlook/diary /api/v1/outlook/flagged-emails /api/v1/integrations/outlook/status; do
  code=$(curl -s -o /tmp/body -w "%{http_code}" "$BASE$path")
  hits=$(grep -ciE "woofington|jenkins|alpha delta|cfi awarding|rgb elevations|@[a-z0-9.-]+\.(co\.uk|com|org)|refresh_token|access_token|client_secret|password123|tn_sec_|documenso_webhook" /tmp/body)
  echo "$path  status=$code  sensitive_hits=$hits"
done
```
Expected: every `sensitive_hits=0`. `/scripts/data/seed.js` must be 404. The `/api/v1/*` routes must
return 401 (not data). Save the output to `evidence/P8.2_logged_out.txt`.

### 6.2 Token-leak check (after a real or simulated connection)

Use a fake token bundle with recognisable values (`FAKE_ACCESS_9f3c`, `FAKE_REFRESH_9f3c`). Call every
endpoint in §5 and grep every response body, every response header, the server log, and the browser's
`localStorage`/`sessionStorage`/page source for those strings. Expected: zero matches everywhere.

### 6.3 Vault-at-rest check

`grep -c "FAKE_REFRESH" server/data-private/outlook-vault.json` → `0`. `stat -c %a` → `600`.

### 6.4 Browser acceptance (Playwright, incognito / new context every time)

Automate what can be automated; the connect step against Microsoft is a human checkpoint.

---

## 7. Acceptance checklist (from Kirsty — every item must be verified, not assumed)

- [ ] **Logged-out:** only the login screen loads. `view-source` and the `curl` script in §6.1 show no emails,
      diary entries, client data, tokens, or keys. Login field is empty.
- [ ] **Connect:** Kirsty connects her own Outlook account herself (checkpoint H3). The Settings section shows
      her address, account holder name, connection status, and last sync time.
- [ ] **Controls:** she can toggle email sync, toggle calendar sync, change the mail folder selection, and
      press Sync now. Each change persists across a page reload and a server restart.
- [ ] **Disconnect:** clears the connection, deletes the tokens (verify with §6.3), and the diary and
      flagged-email panels show `Connect your Outlook to see this here`. The confirm dialog gives the
      myapps.microsoft.com instruction and does not claim Microsoft revoked access.
- [ ] **Reconnect:** after a revoked or expired token, the status shows `Reconnect your Outlook`; nothing
      fails silently. (Simulate by removing the app consent in Microsoft, or by corrupting the refresh
      token in a test vault.)
- [ ] **Real data:** after reconnecting, her real diary events for today and her real flagged emails appear.
      Compare the first three items against Outlook by eye and record the comparison in evidence.
- [ ] **No demo data:** no sample emails, diary events, or "Connected" badges exist anywhere in the UI.
- [ ] **Existing features still work:** Client 360 (add client, add event, add note), Add Business Area,
      CEO Brain notes, Ask Sloane. Each verified in the browser with evidence.
- [ ] **Tests:** `npm test` green; new tests for vault, OAuth, Graph client, settings, data endpoints.

---

## 8. Final report format (the agent must produce this, nothing less)

1. **What was built** — one line per phase task ID with status (done / blocked / deferred).
2. **App-registration scopes used** — the exact list, plus the identity option chosen (A or B) and why.
   State whether admin consent was required.
3. **Deviations and decisions** — link to `DECISIONS.md`.
4. **Security checks** — the outputs of §6.1, §6.2, §6.3, with pass/fail.
5. **Test results** — `npm test` pass/fail counts before and after.
6. **Screenshots** (taken in an incognito/new browser context, saved in `docs/outlook-build/screenshots/`):
   - (a) logged-out state (login screen only)
   - (b) new Outlook settings section in its **connected** state (her account; the address may be
     masked as `k••••@trinova.co.uk` in the screenshot, with the unmasked value verified by H3)
   - (c) the **empty state** after disconnect (diary and flagged-email panels)
   If a screenshot cannot be taken (no browser, no real account), say so explicitly and list it under
   BLOCKED. Do not substitute a mock.
7. **Known gaps and risks** — including: client-secret expiry date, the fact that Microsoft-side consent
   must be removed manually by the user, in-memory OAuth state limits (single-instance only), and the
   persistence limitation of the `mockDb` store for everything other than the token vault.

---

## 9. Loop protocol (how the agent runs each iteration)

Repeat until §7 is fully ticked or a BLOCKED condition is reached:

1. **Read state.** Open `docs/outlook-build/PROGRESS.md` and `DECISIONS.md`. Do not rely on memory of
   earlier iterations.
2. **Pick one task.** The first unchecked task whose dependencies are checked. One task per iteration.
3. **Plan in writing** (3–6 lines in `evidence/<ID>.txt`): files to touch, tests to add, the done-criteria.
4. **Implement** in the smallest diff that satisfies the done-criteria. Do not refactor unrelated code.
5. **Test.** Run `cd server && npm test`. Run the §6 check relevant to the task. If anything fails,
   fix within the same iteration, up to **3 attempts**.
6. **Prove.** Paste the command output (or test names) into `evidence/<ID>.txt`. Take a screenshot if
   the task is visual.
7. **Tick** the task in `PROGRESS.md` only if every done-criterion has evidence. Otherwise leave it
   unchecked and note what remains.
8. **Stop conditions.**
   - **BLOCKED** (write `docs/outlook-build/BLOCKED.md` with the exact human action needed, then stop):
     H1 app registration missing; H2 scope/identity decision not approved; H3 real-account step needed;
     a required Microsoft endpoint unreachable from the environment; the same task failed 3 times.
   - **DONE** only when §7 is fully ticked and §8 is written.
9. **Never** weaken a test to make it pass, delete a failing test, skip a check, or tick a box without
   evidence. If a test encodes the old insecure behaviour (for example, a demo password login), update
   it to the new behaviour and record why in `DECISIONS.md`.

### Out of scope for this loop (log these in `PROGRESS.md` under "Found, not fixed")

These were found in the audit and must not be silently changed here. Only fix one if it blocks an
acceptance item, and say so in evidence:

- Staff-only notes are copied into the client timeline as `shared` events (`communications.js` ~273,
  `timelineService.js` ~135). This is a serious privacy issue and should be its own loop.
- The client UI hard-codes `confirm_write_to_trinova: true` (`api.js` ~554), defeating the opt-in check.
- Company notes and timeline text are sent to third-party AI providers (`contextBuilder.js`).
- Session cookies are `SameSite=Strict` for all routes (the callback in this loop works around it, but
  consider `Lax` for the session cookie as a separate decision).
- Audit IP is always `127.0.0.1` (`audit.js` ~68).
- Uploaded documents are written to `server/storage/documents`, not the mounted volume
  (`storageDriver.js` ~22; compose sets `STORAGE_ROOT_PATH`, which no code reads).
- Frontend and backend disagree on query parameters (`q` vs `search`, `type` vs `biz`) and on the
  client record shape, so list search and risk/company-number columns are wrong.
- `mockDb` is in-memory; only the Outlook token vault persists in this loop.
- Non-retryable 4xx errors from Companies House are retried (`companiesHouse.js` ~250).
- Idempotency keys use `Math.random()` and are regenerated on each click.

---

## 10. Quick reference

| Item | Value |
|---|---|
| Connect endpoint | `GET /api/v1/integrations/outlook/connect` (session) |
| OAuth callback | `GET /api/v1/integrations/outlook/callback` (state-bound, no cookie) |
| Status | `GET /api/v1/integrations/outlook/status` |
| Settings | `PATCH /api/v1/integrations/outlook/settings` |
| Folders | `GET /api/v1/integrations/outlook/folders` |
| Sync now | `POST /api/v1/integrations/outlook/sync` |
| Disconnect | `POST /api/v1/integrations/outlook/disconnect` |
| Diary | `GET /api/v1/outlook/diary?date=today` |
| Flagged emails | `GET /api/v1/outlook/flagged-emails` |
| Microsoft authorize | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` |
| Microsoft token | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` |
| Graph base | `https://graph.microsoft.com/v1.0` |
| Env vars (new) | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID`, `OUTLOOK_REDIRECT_URI`, `OUTLOOK_TOKEN_ENC_KEY`, `OUTLOOK_VAULT_PATH` |
| Scopes | `offline_access`, `Mail.Read`, `Calendars.Read` (+ `openid profile email` **or** `User.Read` per H2) |
| Vault file | `server/data-private/outlook-vault.json` (mode 0600, gitignored, outside static root) |
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-20T18:25:36+05:00.

The user's current state is as follows:
Active Document: d:\V2\Sloane_Trinova_Integration\package.json (LANGUAGE_JSON)
Cursor is on line: 1
Other open documents:
- d:\V2\Sloane_Trinova_Integration\Sloane\server\src\routes\tasks.js (LANGUAGE_JAVASCRIPT)
- d:\V2\Sloane_Trinova_Integration\Sloane\server\src\routes\clients.js (LANGUAGE_JAVASCRIPT)
- d:\V2\Sloane_Trinova_Integration\Sloane\server\src\data\db.js (LANGUAGE_JAVASCRIPT)
- d:\V2\Sloane_Trinova_Integration\server\tests\unit01-auth-audit.test.js (LANGUAGE_JAVASCRIPT)
- d:\V2\Sloane_Trinova_Integration\Sloane\index.html (LANGUAGE_HTML)
</ADDITIONAL_METADATA>