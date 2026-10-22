# Human Checkpoint H3 Acceptance Checklist

> **Purpose:** Step-by-step verification protocol for Kirsty Allen to connect her real Microsoft 365 / Outlook account, inspect live Command Centre synchronization, test privacy controls, execute token-purging disconnect, and confirm non-interference with existing core features.
> **Reference:** `docs/outlook-build/SPEC.md` §7, `context/05_data_security_context.md`, `context/06_testing_deployment_context.md`.

---

## Pre-Flight Status & Security Baseline

Before beginning human testing, verify the automated baseline is completely green:

- [x] **Full Automated Regression:** `npm test` in `server/` passes 100% (**443/443 tests across 105 suites**, 0 failing).
- [x] **Frontend Smoke Tests (`P8.1`):** Passed (18/18 tests in `unit30-frontend-smoke.test.js`).
- [x] **Logged-Out Leak Check (`P8.2`):** Passed (§6.1 verification script confirms `sensitive_hits=0` across all 12 endpoints).
- [x] **Static Shell Hygiene:** Zero literal `@` symbols and zero client entity names (`woofington`, `jenkins`, `alpha delta`, `cfi awarding`, `rgb elevations`) in unauthenticated assets.
- [x] **Storage Hygiene:** Zero tokens stored in browser `localStorage` or `sessionStorage`. All tokens AES-256-GCM encrypted in `server/data-private/outlook-vault.json`.

---

## Test Execution Protocol

### Step 1: Logged-Out Boundary & Authentication
1. Open a clean private/incognito browser window and navigate to `http://localhost:4000` (or staging URL).
2. **Verify Login Form:**
   - [ ] Executive Email Address field (`#loginEmail`) is completely empty.
   - [ ] No pre-filled email, no pre-filled password, no demo credentials chip.
   - [ ] Placeholder reads generic text (`Corporate email address`).
3. **Execute Login:**
   - Enter your CEO executive credentials and submit.
   - Confirm Command Centre dashboard loads cleanly.

---

### Step 2: Unconnected Empty States
1. **Inspect Command Centre Top Bar & Panels:**
   - [ ] Top bar eyebrow dot is grey, displaying `Private CEO Command Centre` (does NOT say "Outlook Connected").
   - [ ] **Today's Diary panel:** displays honest §4.3 empty state:  
     `Connect your Outlook to see this here` with a direct connect link.
   - [ ] **Emails Sloane Thinks Need You panel:** displays honest §4.3 empty state:  
     `Connect your Outlook to see this here`.
   - [ ] The `Outlook Radar` badge (`#emailsRadarPill`) is hidden.
2. **Inspect Settings View:**
   - Click **Settings** in the left sidebar navigation (`#nav-settings`).
   - [ ] Outlook Settings Card displays status badge: `Not connected` (grey pill).
   - [ ] Card explains AES-256-GCM encryption and read-only scope boundaries.
   - [ ] Displays `🔗 Connect Outlook account` action button.
   - [ ] Toggles for email/calendar sync and folder selections are NOT rendered.
   - [ ] Disconnect button is NOT rendered.

---

### Step 3: Live Account Connection (OAuth PKCE)
1. In the Outlook Settings Card, click **🔗 Connect Outlook account**.
2. **Microsoft Authentication:**
   - [ ] Browser redirects to Microsoft official authentication portal (`https://login.microsoftonline.com/...`).
   - [ ] Log in with your corporate account (`kirsty.allen@trinova.co.uk` or your designated test account).
   - [ ] Review requested permissions:
     - `offline_access` (maintain access)
     - `Mail.Read` (read attention emails)
     - `Calendars.Read` (read diary schedule)
     - `openid`, `profile`, `email` (identity verification)
   - [ ] Click **Accept** to authorize access.
3. **Post-Connection Return:**
   - [ ] Browser redirects back to Sloane at `/index.html?outlook=connected`.
   - [ ] Green success notification appears: `Outlook account connected successfully.`
   - [ ] Query string `?outlook=connected` is cleanly scrubbed from the browser URL bar.

---

### Step 4: Verify Settings Card Post-Connect
Inspect the Outlook Settings Card in the Settings view:
- [ ] Status badge displays green: **Connected**.
- [ ] **Connected Account:** displays your email address and account display name.
- [ ] **Last Synchronized:** displays accurate London time and relative minutes (e.g. `12:04 — just now`).
- [ ] **Email sync toggle:** rendered and enabled (checked).
- [ ] **Calendar (diary) sync toggle:** rendered and enabled (checked).
- [ ] **Monitored Mail Folders:** lists folders from your live account (e.g. `Inbox`, `Archive`) with unread count badges.
- [ ] **Action Buttons:** `🔄 Sync now` and `Disconnect` buttons are rendered and clickable.

---

### Step 5: Verify Live Data in Command Centre
Navigate to **Command Centre** (`#nav-overview`):
1. **Eyebrow Status:**
   - [ ] Eyebrow dot turns green with label: `Private CEO Command Centre · Outlook Connected`.
2. **Today's Diary Panel:**
   - [ ] `#diaryStatusPill` shows green `Connected` pill.
   - [ ] Displays your real calendar meetings scheduled for today.
   - [ ] Meeting times, titles, locations, and attendee counts are accurate.
   - [ ] If any meetings overlap, a collision warning badge appears.
   - **Eye-Check Comparison (First 3 Diary Items):**
     * Item 1: `________________________________________________` [Matches Outlook: Yes/No]
     * Item 2: `________________________________________________` [Matches Outlook: Yes/No]
     * Item 3: `________________________________________________` [Matches Outlook: Yes/No]
3. **Emails Sloane Thinks Need You Panel:**
   - [ ] `#emailsRadarPill` shows green badge (`Flagged Radar`).
   - [ ] Displays your real flagged messages from monitored folders.
   - [ ] Senders, subject lines, received timestamps, and importance tags are accurate.
   - **Eye-Check Comparison (First 3 Flagged Emails):**
     * Email 1: `________________________________________________` [Matches Outlook: Yes/No]
     * Email 2: `________________________________________________` [Matches Outlook: Yes/No]
     * Email 3: `________________________________________________` [Matches Outlook: Yes/No]
4. **Pulse Metrics:**
   - [ ] `#pulseEmails` reflects the count of your real flagged attention emails.

---

### Step 6: Test Controls, Toggles & Manual Sync
1. Return to **Settings**:
   - [ ] **Toggle Email sync OFF:**
     - Navigate to Command Centre -> Attention emails panel shows `Email sync is off`.
   - [ ] **Toggle Email sync ON:**
     - Attention emails re-render live.
   - [ ] **Toggle Calendar sync OFF:**
     - Navigate to Command Centre -> Diary panel shows `Calendar sync is off`.
   - [ ] **Toggle Calendar sync ON:**
     - Diary events re-render live.
2. **Folder Selection:**
   - [ ] Deselect/select a folder checkbox -> change is saved via `PATCH /settings`.
   - [ ] Try deselecting all folders -> error notification displays: `At least one mail folder must be selected for email sync`, and checkbox reverts.
3. **Manual "Sync now":**
   - [ ] Click `🔄 Sync now` button.
   - [ ] Button immediately disables and displays `⏳ Syncing...`.
   - [ ] Success notification appears: `Outlook synchronization completed.`
   - [ ] Last Synchronized timestamp updates.
4. **Persistence Across Reload & Restart:**
   - [ ] Hard refresh page (`Ctrl+F5` / `Cmd+Shift+R`) -> verify connection and settings remain intact.

---

### Step 7: Test Disconnect Confirmation & Token Purge
1. In Settings, click **Disconnect**.
2. **Accessible Dialog Verification (`#outlookDisconnectModal`):**
   - [ ] Dialog opens with accessible modal backdrop.
   - [ ] Body background scroll is locked.
   - [ ] Press `Tab` / `Shift+Tab` -> focus stays trapped within the modal buttons and links.
   - [ ] Press `Escape` key -> modal closes immediately, restoring focus to Disconnect button.
   - [ ] Click Disconnect again -> click backdrop overlay -> modal closes.
3. **Revocation Guidance Copy Verification:**
   - [ ] Open modal again and verify exact text:  
     *"This deletes Sloane's copy of your Outlook access and clears diary and email data from the dashboard; to fully remove Sloane's access from your Microsoft account, use https://myapps.microsoft.com (or the link Microsoft shows under your account's connected apps)."*
   - [ ] Confirm the text **never** claims Microsoft has already revoked access.
4. **Execute Disconnect:**
   - [ ] Click **Disconnect Account** button.
   - [ ] Button disables during transit showing `Disconnecting...`.
   - [ ] Modal closes.
   - [ ] Post-revocation guidance banner renders with clickable link to `https://myapps.microsoft.com`.
   - [ ] Settings Card resets to **Not connected**.
5. **Verify Post-Disconnect Command Centre:**
   - [ ] Eyebrow dot returns to grey `Private CEO Command Centre`.
   - [ ] Diary panel displays `Connect your Outlook to see this here`.
   - [ ] Flagged emails panel displays `Connect your Outlook to see this here`.
   - [ ] Server-side check: `server/data-private/outlook-vault.json` is purged (0 residual tokens).

---

### Step 8: Reconnect & Reconnect Banner Test
1. In Settings, click **🔗 Connect Outlook account** and reconnect your account.
2. Verify live data reappears.
3. **Simulate Expired/Revoked Token:**
   - (Or corrupt refresh token in test vault):
   - [ ] When API returns `reconnect_required`, Command Centre displays `#outlookReconnectBanner` with warning icon, direct Reconnect link, and dismiss button.
   - [ ] Top bar eyebrow dot turns red: `Private CEO Command Centre · Outlook Reconnect Required`.
   - [ ] Settings card shows red pill: `Reconnect your Outlook`.
   - [ ] Clicking Reconnect initiates OAuth refresh; clicking Dismiss hides the banner.

---

### Step 9: Existing Features Verification (Zero Regression)
Verify that all existing Sloane features continue working normally:
1. **Client 360:**
   - [ ] Click `+ New Client` -> create a test client -> verifies in list and database.
   - [ ] Open client timeline -> click `+ Log Event` -> event renders in timeline.
   - [ ] Click `+ Add Note` -> note persists and renders with honest empty state handling.
2. **Business Areas:**
   - [ ] Click `Add Business Area` -> create a business area -> verify client count and select dropdowns refresh.
3. **CEO Brain & Privacy Boundary:**
   - [ ] Type a note in CEO Brain and save -> confirms `🔒 Private Workspace · CEO View`.
   - [ ] Verify private notes are strictly excluded from AI prompts and API summaries (`PRIVATE_CEO_BRAIN = DENY`).
   - [ ] Click `Send to Trinova ↗` -> verify confirmation modal requires explicit checkbox check before sending.
4. **Ask Sloane AI Assistant:**
   - [ ] Query general question (e.g. `What is 2 + 2?`) -> direct answer.
   - [ ] Query practice intelligence -> responses cite verified client records with provenance badges (`Claude`, `Gemini`, or `Deterministic Engine`).
   - [ ] Output is properly HTML-escaped with zero script injection vulnerabilities.

---

## Stakeholder Sign-Off

| Role | Name | Signature / Confirmation | Date |
| :--- | :--- | :--- | :--- |
| **Managing Partner / CEO** | Kirsty Allen | `[ PENDING H3 EXECUTION ]` | `YYYY-MM-DD` |
| **Integration Lead** | Hamza Malik | `[ PENDING H3 EXECUTION ]` | `YYYY-MM-DD` |

---
