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
  }
};
