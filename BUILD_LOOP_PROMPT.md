# Sloane ⇄ Trinova Integration — Autonomous Build Loop Prompt

Paste this whole prompt into your coding agent (Claude Code, Cursor, Codex, etc.) inside the `Sloane_Trinova_Integration/` folder to start — and keep re-running — the build. It is written so the agent can execute it repeatedly, session after session, without you re-explaining the project each time.

Everything this prompt tells the agent to do is a restatement or direct application of the six context files in `context/` — it introduces no new requirements, invents no architecture, and picks no unresolved decision on its own.

---

## MASTER PROMPT — paste everything below this line

You are the implementation engineer for the **Sloane ⇄ Trinova integration and Trinova document-signing** project. You are working inside the `Sloane_Trinova_Integration/` folder. A `context/` folder inside it contains the authoritative engineering context: `README.md`, `01_product_context.md` through `06_testing_deployment_context.md`, and `progress-tracker.md`. `CLAUDE.md` (or `AGENTS.md`) at the project root is your reading-order entry point.

**Before doing anything else in this session:**
1. Read `CLAUDE.md` (or `AGENTS.md`) and, in the order it specifies, every file in `context/`.
2. Read `context/progress-tracker.md` last, since it tells you where the project actually stands right now — do not assume Session 1 just because this is a fresh conversation.
3. If a `context/specs/00-build-plan.md` already exists, read it and every spec file already in `context/specs/` before doing anything else.

You now enter a **loop**. Each pass through the loop is one unit of work. Keep looping — picking up the next unit, implementing it, verifying it, recording it, moving on — until either (a) the build plan is fully complete, or (b) you hit one of the **hard stop conditions** below, in which case you stop looping, report clearly, and wait for a human.

---

### STAGE 0 — First-stage review (must complete before any implementation unit)

Per `context/06_testing_deployment_context.md` §1–2 and `context/04_backend_integration_context.md` §3, do not write integration code until this stage's outputs exist and open questions are confirmed. If `context/progress-tracker.md` shows this stage incomplete, your current unit of work *is* Stage 0, not feature code. Stage 0 consists of:

1. **Inspect current infrastructure** — the Sloane project, the Trinova repository and staging access, schema/migration history, and a sample document with the required signing workflow. If you do not have access to one or more of these, do not proceed past this point for the affected area — record the gap in `context/progress-tracker.md` under "Open Questions" and treat it as a **hard stop** for anything depending on it.
2. **Inspect existing Trinova routes, authentication, client/company relationships, document storage, tasks, messages, status rules, and audit records.** You must reuse existing portal validation and permissions — do not design a parallel permission model.
3. **Produce `context/field-mapping.md`** using the exact column structure defined in `context/06_testing_deployment_context.md` §2 (Trinova field / Sloane field / direction / type / required-optional / transformation / validation / relationship), covering every entity listed in `context/04_backend_integration_context.md` §4–5. Use real inspected values — never invent a table/column name, a type, or a relationship you have not actually confirmed.
4. **Flag missing fields, unclear relationships, absent features, and any proposed schema change to the human reviewer before doing anything else with the affected functionality.** Write these into `context/progress-tracker.md` "Open Questions" with enough detail that a non-technical stakeholder (Hamza, per the source material) could approve or reject them. **Do not invent data or silently expand scope to work around a gap.**
5. **Produce a hosting-findings note** (compute, memory, database connections, storage, deployment isolation on the existing shared hosting account) per `context/04_backend_integration_context.md` §11.
6. **Produce the signing-provider evaluation** per `context/04_backend_integration_context.md` §10a and the checklist in §10d. Do not pick a provider — present findings against the checklist and flag the recommendation for human approval. This evaluation and its approval is a **hard stop gate**: no provider-specific signing code may be written until the human has confirmed the solution, licence, and workflow.

Only once every item above is either complete or explicitly logged as an open question pending a human answer do you move to Stage 1.

---

### STAGE 1 — Build plan

Once Stage 0's outputs exist (even if some open questions remain pending — non-blocking ones can proceed in parallel, blocking ones cannot), decompose the remaining work into **units** and write them to `context/specs/00-build-plan.md`.

A unit is one verifiable result that stays within a single system boundary (don't mix schema design + API implementation + frontend wiring in one unit) and can be completed in one focused session. Bad unit: "build the API." Good unit: "implement the `GET /api/v1/clients/{id}` read endpoint, covering the client/company/directors/shareholders/contacts read contract in `04_backend_integration_context.md` §4, including the empty/unavailable/unsupported field distinction, with tests."

**Sequencing rules, derived directly from the context files:**
- Follow the delivery sequence in `context/06_testing_deployment_context.md` §1: field mapping → API contract → backend integration → signing workflow → staging tests → approval → production prep → deploy → smoke test → monitor → handoff. Do not reorder this without a documented reason tied back to the source material.
- Security and auth-checking units come before the functional units they protect (`context/05_data_security_context.md` §3).
- Read endpoints before write endpoints, and both before any frontend wiring that consumes them (Sloane's own frontend work is out of scope for this project — see "Out of scope" below).
- Companies House server-side integration (`context/04_backend_integration_context.md` §9) is its own unit, separate from the general API work, and must fully replace — never coexist in production with — the prototype's client-side Companies House call documented in `context/03_frontend_context.md`.
- Document-signing units cannot start until the Stage 0 signing-provider evaluation is human-approved (hard stop, see above).
- Install dependencies just-in-time, only in the unit that first needs them.
- Merge any two units that are always done together or that have no standalone verifiable result.

For each unit, write a spec file `context/specs/NN-unit-name.md` with five sections:
- **Goal** — one to two concrete sentences.
- **Design** — the exact requirement(s) from the context files this unit implements, cited by file and section (e.g. "per `04_backend_integration_context.md` §5, implement task creation with idempotency key support").
- **Implementation** — broken into sub-sections, one per component/boundary.
- **Dependencies** — packages/services needed, explicitly listed.
- **Verification checklist** — specific pass/fail conditions, drawn from `context/06_testing_deployment_context.md`'s relevant test-coverage section (read/write/auth/reliability/signing/regression as applicable to this unit).

---

### STAGE 2 — The loop itself

For each unit, in build-plan order, repeat this cycle:

**1. Implement.**
Read the unit's spec file in full. Read `context/progress-tracker.md` to confirm no dependency of this unit is still open. Mark the unit "In Progress" in `context/progress-tracker.md`. Implement it exactly as specified — do not go beyond the scope of this unit, and do not "improve" adjacent code that isn't part of this unit's spec.

While implementing, continuously check your output against these standing rules (they apply to every unit, not just some):
- No direct Trinova database access — API only (`04_backend_integration_context.md` §1).
- Stable IDs, never names, as record references (`04_backend_integration_context.md` §6).
- Distinguish empty vs unavailable vs unsupported data on every read path (`04_backend_integration_context.md` §4).
- Every write records actor/action/record/time and enforces authorization first (`05_data_security_context.md` §3, §6).
- Idempotency on task creation, messages, and uploads specifically (`04_backend_integration_context.md` §5, §7).
- No secrets anywhere in code, browser-reachable config, or version control (`05_data_security_context.md` §4).
- No credentials, private note content, document contents, or tokens in logs (`05_data_security_context.md` §7).
- Sloane-private data (CEO Brain, private notes) is never written to Trinova except via an explicit user action — never an automatic sync (`05_data_security_context.md` §2).
- Signing: original and signed documents are never the same stored file; webhook/poll processing is idempotent and handles duplicate/delayed/out-of-order events (`04_backend_integration_context.md` §10c).
- Staging and production credentials, data, and configuration stay separate at every point — never write code that could copy staging data into production or vice versa (`05_data_security_context.md` §9, `06_testing_deployment_context.md` §9–10).

**2. Verify.**
Run the unit's verification checklist from its spec file. Write and run tests corresponding to the relevant coverage section(s) of `context/06_testing_deployment_context.md` (§3 Read, §4 Write, §5 Auth/security, §6 Reliability, §7 Signing, §8 Regression — use whichever apply to this unit). A unit is not complete until its checklist passes.

**3. Reconcile docs.**
If implementing this unit revealed that a context file was wrong, incomplete, or needs updating (e.g. you discovered an actual Trinova field/route that differs from what was assumed, or resolved one of the "Open Questions" listed in a context file) — **update that context file now**, in the same pass, and note the change in `context/progress-tracker.md` under "Architecture Decisions." Do not let code and documentation drift apart.

**4. Close.**
Mark the unit complete in `context/progress-tracker.md` (move it from "In Progress" to "Completed," with a one-line result summary). Update "Next Up" to the following unit in the build plan. Commit the work with a message referencing the unit (e.g. `feat/03-client-read-endpoint`) if version control is in use.

**5. Continue the loop.**
Immediately proceed to the next unit in `context/specs/00-build-plan.md`, unless you hit a hard stop condition below — in which case, stop, report, and wait.

---

### Hard stop conditions — do not loop past these

Stop the loop, write a clear summary of what's blocking you into `context/progress-tracker.md` under "Open Questions," and wait for a human response, if any of the following occurs:

1. **A field, relationship, or feature Trinova should have is missing, ambiguous, or would require a schema change**, per Stage 0's "flag before starting additional work" instruction (`04_backend_integration_context.md` §3) — this applies for the whole project, not only during Stage 0.
2. **You are about to implement provider-specific signing code and the signing solution/licence/workflow has not been human-approved** (`04_backend_integration_context.md` §10a).
3. **You are about to deploy to, or configure, production, and staging acceptance + release approval are not recorded** (`06_testing_deployment_context.md` §1, "no production deployment until staging acceptance and release approval are recorded").
4. **A release criterion fails during a smoke test or rollout.** Per `06_testing_deployment_context.md` §12: stop rollout and follow the rollback plan, preserving any new production records and signed documents already created. Do not continue deploying the rest of the system because part of it works.
5. **You would need to guess or invent a value** — a field mapping, an API route name, an authentication scheme detail, a database technology, a provider choice, or anything else listed under any context file's "Open Questions / Decisions Required" section, or in `README.md`'s consolidated list. Log it as an open question instead of guessing.
6. **You would need to write Sloane-private content (CEO Brain, private client notes) into Trinova without an explicit, current-session user action authorizing that specific write** (`05_data_security_context.md` §2).
7. **You would need to store a real credential (Trinova API credential, Companies House key, signing-provider secret) anywhere client-reachable** — browser code, a public repo, or an unencrypted config file that isn't server-side-only.

When you hit a hard stop, do not silently skip the blocked unit and move to an unrelated one that depends on it — re-check the build plan for units that don't depend on the blocker and continue those instead, or, if everything remaining depends on the blocker, stop entirely and report.

---

### Out of scope — do not build these

Per `context/01_product_context.md` §Product boundaries and the Developer Handoff's stated responsibility split:
- **Sloane's own frontend/UI.** Kirsty's team owns Sloane's interface and functionality. This project's job is the backend, the API connection, integration support, and the Trinova signing workflow — coordinate the API contract, do not rebuild Sloane's interface.
- **The document-signing UI/flow inside Sloane.** Signing lives inside Trinova (`01_product_context.md` §Document Signing); Sloane, at most, reads signing/review-item status via the API.
- **Ask Sloane's AI backend and CEO Brain's classification AI.** Both are explicitly out of this project's scope per `context/01_product_context.md` and `context/03_frontend_context.md` — they belong to Sloane's own development track.
- **Anything not named in a context file's read/write contract, API design, or signing workflow sections.** If a feature idea seems useful but isn't in the context files, log it as an open question rather than building it.

---

### Reporting format after each loop pass

At the end of each unit (whether closed successfully or stopped on a hard-stop condition), report in this shape so a human can skim progress at a glance:

```
Unit: NN-unit-name
Status: Completed | Blocked | In progress
Summary: <one or two sentences>
Verification: <which checklist items passed>
Docs updated: <which context files changed, if any>
Open questions raised: <list, or "none">
Next unit: <name, or "none — build plan complete", or "blocked, awaiting human input">
```

---

### When to stop looping entirely

Stop treating this as a loop and hand back full control to the human when:
- The build plan is fully complete, all units closed, and `context/06_testing_deployment_context.md` §13's final handoff deliverables all exist, **or**
- Every remaining unit is blocked on an open question or an approval gate, **or**
- The human explicitly tells you to stop.

Report which of these applies, and the current state of `context/progress-tracker.md`, at that point.
