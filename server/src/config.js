/**
 * Server Configuration
 * Loads environment variables, active API credentials, and server defaults.
 * Adheres to context/05_data_security_context.md §4 (Secrets kept server-side).
 */

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Active server-to-server credentials
  // Loaded strictly from environment variables per Section 1.2. No default secrets committed in code.
  get apiKeys() {
    const keys = [];
    const mainKey = (process.env.SLON_API_KEY || process.env.SLOANE_API_KEY || '').trim();
    if (mainKey) {
      keys.push({
        key: mainKey,
        actorId: 'actor_kirsty_allen',
        actorName: 'Kirsty Allen (CEO Command Centre)',
        scopes: ['sloane:read', 'sloane:write'],
        isRevoked: false,
        expiresAt: '2028-12-31T23:59:59.000Z'
      });
    }

    const readonlyKey = (process.env.SLON_READONLY_API_KEY || process.env.SLOANE_READONLY_API_KEY || '').trim();
    if (readonlyKey) {
      keys.push({
        key: readonlyKey,
        actorId: 'actor_sloane_monitor',
        actorName: 'Sloane Monitoring Agent',
        scopes: ['sloane:read'],
        isRevoked: false,
        expiresAt: '2028-12-31T23:59:59.000Z'
      });
    }

    const revokedKey = (process.env.TEST_REVOKED_API_KEY || '').trim();
    if (revokedKey) {
      keys.push({
        key: revokedKey,
        actorId: 'actor_revoked_client',
        actorName: 'Revoked Client Test Credential',
        scopes: ['sloane:read', 'sloane:write'],
        isRevoked: true,
        expiresAt: '2028-12-31T23:59:59.000Z'
      });
    }

    const expiredKey = (process.env.TEST_EXPIRED_API_KEY || '').trim();
    if (expiredKey) {
      keys.push({
        key: expiredKey,
        actorId: 'actor_expired_client',
        actorName: 'Expired Client Test Credential',
        scopes: ['sloane:read'],
        isRevoked: false,
        expiresAt: '2025-01-01T00:00:00.000Z'
      });
    }

    return keys;
  },

  // Live TriNova Accounting Portal Integration
  get trinova() {
    return {
      baseUrl: (process.env.TRINOVA_API_URL || 'https://portal.trinovaaccounting.co.uk/api/v1').trim().replace(/\/+$/, ''),
      // No default key. Sloane's own SLON_API_KEY must never be sent to another service either.
      apiKey: (process.env.TRINOVA_API_KEY || '').trim(),
      // A separate key for tasks (tasks:read, tasks:write, staff:read), so the read key can stay read-only
      tasksApiKey: (process.env.TRINOVA_TASKS_API_KEY || '').trim(),
      // Used to check that a task message really came from TriNova (HMAC-SHA256)
      webhookSecret: (process.env.TRINOVA_WEBHOOK_SECRET || '').trim(),
      timeoutMs: parseInt(process.env.TRINOVA_TIMEOUT_MS || '8000', 10)
    };
  },

  // Web Push (alerts that reach a device when Sloane is closed). Set BOTH keys, in Railway;
  // generate a pair with:  node server/scripts/generate-vapid-keys.js
  get push() {
    return {
      publicKey: (process.env.VAPID_PUBLIC_KEY || '').trim(),
      privateKey: (process.env.VAPID_PRIVATE_KEY || '').trim(),
      subject: (process.env.VAPID_SUBJECT || '').trim()
    };
  },

  // Owner authentication configuration (Section 1.1)
  owner: {
    email: (process.env.SLON_OWNER_EMAIL || '').trim().toLowerCase(),
    passwordHash: (process.env.SLON_OWNER_PASSWORD_HASH || '').trim()
  },

  // Storage pre-signed token secret (Section 1.5)
  storageTokenSecret: (process.env.STORAGE_PRESIGNED_TOKEN_SECRET || process.env.SLON_TOKEN_SECRET || '').trim(),
  
  // Companies House Server-Side Integration Settings
  // Key held exclusively server-side per context/04_backend_integration_context.md §9
  get companiesHouse() {
    return {
      apiKey: (process.env.COMPANIES_HOUSE_API_KEY || '').trim(),
      baseUrl: process.env.COMPANIES_HOUSE_BASE_URL || 'https://api.company-information.service.gov.uk',
      rateLimitMaxRequests: 600,
      rateLimitWindowMs: 5 * 60 * 1000, // 5 minutes (600 req / 5 min limit)
      timeoutMs: 5000, // 5-second bounded timeout
      maxRetries: 2,
      cacheTtlMs: 60 * 60 * 1000 // 1 hour server cache
    };
  },

  // Document Signing Service Settings (Documenso Community Edition)
  // Evaluated and approved per context/signing-provider-evaluation.md and Unit 06
  get signing() {
    return {
      provider: 'documenso',
      apiUrl: process.env.SIGNING_API_URL || 'http://localhost:3000/api/v1',
      apiKey: (process.env.SIGNING_API_KEY || '').trim(),
      webhookSecret: (process.env.SIGNING_WEBHOOK_SECRET || '').trim(),
      timeoutMs: 5000,
      maxRetries: 2
    };
  },

  // Anthropic Claude Integration Settings
  // Key held strictly server-side per Prompt Section 19 & 30
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    workspaceId: process.env.ANTHROPIC_WORKSPACE_ID || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    timeoutMs: parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '15000', 10),
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '1500', 10),
    rateLimitMaxRequests: parseInt(process.env.AI_RATE_LIMIT_MAX || '60', 10),
    rateLimitWindowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || '60000', 10)
  },

  // Google Gemini AI Integration Settings
  // Key held strictly server-side
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS || '25000', 10),
    maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS || '1500', 10)
  },

  // Primary AI Provider Selection: 'auto' | 'gemini' | 'anthropic'
  aiProvider: process.env.AI_PROVIDER || 'auto'
};
