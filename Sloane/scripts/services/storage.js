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

export const StorageService = {
  // --- Businesses ---
  getBusinesses() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.BUSINESSES);
      return data ? JSON.parse(data) : INITIAL_BUSINESSES;
    } catch (e) {
      console.error('Failed to read businesses from storage', e);
      return INITIAL_BUSINESSES;
    }
  },

  saveBusinesses(businesses) {
    try {
      localStorage.setItem(STORAGE_KEYS.BUSINESSES, JSON.stringify(businesses));
    } catch (e) {
      console.error('Failed to save businesses to storage', e);
    }
  },

  // --- Clients ---
  getClients() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CLIENTS);
      return data ? JSON.parse(data) : INITIAL_CLIENTS;
    } catch (e) {
      console.error('Failed to read clients from storage', e);
      return INITIAL_CLIENTS;
    }
  },

  saveClients(clients) {
    try {
      localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
    } catch (e) {
      console.error('Failed to save clients to storage', e);
    }
  },

  // --- CEO Brain (Strictly Private) ---
  getBrainEntries() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.BRAIN);
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
      localStorage.setItem(STORAGE_KEYS.BRAIN, JSON.stringify(entries));
    } catch (e) {
      console.error('Failed to save CEO brain entries', e);
    }
  },

  // --- Companies House Cache ---
  getCHCache() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CH_CACHE);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  },

  saveCHCache(cache) {
    try {
      localStorage.setItem(STORAGE_KEYS.CH_CACHE, JSON.stringify(cache));
    } catch (e) {
      console.error('Failed to save CH cache', e);
    }
  },

  // --- Trinova Configuration ---
  getTrinovaApiUrl() {
    return localStorage.getItem(STORAGE_KEYS.TRINOVA_API_URL) || 'https://trinova-staging.local/api/v1';
  },

  setTrinovaApiUrl(url) {
    localStorage.setItem(STORAGE_KEYS.TRINOVA_API_URL, url);
  }
};
