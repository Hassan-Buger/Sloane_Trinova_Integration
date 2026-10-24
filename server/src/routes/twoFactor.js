/**
 * Settings → Sign-in security: set up two-step sign-in with an authenticator app, recovery
 * codes, trusted browsers, and turning it off. Only the signed-in owner can use these.
 *
 * GET    /api/v1/auth/two-factor                     status, trusted browsers ("this browser" marked)
 * POST   /api/v1/auth/two-factor/setup               new key + QR code (not on until confirmed)
 * POST   /api/v1/auth/two-factor/confirm   {code}    switch on; returns 10 recovery codes (shown once)
 * POST   /api/v1/auth/two-factor/recovery-codes {code} new recovery codes (old ones stop working)
 * POST   /api/v1/auth/two-factor/disable   {code}    switch off (needs a current code or a recovery code)
 * DELETE /api/v1/auth/two-factor/browsers/:id        forget one trusted browser
 * DELETE /api/v1/auth/two-factor/browsers            forget all trusted browsers
 */

import * as twoFactor from '../services/twoFactor.js';
import { sessionStore } from '../services/sessionStore.js';
import { clearTrustedCookie } from './auth.js';
import { sendError } from './helpers.js';

/** Only a signed-in owner (a browser session), never an API key. */
function ownerOnly(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.email) {
    return sendError(res, 403, 'SESSION_REQUIRED', 'Sign-in security can only be changed while you are signed in to Sloane.');
  }
  return next();
}

const emailOf = req => req.session.user.email;
const trustedTokenOf = req => sessionStore.parseCookies(req.headers.cookie)[twoFactor.TRUST_COOKIE] || null;

export function registerTwoFactorRoutes(app, { authenticate }) {
  app.get('/api/v1/auth/two-factor', authenticate, ownerOnly, (req, res) => {
    res.status(200).json({ status: 'success', data: twoFactor.status(emailOf(req), trustedTokenOf(req)) });
  });

  app.post('/api/v1/auth/two-factor/setup', authenticate, ownerOnly, (req, res) => {
    req.auditAction = 'two_factor_setup_started';
    req.resourceType = 'security';
    if (twoFactor.isEnabled(emailOf(req))) {
      return sendError(res, 409, 'ALREADY_ON', 'Two-step sign-in is already on. Turn it off first if you want to move it to a new phone.');
    }
    try {
      res.status(200).json({ status: 'success', data: twoFactor.startSetup(emailOf(req)) });
    } catch (err) {
      sendError(res, 500, 'SETUP_FAILED', err.message);
    }
  });

  app.post('/api/v1/auth/two-factor/confirm', authenticate, ownerOnly, (req, res) => {
    req.auditAction = 'two_factor_enabled';
    req.resourceType = 'security';
    const result = twoFactor.confirmSetup(emailOf(req), String(req.body?.code || ''));
    if (result.error) return sendError(res, 422, 'INVALID_CODE', result.error);
    res.status(200).json({
      status: 'success',
      message: 'Two-step sign-in is on. Keep your recovery codes somewhere safe.',
      data: { recoveryCodes: result.recoveryCodes }
    });
  });

  app.post('/api/v1/auth/two-factor/recovery-codes', authenticate, ownerOnly, (req, res) => {
    req.auditAction = 'two_factor_recovery_codes_renewed';
    req.resourceType = 'security';
    const result = twoFactor.regenerateRecoveryCodes(emailOf(req), String(req.body?.code || ''));
    if (result.error) return sendError(res, 422, 'INVALID_CODE', result.error);
    res.status(200).json({ status: 'success', message: 'New recovery codes made. The old ones no longer work.', data: { recoveryCodes: result.recoveryCodes } });
  });

  app.post('/api/v1/auth/two-factor/disable', authenticate, ownerOnly, (req, res) => {
    req.auditAction = 'two_factor_disabled';
    req.resourceType = 'security';
    const result = twoFactor.disable(emailOf(req), String(req.body?.code || ''));
    if (result.error) return sendError(res, 422, 'INVALID_CODE', result.error);
    res.setHeader('Set-Cookie', clearTrustedCookie());
    res.status(200).json({ status: 'success', message: 'Two-step sign-in is off. Signing in now needs only your password.' });
  });

  app.delete('/api/v1/auth/two-factor/browsers/:id', authenticate, ownerOnly, (req, res) => {
    req.auditAction = 'trusted_browser_removed';
    req.resourceType = 'security';
    const current = twoFactor.status(emailOf(req), trustedTokenOf(req)).trustedBrowsers.find(b => b.id === req.params.id && b.current);
    if (!twoFactor.forgetBrowser(emailOf(req), req.params.id)) {
      return sendError(res, 404, 'NOT_FOUND', 'That browser is no longer on the list.');
    }
    if (current) res.setHeader('Set-Cookie', clearTrustedCookie());
    res.status(200).json({ status: 'success', message: 'That browser will need a code next time.' });
  });

  app.delete('/api/v1/auth/two-factor/browsers', authenticate, ownerOnly, (req, res) => {
    req.auditAction = 'trusted_browsers_cleared';
    req.resourceType = 'security';
    const n = twoFactor.forgetAllBrowsers(emailOf(req));
    res.setHeader('Set-Cookie', clearTrustedCookie());
    res.status(200).json({ status: 'success', message: n ? `All ${n} trusted browser${n === 1 ? '' : 's'} will need a code next time.` : 'No browsers were trusted.' });
  });
}
