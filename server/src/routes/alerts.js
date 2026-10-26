/**
 * GET /api/v1/alerts[?business=]   what needs the owner's attention now (see services/alerts.js).
 *
 * The page asks every few minutes and shows a notification on the device for any alert it has
 * not shown before.
 */

import { clientDirectory } from '../services/clientDirectory.js';
import { trinovaDeadlines } from '../services/trinovaDeadlines.js';
import { buildAlerts } from '../services/alerts.js';

export function registerAlertRoutes(app, { authenticate, requireScope }) {
  app.get('/api/v1/alerts', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'alerts_read';
    req.resourceType = 'alert';
    await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);
    res.status(200).json({ status: 'success', data: buildAlerts(new Date(), { business: req.query.business }) });
  });
}
