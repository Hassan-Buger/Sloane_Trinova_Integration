/**
 * Client Timeline Service
 * Implements unified event model, idempotency, chronological ordering,
 * and visibility boundaries per context/04_backend_integration_context.md
 * and Prompt Section 6-17.
 */

import { mockDb } from '../data/db.js';
import { clientDirectory } from './clientDirectory.js';

// Controlled Event Taxonomy (Section 8)
export const TIMELINE_EVENT_TYPES = [
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'TASK_CREATED',
  'TASK_COMPLETED',
  'TASK_REASSIGNED',
  'NOTE_CREATED',
  'NOTE_UPDATED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_SIGNED',
  'EMAIL_RECEIVED',
  'EMAIL_SENT',
  'STATUTORY_DEADLINE',
  'STATUTORY_STATUS_CHANGED',
  'VAT_DEADLINE',
  'VAT_RETURN_FILED',
  'COMPANIES_HOUSE_SYNC',
  'COMPANIES_HOUSE_STATUS_CHANGED',
  'RISK_CHANGED',
  'CEO_NOTE_CREATED',
  'AI_INSIGHT_GENERATED'
];

export const TIMELINE_VISIBILITIES = ['shared', 'private', 'system'];
export const TIMELINE_SEVERITIES = ['normal', 'info', 'warning', 'urgent', 'critical'];
export const TIMELINE_SOURCES = ['user', 'system', 'companies_house', 'trinova', 'outlook', 'document', 'task', 'ai'];

export class TimelineService {
  /**
   * Create or idempotent deduplicate a timeline event.
   * Adheres to Section 16 (Idempotency: external_id + source).
   */
  static createEvent(data) {
    if (!mockDb.timeline_events) {
      mockDb.timeline_events = [];
    }

    const {
      clientId,
      companyId = null,
      eventType,
      title,
      description = '',
      occurredAt = new Date().toISOString(),
      actorType = 'system',
      actorId = null,
      source,
      severity = 'normal',
      visibility = 'shared',
      externalId = null,
      metadata = {}
    } = data;

    if (!clientId) {
      throw new Error('Timeline event requires a valid clientId');
    }

    if (!eventType || !TIMELINE_EVENT_TYPES.includes(eventType)) {
      throw new Error(`Invalid timeline eventType: "${eventType}". Must be one of controlled taxonomy.`);
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new Error('Timeline event requires a non-empty title');
    }

    if (!source || !TIMELINE_SOURCES.includes(source)) {
      throw new Error(`Invalid timeline source: "${source}". Must be one of: ${TIMELINE_SOURCES.join(', ')}`);
    }

    const validatedSeverity = TIMELINE_SEVERITIES.includes(severity) ? severity : 'normal';
    const validatedVisibility = TIMELINE_VISIBILITIES.includes(visibility) ? visibility : 'shared';

    // Idempotency check: external_id + source
    if (externalId) {
      const existing = mockDb.timeline_events.find(
        e => e.clientId === clientId && e.source === source && e.externalId === externalId
      );
      if (existing) {
        return { event: existing, isDuplicate: true };
      }
    }

    const event = {
      id: data.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      clientId,
      companyId,
      eventType,
      title: title.trim(),
      description: (description || '').trim(),
      occurredAt: new Date(occurredAt).toISOString(),
      createdAt: new Date().toISOString(),
      actorType,
      actorId,
      source,
      severity: validatedSeverity,
      visibility: validatedVisibility,
      externalId,
      metadata: metadata || {}
    };

    mockDb.timeline_events.push(event);
    return { event, isDuplicate: false };
  }

  /**
   * Retrieve timeline for a client with strict isolation, filters,
   * and chronological ordering.
   * Adheres to Section 11-14.
   */
  static getClientTimeline(clientId, filters = {}) {
    if (!mockDb.timeline_events) {
      mockDb.timeline_events = [];
    }

    // Verify client exists (a client added in Sloane, or a live TriNova client)
    const client = clientDirectory.find(clientId);
    if (!client) {
      return null;
    }

    // Filter strictly by client_id (client isolation per Section 12)
    let filtered = mockDb.timeline_events.filter(e => e.clientId === clientId);

    // Filter by visibility (e.g. if requester lacks private permissions)
    if (filters.visibility) {
      filtered = filtered.filter(e => e.visibility === filters.visibility);
    } else if (filters.excludePrivate) {
      filtered = filtered.filter(e => e.visibility !== 'private');
    }

    // Filter by event_type / eventType
    const eventType = filters.eventType || filters.event_type;
    if (eventType) {
      filtered = filtered.filter(e => e.eventType === eventType);
    }

    // Filter by severity
    if (filters.severity) {
      filtered = filtered.filter(e => e.severity === filters.severity);
    }

    // Filter by source
    if (filters.source) {
      filtered = filtered.filter(e => e.source === filters.source);
    }

    // Filter by companyId
    if (filters.companyId) {
      filtered = filtered.filter(e => e.companyId === filters.companyId);
    }

    // Filter by date range: from & to
    if (filters.from) {
      const fromDate = new Date(filters.from).getTime();
      filtered = filtered.filter(e => new Date(e.occurredAt).getTime() >= fromDate);
    }
    if (filters.to) {
      const toDate = new Date(filters.to).getTime();
      filtered = filtered.filter(e => new Date(e.occurredAt).getTime() <= toDate);
    }

    // Chronological sort: newest first (descending by occurredAt)
    filtered.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    // Cursor pagination (Section 11 & 14)
    const limit = Math.min(Math.max(parseInt(filters.limit || '50', 10), 1), 200);
    let startIndex = 0;

    if (filters.cursor) {
      const cursorIndex = filtered.findIndex(e => e.id === filters.cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const paginated = filtered.slice(startIndex, startIndex + limit);
    const nextCursor = (startIndex + limit < filtered.length && paginated.length > 0)
      ? paginated[paginated.length - 1].id
      : null;

    return {
      client: {
        id: client.id,
        name: client.name,
        clientType: client.clientType,
        status: client.status
      },
      events: paginated,
      meta: {
        total: filtered.length,
        returned: paginated.length,
        limit,
        cursor: filters.cursor || null,
        nextCursor
      }
    };
  }

  /**
   * Entries the owner wrote by hand can be edited. Entries Sloane wrote automatically
   * (task, document, Companies House ...) can only be removed.
   */
  static isEditable(event) {
    return event.source === 'user';
  }

  /**
   * Change an entry the owner wrote. Returns { event } or { error: [code, message] }.
   */
  static updateEvent(clientId, eventId, changes = {}) {
    const event = TimelineService.getEventById(clientId, eventId);
    if (!event) return { error: ['EVENT_NOT_FOUND', 'We could not find that history entry. It may already have been deleted.'] };
    if (!TimelineService.isEditable(event)) {
      return { error: ['AUTOMATIC_ENTRY', 'Sloane wrote this entry automatically, so it can only be deleted, not changed.'] };
    }

    if (changes.title !== undefined) {
      const title = typeof changes.title === 'string' ? changes.title.trim() : '';
      if (!title) return { error: ['VALIDATION_FAILED', 'Please give the entry a short title.'] };
      if (title.length > 200) return { error: ['VALIDATION_FAILED', 'The title can be up to 200 characters.'] };
    }
    if (changes.description !== undefined && String(changes.description).length > 4000) {
      return { error: ['VALIDATION_FAILED', 'The description can be up to 4,000 characters.'] };
    }
    if (changes.eventType !== undefined && !TIMELINE_EVENT_TYPES.includes(changes.eventType)) {
      return { error: ['VALIDATION_FAILED', 'That kind of entry is not allowed.'] };
    }
    if (changes.severity !== undefined && !TIMELINE_SEVERITIES.includes(changes.severity)) {
      return { error: ['VALIDATION_FAILED', 'That importance level is not allowed.'] };
    }
    if (changes.visibility !== undefined && !TIMELINE_VISIBILITIES.includes(changes.visibility)) {
      return { error: ['VALIDATION_FAILED', 'That visibility is not allowed.'] };
    }
    if (changes.occurredAt !== undefined && Number.isNaN(new Date(changes.occurredAt).getTime())) {
      return { error: ['VALIDATION_FAILED', 'Please enter a real date and time.'] };
    }

    if (changes.title !== undefined) event.title = changes.title.trim();
    if (changes.description !== undefined) event.description = String(changes.description).trim();
    if (changes.eventType !== undefined) event.eventType = changes.eventType;
    if (changes.severity !== undefined) event.severity = changes.severity;
    if (changes.visibility !== undefined) event.visibility = changes.visibility;
    if (changes.occurredAt !== undefined) event.occurredAt = new Date(changes.occurredAt).toISOString();
    event.updatedAt = new Date().toISOString();
    return { event };
  }

  /**
   * Remove an entry. Returns { event, index } or { error: [code, message] }.
   * The caller puts it in the Bin.
   */
  static deleteEvent(clientId, eventId) {
    const idx = (mockDb.timeline_events || []).findIndex(e => e.clientId === clientId && e.id === eventId);
    if (idx === -1) return { error: ['EVENT_NOT_FOUND', 'We could not find that history entry. It may already have been deleted.'] };
    const [event] = mockDb.timeline_events.splice(idx, 1);
    return { event, index: idx };
  }

  /**
   * Retrieve single event by client and event ID.
   */
  static getEventById(clientId, eventId) {
    if (!mockDb.timeline_events) return null;
    return mockDb.timeline_events.find(
      e => e.clientId === clientId && e.id === eventId
    ) || null;
  }
}
