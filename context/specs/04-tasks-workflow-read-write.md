# Unit 04: Tasks & Workflow Read/Write API with Idempotency

## 1. Goal
Implement read, creation, update, and completion endpoints for tasks and workflow status changes, enforcing Trinova's existing completion rules, permitted status state machines, idempotency keys on creation, and audit logging.

## 2. Design
- **Read & Write Operations:** Per `context/04_backend_integration_context.md` §4–5, Sloane reads outstanding tasks and workflow status, and writes task creations, updates, completions, and workflow status transitions.
- **Trinova Business Rules:** Per `04_backend_integration_context.md` §5, task completion must use Trinova's existing completion rules, and workflow status transitions must strictly follow permitted portal transitions (no arbitrary state bypassing).
- **Idempotency:** Per `04_backend_integration_context.md` §5 & §7, task creation requires an `Idempotency-Key` header (UUID v4) to prevent duplicate creation upon network retry.
- **Audit & Authorization:** Per `05_data_security_context.md` §3 & §6, every write must verify the acting user's authorization and log actor, action, record, and timestamp.

## 3. Implementation
### 3.1 Task Read Endpoints
- Implement `GET /api/v1/companies/{companyId}/tasks` and `GET /api/v1/tasks` (with company/status filter).
- Return task attributes: `id`, `title`, `description`, `dueDate`, `status`, `assignedTo`, `companyId`, `createdAt`.

### 3.2 Task Creation & Update Endpoints
- Implement `POST /api/v1/companies/{companyId}/tasks`:
  - Validate required header: `Idempotency-Key`.
  - Check idempotency store; if key exists, return stored response without re-executing.
  - Validate task fields server-side (title required, valid company ID).
  - Persist task, record actor ID, write audit log entry, and cache idempotency result.
- Implement `PATCH /api/v1/tasks/{id}`:
  - Verify task exists and actor has edit permissions.
  - Support updating title, description, due date, and assignee.
  - Check version / timestamp to detect and reject stale updates.

### 3.3 Task Completion & Workflow Transitions
- Implement `POST /api/v1/tasks/{id}/complete`:
  - Enforce Trinova's existing validation and completion requirements (e.g. required completion notes or prerequisites).
  - Transition task status to `Completed` using portal rules.
  - Trigger existing portal notifications if applicable (avoiding duplicate notifications).
- Implement `POST /api/v1/companies/{companyId}/workflow`:
  - Enforce permitted status transitions against Trinova's state machine.
  - Reject invalid or backwards transitions with `422 Unprocessable Entity`.

## 4. Dependencies
- Trinova Task and Workflow data models / state machine rules.
- Idempotency storage (Redis or database table with TTL).
- Audit logger from Unit 01.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §4 (Write Testing) & §6 (Reliability):
- [ ] Task creation without required fields is rejected with `422 Unprocessable Entity`.
- [ ] Task creation with valid `Idempotency-Key` creates task successfully.
- [ ] Repeating identical task creation request with same `Idempotency-Key` returns original response without creating duplicate task.
- [ ] Task update verifies actor permission and updates fields cleanly.
- [ ] Outdated / stale update attempts are rejected with conflict error.
- [ ] Task completion enforces Trinova completion rules.
- [ ] Workflow status change adheres strictly to permitted state transitions.
- [ ] Unpermitted workflow transition is rejected with clear error.
- [ ] Actor, action, task ID, and timestamp are captured in audit records on every mutation.
