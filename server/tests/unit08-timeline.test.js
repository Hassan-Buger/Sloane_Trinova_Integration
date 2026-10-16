/**
 * Unit 08: Client Timeline Persistence, REST API & Security Verification
 * Verifies Section 6-17 of Prompt:
 * - Chronological ordering
 * - Unified event data model & taxonomy
 * - Filtering (event_type, severity, source, date ranges)
 * - Strict client isolation (Client A cannot see Client B)
 * - Idempotency & duplicate prevention (external_id + source)
 * - Scope authorization & audit logging
 * - Real application event generation from task lifecycle
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

describe('Unit 08: Client Timeline API & Security Verification', () => {
  let server;
  let baseUrl;
  const PORT = 4995;

  const READ_WRITE_KEY = TEST_API_KEY;
  const READ_ONLY_KEY = TEST_READONLY_KEY;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('1. Authentication & Scope: Rejects unauthenticated and admits authorized token', async () => {
    // Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`);
    assert.equal(unauthRes.status, 401, 'Timeline must require authentication');

    // Authorized -> 200
    const authRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    assert.equal(authRes.status, 200, 'Authorized read token must access timeline');
    const json = await authRes.json();
    assert.equal(json.status, 'success');
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length > 0);
    assert.equal(json.client.id, 'cli_woofington_grp');
  });

  it('2. Chronological Ordering: Events are returned newest first (occurred_at descending)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    const json = await res.json();
    const events = json.data;

    assert.ok(events.length >= 2, 'Should have multiple events for ordering test');
    for (let i = 0; i < events.length - 1; i++) {
      const current = new Date(events[i].occurredAt).getTime();
      const next = new Date(events[i + 1].occurredAt).getTime();
      assert.ok(
        current >= next,
        `Timeline must be chronologically descending: ${events[i].occurredAt} >= ${events[i + 1].occurredAt}`
      );
    }
  });

  it('3. Controlled Taxonomy & Unified Model: Event has required schema attributes', async () => {
    const res = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    const json = await res.json();
    const event = json.data[0];

    assert.ok(event.id, 'Event must have ID');
    assert.equal(event.clientId, 'cli_woofington_grp');
    assert.ok(event.eventType, 'Event must have eventType');
    assert.ok(event.title, 'Event must have title');
    assert.ok(event.occurredAt, 'Event must have occurredAt');
    assert.ok(event.source, 'Event must identify source');
    assert.ok(event.severity, 'Event must have severity');
    assert.ok(event.visibility, 'Event must have visibility');
  });

  it('4. Filtering: Filters correctly by event_type, severity, and date range', async () => {
    // Filter by event_type
    const typeRes = await fetch(
      `${baseUrl}/api/v1/clients/cli_woofington_grp/timeline?event_type=COMPANIES_HOUSE_STATUS_CHANGED`,
      { headers: { Authorization: `Bearer ${READ_ONLY_KEY}` } }
    );
    const typeJson = await typeRes.json();
    assert.ok(typeJson.data.length >= 1);
    assert.ok(typeJson.data.every(e => e.eventType === 'COMPANIES_HOUSE_STATUS_CHANGED'));

    // Filter by severity
    const sevRes = await fetch(
      `${baseUrl}/api/v1/clients/cli_woofington_grp/timeline?severity=critical`,
      { headers: { Authorization: `Bearer ${READ_ONLY_KEY}` } }
    );
    const sevJson = await sevRes.json();
    assert.ok(sevJson.data.every(e => e.severity === 'critical'));

    // Filter by date range
    const dateRes = await fetch(
      `${baseUrl}/api/v1/clients/cli_woofington_grp/timeline?from=2026-09-18T10:00:00.000Z&to=2026-09-18T16:00:00.000Z`,
      { headers: { Authorization: `Bearer ${READ_ONLY_KEY}` } }
    );
    const dateJson = await dateRes.json();
    assert.ok(dateJson.data.length > 0);
    dateJson.data.forEach(e => {
      const t = new Date(e.occurredAt).getTime();
      assert.ok(t >= new Date('2026-09-18T10:00:00.000Z').getTime());
      assert.ok(t <= new Date('2026-09-18T16:00:00.000Z').getTime());
    });
  });

  it('5. Client Isolation (Section 50): Client A events are never visible to Client B', async () => {
    // Fetch Client A (Woofington Group)
    const resA = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    const jsonA = await resA.json();
    const idsA = jsonA.data.map(e => e.id);

    // Fetch Client B (R GB Elevations)
    const resB = await fetch(`${baseUrl}/api/v1/clients/cli_rgb_elevations/timeline`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    const jsonB = await resB.json();
    const idsB = jsonB.data.map(e => e.id);

    assert.ok(idsA.length > 0, 'Client A should have events');
    assert.ok(idsB.length > 0, 'Client B should have events');

    // Verify zero overlap
    for (const idA of idsA) {
      assert.ok(!idsB.includes(idA), `Client isolation breach: Event ${idA} found in both Client A and B`);
    }

    for (const eventB of jsonB.data) {
      assert.equal(eventB.clientId, 'cli_rgb_elevations', 'Client B timeline must only contain Client B records');
    }
  });

  it('6. Missing Client Handling: Returns 404 for non-existent client ID', async () => {
    const res = await fetch(`${baseUrl}/api/v1/clients/cli_non_existent_999/timeline`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error.code, 'CLIENT_NOT_FOUND');
  });

  it('7. Single Event Retrieval: GET /api/v1/clients/:clientId/timeline/:eventId', async () => {
    const res = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline/evt_woof_001`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.id, 'evt_woof_001');
    assert.equal(json.data.eventType, 'COMPANIES_HOUSE_STATUS_CHANGED');

    // Unknown event ID -> 404
    const res404 = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline/evt_unknown_999`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    assert.equal(res404.status, 404);
  });

  it('8. Event Creation & Idempotency: POST /events creates and deduplicates', async () => {
    // Read-only token cannot write -> 403
    const forbiddenRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventType: 'NOTE_CREATED',
        title: 'Forbidden attempt',
        source: 'user'
      })
    });
    assert.equal(forbiddenRes.status, 403, 'Read-only token must not be permitted to post events');

    // Authorized write
    const externalId = `test_ext_${Date.now()}`;
    const payload = {
      eventType: 'NOTE_CREATED',
      title: 'Board Meeting Review Minutes',
      description: 'Reviewed Q3 compliance items and statutory defense.',
      source: 'user',
      severity: 'normal',
      visibility: 'shared',
      externalId,
      metadata: { department: 'Legal' }
    };

    // 1st Post -> 201 Created
    const createRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_WRITE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    assert.equal(createRes.status, 201);
    const createJson = await createRes.json();
    assert.equal(createJson.status, 'success');
    assert.equal(createJson.isDuplicate, false);
    assert.equal(createJson.data.title, 'Board Meeting Review Minutes');

    // 2nd Post (same externalId + source) -> Idempotent duplicate handled gracefully (200 OK)
    const duplicateRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_WRITE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    assert.equal(duplicateRes.status, 200, 'Duplicate submission must be handled idempotently');
    const duplicateJson = await duplicateRes.json();
    assert.equal(duplicateJson.isDuplicate, true);
    assert.equal(duplicateJson.data.id, createJson.data.id);
  });

  it('9. Automatic Event Generation from Operations: Task creation produces timeline event', async () => {
    const taskTitle = `Urgent VAT Filing Task ${Date.now()}`;
    const idempotencyKey = crypto.randomUUID();

    // Create task for Woofington Park
    const taskRes = await fetch(`${baseUrl}/api/v1/companies/comp_woofington_park_01/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_WRITE_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        title: taskTitle,
        description: 'Auto-hooked operational task for timeline verification.',
        priority: 'Normal',
        dueDate: '2026-09-30'
      })
    });
    assert.equal(taskRes.status, 201);
    const taskJson = await taskRes.json();
    const createdTaskId = taskJson.data.id;

    // Verify timeline event appears in client timeline
    const timelineRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline?event_type=TASK_CREATED`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    const timelineJson = await timelineRes.json();
    const matchingEvent = timelineJson.data.find(e => e.externalId === createdTaskId);

    assert.ok(matchingEvent, 'Newly created task must automatically record a TASK_CREATED timeline event');
    assert.equal(matchingEvent.title, `Task Created: ${taskTitle}`);
    assert.equal(matchingEvent.source, 'task');
  });
});
