/**
 * Client Timeline REST API Routes
 * Implements Section 11 & 12 (Timeline API & Security)
 */

import { TimelineService } from '../services/timelineService.js';
import { clientDirectory } from '../services/clientDirectory.js';
import { sendError } from './helpers.js';
import { putInBin } from '../services/bin.js';

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
          message: 'We could not find that client. Refresh the Clients page and try again.'
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

    const client = clientDirectory.find(clientId);
    if (!client) {
      return res.status(404).json({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'We could not find that client. Refresh the Clients page and try again.'
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

    const client = clientDirectory.find(clientId);
    if (!client) {
      return res.status(404).json({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'We could not find that client. Refresh the Clients page and try again.'
        }
      });
    }

    const body = req.body || {};

    try {
      const { event, isDuplicate } = TimelineService.createEvent({
        ...body,
        clientId,
        actorType: body.actorType || 'user',
        actorId: body.actorId || req.actor?.actorId || 'actor_unknown',
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

  // 4. Change a history entry the owner wrote
  // PATCH /api/v1/clients/:clientId/timeline/:eventId
  app.patch('/api/v1/clients/:clientId/timeline/:eventId', authenticate, requireScope('sloane:write'), (req, res) => {
    const { clientId, eventId } = req.params;
    req.auditAction = 'timeline_event_updated';
    req.resourceType = `timeline_event:${eventId}`;

    if (!clientDirectory.find(clientId)) {
      return sendError(res, 404, 'CLIENT_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.');
    }

    const result = TimelineService.updateEvent(clientId, eventId, req.body || {});
    if (result.error) {
      const [code, message] = result.error;
      const status = code === 'EVENT_NOT_FOUND' ? 404 : code === 'AUTOMATIC_ENTRY' ? 409 : 422;
      return sendError(res, status, code, message);
    }
    return res.status(200).json({ status: 'success', data: result.event });
  });

  // 5. Delete a history entry
  // DELETE /api/v1/clients/:clientId/timeline/:eventId
  app.delete('/api/v1/clients/:clientId/timeline/:eventId', authenticate, requireScope('sloane:write'), (req, res) => {
    const { clientId, eventId } = req.params;
    req.auditAction = 'timeline_event_deleted';
    req.resourceType = `timeline_event:${eventId}`;

    if (!clientDirectory.find(clientId)) {
      return sendError(res, 404, 'CLIENT_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.');
    }

    const result = TimelineService.deleteEvent(clientId, eventId);
    if (result.error) return sendError(res, 404, result.error[0], result.error[1]);
    const client = clientDirectory.find(clientId);
    const entry = putInBin({
      kind: 'history',
      label: result.event.title || 'History entry',
      where: (client && client.name) || '',
      removed: [{ collection: 'timeline_events', index: result.index, record: result.event }]
    });
    return res.status(200).json({ status: 'success', message: 'History entry moved to the Bin. You can put it back from the Bin within 30 days.', data: { id: eventId, binId: entry.id } });
  });
}
