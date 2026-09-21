# Sloane — Private CEO Command Centre

This directory contains the production-grade implementation of the **Sloane CEO Command Centre** for Kirsty Allen.

---

## 1. Architectural Principles

1. **Private Workspace Boundary:** Sloane is Kirsty's private single-user executive cockpit. It remains isolated from Trinova's multi-user portal.
2. **Opt-in Privacy Boundary:** CEO Brain entries and private client notes stay strictly in Sloane's private store. Transferring any note to Trinova requires an explicit, confirmed user action with an audit trail.
3. **Server-Side Companies House Reconciliation:** Computes deadlines dynamically against the real current date, promotes strike-offs and overdue filings to RED, suppresses dissolved filings, and clearly tags data provenance (`Companies House live` vs `Tracker-derived`).
4. **Trinova `/api/v1` Client Layer:** A clean, asynchronous API client module (`scripts/services/api.js`) equipped with stable IDs, idempotency headers, and the 3-state data contract (`empty` vs `unavailable` vs `unsupported`). Includes a local seed adapter for immediate standalone operation.
5. **Accessibility & Responsive Polish:** Accessible modals with focus trapping, Escape-to-close, ARIA dialog attributes, and a dedicated mobile navigation drawer below 1100px.

---

## 2. Directory Structure

```
Sloane/
├── index.html                  # Main application entry point & semantic HTML5 shell
├── styles/
│   ├── tokens.css              # Design tokens (dark palette, gold accent, status colors)
│   ├── layout.css              # Grid shell, sticky sidebar, responsive breakpoints
│   ├── components.css          # Cards, tables, pills, dots, modals, toasts
│   └── views.css               # View-specific styles for all 7 areas
├── scripts/
│   ├── app.js                  # Main controller, router, reactive renderers
│   ├── data/
│   │   └── seed.js             # Authoritative filing tracker, VAT schedule, & businesses
│   ├── services/
│   │   ├── api.js              # Trinova /api/v1 client with mock/standalone adapter
│   │   ├── reconciliation.js   # Statutory deadline calculation & CH merge engine
│   │   └── storage.js          # Encapsulated state storage with private/shared separation
│   └── components/
│       ├── modal.js            # Accessible modal manager (focus trap, ESC handling)
│       └── toast.js            # Non-blocking executive toast notification system
└── README.md                   # This documentation
```

---

## 3. Running Locally

Sloane is built using modular Vanilla ES6 JavaScript and CSS3 with zero build dependencies.

To run locally:
```bash
# Using Python
python -m http.server 8000 --directory Sloane

# Or using Node
npx serve Sloane -p 8000
```
Then navigate to `http://localhost:8000` in your web browser.

---

## 4. Connecting to Trinova API

To switch from standalone mock mode to a live Trinova backend:
1. Configure `StorageService.setTrinovaApiUrl('https://your-trinova-domain/api/v1')`.
2. The `ApiService` automatically routes read/write requests to the live endpoints, passing `Idempotency-Key` headers on mutations.
