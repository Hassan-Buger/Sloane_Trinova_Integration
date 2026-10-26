/**
 * Trinova Integration API Application Router
 * Provides high-performance, modular HTTP handling with native ES modules.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, requireScope } from './middleware/auth.js';
import { auditMiddleware, auditStore } from './middleware/audit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerStatutoryRoutes } from './routes/statutory.js';
import { registerTrinovaRoutes } from './routes/trinova.js';
import { registerBinRoutes } from './routes/bin.js';
import { registerExportRoutes } from './routes/exportData.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerTwoFactorRoutes } from './routes/twoFactor.js';
import { registerSuggestionRoutes } from './routes/suggestions.js';
import { registerAutomationRoutes } from './routes/automation.js';
import { registerAlertRoutes } from './routes/alerts.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerCommunicationRoutes } from './routes/communications.js';
import { registerSigningRoutes } from './routes/signing.js';
import { registerTimelineRoutes } from './routes/timeline.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerBusinessRoutes } from './routes/businesses.js';
import { registerCeoNoteRoutes } from './routes/ceoNotes.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerOutlookAuthRoutes } from './routes/outlookAuth.js';
import { registerOutlookSettingsRoutes } from './routes/outlookSettings.js';
import { registerOutlookDataRoutes } from './routes/outlookData.js';
import { telemetry } from './services/telemetry.js';
import { sessionStore } from './services/sessionStore.js';
import { persistence } from './data/persistence.js';
import { APP_VERSION, buildId } from './version.js';
import { config } from './config.js';
import { sampleDataEnabled } from './data/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identify root directory containing frontend assets (index.html, styles, scripts)
const CANDIDATE_STATIC_ROOTS = [
  path.resolve(__dirname, '../../'),
  path.resolve(__dirname, '../public'),
  path.resolve(process.cwd(), './'),
  path.resolve(process.cwd(), '../')
];
const STATIC_ROOT = CANDIDATE_STATIC_ROOTS.find(r => fs.existsSync(path.join(r, 'index.html'))) || path.resolve(__dirname, '../../');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};


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
    put(path, ...handlers) {
      addRoute('PUT', path, handlers);
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

      res.redirect = function(url, statusCode = 302) {
        res.writeHead(statusCode, { Location: url });
        res.end();
      };

      // Anything that changes data is saved to the database as soon as the response has gone out.
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        res.once('finish', () => persistence.scheduleFlush());
      }

      // CORS handling with explicit origin whitelist (Section 1.5)
      const allowedOrigins = [
        'http://localhost:4000',
        'http://localhost:8088',
        'http://127.0.0.1:4000',
        'http://127.0.0.1:8088',
        'https://sloanetrinovaintegration-production.up.railway.app',
        'https://portal.trinovaaccounting.co.uk'
      ];
      if (process.env.CORS_ALLOWED_ORIGINS) {
        process.env.CORS_ALLOWED_ORIGINS.split(',').forEach(o => {
          const trimmed = o.trim();
          if (trimmed && !allowedOrigins.includes(trimmed)) allowedOrigins.push(trimmed);
        });
      }

      const requestOrigin = req.headers.origin;
      if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trinova-API-Key, Idempotency-Key, If-Match, X-Documenso-Signature, X-Requested-With');

      // Security Headers: Content-Security-Policy & Defensive Headers (Section 1.4)
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://portal.trinovaaccounting.co.uk https://testnova-production-7b65.up.railway.app;"
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');

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

      // Static file serving: Serve ONLY explicit public directories, deny dotfiles and server source (Section 1.3)
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        let relativePath = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');

        // 1. Deny dotfiles
        if (relativePath.startsWith('.') || relativePath.includes('/.') || relativePath.includes('\\.')) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        // 2. Strict public file/directory whitelist: only index.html, favicon.ico, styles/, scripts/, assets/
        // scripts/data/ contains seed records and must return 404 to anonymous requests (Task P1.4 / Section 2.6)
        if (relativePath.startsWith('scripts/data/') || relativePath === 'scripts/data') {
          const cookies = sessionStore.parseCookies(req.headers.cookie);
          const session = cookies.slon_session ? sessionStore.getSession(cookies.slon_session) : null;
          if (!session) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }
        }

        const isExplicitPublic =
          relativePath === 'index.html' ||
          relativePath === 'favicon.ico' ||
          relativePath.startsWith('styles/') ||
          relativePath.startsWith('scripts/') ||
          relativePath.startsWith('assets/');

        if (!isExplicitPublic) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        // 3. Explicitly deny server source, storage, documents, config, package files
        const lower = relativePath.toLowerCase();
        if (
          lower.startsWith('server') ||
          lower.startsWith('storage') ||
          lower.includes('config.js') ||
          lower.includes('package') ||
          lower.includes('.env')
        ) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        const targetPath = path.resolve(STATIC_ROOT, relativePath);

        // Security check: prevent directory traversal
        if (!targetPath.startsWith(STATIC_ROOT)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        fs.stat(targetPath, (err, stats) => {
          if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }

          const ext = path.extname(targetPath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          // Pages, scripts and styles are re-checked on every load (cheap: a 304 when unchanged),
          // so after an update nobody is left running a mix of old and new files.
          const revalidate = ['.html', '.js', '.mjs', '.css'].includes(ext);
          const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
          if (revalidate && req.headers['if-none-match'] === etag) {
            res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
            res.end();
            return;
          }
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size,
            ...(revalidate ? { 'ETag': etag } : {}),
            'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=3600'
          });
          const stream = fs.createReadStream(targetPath);
          stream.pipe(res);
        });
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
                const result = handler(req, res, next);
                // An async handler that throws must answer with an error, not crash the server.
                if (result && typeof result.catch === 'function') {
                  result.catch(err => {
                    if (res.headersSent) return;
                    res.status(500).json({
                      error: {
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'Something went wrong on the server. Please try again.'
                      }
                    });
                    console.error('[Server] Unhandled error in route:', err && err.message);
                  });
                }
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

    listen(port, hostOrCallback, callback) {
      const server = http.createServer(app.handler);
      const host = typeof hostOrCallback === 'string' ? hostOrCallback : '0.0.0.0';
      const cb = typeof hostOrCallback === 'function' ? hostOrCallback : callback;
      return server.listen(port, host, cb);
    }
  };

  // --- Base Endpoints ---

  // API Root / Discovery Index
  const apiIndexHandler = (req, res) => {
    res.status(200).json({
      service: 'trinova-api-server',
      name: 'Sloane ⇄ Trinova Backend API & Signing Integration Service',
      version: APP_VERSION,
      build: buildId(),
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
        clientTimeline: 'GET /api/v1/clients/:id/timeline',
        aiAsk: 'POST /api/v1/ai/ask (Claude Reasoning & Grounded Insights)',
        executiveBriefing: 'GET /api/v1/ai/executive-briefing',
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
      version: APP_VERSION,
      build: buildId(),
      storage: persistence.status().kind,
      timestamp: new Date().toISOString()
    });
  });

  // Plain facts about this Sloane install, for the Settings page.
  app.get('/api/v1/system/status', authenticate, requireScope('sloane:read'), (req, res) => {
    const storage = persistence.status();
    res.status(200).json({
      status: 'success',
      data: {
        storage: {
          kind: storage.kind,
          persistent: storage.persistent,
          durable: storage.durable,
          lastSavedAt: storage.lastSavedAt,
          lastError: storage.lastError
        },
        trinova: { configured: Boolean(config.trinova.apiKey) },
        // Signing requests are recorded in Sloane; nothing is sent to signers or a signing service yet.
        signing: { mode: 'record_only' },
        demoData: sampleDataEnabled(),
        version: APP_VERSION,
        build: buildId(),
        environment: process.env.NODE_ENV || 'development'
      }
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

  // Write Mutation Test Endpoint (Dev-only: mount only when NODE_ENV !== 'production')
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/v1/test/mutate', authenticate, requireScope('sloane:write'), (req, res) => {
      req.auditAction = 'test_mutation_executed';
      req.resourceType = 'test_entity';

      res.status(201).json({
        status: 'success',
        message: 'Mutation executed successfully with write scope.',
        actor: req.actor
      });
    });
  }

  // --- Mount Section 1.1 Auth Routes ---
  registerAuthRoutes(app, { authenticate, requireScope });

  // Two-step sign-in settings (authenticator app, recovery codes, trusted browsers)
  registerTwoFactorRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 02 Client & Company Read Routes ---
  registerClientRoutes(app, { authenticate, requireScope });

  // --- Mount Business Areas Routes (Task P7.4.2) ---
  registerBusinessRoutes(app, { authenticate, requireScope });

  // --- Mount Team members (people tasks can be given to) ---
  registerTeamRoutes(app, { authenticate, requireScope });

  // --- Mount My Private Notes (saved on the server, owner session only) ---
  registerCeoNoteRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 03 Companies House & Statutory Reconciliation Routes ---
  registerStatutoryRoutes(app, { authenticate, requireScope }, options.chService);

  // TriNova connection tools: the "Check TriNova data" button
  registerTrinovaRoutes(app, { authenticate, requireScope }, options);

  // The Bin: deleted items kept for 30 days
  registerBinRoutes(app, { authenticate, requireScope });

  // "Download a copy of everything" (Excel)
  registerExportRoutes(app, { authenticate, requireScope });

  // Reports: the "This week" one-pager
  registerReportRoutes(app, { authenticate, requireScope });

  // "Sloane suggests": tasks worked out from deadlines, made when the owner approves them
  registerSuggestionRoutes(app, { authenticate, requireScope });
  registerAutomationRoutes(app, { authenticate, requireScope });
  registerAlertRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 04 Tasks & Workflow Read/Write Routes ---
  registerTaskRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 05 Messages, Notes & Document Management Routes ---
  registerCommunicationRoutes(app, { authenticate, requireScope });

  // --- Mount Unit 06 Trinova Document Signing Routes ---
  registerSigningRoutes(app, { authenticate, requireScope });

  // --- Mount Feature 01 Client Timeline Routes ---
  registerTimelineRoutes(app, { authenticate, requireScope });

  // --- Mount Feature 02 Claude AI Routes ---
  registerAiRoutes(app, { authenticate, requireScope });

  // --- Mount Outlook OAuth 2.0 Authorization Routes (Task P3.2) ---
  registerOutlookAuthRoutes(app, { authenticate, requireScope }, options.outlookOptions || options);

  // --- Mount Outlook Settings & Lifecycle Routes (Task P5.1) ---
  registerOutlookSettingsRoutes(app, { authenticate, requireScope }, options.outlookOptions || options);

  // --- Mount Outlook Data Routes: Diary & Flagged Emails (Task P6.1) ---
  registerOutlookDataRoutes(app, { authenticate, requireScope }, options.outlookOptions || options);

  return app;
}
