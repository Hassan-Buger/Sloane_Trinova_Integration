# Spec: two-way task sync between Sloane and the TriNova portal

For the TriNova portal developer. Developer-only; not for Kirsty.

## Where things stand

- Sloane **reads** from the portal today: clients (`GET /clients`) and filing deadlines (`GET /statutory`), with a bearer key (`TRINOVA_API_KEY`).
- The portal API has **no task routes that Sloane has found**, so tasks exist only in Sloane. Nothing is sent to the portal, and nothing a portal user does with a task reaches Sloane.
- Two-way sync is therefore **not built**. It needs the portal to offer the routes below (or equivalent). Sloane's side is ready to plug in once they exist.

## What Sloane needs from the portal

All routes under the same base URL and key as today (a key with read **and** task-write scope; the existing read key should stay read-only).

| Route | Purpose |
|---|---|
| `GET /tasks?updated_since=<ISO time>&page=&per_page=` | Tasks created or changed in the portal since the last pull (include deleted/cancelled ones, flagged) |
| `POST /tasks` | Create a task from Sloane |
| `PATCH /tasks/{id}` | Change a task from Sloane (status, due date, assignee, notes) |
| `GET /staff` (or `/users`) | Portal user ids and names, so assignees can be matched |

Task fields wanted (portal name on the left is a suggestion; Sloane maps whatever the portal uses):

`id`, `client_id`, `title`, `description`, `status` (open / in progress / done / cancelled), `priority`, `due_date`, `assignee_id`, `department`, `created_at`, `updated_at` (server time, must change on every edit), and `external_ref`.

`external_ref` matters most: when Sloane creates a task it sends its own id; the portal stores it and returns it. That is how the two sides avoid duplicates.

## How Sloane would sync (to build once the routes exist)

1. Every few minutes, `GET /tasks?updated_since=<last pull>`; for each task, match by `external_ref` (else portal `id`); create or update the Sloane task; keep `portalId` on it.
2. When a Sloane task is created or changed, `POST` / `PATCH` it, and store the returned `id` and `updated_at`.
3. **Conflict rule (proposed):** the later `updated_at` wins field by field; status "done" from either side wins over "open". Sloane-only fields (progress notes, repeat, dependencies, links, next action) are never overwritten by the portal.
4. Deletes: a task deleted in Sloane goes to the Sloane Bin and is marked cancelled in the portal (never hard-deleted there).
5. Retries with a queue, so a portal outage never loses a change; the Settings page shows "last synced" and how many changes are waiting.

## Questions for the portal developer

- Do the routes above exist, or can they be added? What are the real field names and status values?
- Is there a webhook or event feed, so Sloane can be told about changes instead of asking every few minutes?
- Which portal user ids map to the staff on Sloane's Team page?
- Are tasks per client only, or can there be general tasks?
- Can the key be limited to tasks (so a leaked key cannot touch client data)?

## What Sloane will not do

It will not delete portal data, and it will not change anything outside tasks.
