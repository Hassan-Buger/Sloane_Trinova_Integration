/**
 * Automated Test Suite for Unit 04: Tasks & Workflow Read/Write API with Idempotency
 * Validates compliance with:
 * - context/specs/04-tasks-workflow-read-write.md
 * - context/04_backend_integration_context.md §4–5, §7
 * - context/05_data_security_context.md §3, §6
 * - context/06_testing_deployment_context.md §4 & §6
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { idempotencyStore } from '../src/middleware/idempotency.js';
import { auditStore } from '../src/middleware/audit.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

describe('Unit 04: Tasks & Workflow Read/Write API with Idempotency', () => {
  const TEST_PORT = 4996;
  let server;
  let baseUrl;

  const READWRITE_HEADER = {
    'Authorization': `Bearer ${TEST_API_KEY}`,
    'Content-Type': 'application/json'
  };

  const READONLY_HEADER = {
    'Authorization': `Bearer ${TEST_READONLY_KEY}`,
    'Content-Type': 'application/json'
  };

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(TEST_PORT, () => {
        baseUrl = `http://localhost:${TEST_PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // --- 1. Task Read Endpoints ---

  test('Read contract: GET /api/v1/tasks requires authentication', async () => {
    const res = await request('/api/v1/tasks');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
  });

  test('Read contract: GET /api/v1/tasks returns list with company and assignee filters', async () => {
    const res = await request('/api/v1/tasks', { headers: READONLY_HEADER });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 4);

    // Filter by company
    const filteredRes = await request('/api/v1/tasks?companyId=comp_woofington_park_01', { headers: READONLY_HEADER });
    assert.strictEqual(filteredRes.status, 200);
    assert.ok(filteredRes.body.data.every(t => t.companyId === 'comp_woofington_park_01'));
  });

  test('Read contract: GET /api/v1/companies/:id/tasks returns company specific tasks', async () => {
    const res = await request('/api/v1/companies/comp_rgb_elevations_01/tasks', { headers: READONLY_HEADER });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.meta.companyId, 'comp_rgb_elevations_01');
    assert.strictEqual(res.body.data[0].id, 'tsk_rgb_reconciliation');
  });

  // --- 2. Idempotency & Creation Tests ---

  test('Idempotency: Task creation rejects missing Idempotency-Key header with 400', async () => {
    const res = await request('/api/v1/tasks', {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {
        companyId: 'comp_alpha_delta_01',
        title: 'Missing key task'
      }
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'MISSING_IDEMPOTENCY_KEY');
  });

  test('Idempotency: Task creation rejects malformed Idempotency-Key with 400', async () => {
    const res = await request('/api/v1/tasks', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': 'not-a-valid-uuid'
      },
      body: {
        companyId: 'comp_alpha_delta_01',
        title: 'Malformed key task'
      }
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'INVALID_IDEMPOTENCY_KEY');
  });

  test('Validation: Task creation rejects missing title with 422 Unprocessable Entity', async () => {
    const res = await request('/api/v1/tasks', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        companyId: 'comp_alpha_delta_01',
        title: '   ' // empty string
      }
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('Idempotency & Creation: Successfully creates task with valid Idempotency-Key', async () => {
    const idempotencyKey = crypto.randomUUID();
    const taskPayload = {
      companyId: 'comp_alpha_delta_01',
      title: 'Review Q3 Management Accounts Draft',
      description: 'Check depreciation schedule and WIP adjustments.',
      dueDate: '2026-09-28',
      priority: 'High'
    };

    const initialCount = (mockDb.tasks || []).length;

    // First attempt -> creates task
    const res1 = await request('/api/v1/tasks', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': idempotencyKey
      },
      body: taskPayload
    });

    assert.strictEqual(res1.status, 201);
    assert.strictEqual(res1.body.status, 'success');
    assert.strictEqual(res1.body.data.title, 'Review Q3 Management Accounts Draft');
    assert.strictEqual(res1.body.data.version, 1);
    const createdId = res1.body.data.id;
    assert.strictEqual((mockDb.tasks || []).length, initialCount + 1);

    // Second attempt with identical Idempotency-Key -> returns identical cached response without duplicate creation
    const res2 = await request('/api/v1/tasks', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': idempotencyKey
      },
      body: taskPayload
    });

    assert.strictEqual(res2.status, 201);
    assert.strictEqual(res2.headers['x-cache-lookup'], 'HIT (Idempotent replay)');
    assert.strictEqual(res2.body.data.id, createdId);
    assert.strictEqual((mockDb.tasks || []).length, initialCount + 1, 'Total task count must not increase on replay');
  });

  test('Idempotency: Key reuse with differing payload triggers 409 Conflict', async () => {
    const key = crypto.randomUUID();

    // First request
    await request('/api/v1/tasks', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': key
      },
      body: {
        companyId: 'comp_alpha_delta_01',
        title: 'Original Task Title'
      }
    });

    // Replay with DIFFERENT body
    const conflictRes = await request('/api/v1/tasks', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': key
      },
      body: {
        companyId: 'comp_alpha_delta_01',
        title: 'Completely Different Task Title'
      }
    });

    assert.strictEqual(conflictRes.status, 409);
    assert.strictEqual(conflictRes.body.error.code, 'IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH');
  });

  // --- 3. Task Update & Stale Concurrency Tests ---

  test('Update & Stale Conflict: PATCH /api/v1/tasks/:id enforces version concurrency', async () => {
    const task = mockDb.tasks.find(t => t.id === 'tsk_rgb_reconciliation');
    assert.ok(task);
    const originalVersion = task.version;

    // Successful update matching version
    const updateRes = await request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: READWRITE_HEADER,
      body: {
        version: originalVersion,
        priority: 'Normal',
        description: 'Updated bank reconciliation description.'
      }
    });

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.data.version, originalVersion + 1);
    assert.strictEqual(updateRes.body.data.priority, 'Normal');

    // Stale update using old version
    const staleRes = await request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: READWRITE_HEADER,
      body: {
        version: originalVersion, // Stale!
        priority: 'Urgent'
      }
    });

    assert.strictEqual(staleRes.status, 409);
    assert.strictEqual(staleRes.body.error.code, 'STALE_UPDATE_CONFLICT');
  });

  // --- 4. Task Completion Rules ---

  test('Completion rules: Blocked task without resolution is rejected with 422', async () => {
    const blockedTask = mockDb.tasks.find(t => t.id === 'tsk_woofington_emergency');
    assert.strictEqual(blockedTask.isBlocked, true);

    const res = await request(`/api/v1/tasks/${blockedTask.id}/complete`, {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {} // Missing resolution notes
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'BLOCKED_TASK_REQUIRES_RESOLUTION');
  });

  test('Completion rules: Blocked task with resolution completes successfully', async () => {
    const blockedTask = mockDb.tasks.find(t => t.id === 'tsk_woofington_emergency');

    const res = await request(`/api/v1/tasks/${blockedTask.id}/complete`, {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {
        completionNotes: 'Sarah Jenkins signed balance sheet on 19 Sept; objection submitted electronically.'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'Completed');
    assert.strictEqual(res.body.data.isBlocked, false);
    assert.ok(res.body.data.completedAt);
    assert.strictEqual(res.body.data.completedBy, 'Kirsty Allen (CEO Command Centre)');

    // Attempting to complete again returns 422
    const secondComplete = await request(`/api/v1/tasks/${blockedTask.id}/complete`, {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: { completionNotes: 'Redundant attempt' }
    });

    assert.strictEqual(secondComplete.status, 422);
    assert.strictEqual(secondComplete.body.error.code, 'TASK_ALREADY_COMPLETED');
  });

  // --- 5. Company Workflow State Machine Transitions ---

  test('Workflow State Machine: Permitted transition succeeds and records actor', async () => {
    const company = mockDb.companies.find(c => c.id === 'comp_jenkins_pet_02');
    assert.strictEqual(company.workflowStage, 'Onboarding');

    // Onboarding -> Information_Gathering is permitted
    const res = await request(`/api/v1/companies/${company.id}/workflow`, {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {
        targetStatus: 'Information_Gathering'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.previousStatus, 'Onboarding');
    assert.strictEqual(res.body.data.currentStatus, 'Information_Gathering');
    assert.strictEqual(company.workflowStage, 'Information_Gathering');
  });

  test('Workflow State Machine: Disallowed transition is rejected with 422 Unprocessable Entity', async () => {
    const company = mockDb.companies.find(c => c.id === 'comp_jenkins_pet_02');
    // Currently Information_Gathering -> cannot jump straight to 'Completed'
    const res = await request(`/api/v1/companies/${company.id}/workflow`, {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {
        targetStatus: 'Completed'
      }
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'INVALID_WORKFLOW_TRANSITION');
    assert.ok(res.body.error.message.includes('not permitted by Trinova workflow rules'));
  });

  // --- 6. Scoped Authorization & Audit ---

  test('Security & Scope: Write mutation requires sloane:write scope', async () => {
    const res = await request('/api/v1/companies/comp_alpha_delta_01/workflow', {
      method: 'POST',
      headers: READONLY_HEADER, // Only has sloane:read
      body: {
        targetStatus: 'Drafting'
      }
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  test('Audit: Task and workflow mutations capture audit log records', () => {
    const logs = auditStore.getLogs();
    const taskCreatedLog = logs.find(l => l.action === 'task_created');
    const taskCompletedLog = logs.find(l => l.action === 'task_completed');
    const workflowLog = logs.find(l => l.action === 'workflow_transition_updated');

    assert.ok(taskCreatedLog, 'task_created audit log must exist');
    assert.strictEqual(taskCreatedLog.resourceType, 'task');
    assert.strictEqual(taskCreatedLog.actorId, 'actor_kirsty_allen');

    assert.ok(taskCompletedLog, 'task_completed audit log must exist');
    assert.strictEqual(taskCompletedLog.resourceType, 'task');

    assert.ok(workflowLog, 'workflow_transition_updated audit log must exist');
    assert.strictEqual(workflowLog.resourceType, 'company');
  });
});
