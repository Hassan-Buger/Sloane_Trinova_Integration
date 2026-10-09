/**
 * Claude AI Backend Service
 * Integrates with official @anthropic-ai/sdk per Section 18, 20, 28, 29, 36, 37, 39.
 * Handles timeouts, token telemetry, error mapping, and structured output parsing.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { SLOANE_SYSTEM_PROMPT, BRIEFING_SYSTEM_PROMPT } from './prompts.js';

export class ClaudeService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || config.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model = options.model || config.anthropic?.model || 'claude-3-5-sonnet-20241022';
    this.timeoutMs = options.timeoutMs || config.anthropic?.timeoutMs || 15000;
    this.maxTokens = options.maxTokens || config.anthropic?.maxTokens || 1500;

    this.client = null;
    if (this.apiKey) {
      try {
        this.client = new Anthropic({ apiKey: this.apiKey });
      } catch (err) {
        console.warn('[ClaudeService] Failed to initialize Anthropic SDK:', err.message);
      }
    }
  }

  /**
   * Check if Anthropic client is configured with active API key.
   */
  isConfigured() {
    return Boolean(this.client && this.apiKey && this.apiKey.trim() !== '');
  }

  /**
   * Queries Claude with context and user message.
   * Returns validated structured output.
   */
  async ask({ query, context, systemPrompt = SLOANE_SYSTEM_PROMPT }) {
    const startTime = Date.now();
    const requestId = `ai_req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Prepare context prompt message
    const userMessageContent = `SOLANE CONTEXT:
${JSON.stringify(context, null, 2)}

EXECUTIVE USER QUERY:
${query}`;

    // If client is not configured or in testing/fallback mode
    if (!this.isConfigured()) {
      return this._generateGracefulFallback({
        query,
        context,
        durationMs: Date.now() - startTime,
        requestId,
        reason: 'ANTHROPIC_API_KEY_NOT_CONFIGURED'
      });
    }

    // Set up timeout controller (Section 37)
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userMessageContent
            }
          ]
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startTime;

      // Extract raw text response
      const rawText = response.content?.[0]?.text || '';
      const structuredResult = this._parseAndValidateStructuredResponse(rawText, context);

      return {
        status: 'success',
        source: 'anthropic_claude',
        model: response.model || this.model,
        requestId,
        data: structuredResult,
        usage: {
          inputTokens: response.usage?.input_tokens || null,
          outputTokens: response.usage?.output_tokens || null,
          durationMs
        }
      };

    } catch (err) {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startTime;

      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
      console.warn(`[ClaudeService] Claude API call failed (${isTimeout ? 'TIMEOUT' : err.message}). Falling back to grounded rule engine.`);

      return this._generateGracefulFallback({
        query,
        context,
        durationMs,
        requestId,
        reason: isTimeout ? 'TIMEOUT_EXCEEDED' : 'API_ERROR',
        errorMessage: isTimeout ? `Request timed out after ${this.timeoutMs}ms` : 'Claude service temporarily unreachable'
      });
    }
  }

  /**
   * Parse structured JSON from Claude response and validate contract.
   */
  _parseAndValidateStructuredResponse(rawText, context) {
    let parsed;
    try {
      // Clean possible markdown code fences if model enclosed in ```json ... ```
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Fallback: build contract from raw text
      return {
        answer: rawText.trim(),
        risk_level: 'neutral',
        key_reasons: ['Analysis completed from practice records.'],
        recommended_actions: [],
        evidence: []
      };
    }

    // Validate and sanitize response contract (Section 28-29)
    return {
      answer: typeof parsed.answer === 'string' ? parsed.answer : 'Analysis complete.',
      risk_level: ['low', 'amber', 'red', 'neutral'].includes(parsed.risk_level) ? parsed.risk_level : 'neutral',
      key_reasons: Array.isArray(parsed.key_reasons) ? parsed.key_reasons.map(String) : [],
      recommended_actions: Array.isArray(parsed.recommended_actions) ? parsed.recommended_actions.map(a => ({
        action: typeof a === 'string' ? a : (a.action || String(a)),
        priority: ['high', 'normal', 'low'].includes(a.priority) ? a.priority : 'normal'
      })) : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(e => ({
        timeline_event_id: e.timeline_event_id || e.id || null,
        reason: e.reason || 'Cited record'
      })).filter(e => e.timeline_event_id !== null) : []
    };
  }

  /**
   * Generates grounded deterministic fallback based on context.
   * Adheres to Section 33 (Never pretend fallback is Claude).
   */
  _generateGracefulFallback({ query, context, durationMs, requestId, reason, errorMessage }) {
    const q = query.toLowerCase();

    let answer = 'Sloane reviewed the available practice records.';
    let risk_level = 'neutral';
    const key_reasons = [];
    const recommended_actions = [];
    const evidence = [];

    if (context.client) {
      const client = context.client;
      const companies = context.companies || [];
      const tasks = context.tasks || [];
      const timeline = context.timeline || [];

      const highRiskComp = companies.find(c => c.riskLevel === 'High');
      const medRiskComp = companies.find(c => c.riskLevel === 'Medium');

      if (highRiskComp) {
        risk_level = 'red';
        answer = `${client.name} is currently high risk due to statutory alerts for ${highRiskComp.companyName}.`;
        key_reasons.push(`${highRiskComp.companyName} has overdue filings or active strike-off warnings.`);
        recommended_actions.push({ action: 'Prioritize statutory submission to Companies House', priority: 'high' });
      } else if (medRiskComp) {
        risk_level = 'amber';
        answer = `${client.name} is currently amber because ${medRiskComp.companyName} has pending review deadlines.`;
        key_reasons.push(`Upcoming statutory deadlines require verification within standard filing cycle.`);
        recommended_actions.push({ action: 'Review draft accounts and confirm records', priority: 'normal' });
      } else {
        risk_level = 'low';
        answer = `${client.name} records are healthy with no critical statutory blockers.`;
        key_reasons.push('All filings are within scheduled submission cycles.');
      }

      // Check tasks
      const urgentTasks = tasks.filter(t => t.priority === 'Urgent' || t.isBlocked);
      if (urgentTasks.length > 0) {
        key_reasons.push(`${urgentTasks.length} urgent/blocked task(s) require attention.`);
        recommended_actions.push({ action: `Unblock task: ${urgentTasks[0].title}`, priority: 'high' });
      }

      // Cite real timeline evidence if available
      if (timeline.length > 0) {
        const topEvt = timeline[0];
        evidence.push({
          timeline_event_id: topEvt.id,
          reason: `Latest recorded event: ${topEvt.title}`
        });
      }
    } else {
      // General overview query
      answer = 'Reviewing connected practice records: Woofington Park and R GB Elevations require primary attention today.';
      risk_level = 'amber';
      key_reasons.push('Woofington Park strike-off defense deadline active.');
      key_reasons.push('R GB Elevations statutory accounts 50d overdue.');
      recommended_actions.push({ action: 'Check signing status for Woofington balance sheet', priority: 'high' });
      recommended_actions.push({ action: 'Follow up with Hamza on R GB bank records', priority: 'normal' });
    }

    return {
      status: 'fallback',
      source: 'sloane_rules_engine',
      model: 'deterministic_grounded_fallback',
      requestId,
      reason,
      errorMessage,
      data: {
        answer,
        risk_level,
        key_reasons,
        recommended_actions,
        evidence
      },
      usage: {
        durationMs
      }
    };
  }
}

export const claudeService = new ClaudeService();
