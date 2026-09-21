/**
 * Server-Side Companies House API Service
 * Handles authenticated outbound communication to https://api.company-information.service.gov.uk,
 * enforces server-side credential isolation, rate limiting (600 req / 5 min),
 * bounded timeouts, exponential backoff retries, and caching.
 *
 * Adheres strictly to:
 * - context/04_backend_integration_context.md §9 (Companies House backend integration)
 * - context/05_data_security_context.md §4 (Server-side credentials only)
 * - context/specs/03-companies-house-backend.md
 */

import { config } from '../config.js';

export class CompaniesHouseService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || config.companiesHouse?.apiKey || '';
    this.baseUrl = (options.baseUrl || config.companiesHouse?.baseUrl || 'https://api.company-information.service.gov.uk').replace(/\/$/, '');
    this.rateLimitMax = options.rateLimitMaxRequests || config.companiesHouse?.rateLimitMaxRequests || 600;
    this.rateLimitWindowMs = options.rateLimitWindowMs || config.companiesHouse?.rateLimitWindowMs || 300000;
    this.timeoutMs = options.timeoutMs || config.companiesHouse?.timeoutMs || 5000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : (config.companiesHouse?.maxRetries ?? 2);
    this.cacheTtlMs = options.cacheTtlMs || config.companiesHouse?.cacheTtlMs || 3600000;
    
    // Injected fetch function for test isolation and mocking
    this.fetchFn = options.fetchFn || globalThis.fetch;

    // In-memory sliding window rate tracker
    this.requestTimestamps = [];

    // In-memory response cache: Map<companyNumber, { data, timestamp }>
    this.cache = new Map();
  }

  /**
   * Normalizes UK company number to standard 8 characters.
   */
  formatCompanyNumber(number) {
    if (!number) return '';
    const clean = String(number).trim().toUpperCase();
    if (/^\d{1,8}$/.test(clean)) {
      return clean.padStart(8, '0');
    }
    return clean;
  }

  /**
   * Checks rate limit and records request timestamp.
   */
  checkRateLimit() {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindowMs;
    // Evict old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > windowStart);

    if (this.requestTimestamps.length >= this.rateLimitMax) {
      const oldest = this.requestTimestamps[0];
      const retryAfterSec = Math.ceil((oldest + this.rateLimitWindowMs - now) / 1000);
      const error = new Error(`Companies House API rate limit reached (${this.rateLimitMax} requests per 5 minutes). Retry in ${retryAfterSec}s.`);
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.status = 429;
      error.retryAfter = retryAfterSec;
      throw error;
    }

    this.requestTimestamps.push(now);
  }

  /**
   * Retrieves an active cached profile if not expired.
   */
  getCachedProfile(companyNumber) {
    const formatted = this.formatCompanyNumber(companyNumber);
    const entry = this.cache.get(formatted);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.cacheTtlMs) {
      this.cache.delete(formatted);
      return null;
    }

    return entry.data;
  }

  /**
   * Caches normalized profile.
   */
  setCachedProfile(companyNumber, data) {
    const formatted = this.formatCompanyNumber(companyNumber);
    this.cache.set(formatted, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clears internal cache (for testing and cache flushes).
   */
  clearCache() {
    this.cache.clear();
    this.requestTimestamps = [];
  }

  /**
   * Normalizes raw Companies House profile payload into consistent schema.
   */
  normalizeProfile(raw) {
    if (!raw) return null;

    // Accounts extraction (handles both next_accounts and legacy next_due shapes)
    const accountsData = raw.accounts || {};
    const nextAccounts = accountsData.next_accounts || {};
    const accountsDue = nextAccounts.due_on || accountsData.next_due || null;
    const accountsOverdue = Boolean(nextAccounts.overdue || accountsData.overdue || false);

    // Confirmation statement extraction
    const confirmData = raw.confirmation_statement || {};
    const confirmDue = confirmData.next_due || null;
    const confirmOverdue = Boolean(confirmData.overdue || false);

    return {
      companyNumber: raw.company_number || '',
      name: raw.company_name || '',
      companyStatus: raw.company_status || 'unknown',
      statusDetail: raw.company_status_detail || null,
      jurisdiction: raw.jurisdiction || null,
      companyType: raw.type || null,
      dateOfCreation: raw.date_of_creation || null,
      dateOfCessation: raw.date_of_cessation || null,
      accountsDue,
      accountsOverdue,
      confirmDue,
      confirmOverdue,
      source: 'companies_house_live',
      lastChecked: new Date().toISOString()
    };
  }

  /**
   * Fetches company profile with Basic Auth, timeout, retries, and caching.
   */
  async fetchCompanyProfile(companyNumber, options = { forceRefresh: false }) {
    const formatted = this.formatCompanyNumber(companyNumber);
    if (!formatted) {
      const err = new Error('Company number is required.');
      err.code = 'INVALID_COMPANY_NUMBER';
      err.status = 400;
      throw err;
    }

    // 1. Check cache unless forced refresh
    if (!options.forceRefresh) {
      const cached = this.getCachedProfile(formatted);
      if (cached) {
        return {
          ...cached,
          fromCache: true
        };
      }
    }

    // 2. Check rate limit
    this.checkRateLimit();

    const targetUrl = `${this.baseUrl}/company/${encodeURIComponent(formatted)}`;
    // Companies House documented scheme: Basic <base64(apiKey + ':')>
    const basicAuth = Buffer.from(`${this.apiKey}:`).toString('base64');
    const headers = {
      'Authorization': `Basic ${basicAuth}`,
      'Accept': 'application/json',
      'User-Agent': 'Sloane-Trinova-Integration/1.0'
    };

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const signal = AbortSignal.timeout(this.timeoutMs);
        const response = await this.fetchFn(targetUrl, {
          method: 'GET',
          headers,
          signal
        });

        if (response.status === 200) {
          const rawData = await response.json();
          const normalized = this.normalizeProfile(rawData);
          this.setCachedProfile(formatted, normalized);
          return {
            ...normalized,
            fromCache: false
          };
        }

        if (response.status === 404) {
          const err = new Error(`Company ${formatted} not found on Companies House register.`);
          err.code = 'COMPANY_NOT_FOUND';
          err.status = 404;
          throw err;
        }

        if (response.status === 401 || response.status === 403) {
          const err = new Error('Companies House API authentication failed. Server credential invalid.');
          err.code = 'CH_AUTHENTICATION_FAILED';
          err.status = 502; // Bad Gateway since upstream credential failed
          throw err;
        }

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers?.get?.('Retry-After') || '60', 10);
          const err = new Error('Upstream Companies House API rate limit exceeded.');
          err.code = 'UPSTREAM_RATE_LIMIT';
          err.status = 429;
          err.retryAfter = retryAfter;
          throw err;
        }

        // Server errors (500, 502, 503, 504) -> candidate for retry
        if (response.status >= 500 && attempt <= this.maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 200;
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }

        const errText = await response.text().catch(() => '');
        const err = new Error(`Companies House API request failed with status ${response.status}: ${errText}`);
        err.code = 'CH_API_ERROR';
        err.status = response.status;
        throw err;

      } catch (error) {
        // Handle timeout / abort
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          if (attempt <= this.maxRetries) {
            const backoffMs = Math.pow(2, attempt) * 200;
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }
          const err = new Error(`Companies House request timed out after ${this.timeoutMs}ms.`);
          err.code = 'UPSTREAM_TIMEOUT';
          err.status = 504;
          throw err;
        }

        // Non-retryable errors
        if (error.code === 'COMPANY_NOT_FOUND' || error.code === 'CH_AUTHENTICATION_FAILED' || error.code === 'UPSTREAM_RATE_LIMIT') {
          throw error;
        }

        // Network failure
        if (attempt <= this.maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 200;
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }

        throw error;
      }
    }
  }
}

// Export singleton instance initialized with server config
export const companiesHouseService = new CompaniesHouseService();
