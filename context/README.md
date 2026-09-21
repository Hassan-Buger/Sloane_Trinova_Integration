# Sloane / Trinova — Engineering Context System

This is a six-file context system, plus this README, generated from two source documents:

- **`sloane_command_centre_v5.html`** — the existing Sloane HTML prototype (evidence of current UI, interaction patterns, and prototype behaviour).
- **`Trinova_Sloane_Developer_Instructions.docx`** — the Developer Handoff (authoritative for production architecture, backend integration, security, staging, signing, and deployment).

It is written for an AI coding agent (Claude Code, Cursor, Codex, or similar) to read **before** modifying or implementing anything, so it understands what exists today, what's required for production, and where the two sources genuinely disagree or leave something unresolved.

## The six files

| File | Covers |
|---|---|
| `01_product_context.md` | What Sloane is, its relationship to Trinova, and every product area (Command Centre, Businesses, Client 360, People & Work, Statutory Monitor, Intelligence, CEO Brain, Ask Sloane, What Have I Missed?, Document Signing) — current prototype state vs intended behaviour |
| `02_ui_ux_context.md` | Visual system (dark theme, gold accent, status colours), layout, navigation, components, interaction behaviour, responsive behaviour, UX principles, data provenance, accessibility |
| `03_frontend_context.md` | The current single-file HTML/CSS/JS implementation in full detail — storage keys, every important function's actual behaviour, state model — plus production migration requirements |
| `04_backend_integration_context.md` | The Sloane⇄Trinova API architecture: read/write contracts, API design, reliability, authentication, Companies House backend requirements, the full document-signing workflow and provider-evaluation checklist, hosting |
| `05_data_security_context.md` | Data ownership (Trinova-owned vs Sloane-private), the privacy boundary, access control, secrets, document security, audit logging, data integrity, environment isolation, browser-storage risks |
| `06_testing_deployment_context.md` | Delivery sequence, field mapping, read/write/auth/reliability/signing test coverage, regression testing, staging rules, production readiness, monitoring, rollback, final handoff deliverables |

## Recommended reading order

1. `01_product_context.md` — understand what the product is and does
2. `02_ui_ux_context.md` — understand how it looks and behaves
3. `03_frontend_context.md` — understand how the client is currently built
4. `04_backend_integration_context.md` — understand the production integration architecture
5. `05_data_security_context.md` — understand the data-protection and trust boundaries
6. `06_testing_deployment_context.md` — understand how it gets verified and released

## Which file is authoritative for which concern

- **Product intent and functional scope:** `01_product_context.md`
- **Visual/interaction design:** `02_ui_ux_context.md`
- **Existing prototype code behaviour:** `03_frontend_context.md`
- **API contracts, Companies House backend, signing backend:** `04_backend_integration_context.md`
- **Ownership of data, privacy, secrets, audit:** `05_data_security_context.md`
- **Release process and quality gates:** `06_testing_deployment_context.md`

Where the two source documents describe the same topic differently, this system resolves it as follows:

- **The HTML prototype is evidence of current/proposed UI, interaction patterns, prototype behaviour, and data concepts.** It is not a production architecture, and nothing in it should be assumed to be secure, scalable, or correct simply because it exists and "works" in a browser.
- **The Developer Handoff is authoritative for production architecture** — backend integration, security, staging, signing, and deployment. Where it and the prototype conflict (most notably: Companies House access, and where sensitive data is stored), the Handoff wins, and the prototype's behaviour is documented specifically so it is *not* carried forward by mistake.

## How prototype requirements differ from production requirements

The single biggest risk this context system exists to prevent: **a coding agent mistaking prototype code for production architecture.** Concretely, the prototype does the following, and every one of these must change before production:

- Stores all business data (businesses, clients, CEO Brain notes, Companies House sync results) in **browser `localStorage`**, unencrypted, per-device, with no server-side record.
- Stores a live **Companies House API key in `sessionStorage`** and calls the Companies House API **directly from the browser**.
- Has **no authentication** of any kind — it is a static file assumed to be used by one person on one device.
- Has **no real Trinova connection at all** — every "your businesses," "clients," and "statutory" data point is either hard-coded seed data or built from a local, in-browser data model.
- Has **no real AI behind Ask Sloane or CEO Brain classification** — both are explicit UI stubs (`askSloane()` shows an `alert()`; Brain entries are stored verbatim, always labelled "Awaiting live AI classification").
- Has **no document signing feature at all** — signing is entirely a Trinova-side production requirement defined by the Handoff, not present in the Sloane prototype.
- Has **no structured multi-director/multi-shareholder/multi-contact data model** — the prototype uses a single free-text field where production requires an agreed, structured relationship.
- Matches records **by name, not by stable ID** — production requires stable IDs throughout.

None of this means the prototype is worthless — it correctly demonstrates the product's *intended* information architecture, urgency logic (the RED/AMBER/CLEAR deadline rule, the Companies House reconciliation rule, the data-provenance labelling pattern), and visual language, all of which are worth preserving. The distinction the six files draw throughout is: **preserve the intent and the proven business logic, replace the implementation.**

## Important architectural boundaries

- **No direct database access from Sloane into Trinova, ever** — all reads/writes go through authenticated, server-to-server APIs, even on shared hosting.
- **Trinova is the source of truth** for shared client/company records, tasks, messages, documents, and workflow status. Sloane keeps a separate private database for its own data.
- **Sloane private notes stay private unless the user explicitly writes them to Trinova** — this is opt-in, per action, never an automatic sync.
- **No secrets in browser code or repositories, ever** — this rules out the prototype's Companies House pattern for production, and must never be replicated for Trinova credentials or signing-provider secrets.
- **Document signing lives in Trinova, not Sloane** — Sloane may read signing/review status via the API; it does not implement or host the signing workflow.
- **No production deployment before staging acceptance and release approval are recorded**, and **if release criteria fail during rollout, stop and roll back** rather than continuing partway.

## Important unresolved decisions

These are genuinely open in the source material — do not treat any of them as decided:

- Final signing provider, licence, and exact deployment model (gated behind an evaluation-and-approval process; the source explicitly rules out assuming commercial DocuSign).
- Exact API authentication mechanism (properties are specified — scoped, revocable, server-to-server — the specific scheme is not).
- Final API endpoint naming (must follow Trinova's existing conventions, which requires inspecting the live Trinova codebase).
- Exact database technology and infrastructure for Sloane's backend/private store.
- Final frontend framework/architecture for a production rebuild.
- The real architecture behind Ask Sloane's live AI reasoning (explicitly deferred by the prototype's own stub, and outside the Handoff's stated scope).
- The precise structure for multiple companies/contacts/directors/shareholders/message threads.
- Whether a Trinova portal note written from Sloane is staff-only or client-visible by default.
- Whether "business area" is a Sloane-only concept or needs a Trinova-side counterpart.
- Retention policy for audit evidence, signing artefacts, and CEO Brain entries.

Each of these is also listed under its relevant file's own "Open Questions / Decisions Required" section — check there for full context before making any of these calls.
