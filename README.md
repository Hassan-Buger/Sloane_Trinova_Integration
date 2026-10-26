# Sloane — Private CEO Dashboard for TriNova Accounting

Sloane is Kirsty Allen's private dashboard. It shows her clients (read live from TriNova), deadlines, tasks, her team,
her calendar and flagged emails (read from Outlook), and her own private notes — and, wherever it makes sense, lets her
**add, change and delete** things herself instead of only looking at them.

- **Front end:** plain JavaScript (ES modules) and CSS, no build step (`index.html`, `scripts/`, `styles/`).
- **Back end:** Node.js (no framework) in `server/src`, serving the API under `/api/v1` and the front end from the same address.
- **Saved data:** a real database (SQLite file, or Postgres). Nothing is lost when the server restarts.

---

## 1. What Sloane reads, and what it saves itself

| Source | What Sloane does with it |
|---|---|
| **TriNova portal** (clients) | **Reads only.** Never changes anything in TriNova. Needs `TRINOVA_API_KEY`. |
| **Outlook** (calendar, flagged emails) | **Reads only.** Never sends, deletes or changes mail or meetings. |
| **Companies House** | **Reads only** (checks filing dates). Needs `COMPANIES_HOUSE_API_KEY`. |
| **Sloane's own database** | Everything the owner adds here: businesses, clients added by hand, tasks, team, deadlines, VAT returns, client notes, documents, history entries, signing records and private notes. |

---

## 2. Run it on your own computer

You need **Node.js 22.13 or newer** (the built-in SQLite database needs it).

```bash
npm install                      # in the repo root (installs bcryptjs, pg, @anthropic-ai/sdk)
cd server && npm install && cd ..   # only needed to run the tests

# 1. Make a password hash for the owner login (use your own password)
node -e "import('bcryptjs').then(b=>console.log(b.default.hashSync('Demo-Pass-123',10)))"

# 2. Start the server (paste the hash between the single quotes)
SLON_API_KEY=localkey_0123456789abcdef0123456789abcdef \
SLON_OWNER_EMAIL=kirsty@example.test \
SLON_OWNER_PASSWORD_HASH='<paste the hash here>' \
SLON_TOKEN_SECRET=tokensecret_0123456789abcdef0123456789 \
PORT=4000 NODE_ENV=development node server/src/server.js
```

Open `http://localhost:4000` and sign in with the email and password above.

- A fresh install starts **empty** (apart from the six default business names), with honest "nothing here yet" messages.
- To see **example clients, tasks and deadlines** (Woofington Park and friends) add `SLOANE_DEMO_DATA=true`. Pages then show a yellow "Example data" notice. Never use this for real work.
- Data is saved to `server/data-private/sloane.db` unless you set `SLOANE_DATA_DIR` or `SLOANE_DB_PATH`.
- Uploaded documents go to `server/storage/documents` unless you set `SLOANE_DATA_DIR` or `STORAGE_ROOT_PATH`.

### Tests

```bash
cd server && npm test
```

The suite covers the API (including every create / change / delete), persistence, security rules and the plain-English wording. It writes nothing into the real documents folder.

---

## 3. Environment variables

Set these in your host's settings (Railway: *Variables*). Values below are examples only. **Never commit real values.**

### Required to start

| Variable | What it is |
|---|---|
| `SLON_API_KEY` | Sloane's own server key (min. 32 random characters). Used by integrations calling Sloane. Never sent to TriNova. |
| `SLON_OWNER_EMAIL` | The owner's sign-in email. |
| `SLON_OWNER_PASSWORD_HASH` | A **bcrypt hash** of the owner's password (see step 1 above). Never store the plain password. |
| `SLON_TOKEN_SECRET` (or `STORAGE_PRESIGNED_TOKEN_SECRET`) | Random secret that signs the short-lived document download links. |

### TriNova (live clients)

| Variable | What it is |
|---|---|
| `TRINOVA_API_KEY` | **Required to show TriNova clients. There is no default.** Without it Sloane does not call TriNova at all, says so on the Clients, Deadlines and Settings pages, and only shows clients added in Sloane. **The old key that used to be committed in this repository (`tn_sec_live_…`) must be treated as leaked: ask TriNova to rotate it and set the new one here.** |
| `TRINOVA_API_URL` | Defaults to `https://portal.trinovaaccounting.co.uk/api/v1`. |
| `TRINOVA_TIMEOUT_MS` | Optional. Default `8000`. |

### Where data is saved

| Variable | What it is |
|---|---|
| `DATABASE_URL` | A `postgres://…` address. If set, Postgres is used instead of the SQLite file. `DATABASE_SSL=true` turns on SSL (needed for some hosted Postgres addresses). |
| `SLOANE_DATA_DIR` | One folder for everything Sloane saves (database file, documents, Outlook vault). Point it at a mounted volume. On Railway, `RAILWAY_VOLUME_MOUNT_PATH` is used automatically if this is not set. |
| `SLOANE_DB_PATH` | Move just the SQLite database file. |
| `STORAGE_ROOT_PATH` | Move just the uploaded documents. |
| `OUTLOOK_VAULT_PATH` | Move just the encrypted Outlook sign-in file. |

### Outlook (optional; Settings → Connect Outlook)

| Variable | What it is |
|---|---|
| `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET` | From the Microsoft Entra (Azure) app registration. |
| `OUTLOOK_REDIRECT_URI` | Must exactly match the redirect set in Microsoft, e.g. `https://your-site/api/v1/integrations/outlook/callback`. |
| `OUTLOOK_TENANT_ID` | Optional. Defaults to the common tenant. |
| `OUTLOOK_TOKEN_ENC_KEY` | 64 hex characters. Encrypts the saved Outlook tokens. Keep it safe: if it changes, Outlook must be reconnected. |

### Other

| Variable | What it is |
|---|---|
| `COMPANIES_HOUSE_API_KEY` | Enables the "Check now" Companies House check. |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER` | Optional AI for "Ask Sloane" (`auto`, `anthropic` or `gemini`). Without them Sloane answers from its saved records only and says so. |
| `SLOANE_DEMO_DATA` | `true` loads the built-in example records. Leave unset in real use. |
| `CORS_ALLOWED_ORIGINS` | Extra allowed web addresses, comma-separated. |
| `PORT`, `HOST`, `NODE_ENV`, `LOG_LEVEL` | Usual server settings. |

See `server/.env.example` for a copy-and-fill template.

### Checking the TriNova connection

`node server/scripts/check-trinova.js` (with `TRINOVA_API_KEY` set in your own terminal) checks that TriNova is up and accepts the key, then saves the **shape** of what TriNova returns (field names and kinds of value, never client data) to `server/data-private/trinova-shape.json`. The live API is `https://portal.trinovaaccounting.co.uk/api/v1`; it expects `Authorization: Bearer <key>`. The older `testnova-…railway.app` address no longer exists.

The same check runs from inside Sloane, with the key kept on the server: open the **TriNova connection** panel and press **🔎 Check TriNova data**. The results show under "What happened" and the report downloads as `trinova-data-check-<date>.json` (field names and counts only). It also says how many rows of TriNova's deadlines feed Sloane can read.

### Deadlines from TriNova

Sloane reads TriNova's deadlines feed (`GET /statutory`) as well as the dates on each TriNova client, and keeps them for a minute. Order of precedence on the Deadlines page: your own dates, then clients added in Sloane, then TriNova's deadlines feed, then dates on TriNova client records. A date missing from the feed is filled in from the TriNova client record. The feed may list one row per company or one row per deadline (with a type such as "Annual accounts" or "Confirmation statement"); filed or completed deadlines are skipped. "Refresh deadlines now" in the panel reads TriNova again straight away. If TriNova has no deadlines feed, the panel reports it as `not_available` and the client dates are used.

---

## 4. Deploying on Railway

1. Create the service from this repository. `package.json` asks for **Node 22.13 or newer**.
2. **Choose where data is saved. Do one of these, or Sloane will lose everything on every deploy:**
   - **Volume (simplest):** add a Volume, mount it at `/data`, set `SLOANE_DATA_DIR=/data`. The database, uploaded documents and the Outlook vault all live there.
   - **Postgres:** add the Postgres plugin and set `DATABASE_URL` to its address. Documents and the Outlook vault still need a volume (`SLOANE_DATA_DIR`).
3. Set the required variables (section 3). Set `TRINOVA_API_KEY` to the **new, rotated** key.
4. After deploy, open **Settings → "How Sloane is set up"**. It must say *"Your information is saved"* and *"TriNova is connected"*.

**Without a volume or `DATABASE_URL`:** Sloane still runs, but `/api/v1/health` reports `storage: "memory"`, Settings says *"Your information is NOT being saved"*, and clients added by hand, tasks, notes, documents, deadlines and private notes disappear on restart. Uploaded documents and the Outlook connection also vanish.

**SQLite on the server's own disk (production, no volume):** Sloane saves, but that disk is wiped at each deploy. `/api/v1/system/status` reports `storage.durable: false` and Settings shows *"But it is only saved on a temporary disk"*. Attach a volume (or use Postgres) to fix it.

On a redeploy Railway stops the old copy with `SIGTERM`; Sloane finishes saving first.

---

## 5. What can be added, changed and deleted

| Thing | Add | See | Change | Delete | Notes |
|---|:-:|:-:|:-:|:-:|---|
| **Businesses** (My Businesses) | ✅ | ✅ | ✅ | ✅ | Cannot delete one that still has clients (plain 409 message). Renaming moves its clients across. |
| **Clients added in Sloane** | ✅ | ✅ | ✅ | ✅ | Deleting also takes that client's tasks, notes, documents, history and signing records; they go to the Bin together. |
| **Clients from TriNova** | ❌ | ✅ | ❌ | ❌ | Read-only (managed in TriNova). The one thing Sloane can do: **choose which of your businesses a client belongs to** (`PUT /clients/:id/business`). |
| **Tasks** | ✅ | ✅ | ✅ | ✅ | For any client (Sloane or TriNova) or none. Edit title, date, priority, "stuck", client; reassign; tick off; cancel; delete. |
| **Team members** | ✅ | ✅ | ✅ | ✅ | Cannot remove someone with open tasks. Renaming updates their tasks. |
| **Deadlines** | ✅ | ✅ | ✅ | ✅ | List is built from TriNova clients, clients added in Sloane and your own entries. Your own dates replace TriNova's; deleting them brings the original back. Companies House can confirm dates. |
| **VAT returns** | ✅ | ✅ | ✅ | ✅ | Kept by hand. |
| **Client notes** | ✅ | ✅ | ✅ | ✅ | Saved in Sloane only — **not** sent to TriNova or the client. |
| **Documents** | ✅ upload | ✅ + download | ✅ rename / category | ✅ | Max 15 MB; the file is kept while the document is in the Bin and removed when it is deleted for good. Cannot delete a document that is part of a signing request. |
| **History entries** | ✅ | ✅ | ✅ your own entries only | ✅ all | Entries Sloane writes automatically (task, document, Companies House…) can only be deleted, not edited. |
| **Signing requests** | ✅ | ✅ | cancel only | ❌ | **Record only:** Sloane keeps a record of who was asked to sign; it does **not** send anything to signers or to Documenso yet. `meta.delivery` is `"not_sent"`. |
| **My Private Notes** | ✅ | ✅ | ✅ | ✅ | Saved on the server per owner; only a signed-in browser session can use them (API keys get 403). Notes saved in the browser before are moved over once, automatically (`POST /ceo-notes/import`). Never shown to the AI. |
| **Outlook** (diary, flagged emails) | – | ✅ | – | – | Read only; connect / disconnect / choose what is read in Settings. |

Every change goes through server validation, answers with plain-English 400 / 404 / 409 / 422 messages, and writes an entry to the audit log (`GET /api/v1/audit/logs`).

### This week (one-page report)

Menu → **This week** (`GET /api/v1/reports/this-week`) shows a one-page summary built from Sloane's own records: what is late (filings, VAT returns, tasks), what is due today and in the next 6 days, stuck tasks with the reason, who is doing what, tasks finished in the last 7 days, and how much falls due in the 8 to 30 days after. All dates are UK dates (Europe/London). **Print or save as PDF** opens the browser's print window; the print rules (`body.printing-report` in `styles/views.css`) print only the report, black on white, on A4, with table headings repeated on each page.

### Download a copy of everything (Excel)

Settings → **Your data** → **Download a copy of everything (Excel)** (`GET /api/v1/export/excel`, signed-in owner only) gives one `.xlsx` file with a sheet for each kind of record: About this file, Clients (Sloane and TriNova), Deadlines, VAT returns, Tasks, Team, Businesses, Client notes, Documents (a list; the files themselves stay in Sloane), History, Signing requests, Private notes and the Bin. Dates are real Excel dates (dd/mm/yyyy), headers are bold and frozen, and text is never written as a formula. The file is written by `server/src/services/xlsx.js` (no extra libraries).

### Sloane suggests (tasks found for you)

On **Today**, Sloane proposes tasks it has worked out from deadlines and VAT returns, so the owner does not have to create them by hand (`GET /api/v1/suggestions`, `POST /suggestions/accept | accept-all | dismiss | reset`; rules and code in `server/src/services/taskSuggestions.js`).

- **Rules (defaults):** accounts due within 30 days or late → "Prepare and file accounts" (task due a week before the filing); yearly update due within 30 days or late → "File the yearly update" (3 days before); VAT return not filed, due within 21 days → "Prepare the VAT return" (3 days before). Late items are Urgent and due today; within 14 days High; otherwise Normal.
- **No duplicates:** nothing is suggested if a task already carries the suggestion key (even a finished or cancelled one), if an open task for that client already covers that kind of work (by title: accounts / yearly update / VAT), or if the owner pressed *Not needed*. The key includes the due date, so next year's deadline is a new suggestion (recurring work).
- **Who:** the client's manager (from TriNova `account_manager` or the client record) becomes the assignee when that person is on the Team page; otherwise the task is unassigned and the manager is named.
- **Always approved by the owner:** nothing is made until *Create task* / *Create all* is pressed (the second asks first). Only a suggestion Sloane is making at that moment can be accepted. Tasks keep `sourceKey` and `origin: 'suggested'`, and get the usual history entry and audit entry.
- **Not done yet (needs agreement or connections):** creating tasks automatically under agreed rules; finding work from emails, Teams and meetings; syncing tasks with TriNova (the TriNova API has no task routes that Sloane has found, and Sloane only reads from TriNova today).

### The Bin (30 days)

Every delete above moves what it removes into the **Bin** (menu → Bin) instead of deleting it. One delete is one Bin item: a client comes back with its tasks, notes, documents and history. From the Bin the owner can **Put back** an item (it returns where it was) or **Delete for good**; **Empty the Bin** deletes everything in it. Items older than 30 days are deleted for good automatically (checked at start-up and every 6 hours). Uploaded files are only removed when their item is deleted for good. The Bin is saved like everything else (collection `bin`) and needs a signed-in browser session (it can hold private notes). Routes: `GET /api/v1/bin`, `POST /api/v1/bin/:id/restore`, `DELETE /api/v1/bin/:id`, `DELETE /api/v1/bin`.

---

## 6. How the data is saved (for developers)

- The routes work on in-memory lists in `server/src/data/db.js`. After any request that changes data (`POST`, `PUT`, `PATCH`, `DELETE`) the server saves the changes through `server/src/data/persistence.js`, which compares each list with what was last saved and writes only rows that were added, changed, moved or removed (snapshot-sync). On start-up it loads everything back.
- Drivers: SQLite via Node's built-in `node:sqlite`, or Postgres via `pg` when `DATABASE_URL` is set. Both use the same plain SQL.
- Tables are created by **store migrations** in `server/src/data/migrations/store/` (applied once, tracked in `sloane_schema_migrations`). Records live in `sloane_records`.
- The audit log (last 2,000 entries) is saved too.
- Example data (`SLOANE_DEMO_DATA=true`, and the automated tests) is built in `db.js`; a real install starts empty.
- `server/src/services/clientDirectory.js` answers "who is this client?" for both Sloane clients and live TriNova clients, so tasks, notes and documents can attach to either.

---

## 7. Security notes

- **Only the owner can sign in** (`SLON_OWNER_EMAIL` + bcrypt hash). There are **no built-in logins or default passwords.** An older hard-coded staff login was removed.
- **Two-step sign-in (optional, recommended).** Settings → *Sign-in security* → *Set up with an authenticator app*. Signing in then needs the password **and** a 6-digit code (TOTP, RFC 6238) from Microsoft Authenticator, Google Authenticator or similar. The QR code is drawn by Sloane itself (`server/src/services/qrcode.js`), so the key never goes to an outside service.
  - **Stored safely:** the authenticator key is encrypted (AES-256-GCM, key derived from `STORAGE_PRESIGNED_TOKEN_SECRET`, or `TWO_FACTOR_ENC_KEY` if set; changing that secret makes the saved key unreadable, so sign in with a recovery code and set up again). Recovery codes and trusted-browser tokens are stored as SHA-256 hashes only.
  - **Trust this browser:** an `HttpOnly`, `SameSite=Strict`, `Secure` (in production) cookie `slon_trusted`, sent only to `/api/v1/auth`, for 30 days. A trusted browser skips the code, never the password. Trusted browsers can be forgotten one by one or all at once in Settings.
  - **Recovery codes:** 10 one-time codes, shown once at set-up; new ones replace the old ones.
  - **Guessing:** a code can be used only once; 5 wrong codes end the sign-in attempt; wrong codes count towards the same 5-per-15-minutes lockout as wrong passwords.
  - **Emergency switch:** if the owner loses both the phone and the recovery codes, set `TWO_FACTOR_RESET=true` on the server, redeploy, sign in with the password, then **remove the variable** and set up again.
  - Routes: `POST /auth/login` (answers `two_factor_required` + `challengeId`), `POST /auth/login/verify`, and `/auth/two-factor` (status, setup, confirm, recovery-codes, disable, browsers).
- **Browsers can save the password:** the sign-in form uses `autocomplete="username"` / `current-password` / `one-time-code`, and Chrome / Edge are offered the credential after a successful sign-in.
- **No committed keys.** There is no default TriNova key, and Sloane's own `SLON_API_KEY` is never sent to TriNova. The key that used to be in `server/src/config.js` must be rotated (section 3).
- The session cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` over HTTPS. Login attempts are rate-limited.
- Private notes need a browser session, are never included in AI answers, and the audit log records only ids, not note text.
- Stored documents are checked for type and size, kept outside the public folder, and downloaded only through short-lived signed links.
- Scripts, styles and the page are re-checked on every load (ETag), so an update reaches everyone straight away.
- Real client files must never be committed. `server/storage/documents/*`, `data-private/`, `*.db` files and `.env*` are git-ignored.

---

## 8. Folder map

```
index.html               The page (login, all views, shared form and confirm dialogs)
styles/                  tokens, layout, components, views, auth
scripts/
  app.js                 Main controller and page renderers
  features/              Team & Tasks, Deadlines + VAT, client pages, private notes
  components/            modal, toast, form/confirm dialogs, Outlook settings
  services/              api.js (all server calls), storage, reconciliation, auth
  utils/html.js          Safe text helpers
server/
  src/server.js          Start-up (loads saved data, handles SIGTERM)
  src/app.js             Router, static files, health, system status
  src/routes/            One file per area (clients, tasks, team, statutory, …)
  src/services/          Client directory, Companies House, Outlook, signing, storage
  src/data/              db.js, persistence.js, paths.js, migrations/
  tests/                 `npm test`
docs/                    Build notes and evidence
```
