/**
 * Authentication REST Endpoints
 * Implements Section 1.1 of the security specification:
 * - Server-side password verification using bcrypt against SLON_OWNER_PASSWORD_HASH
 * - Secure HttpOnly, SameSite session cookies
 * - IP rate limiting (5 failures per 15 minutes)
 * - Identical generic errors for wrong email, unknown user, and wrong password
 * - Session invalidation on logout
 */

import bcrypt from 'bcryptjs';
import { sessionStore } from '../services/sessionStore.js';
import { logger } from '../middleware/sanitizer.js';
import * as twoFactor from '../services/twoFactor.js';

/** Starts a signed-in session: sets the session cookie (plus the trusted-browser cookie when asked). */
function startSession(req, res, user, extraCookies = []) {
  const session = sessionStore.createSession(user);
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [sessionStore.formatSessionCookie(session.sessionId, isSecure), ...extraCookies]);
  req.auditAction = 'user_login_success';
  req.resourceType = 'auth_session';
  req.resourceId = session.sessionId;
  return session;
}

/** The cookie that marks a trusted browser. Only sent to the sign-in addresses. */
export function trustedCookie(token, req) {
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  return `${twoFactor.TRUST_COOKIE}=${encodeURIComponent(token)}; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=${twoFactor.TRUST_DAYS * 86400}${isSecure ? '; Secure' : ''}`;
}

export function clearTrustedCookie() {
  return `${twoFactor.TRUST_COOKIE}=; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function registerAuthRoutes(app, { authenticate }) {
  /**
   * POST /api/v1/auth/login
   * Authenticates CEO owner credentials and issues an HttpOnly session cookie.
   */
  app.post('/api/v1/auth/login', (req, res) => {
    const clientIp = sessionStore.getClientIp(req);

    // 1. Check Rate Limiting
    if (sessionStore.isRateLimited(clientIp)) {
      logger.warn(`Login rejected: Rate limit exceeded for IP [${clientIp}]`);
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many failed login attempts. Please wait 15 minutes before trying again.'
        }
      });
    }

    // 2. Validate Request Body
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({
        error: {
          code: 'MALFORMED_BODY',
          message: 'Sloane could not read that sign-in request. Please try again.'
        }
      });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Please type your email and password.'
        }
      });
    }

    // 3. Read Owner Configuration and Staff Accounts
    const ownerEmail = (process.env.SLON_OWNER_EMAIL || '').trim().toLowerCase();
    const ownerPasswordHash = (process.env.SLON_OWNER_PASSWORD_HASH || '').trim();

    // Only the owner can sign in. There are no built-in or default accounts.
    if (!ownerEmail || !ownerPasswordHash) {
      sessionStore.recordFailure(clientIp);
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      });
    }

    // 4. Verify Credentials (owner email + bcrypt password hash from the environment)
    // The owner's TriNova work address is accepted as an alias, but still needs the owner's password.
    const isEmailMatch = Boolean(ownerEmail) && (email === ownerEmail ||
      (ownerEmail.startsWith('kirsty') && (email === 'kirsty@trinova.com' || email === 'kirsty.allen@trinova.co.uk')));

    let isPasswordMatch = false;

    try {
      if (ownerPasswordHash) {
        isPasswordMatch = bcrypt.compareSync(password, ownerPasswordHash);
      }
    } catch (e) {
      logger.error('Error during password hash verification:', e.message);
    }

    if (!isEmailMatch || !isPasswordMatch) {
      sessionStore.recordFailure(clientIp);
      logger.warn(`Failed login attempt for email [${email}] from IP [${clientIp}]`);
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      });
    }

    // 5. Password accepted
    const user = {
      name: 'Kirsty Allen',
      email: ownerEmail,
      role: 'CEO & Managing Partner'
    };

    // 6. Two-step sign-in: unless this browser is trusted, ask for the code from the app
    if (twoFactor.isEnabled(ownerEmail)) {
      const cookies = sessionStore.parseCookies(req.headers.cookie);
      if (!twoFactor.isTrustedBrowser(ownerEmail, cookies[twoFactor.TRUST_COOKIE])) {
        req.auditAction = 'user_login_code_requested';
        req.resourceType = 'auth_session';
        return res.status(200).json({
          status: 'two_factor_required',
          message: 'Now type the 6-digit code from your authenticator app.',
          challengeId: twoFactor.createChallenge(user)
        });
      }
    }

    sessionStore.resetFailures(clientIp);
    startSession(req, res, user);

    return res.status(200).json({
      status: 'success',
      message: 'You are signed in.',
      user
    });
  });

  /**
   * POST /api/v1/auth/login/verify
   * Second step: the 6-digit code from the authenticator app (or a recovery code).
   * Body: { challengeId, code, trustBrowser }
   */
  app.post('/api/v1/auth/login/verify', (req, res) => {
    const clientIp = sessionStore.getClientIp(req);
    if (sessionStore.isRateLimited(clientIp)) {
      return res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many failed attempts. Please wait 15 minutes before trying again.' } });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = twoFactor.completeChallenge(String(body.challengeId || ''), String(body.code || ''));
    if (result.error) {
      // A wrong code counts like a wrong password, so codes cannot be guessed by signing in again and again
      sessionStore.recordFailure(clientIp);
      req.auditAction = 'user_login_code_failed';
      req.resourceType = 'auth_session';
      return res.status(401).json({ error: { code: result.expired ? 'CHALLENGE_EXPIRED' : 'INVALID_CODE', message: result.error } });
    }

    sessionStore.resetFailures(clientIp);
    const extra = [];
    if (body.trustBrowser === true) {
      extra.push(trustedCookie(twoFactor.trustBrowser(result.user.email, req.headers['user-agent']), req));
    }
    startSession(req, res, result.user, extra);
    return res.status(200).json({
      status: 'success',
      message: result.method === 'recovery'
        ? 'You are signed in. That recovery code has now been used up.'
        : 'You are signed in.',
      user: result.user,
      usedRecoveryCode: result.method === 'recovery'
    });
  });

  /**
   * POST /api/v1/auth/logout
   * Invalidates current server session and clears the session cookie.
   */
  app.post('/api/v1/auth/logout', (req, res) => {
    const cookies = sessionStore.parseCookies(req.headers.cookie);
    const sessionId = cookies.slon_session;

    if (sessionId) {
      sessionStore.deleteSession(sessionId);
    }

    res.setHeader('Set-Cookie', sessionStore.formatClearCookie());

    req.auditAction = 'user_logout';
    req.resourceType = 'auth_session';
    req.resourceId = sessionId || 'unknown';

    return res.status(200).json({
      status: 'success',
      message: 'You have been signed out.'
    });
  });

  /**
   * GET /api/v1/auth/session
   * Validates active session and returns user profile.
   */
  app.get('/api/v1/auth/session', authenticate, (req, res) => {
    return res.status(200).json({
      status: 'authenticated',
      user: req.session?.user || {
        name: req.actor?.actorName || 'Authorized Actor',
        email: process.env.SLON_OWNER_EMAIL || 'kirsty.allen@trinova.co.uk',
        role: 'CEO & Managing Partner'
      },
      actor: req.actor
    });
  });
}
