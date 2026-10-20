# Outlook Build Progress Tracker

Baseline tests: 139 passing across 19 suites (0 failing, 0 skipped, duration 14.76s).

## Phase 0 — Baseline and decisions
- [x] **P0.1** Create `docs/outlook-build/` with `PROGRESS.md` (checklist of every task ID here), `DECISIONS.md`, `evidence/`. Baseline `npm test` recorded.
- [x] **P0.2** Record decisions: identity option (§3.2 A or B), token store location (§5 P2.1), callback cookie handling (§4.2), revocation wording (§4.1), client-secret expiry date.
- [x] **P0.3** Take a baseline browser snapshot (screenshot + `view-source` text dump) of the current logged-out page to `evidence/baseline/`.

## Phase 1 — Security blockers that gate this feature
- [x] **P1.1** Remove demo fallbacks (§2.7). Startup fails naming missing variables. Remove committed secrets from `config.js`, `server.js`, `signingService.js`. Update test 1.1.7 and any test that depends on `password123`; add a test fixture that generates a bcrypt hash at runtime.
- [x] **P1.2** Remove the login pre-fill (§2.5). Also remove the default-email fallback in `getRememberedEmail`. Remember-me may store the email only after a successful login.
- [x] **P1.3** Make the logged-out shell data-free. Strip all client names, amounts, deadlines, and sample rows from `index.html`; the dashboard markup is populated only after a session check.
- [x] **P1.4** Stop serving `scripts/data/` publicly. Move `seed.js` out of the static tree (or delete it if the standalone adapter is removed). Update the static whitelist in `server/src/app.js` so `scripts/data/` returns 404 anonymously. Remove sample Outlook events from `server/src/data/db.js`.
- [x] **P1.5** Remove the Trinova bearer token from `localStorage` (`scripts/services/api.js`). The API calls use the session cookie only. Remove the `sloane_anthropic_api_key` cleanup logic if it is no longer needed.
- [x] **P1.6** Mark the `/api/v1/test/mutate` endpoint dev-only (mount only when `NODE_ENV !== 'production'`).

## Phase 2 — Encrypted token vault and connection store
- [x] **P2.1** Implement `server/src/services/outlookVault.js` (AES-256-GCM, atomic writes, `0600` permissions, key validation).
- [ ] **P2.2** Connection record schema (`getConnection/saveConnection/deleteConnection`, unit-tested).

## Phase 3 — OAuth connect and callback
- [ ] **P3.1** PKCE + state store with TTL and single use (§4.2). Unit tests: expiry, reuse, unknown state.
- [ ] **P3.2** `GET .../connect` (session required) and `GET .../callback` (no cookie required, state-bound).
- [ ] **P3.3** Option A: JWKS fetch with cache and `id_token` verification. Option B: `GET /me`.

## Phase 4 — Graph client and token lifecycle
- [ ] **P4.1** `server/src/services/graphClient.js` (bearer from vault, single-flight refresh, retry on 401, error handling).
- [ ] **P4.2** Add Outlook-specific logging hygiene: extend `sanitizer.js` redaction keys with `access_token`, `refresh_token`, `id_token`, `client_secret`, `code_verifier`.

## Phase 5 — Settings API
- [ ] **P5.1** `GET /api/v1/integrations/outlook/status`.
- [ ] **P5.2** `PATCH /api/v1/integrations/outlook/settings`.
- [ ] **P5.3** `GET /api/v1/integrations/outlook/folders`.
- [ ] **P5.4** `POST /api/v1/integrations/outlook/sync`.
- [ ] **P5.5** `POST /api/v1/integrations/outlook/disconnect`.
- [ ] **P5.6** CSRF protection for all state-changing routes (`Origin` + `X-Requested-With: sloane`).

## Phase 6 — Data endpoints
- [ ] **P6.1** `GET /api/v1/outlook/diary` and `GET /api/v1/outlook/flagged-emails`.
- [ ] **P6.2** Pure mapping functions with fixture unit tests (including XSS escaping fixture).
- [ ] **P6.3** Per-user 2-minute in-memory cache cleared on disconnect and sync-now.

## Phase 7 — Frontend
- [ ] **P7.1** Settings card per §4.1 (states: not connected, connected, reconnect required, sync error, syncing, disconnected).
- [ ] **P7.2** Command Centre: remove hard-coded labels/pills, fetch live data from new endpoints.
- [ ] **P7.3** Remove remaining imports of demo arrays from the UI path.
- [ ] **P7.4** Keep interactive features working against the API:
  - [ ] **P7.4.1** Client 360 (add client, add event, add note)
  - [ ] **P7.4.2** Add Business Area
  - [ ] **P7.4.3** CEO Brain notes
  - [ ] **P7.4.4** Ask Sloane
- [ ] **P7.5** Disconnect confirm dialog and reconnect banner (`ModalManager`, ESC closes, focus trapped).

## Phase 8 — Verification and report
- [ ] **P8.1** Automated regression and frontend smoke tests.
- [ ] **P8.2** Logged-out leak check (§6.1 script).
- [ ] **P8.3** Human checkpoint H3: Kirsty connects real account.
- [ ] **P8.4** Final report (§8).

---

## Out of scope for this loop (Found, not fixed)
- Staff-only notes are copied into the client timeline as `shared` events (`communications.js` ~273, `timelineService.js` ~135).
- The client UI hard-codes `confirm_write_to_trinova: true` (`api.js` ~554), defeating the opt-in check.
- Company notes and timeline text are sent to third-party AI providers (`contextBuilder.js`).
- Session cookies are `SameSite=Strict` for all routes.
- Audit IP is always `127.0.0.1` (`audit.js` ~68).
- Uploaded documents are written to `server/storage/documents`, not the mounted volume (`storageDriver.js` ~22).
- Frontend and backend disagree on query parameters (`q` vs `search`, `type` vs `biz`) and on the client record shape.
- `mockDb` is in-memory; only the Outlook token vault persists in this loop.
- Non-retryable 4xx errors from Companies House are retried (`companiesHouse.js` ~250).
- Idempotency keys use `Math.random()` and are regenerated on each click.
