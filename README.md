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
| **Clients added in Sloane** | ✅ | ✅ | ✅ | ✅ | Deleting also deletes that client's tasks, notes, documents (and files), history and signing records. |
| **Clients from TriNova** | ❌ | ✅ | ❌ | ❌ | Read-only (managed in TriNova). The one thing Sloane can do: **choose which of your businesses a client belongs to** (`PUT /clients/:id/business`). |
| **Tasks** | ✅ | ✅ | ✅ | ✅ | For any client (Sloane or TriNova) or none. Edit title, date, priority, "stuck", client; reassign; tick off; cancel; delete. |
| **Team members** | ✅ | ✅ | ✅ | ✅ | Cannot remove someone with open tasks. Renaming updates their tasks. |
| **Deadlines** | ✅ | ✅ | ✅ | ✅ | List is built from TriNova clients, clients added in Sloane and your own entries. Your own dates replace TriNova's; deleting them brings the original back. Companies House can confirm dates. |
| **VAT returns** | ✅ | ✅ | ✅ | ✅ | Kept by hand. |
| **Client notes** | ✅ | ✅ | ✅ | ✅ | Saved in Sloane only — **not** sent to TriNova or the client. |
| **Documents** | ✅ upload | ✅ + download | ✅ rename / category | ✅ | Max 15 MB; deleting removes the file. Cannot delete a document that is part of a signing request. |
| **History entries** | ✅ | ✅ | ✅ your own entries only | ✅ all | Entries Sloane writes automatically (task, document, Companies House…) can only be deleted, not edited. |
| **Signing requests** | ✅ | ✅ | cancel only | ❌ | **Record only:** Sloane keeps a record of who was asked to sign; it does **not** send anything to signers or to Documenso yet. `meta.delivery` is `"not_sent"`. |
| **My Private Notes** | ✅ | ✅ | ✅ | ✅ | Saved on the server per owner; only a signed-in browser session can use them (API keys get 403). Notes saved in the browser before are moved over once, automatically (`POST /ceo-notes/import`). Never shown to the AI. |
| **Outlook** (diary, flagged emails) | – | ✅ | – | – | Read only; connect / disconnect / choose what is read in Settings. |

Every change goes through server validation, answers with plain-English 400 / 404 / 409 / 422 messages, and writes an entry to the audit log (`GET /api/v1/audit/logs`).

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
