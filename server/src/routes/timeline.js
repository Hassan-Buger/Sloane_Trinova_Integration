/**
 * Client Timeline REST API Routes
 * Implements Section 11 & 12 (Timeline API & Security)
 */

import { TimelineService } from '../services/timelineService.js';
import { mockDb } from '../data/db.js';

export function registerTimelineRoutes(app, { authenticate, requireScope }) {
  // 1. Get Client Timeline
  // GET /api/v1/clients/:clientId/timeline
  app.get('/api/v1/clients/:clientId/timeline', authenticate, requireScope('sloane:read'), (req, res) => {
    const { clientId } = req.params;

    if (!clientId || clientId.trim() === '') {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Client ID parameter is required.'
        }
      });
    }

    const filters = {
      from: req.query.from,
      to: req.query.to,
      eventType: req.query.event_type || req.query.eventType,
      severity: req.query.severity,
      visibility: req.query.visibility,
      source: req.query.source,
      companyId: req.query.company_id || req.query.companyId,
      limit: req.query.limit,
      cursor: req.query.cursor
    };

    const result = TimelineService.getClientTimeline(clientId, filters);

    if (!result) {
      return res.status(404).json({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: `Client with ID "${clientId}" does not exist in TriNova.`
        }
      });
    }

    req.auditAction = 'read_client_timeline';
    req.resourceType = `client_timeline:${clientId}`;

    return res.status(200).json({
      status: 'success',
      data: result.events,
      client: result.client,
      meta: result.meta
    });
  });

  // 2. Get Single Timeline Event
  // GET /api/v1/clients/:clientId/timeline/:eventId
  app.get('/api/v1/clients/:clientId/timeline/:eventId', authenticate, requireScope('sloane:read'), (req, res) => {
    const { clientId, eventId } = req.params;

    const client = (mockDb.clients || []).find(c => c.id === clientId);
    if (!client) {
      return res.status(404).json({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: `Client with ID "${clientId}" does not exist.`
        }
      });
    }

    const event = TimelineService.getEventById(clientId, eventId);
    if (!event) {
      return res.status(404).json({
        error: {
          code: 'EVENT_NOT_FOUND',
          message: `Timeline event with ID "${eventId}" not found for client "${clientId}".`
        }
      });
    }

    req.auditAction = 'read_timeline_event';
    req.resourceType = `timeline_event:${eventId}`;

    return res.status(200).json({
      status: 'success',
      data: event
    });
  });

  // 3. Create Timeline Event
  // POST /api/v1/clients/:clientId/timeline/events
  app.post('/api/v1/clients/:clientId/timeline/events', authenticate, requireScope('sloane:write'), (req, res) => {
    const { clientId } = req.params;

    const client = (mockDb.clients || []).find(c => c.id === clientId);
    if (!client) {
      return res.status(404).json({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: `Client with ID "${clientId}" does not exist.`
        }
      });
    }

    const body = req.body || {};

    try {
      const { event, isDuplicate } = TimelineService.createEvent({
        ...body,
        clientId,
        actorType: body.actorType || 'user',
        actorId: body.actorId || req.actor?.id || 'actor_unknown',
        source: body.source || 'user'
      });

      req.auditAction = isDuplicate ? 'timeline_event_deduplicated' : 'timeline_event_created';
      req.resourceType = `timeline_event:${event.id}`;

      return res.status(isDuplicate ? 200 : 201).json({
        status: 'success',
        data: event,
        isDuplicate
      });
    } catch (err) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message
        }
      });
    }
  });
}
