/**
 * Sloane AI REST API Routes
 * Implements Section 25, 26, 38, 39, 42:
 * - Rate limiting against request loops
 * - Input validation & client authorization
 * - Privacy filtering & Context Builder
 * - Claude reasoning or grounded fallback
 * - Executive Briefing endpoint
 */

import { ContextBuilder } from '../services/ai/contextBuilder.js';
import { mockDb } from '../data/db.js';
import { clientDirectory } from '../services/clientDirectory.js';
import { buildDeadlineList } from './statutory.js';
import { claudeService } from '../services/ai/claudeService.js';
import { config } from '../config.js';

// Simple sliding window in-memory rate limiter (Section 38)
const rateLimitMap = new Map();

function checkRateLimit(actorId) {
  const now = Date.now();
  const windowMs = config.anthropic?.rateLimitWindowMs || 60000;
  const maxReqs = config.anthropic?.rateLimitMaxRequests || 60;

  let record = rateLimitMap.get(actorId);
  if (!record || now - record.startTime > windowMs) {
    record = { startTime: now, count: 0 };
    rateLimitMap.set(actorId, record);
  }

  record.count++;
  return record.count <= maxReqs;
}

export function registerAiRoutes(app, { authenticate, requireScope }) {
  /**
   * GET /api/v1/ai/models
   * Inspect available AI models and active provider status
   */
  app.get('/api/v1/ai/models', authenticate, requireScope('sloane:read'), async (req, res) => {
    try {
      const geminiConfigured = claudeService.isGeminiConfigured();
      const anthropicConfigured = claudeService.isAnthropicConfigured();
      let geminiModels = [];
      let geminiError = null;

      if (geminiConfigured && claudeService.geminiApiKey) {
        try {
          const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            headers: { 'x-goog-api-key': claudeService.geminiApiKey.trim() },
            signal: AbortSignal.timeout(8000)
          });
          if (resp.ok) {
            const data = await resp.json();
            geminiModels = (data.models || [])
              .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
              .map(m => m.name.replace(/^models\//, ''));
          } else {
            geminiError = `Google API HTTP ${resp.status}: ${await resp.text()}`;
          }
        } catch (e) {
          geminiError = e.message;
        }
      }

      return res.status(200).json({
        status: 'success',
        activeProvider: claudeService.aiProvider,
        configured: {
          gemini: geminiConfigured,
          anthropic: anthropicConfigured
        },
        models: {
          gemini: geminiModels,
          geminiCurrent: claudeService.geminiModel,
          geminiError,
          anthropicCurrent: claudeService.model
        }
      });
    } catch (err) {
      return res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * POST /api/v1/ai/ask
   * Sloane AI Executive Assistant Query Endpoint
   */
  app.post('/api/v1/ai/ask', authenticate, requireScope('sloane:read'), async (req, res) => {
    const actorId = req.actor?.actorId || 'anonymous_actor';

    // 1. Rate Limiting Check (Section 38)
    if (!checkRateLimit(actorId)) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'You are asking very quickly. Please wait a moment, then ask again.'
        }
      });
    }

    // 2. Validate Input Body (Section 25)
    const body = req.body || {};
    const message = (body.message || body.query || '').trim();
    const clientId = body.clientId ? String(body.clientId).trim() : null;
    const provider = body.provider ? String(body.provider).trim().toLowerCase() : null;
    const model = body.model ? String(body.model).trim() : null;

    if (!message) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please type a question first.'
        }
      });
    }

    if (message.length > 1000) {
      return res.status(422).json({
        error: {
          code: 'MESSAGE_TOO_LONG',
          message: 'That question is too long. Please keep it under 1,000 characters.'
        }
      });
    }

    // 3. Extract and Sanitize Multi-Turn History
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const sanitizedHistory = rawHistory
      .slice(-10)
      .filter(turn => turn && typeof turn === 'object')
      .map(turn => ({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: typeof turn.content === 'string' ? turn.content.substring(0, 1000) : ''
      }))
      .filter(turn => turn.content.trim().length > 0);

    // 4. Client Authorization & Existence Check (Section 24)
    if (clientId) {
      const client = (mockDb.clients || []).find(c => c.id === clientId);
      if (!client) {
        return res.status(404).json({
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'We could not find that client. Refresh the Clients page and try again.'
          }
        });
      }
    }

    try {
      // 5. Build Context with Strict Privacy Boundary (Section 21-23)
      const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
        clientId,
        query: message,
        actor: req.actor
      });

      // 6. Query Configured AI Provider or Grounded Fallback (Section 20 & 33)
      const aiResponse = await claudeService.ask({
        query: message,
        context: allowedContext,
        history: sanitizedHistory,
        provider,
        model
      });

      // 7. Usage & Audit Logging (Section 39)
      req.auditAction = 'ai_query_processed';
      req.resourceType = clientId ? `client:${clientId}` : 'executive_ai';
      req.resourceId = aiResponse.requestId;

      return res.status(200).json({
        status: aiResponse.status,
        source: aiResponse.source,
        model: aiResponse.model,
        requestId: aiResponse.requestId,
        data: aiResponse.data,
        privacy: privacyAudit,
        usage: aiResponse.usage,
        reason: aiResponse.reason || null,
        errorMessage: aiResponse.errorMessage || null
      });

    } catch (err) {
      return res.status(500).json({
        error: {
          code: 'AI_PROCESSING_ERROR',
          message: 'Sloane could not complete the analysis right now. Your dashboard data is still available.'
        }
      });
    }
  });

  /**
   * GET /api/v1/ai/executive-briefing
   * Morning Executive Briefing Endpoint (Section 42)
   */
  app.get('/api/v1/ai/executive-briefing', authenticate, requireScope('sloane:read'), async (req, res) => {
    try {
      const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
        clientId: null,
        query: 'Morning Executive Briefing',
        actor: req.actor
      });

      // Built only from what is really saved in Sloane (no example facts)
      const deadlines = buildDeadlineList().filter(d => !d.isDissolved);
      const redFilings = deadlines.filter(d => d.urgency === 'RED');
      const openTasks = (mockDb.tasks || []).filter(t => !['Completed', 'Cancelled'].includes(t.status));
      const stuckTasks = openTasks.filter(t => t.isBlocked);
      const clientCount = clientDirectory.all().length;
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

      const soon = deadlines
        .filter(d => typeof d.daysRemaining === 'number' && d.daysRemaining >= 0 && d.daysRemaining <= 30)
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
        .slice(0, 8);
      const dueTasks = [...openTasks]
        .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
        .slice(0, 5);

      const nothingYet = deadlines.length === 0 && openTasks.length === 0 && clientCount === 0;
      const briefing = {
        date: new Date().toISOString().split('T')[0],
        summary: nothingYet
          ? 'Good morning, Kirsty. There is nothing to report yet: no clients, deadlines or tasks are saved in Sloane.'
          : `Good morning, Kirsty. ${plural(redFilings.length, 'filing is', 'filings are')} RED and ${plural(stuckTasks.length, 'task is', 'tasks are')} stuck, across ${plural(clientCount, 'client', 'clients')}.`,
        priorities: [
          ...redFilings.slice(0, 3).map(d => `${d.name}: ${d.urgencyReason}`),
          ...stuckTasks.slice(0, 3).map(t => `Unblock "${t.title}"${t.blocker ? ` (${t.blocker})` : ''}`)
        ],
        critical_risks: redFilings.map(d => `${d.name}: ${d.urgencyReason}`),
        upcoming_deadlines: soon.map(d => {
          const what = d.nearestDeadline && d.nearestDeadline.type === 'confirmation_statement' ? 'yearly update' : 'accounts';
          return `${d.name}: ${what} due ${d.nearestDeadline ? d.nearestDeadline.date : 'soon'} (${plural(d.daysRemaining, 'day', 'days')})`;
        }),
        recommended_focus: dueTasks.map(t => `${t.title}${t.companyName ? ` for ${t.companyName}` : ''}${t.dueDate ? `, due ${t.dueDate}` : ''}`),
        client_count: clientCount,
        blocked_tasks_count: stuckTasks.length
      };

      req.auditAction = 'ai_executive_briefing_generated';
      req.resourceType = 'executive_briefing';

      return res.status(200).json({
        status: 'success',
        source: 'sloane_executive_engine',
        data: briefing,
        privacy: privacyAudit
      });

    } catch (err) {
      return res.status(500).json({
        error: {
          code: 'BRIEFING_GENERATION_FAILED',
          message: 'Sloane could not put your morning briefing together just now. Please try again.'
        }
      });
    }
  });
}
