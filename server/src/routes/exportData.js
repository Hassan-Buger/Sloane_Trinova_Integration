/**
 * GET /api/v1/export/excel
 * "Download a copy of everything": an Excel file with a sheet for each kind of record.
 * Only the signed-in owner can download it (it includes private notes).
 */

import { clientDirectory } from '../services/clientDirectory.js';
import { trinovaDeadlines } from '../services/trinovaDeadlines.js';
import { buildExportSheets } from '../services/exportWorkbook.js';
import { buildXlsx } from '../services/xlsx.js';
import { requireSession } from './helpers.js';

export function registerExportRoutes(app, { authenticate, requireScope }) {
  app.get('/api/v1/export/excel', authenticate, requireScope('sloane:read'), requireSession, async (req, res) => {
    req.auditAction = 'data_exported';
    req.resourceType = 'export';

    // The latest TriNova clients and deadlines (remembered for a minute; never fails the download)
    await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);

    const now = new Date();
    const file = buildXlsx(buildExportSheets({ ownerId: req.actor?.actorId || null, now }));
    // The date in the file name is the UK date (en-CA gives YYYY-MM-DD)
    const stamp = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sloane-copy-${stamp}.xlsx"`);
    res.setHeader('Content-Length', file.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(file);
  });
}
