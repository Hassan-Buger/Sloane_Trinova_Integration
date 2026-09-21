/**
 * Server-Side Statutory Reconciliation Engine
 * Merges internal practice tracker data with live Companies House filings,
 * computing statutory urgency states, days remaining, and provenance metadata.
 *
 * Adheres strictly to:
 * - context/01_product_context.md §Statutory Monitor
 * - context/03_frontend_context.md §chMerged()
 * - context/specs/03-companies-house-backend.md §2 & §3.2
 */

export class StatutoryReconciliationEngine {
  /**
   * Calculates integer days remaining between anchorDate and targetDateStr.
   * Anchored at 12:00:00 UTC to avoid DST boundary fluctuations.
   */
  static daysRemaining(targetDateStr, anchorDate = new Date()) {
    if (!targetDateStr) return null;
    try {
      const now = new Date(anchorDate);
      now.setUTCHours(12, 0, 0, 0);

      const target = new Date(targetDateStr + 'T12:00:00Z');
      if (isNaN(target.getTime())) return null;

      const diffMs = target.getTime() - now.getTime();
      return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    } catch {
      return null;
    }
  }

  /**
   * Computes statutory urgency for a specific deadline date.
   * Rules:
   * - days < 0: 'PAST DATE · verify' (RED)
   * - 0–14 days: RED
   * - 15–30 days: AMBER
   * - 31+ days: CLEAR
   */
  static evaluateDeadlineUrgency(dateStr, anchorDate = new Date()) {
    if (!dateStr) {
      return {
        urgency: 'AMBER',
        label: 'No date in tracker',
        daysRemaining: null
      };
    }

    const days = this.daysRemaining(dateStr, anchorDate);
    if (days === null) {
      return {
        urgency: 'AMBER',
        label: 'Invalid date format',
        daysRemaining: null
      };
    }

    if (days < 0) {
      return {
        urgency: 'RED',
        label: 'PAST DATE · verify',
        daysRemaining: days
      };
    }
    if (days <= 14) {
      return {
        urgency: 'RED',
        label: `RED · ${days}d`,
        daysRemaining: days
      };
    }
    if (days <= 30) {
      return {
        urgency: 'AMBER',
        label: `AMBER · ${days}d`,
        daysRemaining: days
      };
    }
    return {
      urgency: 'CLEAR',
      label: `CLEAR · ${days}d`,
      daysRemaining: days
    };
  }

  /**
   * Reconciles a single tracker record with live Companies House data.
   *
   * @param {Object} trackerRecord - Practice database record
   * @param {Object|null} liveChRecord - Live normalized CH profile
   * @param {Date} [anchorDate] - Optional evaluation date for tests
   * @returns {Object} Reconciled statutory record
   */
  static reconcileRecord(trackerRecord, liveChRecord = null, anchorDate = new Date()) {
    const isLive = Boolean(liveChRecord);
    const companyNumber = trackerRecord.companyNumber || trackerRecord.no || '';
    const name = (isLive && liveChRecord.name) ? liveChRecord.name : (trackerRecord.name || trackerRecord.companyName || '');

    // Accounts dates & overdue flags
    const accountsDue = (isLive && liveChRecord.accountsDue)
      ? liveChRecord.accountsDue
      : (trackerRecord.accountsDueDate || trackerRecord.accounts || null);

    const accountsOverdue = isLive
      ? Boolean(liveChRecord.accountsOverdue)
      : Boolean(trackerRecord.accountsOverdue || false);

    // Confirmation statement dates & overdue flags
    const confirmDue = (isLive && liveChRecord.confirmDue)
      ? liveChRecord.confirmDue
      : (trackerRecord.confirmationDueDate || trackerRecord.confirm || null);

    const confirmOverdue = isLive
      ? Boolean(liveChRecord.confirmOverdue)
      : Boolean(trackerRecord.confirmOverdue || false);

    // Company status & detail
    const companyStatus = (isLive && liveChRecord.companyStatus)
      ? liveChRecord.companyStatus
      : (trackerRecord.status || 'Active');

    const statusDetail = (isLive && liveChRecord.statusDetail)
      ? liveChRecord.statusDetail
      : (trackerRecord.statusDetail || null);

    const isDissolved = /dissolved/i.test(companyStatus);
    const hasStrikeOff = /strike-off/i.test(statusDetail || '') || /strike-off/i.test(companyStatus || '');

    // 1. Rule: Dissolved companies suppress routine filing alerts
    if (isDissolved) {
      return {
        companyNumber,
        name,
        companyStatus: 'dissolved',
        statusDetail,
        isDissolved: true,
        hasStrikeOff: false,
        accountsDue,
        accountsOverdue: false,
        confirmDue,
        confirmOverdue: false,
        urgency: 'CLEAR',
        urgencyLabel: 'Dissolved',
        urgencyReason: 'Company dissolved — routine filing obligations removed',
        nearestDeadline: null,
        daysRemaining: null,
        note: trackerRecord.note || trackerRecord.notes || 'Company dissolved.',
        source: isLive ? 'companies_house_live' : 'tracker_derived',
        lastChecked: isLive ? liveChRecord.lastChecked : null
      };
    }

    // 2. Compute deadline urgencies for accounts and confirmation
    const accountsEval = this.evaluateDeadlineUrgency(accountsDue, anchorDate);
    const confirmEval = this.evaluateDeadlineUrgency(confirmDue, anchorDate);

    // Determine nearest upcoming deadline
    let nearestDeadline = null;
    let daysRemaining = null;

    if (accountsDue && confirmDue) {
      if (accountsEval.daysRemaining !== null && confirmEval.daysRemaining !== null) {
        if (accountsEval.daysRemaining <= confirmEval.daysRemaining) {
          nearestDeadline = { type: 'accounts', date: accountsDue, ...accountsEval };
          daysRemaining = accountsEval.daysRemaining;
        } else {
          nearestDeadline = { type: 'confirmation_statement', date: confirmDue, ...confirmEval };
          daysRemaining = confirmEval.daysRemaining;
        }
      }
    } else if (accountsDue) {
      nearestDeadline = { type: 'accounts', date: accountsDue, ...accountsEval };
      daysRemaining = accountsEval.daysRemaining;
    } else if (confirmDue) {
      nearestDeadline = { type: 'confirmation_statement', date: confirmDue, ...confirmEval };
      daysRemaining = confirmEval.daysRemaining;
    }

    // 3. Apply promotion rules: Strike-Off and Overdue ALWAYS promote to RED
    let overallUrgency = 'CLEAR';
    let overallLabel = nearestDeadline ? nearestDeadline.label : 'CLEAR';
    let urgencyReason = 'Routine statutory schedule';

    if (hasStrikeOff) {
      overallUrgency = 'RED';
      overallLabel = 'RED · Strike-off proposal';
      urgencyReason = 'Active proposal to strike off registered at Companies House';
    } else if (accountsOverdue) {
      overallUrgency = 'RED';
      overallLabel = 'RED · Accounts overdue';
      urgencyReason = 'Accounts flagged as overdue at Companies House';
    } else if (confirmOverdue) {
      overallUrgency = 'RED';
      overallLabel = 'RED · Confirm stmt overdue';
      urgencyReason = 'Confirmation statement flagged as overdue at Companies House';
    } else if (accountsEval.urgency === 'RED' || confirmEval.urgency === 'RED') {
      overallUrgency = 'RED';
      overallLabel = (accountsEval.urgency === 'RED') ? accountsEval.label : confirmEval.label;
      urgencyReason = 'Filing deadline within critical urgency window (<= 14 days or past date)';
    } else if (accountsEval.urgency === 'AMBER' || confirmEval.urgency === 'AMBER') {
      overallUrgency = 'AMBER';
      overallLabel = (accountsEval.urgency === 'AMBER') ? accountsEval.label : confirmEval.label;
      urgencyReason = 'Filing deadline approaching within 15–30 days';
    }

    // Compose explanatory note
    let mergedNote = trackerRecord.note || trackerRecord.notes || '';
    if (hasStrikeOff && !mergedNote.includes('strike-off')) {
      mergedNote = `[STRIKE-OFF PROPOSAL ACTIVE] ${mergedNote}`.trim();
    }
    if (accountsOverdue && !mergedNote.includes('OVERDUE')) {
      mergedNote = `[CH: Accounts OVERDUE] ${mergedNote}`.trim();
    }
    if (confirmOverdue && !mergedNote.includes('CONFIRM OVERDUE')) {
      mergedNote = `[CH: Confirmation Statement OVERDUE] ${mergedNote}`.trim();
    }

    return {
      companyNumber,
      name,
      companyStatus,
      statusDetail,
      isDissolved: false,
      hasStrikeOff,
      accountsDue,
      accountsOverdue,
      confirmDue,
      confirmOverdue,
      urgency: overallUrgency,
      urgencyLabel: overallLabel,
      urgencyReason,
      nearestDeadline,
      daysRemaining,
      note: mergedNote,
      source: isLive ? 'companies_house_live' : 'tracker_derived',
      lastChecked: isLive ? liveChRecord.lastChecked : null
    };
  }
}
