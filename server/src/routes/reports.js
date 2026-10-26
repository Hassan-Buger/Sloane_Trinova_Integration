/**
 * Reports.
 *
 * GET /api/v1/reports/this-week   The "This week" one-pager (late, due in 7 days, stuck, done)
 */

import { clientDirectory } from '../services/clientDirectory.js';
import { trinovaDeadlines } from '../services/trinovaDeadlines.js';
import { buildWeeklyReport } from '../services/weeklyReport.js';
import { buildMorningBriefing } from '../services/morningBriefing.js';

export function registerReportRoutes(app, { authenticate, requireScope }) {
  app.get('/api/v1/reports/this-week', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'report_this_week_read';
    req.resourceType = 'report';
    // The latest TriNova clients and deadlines (remembered for a minute; never fails the report)
    await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);
    res.status(200).json({ status: 'success', data: buildWeeklyReport(new Date(), { business: req.query.business }) });
  });

  /**
   * GET /api/v1/reports/morning
   * The morning briefing across all the businesses (or one, with ?business=).
   */
  app.get('/api/v1/reports/morning', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'report_morning_briefing_read';
    req.resourceType = 'report';
    await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);
    res.status(200).json({ status: 'success', data: buildMorningBriefing(new Date(), { business: req.query.business }) });
  });
}
