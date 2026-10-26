/**
 * Alerts that reach a device when Sloane is closed (see services/webPush.js).
 *
 * GET  /api/v1/push/config        the public key a device needs to subscribe, and how many devices there are
 * POST /api/v1/push/subscribe     { subscription }  remember this device
 * POST /api/v1/push/unsubscribe   { endpoint }      forget this device
 * POST /api/v1/push/test          { delayMs }       send a test alert to every device
 *
 * Only the signed-in owner can use these (not an API key).
 */

import { getPushStatus, saveSubscription, removeSubscription, scheduleTest, subscriptionCount } from '../services/webPush.js';
import { sendError, requireSession } from './helpers.js';

export function registerPushRoutes(app, { authenticate, requireScope }) {
  app.get('/api/v1/push/config', authenticate, requireScope('sloane:read'), requireSession, (req, res) => {
    req.auditAction = 'push_config_read';
    req.resourceType = 'push';
    res.status(200).json({ status: 'success', data: getPushStatus() });
  });

  app.post('/api/v1/push/subscribe', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'push_device_added';
    req.resourceType = 'push';
    const out = saveSubscription(req.body && req.body.subscription, req.headers['user-agent']);
    if (out.error) return sendError(res, 422, 'INVALID_SUBSCRIPTION', out.error);
    res.status(200).json({ status: 'success', message: 'This device will get alerts even when Sloane is closed.', data: { devices: out.count } });
  });

  app.post('/api/v1/push/unsubscribe', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'push_device_removed';
    req.resourceType = 'push';
    const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint : '';
    const devices = removeSubscription(endpoint);
    res.status(200).json({ status: 'success', data: { devices } });
  });

  app.post('/api/v1/push/test', authenticate, requireScope('sloane:write'), requireSession, async (req, res) => {
    req.auditAction = 'push_test_sent';
    req.resourceType = 'push';
    if (!subscriptionCount()) return sendError(res, 409, 'NO_DEVICES', 'No device is set up for alerts yet. Turn alerts on first.');
    const delay = req.body && req.body.delayMs !== undefined ? Number(req.body.delayMs) : 10000;
    const out = await scheduleTest(delay);
    res.status(200).json({ status: 'success', message: delay > 0 ? 'A test alert will arrive in a few seconds.' : 'Test alert sent.', data: out });
  });
}
