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
import { claudeService } from '../services/ai/claudeService.js';
import { mockDb } from '../data/db.js';
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
          message: 'Too many AI requests. Please wait a moment before sending another query.'
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
          message: 'The "message" field is required and cannot be empty.'
        }
      });
    }

    if (message.length > 1000) {
      return res.status(422).json({
        error: {
          code: 'MESSAGE_TOO_LONG',
          message: 'AI query exceeds maximum allowed length of 1000 characters.'
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
            message: `Client with ID "${clientId}" does not exist in TriNova.`
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

      // Build structured briefing
      const clientSummaries = allowedContext.executiveOverview?.clientSummaries || [];
      const criticalTasks = allowedContext.executiveOverview?.criticalOrBlockedTasks || [];

      const highRisk = clientSummaries.filter(c => c.overallRisk === 'High');
      const medRisk = clientSummaries.filter(c => c.overallRisk === 'Medium');

      const briefing = {
        date: new Date().toISOString().split('T')[0],
        summary: `Good morning, Kirsty. You have ${clientSummaries.length} active practice groups, with ${highRisk.length} high-priority risk and ${criticalTasks.length} urgent task blockers requiring action.`,
        priorities: [
          'Halt strike-off for Woofington Park Limited by filing objection and accounts',
          'Finalize 50-day overdue accounts for R GB Elevations Ltd with Hamza Malik'
        ],
        critical_risks: highRisk.map(c => `${c.name}: Critical statutory exposure`),
        upcoming_deadlines: [
          'Woofington Park strike-off defense — Due today',
          'CFI Awarding Body VAT Q3 return — Due 2026-09-26'
        ],
        recommended_focus: [
          'Verify Sarah Jenkins signature on Woofington balance sheet',
          '13:30 compliance check-in with Hamza Malik'
        ],
        client_count: clientSummaries.length,
        blocked_tasks_count: criticalTasks.length
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
          message: 'Unable to generate executive briefing.'
        }
      });
    }
  });
}
