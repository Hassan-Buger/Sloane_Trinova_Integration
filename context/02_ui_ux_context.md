# 02 — UI/UX Context

> Authority: this file explains **how Sloane looks and behaves**, derived directly from the embedded CSS/markup in `sloane_command_centre_v5.html`. For what each screen means functionally see `01_product_context.md`. For how to build/evolve the client see `03_frontend_context.md`.

All values below are taken verbatim from the prototype's `<style>` block; nothing is invented.

---

## Visual identity

**Palette (CSS custom properties on `:root`):**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#080b10` | Page background base |
| `--panel` | `#10151d` | Panel background |
| `--panel2` | `#151c26` | Secondary panel / hover background |
| `--line` | `#263140` | Borders/dividers |
| `--text` | `#eef3f8` | Primary text |
| `--muted` | `#8d9aaa` | Secondary text |
| `--accent` | `#c9a66b` | Gold accent — brand mark, primary buttons, eyebrow labels, rank badges |
| `--red` | `#ff5d67` | Danger/urgent status dot |
| `--amber` | `#f3b54a` | Warning status dot |
| `--green` | `#4ed19a` | Positive/clear status dot |
| `--blue` | `#62a8ff` | Neutral/info status dot |

Body background is a radial gradient (`circle at 70% -20%, #172235 → #080b10 42%`) — not a flat fill. This is a deliberate "dark executive dashboard" aesthetic: near-black base, warm gold accent, desaturated cool-toned status colours, generous card elevation via soft box-shadows (`0 12px 30px rgba(0,0,0,.12)`).

**Status text classes** (used in the Statutory Monitor tables, distinct from the dot-based indicators used elsewhere): `.status-overdue` (`#ff8b93`, bold), `.status-red` (`#ff747d`, bold), `.status-amber` (`#f4c36b`, bold), `.status-clear` (`#6dd9aa`, bold) — all bold-weighted so urgency is never carried by colour alone; each is always paired with a text label (e.g. "RED · 6d", "PAST DATE · verify").

**Typography:** `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` — no custom font loading, relies on system/Inter availability. Sizes are set per-element (not a formal type scale): brand `22px/850`, page `<h1>` `31px`, card `<h2>` `14px`, table text `12px`, small/meta text `10–11px`.

**Spacing/density:** compact and information-dense by design — table cell padding `11px 8px`, card padding `17px`, gaps between grid items `10–14px`. This supports the "executive clarity, high information density, quick scanning" intent (see §UX principles).

**Cards:** `.card` uses a subtle vertical gradient fill, `1px solid var(--line)` border, `15px` border-radius. A dedicated `.redcard` variant (used for the Red Alerts card) swaps in a dark red-tinted gradient and border for visual severity, independent of any inner status dots.

**Do not invent exact design-token values beyond this table** — this is the complete token set present in the source.

## Layout

- **Shell:** CSS grid, `230px 1fr` — fixed-width sidebar, fluid content area (`.shell{display:grid;grid-template-columns:230px 1fr;min-height:100vh}`).
- **Sidebar (`.side`):** sticky (`position:sticky;top:0;height:100vh`), right-bordered, slightly translucent dark background, holds brand mark, nav list, and an absolutely-positioned profile block pinned to the bottom.
- **Main content (`main`):** `padding:28px 32px`, `max-width:1700px` (content doesn't stretch edge-to-edge on very wide screens).
- **Header row (`.top`):** flex row, space-between — greeting/eyebrow block on the left, "Ask Sloane" input+button on the right (`width:min(520px,46vw)`).
- **Card grids:** `.grid3` (Command Centre top row) is asymmetric — `1.15fr .92fr .92fr` — giving the "Top 3" card slightly more width than Red Alerts / Today's Diary. `.businesses` and `.stat-grid` use even 3-and-4-column grids respectively.
- **Modals:** fixed-position overlay (`rgba(0,0,0,.68)`), centred box (`min(860px,94vw)` wide, `max-height:88vh`, internally scrollable), toggled via a `.open` class that switches `display` from `none` to `grid`.

**Responsive breakpoints** (both present in the source, mobile-first is *not* used — these are max-width overrides on a desktop-first layout):

| Breakpoint | Changes |
|---|---|
| `max-width:1100px` | Sidebar hidden entirely (`.side{display:none}`) — no alternate mobile nav is provided in its place; `.grid3`/`.businesses` collapse to 2 columns; `.metrics` to 3 columns; `main` padding reduced to `20px`; `.ask` becomes full width; `.top` stacks vertically; `.bottom` becomes single column; `.stat-grid` (statutory) becomes 2 columns |
| `max-width:900px` | `.vat-grid` becomes single column |
| `max-width:700px` | `.grid3`/`.businesses`/`.stat-grid` become single column; `.metrics` becomes 2 columns; `.formgrid` (modal forms) becomes single column, `.full` no longer spans |

**Important gap:** below 1100px the sidebar (and therefore all navigation) simply disappears with no replacement affordance (no hamburger menu, no bottom nav). Any production rebuild must add a mobile navigation pattern — this is not a stylistic choice to preserve, it's a missing feature.

## Navigation

Seven sidebar buttons, each with `data-view` matching a `<section id="...">`. State transitions are handled uniformly by `switchView(id)`: hide all `.view` sections, show the target, and toggle `.active` on the matching nav button. See `03_frontend_context.md` for the exact function. Two badges are present: Command Centre's badge is a static "7"; Statutory Monitor's badge (`#statNavBadge`) is dynamically set to the count of red-flagged statutory items each time `renderStatutory()` runs.

## Components

Reusable patterns identified in the markup/CSS:

- **Stat card / metric tile** (`.card.metric`) — large number (`.n`, 25px/850) + small label underneath. Used on Command Centre's "Command pulse" row.
- **Ranked item** (`.rank`) — numbered square badge (gold border/text) used only in the "Top 3" card.
- **Status dot** (`.dot`, with `.red/.amber/.green` modifiers) — small coloured circle prefixing list items across Command Centre, Intelligence, and the "What have I missed?" modal, always paired with bold text + supporting `<small>` copy (never colour-only).
- **Pill** (`.pill`, with `.red/.amber` modifiers) — small rounded-rect badge used for business status, risk level, and the "ACTION" flag on statutory stat cards.
- **Timechip** (`.timechip`) — small rounded time-range badge on diary items.
- **Table** (`table/th/td`) — used for Client 360, Statutory deadlines, Tracker actions, VAT schedule. All share the same base style (`border-collapse`, bottom-border rows, uppercase muted headers).
- **Toolbar** (`.toolbar`) — search input + filter dropdown pattern, currently used only on Client 360.
- **Modal + form grid** (`.modal/.modalbox/.formgrid`) — two-column label/input grid, `.full` for fields that should span both columns; consistent Cancel/Save action row (`.modalactions`).
- **Empty state:** exactly one explicit empty state exists in code — the Client 360 table's "No client/company records yet…" row, rendered conditionally when `clients.length === 0`. No other view has a coded empty state (e.g. Businesses/Statutory/Brain assume seed/tracker data is always present).
- **Source/provenance badge** (`.source`, `.sourcebanner`, `.syncmeta`) — small muted text used specifically to label where a piece of data came from (see §Data provenance below).
- **Live/connection status indicator** (`.statusdot` with `.live/.off` modifiers, glow via `box-shadow:0 0 12px currentColor`) — used only in the Companies House connection box.

## Interaction behaviour

- **Clicks / view switching:** instantaneous, class-toggle based — no transitions beyond a `.view` fade-in keyframe (`opacity .5→1, translateY 3px→0` over `.16s`).
- **Modal opening/closing:** open via adding `.open` class (triggered from `openClient()`); close via `closeModal(id)` removing it (Cancel button, "Done" button in the missed-modal). **No Escape-key handling, no click-outside-to-close, no focus trap, and no return-focus-to-trigger behaviour exist in the source** — these are gaps to close in production, not existing behaviour to preserve.
- **Forms/saving:** client-side only; `saveClient()` does a single `if(!name) return alert(...)` validation, then pushes to an in-memory array and writes to `localStorage`. No loading state, no success confirmation beyond the modal closing and the table re-rendering.
- **Filtering:** live, on every keystroke/change (`oninput`/`onchange`, no debounce) — acceptable at current data volumes (dozens of records) but will need debouncing or server-side filtering once data volume or latency (real API calls) increases.
- **Status changes:** none are user-editable in this prototype (e.g. there is no "mark task complete" or "change workflow status" control anywhere) — statuses are entirely derived/read-only display.
- **Refresh/sync:** only the Companies House sync (`syncCompaniesHouse()`) and the manual "Re-run deadline engine" button (`renderStatutory()`) exist as explicit refresh actions.
- **User feedback:** limited to native browser `alert()`/`prompt()` dialogs (used for validation errors, Ask Sloane's stub response, and adding a business area) — no toast/snackbar pattern exists. A production build should not rely on blocking native dialogs for feedback.

## Responsive behaviour

Covered under §Layout above. Summary: content reflows to fewer grid columns and the sidebar disappears below 1100px with no replacement navigation; forms and tables stack to one column below 700px; tables themselves do not get horizontal scroll wrappers, so wide tables (e.g. the 9-column Client 360 table, 7-column Statutory table) will overflow on narrow viewports.

## UX principles

Derived only from what the source actually optimises for:

- **Executive clarity:** the Command Centre leads with "what needs you" (Top 3, Red Alerts) before any raw data table — urgency-first ordering.
- **High information density:** compact padding, 12px table text, multi-column grids — this is a working dashboard for someone who wants a lot on screen, not a spacious consumer app.
- **Quick scanning:** consistent left-aligned dot/pill/badge vocabulary lets status be read at a glance across every screen.
- **Clear urgency, always text-backed:** every colour-coded status (dots, pills, status classes) carries an explicit text label alongside colour — this must be preserved for accessibility (see below) and because it's core to the "Sloane rule" urgency model.
- **Action-oriented information:** the Statutory Monitor's risk banner states the exact urgency rule in plain language on the page itself ("overdue = RED; due within 14 days = RED; 15–30 days = AMBER; 31+ days = CLEAR"), and the Tracker Actions table pairs every issue with an explicit "Action" column — the product consistently tells the user not just what's wrong but what to do.
- **Minimal friction to capture:** CEO Brain and "+ Add area" are deliberately low-friction (single textarea / native prompt) rather than structured forms, reflecting that this is a fast-capture tool for one person, not a data-entry system for a team.

## Data provenance

The prototype already has a real, working pattern for this — preserve and extend it:

- Every statutory record carries a `source` string (e.g. `"Companies House live · Trinova filing tracker · source workbook dated Aug 2026"` vs the plain tracker source), rendered in the table's rightmost column via `.source` styling.
- The Statutory Monitor page includes a standing `.sourcebanner` explaining that past dates mean "verify," not "confirmed still outstanding" — an explicit prototype-level acknowledgement of data staleness.
- The Companies House connection box uses a live/off status dot plus `syncmeta` text stating exactly when the last sync ran and how many records succeeded/failed.
- Client 360 records added manually are tagged `source: 'Client 360 record'` when merged into the statutory view (`allStatRecords()`), distinguishing them from tracker-derived rows.

**Requirement for any successor UI:** every piece of data whose truth depends on an external system (Trinova, Companies House, Outlook) must visibly communicate: local vs Trinova vs Companies House vs manually entered; synchronized vs stale vs pending verification vs unavailable. Do not silently blend sources without a visible marker, as the current pattern already demonstrates is achievable.

## Accessibility

Practical gaps and requirements, assessed against the actual markup:

- **Keyboard navigation:** nav buttons and form controls are native `<button>`/`<input>`/`<select>` elements (good — inherently focusable/keyboard-operable), but modals have no focus trap and no Escape-to-close, so keyboard users can tab out of an open modal into the hidden page behind it.
- **Focus states:** no custom `:focus` styling is defined anywhere in the CSS — relies entirely on browser default outlines, which may be visually inconsistent against the dark theme (default blue focus rings against `--bg:#080b10` should be checked for contrast, not assumed adequate).
- **Readable contrast:** primary text (`#eef3f8` on `#080b10`) is high-contrast; muted text (`#8d9aaa`) and some status colours (e.g. amber `#f3b54a`/`#f4c36b` on dark backgrounds) should be contrast-checked against WCAG AA before production, especially where status colour is the *only* visual weight on small text.
- **Semantic controls:** modal "dialogs" are plain `<div>`s with no `role="dialog"`, no `aria-modal`, no labelled-by relationship to their heading — should be added.
- **Form labels:** the Client 360 modal correctly wraps every input in a `<label>` with visible text (good pattern to preserve) — extend this to any new forms.
- **Status communication:** already text+colour paired throughout (see above) — a genuine strength to preserve, not just an accessibility patch.
- **Responsive usability:** as noted, sidebar navigation vanishing with no alternative below 1100px is an accessibility and usability defect, not a preserved design decision.

**Do not radically redesign the product.** The instruction here is to close the gaps above (focus handling, ARIA roles, mobile nav) within the existing visual language — dark theme, gold accent, dot/pill/badge vocabulary — not to reskin Sloane into a different product.

---

## Open Questions / Decisions Required

- Whether a formal design-token/typography scale should be established (the current sizes are ad hoc, defined per-selector) as the UI grows beyond this single-file prototype.
- What mobile/narrow-viewport navigation pattern replaces the sidebar below 1100px.
- Target contrast/accessibility conformance level (e.g. WCAG AA) — not specified in either source document.
