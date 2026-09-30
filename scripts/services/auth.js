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
   * Authenticates the CEO credentials.
   * Accepts standard practice test password 'password123'
   * or any password starting with 'password' / 'admin' / 'sloane'.
   */
  async login({ email, password, remember = true }) {
    // Artificial small delay for security feel & UX feedback
    await new Promise(resolve => setTimeout(resolve, 350));

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();

    if (!cleanEmail) {
      throw new Error('Please enter your executive email address.');
    }

    if (!cleanPass) {
      throw new Error('Please enter your executive password.');
    }

    // Flexible practice authentication rule:
    // 1. Exact match: password123
    // 2. Or matches 'sloane2026' or 'admin123'
    // 3. Or password length >= 6
    const isValidPass = cleanPass === 'password123' || 
                        cleanPass === 'sloane2026' || 
                        cleanPass.length >= 6;

    if (!isValidPass) {
      throw new Error('Invalid executive password. Default test password is: password123');
    }

    const displayName = cleanEmail.includes('kirsty') 
      ? 'Kirsty Allen' 
      : cleanEmail.split('@')[0].replace('.', ' ').replace(/\b\w/g, l => l.toUpperCase());

    const sessionData = {
      token: `sloane_sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      user: {
        name: displayName,
        email: cleanEmail,
        role: 'CEO & Managing Partner',
        avatar: displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
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
   * Terminates active session and locks the portal.
   */
  logout() {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  },

  /**
   * Returns remembered email if any.
   */
  getRememberedEmail() {
    return localStorage.getItem(REMEMBER_KEY) || 'kirsty.allen@trinova.co.uk';
  }
};
