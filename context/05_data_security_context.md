# 05 — Data Security & Governance Context

> Authority: this file governs **data ownership, privacy, secrets, and audit requirements** across the whole system. It draws on the Developer Handoff for production rules and on the prototype (`sloane_command_centre_v5.html`) only to identify what must change. See `04_backend_integration_context.md` for how the API itself is built, and `06_testing_deployment_context.md` for how these rules get verified.

---

## 1. Data ownership

### Trinova-owned / shared data

Per the Handoff's architecture requirements and read/write contract (`04_backend_integration_context.md` §4–5), Trinova is the source of truth for:
- Client and company records (identity, company number, directors/shareholders, contacts)
- Services and team assignment
- Workflow/status and tasks
- Document requests
- Messages/conversations
- Uploaded documents
- Activity feed
- Review/sign-off items
- Signing requests, signed documents, and signing audit evidence (§10, Trinova-side)

### Sloane-private data

Per the Handoff's explicit statement that "Sloane must remain a separate private application" with its own database, and the prototype's actual behaviour:
- **CEO Brain entries** (`brain` in the prototype, `sloane_brain_v1`) — free-text notes explicitly captured for Kirsty alone, currently unclassified ("Awaiting live AI classification").
- **Client 360 `notes` field** — private CEO notes on a client/company record, distinct from anything Trinova would show a client or staff member.
- **Business-area metadata** (`businesses`) — Sloane's own organisational grouping, not confirmed to map onto any Trinova structure (open question, see `01_product_context.md` and `04_backend_integration_context.md`).
- Any future Sloane-only application state (e.g. Ask Sloane conversation history, if retained).

**Do not assume data is private unless supported by the source.** Where it is ambiguous whether a field is Trinova-owned or Sloane-private (for example, whether a portal note is staff-only or client-visible in Trinova), treat it as an open question requiring confirmation (see `04_backend_integration_context.md` §Open Questions), not as a default-private or default-shared assumption.

## 2. Privacy boundary

> **Sloane private notes remain private unless the user explicitly performs an action that writes information to Trinova.**

This is the single most important governance rule in the system and applies system-wide:
- Writing to Trinova is always an **explicit, opt-in user action** — never an automatic background sync of Sloane-private content.
- This applies specifically to CEO Brain entries and Client 360 private notes, and to any future Sloane-private data category.
- A production implementation must make the write-to-Trinova action visibly distinct in the UI from ordinary Sloane-local saving (per `02_ui_ux_context.md`'s existing provenance-labelling pattern — extend it to cover "this will become visible in Trinova" as its own explicit state, not just "saved locally").

## 3. Access control

- **Authorization:** every Trinova read, write, and file download checks the authorised actor (per `04_backend_integration_context.md` §8) — this is enforced server-side, not assumed from a trusted client.
- **Role/permission awareness:** Sloane's backend integration must **reuse existing portal validation and permissions** rather than reimplementing an independent permission model — per the Handoff's first-stage review instruction.
- **Document access:** file contents are only readable with authorised access; Trinova's existing document permission rules extend to signing invitations, signed outputs, and audit files (§10 signing controls).
- **Client access:** Sloane itself remains accessible only to its single authorised private user (Kirsty) — this is a product-level access rule, not just an API one.
- **Signing access:** enforced per the approved signing workflow — link expiry and recipient access rules apply to every signing invitation.
- **Write permissions:** every write operation is validated against permitted transitions/existing portal rules (e.g. workflow status changes only via allowed transitions) — Sloane cannot bypass Trinova's own state machine.

## 4. Secrets

- **No secrets in frontend code.** This directly rules out the prototype's current Companies House pattern (API key typed into a page, Basic-auth-encoded, sent from browser `fetch()`) as a production approach — see `03_frontend_context.md` and `04_backend_integration_context.md` §9 for the required server-side replacement.
- **No secrets in source control / public repositories.**
- **Server-side credentials only**, scoped and revocable, for Trinova API access, Companies House access, and the signing provider.
- **Environment separation:** staging credentials and data are kept separate from production (see `06_testing_deployment_context.md` §Staging and §Production readiness).
- **Rotation/revocation:** credentials must be revocable and, implicitly, rotatable without requiring a code change (i.e. configuration-driven, not hard-coded) — consistent with the hosting requirement to "keep API URLs and credentials configurable."

## 5. Document security

- **Permissions:** signing-related documents inherit Trinova's existing document permission rules (§3 above).
- **Secure storage:** files are stored privately; secrets stay server-side; file types and sizes are validated on upload.
- **Original vs signed documents:** the original document and the completed signed version are preserved **separately** — the signed file must never overwrite the original.
- **Signed document retrieval:** authorised users can download both the original and the signed output; failed retrieval attempts are retried rather than silently dropped, with an actionable pending/error state shown.
- **Audit evidence:** stored and linked to the original signing request and the correct client/company.
- **Unauthorized access prevention:** the same authorisation checks that apply to ordinary Trinova documents apply to invitations, signed outputs, and audit files — signing artefacts are not a separate, less-protected category.

## 6. Audit logging

Per the Handoff, the following must be auditable — recording **actor, action, record, and time** on every write:
- Writes generally (tasks, notes, documents, messages, workflow changes)
- Workflow/status changes specifically (permitted-transition enforcement plus a record of who changed what)
- Task creation/updates/completion
- Messages sent
- Documents uploaded/downloaded
- **Signing events** specifically, with the additional detail: **provider request ID**, signer details, timestamps, document version, and audit evidence — retained and linked to the original request.

Access itself is also recorded: "check the authorised actor and record access on every read, write, and file download" — i.e. audit logging covers reads (at least access events), not only writes.

## 7. Logging rules

Logs must **not** expose:
- Credentials (Trinova API credentials, Companies House keys, signing-provider secrets)
- Private notes (CEO Brain content, Client 360 private notes)
- Document contents
- Sensitive tokens (session tokens, signing invitation links/tokens)

This is stated directly in the Handoff ("redact credentials and sensitive content from logs") and extends naturally to Sloane-private content given the privacy boundary in §2 — a log line that includes the text of a CEO Brain entry or a private client note is as much a leak as one that includes a credential.

## 8. Data integrity

Defenses required against:
- **Duplicate writes** — idempotency for task creation, messages, and uploads (see `04_backend_integration_context.md` §5, §7).
- **Stale updates** — record versions or an equivalent conflict check before accepting an update.
- **Replayed webhooks** — signing event processing must be idempotent and handle duplicate, delayed, and out-of-order updates safely (§10c in `04_backend_integration_context.md`).
- **Invalid IDs** — reject requests referencing IDs that don't exist or don't belong to the caller's scope.
- **Partial updates** — use transactions where an operation touches related records, so a failure partway through doesn't leave inconsistent state.
- **Unauthorized access** — enforced per §3 above, on every read/write/download.
- **Mismatched client/company relationships** — every record returned or written must be linked to the correct client/company ID; this is both a read-contract requirement (`04_backend_integration_context.md` §4) and an integrity safeguard (a note or document attached to the wrong company is a data-integrity failure, not just a UX bug).

## 9. Environment isolation

- **Staging credentials** are isolated from **production credentials.**
- **Staging data** uses test accounts, test documents, and — where necessary — **masked production-like data**, not a raw copy of production data.
- **Test signing:** no real signing invitations are sent to real clients during staging testing.
- **Test email:** staging uses isolated/test email delivery, not real client-facing notifications.
- **Database separation:** staging and production databases are distinct; **the staging database is never copied over production** (explicitly stated as a production-release rule, not just a staging-setup nicety).
- **Configuration separation:** secrets, storage, email, API URLs, and signing callbacks are all configured independently per environment.

Full staging/production procedure lives in `06_testing_deployment_context.md`.

## 10. Browser storage risks

The prototype's current use of `localStorage`/`sessionStorage` (documented fully in `03_frontend_context.md`) must **not be assumed to be secure production storage**, for reasons directly relevant to this file's scope:

- `sloane_businesses_v1`, `sloane_clients_v1`, `sloane_brain_v1` (including the private `notes` field), and `sloane_ch_live_v1` are stored **unencrypted, in plain JSON, per-browser**, with no access control beyond physical/session access to that browser profile. This is a materially weaker protection than the access-control and audit requirements in §3 and §6 above.
- `sloane_ch_key` in `sessionStorage` is a live, working API credential stored client-side — this is precisely the anti-pattern §4 (Secrets) prohibits, and it is trivially readable via browser developer tools by anyone with access to that browser tab.
- Because CEO Brain and Client 360 `notes` are the system's most sensitive content (per the privacy boundary in §2), storing them in unencrypted browser storage is a materially higher risk than storing, say, a cached list of business names — sensitivity, not just data type, should drive the level of protection any interim storage approach uses.
- Any browser-side storage retained in production (e.g. a genuinely low-sensitivity, per-viewer UI preference) must be a deliberate, scoped exception — not the default persistence mechanism it currently is.

---

## Open Questions / Decisions Required

- Whether a Trinova portal note written by Sloane is staff-only or client-visible by default (see `04_backend_integration_context.md` — this is a data-visibility decision with direct security implications, not yet resolved).
- Exact credential storage/rotation mechanism for the production backend (a secrets manager, environment variables, or another approach — not specified).
- Whether any Sloane-private data will ever be encrypted at rest in its private database, and to what standard — not addressed in either source document.
- Retention policy for audit evidence, signing artefacts, and CEO Brain entries — not specified in either source.
