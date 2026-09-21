# 01 — Product Context

> Authority: this file explains **what Sloane is and does**. For visual/interaction detail see `02_ui_ux_context.md`; for how the current code is built see `03_frontend_context.md`; for the Trinova integration see `04_backend_integration_context.md`; for data protection see `05_data_security_context.md`; for release process see `06_testing_deployment_context.md`.

Source basis: `sloane_command_centre_v5.html` (prototype, titled internally "V4" in the UI subtitle vs "V5" in the filename/title — note this inconsistency, it is not resolved in the source) and `Trinova_Sloane_Developer_Instructions.docx` (production requirements, dated 19 September 2026).

---

## 1. Product overview

**Sloane** is a private, single-user "CEO Command Centre" for Kirsty Allen. It exists to give her one consolidated view across several businesses she runs, so she does not have to manually cross-reference Outlook, the practice's statutory filing tracker, and each business's own records to know what needs her attention.

**Problem it solves:** operational and compliance information for Kirsty's businesses (client accounts, statutory deadlines, calendar conflicts, correspondence needing a decision, delegated work) is scattered across systems (Outlook, Trinova, spreadsheets). Sloane's job is to rank and surface what needs Kirsty specifically, distinguish genuine urgency (e.g. an active Companies House strike-off proposal) from routine noise, and give her a private space (**CEO Brain**) to capture thoughts without those thoughts becoming visible to staff or clients.

**Who it supports:** Kirsty Allen only. The UI explicitly labels itself "PRIVATE CEO COMMAND CENTRE" and the profile panel says "Private workspace · CEO view." This is not a multi-user staff tool — that is Trinova's job.

**Relationship to Trinova:** Trinova is the existing client portal / practice management system used by Trinova Accounting (one of the six business areas Sloane tracks). Trinova already holds shared operational data — clients, companies, tasks, messages, documents, workflow status. Sloane needs a live view into a subset of that data (see §3 Statutory Monitor, and `04_backend_integration_context.md`) but must not become another copy of Trinova's application.

**Why Sloane remains a separate private application:** Per the Developer Handoff, "Sloane must remain a separate private application" and "Sloane must remain accessible only to its authorised private user." This is a deliberate architectural and privacy decision, not an oversight to be "fixed" by merging the two systems:
- Sloane holds Kirsty's private CEO notes and reasoning (CEO Brain, private notes on client records) that staff and clients must never see.
- Trinova is the shared, multi-user system of record; Sloane is a personal intelligence layer on top of it.
- The Handoff is explicit: internal Sloane notes must stay private *unless the user explicitly selects an action to write them into Trinova* — privacy is opt-in-to-share, not opt-out.

## 2. Product architecture concept

Three data domains, per the Handoff's "Architecture requirements":

| Domain | Owner | Access rule |
|---|---|---|
| Shared client/company records, tasks, messages, documents, workflow status | **Trinova** (source of truth) | Sloane reads/writes only via authenticated API — never direct DB access, even on shared hosting |
| Sloane's own private application data (CEO Brain entries, private notes, Sloane-only state) | **Sloane** (separate database) | Trinova has no access; this is the privacy boundary described above |
| Third-party live data (Companies House) | External register | Must be fetched server-side in production (see §7 and `04_backend_integration_context.md`) — the prototype's direct-from-browser approach is not production-viable |

**Source-of-truth rule:** if a fact exists in Trinova (a company's directors, a task's status, a document), Trinova's copy is authoritative. Sloane must not silently diverge from it or infer values Trinova doesn't provide — the Handoff states "do not infer missing business records."

**API boundary:** all Sloane↔Trinova traffic is authenticated, server-to-server API calls. No shared database tables, even when co-hosted. Full contract detail lives in `04_backend_integration_context.md`.

## 3. Product navigation

The sidebar (prototype) defines seven areas, each a `data-view` target switched by `switchView()` (see `03_frontend_context.md` for the mechanism):

1. Command Centre (badge: 7)
2. Businesses
3. Client 360
4. People & Work
5. Statutory Monitor (badge: dynamic, driven by count of red-flagged statutory items)
6. Intelligence (badge: 3)
7. CEO Brain

"Ask Sloane" is not a nav item — it's a persistent input in the page header, present on every view.

---

## Command Centre

**Purpose:** the CEO's daily briefing screen — "what needs you today," ranked.

**Important data (as currently wired):**
- "Your Top 3 — do these first": three ranked items. **Prototype state: hard-coded HTML**, not generated from the statutory/client data model, even though its content (Woofington Park strike-off, R GB Elevations overdue accounts) matches records that *do* exist in the statutory tracker data. There is no function that computes this list dynamically.
- Red Alerts card: one hard-coded calendar-collision item plus a "What have I missed?" button (`showMissed()`).
- Today's Diary (Outlook): two hard-coded diary items with time chips. The "● OUTLOOK CONNECTED" live-bar label is static text, not the output of a real Outlook connection in this file.
- Command pulse metrics (6 stat tiles: Waiting sign-off, Sloane attention emails, Overdue work, Due in 7 days, People blocked, Business areas): **all hard-coded numbers** in the markup (e.g. "Business areas: 6" is typed literally, not `businesses.length`). None of these tiles are recalculated by JavaScript.
- "Your businesses" grid: this section **is** dynamic — rendered by `renderBiz()` into `#bizCards`.
- "Waiting for your sign-off" and "Emails Sloane thinks need you": static example cards, including two real Outlook deep-links, plus explanatory copy noting no live workflow source is connected yet.

**Production consideration:** every hard-coded number and list on this screen is a placeholder for a future computed value once Trinova (tasks, workflow, sign-off items) and Outlook are wired via real APIs. A coding agent must not assume this screen already aggregates live data — it currently aggregates nothing except the businesses list.

## Businesses

**Purpose:** manage the six "business areas" Kirsty operates across (Trinova Accounting, CFI Awarding, The Thinking Tent/Yellow Brick, MTDflow, Meta Digital Accounting, Other ventures & property).

**Data model (prototype):** `{name, type, status}` — a flat, three-field object. No further structure (no owner, no linked Trinova entity ID, no financials).

**User actions:** "+ Add area" calls `openBiz()`, which uses **browser `prompt()` dialogs** (not the modal system used elsewhere) to collect name and type, defaults `status: 'Active'`, and persists to `localStorage`.

**Current prototype state:** each business card shows a status pill, a hard-coded "0 alerts" string, the business name/type, and three mini-stats: a real count of linked clients (`clients.filter(c => c.biz === b.name).length`), plus hard-coded "0 sign-offs" and "0 red alerts."

**Production considerations:** business areas are Sloane-private concepts (Trinova doesn't necessarily model "business area" the same way) — confirm with Kirsty/Kirsty's team whether this taxonomy needs to map onto any Trinova concept, or remains Sloane-only metadata used to group Trinova companies for Kirsty's own oversight.

## Client 360

**Purpose:** a single record per company/client, intended as the 360° view — identity, statutory dates, VAT/PAYE/CIS status, directors/shareholders, ownership, risk, and Kirsty's private notes.

**Data model (prototype):** flat object — `name, biz, no (company number), year (year end), accounts (accounts due), confirm (confirmation statement due), vat (Yes/No), vatNo, paye, cis (No/Contractor/Subcontractor/Both), dirs (free-text directors/shareholders string), owner (free-text internal owner), risk (Low/Medium/High), notes (free text)`.

**Important gap to flag:** `dirs` is a single free-text field, not structured multiple-director/shareholder records. The Handoff explicitly requires agreeing "the structure for multiple companies, contacts, directors/shareholders, and message threads" as part of the production API — the prototype's flat text field is not that structure and must not be treated as the target data model.

**User actions:** search/filter toolbar (`renderClients()` filters across a JSON-stringified copy of every client field, plus a business-area dropdown filter); "+ Add client/company" opens a modal (`openClient()`/`saveClient()`) with the fields above; company-number cells link out to the Companies House "find company" URL when a number is present.

**Current prototype state:** entirely local — creation, validation (name required only), search, and persistence all happen in the browser against `localStorage`.

**Production considerations:** this is the view most directly overlapping Trinova's own client/company records. Confirm whether Client 360 becomes a Sloane-side *read+annotate* layer over Trinova company data (shared fields read from Trinova, `notes`/`risk` kept Sloane-private) rather than a fully separate client database, since duplicating client/company identity data risks drift from Trinova's source of truth.

## People & Work

**Purpose (stated intent only):** "Each person will show assigned work, current stage, age in stage, deadline, blockers, promises made and your private CEO notes."

**Current prototype state: unimplemented.** The section is a single static placeholder card with no data model, no functions, and no rendering logic. Do not treat any part of this feature as built — it is a description of intended future functionality only.

## Statutory Monitor

**Purpose:** the compliance early-warning system — tracks Companies House filing deadlines (accounts, confirmation statements) and VAT deadlines across the practice's client base, and classifies each by urgency.

**Data sources merged here:**
1. `accountsTracker` — 33 hard-coded companies from "Trinova filing tracker · source workbook dated Aug 2026," each with company number, year end, accounts due date, a free-text "working" status, directors, fee, and notes.
2. `vatTracker` — ~92 hard-coded rows of client name / VAT due date / filed date, from the same source.
3. `actionTracker` — a hard-coded list of specific issues needing action (e.g. Woofington Park's active strike-off proposal, R GB Elevations' overdue accounts, several "NO ACTION — previously reported in error" corrections, and dissolved-company notices).
4. Optional **Companies House live data** (`chLive`, keyed by company number), populated only if the user pastes an API key and runs `syncCompaniesHouse()`.
5. Manual records — any Client 360 entry with a company number, accounts date, or confirmation date not already covered by the tracker.

**Date calculations and urgency states** (`deadlineState()`):
- No date → "No date in tracker" (amber styling)
- Date in the past → "PAST DATE · verify" (a distinct `overdue`/verify state — the UI deliberately does **not** assert the filing is still outstanding, only that the tracker date has passed)
- 0–14 days away → RED
- 15–30 days away → AMBER
- 31+ days away → CLEAR

This "PAST DATE · verify" nuance matters: because the tracker is an August 2026 snapshot, a past date means "verify current status," not "confirmed still overdue." A future agent must preserve this distinction rather than collapsing it into a simple overdue flag.

**Companies House reconciliation logic** (`chMerged()`): when live CH data exists for a company number, it **overrides** tracker fields (name, accounts due, confirmation due, status) and appends live-derived notes (e.g. "Accounts OVERDUE"). Rows without live data keep showing spreadsheet-derived values. Per the on-page reconciliation note: dissolved companies are suppressed from filing alerts, and an active strike-off proposal or CH overdue flag is promoted to RED regardless of the date-based calculation.

**Verification state:** each row's `source` field communicates provenance — "Companies House live · [tracker]" vs the plain tracker source — so the UI (and any successor) must keep signalling whether a given date is live-verified or spreadsheet-derived. See `02_ui_ux_context.md` §"Data provenance."

**Current prototype state vs production:** the live sync currently calls `https://api.company-information.service.gov.uk` directly from the browser with a Basic-auth header built from a key typed into a password field and cached in `sessionStorage`. This is explicitly flagged elsewhere (see §7 below and `04_backend_integration_context.md`) as unsuitable for production and must move server-side.

## Intelligence

**Current prototype state:** a static list of four example finding categories — "Live finding: diary clash detected" (the one genuinely reflects data used elsewhere on Command Centre), "Statutory risk," "Stalled work," "Relationship silence." None of these are computed; there is no `renderIntel()` function or backing data model. This screen is a mockup of intended categories, not a working feature.

**Intended behaviour (from copy on the page and in the "What have I missed?" modal):** three scan types — Critical (statutory/HMRC/compliance/blocked decisions), Chase (promises, delegated work, unanswered important messages), Context (meeting actions/notes not yet turned into work) — feeding into both the Intelligence screen and the "What have I missed?" modal.

## CEO Brain

**Purpose:** a free-text capture pad — "Tell Sloane anything" — for Kirsty to jot observations, promises made by others, things to revisit.

**Current persistence:** `saveBrain()` trims the textarea value, prepends `{text, at: <local timestamp>}` to a `brain` array, and writes it to `localStorage` under key `sloane_brain_v1`. `renderBrain()` lists the most recent 20 entries.

**Current prototype behaviour:** entries are stored verbatim with **no classification, extraction, or linkage** — each rendered entry is explicitly labelled "Awaiting live AI classification." There is no AI processing of Brain entries in this file.

**Future/private data implications:** Brain content is a prime example of Sloane-private data (see `05_data_security_context.md`) — it may contain candid commentary about staff, clients, or commercial matters that must never reach Trinova or any shared system without an explicit, separate user action.

## Ask Sloane

**Current UI/function:** a header input + button present on every view. `askSloane()` reads the input and, if non-empty, shows a **browser `alert()`** stating that Outlook is connected but that conversational/live reasoning still runs through Sloane "in ChatGPT" until a hosted backend is wired, and echoes the question back.

**Current limitations:** no real query is sent anywhere; this is an explicit placeholder acknowledging the gap between the static HTML file and a live AI backend.

**Expected future architecture:** per the stub's own wording, a hosted backend is the intended next step — i.e., Ask Sloane's real implementation is out of scope for this static file and belongs to Sloane's (Kirsty's developer's) separate backend work, not the Trinova integration workstream described in the Handoff.

**Privacy requirement:** whatever backend eventually answers Ask Sloane queries must respect the same Trinova/Sloane-private boundary as the rest of the product — it should not leak CEO Brain or private-note content into any Trinova-visible surface, and conversely should only pull Trinova data through the authenticated API, never direct DB access.

## What Have I Missed?

**Intended purpose:** a manually-triggered "safety-net scan" (`showMissed()`) that reassures Kirsty nothing urgent has slipped through, organised into the three scan categories described under Intelligence above.

**Current implementation limitations:** entirely static modal content — explanatory copy plus three example category cards. It does not re-run any calculation; "Run safety-net scan" and "Re-run deadline engine" buttons both just open/re-render existing static or already-computed content (`renderStatutory()` in the latter case does real work; `showMissed()` does not).

## Document Signing

**Not present in the HTML prototype at all.** Document signing is a **Trinova-side production feature** defined entirely by the Developer Handoff — it is not a Sloane UI concept and does not appear anywhere in `sloane_command_centre_v5.html`. Do not add signing UI to Sloane; the signing workflow (staff selects client/company + document → signer invited → signs → Trinova tracks/stores) happens inside Trinova. Sloane may, at most, be able to *read* signing/review-item status via the Trinova API (see "review/sign-off items" under §Trinova data Sloane must read in `04_backend_integration_context.md`) but does not implement or host the signing flow itself. Full detail in `04_backend_integration_context.md` and `06_testing_deployment_context.md`.

## Product boundaries

Explicitly, Sloane should **not**:
- Access Trinova's database tables directly, even on shared hosting.
- Store or transmit Trinova API credentials, or any signing-provider secrets, in browser-executed code.
- Treat browser `localStorage`/`sessionStorage` as a production data store for anything beyond short-lived, low-sensitivity local state.
- Infer or invent business records/data Trinova doesn't actually provide.
- Write Sloane-private notes (CEO Brain, Client 360 `notes` field) into Trinova automatically — only an explicit user action may do this.
- Implement or host the document-signing workflow — that belongs to Trinova.
- Call Companies House directly from the browser in production.
- Be accessible to anyone other than its single authorised private user.

---

## Open Questions / Decisions Required

- Whether "business area" is a Sloane-only organisational concept or needs a corresponding structure in Trinova.
- Whether Client 360 becomes a read+annotate layer on Trinova company data, or a genuinely separate Sloane-side client database — the current flat prototype model does not resolve this.
- How the flat `dirs` free-text field maps onto the Handoff's required structured multiple-director/shareholder model.
- The real architecture and provider for Ask Sloane's live AI reasoning (explicitly deferred in the prototype's own stub text, and outside the Developer Handoff's stated scope, which covers "backend, API connection, integration support, and the Trinova signing workflow" — not Sloane's own AI backend).
- Whether Sloane will consume Trinova "review/sign-off items" as read-only status, and if so, exactly which fields.
