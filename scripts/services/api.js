/**
 * Sloane Trinova API Client & Service Layer
 * Adheres strictly to the TriNova /api/v1 REST API specification.
 * Supports configurable Base URL with session-cookie authentication and local cache fallback.
 */

import { StorageService } from './storage.js';
import { ReconciliationEngine } from './reconciliation.js';

// Default production endpoint and fallback key
// If running in browser, connect to origin/api/v1 automatically (seamless full-stack Railway / domain support)
const getDynamicDefaultBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) {
    return `${window.location.origin}/api/v1`;
  }
  return 'https://portal.trinovaaccounting.co.uk/api/v1';
};

const DEFAULT_BASE_URL = getDynamicDefaultBaseUrl();

// Server-side secret protection: purge legacy client-stored tokens and stale credentials
if (typeof localStorage !== 'undefined') {
  try {
    localStorage.removeItem('sloane_trinova_api_token');
    const storedUrl = localStorage.getItem('sloane_trinova_base_url');
    if (storedUrl && (storedUrl.includes('testnova-production-7b65.up.railway.app') || storedUrl.includes('testnova') || storedUrl.includes('localhost:4000') || storedUrl.includes('sloanetrinovaintegration-production.up.railway.app'))) {
      localStorage.removeItem('sloane_trinova_base_url');
    }
    // Clean out legacy mock client records from localStorage by CRN
    const cachedClientsStr = localStorage.getItem('sloane_clients_v2');
    if (cachedClientsStr) {
      const cached = JSON.parse(cachedClientsStr);
      if (Array.isArray(cached)) {
        const cleaned = cached.filter(c => {
          const crn = (c.no || c.company_number || '').trim();
          return !['12345678', '08923412', '11223344', '07788991'].includes(crn);
        });
        localStorage.setItem('sloane_clients_v2', JSON.stringify(cleaned));
      }
    }
    localStorage.removeItem('sloane_clients_v1');
    localStorage.removeItem('sloane_clients');
  } catch (_) {}
}

export const ApiService = {
  // Current in-memory configuration
  config: {
    baseUrl: (typeof localStorage !== 'undefined' && localStorage.getItem('sloane_trinova_base_url')) || DEFAULT_BASE_URL,
    status: 'unknown', // 'online' | 'offline' | 'checking'
    lastChecked: null,
    latencyMs: null,
    actor: null
  },

  /**
   * Updates configuration and persists to localStorage.
   */
  configure({ baseUrl }) {
    if (baseUrl !== undefined) {
      this.config.baseUrl = baseUrl.trim().replace(/\/+$/, '');
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sloane_trinova_base_url', this.config.baseUrl);
      }
    }
    return this.config;
  },

  /**
   * Resets configuration to default Railway endpoints.
   */
  resetToDefaults() {
    return this.configure({
      baseUrl: DEFAULT_BASE_URL
    });
  },

  /**
   * Generates a UUID v4 for request idempotency headers.
   */
  generateIdempotencyKey() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  /**
   * Internal HTTP request helper with timeout and auth headers.
   */
  async request(endpoint, options = {}) {
    const isSloaneInternal = endpoint.startsWith('/outlook') ||
                             endpoint.startsWith('/integrations/outlook') ||
                             endpoint.startsWith('/ai') ||
                             endpoint.startsWith('/ceo-brain') ||
                             endpoint.startsWith('/notes') ||
                             endpoint.startsWith('/auth/login') ||
                             endpoint.startsWith('/auth/logout') ||
                             endpoint.startsWith('/auth/session');

    let base = this.config.baseUrl;
    if (isSloaneInternal && typeof window !== 'undefined' && window.location?.origin && !window.location.origin.startsWith('file:')) {
      base = `${window.location.origin}/api/v1`;
    }
    const url = `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const timeoutMs = options.timeout || 9000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      'Accept': 'application/json',
      'X-Requested-With': 'sloane',
      ...options.headers
    };

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      if (!headers['Idempotency-Key']) {
        headers['Idempotency-Key'] = this.generateIdempotencyKey();
      }
    }

    try {
      const startTime = performance.now();
      const response = await fetch(url, {
        method,
        headers,
        body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
        signal: controller.signal,
        credentials: 'same-origin'
      });
      clearTimeout(timer);

      const duration = Math.round(performance.now() - startTime);

      let data = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = { raw: text };
        }
      }

      if (!response.ok) {
        if (response.status === 401 && !endpoint.includes('/auth/login') && !options.skipAuthRedirect) {
          if (typeof window !== 'undefined' && window.app && typeof window.app.showLoginView === 'function') {
            window.app.showLoginView();
          }
        }
        const errorMsg = data?.error?.message || data?.message || `HTTP ${response.status} ${response.statusText}`;
        const error = new Error(errorMsg);
        error.status = response.status;
        error.code = data?.error?.code || 'API_ERROR';
        error.data = data;
        throw error;
      }

      return {
        ok: true,
        status: response.status,
        durationMs: duration,
        data: data?.data !== undefined ? data.data : data,
        raw: data,
        meta: data?.meta || null
      };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms (${url})`);
        timeoutErr.code = 'TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    }
  },

  /* ==========================================================================
     1. Health & Auth Verification Endpoints
     ========================================================================== */

  /**
   * Checks API health & database connectivity (Public).
   */
  async checkHealth() {
    try {
      const res = await this.request('/health', { skipAuth: true, timeout: 6000 });
      this.config.status = 'online';
      this.config.lastChecked = new Date().toISOString();
      this.config.latencyMs = res.durationMs;
      return {
        ok: true,
        healthy: res.data?.healthy ?? true,
        database: res.data?.database || 'connected',
        version: res.data?.version || '1.0.0',
        durationMs: res.durationMs
      };
    } catch (err) {
      this.config.status = 'offline';
      this.config.lastChecked = new Date().toISOString();
      return {
        ok: false,
        healthy: false,
        error: err.message
      };
    }
  },

  /**
   * Verifies Bearer token, actor identity and permitted scopes.
   */
  async verifyAuth() {
    try {
      const res = await this.request('/auth/verify', { timeout: 6000 });
      this.config.status = 'online';
      this.config.actor = res.data?.actor || 'sloane_ceo_command_centre';
      return {
        ok: true,
        authenticated: res.data?.authenticated ?? true,
        actor: res.data?.actor,
        scopes: res.data?.scopes || [],
        durationMs: res.durationMs
      };
    } catch (err) {
      return {
        ok: false,
        authenticated: false,
        error: err.message
      };
    }
  },

  /* ==========================================================================
     2. Clients & Company Entities
     ========================================================================== */

  /**
   * Reads all client/company records.
   * Connects to live TriNova GET /api/v1/clients with transparent offline fallback.
   */
  async getClients(filters = {}) {
    try {
      const queryParams = new URLSearchParams();
      if (filters.search) queryParams.set('q', filters.search);
      if (filters.biz && filters.biz !== 'All') queryParams.set('type', filters.biz);
      if (filters.page) queryParams.set('page', filters.page);
      if (filters.perPage) queryParams.set('per_page', filters.perPage || '50');
      if (filters.refresh) queryParams.set('refresh', '1');

      const endpoint = `/clients${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
      const res = await this.request(endpoint);

      if (res.data && Array.isArray(res.data)) {
        // Map TriNova entities into Sloane's Client 360 schema
        const mappedClients = res.data.map(item => {
          const primaryComp = (item.companies && item.companies[0]) || {};
          const dirsFormatted = Array.isArray(item.directors) 
            ? item.directors.join(', ') 
            : (item.directors || item.primary_contact?.name || (item.contacts && item.contacts[0]?.name) || '—');

          return {
            id: item.id || item.company_id || `comp_${item.id}`,
            rawId: item.id,
            // Notes, documents, signing and tasks attach to this id (a client added in Sloane keeps them on its company)
            companyId: item.addedInSloane ? (primaryComp.id || null) : null,
            clientId: item.client_id || item.id,
            name: item.name || item.company_name || primaryComp.companyName,
            no: item.company_number || primaryComp.companyNumber || '',
            biz: item.businessArea || item.entity_type || 'Corporate',
            year: item.financial_year_end || primaryComp.accountingReferenceDate || '',
            accounts: item.accounts_due || primaryComp.accountsDueDate || '',
            confirm: item.confirmation_statement_due || primaryComp.confirmationDueDate || '',
            vat: item.vat_registered ? 'Yes' : (item.tax_reference ? 'Yes' : 'No'),
            vatNo: item.vat_number || item.tax_reference || '',
            paye: item.paye_reference || '',
            cis: item.cis_registered ? 'Yes' : 'No',
            dirs: dirsFormatted,
            owner: item.assignedManagerName || item.account_manager || 'Kirsty Allen',
            risk: primaryComp.riskLevel || item.risk_tier || (item.aml_status === 'Action Required' ? 'High' : 'Low'),
            notes: item.notes || item.primary_contact?.address || '',
            isLiveTriNova: !item.addedInSloane,
            addedInSloane: Boolean(item.addedInSloane),
            assignedBusiness: item.assignedBusiness || null
          };
        }).filter(c => {
          const crn = (c.no || '').trim();
          return !['12345678', '08923412', '11223344', '07788991'].includes(crn);
        });

        // Cache live data locally
        if (!filters.search && (!filters.biz || filters.biz === 'All')) {
          StorageService.saveClients(mappedClients);
        }

        return {
          status: 'success',
          source: 'trinova_live',
          data: mappedClients,
          trinovaStatus: res.meta?.trinovaStatus || null,
          meta: res.meta || { total: mappedClients.length }
        };
      }
    } catch (err) {
      console.warn('TriNova live API unavailable, using offline cached clients:', err.message);
    }

    // Graceful offline fallback from local storage
    let clients = StorageService.getClients();

    if (filters.biz && filters.biz !== 'All') {
      clients = clients.filter(c => c.biz === filters.biz);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      clients = clients.filter(c => {
        return (c.name && c.name.toLowerCase().includes(q)) ||
               (c.no && c.no.toLowerCase().includes(q)) ||
               (c.dirs && c.dirs.toLowerCase().includes(q)) ||
               (c.notes && c.notes.toLowerCase().includes(q));
      });
    }

    return {
      status: 'success',
      source: 'local_cache',
      data: clients,
      meta: { total: clients.length }
    };
  },

  /**
   * Fetches single company details with directors and primary contact.
   */
  async getCompanyDetails(companyId) {
    try {
      const res = await this.request(`/companies/${companyId}`);
      return {
        status: 'success',
        data: res.data
      };
    } catch (err) {
      // Fallback search in local storage
      const clients = StorageService.getClients();
      const match = clients.find(c => c.id === companyId || c.no === companyId);
      return {
        status: match ? 'success' : 'error',
        source: 'local_cache',
        data: match || null
      };
    }
  },

  /**
   * Adds a client in Sloane (POST /api/v1/clients). If the server does not accept it, the
   * error is shown to the user: nothing is pretended to be saved.
   */
  async createClient(clientData) {
    const res = await this.request('/clients', {
      method: 'POST',
      body: clientData
    });
    return { status: 'success', data: res.data };
  },

  /**
   * Deletes a client entity and removes from local storage.
   */
  async deleteClient(clientId) {
    // Let the server's answer through (e.g. "this client lives in TriNova") instead of
    // pretending the client was removed.
    await this.request(`/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    StorageService.deleteClient(clientId);
    return { status: 'success', message: 'Client removed' };
  },

  /**
   * Changes a client that was added by hand in Sloane (PATCH /api/v1/clients/:id).
   */
  async updateClient(clientId, clientData) {
    const res = await this.request(`/clients/${encodeURIComponent(clientId)}`, {
      method: 'PATCH',
      body: clientData
    });
    return { status: 'success', data: res.data };
  },

  /**
   * Renames / edits a business area (PATCH /api/v1/businesses/:id).
   */
  async updateBusiness(bizId, changes) {
    const res = await this.request(`/businesses/${encodeURIComponent(bizId)}`, {
      method: 'PATCH',
      body: changes
    });
    return { status: 'success', data: res.data };
  },

  /**
   * Removes a business area (DELETE /api/v1/businesses/:id).
   */
  async deleteBusiness(bizId) {
    await this.request(`/businesses/${encodeURIComponent(bizId)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  /**
   * Reads business areas from GET /api/v1/businesses with local cache fallback.
   */
  async getBusinesses() {
    try {
      const res = await this.request('/businesses');
      if (res && Array.isArray(res.data)) {
        StorageService.saveBusinesses(res.data);
        return {
          status: 'success',
          data: res.data
        };
      }
    } catch (err) {
      console.warn('Could not fetch businesses from API, falling back to local cache:', err.message);
    }

    const businesses = StorageService.getBusinesses();
    const clients = StorageService.getClients();

    // Dynamically calculate real linked client counts
    const enriched = businesses.map(b => {
      const count = clients.filter(c => c.biz === b.name || c.businessArea === b.name).length;
      return {
        ...b,
        clientCount: count
      };
    });

    return {
      status: 'success',
      data: enriched
    };
  },

  /**
   * Adds a business (POST /api/v1/businesses). Errors are shown, never hidden.
   */
  async createBusiness(bizData) {
    const res = await this.request('/businesses', {
      method: 'POST',
      body: bizData
    });
    return { status: 'success', data: res.data };
  },

  /**
   * Retrieves tasks from TriNova GET /api/v1/tasks.
   */
  async getTasks(params = {}) {
    try {
      const query = new URLSearchParams(params).toString();
      const res = await this.request(`/tasks${query ? '?' + query : ''}`);
      return {
        status: 'success',
        data: res.data || [],
        meta: res.meta || {}
      };
    } catch (err) {
      console.warn('Could not fetch tasks:', err.message);
      return {
        status: 'error',
        data: [],
        error: err.message
      };
    }
  },

  /**
   * Changes a task (status, due date, ...) via PATCH /api/v1/tasks/:id.
   */
  async updateTask(taskId, changes = {}) {
    const res = await this.request(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: changes
    });
    return { status: 'success', data: res.data };
  },

  /**
   * Marks a task as done via POST /api/v1/tasks/:id/complete.
   */
  async completeTask(taskId, note = '') {
    const res = await this.request(`/tasks/${encodeURIComponent(taskId)}/complete`, {
      method: 'POST',
      body: note ? { completionNotes: note, resolution: note } : {}
    });
    return { status: 'success', data: res.data };
  },

  /* ==========================================================================
     3. Statutory Deadlines & Companies House Sync
     ========================================================================== */

  /**
   * Retrieves statutory deadlines from TriNova GET /api/v1/statutory.
   */
  async getStatutory(params = {}) {
    try {
      const query = new URLSearchParams(params).toString();
      const res = await this.request(`/statutory${query ? '?' + query : ''}`);
      return {
        status: 'success',
        data: res.data,
        meta: res.meta || {}
      };
    } catch (err) {
      console.warn('Could not fetch deadlines:', err.message);
      return {
        status: 'error',
        data: [],
        error: err.message
      };
    }
  },

  /**
   * Asks the server to check companies against the real Companies House register.
   * POST /api/v1/statutory/sync. With no company numbers, the server checks every
   * company it knows about. The result is exactly what the server reports.
   */
  async syncCompaniesHouse(companyNumbers = []) {
    try {
      const res = await this.request('/statutory/sync', {
        method: 'POST',
        body: companyNumbers.length > 0 ? { companyNumbers } : {},
        timeout: 60000
      });
      const d = res.data || {};
      return {
        status: 'success',
        reachedServer: true,
        totalRequested: d.totalRequested || 0,
        syncedCount: d.syncedCount || 0,
        failedCount: d.failedCount || 0,
        syncedAt: d.syncedAt || new Date().toISOString(),
        results: d.results || []
      };
    } catch (err) {
      console.warn('Companies House check could not be completed:', err.message);
      return {
        status: 'error',
        reachedServer: false,
        error: err.message,
        totalRequested: 0,
        syncedCount: 0,
        failedCount: 0,
        syncedAt: new Date().toISOString(),
        results: []
      };
    }
  },

  /* ==========================================================================
     4. Internal Notes & Strict Privacy Boundary
     ========================================================================== */

  /**
   * Saves a note on a client's Notes tab (POST /api/v1/companies/:id/notes).
   * The note is kept in Sloane. It is NOT sent to TriNova.
   */
  async sendNoteToTrinova(notePayload) {
    if (!notePayload.text) {
      throw new Error('Note text is required.');
    }
    const companyId = notePayload.companyId;
    if (!companyId) {
      throw new Error('Please choose which client the note is for.');
    }
    const visibility = notePayload.visibility || 'staff_only';

    const res = await this.request(`/companies/${encodeURIComponent(companyId)}/notes`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': notePayload.idempotencyKey || this.generateIdempotencyKey()
      },
      body: {
        text: notePayload.text,
        confirm_write_to_trinova: true,
        visibility
      }
    });

    return {
      status: 'success',
      source: 'sloane',
      message: 'Saved on the client\'s Notes tab.',
      data: res.data
    };
  },

  /**
   * Reads internal notes for a company from GET /api/v1/companies/:companyId/notes.
   */
  async getCompanyNotes(companyId) {
    try {
      const res = await this.request(`/companies/${companyId}/notes`);
      return {
        status: 'success',
        data: res.data || []
      };
    } catch (err) {
      console.warn('Could not fetch company notes from API:', err.message);
      return {
        status: 'fallback',
        data: []
      };
    }
  },

  /* ==========================================================================
     5. Documents & Signed Download URLs
     ========================================================================== */

  /**
   * Retrieves documents list for a company. Errors are passed on so the screen can say so.
   */
  async getCompanyDocuments(companyId) {
    const res = await this.request(`/companies/${encodeURIComponent(companyId)}/documents`);
    return { status: 'success', data: res.data || [] };
  },

  /**
   * Uploads a file for a client. `file` is a browser File.
   */
  async uploadDocument(companyId, file, category = 'General') {
    const contentBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        resolve(text.slice(text.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsDataURL(file);
    });
    const res = await this.request(`/companies/${encodeURIComponent(companyId)}/documents/upload`, {
      method: 'POST',
      timeout: 60000,
      body: { filename: file.name, mimeType: file.type || undefined, category, contentBase64 }
    });
    return { status: 'success', data: res.data };
  },

  async updateDocument(documentId, changes) {
    const res = await this.request(`/documents/${encodeURIComponent(documentId)}`, { method: 'PATCH', body: changes });
    return { status: 'success', data: res.data };
  },

  async deleteDocument(documentId) {
    await this.request(`/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  /**
   * Asks for a short-lived download link for a document.
   */
  async getDocumentAccessToken(documentId) {
    const res = await this.request(`/documents/${encodeURIComponent(documentId)}/download-token`);
    return { status: 'success', data: res.data };
  },

  /* ==========================================================================
     6. Digital Signatures & Audit
     ========================================================================== */

  /**
   * Retrieves signing requests for a company.
   */
  async getSigningRequests(companyId) {
    try {
      const res = await this.request(`/companies/${companyId}/signing-requests`);
      return {
        status: 'success',
        data: res.data || []
      };
    } catch (err) {
      return {
        status: 'error',
        data: [],
        error: err.message
      };
    }
  },

  /**
   * Records a signing request for a client's document.
   */
  async createSigningRequest(companyId, payload) {
    const res = await this.request(`/companies/${encodeURIComponent(companyId)}/signing-requests`, {
      method: 'POST',
      body: payload
    });
    return { status: 'success', data: res.data, delivery: res.meta?.delivery || res.raw?.meta?.delivery };
  },

  async cancelSigningRequest(requestId) {
    const res = await this.request(`/signing-requests/${encodeURIComponent(requestId)}/cancel`, { method: 'POST', body: {} });
    return { status: 'success', data: res.data };
  },

  /**
   * Retrieves tamper-evident signature audit trail.
   */
  async getSignatureAudit(signatureId) {
    return this.request(`/signatures/${signatureId}/audit`);
  },

  /* ==========================================================================
     7. Client Timeline API (Feature 1)
     ========================================================================== */

  /**
   * Retrieves chronological timeline events for a client.
   * Adheres to Prompt Section 11-14.
   */
  async getClientTimeline(clientId, params = {}) {
    try {
      const searchParams = new URLSearchParams();
      if (params.event_type) searchParams.append('event_type', params.event_type);
      if (params.severity) searchParams.append('severity', params.severity);
      if (params.visibility) searchParams.append('visibility', params.visibility);
      if (params.from) searchParams.append('from', params.from);
      if (params.to) searchParams.append('to', params.to);
      if (params.limit) searchParams.append('limit', params.limit);
      if (params.cursor) searchParams.append('cursor', params.cursor);

      const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
      const res = await this.request(`/clients/${clientId}/timeline${qs}`);
      return {
        status: 'success',
        source: 'trinova_live',
        data: res.data || [],
        client: res.client || null,
        meta: res.meta || {}
      };
    } catch (err) {
      console.warn(`[ApiService] Live timeline fetch failed for ${clientId}:`, err.message);
      // Fallback: check local storage cache
      const localEvents = StorageService.getTimeline(clientId);
      return {
        status: 'fallback',
        source: 'local_cache',
        data: localEvents,
        client: null,
        meta: { total: localEvents.length }
      };
    }
  },

  /**
   * Logs a new client timeline event with server-side validation.
   */
  async createTimelineEvent(clientId, eventData) {
    return this.request(`/clients/${clientId}/timeline/events`, {
      method: 'POST',
      body: eventData
    });
  },

  /* ==========================================================================
     8. Secure Claude AI Assistant API (Feature 2)
     ==========================================================================   /**
   * Tests AI assistant connectivity via secure backend endpoint.
   */
  async testAnthropicKey() {
    try {
      const res = await this.request('/ai/ask', {
        method: 'POST',
        body: { message: 'Ping. Confirm AI assistant status.' }
      });
      if (res && res.ok) {
        const source = res.raw?.source || res.data?.source || 'backend_ai';
        const isClaude = source === 'anthropic_claude';
        return {
          ok: true,
          source,
          message: isClaude
            ? 'The AI (Claude) is connected and answering.'
            : 'No AI is connected, so Sloane answers from your saved records only.'
        };
      }
      return { ok: false, message: 'The AI did not answer.' };
    } catch (err) {
      return { ok: false, message: `Sloane could not reach the AI: ${err.message}` };
    }
  },

  getAiProvider() {
    return localStorage.getItem('sloane_ai_provider') || 'auto';
  },

  setAiProvider(provider) {
    if (['auto', 'gemini', 'anthropic'].includes(provider)) {
      localStorage.setItem('sloane_ai_provider', provider);
    }
  },

  /**
   * Queries Sloane AI via secure backend endpoint with strict server-side credentials.
   * Adheres to Prompt Section 25, 28, 29, 36, 44:
   * 1. Submits query and multi-turn history to backend POST /api/v1/ai/ask
   * 2. Supports provider selection ('auto', 'gemini', 'anthropic')
   * 3. Falls back to verified local practice rules engine if server is unreachable
   * 4. Accurately reports provenance (never claims fallback is live Claude or Gemini)
   */
  async askAi(payload) {
    const startTime = performance.now();

    // 1. Call secure server-side AI endpoint
    try {
      const res = await this.request('/ai/ask', {
        method: 'POST',
        body: {
          message: (payload.message || '').trim(),
          clientId: payload.clientId || null,
          history: Array.isArray(payload.history) ? payload.history : [],
          provider: payload.provider || this.getAiProvider(),
          model: payload.model || null
        }
      });

      if (res && res.ok && res.data) {
        const envelope = res.raw || {};
        const payloadData = res.data.data !== undefined ? res.data.data : res.data;
        const source = envelope.source || res.data.source || 'deterministic_rules_engine';
        const model = envelope.model || res.data.model || 'deterministic-rules-v1';
        return {
          ok: true,
          status: envelope.status || res.data.status || 'success',
          source,
          model,
          data: payloadData,
          privacy: envelope.privacy || res.data.privacy,
          usage: envelope.usage || res.data.usage || { durationMs: Math.round(performance.now() - startTime) },
          reason: envelope.reason || res.data.reason || null
        };
      }
    } catch (err) {
      console.warn('[ApiService] Secure backend /ai/ask call failed, engaging local grounded engine:', err.message);
    }

    // 2. Truthful local grounded reasoning fallback
    return this.runGroundedFallback(payload, startTime);
  },

  /**
   * Grounded Client-Side Reasoning Engine.
   * Adheres strictly to Prompt Principles 6, 7, 8, 32, 33:
   * Answers greetings conversationally, math directly, and grounds practice questions
   * in Solane's actual stored practice data without inventing facts.
   */
  async runGroundedFallback(payload, startTimeMs = performance.now()) {
    const message = (payload.message || '').trim();
    const mLower = message.toLowerCase();
    const clientId = payload.clientId || '';

    // 1. Resolve client from StorageService or seed trackers
    const clients = StorageService.getClients() || [];
    let targetClient = null;

    if (clientId) {
      targetClient = clients.find(c => c.id === clientId || c.id === `cli_${clientId}` || c.name?.toLowerCase().includes(clientId.toLowerCase()));
    }

    if (!targetClient) {
      targetClient = clients.find(c => c.name && mLower.includes(c.name.toLowerCase()));
    }

    // Check conversational context from history
    if (!targetClient && Array.isArray(payload.history)) {
      const historyText = payload.history.map(h => (typeof h.content === 'string' ? h.content : '')).join(' ').toLowerCase();
      targetClient = clients.find(c => c.name && historyText.includes(c.name.toLowerCase()));
    }

    let responseData = null;

    // A. Casual Greeting
    const isGreeting = /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|greetings|hiya|what'?s\s+up|how\s+are\s+you)\b/i.test(mLower);
    if (isGreeting) {
      responseData = {
        response_type: 'conversational',
        answer: 'Hello. I am Sloane. Ask me about your clients, tasks or deadlines.',
        risk_level: null,
        key_reasons: [],
        recommended_actions: [],
        evidence: []
      };
    }

    // B. Arithmetic / Math Questions (e.g. "What is 2 + 2?")
    else if (/(\d+)\s*([\+\-\*\/])\s*(\d+)/.test(mLower)) {
      const mathMatch = mLower.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
      const a = parseInt(mathMatch[1], 10);
      const op = mathMatch[2];
      const b = parseInt(mathMatch[3], 10);
      let resVal = 0;
      if (op === '+') resVal = a + b;
      else if (op === '-') resVal = a - b;
      else if (op === '*') resVal = a * b;
      else if (op === '/') resVal = b !== 0 ? Math.round((a / b) * 100) / 100 : 'undefined';

      responseData = {
        response_type: 'general_knowledge',
        answer: `${a} ${op} ${b} = ${resVal}.`,
        risk_level: null,
        key_reasons: [],
        recommended_actions: [],
        evidence: []
      };
    }

    // C. Capability / Identity Inquiries
    else if (/^(who\s+are\s+you|what\s+can\s+you\s+help|what\s+do\s+you\s+do|explain\s+what\s+you\s+can)\b/i.test(mLower)) {
      responseData = {
        response_type: 'general_knowledge',
        answer: 'I am Sloane. I can answer questions about your clients, tasks and deadlines using the records saved in Sloane.',
        risk_level: null,
        key_reasons: [],
        recommended_actions: [],
        evidence: []
      };
    }

    // Anything about the practice needs the server's records, and the server cannot be reached
    // right now. Say so, and never make up an answer.
    else {
      responseData = {
        response_type: 'conversational',
        answer: 'Sloane could not reach its server just now, so it cannot look at your records to answer that. Please try again in a minute.',
        risk_level: null,
        key_reasons: [],
        recommended_actions: [],
        evidence: []
      };
    }

    const elapsed = Math.round(performance.now() - startTimeMs);

    return {
      ok: true,
      status: 'fallback',
      source: 'offline_rules_engine',
      model: 'deterministic_grounded_fallback',
      data: responseData,
      usage: { durationMs: elapsed }
    };
  },

  /**
   * Retrieves morning executive briefing.
   * Adheres to Prompt Section 42.
   */
  async getExecutiveBriefing() {
    // No made-up fallback: if the server cannot be reached the error is passed on.
    return this.request('/ai/executive-briefing');
  },

  /* ==========================================================================
     Tasks, team, deadlines, VAT, notes and history: create / change / delete
     ========================================================================== */

  async createTask(payload) {
    const res = await this.request('/tasks', { method: 'POST', body: payload });
    return { status: 'success', data: res.data };
  },

  async deleteTask(taskId) {
    await this.request(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  async getTeam() {
    try {
      const res = await this.request('/team');
      return { status: 'success', data: res.data || [] };
    } catch (err) {
      return { status: 'error', data: [], error: err.message };
    }
  },

  async createTeamMember(payload) {
    const res = await this.request('/team', { method: 'POST', body: payload });
    return { status: 'success', data: res.data };
  },

  async updateTeamMember(id, changes) {
    const res = await this.request(`/team/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
    return { status: 'success', data: res.data };
  },

  async deleteTeamMember(id) {
    await this.request(`/team/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  async createDeadline(payload) {
    const res = await this.request('/statutory/deadlines', { method: 'POST', body: payload });
    return { status: 'success', data: res.data };
  },

  async updateDeadline(id, changes) {
    const res = await this.request(`/statutory/deadlines/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
    return { status: 'success', data: res.data };
  },

  async deleteDeadline(id) {
    await this.request(`/statutory/deadlines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  async getVatReturns() {
    try {
      const res = await this.request('/vat-returns');
      return { status: 'success', data: res.data || [] };
    } catch (err) {
      return { status: 'error', data: [], error: err.message };
    }
  },

  async createVatReturn(payload) {
    const res = await this.request('/vat-returns', { method: 'POST', body: payload });
    return { status: 'success', data: res.data };
  },

  async updateVatReturn(id, changes) {
    const res = await this.request(`/vat-returns/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
    return { status: 'success', data: res.data };
  },

  async deleteVatReturn(id) {
    await this.request(`/vat-returns/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  async updateCompanyNote(companyId, noteId, changes) {
    const res = await this.request(`/companies/${encodeURIComponent(companyId)}/notes/${encodeURIComponent(noteId)}`, { method: 'PATCH', body: changes });
    return { status: 'success', data: res.data };
  },

  async deleteCompanyNote(companyId, noteId) {
    await this.request(`/companies/${encodeURIComponent(companyId)}/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  async updateTimelineEvent(clientId, eventId, changes) {
    const res = await this.request(`/clients/${encodeURIComponent(clientId)}/timeline/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: changes });
    return { status: 'success', data: res.data };
  },

  async deleteTimelineEvent(clientId, eventId) {
    await this.request(`/clients/${encodeURIComponent(clientId)}/timeline/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  /** Puts a client under one of the owner's businesses (null takes it out). */
  async setClientBusiness(clientId, businessArea) {
    const res = await this.request(`/clients/${encodeURIComponent(clientId)}/business`, { method: 'PUT', body: { businessArea } });
    return { status: 'success', data: res.data };
  },

  /* ---- My Private Notes (saved on the server, signed-in owner only) ---- */

  async getPrivateNotes() {
    const res = await this.request('/ceo-notes');
    return { status: 'success', data: res.data || [] };
  },

  async createPrivateNote(text) {
    const res = await this.request('/ceo-notes', { method: 'POST', body: { text } });
    return { status: 'success', data: res.data };
  },

  async updatePrivateNote(id, text) {
    const res = await this.request(`/ceo-notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { text } });
    return { status: 'success', data: res.data };
  },

  async deletePrivateNote(id) {
    await this.request(`/ceo-notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { status: 'success' };
  },

  async importPrivateNotes(notes) {
    const res = await this.request('/ceo-notes/import', { method: 'POST', body: { notes } });
    return { status: 'success', data: res.data };
  },

  /** Plain facts about this install: where data is saved, whether TriNova is connected. */
  async getSystemStatus() {
    try {
      const res = await this.request('/system/status');
      return { status: 'success', data: res.data };
    } catch (err) {
      return { status: 'error', data: null, error: err.message };
    }
  },

  /* ==========================================================================
     Outlook Integration API (§4.1 - §4.3)
     ========================================================================== */

  async getOutlookStatus() {
    return this.request('/integrations/outlook/status');
  },

  async updateOutlookSettings(settings = {}) {
    return this.request('/integrations/outlook/settings', {
      method: 'PATCH',
      body: settings
    });
  },

  async getOutlookFolders() {
    return this.request('/integrations/outlook/folders');
  },

  async syncOutlook() {
    return this.request('/integrations/outlook/sync', {
      method: 'POST'
    });
  },

  async disconnectOutlook() {
    return this.request('/integrations/outlook/disconnect', {
      method: 'POST'
    });
  },

  async getOutlookDiary(date = 'today') {
    return this.request(`/outlook/diary?date=${encodeURIComponent(date)}`);
  },

  async getOutlookFlaggedEmails() {
    return this.request('/outlook/flagged-emails');
  }
};
