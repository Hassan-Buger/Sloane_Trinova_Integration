/**
 * Trinova Integration API Application Router
 * Provides high-performance, modular HTTP handling with native ES modules.
 */

import http from 'node:http';
import { authenticate, requireScope } from './middleware/auth.js';
import { auditMiddleware, auditStore } from './middleware/audit.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerStatutoryRoutes } from './routes/statutory.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerCommunicationRoutes } from './routes/communications.js';
import { registerSigningRoutes } from './routes/signing.js';
import { telemetry } from './services/telemetry.js';

function matchRoute(routePath, requestPath) {
  const routeParts = routePath.split('/');
  const requestParts = requestPath.split('/');

  if (routeParts.length !== requestParts.length) return null;

  const params = {};
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) {
      params[routeParts[i].slice(1)] = decodeURIComponent(requestParts[i]);
    } else if (routeParts[i] !== requestParts[i]) {
      return null;
    }
  }
  return params;
}

export function createApp(options = {}) {
  const routes = [];

  function addRoute(method, path, handlers) {
    routes.push({
      method: method.toUpperCase(),
      path,
      handlers: Array.isArray(handlers) ? handlers : [handlers]
    });
  }

  const app = {
    get(path, ...handlers) {
      addRoute('GET', path, handlers);
    },
    post(path, ...handlers) {
      addRoute('POST', path, handlers);
    },
    patch(path, ...handlers) {
      addRoute('PATCH', path, handlers);
    },
    delete(path, ...handlers) {
      addRoute('DELETE', path, handlers);
    },

    // HTTP Request Handler
    handler(req, res) {
      const requestStart = Date.now();

      // Enhance res with status and json helpers
      res.status = function(code) {
        res.statusCode = code;
        return res;
      };

      res.json = function(data) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
      };

      // CORS & Preflight handling for seamless frontend ⇄ API integration
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trinova-API-Key, Idempotency-Key, If-Match, X-Documenso-Signature, X-Documenso-Secret');

      // Parse URL and Query parameters
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      req.path = parsedUrl.pathname.length > 1 ? parsedUrl.pathname.replace(/\/+$/, '') : parsedUrl.pathname;
      req.query = Object.fromEntries(parsedUrl.searchParams);
      req.params = {};

      // Wrap res.end to record telemetry metrics accurately
      const originalEnd = res.end;
      let recorded = false;
      res.end = function(...args) {
        if (!recorded) {
          recorded = true;
          const durationMs = Date.now() - requestStart;
          telemetry.recordRequest({
            statusCode: res.statusCode || 200,
            durationMs,
            path: req.path
          });
        }
        return originalEnd.apply(this, args);
      };

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Parse JSON body if applicable
      let bodyData = '';
      req.on('data', chunk => {
        bodyData += chunk;
      });

      req.on('end', () => {
        req.rawBody = bodyData;
        if (bodyData) {
          try {
            req.body = JSON.parse(bodyData);
          } catch (e) {
            req.body = {};
          }
        } else {
          req.body = {};
        }

        // Apply global audit middleware
        auditMiddleware(req, res, () => {
          // Find matching route with parameter extraction
          let matchedRoute = null;
          let matchedParams = null;

          for (const r of routes) {
            if (r.method === req.method) {
              const params = matchRoute(r.path, req.path);
              if (params !== null) {
                matchedRoute = r;
                matchedParams = params;
                break;
              }
            }
          }

          if (!matchedRoute) {
            return res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: `Route ${req.method} ${req.path} not found.`
              }
            });
          }

          req.params = matchedParams || {};

          // Execute route middleware chain sequentially
          let index = 0;
          function next() {
            if (index < matchedRoute.handlers.length) {
              const handler = matchedRoute.handlers[index++];
              try {
                handler(req, res, next);
              } catch (err) {
                res.status(500).json({
                  error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: err.message
                  }
                });
              }
            }
          }

          next();
        });
      });
    },

    listen(port, callback) {
      const server = http.createServer(app.handler);
      return server.listen(port, callback);
    }
  };

  // --- Base Endpoints ---

  // API Root / Discovery Index
  const apiIndexHandler = (req, res) => {
    res.status(200).json({
      service: 'trinova-api-server',
      name: 'Sloane ⇄ Trinova Backend API & Signing Integration Service',
      version: '1.0.0',
      status: 'online',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      documentation: 'context/api-documentation.md',
      frontendApp: 'http://localhost:8088',
      endpoints: {
        health: 'GET /api/v1/health',
        metrics: 'GET /api/v1/metrics (Requires Bearer Auth)',
        clients: 'GET /api/v1/clients',
        companyDetail: 'GET /api/v1/companies/:id',
        statutoryMonitor: 'GET /api/v1/statutory',
        companiesHouseSync: 'POST /api/v1/statutory/sync',
        tasks: 'GET, POST /api/v1/tasks',
        taskUpdate: 'PATCH /api/v1/tasks/:id',
        taskComplete: 'POST /api/v1/tasks/:id/complete',
        messages: 'GET, POST /api/v1/companies/:id/conversations',
        internalNotes: 'POST /api/v1/companies/:id/notes (Strict Privacy Boundary)',
        documentUpload: 'POST /api/v1/companies/:id/documents/upload',
        documentDownload: 'GET /api/v1/documents/download?token=:token',
        signingRequests: 'POST /api/v1/companies/:id/signing-requests',
        signingWebhooks: 'POST /api/v1/signing/webhooks (HMAC-SHA256 Verified)',
        auditTrail: 'GET /api/v1/audit/logs'
      }
    });
  };

  app.get('/', apiIndexHandler);
  app.get('/api', apiIndexHandler);
  app.get('/api/v1', apiIndexHandler);

  // Public Health Check
  app.get('/api/v1/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'trinova-api-server',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // Production Telemetry & Metrics (Protected)
  app.get('/api/v1/metrics', authenticate, requireScope('sloane:read'), (req, res) => {
    res.status(200).json({
      status: 'success',
      data: telemetry.getMetrics()
    });
  });

  // Protected Verification Endpoint
  app.get('/api/v1/auth/verify', authenticate, (req, res) => {
    res.status(200).json({
      status: 'authenticated',
      actor: req.actor,
      timestamp: new Date().toISOString()
    });
  });

  // Scoped Audit Query Endpoint
  app.get('/api/v1/audit/logs', authenticate, requireScope('sloane:read'), (req, res) => {
    const logs = auditStore.getLogs({
      actorId: req.query.actorId,
      action: req.query.action,
      limit: parseInt(req.query.limit || '50', 10)
    });

    res.status(200).json({
      status: 'success',
      data: logs,
      meta: { total: logs.length }
    });
  });

  // Write Mutation Test Endpoint
  app.post('/api/v1/test/mutate', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'test_mutation_executed';
    req.resourceType = 'test_entity';

    res.status(201).json({
      status: 'success',
      message: 'Mutation executed successfully with write scope.',
      actor: req.actor
    });
  });

  // --- Mount Unit 02 Client & Company Read Routes ---
  registerClientRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 03 Companies House & Statutory Reconciliation Routes ---
  registerStatutoryRoutes(app, { authenticate, requireScope }, options.chService);

  // --- Mount Unit 04 Tasks & Workflow Read/Write Routes ---
  registerTaskRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 05 Messages, Notes & Document Management Routes ---
  registerCommunicationRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 06 Trinova Document Signing Routes ---
  registerSigningRoutes(app, { authenticate, requireScope });

  return app;
}
