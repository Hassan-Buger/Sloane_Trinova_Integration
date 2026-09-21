# Unit 03: Server-Side Companies House Integration & Statutory Reconciliation Engine

## 1. Goal
Implement a secure, server-side Companies House client and reconciliation engine that stores API credentials exclusively on the server, fetches filing status from the UK Companies House API, and merges live statutory data using proven urgency and reconciliation rules.

## 2. Design
- **Server-Side Integration:** Per `context/04_backend_integration_context.md` §9 and `context/05_data_security_context.md` §4, the Companies House API key must be held server-side only in backend configuration. Browser direct calls (`syncCompaniesHouse()`) and `sessionStorage` credential storage must be fully replaced.
- **Data Reconciliation Logic:** Per `context/01_product_context.md` §Statutory Monitor and `context/03_frontend_context.md` §`chMerged()`, live Companies House data overrides spreadsheet/tracker dates where present; dissolved companies are suppressed from filing alerts; active strike-off proposals and CH-overdue accounts are promoted to RED.
- **Urgency Rules:** Per `context/01_product_context.md` §Statutory Monitor, deadline urgency is computed from the current date (replacing the prototype's fixed snapshot date):
  - Past date → `PAST DATE · verify`
  - 0–14 days away → `RED`
  - 15–30 days away → `AMBER`
  - 31+ days away → `CLEAR`
- **Data Provenance:** Per `context/02_ui_ux_context.md` §Data provenance, every record must convey whether it is live-verified, tracker-derived, or manually entered.

## 3. Implementation
### 3.1 Companies House API Client
- Build a server-side HTTP client for `https://api.company-information.service.gov.uk`.
- Use HTTP Basic Auth with `COMPANIES_HOUSE_API_KEY` loaded strictly from server environment variables.
- Implement rate limiting (token bucket / queue) respecting the 600 req / 5 min limit.
- Handle network timeouts (5s bounded timeout) and exponential backoff retry for transient network errors.

### 3.2 Reconciliation Engine
- Create endpoint `POST /api/v1/statutory/sync` to trigger or schedule sync for tracked company numbers.
- Normalize CH payload: `company_name`, `company_status`, `company_status_detail`, next accounts due date, accounts overdue boolean, confirmation statement due date, confirmation statement overdue boolean.
- Apply business reconciliation rules:
  - Dissolved companies: suppress routine filing alerts, label status as dissolved.
  - Active proposal to strike off (`active-proposal-to-strike-off`): promote urgency immediately to `RED`.
  - Overdue accounts/confirmations: promote urgency immediately to `RED`.
  - Normal upcoming deadlines: evaluate days remaining against live UTC timestamp.

### 3.3 Statutory Query Endpoint
- Expose `GET /api/v1/statutory` returning unified statutory list with provenance metadata (`source: "companies_house_live" | "tracker_derived"`), last checked timestamp, and calculated urgency state.

## 4. Dependencies
- HTTP client library with Basic Auth support (e.g. `axios`, `got`, or native `fetch` / Guzzle).
- Server configuration environment (`COMPANIES_HOUSE_API_KEY`).
- In-memory or database cache to store live snapshot results and avoid redundant API requests.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §3 (Read) & §6 (Reliability):
- [ ] No Companies House API key or Basic Auth token is exposed to the client browser.
- [ ] Valid 8-digit UK company number fetches live CH company profile.
- [ ] Accounts overdue flag from CH promotes urgency to RED regardless of calculated days.
- [ ] `active-proposal-to-strike-off` status detail promotes urgency to RED.
- [ ] Dissolved companies have filing alerts suppressed and status clearly indicated.
- [ ] Valid upcoming deadline within 14 days returns RED.
- [ ] Valid upcoming deadline within 15–30 days returns AMBER.
- [ ] Valid upcoming deadline 31+ days away returns CLEAR.
- [ ] Past date returns distinct `PAST DATE · verify` status.
- [ ] Rate limits and network timeouts are handled cleanly without crashing the service.
