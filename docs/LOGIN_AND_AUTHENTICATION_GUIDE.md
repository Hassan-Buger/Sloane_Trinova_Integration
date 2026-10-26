# Login & Authentication Guide
**Sloane Private Dashboard & TriNova Client Portal**

> **Last Updated:** October 2026  
> **Status:** Active & Verified in Production  
> **Applicable Environments:** Production (`portal.trinovaaccounting.co.uk`), Staging & Local (`localhost:4000` / `localhost:8000`)

---

## 1. Overview & Architecture

The ecosystem consists of two separate, tightly integrated applications with distinct authentication boundaries:

```
┌──────────────────────────────────────────────┐        ┌──────────────────────────────────────────────┐
│          Sloane Private Dashboard            │        │         TriNova Client Portal                │
│    (CEO Executive Command Centre)            │        │      (Practice Staff & Client CRM)           │
├──────────────────────────────────────────────┤        ├──────────────────────────────────────────────┤
│ • Strict Single-Owner Model (Kirsty Allen)   │        │ • Multi-Tenant RBAC (Staff & Clients)        │
│ • Zero Hardcoded Passwords (.env bcrypt hash)│        │ • MySQL users table with bcrypt ($2y$10$)    │
│ • Optional 2FA (RFC 6238 TOTP Authenticator) │        │ • Session-based web portal (HttpOnly cookie) │
│ • Stateful HttpOnly session cookie           │        │ • Headless REST API v1 (Scoped Bearer Keys)  │
└──────────────────────┬───────────────────────┘        └──────────────────────▲───────────────────────┘
                       │                                                       │
                       └───────────── Machine-to-Machine REST API ─────────────┘
                                   Bearer Tokens & HMAC Webhooks
```

---

## 2. TriNova Client Portal

* **Live Web URL:** [`https://portal.trinovaaccounting.co.uk/login`](https://portal.trinovaaccounting.co.uk/login)
* **Local Web URL:** `http://localhost:8000/login`
* **Session Cookie:** `PHPSESSID` (HttpOnly, SameSite=Lax, Secure over HTTPS)

### 2.1 Staff Accounts (Accountancy Practice Team)

Staff accounts have access to the internal practice portal: managing clients, statutory filing deadlines, digital document requests, signing ceremonies, audit logs, and task queues.

| Name | Primary Email | Legacy / Test Alias | Password | Department | Role / Permissions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Jane Dean** | `jane.dean@trinovaaccounting.co.uk` | `staff.one@example.invalid` | `password123` | Accounts & Audit | Senior Accountant & Practice Staff |
| **Kirsty Allen** | `kirsty.allen@trinovaaccounting.co.uk` | `staff.two@example.invalid` | `password123` | Executive & Practice Management | Managing Partner / Director |
| **Emma Dean** | `emma.dean@trinovaaccounting.co.uk` | `staff.three@example.invalid` | `password123` | Tax & Statutory Compliance | Senior Tax Specialist |
| **Practice Support** | `support@trinovaaccounting.co.uk` | `staff.four@example.invalid` | `password123` | Client Operations & Bookkeeping | Support & Administrative Staff |
| **Jessica Wall** | `jessica.wall@trinovaaccounting.co.uk` | — | `password123` | General Practice | Practice Staff |

> [!NOTE]
> The database recognizes both the primary practice domain (`@trinovaaccounting.co.uk`) and the initial legacy test emails (`@example.invalid`).

### 2.2 Client Accounts (External Portal Users)

Clients sign in to review statutory deadlines, upload tax documents, view published accounts, and sign authorization documents.

| Client Name | Email | Password | Access Scope |
| :--- | :--- | :--- | :--- |
| **Test Client Alpha** | `test.client.alpha@example.invalid` | `password123` | Client Dashboard, Uploads, Signatures |

### 2.3 Password Security & Reset
- Passwords are stored in the MySQL `users` table as bcrypt hashes (`$2y$10$...`).
- Password reset is available at `/password/reset` using an email-based 6-digit verification code.
- In local development (`APP_ENV=local`), reset and activation emails are intercepted and written to `storage/logs/mail.log`.

---

## 3. Sloane Private Dashboard

* **Local Web URL:** [`http://localhost:4000`](http://localhost:4000)
* **Session Cookie:** `slon_session` (HttpOnly, SameSite=Strict, Secure in production)
* **Architecture:** Dedicated single-user executive command centre for Kirsty Allen.

### 3.1 Owner Credentials

Per the Phase 1 Security Standard (§1.1), Sloane enforces a **zero-default-credentials policy**. There are no hardcoded logins in the codebase. Authentication requires an environment-configured email and bcrypt password hash:

| Setting | Value / Details |
| :--- | :--- |
| **Primary Email** | `kirsty@trinova.com` |
| **Accepted Aliases** | `kirsty.allen@trinova.co.uk` |
| **Password Source** | Evaluated against `SLON_OWNER_PASSWORD_HASH` in `.env` |
| **Role** | CEO & Managing Partner |

### 3.2 How to Set or Change the Sloane Password

To set or change Sloane's sign-in password:

1. Generate a new bcrypt hash using Node.js:
   ```bash
   node -e "import('bcryptjs').then(b => console.log(b.default.hashSync('YOUR_NEW_PASSWORD', 10)))"
   ```
2. Update `.env` in the Sloane root directory:
   ```env
   SLON_OWNER_EMAIL=kirsty@trinova.com
   SLON_OWNER_PASSWORD_HASH='$2b$10$...'
   ```
   *(Ensure single quotes are used around the hash if editing via Bash/PowerShell).*
3. Restart the Sloane server:
   ```bash
   npm run start
   ```

### 3.3 Two-Factor Authentication (2FA / TOTP)
- **Settings Path:** *Settings → Sign-in security → Set up with an authenticator app*
- **Standard:** RFC 6238 TOTP (compatible with Google Authenticator, Microsoft Authenticator, 1Password, Apple Keychain).
- **QR Code Rendering:** Generated server-side using pure vector math without sending keys to external APIs.
- **Trusted Browsers:** Checking *"Trust this browser for 30 days"* issues an encrypted `slon_trusted` cookie. Trusted browsers require only the password.
- **Emergency 2FA Reset:** If both phone and backup codes are lost:
  1. Add `TWO_FACTOR_RESET=true` to `.env`.
  2. Restart the server and sign in with the password.
  3. Remove `TWO_FACTOR_RESET` from `.env` and configure 2FA fresh.

### 3.4 Brute-Force Rate Limiting
- Sign-in attempts are rate-limited to **5 failed attempts per 15 minutes** per IP address.
- Exceeding this limit returns `HTTP 429 Too Many Requests`.
- Failed attempts and successful logins are recorded in the internal append-only audit log.

---

## 4. Machine-to-Machine / API Keys (Sloane ⇄ TriNova)

The integration routes between Sloane and TriNova operate headlessly under `/api/v1` using HTTP Bearer authorization:

| Key Role | Permitted Scopes | Use Case | Storage Location |
| :--- | :--- | :--- | :--- |
| **Task API Key** | `tasks:read`<br>`tasks:write`<br>`staff:read` | Two-way task synchronization, assignee directory matching | `context/credentials/trinova-keys.env` (`TRINOVA_TASK_API_KEY`) |
| **Read-Only Portal Key** | `clients:read`<br>`statutory:read` | Client 360 feed, statutory filing deadlines feed | `context/credentials/trinova-keys.env` (`TRINOVA_READ_API_KEY`) |
| **Master System Key** | `*` (Full permissions) | Root operations & fallback | Server environment |
| **Webhook Secret** | HMAC SHA-256 | Signature validation for `task.updated` events (`X-Trinova-Signature`) | `context/credentials/trinova-keys.env` (`TRINOVA_WEBHOOK_SECRET`) |

> [!CAUTION]
> Production API keys and HMAC secrets must **never** be pasted in chat messages, committed to version control, or exposed to browser bundles. Keep them exclusively in `.env` and secure server vaults.

---

## 5. Quick-Reference Cheat Sheet

| Application | Role | Login / Identifier | Default / Configured Password |
| :--- | :--- | :--- | :--- |
| **TriNova Portal** | Senior Accountant | `jane.dean@trinovaaccounting.co.uk` | `password123` |
| **TriNova Portal** | Managing Partner | `kirsty.allen@trinovaaccounting.co.uk` | `password123` |
| **TriNova Portal** | Tax Specialist | `emma.dean@trinovaaccounting.co.uk` | `password123` |
| **TriNova Portal** | Support / Admin | `support@trinovaaccounting.co.uk` | `password123` |
| **TriNova Portal** | Client | `test.client.alpha@example.invalid` | `password123` |
| **Sloane Dashboard** | Executive Owner | `kirsty@trinova.com` | Evaluated against `SLON_OWNER_PASSWORD_HASH` in `.env` |
