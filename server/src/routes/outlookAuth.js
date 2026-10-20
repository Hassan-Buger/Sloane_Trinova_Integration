/**
 * Outlook OAuth 2.0 Authorization Code Flow Endpoints
 * Implements Task P3.2 per docs/outlook-build/SPEC.md §4.2:
 * - GET /api/v1/integrations/outlook/connect (Session required)
 * - GET /api/v1/integrations/outlook/callback (Cookie-free, state-bound, idempotent against double-clicks)
 */

import { createStateEntry, consumeState } from '../services/outlookOAuthStateStore.js';
import { outlookConnectionStore } from '../services/outlookConnectionStore.js';
import { outlookIdentityService } from '../services/outlookIdentityService.js';
import { logger } from '../middleware/sanitizer.js';

export const OUTLOOK_SCOPES = 'offline_access Mail.Read Calendars.Read openid profile email';

/**
 * Registers Outlook OAuth routes on the application router.
 *
 * @param {object} app - Application router instance
 * @param {object} security - Middleware handlers
 * @param {Function} security.authenticate - Session authentication middleware
 * @param {object} [options] - Injectable overrides for testing
 * @param {Function} [options.fetch] - HTTP fetch function for Microsoft token endpoint
 * @param {object} [options.identityService] - JWT/JWKS verification service
 * @param {object} [options.connectionStore] - Connection persistence store
 * @param {string} [options.vaultPath] - Vault file path override
 * @param {string|Buffer} [options.vaultKey] - Vault encryption key override
 */
export function registerOutlookAuthRoutes(app, { authenticate }, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const identityService = options.identityService || outlookIdentityService;
  const connectionStore = options.connectionStore || outlookConnectionStore;

  /**
   * GET /api/v1/integrations/outlook/connect
   * Requires an active CEO session. Initiates OAuth 2.0 authorization code flow with PKCE.
   */
  app.get('/api/v1/integrations/outlook/connect', authenticate, (req, res) => {
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({
        error: {
          code: 'OUTLOOK_NOT_CONFIGURED',
          message: 'Outlook integration is not configured on this server. Missing OUTLOOK_CLIENT_ID.'
        }
      });
    }

    const actorId = req.actor?.actorId || req.actor?.id || 'actor_kirsty_allen';
    const stateEntry = createStateEntry({ actorId });

    const tenant = (process.env.OUTLOOK_TENANT_ID || 'common').trim();
    const authorizeBase = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
    const redirectUri = process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:4000/api/v1/integrations/outlook/callback';

    const authUrl = new URL(authorizeBase);
    authUrl.searchParams.set('client_id', clientId.trim());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri.trim());
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('scope', OUTLOOK_SCOPES);
    authUrl.searchParams.set('state', stateEntry.state);
    authUrl.searchParams.set('code_challenge', stateEntry.codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('nonce', stateEntry.nonce);
    authUrl.searchParams.set('prompt', 'select_account');

    logger.info(`OAuth flow initiated for actor [${actorId}]`);

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
  });

  /**
   * GET /api/v1/integrations/outlook/callback
   * Cross-site redirect endpoint from Microsoft.
   * MUST NOT require session cookie (SameSite=Strict cookies omitted on cross-site GET redirects).
   * Actor identity is strictly resolved from single-use state parameter.
   */
  app.get('/api/v1/integrations/outlook/callback', async (req, res) => {
    // 1. Handle user-denied or provider errors (user cancelled, consent denied)
    if (req.query.error) {
      const errorReason = req.query.error_description || req.query.error || 'Authentication denied';
      logger.warn(`Outlook OAuth callback returned error: ${req.query.error}`, {
        description: errorReason
      });

      // Never store anything. Redirect to dashboard with readable error reason.
      res.writeHead(302, {
        Location: `/index.html?outlook_error=${encodeURIComponent(errorReason)}`
      });
      return res.end();
    }

    // 2. Consume and validate state parameter (single-use, 10-minute TTL)
    const stateResult = consumeState(req.query.state);
    if (!stateResult.valid) {
      logger.warn(`Outlook OAuth callback rejected state: ${stateResult.error}`);
      return res.status(400).json({
        error: {
          code: stateResult.error || 'INVALID_STATE',
          message: stateResult.message || 'This sign-in link is invalid or has already been used.'
        }
      });
    }

    const stateData = stateResult.data;

    // 3. Validate presence of authorization code
    const code = req.query.code;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        error: {
          code: 'MISSING_CODE',
          message: 'Missing authorization code parameter in Microsoft callback.'
        }
      });
    }

    // 4. Exchange authorization code at Microsoft token endpoint
    const tenant = (process.env.OUTLOOK_TENANT_ID || 'common').trim();
    const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const clientId = (process.env.OUTLOOK_CLIENT_ID || '').trim();
    const clientSecret = (process.env.OUTLOOK_CLIENT_SECRET || '').trim();
    const redirectUri = (process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:4000/api/v1/integrations/outlook/callback').trim();

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code.trim(),
      redirect_uri: redirectUri,
      code_verifier: stateData.codeVerifier
    });

    let tokenRes;
    try {
      tokenRes = await fetchFn(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenParams.toString(),
        signal: AbortSignal.timeout(10000)
      });
    } catch (netErr) {
      logger.error(`Network error contacting Microsoft token endpoint: ${netErr.message}`);
      return res.status(502).json({
        error: {
          code: 'MICROSOFT_NETWORK_ERROR',
          message: `Failed to contact Microsoft token endpoint: ${netErr.message}`
        }
      });
    }

    if (!tokenRes.ok) {
      const status = tokenRes.status;
      let errDetails = '';
      try {
        errDetails = await tokenRes.text();
      } catch {}

      logger.warn(`Microsoft token endpoint rejected code exchange: HTTP ${status}`);
      return res.status(status >= 500 ? 502 : 400).json({
        error: {
          code: 'TOKEN_ENDPOINT_ERROR',
          message: `Microsoft token endpoint responded with status ${status}.`,
          details: errDetails
        }
      });
    }

    let tokenData;
    try {
      tokenData = await tokenRes.json();
    } catch (parseErr) {
      return res.status(502).json({
        error: {
          code: 'INVALID_TOKEN_RESPONSE',
          message: `Malformed JSON from Microsoft token endpoint: ${parseErr.message}`
        }
      });
    }

    // 5. Validate that offline_access granted a refresh_token
    if (!tokenData.refresh_token || typeof tokenData.refresh_token !== 'string') {
      logger.error('Token endpoint response missing required refresh_token');
      return res.status(400).json({
        error: {
          code: 'MISSING_REFRESH_TOKEN',
          message: 'Microsoft did not return a refresh token. Ensure offline_access scope was requested and consented.'
        }
      });
    }

    // 6. Verify id_token signature and claims against Microsoft JWKS (Option A)
    let identity;
    try {
      identity = await identityService.verifyIdToken(tokenData.id_token, {
        nonce: stateData.nonce,
        clientId,
        tenantId: tenant,
        keyset: options.keyset,
        fetchFn
      });
    } catch (identErr) {
      logger.warn(`id_token validation failed: ${identErr.message}`);
      return res.status(401).json({
        error: {
          code: 'INVALID_ID_TOKEN',
          message: `ID token verification failed: ${identErr.message}`
        }
      });
    }

    // 7. Persist encrypted connection record in vault
    const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    const accessTokenExpiresAt = Date.now() + (expiresIn * 1000);
    const grantedScopes = typeof tokenData.scope === 'string'
      ? tokenData.scope.split(' ').map(s => s.trim()).filter(Boolean)
      : ['offline_access', 'Mail.Read', 'Calendars.Read'];

    const connectionRecord = {
      actorId: stateData.actorId,
      status: 'connected',
      accountEmail: identity.accountEmail,
      displayName: identity.displayName,
      tenantId: identity.tenantId || tenant,
      scopes: grantedScopes,
      refreshToken: tokenData.refresh_token,
      accessToken: tokenData.access_token || '',
      accessTokenExpiresAt,
      emailSyncEnabled: true,
      calendarSyncEnabled: true,
      mailFolderIds: ['Inbox'],
      connectedAt: new Date().toISOString(),
      lastSyncAt: null,
      lastError: null
    };

    try {
      connectionStore.saveConnection(connectionRecord, {
        filePath: options.vaultPath,
        key: options.vaultKey
      });
    } catch (saveErr) {
      logger.error(`Failed to save encrypted connection in vault: ${saveErr.message}`);
      return res.status(500).json({
        error: {
          code: 'VAULT_SAVE_ERROR',
          message: 'Failed to securely persist connection in encrypted vault.'
        }
      });
    }

    logger.info(`Outlook account connected successfully for [${identity.accountEmail}] bound to actor [${stateData.actorId}]`);

    // 8. Redirect to dashboard with success query param
    res.writeHead(302, { Location: '/index.html?outlook=connected' });
    res.end();
  });
}

export default registerOutlookAuthRoutes;
