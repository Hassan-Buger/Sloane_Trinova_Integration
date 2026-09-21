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
  // In production, these are loaded from secure server-side environment secrets.
  apiKeys: [
    {
      key: process.env.SLOANE_API_KEY || 'tn_sec_live_sloane_readwrite_2026',
      actorId: 'actor_kirsty_allen',
      actorName: 'Kirsty Allen (CEO Command Centre)',
      scopes: ['sloane:read', 'sloane:write'],
      isRevoked: false,
      expiresAt: '2028-12-31T23:59:59.000Z'
    },
    {
      key: 'tn_sec_live_sloane_readonly_2026',
      actorId: 'actor_sloane_monitor',
      actorName: 'Sloane Monitoring Agent',
      scopes: ['sloane:read'],
      isRevoked: false,
      expiresAt: '2028-12-31T23:59:59.000Z'
    },
    {
      key: 'tn_sec_revoked_test_key_2026',
      actorId: 'actor_revoked_client',
      actorName: 'Revoked Client Test Credential',
      scopes: ['sloane:read', 'sloane:write'],
      isRevoked: true,
      expiresAt: '2028-12-31T23:59:59.000Z'
    },
    {
      key: 'tn_sec_expired_test_key_2026',
      actorId: 'actor_expired_client',
      actorName: 'Expired Client Test Credential',
      scopes: ['sloane:read'],
      isRevoked: false,
      expiresAt: '2025-01-01T00:00:00.000Z'
    }
  ],
  
  // Companies House Server-Side Integration Settings
  // Key held exclusively server-side per context/04_backend_integration_context.md §9
  companiesHouse: {
    apiKey: process.env.COMPANIES_HOUSE_API_KEY || 'ch_test_server_key_live_2026',
    baseUrl: process.env.COMPANIES_HOUSE_BASE_URL || 'https://api.company-information.service.gov.uk',
    rateLimitMaxRequests: 600,
    rateLimitWindowMs: 5 * 60 * 1000, // 5 minutes (600 req / 5 min limit)
    timeoutMs: 5000, // 5-second bounded timeout
    maxRetries: 2,
    cacheTtlMs: 60 * 60 * 1000 // 1 hour server cache
  },

  // Document Signing Service Settings (Documenso Community Edition)
  // Evaluated and approved per context/signing-provider-evaluation.md and Unit 06
  signing: {
    provider: 'documenso',
    apiUrl: process.env.SIGNING_API_URL || 'http://localhost:3000/api/v1',
    apiKey: process.env.SIGNING_API_KEY || 'documenso_test_server_key_live_2026',
    webhookSecret: process.env.SIGNING_WEBHOOK_SECRET || 'documenso_webhook_secret_hmac_2026',
    timeoutMs: 5000,
    maxRetries: 2
  }
};
