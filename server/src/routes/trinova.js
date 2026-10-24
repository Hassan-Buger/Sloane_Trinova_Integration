/**
 * TriNova connection tools for the "TriNova connection" panel.
 *
 * GET /api/v1/integrations/trinova/check
 *   Runs the TriNova data check on the server (the key never reaches the browser) and returns
 *   the shape of each answer: field names and kinds of value, never client data.
 */

import { config } from '../config.js';
import { trinovaGet } from '../services/trinovaApi.js';
import { runTrinovaCheck } from '../services/trinovaCheck.js';
import { sendError } from './helpers.js';

const MIN_GAP_MS = 15 * 1000;

export function registerTrinovaRoutes(app, { authenticate, requireScope }, options = {}) {
  const get = options.trinovaGet || trinovaGet;
  let lastRunAt = 0;

  app.get('/api/v1/integrations/trinova/check', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'trinova_data_check';
    req.resourceType = 'integration';

    if (!config.trinova.apiKey) {
      return res.status(200).json({
        status: 'success',
        data: {
          configured: false,
          message: 'TriNova is not set up yet: Sloane has not been given the TriNova key, so there is nothing to check.'
        }
      });
    }

    const now = Date.now();
    if (now - lastRunAt < MIN_GAP_MS) {
      return sendError(res, 429, 'TOO_SOON', 'The check has just run. Please wait a few seconds and try again.');
    }
    lastRunAt = now;

    const lines = [];
    const report = await runTrinovaCheck({ get, base: config.trinova.baseUrl, log: line => lines.push(line) });
    res.status(200).json({ status: 'success', data: { configured: true, lines, report } });
  });
}
