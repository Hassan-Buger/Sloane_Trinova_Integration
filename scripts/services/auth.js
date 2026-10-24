/**
 * Sloane CEO Command Centre — Authentication Service
 * Manages CEO executive session state, credentials verification,
 * and security perimeter locking.
 */

const STORAGE_KEY = 'sloane_ceo_session';
const REMEMBER_KEY = 'sloane_remember_ceo';

export const AuthService = {
  /**
   * Default verified user placeholder
   */
  defaultUser: {
    name: 'Executive User',
    email: '',
    role: 'Managing Partner',
    avatar: 'EX',
    businessesCount: 0
  },

  _serverVerified: false,

  /**
   * Validates whether an active, server-verified session exists.
   * Strictly disallows treating cached localStorage as proof of authentication.
   */
  isAuthenticated() {
    return this._serverVerified === true;
  },

  /**
   * Actively validates the session cookie against the backend /api/v1/auth/session endpoint.
   * Purges all local session caches if the server rejects authentication.
   */
  async verifySession() {
    try {
      const resp = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
      if (resp.ok) {
        const data = await resp.json();
        const user = data.user || this.defaultUser;
        const sessionData = {
          token: 'slon_cookie_session',
          user,
          createdAt: new Date().toISOString()
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
        this._serverVerified = true;
        return true;
      }
    } catch (_) {}

    this.clearClientSession();
    return false;
  },

  /**
   * Purges all client-side authentication tokens and session caches.
   */
  clearClientSession() {
    this._serverVerified = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  },

  /**
   * Retrieves the current user session object.
   */
  getSession() {
    try {
      const session = sessionStorage.getItem(STORAGE_KEY);
      if (session) return JSON.parse(session);

      const local = localStorage.getItem(STORAGE_KEY);
      if (local) return JSON.parse(local);
    } catch (e) {
      console.error('Failed to parse auth session:', e);
    }
    return null;
  },

  /**
   * Returns current authenticated user metadata or default.
   */
  getUser() {
    const session = this.getSession();
    return session?.user || this.defaultUser;
  },

  /**
   * Authenticates owner credentials against the server-side API.
   * Receives HttpOnly session cookie from the backend per Section 1.1.
   */
  async login({ email, password, remember = true }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();

    if (!cleanEmail) {
      throw new Error('Please enter your executive email address.');
    }

    if (!cleanPass) {
      throw new Error('Please enter your executive password.');
    }

    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
      credentials: 'same-origin'
    });

    const result = await response.json();

    if (!response.ok) {
      this.clearClientSession();
      throw new Error(result.error?.message || 'Invalid email or password.');
    }

    // Two-step sign-in is on and this browser is not trusted: the code is needed next
    if (result.status === 'two_factor_required') {
      return { twoFactorRequired: true, challengeId: result.challengeId, message: result.message };
    }

    return this.finishSignIn(result, { email: cleanEmail, remember });
  },

  /**
   * Second step: the 6-digit code (or a recovery code). `trustBrowser` asks the server to
   * remember this browser for 30 days.
   */
  async verifyCode({ challengeId, code, trustBrowser = false, email, remember = true }) {
    const clean = String(code || '').trim();
    if (!clean) throw new Error('Please type the code from your authenticator app.');
    const response = await fetch('/api/v1/auth/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, code: clean, trustBrowser: Boolean(trustBrowser) }),
      credentials: 'same-origin'
    });
    const result = await response.json();
    if (!response.ok) {
      const err = new Error(result.error?.message || 'That code is not right.');
      err.expired = result.error?.code === 'CHALLENGE_EXPIRED';
      throw err;
    }
    return this.finishSignIn(result, { email: (email || '').trim().toLowerCase(), remember });
  },

  /**
   * Asks the browser to save the email and password in its password manager (Chrome and Edge
   * offer "Save password?"). Other browsers offer it themselves from the form.
   */
  async offerToSavePassword({ email, password, name }) {
    try {
      if (typeof window !== 'undefined' && window.PasswordCredential && navigator.credentials && email && password) {
        await navigator.credentials.store(new window.PasswordCredential({ id: email, password, name: name || email }));
      }
    } catch (_) {
      // Saving is up to the browser and the person; signing in works either way
    }
  },

  /** Records a successful sign-in in this browser. */
  finishSignIn(result, { email: cleanEmail, remember }) {
    this._serverVerified = true;

    const user = result.user || {
      name: cleanEmail.split('@')[0].replace('.', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      email: cleanEmail,
      role: 'CEO & Managing Partner',
      avatar: cleanEmail.substring(0, 2).toUpperCase()
    };

    const sessionData = {
      token: 'slon_cookie_session',
      user,
      createdAt: new Date().toISOString()
    };

    if (remember) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
      localStorage.setItem(REMEMBER_KEY, cleanEmail);
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
      localStorage.removeItem(STORAGE_KEY);
    }

    return sessionData;
  },

  /**
   * Terminates active session on the server and locks the portal.
   */
  async logout() {
    this._serverVerified = false;
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
    } catch (_) {}

    this.clearClientSession();
  },

  /**
   * Checks whether the server session is still valid.
   */
  async checkServerSession() {
    try {
      const resp = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
      if (resp.ok) {
        const data = await resp.json();
        return data.user || true;
      }
    } catch (_) {}
    return null;
  },

  /**
   * Returns remembered email if any.
   */
  getRememberedEmail() {
    return localStorage.getItem(REMEMBER_KEY) || '';
  }
};
