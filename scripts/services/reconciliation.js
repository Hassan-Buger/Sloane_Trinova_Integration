/**
 * Sloane Statutory Reconciliation Engine
 * Implements the core compliance deadline rules, Companies House merging logic,
 * and data provenance tracking per 01_product_context.md & 04_backend_integration_context.md.
 */

export const ReconciliationEngine = {
  /**
   * Calculates integer days remaining until a given target date.
   * Uses real current date rather than the prototype's fixed snapshot date.
   */
  daysTo(dateStr) {
    if (!dateStr) return null;
    try {
      const now = new Date();
      now.setHours(12, 0, 0, 0); // Noon-anchor to prevent DST jitter
      const target = new Date(dateStr + 'T12:00:00');
      if (isNaN(target.getTime())) return null;
      return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    } catch (e) {
      return null;
    }
  },

  /**
   * Formats ISO date YYYY-MM-DD into DD/MM/YYYY.
   */
  formatDate(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  },

  /**
   * Classifies statutory deadline urgency per Sloane business rules.
   */
  deadlineState(dateStr) {
    if (!dateStr) {
      return { label: 'No date in tracker', cls: 'status-amber', days: null, urgency: 'AMBER' };
    }

    const days = this.daysTo(dateStr);
    if (days === null) {
      return { label: 'Invalid date', cls: 'status-amber', days: null, urgency: 'AMBER' };
    }

    if (days < 0) {
      return { label: 'PAST DATE · verify', cls: 'status-overdue', days, urgency: 'RED' };
    }
    if (days <= 14) {
      return { label: `RED · ${days}d`, cls: 'status-red', days, urgency: 'RED' };
    }
    if (days <= 30) {
      return { label: `AMBER · ${days}d`, cls: 'status-amber', days, urgency: 'AMBER' };
    }
    return { label: `CLEAR · ${days}d`, cls: 'status-clear', days, urgency: 'CLEAR' };
  },

  /**
   * Calculates the nearest upcoming filing obligation between accounts and confirmation statement.
   */
  nearestFor(record) {
    const list = [];
    if (record.accounts) {
      const d = this.daysTo(record.accounts);
      if (d !== null) list.push({ label: 'Accounts', date: record.accounts, days: d });
    }
    if (record.confirm) {
      const d = this.daysTo(record.confirm);
      if (d !== null) list.push({ label: 'Confirm Stmt', date: record.confirm, days: d });
    }

    if (list.length === 0) return null;

    // Sort ascending by days
    list.sort((a, b) => a.days - b.days);
    return list[0];
  },

  /**
   * Merges live Companies House record into a tracker record,
   * applying the proven reconciliation logic.
   */
  chMerged(record, chLiveMap = {}) {
    if (!record.no || !chLiveMap[record.no]) {
      return {
        ...record,
        source: 'Trinova filing tracker (Aug 2026)',
        isLive: false
      };
    }

    const live = chLiveMap[record.no];
    const isDissolved = /dissolved/i.test(live.companyStatus || '');
    const hasStrikeOff = /strike-off/i.test(live.detail || '') || /strike-off/i.test(live.companyStatus || '');
    const accountsOverdue = Boolean(live.accountsOverdue);

    // Build merged note
    let mergedNote = record.note || '';
    if (hasStrikeOff && !mergedNote.includes('strike-off')) {
      mergedNote = `[STRIKE-OFF PROPOSAL ACTIVE] ${mergedNote}`.trim();
    }
    if (accountsOverdue && !mergedNote.includes('OVERDUE')) {
      mergedNote = `[CH: Accounts OVERDUE] ${mergedNote}`.trim();
    }

    return {
      ...record,
      name: live.name || record.name,
      accounts: live.accounts || record.accounts,
      confirm: live.confirm || record.confirm,
      status: live.companyStatus ? `${live.companyStatus} (${record.status})` : record.status,
      note: mergedNote,
      isDissolved,
      hasStrikeOff,
      accountsOverdue,
      source: 'Companies House live · Trinova tracker',
      isLive: true,
      lastChecked: live.checked || new Date().toISOString()
    };
  }
};
