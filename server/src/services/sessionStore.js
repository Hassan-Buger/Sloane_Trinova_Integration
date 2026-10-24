/**
 * Server-Side Session Store & Login Rate Limiter
 * Provides secure HttpOnly session tokens and IP-based rate limiting
 * per Section 1.1 of the security specification.
 */

import crypto from 'node:crypto';

// 24-hour session TTL
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Rate limiting: 5 failed attempts per 15 minutes per IP
const MAX_LOGIN_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.loginFailures = new Map();
  }

  /**
   * Generates a cryptographically secure 64-character session ID.
   */
  generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Creates a new session for an authenticated user.
   */
  createSession(user) {
    const sessionId = this.generateSessionId();
    const now = Date.now();
    const stored = {
      user,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      expiresAtMs: now + SESSION_TTL_MS
    };

    // Sessions are kept under a hash of the cookie value. Only the browser holds the cookie
    // value itself, so a copy of the saved data cannot be used to sign in as the owner.
    this.sessions.set(this.hashId(sessionId), stored);
    return { sessionId, ...stored };
  }

  /** The key a session is stored under (and saved to the database under). */
  hashId(sessionId) {
    return crypto.createHash('sha256').update(String(sessionId)).digest('hex');
  }

  /** Sessions in the form that is saved to the database (still hashed, never the cookie value). */
  exportSessions() {
    const now = Date.now();
    return [...this.sessions.entries()]
      .filter(([, s]) => s.expiresAtMs > now)
      .map(([id, s]) => ({ id, ...s }));
  }

  /** Puts saved sessions back after a restart. Expired ones are dropped. */
  importSessions(rows) {
    const now = Date.now();
    this.sessions.clear();
    for (const row of rows || []) {
      if (row && row.id && row.expiresAtMs > now) {
        const { id, ...stored } = row;
        this.sessions.set(id, stored);
      }
    }
  }

  /**
   * Retrieves an active session, automatically pruning expired ones.
   */
  getSession(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return null;

    const key = this.hashId(sessionId);
    const stored = this.sessions.get(key);
    if (!stored) return null;

    if (Date.now() > stored.expiresAtMs) {
      this.sessions.delete(key);
      return null;
    }

    return { sessionId, ...stored };
  }

  /**
   * Invalidates a session (logout).
   */
  deleteSession(sessionId) {
    if (!sessionId) return false;
    return this.sessions.delete(this.hashId(sessionId));
  }

  /**
   * Determines client IP address behind proxies.
   * Documented decision: In production behind a reverse proxy (Railway, Cloudflare, etc.),
   * the client IP is passed in the X-Forwarded-For header as the first comma-separated address.
   * If not present, falls back to the direct socket remoteAddress.
   */
  getClientIp(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor && typeof xForwardedFor === 'string') {
      const firstIp = xForwardedFor.split(',')[0].trim();
      if (firstIp) return firstIp;
    }
    return req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
  }

  /**
   * Checks if an IP is currently locked out due to excessive login failures.
   */
  isRateLimited(ip) {
    const record = this.loginFailures.get(ip);
    if (!record) return false;

    const now = Date.now();
    if (now > record.resetAt) {
      this.loginFailures.delete(ip);
      return false;
    }

    return record.failures >= MAX_LOGIN_FAILURES;
  }

  /**
   * Records a failed login attempt for an IP.
   */
  recordFailure(ip) {
    const now = Date.now();
    let record = this.loginFailures.get(ip);

    if (!record || now > record.resetAt) {
      record = { failures: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    } else {
      record.failures += 1;
    }

    this.loginFailures.set(ip, record);
    return record.failures >= MAX_LOGIN_FAILURES;
  }

  /**
   * Resets failed login attempts for an IP upon successful authentication.
   */
  resetFailures(ip) {
    this.loginFailures.delete(ip);
  }

  /**
   * Parses cookies from the Cookie header string.
   */
  parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;

    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        try {
          cookies[key] = decodeURIComponent(val);
        } catch {
          cookies[key] = val;
        }
      }
    }

    return cookies;
  }

  /**
   * Formats a Set-Cookie header for a session.
   */
  formatSessionCookie(sessionId, isSecure = false) {
    const secureFlag = isSecure ? '; Secure' : '';
    return `slon_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureFlag}`;
  }

  /**
   * Formats a Set-Cookie header to clear a session.
   */
  formatClearCookie() {
    return 'slon_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
  }
}

export const sessionStore = new SessionStore();
