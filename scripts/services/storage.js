/**
 * Sloane Storage Service
 * Enforces separation between Sloane-private data (CEO Brain, private notes)
 * and cached shared data from Trinova.
 */

import { INITIAL_BUSINESSES, INITIAL_CLIENTS } from '../data/seed.js';

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
      return data ? JSON.parse(data) : INITIAL_CLIENTS;
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

  // --- CEO Brain (Strictly Private) ---
  getBrainEntries() {
    try {
      const data = safeStorage.getItem(STORAGE_KEYS.BRAIN);
      return data ? JSON.parse(data) : [
        {
          id: 'b-init-1',
          text: 'Need to review Hamza\'s revised client manager bonus structure before next Friday\'s partner catchup.',
          at: new Date(Date.now() - 3600000 * 4).toLocaleString('en-GB'),
          isPrivate: true
        },
        {
          id: 'b-init-2',
          text: 'Woofington Park: Sarah Jenkins promised she would sign the balance sheet by 4pm today so we can halt the strike-off.',
          at: new Date(Date.now() - 3600000 * 24).toLocaleString('en-GB'),
          isPrivate: true
        }
      ];
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
    return safeStorage.getItem(STORAGE_KEYS.TRINOVA_API_URL) || 'https://testnova-production-7b65.up.railway.app/api/v1';
  },

  setTrinovaApiUrl(url) {
    safeStorage.setItem(STORAGE_KEYS.TRINOVA_API_URL, url);
  },

  // --- Client Timeline Cache ---
  getTimeline(clientId) {
    try {
      const key = `sloane_timeline_${clientId}`;
      const data = safeStorage.getItem(key);
      if (data) return JSON.parse(data);

      // Default seeded events for immediate rich client timeline display
      if (clientId === 'cli_woofington_grp' || clientId === 'cl-1') {
        return [
          {
            id: 'evt_woof_004',
            client_id: clientId,
            event_type: 'COMPANIES_HOUSE_STATUS_CHANGED',
            title: 'Companies House Active Strike-Off Notice Registered',
            description: 'Compulsory strike-off notice registered on company number 12345678 due to overdue statutory accounts for period 30/11/2025.',
            occurred_at: new Date(Date.now() - 3600000 * 3).toISOString(),
            actor_type: 'system',
            source: 'companies_house',
            severity: 'critical',
            visibility: 'shared'
          },
          {
            id: 'evt_woof_003',
            client_id: clientId,
            event_type: 'NOTE_CREATED',
            title: 'Draft Accounts Sent to Director (Sarah Jenkins)',
            description: 'Draft accounts prepared and dispatched (£1,850 fee). Sarah promised to sign balance sheet to halt strike-off.',
            occurred_at: new Date(Date.now() - 3600000 * 24).toISOString(),
            actor_type: 'user',
            actor_id: 'actor_kirsty_allen',
            source: 'user',
            severity: 'urgent',
            visibility: 'shared'
          },
          {
            id: 'evt_woof_002',
            client_id: clientId,
            event_type: 'TASK_COMPLETED',
            title: 'Task Completed: Year-End Accounts Preparation',
            description: 'Accounts preparation completed by staff and moved to partner review.',
            occurred_at: new Date(Date.now() - 3600000 * 48).toISOString(),
            actor_type: 'user',
            actor_id: 'actor_kirsty_allen',
            source: 'task',
            severity: 'info',
            visibility: 'shared'
          },
          {
            id: 'evt_woof_001',
            client_id: clientId,
            event_type: 'CLIENT_CREATED',
            title: 'Client Onboarded to Practice',
            description: 'Woofington Park Limited registered under Trinova Accounting portfolio.',
            occurred_at: new Date(Date.now() - 3600000 * 240).toISOString(),
            actor_type: 'system',
            source: 'system',
            severity: 'info',
            visibility: 'shared'
          }
        ];
      } else if (clientId === 'cli_rgb_elevations' || clientId === 'cl-2') {
        return [
          {
            id: 'evt_rgb_001',
            client_id: clientId,
            event_type: 'STATUTORY_DEADLINE',
            title: 'Statutory Accounts Overdue',
            description: 'Statutory accounts for year ended 31/10/2025 overdue since 31/07/2026. Late filing penalties accumulating.',
            occurred_at: new Date(Date.now() - 3600000 * 12).toISOString(),
            actor_type: 'system',
            source: 'companies_house',
            severity: 'critical',
            visibility: 'shared'
          },
          {
            id: 'evt_rgb_002',
            client_id: clientId,
            event_type: 'TASK_CREATED',
            title: 'Task Created: Chase Robert Brown for Q4 Bank Records',
            description: 'Bank statements required to complete year-end trial balance reconciliation.',
            occurred_at: new Date(Date.now() - 3600000 * 36).toISOString(),
            actor_type: 'user',
            source: 'task',
            severity: 'urgent',
            visibility: 'shared'
          }
        ];
      }
      return [];
    } catch (e) {
      console.error('Failed to read timeline from storage', e);
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
