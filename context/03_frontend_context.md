# 03 — Frontend Engineering Context

> Authority: this file explains **how the current prototype is built** and what a production frontend must change. For what it looks like see `02_ui_ux_context.md`; for what it should do functionally see `01_product_context.md`; for what it must never expose see `05_data_security_context.md`.

---

## Current implementation

`sloane_command_centre_v5.html` is a **single self-contained HTML file**: one `<style>` block (all CSS), inline markup, and one `<script>` block (all JavaScript) at the end of `<body>`. There is no build step, no bundler, no module system, no external JS dependencies, and no framework — plain DOM APIs and template literals throughout.

**Seeded/hard-coded data embedded in the script:**
- `businesses` — six-item default array (used only if `localStorage` is empty).
- `accountsTracker` — 33 hard-coded company records ("Trinova filing tracker · source workbook dated Aug 2026").
- `vatTracker` — ~92 hard-coded VAT deadline rows.
- `actionTracker` — a hard-coded list of specific statutory issues/actions.
- `TODAY` — a **hard-coded fixed date** (`new Date('2026-09-15T12:00:00+01:00')`) used as the reference point for every days-to-deadline calculation. This is a snapshot artefact, not a live "now" — a production system must use the real current date.

**Client-side persistence:**

| Storage | Key | Contents | Notes |
|---|---|---|---|
| `localStorage` | `sloane_businesses_v1` | `businesses` array | Falls back to the 6-item seed if absent |
| `localStorage` | `sloane_clients_v1` | `clients` array | Falls back to `[]` |
| `localStorage` | `sloane_brain_v1` | `brain` array (CEO Brain entries) | Falls back to `[]` |
| `localStorage` | `sloane_ch_live_v1` | `chLive` object, keyed by company number | Companies House live sync results |
| `sessionStorage` | `sloane_ch_key` | Companies House API key, typed by the user | Explicitly scoped to the tab/session by design, but still a **secret stored client-side and used client-side** — see Frontend security below |

No `IndexedDB`, no cookies, no server-side session — everything is local to the browser and per-device (data does not follow Kirsty between machines).

## Current JavaScript architecture

The script is a flat sequence of function declarations plus seed constants, executed top-to-bottom, ending with a single bootstrap call: `renderBiz();renderClients();renderBrain();renderStatutory();`. There is no component tree, no explicit state-management library — "state" is just the module-level `businesses`, `clients`, `brain`, `chLive` arrays/objects, mutated in place and re-rendered by calling the relevant `render*()` function again.

Function-by-function behaviour (based on direct inspection, not assumption):

- **`switchView(id)`** — hides every `.view` section by adding `.hidden`, removes `.hidden` from the section matching `id`, and toggles `.active` on the nav button whose `data-view` matches. Wired to every nav button's `onclick` in a `forEach` right after definition. Pure UI-state, no data side effects.

- **`renderBiz()`** — builds one HTML string for all business cards (status pill, hard-coded "0 alerts," name, type, a *real* count of clients whose `biz` field matches the business name, and two hard-coded "0 sign-offs"/"0 red alerts" stats) and writes it into **both** `#bizCards` (Command Centre) and `#bizFull` (Businesses view) — the same markup is duplicated into two DOM locations. It also rebuilds the `<option>` list for the Client 360 business-filter dropdown and the modal's business-select, both derived from the same `businesses` array.

- **`openBiz()`** — uses `window.prompt()` (twice) to collect a business name and type, pushes `{name, type, status:'Active'}` onto `businesses`, persists to `localStorage`, and calls `renderBiz()`. No modal is used for this action, unlike client/company creation.

- **`openClient()`** — resets every Client 360 modal field to blank (name, number, dates, VAT number, PAYE, directors, owner, notes) and defaults selects (VAT=No, CIS=No, Risk=Low), then adds `.open` to `#clientModal`.

- **`closeModal(id)`** — removes `.open` from the element with the given id. Generic, reused by both modals in the file.

- **`saveClient()`** — validates only that the name field is non-empty (`alert('Add the company name.')` otherwise), then pushes a new client object built from every modal field, persists the whole `clients` array to `localStorage`, closes the modal, and re-renders three things: `renderClients()`, `renderBiz()` (client counts per business changed), and `renderStatutory()` (a new client may introduce a new statutory record).

- **`fmt(d)`** — formats an ISO `YYYY-MM-DD` string as `DD/MM/YYYY` by splitting on `-`; returns an em-dash for falsy input. No timezone or `Date` object is used — pure string manipulation, so it is safe against timezone drift but assumes well-formed ISO input.

- **`renderClients()`** — reads the current search box value (lower-cased) and business-filter dropdown value, filters the `clients` array (business match if a filter is set, plus a substring match against the JSON-stringified, lower-cased client object — i.e. search matches across *every* field including notes), and renders one table row per match via `fmt()` for dates and a risk-coloured `.pill`. Renders the coded empty state if no clients exist at all (note: the empty-state message is shown whenever the array itself is empty, not specifically when a search yields zero results — a minor UX inconsistency worth fixing).

- **`saveBrain()`** — trims the CEO Brain textarea; if empty, does nothing (silent no-op, no error). Otherwise unshifts `{text, at: <en-GB locale timestamp>}` onto `brain`, persists, clears the textarea, and calls `renderBrain()`.

- **`renderBrain()`** — renders up to the most recent 20 entries (`brain.slice(0,20)`), each with a neutral dot and the fixed suffix "Awaiting live AI classification" — i.e., this string is not computed per-entry, it is the same placeholder every time, confirming no classification logic exists client-side.

- **`askSloane()`** — reads the Ask Sloane input; if non-empty, shows a browser `alert()` with fixed explanatory text plus the echoed question. No network call, no state mutation.

- **`showMissed()`** — adds `.open` to `#missedModal`. No computation — the modal's content is entirely static markup.

- **`chMerged(r)`** *(Companies House merge)* — given a tracker record `r`, looks up `chLive[r.no]`; if absent, returns `r` unchanged. If present, returns a new object with `name/accounts/confirm/status` overridden by live values where live values exist (`l.field || r.field` pattern — an empty-string live value still falls back to the tracker value), a rebuilt `note` combining live status detail + overdue flags + the original note, `source` rewritten to indicate live provenance, `live: true`, and explicit `accountsOverdue`/`confirmOverdue` booleans.

- **`syncCompaniesHouse()`** — an `async` function that: reads the API key from the input (or falls back to a previously session-stored key); if absent, sets the status text/dot to "off" and alerts the user to enter a key; otherwise stores the key in `sessionStorage`, sets status to "Syncing…", and **loops through every `accountsTracker` row with an 8-digit company number**, calling `fetch()` directly against `https://api.company-information.service.gov.uk/company/{no}` with an `Authorization: Basic <base64(key + ':')>` header (Companies House's documented Basic-auth-with-blank-password scheme). On success it writes `chLive[no]` with normalised fields (`company_name`, `company_status`, `company_status_detail`, next accounts due date/overdue flag from either `accounts.next_accounts.due_on`/`overdue` or the legacy `accounts.next_due`/`overdue` shape, confirmation statement due/overdue). It counts successes/failures, persists `chLive` to `localStorage`, re-renders the statutory view and live-highlights summary, and writes a human-readable sync-result message (including a note that if every row fails, the browser may be blocking direct calls and "the same integration is ready for the hosted backend" — the prototype's own code comment/UX acknowledges this call belongs server-side).

- **`renderLiveHighlights()`** — computes and displays a one-line summary (`N live records · N accounts overdue · N confirmations overdue · N strike-off proposals`) from `Object.values(chLive)`, or a "not yet connected" message if empty.

- **`daysTo(d)`** — given an ISO date string, returns the integer number of days between `TODAY` (the hard-coded reference date) and a noon-anchored `Date` built from the input, using `Math.ceil((x-TODAY)/86400000)`. Returns `null` for falsy input.

- **`deadlineState(d)`** — the core urgency classifier (see `01_product_context.md` §Statutory Monitor for the business rule). Calls `daysTo()` and returns `{label, cls, days}`: no date → amber "No date in tracker"; negative days → the distinct "PAST DATE · verify" overdue state; 0–14 → RED; 15–30 → AMBER; else CLEAR.

- **`nearestFor(r)`** — given a record with `accounts`/`confirm` fields, builds a `[label, date, daysTo]` tuple for each present date, sorts ascending by days-to-deadline, and returns the nearest one (or `null` if neither date exists). Used to populate the "Nearest deadline" column in the statutory table.

- **`allStatRecords()`** — assembles the full statutory data set: every `statutorySeed` record (derived from `accountsTracker`) run through `chMerged()`, concatenated with any Client 360 record that has a company number/accounts date/confirmation date **and** whose company number isn't already present in the tracker (dedup by number where a number exists; records with no number are always included, which could produce true duplicates if two manually-entered records share no number but describe the same company — worth flagging as a data-quality gap).

- **`renderStatutory()`** — the largest function. Computes `red` as the count of "actionable" `actionTracker` issues (i.e. excluding ones whose `issue` text matches `/NO ACTION|DISSOLVED|Sole trader/i` — status is inferred from free-text pattern matching, not a structured field) plus the count of statutory rows whose accounts deadline is within 14 days. Renders: the "Practice deadline radar" stat card (counts of tracked companies/VAT rows/action-required records), up to 3 top action-required stat cards, the full statutory deadlines table (via `allStatRecords()`, `nearestFor()`, `deadlineState()`), updates the sidebar's statutory badge, and — **only once, guarded by checking `#trackerExtra` doesn't already exist** — appends two further sections (Tracker Actions table, VAT Deadline Schedule table) to the DOM. This guard means calling `renderStatutory()` repeatedly is safe for the main table but will not re-render the appended tracker/VAT sections after the first call, even if underlying data changed — acceptable in a static-seed prototype, but a latent bug if `actionTracker`/`vatTracker` ever become mutable.

## State model

No formal schema exists; the following is the state shape as actually used:

```
businesses: { name: string, type: string, status: string }[]
clients:    { name, biz, no, year, accounts, confirm, vat: 'Yes'|'No', vatNo, paye,
              cis: 'No'|'Contractor'|'Subcontractor'|'Both', dirs, owner,
              risk: 'Low'|'Medium'|'High', notes }[]
brain:      { text: string, at: string (en-GB locale datetime) }[]
chLive:     { [companyNumber: string]: { name, companyStatus, detail, accounts,
              accountsOverdue: boolean, confirm, confirmOverdue: boolean,
              checked: ISOString } }
```

Read-only seed constants (`accountsTracker`, `vatTracker`, `actionTracker`, `TODAY`, `TRACKER_SOURCE`) are not part of persisted state — they are baked into the script and identical on every load.

**UI state** (not persisted, lives only in the DOM/CSS classes): which `.view` section is visible (`.hidden` class), which modal is open (`.open` class), current search/filter input values.

## Production migration

The following are architectural *requirements*, not a prescribed framework — neither source document specifies one, so none should be assumed:

- **Componentisation:** the current pattern (one function builds a full HTML string and assigns `.innerHTML`) does not scale past a prototype — re-render of a whole list on every change, no diffing, no encapsulated component state. A production frontend needs real componentisation, whatever the chosen approach.
- **Service/API layer:** all data access must move behind a dedicated client module that talks to the versioned Trinova API (`/api/v1`, see `04_backend_integration_context.md`) — no direct `fetch()` calls scattered through UI code, and critically, **no direct browser calls to Companies House or any third-party API with a secret key** (see Companies House and Frontend security below).
- **State management:** module-level mutable arrays are not sufficient once data is asynchronous, paginated, and multi-source (Trinova + Companies House + Sloane-private). A structured approach is needed to track loading/error/stale state per data source — not specified which library/pattern, that's an open decision.
- **Validation:** currently only "name is required" on one form. Production forms need full field-level validation matching whatever the Trinova API's write contract requires (see `04_backend_integration_context.md`).
- **Loading states:** none exist today (`syncCompaniesHouse()`'s "Syncing…" text is the only example). Every API-backed view needs one.
- **Error states:** today, failure mostly means a silent `catch` incrementing a `fail` counter (in `syncCompaniesHouse()`) or a generic `alert()`. Production needs per-field/per-record error surfacing consistent with the API's documented error codes.
- **Empty states:** only one is coded (Client 360 with zero clients). Every list view needs a genuine, purposeful empty state once data is live and can legitimately be empty (e.g. zero outstanding tasks).
- **Optimistic vs confirmed updates:** today every "save" is synchronous and local (`localStorage`), so success is instant and guaranteed. Once writes go through the Trinova API, decide per-action whether to optimistically update the UI before server confirmation or wait — and how to roll back an optimistic update on failure.
- **Cache invalidation / synchronization / stale data handling:** the current model has no concept of "this data might be stale" beyond the Statutory Monitor's own source/provenance labelling (§ see `02_ui_ux_context.md`). A production client needs a real strategy for when to refetch Trinova data, and must extend the existing provenance-labelling pattern (already proven useful in the prototype) rather than removing it.

## API client

Requirements for the service layer that replaces today's `localStorage` calls and the direct Companies House `fetch()`:

- Authenticated calls only — every request carries whatever credential/session mechanism the backend defines (see `04_backend_integration_context.md`; the frontend never holds the server-to-server Trinova credential itself).
- Operate on **stable IDs**, never names, as record references — the current prototype has no IDs at all (clients/businesses are matched by name string), which must not carry over.
- Support pagination, filtering, and sorting as the backend defines them, rather than the current pattern of fetching everything and filtering client-side in JavaScript (fine at 33–125 hard-coded rows; not fine at real practice scale over a network).
- Sensible timeouts and a defined retry policy for transient failures — none exist today.
- Structured error handling mapped to the backend's documented error codes — replacing today's single `alert()`/console-swallowed-error pattern.
- Idempotency awareness on the client side for actions the backend defines as needing idempotency keys (task creation, messages, uploads — see `04_backend_integration_context.md`), so a retried request from the client doesn't rely on the backend alone to prevent duplication.
- Conflict handling — surfacing a "this record changed since you loaded it" state rather than silently overwriting, once the backend supports version/staleness detection.

## Frontend security

Explicit, non-negotiable rules for whatever replaces this prototype:

- **Never expose API secrets in the browser.** The current Companies House flow — a user-typed API key, Basic-auth-encoded and sent directly from `fetch()` in browser JS — is the exact anti-pattern the Developer Handoff rules out for production ("Authenticate requests server to server with scoped, revocable credentials. Keep credentials out of browser code and repositories"). It must not be replicated for Trinova or the signing provider.
- **Never put Trinova credentials in browser code.** The frontend calls a Sloane-controlled backend; that backend holds the server-to-server Trinova credential, never the browser.
- **Never put signing-provider secrets in frontend code.** Signing itself is a Trinova-side workflow (see `01_product_context.md` §Document Signing) — Sloane's frontend, at most, displays status it reads via the authenticated API.
- **Never expose private Sloane notes accidentally.** CEO Brain entries and Client 360 `notes`/private fields must not be included in any payload, log, or view that could be visible to Trinova or any non-Kirsty user — this is a frontend responsibility as much as a backend one (e.g. don't build a shared component that renders private notes into a surface also used for Trinova-visible data without an explicit visibility check).

## Companies House

In production, the frontend must **not** call Companies House directly (as `syncCompaniesHouse()` currently does). It should call the Sloane/Trinova backend's own endpoint(s) for Companies House-derived data, and the backend performs the actual Companies House API call server-side, with the API key held server-side only. The frontend's job becomes: trigger a sync request, poll/receive status, and render the same kind of live-vs-tracker-vs-overdue provenance the prototype already demonstrates (see `02_ui_ux_context.md` §Data provenance) — the *display* pattern is worth keeping, the *fetch-from-browser* mechanism is not.

## Ask Sloane

Frontend requirements, kept separate from whatever backend/AI implementation eventually answers queries:

- The frontend's job is: capture the query, send it to a backend endpoint, render the (eventual) structured or streamed response, and handle loading/error states — none of which exist today (today it's a synchronous `alert()`).
- The frontend must not attempt to call any AI provider directly from the browser, for the same secret-exposure reasons as above.
- Whatever the backend returns must be rendered with the same provenance-awareness as the rest of the app (e.g. if Ask Sloane cites a Trinova record vs a CEO Brain note vs a Companies House fact, that source should be visible, consistent with the existing UI pattern).

## Offline/local persistence

The following prototype `localStorage` behaviours are **prototype-only conveniences and must not be treated as production persistence** without explicit approval:

- `sloane_businesses_v1`, `sloane_clients_v1`, `sloane_brain_v1`, `sloane_ch_live_v1` — all currently the *entire* source of truth for their respective data, stored per-browser with no server backup, no cross-device sync, and no access control beyond "whoever has this browser profile."
- `sloane_ch_key` in `sessionStorage` — a secret, stored client-side, exactly the pattern §Frontend security above prohibits for production.

Any of these *may* remain as a genuinely local, per-viewer convenience in production (e.g. remembering a UI preference) but must not remain as the system of record for business data, private notes, or credentials.

---

## Open Questions / Decisions Required

- Final frontend framework/architecture for the production build — not specified in either source; only architectural *requirements* are defined above.
- Whether any part of the current prototype's markup/CSS is reused directly, or the production frontend is built fresh against the same visual language (`02_ui_ux_context.md`).
- Exact state-management approach for handling multi-source, asynchronous, provenance-tagged data.
- Whether Ask Sloane's backend is in scope for the same team doing the Trinova integration, or is separate (Kirsty's own developer, per the Handoff's framing) — see `01_product_context.md` §Ask Sloane.
