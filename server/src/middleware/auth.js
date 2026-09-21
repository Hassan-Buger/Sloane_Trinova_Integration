/**
 * Server-to-Server Authentication Middleware
 * Enforces scoped, revocable credentials with timing-safe comparison
 * per context/04_backend_integration_context.md §8 and context/05_data_security_context.md §3–4.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from './sanitizer.js';

/**
 * Performs a timing-safe constant-time string comparison.
 * Protects against side-channel timing attacks on API secrets.
 */
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Timing-safe fallback comparison against itself to maintain constant time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extracts credential from Authorization: Bearer <token> or X-Trinova-API-Key.
 */
function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const apiKeyHeader = req.headers['x-trinova-api-key'];
  if (apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  return null;
}

/**
 * Authenticates incoming request.
 */
export function authenticate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing server-to-server credentials. Provide Authorization: Bearer <token> or X-Trinova-API-Key.'
      }
    });
  }

  // Find matching key in configured active API keys using timing-safe comparison
  const matchedKey = config.apiKeys.find(k => timingSafeCompare(token, k.key));

  if (!matchedKey) {
    logger.warn('Authentication failed: Invalid credential provided', { ip: req.ip });
    return res.status(401).json({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'The provided API credential is invalid.'
      }
    });
  }

  // Check revocation status
  if (matchedKey.isRevoked) {
    logger.warn(`Authentication failed: Revoked key [${matchedKey.actorId}]`, { actorId: matchedKey.actorId });
    return res.status(401).json({
      error: {
        code: 'CREDENTIAL_REVOKED',
        message: 'This API credential has been revoked.'
      }
    });
  }

  // Check expiration
  if (matchedKey.expiresAt && new Date(matchedKey.expiresAt).getTime() < Date.now()) {
    logger.warn(`Authentication failed: Expired key [${matchedKey.actorId}]`, { actorId: matchedKey.actorId });
    return res.status(401).json({
      error: {
        code: 'CREDENTIAL_EXPIRED',
        message: 'This API credential has expired.'
      }
    });
  }

  // Attach verified actor to request context
  req.actor = {
    actorId: matchedKey.actorId,
    actorName: matchedKey.actorName,
    scopes: matchedKey.scopes || []
  };

  if (typeof next === 'function') next();
}

/**
 * Route-level scope authorization middleware.
 * Verifies that the authenticated actor possesses the required scope.
 */
export function requireScope(requiredScope) {
  return function(req, res, next) {
    if (!req.actor) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required prior to scope verification.'
        }
      });
    }

    const hasScope = req.actor.scopes.includes(requiredScope) || req.actor.scopes.includes('*');
    if (!hasScope) {
      logger.warn(`Scope authorization failed: Actor [${req.actor.actorId}] lacks scope [${requiredScope}]`);
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient permissions. Required scope: '${requiredScope}'.`
        }
      });
    }

    if (typeof next === 'function') next();
  };
}
