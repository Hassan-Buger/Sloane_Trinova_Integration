# Sloane ⇄ Trinova Integration — Agent Entry Point

Read the following in order before implementing or making any architectural decision. Do not skip any of them, and do not begin coding before completing Stage 0 (see `BUILD_LOOP_PROMPT.md`).

1. `context/README.md` — how these files relate, reading order, authority map
2. `context/01_product_context.md` — what Sloane is and does
3. `context/02_ui_ux_context.md` — Sloane's visual/interaction system
4. `context/03_frontend_context.md` — the existing Sloane prototype, function by function
5. `context/04_backend_integration_context.md` — the Sloane⇄Trinova API and signing architecture (**primary spec for this build**)
6. `context/05_data_security_context.md` — data ownership, privacy boundary, secrets, audit
7. `context/06_testing_deployment_context.md` — delivery sequence, testing, staging, release gates
8. `context/progress-tracker.md` — current phase, completed work, open questions, next steps

Then read `BUILD_LOOP_PROMPT.md` for how to work: the build loop, unit sequencing, and the hard stop conditions.

**Update `context/progress-tracker.md` after every meaningful change.** If implementation reveals that an architecture, scope, or standard documented in a context file is wrong or incomplete, update that context file before continuing — do not let the code and the docs drift apart.
