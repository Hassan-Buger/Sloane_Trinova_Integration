/**
 * AI Context Builder & Privacy Filter
 * Implements Prompt Section 21, 22, 23, 24, 40, 48:
 * - Deterministic allowlist
 * - Strict Privacy Boundary: PRIVATE_CEO_BRAIN = DENY
 * - Client Isolation: Never mix unrelated clients
 * - Excludes private notes (visibility === 'private')
 * - Grounding payload containing timeline events as evidence
 */

import { mockDb } from '../../data/db.js';
import { TimelineService } from '../timelineService.js';

export class ContextBuilder {
  /**
   * Builds sanitized context for an AI query.
   * @param {Object} options
   * @param {string} [options.clientId] - Target client identifier
   * @param {string} options.query - User message / intent
   * @param {Object} options.actor - Authenticated actor performing request
   * @returns {Object} { allowedContext, privacyAudit }
   */
  static buildContext({ clientId, query, actor }) {
    const privacyAudit = {
      privateCeoBrainDenied: true,
      privateTimelineEventsExcluded: 0,
      unrelatedClientsExcluded: 0,
      sanitizedFieldsIncluded: []
    };

    const detectedIntent = this.detectIntent(query);
    privacyAudit.detectedIntent = detectedIntent;

    let allowedContext = {};

    if (clientId) {
      // 1. Single Client Context (Strict Client Isolation)
      const client = (mockDb.clients || []).find(c => c.id === clientId);
      if (!client) {
        throw new Error(`Client with ID "${clientId}" not found.`);
      }

      // Allowlist: Client Identity
      allowedContext.client = {
        id: client.id,
        name: client.name,
        clientType: client.clientType,
        businessArea: client.businessArea,
        status: client.status,
        assignedManagerName: client.assignedManagerName
      };
      privacyAudit.sanitizedFieldsIncluded.push('client_identity');

      // Allowlist: Associated Companies & Statutory Status
      const companies = (mockDb.companies || []).filter(c => c.clientId === clientId);
      allowedContext.companies = companies.map(c => ({
        id: c.id,
        clientId: c.clientId,
        companyName: c.companyName,
        companyNumber: c.companyNumber,
        status: c.status,
        workflowStatus: c.workflowStatus,
        accountingReferenceDate: c.accountingReferenceDate,
        accountsDueDate: c.accountsDueDate,
        confirmationDueDate: c.confirmationDueDate,
        vatRegistered: c.vatRegistered,
        vatNumber: c.vatNumber,
        riskLevel: c.riskLevel,
        notes: c.notes || null
      }));
      privacyAudit.sanitizedFieldsIncluded.push('companies_statutory');

      // Allowlist: Associated Tasks
      const companyIds = companies.map(c => c.id);
      const tasks = (mockDb.tasks || []).filter(t => companyIds.includes(t.companyId));
      allowedContext.tasks = tasks.map(t => ({
        id: t.id,
        companyName: t.companyName,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        isBlocked: t.isBlocked,
        blocker: t.blocker,
        assigneeName: t.assigneeName
      }));
      privacyAudit.sanitizedFieldsIncluded.push('tasks');

      // Allowlist: Recent Non-Private Timeline Events (Evidence Layer)
      // Strict privacy boundary: excludePrivate = true
      const rawTimeline = TimelineService.getClientTimeline(clientId, { limit: 25 });
      const sanitizedTimeline = [];

      if (rawTimeline && Array.isArray(rawTimeline.events)) {
        for (const evt of rawTimeline.events) {
          if (evt.visibility === 'private') {
            privacyAudit.privateTimelineEventsExcluded++;
            continue; // PRIVACY RULE: Private events NEVER enter Claude context!
          }
          sanitizedTimeline.push({
            id: evt.id,
            eventType: evt.eventType,
            title: evt.title,
            description: evt.description,
            occurredAt: evt.occurredAt,
            source: evt.source,
            severity: evt.severity,
            metadata: evt.metadata || {}
          });
        }
      }
      allowedContext.timeline = sanitizedTimeline;
      privacyAudit.sanitizedFieldsIncluded.push('timeline_events_evidence');

      // Record excluded unrelated clients
      const totalClients = (mockDb.clients || []).length;
      privacyAudit.unrelatedClientsExcluded = Math.max(0, totalClients - 1);

    } else if (detectedIntent === 'GREETING' || detectedIntent === 'GENERAL') {
      // 2. Casual / General Conversation Context
      // Do not inject unrelated practice entities or client records into greetings
      allowedContext = {
        intent: detectedIntent,
        actor: {
          name: actor?.actorName || 'Kirsty Allen',
          role: 'CEO',
          practice: 'TriNova Group'
        }
      };
      privacyAudit.sanitizedFieldsIncluded.push('conversational_actor');

    } else {
      // 3. Global / Multi-Client Executive Context (For high-level queries)
      // Client summaries with statutory risks and overdue filings
      const clientSummaries = (mockDb.clients || []).map(c => {
        const clientCompanies = (mockDb.companies || []).filter(comp => comp.clientId === c.id);
        const risks = clientCompanies.map(comp => comp.riskLevel);
        const maxRisk = risks.includes('High') ? 'High' : risks.includes('Medium') ? 'Medium' : 'Low';
        return {
          id: c.id,
          name: c.name,
          businessArea: c.businessArea,
          status: c.status,
          companyCount: clientCompanies.length,
          overallRisk: maxRisk
        };
      });

      // Urgent and Overdue Tasks
      const urgentTasks = (mockDb.tasks || [])
        .filter(t => t.priority === 'Urgent' || t.status === 'Overdue' || t.isBlocked)
        .map(t => ({
          id: t.id,
          companyName: t.companyName,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          isBlocked: t.isBlocked,
          blocker: t.blocker
        }));

      // Grounded Practice Portfolio Metrics calculated directly from authoritative mockDb
      const allCompanies = mockDb.companies || [];
      const redCompanies = allCompanies.filter(comp => comp.riskLevel === 'High');
      const amberCompanies = allCompanies.filter(comp => comp.riskLevel === 'Medium');
      const lowCompanies = allCompanies.filter(comp => comp.riskLevel === 'Low');

      allowedContext = {
        intent: 'PRACTICE',
        executiveOverview: {
          activeClientsCount: clientSummaries.length,
          totalCompaniesCount: allCompanies.length,
          redRiskCount: redCompanies.length,
          amberRiskCount: amberCompanies.length,
          lowRiskCount: lowCompanies.length,
          redFlaggedCompanies: redCompanies.map(comp => ({
            name: comp.companyName,
            number: comp.companyNumber,
            riskLevel: comp.riskLevel,
            notes: comp.notes || 'High statutory risk',
            accountsDueDate: comp.accountsDueDate
          })),
          clientSummaries,
          criticalOrBlockedTasks: urgentTasks
        }
      };
      privacyAudit.sanitizedFieldsIncluded.push('executive_overview');
    }

    return {
      allowedContext,
      privacyAudit
    };
  }

  /**
   * Classify user query intent to construct minimal, privacy-compliant context.
   */
  static detectIntent(query) {
    if (!query || typeof query !== 'string') return 'GENERAL';
    const q = query.trim().toLowerCase();

    // Check for explicit practice topics first
    const hasPracticeKeywords = /\b(compan(y|ies)|client(s)?|statutory|red|amber|risk|deadlines?|woofington|rgb|elevations|accounts|filing|urgent|strike-off|tasks?|tax|vat)\b/i.test(q);
    if (hasPracticeKeywords) {
      return 'PRACTICE';
    }

    // Greetings & pleasantries
    if (/^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|greetings|hiya|what'?s\s*up|whats?up|wassup|sup|how\s+are\s+you)\b/i.test(q)) {
      return 'GREETING';
    }

    // Math / direct arithmetic / introductory questions
    if (/^(what\s+is\s+)?\d+\s*[\+\-\*\/]\s*\d+/i.test(q) ||
        /^(who\s+are\s+you|what\s+can\s+you\s+help|what\s+do\s+you\s+do|explain\s+what\s+you\s+can)\b/i.test(q)) {
      return 'GENERAL';
    }

    // Default to PRACTICE for business assistant
    return 'PRACTICE';
  }
}
