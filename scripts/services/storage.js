/**
 * Sloane Storage Service
 * Enforces separation between Sloane-private data (CEO Brain, private notes)
 * and cached shared data from Trinova.
 */

const INITIAL_BUSINESSES = [];
const INITIAL_CLIENTS = [];

const STORAGE_KEYS = {
  BUSINESSES: 'sloane_businesses_v2',
  CLIENTS: 'sloane_clients_v2',
  BRAIN: 'sloane_brain_v2',
  CH_CACHE: 'sloane_ch_cache_v2',
  TRINOVA_API_URL: 'sloane_trinova_api_url'
};

const safeStorage = {
  getItem(key) {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  },
  setItem(key, value) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  }
};

export const StorageService = {
  // --- Businesses ---
  getBusinesses() {
    try {
      const data = safeStorage.getItem(STORAGE_KEYS.BUSINESSES);
      return data ? JSON.parse(data) : INITIAL_BUSINESSES;
    } catch (e) {
      return INITIAL_BUSINESSES;
    }
  },

  saveBusinesses(businesses) {
    try {
      safeStorage.setItem(STORAGE_KEYS.BUSINESSES, JSON.stringify(businesses));
    } catch (e) {
      console.error('Failed to save businesses to storage', e);
    }
  },

  // --- Clients ---
  getClients() {
    try {
      const data = safeStorage.getItem(STORAGE_KEYS.CLIENTS);
      if (!data) return INITIAL_CLIENTS;
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter(c => {
          const crn = (c.no || c.company_number || '').trim();
          // Old example records are hidden by their company number, but never a client the owner added
          return c.addedInSloane || !['12345678', '08923412', '11223344', '07788991'].includes(crn);
        });
      }
      return INITIAL_CLIENTS;
    } catch (e) {
      return INITIAL_CLIENTS;
    }
  },

  saveClients(clients) {
    try {
      safeStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
    } catch (e) {
      console.error('Failed to save clients to storage', e);
    }
  },

  deleteClient(clientId) {
    try {
      const clients = this.getClients().filter(c => (c.id !== clientId && c.clientId !== clientId && c.rawId !== clientId));
      this.saveClients(clients);
      return true;
    } catch (e) {
      console.error('Failed to delete client from storage', e);
      return false;
    }
  },

  // --- CEO Brain (Strictly Private) ---
  getBrainEntries() {
    try {
      const data = safeStorage.getItem(STORAGE_KEYS.BRAIN);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to read CEO brain entries', e);
      return [];
    }
  },

  saveBrainEntries(entries) {
    try {
      safeStorage.setItem(STORAGE_KEYS.BRAIN, JSON.stringify(entries));
    } catch (e) {
      console.error('Failed to save CEO brain entries', e);
    }
  },

  // --- Companies House Cache ---
  getCHCache() {
    try {
      const data = safeStorage.getItem(STORAGE_KEYS.CH_CACHE);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  },

  saveCHCache(cache) {
    try {
      safeStorage.setItem(STORAGE_KEYS.CH_CACHE, JSON.stringify(cache));
    } catch (e) {
      console.error('Failed to save CH cache', e);
    }
  },

  // --- Trinova Configuration ---
  getTrinovaApiUrl() {
    return safeStorage.getItem(STORAGE_KEYS.TRINOVA_API_URL) || 'https://portal.trinovaaccounting.co.uk/api/v1';
  },

  setTrinovaApiUrl(url) {
    safeStorage.setItem(STORAGE_KEYS.TRINOVA_API_URL, url);
  },

  // --- Client Timeline Cache ---
  getTimeline(clientId) {
    // Only what was saved on this device earlier. Nothing is made up.
    try {
      const data = safeStorage.getItem(`sloane_timeline_${clientId}`);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },


  saveTimeline(clientId, events) {
    try {
      const key = `sloane_timeline_${clientId}`;
      safeStorage.setItem(key, JSON.stringify(events));
    } catch (e) {
      console.error('Failed to save timeline to storage', e);
    }
  },

  // Generic key-value helpers
  get(key) {
    const val = safeStorage.getItem(key);
    try {
      return val ? JSON.parse(val) : null;
    } catch (_) {
      return val;
    }
  },

  set(key, val) {
    safeStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  }
};
