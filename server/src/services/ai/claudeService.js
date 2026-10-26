/**
 * Claude AI Backend Service
 * Integrates with official @anthropic-ai/sdk per Section 18, 20, 28, 29, 36, 37, 39.
 * Handles timeouts, token telemetry, error mapping, and structured output parsing.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { SLOANE_SYSTEM_PROMPT, BRIEFING_SYSTEM_PROMPT } from './prompts.js';
import { mockDb } from '../../data/db.js';
import { clientDirectory } from '../clientDirectory.js';
import { buildDeadlineList } from '../../routes/statutory.js';
import { answerWorkQuestion } from './workAnswers.js';

export class ClaudeService {
  constructor(options = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (config.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || '');
    this.workspaceId = options.workspaceId !== undefined ? options.workspaceId : (config.anthropic?.workspaceId || process.env.ANTHROPIC_WORKSPACE_ID || '');
    this.model = options.model || config.anthropic?.model || 'claude-3-5-sonnet-20241022';
    this.timeoutMs = options.timeoutMs || config.anthropic?.timeoutMs || 15000;
    this.maxTokens = options.maxTokens || config.anthropic?.maxTokens || 1500;

    // Google Gemini Configuration
    this.geminiApiKey = options.geminiApiKey !== undefined ? options.geminiApiKey : (config.gemini?.apiKey || process.env.GEMINI_API_KEY || '');
    this.geminiModel = options.geminiModel || config.gemini?.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this.geminiTimeoutMs = options.geminiTimeoutMs || config.gemini?.timeoutMs || parseInt(process.env.GEMINI_TIMEOUT_MS || '25000', 10);
    this.aiProvider = options.aiProvider || config.aiProvider || process.env.AI_PROVIDER || 'auto';

    this.client = null;
    if (this.apiKey && this.apiKey.trim() !== '') {
      try {
        const clientConfig = { apiKey: this.apiKey.trim() };
        if (this.workspaceId && this.workspaceId.trim() !== '') {
          clientConfig.defaultHeaders = {
            'anthropic-workspace-id': this.workspaceId.trim()
          };
        }
        this.client = new Anthropic(clientConfig);
      } catch (err) {
        console.warn('[ClaudeService] Failed to initialize Anthropic SDK:', err.message);
      }
    }
  }

  /**
   * Check if any AI provider is configured with an active API key.
   */
  isConfigured() {
    return this.isAnthropicConfigured() || this.isGeminiConfigured();
  }

  isAnthropicConfigured() {
    return Boolean(this.client && this.apiKey && this.apiKey.trim() !== '');
  }

  isGeminiConfigured() {
    return Boolean(this.geminiApiKey && this.geminiApiKey.trim() !== '');
  }

  /**
   * Queries configured AI provider (Anthropic Claude or Google Gemini) with context, user message, and multi-turn history.
   * Returns validated structured output adhering to the API contract.
   */
  async ask({ query, context = {}, history = [], systemPrompt = SLOANE_SYSTEM_PROMPT, provider = null, model = null }) {
    const startTime = Date.now();
    const requestId = `ai_req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Resolve active AI provider preference (request parameter overrides server default)
    const effectiveProvider = (provider || this.aiProvider || 'auto').toLowerCase();

    // If neither Anthropic nor Gemini is configured
    if (!this.isConfigured()) {
      return this._generateGracefulFallback({ history,
        query,
        context,
        durationMs: Date.now() - startTime,
        requestId,
        reason: 'ANTHROPIC_API_KEY_NOT_CONFIGURED',
        errorMessage: 'Neither Anthropic API key nor Gemini API key is configured on the server. Utilizing verified local rules engine.'
      });
    }

    // 1. Explicit Gemini Preference
    if (effectiveProvider === 'gemini') {
      if (this.isGeminiConfigured()) {
        try {
          return await this._askGemini({ query, context, history, systemPrompt, startTime, requestId, model });
        } catch (geminiErr) {
          console.warn('[AIService] Primary Gemini call failed:', geminiErr.message);
          if (this.isAnthropicConfigured()) {
            console.info('[AIService] Failing over to Anthropic Claude...');
            try {
              return await this._askAnthropic({ query, context, history, systemPrompt, startTime, requestId });
            } catch (anthropicErr) {
              console.warn('[AIService] Secondary Anthropic call also failed:', anthropicErr.message);
            }
          }
          const isTimeout = geminiErr.name === 'AbortError' || geminiErr.message?.includes('aborted');
          return this._generateGracefulFallback({ history,
            query,
            context,
            durationMs: Date.now() - startTime,
            requestId,
            reason: isTimeout ? 'TIMEOUT_EXCEEDED' : 'API_ERROR',
            errorMessage: isTimeout ? `Request timed out after ${this.timeoutMs}ms` : (geminiErr.message || 'Gemini service temporarily unreachable')
          });
        }
      } else if (this.isAnthropicConfigured()) {
        console.warn('[AIService] Gemini requested but not configured. Using Anthropic Claude.');
        return await this._askAnthropic({ query, context, history, systemPrompt, startTime, requestId });
      }
    }

    // 2. Explicit Anthropic Preference
    if (effectiveProvider === 'anthropic') {
      if (this.isAnthropicConfigured()) {
        try {
          return await this._askAnthropic({ query, context, history, systemPrompt, startTime, requestId });
        } catch (anthropicErr) {
          console.warn('[AIService] Anthropic API call failed:', anthropicErr.message);
          if (this.isGeminiConfigured()) {
            console.info('[AIService] Seamlessly failing over to Google Gemini...');
            try {
              return await this._askGemini({ query, context, history, systemPrompt, startTime, requestId, model });
            } catch (geminiErr) {
              console.warn('[AIService] Gemini fallback also failed:', geminiErr.message);
            }
          }
          const isTimeout = anthropicErr.name === 'AbortError' || anthropicErr.message?.includes('aborted');
          return this._generateGracefulFallback({ history,
            query,
            context,
            durationMs: Date.now() - startTime,
            requestId,
            reason: isTimeout ? 'TIMEOUT_EXCEEDED' : 'API_ERROR',
            errorMessage: isTimeout ? `Request timed out after ${this.timeoutMs}ms` : (anthropicErr.message || 'Claude service temporarily unreachable')
          });
        }
      } else if (this.isGeminiConfigured()) {
        console.warn('[AIService] Anthropic requested but not configured. Using Google Gemini.');
        return await this._askGemini({ query, context, history, systemPrompt, startTime, requestId, model });
      }
    }

    // 3. Default 'auto' Mode (Claude primary with instant Gemini failover; or Gemini if only Gemini is configured)
    if (this.isAnthropicConfigured()) {
      try {
        return await this._askAnthropic({ query, context, history, systemPrompt, startTime, requestId });
      } catch (anthropicErr) {
        console.warn('[AIService] Anthropic API call failed in auto mode:', anthropicErr.message);
        if (this.isGeminiConfigured()) {
          console.info('[AIService] Seamlessly failing over to Google Gemini...');
          try {
            return await this._askGemini({ query, context, history, systemPrompt, startTime, requestId, model });
          } catch (geminiErr) {
            console.warn('[AIService] Gemini fallback also failed:', geminiErr.message);
          }
        }
        const isTimeout = anthropicErr.name === 'AbortError' || anthropicErr.message?.includes('aborted');
        return this._generateGracefulFallback({ history,
          query,
          context,
          durationMs: Date.now() - startTime,
          requestId,
          reason: isTimeout ? 'TIMEOUT_EXCEEDED' : 'API_ERROR',
          errorMessage: isTimeout ? `Request timed out after ${this.timeoutMs}ms` : (anthropicErr.message || 'Claude service temporarily unreachable')
        });
      }
    }

    if (this.isGeminiConfigured()) {
      try {
        return await this._askGemini({ query, context, history, systemPrompt, startTime, requestId, model });
      } catch (geminiErr) {
        const isTimeout = geminiErr.name === 'AbortError' || geminiErr.message?.includes('aborted');
        return this._generateGracefulFallback({ history,
          query,
          context,
          durationMs: Date.now() - startTime,
          requestId,
          reason: isTimeout ? 'TIMEOUT_EXCEEDED' : 'API_ERROR',
          errorMessage: isTimeout ? `Request timed out after ${this.timeoutMs}ms` : (geminiErr.message || 'Gemini service temporarily unreachable')
        });
      }
    }

    return this._generateGracefulFallback({ history,
      query,
      context,
      durationMs: Date.now() - startTime,
      requestId,
      reason: 'NO_ACTIVE_AI_PROVIDER',
      errorMessage: 'No active AI provider could process the query.'
    });
  }

  /**
   * Internal Anthropic Claude Execution
   */
  async _askAnthropic({ query, context, history, systemPrompt, startTime, requestId }) {
    let latestUserContent = query;
    if (context.client || context.executiveOverview) {
      latestUserContent = `SOLANE PRACTICE CONTEXT:
${JSON.stringify(context, null, 2)}

EXECUTIVE USER QUERY:
${query}`;
    }

    const messages = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history) {
        const role = turn.role === 'assistant' ? 'assistant' : 'user';
        const content = typeof turn.content === 'string' ? turn.content.trim() : String(turn.content || '').trim();
        if (!content) continue;

        if (messages.length === 0) {
          if (role === 'user') messages.push({ role, content });
        } else if (messages[messages.length - 1].role === role) {
          messages[messages.length - 1].content += `\n\n${content}`;
        } else {
          messages.push({ role, content });
        }
      }
    }

    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      messages[messages.length - 1].content = latestUserContent;
    } else {
      messages.push({ role: 'user', content: latestUserContent });
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          messages
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startTime;

      let rawText = '';
      if (Array.isArray(response.content)) {
        rawText = response.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n\n')
          .trim();
      }

      const structuredResult = this._parseAndValidateStructuredResponse(rawText, context, query);

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
      throw err;
    }
  }

  /**
   * Internal Google Gemini Execution
   */
  async _askGemini({ query, context, history, systemPrompt, startTime, requestId, model = null }) {
    let latestUserContent = query;
    if (context.client || context.executiveOverview) {
      latestUserContent = `SLOANE PRACTICE CONTEXT:
${JSON.stringify(context, null, 2)}

EXECUTIVE USER QUERY:
${query}`;
    }

    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history) {
        const role = turn.role === 'assistant' ? 'model' : 'user';
        const text = typeof turn.content === 'string' ? turn.content.trim() : String(turn.content || '').trim();
        if (!text) continue;
        if (contents.length === 0 && role === 'model') continue;
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts[0].text += `\n\n${text}`;
        } else {
          contents.push({ role, parts: [{ text }] });
        }
      }
    }

    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts[0].text = latestUserContent;
    } else {
      contents.push({ role: 'user', parts: [{ text: latestUserContent }] });
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.geminiTimeoutMs || 25000);

    const primaryModel = (model || this.geminiModel || 'gemini-3.1-flash-lite').replace(/^models\//, '');
    const candidateModels = [primaryModel];
    const resilientFallbacks = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    for (const fb of resilientFallbacks) {
      if (!candidateModels.includes(fb)) candidateModels.push(fb);
    }

    let lastError = null;

    try {
      for (const modelName of candidateModels) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': this.geminiApiKey.trim()
            },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemPrompt }]
              },
              contents,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: this.maxTokens
              }
            })
          });

          // If current model is 404 (deprecated/not found) or 503 (high demand), try next candidate
          if (response.status === 404 || response.status === 503) {
            const errorText = await response.text();
            console.warn(`[AIService] Gemini model ${modelName} returned HTTP ${response.status}. Trying next resilient candidate...`);
            lastError = new Error(`Gemini API error ${response.status}: ${errorText}`);
            continue;
          }

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error ${response.status}: ${errorText}`);
          }

          clearTimeout(timeoutHandle);
          const durationMs = Date.now() - startTime;
          const resJson = await response.json();
          const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const structuredResult = this._parseAndValidateStructuredResponse(rawText, context, query);

          return {
            status: 'success',
            source: 'google_gemini',
            model: modelName,
            requestId,
            data: structuredResult,
            usage: {
              inputTokens: resJson.usageMetadata?.promptTokenCount || null,
              outputTokens: resJson.usageMetadata?.candidatesTokenCount || null,
              durationMs
            }
          };
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') throw fetchErr;
          lastError = fetchErr;
        }
      }

      clearTimeout(timeoutHandle);
      throw lastError || new Error('All configured Gemini models failed.');
    } catch (err) {
      clearTimeout(timeoutHandle);
      throw err;
    }
  }

  /**
   * Parse structured JSON from Claude response and validate contract.
   */
  _parseAndValidateStructuredResponse(rawText, context = {}, query = '') {
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
      // Fallback: build contract from raw text response
      const isGreeting = /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|what'?s\s+up|how\s+are\s+you)\b/i.test(query.trim());
      const isMath = /^(what\s+is\s+)?\d+\s*[\+\-\*\/]\s*\d+/i.test(query.trim());

      return {
        response_type: isGreeting ? 'conversational' : isMath ? 'general_knowledge' : 'practice_assessment',
        answer: rawText.trim() || 'Analysis complete.',
        risk_level: (isGreeting || isMath) ? null : 'neutral',
        key_reasons: (isGreeting || isMath) ? [] : ['Analysis completed from practice records.'],
        recommended_actions: [],
        evidence: []
      };
    }

    // Determine normalized response_type
    let responseType = parsed.response_type;
    if (!['conversational', 'general_knowledge', 'practice_assessment'].includes(responseType)) {
      if (parsed.risk_level && ['red', 'amber', 'low'].includes(parsed.risk_level)) {
        responseType = 'practice_assessment';
      } else if (Array.isArray(parsed.recommended_actions) && parsed.recommended_actions.length > 0) {
        responseType = 'practice_assessment';
      } else {
        responseType = 'conversational';
      }
    }

    // Validate risk_level
    const validRiskLevels = ['low', 'amber', 'red', 'neutral'];
    const riskLevel = validRiskLevels.includes(parsed.risk_level) ? parsed.risk_level : null;

    return {
      response_type: responseType,
      answer: typeof parsed.answer === 'string' ? parsed.answer : 'Analysis complete.',
      risk_level: riskLevel,
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
   * Adheres strictly to Section 33 (Never pretend fallback is Claude).
   */
  _generateGracefulFallback({ history = [], query, context = {}, durationMs, requestId, reason, errorMessage }) {
    const q = (query || '').trim().toLowerCase();

    // 1. Check for Casual Greeting
    const isGreeting = /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|greetings|hiya|what'?s\s*up|whats?up|wassup|sup|how\s+are\s+you)\b/i.test(q);
    if (isGreeting) {
      return {
        status: 'fallback',
        source: 'sloane_rules_engine',
        model: 'deterministic_grounded_fallback',
        requestId,
        reason,
        errorMessage,
        data: {
          response_type: 'conversational',
          answer: 'Hello Kirsty. I am Sloane, your Executive Command Centre assistant. How can I assist you with practice intelligence, statutory obligations, or director instructions right now?',
          risk_level: null,
          key_reasons: [],
          recommended_actions: [],
          evidence: []
        },
        usage: { durationMs }
      };
    }

    // 2. Check for Arithmetic / General Knowledge
    const mathMatch = q.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
    if (mathMatch) {
      const a = parseInt(mathMatch[1], 10);
      const op = mathMatch[2];
      const b = parseInt(mathMatch[3], 10);
      let mathResult = 0;
      if (op === '+') mathResult = a + b;
      else if (op === '-') mathResult = a - b;
      else if (op === '*') mathResult = a * b;
      else if (op === '/') mathResult = b !== 0 ? Math.round((a / b) * 100) / 100 : 'undefined';

      return {
        status: 'fallback',
        source: 'sloane_rules_engine',
        model: 'deterministic_grounded_fallback',
        requestId,
        reason,
        errorMessage,
        data: {
          response_type: 'general_knowledge',
          answer: `${a} ${op} ${b} = ${mathResult}.`,
          risk_level: null,
          key_reasons: [],
          recommended_actions: [],
          evidence: []
        },
        usage: { durationMs }
      };
    }

    if (/^(who\s+are\s+you|what\s+can\s+you\s+help|what\s+do\s+you\s+do|explain\s+what\s+you\s+can)\b/i.test(q)) {
      return {
        status: 'fallback',
        source: 'sloane_rules_engine',
        model: 'deterministic_grounded_fallback',
        requestId,
        reason,
        errorMessage,
        data: {
          response_type: 'general_knowledge',
          answer: 'I am Sloane, your executive assistant for TriNova Group. I monitor statutory obligations and filing deadlines, cross-reference Companies House records, track client timelines with immutable provenance, manage Documenso digital signing workflows, and brief you on high-risk practice entities.',
          risk_level: null,
          key_reasons: [],
          recommended_actions: [],
          evidence: []
        },
        usage: { durationMs }
      };
    }

    // 3. Single Client Focused Query
    if (context.client) {
      const client = context.client;
      const companies = context.companies || [];
      const tasks = context.tasks || [];
      const timeline = context.timeline || [];

      const highRiskComp = companies.find(c => c.riskLevel === 'High');
      const medRiskComp = companies.find(c => c.riskLevel === 'Medium');

      let answer = `${client.name} records are healthy with no critical statutory blockers.`;
      let risk_level = 'low';
      const key_reasons = [];
      const recommended_actions = [];
      const evidence = [];

      if (highRiskComp) {
        risk_level = 'red';
        answer = `${client.name} is currently high risk due to statutory alerts for ${highRiskComp.companyName}.`;
        key_reasons.push(`${highRiskComp.companyName} has overdue filings or active strike-off warnings.`);
        recommended_actions.push({ action: 'Prioritize statutory submission to Companies House', priority: 'high' });
      } else if (medRiskComp) {
        risk_level = 'amber';
        answer = `${client.name} is currently amber because ${medRiskComp.companyName} has pending review deadlines.`;
        key_reasons.push('Upcoming statutory deadlines require verification within standard filing cycle.');
        recommended_actions.push({ action: 'Review draft accounts and confirm records', priority: 'normal' });
      } else {
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

      return {
        status: 'fallback',
        source: 'sloane_rules_engine',
        model: 'deterministic_grounded_fallback',
        requestId,
        reason,
        errorMessage,
        data: {
          response_type: 'practice_assessment',
          answer,
          risk_level,
          key_reasons,
          recommended_actions,
          evidence
        },
        usage: { durationMs }
      };
    }

    // 3.45 Questions about people, clients that are behind, what needs chasing, or one business
    const work = answerWorkQuestion(query);
    if (work) {
      return {
        status: 'fallback',
        source: 'sloane_rules_engine',
        model: 'deterministic_grounded_fallback',
        requestId,
        reason,
        errorMessage,
        data: work,
        usage: { durationMs }
      };
    }

    // 3.5 Looking up a client or company by name (live TriNova clients included)
    const allCompanies = mockDb.companies || [];
    const knownClients = clientDirectory.all();
    const openTasks0 = () => (mockDb.tasks || []).filter(t => !['Completed', 'Cancelled'].includes(t.status));
    const deadlines = buildDeadlineList().filter(d => !d.isDissolved);

    // 3.4 A follow-up such as "tell me more about the first company you mentioned":
    // find the first client named in the last answer and talk about that one.
    const refersBack = /(tell me more|more about|the first (one|company|client)|that (one|company|client)|this (one|company|client)|the same (one|company|client))/i.test(q);
    if (refersBack && Array.isArray(history)) {
      const lastAnswer = [...history].reverse().find(h => h && h.role === 'assistant' && typeof h.content === 'string');
      if (lastAnswer) {
        const text = lastAnswer.content.toLowerCase();
        const names = [...new Set([...deadlines.map(d => d.name), ...knownClients.map(c => c.name)])]
          .filter(n => n && text.includes(n.toLowerCase()))
          .sort((a, b) => text.indexOf(a.toLowerCase()) - text.indexOf(b.toLowerCase()));
        if (names.length > 0) {
          const name = names[0];
          const row = deadlines.find(d => d.name === name);
          const reasons = row
            ? [`${row.urgency}: ${row.urgencyReason}`, row.accountsDue ? `Accounts due ${row.accountsDue}` : null, row.confirmDue ? `Yearly update due ${row.confirmDue}` : null, row.note ? `Note: ${row.note}` : null].filter(Boolean)
            : ['Sloane has no deadline saved for this client.'];
          const tasksFor = openTasks0().filter(t => (t.companyName || '').toLowerCase() === name.toLowerCase());
          for (const t of tasksFor.slice(0, 3)) reasons.push(`Task: ${t.title}${t.isBlocked ? ' (stuck)' : ''}`);
          return {
            status: 'fallback',
            source: 'sloane_rules_engine',
            model: 'deterministic_grounded_fallback',
            requestId,
            reason,
            errorMessage,
            data: {
              response_type: 'practice_assessment',
              answer: `About ${name}: ${reasons[0]}.`,
              risk_level: row ? row.urgency.toLowerCase() : 'neutral',
              key_reasons: reasons,
              recommended_actions: row && row.urgency !== 'CLEAR' ? [{ action: `Check the filing for ${name}`, priority: 'high' }] : [],
              evidence: []
            },
            usage: { durationMs }
          };
        }
      }
    }



    const mentionsClientOrCompany = /\b(client|company|entities|portfolio)\b/i.test(q);
    const mentionsSearchOrQuery = /\b(is there|are there|do we have|any|find|search|lookup|named|name)\b/i.test(q);

    if (mentionsClientOrCompany && mentionsSearchOrQuery) {
      const candidates = [];
      const regexes = [
        /client\s+(?:name\s+|named\s+)?["']?([a-z0-9\s\-]+?)["']?(?:\s+(?:and|or|with)|[\?,\.]|$)/gi,
        /company\s+(?:name\s+|named\s+)?["']?([a-z0-9\s\-]+?)["']?(?:\s+(?:and|or|with)|[\?,\.]|$)/gi
      ];
      for (const rx of regexes) {
        let match;
        while ((match = rx.exec(q)) !== null) {
          const val = match[1].trim();
          if (val && !['any', 'the', 'a', 'an', 'is', 'there'].includes(val.toLowerCase())) {
            candidates.push(val);
          }
        }
      }

      if (candidates.length > 0) {
        const foundClients = [];
        const notFound = [];

        for (const cand of candidates) {
          const cleanCand = cand.toLowerCase();
          const matchClient = knownClients.find(c => c.name.toLowerCase().includes(cleanCand));
          const matchComp = allCompanies.find(c => c.companyName.toLowerCase().includes(cleanCand));
          if (matchClient) {
            foundClients.push(`Client: ${matchClient.name}`);
          } else if (matchComp) {
            foundClients.push(`Company: ${matchComp.companyName}`);
          } else {
            notFound.push(cand);
          }
        }

        if (notFound.length > 0) {
          let answer = `Sloane has no client or company called ${notFound.map(n => `"${n}"`).join(', ')}. `;
          if (foundClients.length > 0) {
            answer += `It does have: ${foundClients.join(', ')}.`;
          } else {
            answer += `Sloane can see ${knownClients.length} client${knownClients.length === 1 ? '' : 's'} in total.`;
          }

          return {
            status: 'fallback',
            source: 'sloane_rules_engine',
            model: 'deterministic_grounded_fallback',
            requestId,
            reason,
            errorMessage,
            data: {
              response_type: 'practice_assessment',
              answer,
              risk_level: foundClients.length === 0 ? 'neutral' : 'amber',
              key_reasons: [
                ...notFound.map(n => `"${n}" is not in the records Sloane can see.`),
                ...foundClients.map(f => `${f} is in Sloane.`)
              ],
              recommended_actions: [],
              evidence: []
            },
            usage: { durationMs }
          };
        }
      }
    }

    // 4. Practice-wide question: answered only from what is really saved in Sloane
    const redFilings = deadlines.filter(d => d.urgency === 'RED');
    const amberFilings = deadlines.filter(d => d.urgency === 'AMBER');
    const openTasks = (mockDb.tasks || []).filter(t => !['Completed', 'Cancelled'].includes(t.status));
    const stuckTasks = openTasks.filter(t => t.isBlocked);

    const isRedCountQuery = /how\s+many.*(red|flagged)/i.test(q) || /count.*(red|high)/i.test(q);
    const isUrgentPriorityQuery = /which.*(most\s+urgent|priority|attention)/i.test(q) || /highest\s+priority/i.test(q);
    const names = list => list.map(d => d.name).join(', ');
    const noun = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    let answer;
    let risk_level = redFilings.length > 0 ? 'red' : (amberFilings.length > 0 ? 'amber' : 'low');
    const key_reasons = [];
    const recommended_actions = [];
    const evidence = [];

    if (deadlines.length === 0 && openTasks.length === 0 && knownClients.length === 0) {
      answer = 'Nothing is saved in Sloane yet: no clients, deadlines or tasks. Add some, or connect TriNova, and I can answer questions about them.';
      risk_level = null;
    } else if (isRedCountQuery) {
      answer = redFilings.length > 0
        ? `${noun(redFilings.length, 'filing is', 'filings are')} flagged RED: ${names(redFilings)}.`
        : 'No filings are flagged RED right now.';
      for (const d of redFilings.slice(0, 6)) key_reasons.push(`${d.name}: ${d.urgencyReason}`);
      if (redFilings.length > 0) recommended_actions.push({ action: 'Open Deadlines and deal with the RED rows first', priority: 'high' });
    } else if (isUrgentPriorityQuery) {
      const top = redFilings[0] || amberFilings[0];
      if (top) {
        answer = `${top.name} is the most urgent: ${top.urgencyReason.charAt(0).toLowerCase()}${top.urgencyReason.slice(1)}.`;
        key_reasons.push(`${top.name}: ${top.note || top.urgencyReason}`);
        recommended_actions.push({ action: `Check the latest filing for ${top.name}`, priority: 'high' });
      } else if (stuckTasks.length > 0) {
        answer = `No filing is urgent. ${noun(stuckTasks.length, 'task is', 'tasks are')} stuck: ${stuckTasks.slice(0, 3).map(t => t.title).join(', ')}.`;
        recommended_actions.push({ action: `Unblock: ${stuckTasks[0].title}`, priority: 'high' });
      } else {
        answer = 'Nothing is urgent right now.';
      }
    } else {
      const parts = [];
      parts.push(`${noun(redFilings.length, 'filing is', 'filings are')} RED`);
      parts.push(`${noun(amberFilings.length, 'is', 'are')} AMBER`);
      parts.push(`${noun(stuckTasks.length, 'task is', 'tasks are')} stuck`);
      answer = `Right now ${parts.join(', ')}.${redFilings.length > 0 ? ` Needing attention first: ${names(redFilings.slice(0, 3))}.` : ''}`;
      for (const d of redFilings.slice(0, 3)) key_reasons.push(`${d.name}: ${d.urgencyReason}`);
      for (const t of stuckTasks.slice(0, 3)) key_reasons.push(`Stuck: ${t.title}${t.blocker ? ` (${t.blocker})` : ''}`);
      if (redFilings[0]) recommended_actions.push({ action: `Check the filing for ${redFilings[0].name}`, priority: 'high' });
      if (stuckTasks[0]) recommended_actions.push({ action: `Unblock: ${stuckTasks[0].title}`, priority: 'normal' });
    }

    return {
      status: 'fallback',
      source: 'sloane_rules_engine',
      model: 'deterministic_grounded_fallback',
      requestId,
      reason,
      errorMessage,
      data: {
        response_type: 'practice_assessment',
        answer,
        risk_level,
        key_reasons,
        recommended_actions,
        evidence
      },
      usage: { durationMs }
    };
  }
}

export const claudeService = new ClaudeService();
