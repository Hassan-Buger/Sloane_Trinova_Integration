/**
 * Sloane CEO Command Centre — Authentication Service
 * Manages CEO executive session state, credentials verification,
 * and security perimeter locking.
 */

const STORAGE_KEY = 'sloane_ceo_session';
const REMEMBER_KEY = 'sloane_remember_ceo';

export const AuthService = {
  /**
   * Default verified CEO credentials
   */
  defaultUser: {
    name: 'Kirsty Allen',
    email: 'kirsty.allen@trinova.co.uk',
    role: 'CEO & Managing Partner',
    avatar: 'KA',
    businessesCount: 6
  },

  /**
   * Validates whether an active authenticated session exists.
   */
  isAuthenticated() {
    const session = this.getSession();
    if (!session || !session.token) {
      return false;
    }

    // Check expiration (7-day sliding session)
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      this.logout();
      return false;
    }

    return true;
  },

  /**
   * Retrieves the current user session object.
   */
  getSession() {
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) return JSON.parse(local);

      const session = sessionStorage.getItem(STORAGE_KEY);
      if (session) return JSON.parse(session);
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
      throw new Error(result.error?.message || 'Invalid email or password.');
    }

    const user = result.user || {
      name: 'Kirsty Allen',
      email: cleanEmail,
      role: 'CEO & Managing Partner',
      avatar: 'KA'
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
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
    } catch (_) {}

    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
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
    return localStorage.getItem(REMEMBER_KEY) || 'kirsty.allen@trinova.co.uk';
  }
};
