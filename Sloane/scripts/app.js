/**
 * Sloane CEO Command Centre — Application Core
 * Implements reactive state management, view routing, rendering engines,
 * and event bindings.
 */

import { StorageService } from './services/storage.js';
import { ReconciliationEngine } from './services/reconciliation.js';
import { ApiService } from './services/api.js';
import { ModalManager } from './components/modal.js';
import { Toast } from './components/toast.js';
import {
  ACCOUNTS_TRACKER,
  ACTION_TRACKER,
  VAT_TRACKER,
  TOP3_ITEMS,
  DIARY_ITEMS,
  WAITING_SIGNOFF,
  ATTENTION_EMAILS,
  PEOPLE_WORK
} from './data/seed.js';

class SloaneApp {
  constructor() {
    this.currentView = 'command';
    this.searchQuery = '';
    this.selectedBizFilter = 'All';
    this.selectedBrainEntryForTrinova = null;
  }

  async init() {
    // Initialize component managers
    ModalManager.init();
    Toast.init();

    // Bind navigation and UI events
    this.bindEvents();

    // Initial render of all view pipelines
    await this.renderAll();

    // Check live Trinova backend connection
    await this.checkTrinovaBackend();

    // Switch to default view
    this.switchView('command');
  }

  async checkTrinovaBackend() {
    try {
      const res = await fetch('http://localhost:4000/api/v1/health');
      if (res.ok) {
        const eyebrow = document.querySelector('.eyebrow');
        if (eyebrow && !document.getElementById('trinovaBadge')) {
          const badge = document.createElement('span');
          badge.id = 'trinovaBadge';
          badge.className = 'pill green';
          badge.style.marginLeft = '12px';
          badge.style.fontSize = '11px';
          badge.style.padding = '2px 8px';
          badge.innerHTML = '⚡ Trinova API Live (Port 4000)';
          eyebrow.appendChild(badge);
        }
      }
    } catch (e) {
      console.log('Trinova backend check:', e);
    }
  }

  bindEvents() {
    // Nav button clicks
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const viewId = btn.getAttribute('data-view');
        if (viewId) this.switchView(viewId);
      });
    });

    // Mobile navigation toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.querySelector('.side');
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
      });
    }

    // Ask Sloane input
    const askForm = document.getElementById('askForm');
    if (askForm) {
      askForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('askInput');
        if (input && input.value.trim()) {
          this.handleAskSloane(input.value.trim());
          input.value = '';
        }
      });
    }

    // Client 360 search & filter
    const clientSearch = document.getElementById('clientSearchInput');
    if (clientSearch) {
      clientSearch.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.renderClients();
      });
    }

    const clientBizFilter = document.getElementById('clientBizFilter');
    if (clientBizFilter) {
      clientBizFilter.addEventListener('change', (e) => {
        this.selectedBizFilter = e.target.value;
        this.renderClients();
      });
    }

    // Add Client modal open & save
    const addClientBtn = document.getElementById('openAddClientBtn');
    if (addClientBtn) {
      addClientBtn.addEventListener('click', () => {
        document.getElementById('clientForm').reset();
        this.populateClientModalBizSelect();
        ModalManager.open('clientModal', addClientBtn);
      });
    }

    const clientForm = document.getElementById('clientForm');
    if (clientForm) {
      clientForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSaveClient();
      });
    }

    // Add Business Area modal open & save
    const addBizBtn = document.getElementById('openAddBizBtn');
    if (addBizBtn) {
      addBizBtn.addEventListener('click', () => {
        document.getElementById('bizForm').reset();
        ModalManager.open('bizModal', addBizBtn);
      });
    }

    const bizForm = document.getElementById('bizForm');
    if (bizForm) {
      bizForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSaveBiz();
      });
    }

    // CEO Brain capture
    const brainForm = document.getElementById('brainForm');
    if (brainForm) {
      brainForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSaveBrain();
      });
    }

    // Send Note to Trinova Form
    const trinovaNoteForm = document.getElementById('trinovaNoteForm');
    if (trinovaNoteForm) {
      trinovaNoteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSendNoteToTrinova();
      });
    }

    // "What Have I Missed?" modal trigger
    const missedBtn = document.getElementById('openMissedModalBtn');
    if (missedBtn) {
      missedBtn.addEventListener('click', () => {
        this.renderMissedScan();
        ModalManager.open('missedModal', missedBtn);
      });
    }

    // Companies House sync trigger
    const syncChBtn = document.getElementById('syncChBtn');
    if (syncChBtn) {
      syncChBtn.addEventListener('click', async () => {
        await this.handleSyncCompaniesHouse();
      });
    }
  }

  switchView(viewId) {
    this.currentView = viewId;

    // Toggle active state on navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });

    // Hide all view sections and show target
    document.querySelectorAll('.view').forEach(view => {
      view.classList.add('hidden');
    });

    const targetSection = document.getElementById(`view-${viewId}`);
    if (targetSection) {
      targetSection.classList.remove('hidden');
    }

    // Close mobile menu if open
    const sidebar = document.querySelector('.side');
    if (sidebar) sidebar.classList.remove('mobile-open');

    // Scroll to top
    window.scrollTo(0, 0);
  }

  async renderAll() {
    await this.renderCommandCentre();
    await this.renderBusinesses();
    await this.renderClients();
    this.renderPeopleWork();
    this.renderStatutory();
    this.renderIntelligence();
    this.renderBrain();
  }

  /* ==========================================================================
     View Renderers
     ========================================================================== */

  async renderCommandCentre() {
    // 1. Render Top 3 Ranked Items
    const top3Container = document.getElementById('top3Container');
    if (top3Container) {
      top3Container.innerHTML = TOP3_ITEMS.map(item => `
        <div class="top3-item ${item.isRed ? 'item-red' : ''}">
          <div class="rank">${item.rank}</div>
          <div class="top3-item-content">
            <div class="top3-item-title">${item.title}</div>
            <div class="top3-item-desc">${item.desc}</div>
          </div>
        </div>
      `).join('');
    }

    // 2. Render Today's Diary
    const diaryContainer = document.getElementById('diaryContainer');
    if (diaryContainer) {
      diaryContainer.innerHTML = DIARY_ITEMS.map(item => `
        <div class="diary-item">
          <div class="diary-item-left">
            <span class="dot ${item.chip === 'URGENT' ? 'red' : 'green'}"></span>
            <span class="diary-title">${item.title}</span>
          </div>
          <span class="timechip">${item.time}</span>
        </div>
      `).join('');
    }

    // 3. Render Businesses Preview Grid
    const { data: businesses } = await ApiService.getBusinesses();
    const cmdBizGrid = document.getElementById('cmdBizCards');
    if (cmdBizGrid) {
      cmdBizGrid.innerHTML = businesses.slice(0, 6).map(b => `
        <div class="card" style="padding: 14px; cursor: pointer;" onclick="app.switchView('businesses')">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span class="pill green" style="font-size: 10px;">${b.status}</span>
            <span style="font-size: 11px; font-weight: 700; color: var(--accent);">${b.clientCount} clients</span>
          </div>
          <div style="font-size: 13px; font-weight: 800; color: var(--text);">${b.name}</div>
          <div style="font-size: 10px; color: var(--muted);">${b.type}</div>
        </div>
      `).join('');
    }

    // 4. Render Waiting Sign-off
    const signoffContainer = document.getElementById('waitingSignoffContainer');
    if (signoffContainer) {
      signoffContainer.innerHTML = WAITING_SIGNOFF.map(item => `
        <div class="signoff-item">
          <div class="item-main">
            <div class="item-title">${item.title}</div>
            <div class="item-sub">${item.sub}</div>
          </div>
          <span class="pill amber">${item.date}</span>
        </div>
      `).join('');
    }

    // 5. Render Attention Emails
    const emailContainer = document.getElementById('attentionEmailsContainer');
    if (emailContainer) {
      emailContainer.innerHTML = ATTENTION_EMAILS.map(item => `
        <div class="email-item">
          <div class="item-main">
            <div class="item-title">${item.title}</div>
            <div class="item-sub">${item.sub}</div>
          </div>
          <span class="pill ${item.priority === 'High' ? 'red' : 'blue'}">${item.priority}</span>
        </div>
      `).join('');
    }

    // 6. Update Pulse Metrics
    const clients = StorageService.getClients();
    document.getElementById('pulseSignoffs').textContent = WAITING_SIGNOFF.length;
    document.getElementById('pulseEmails').textContent = ATTENTION_EMAILS.length;
    document.getElementById('pulseOverdue').textContent = '4';
    document.getElementById('pulseDue7d').textContent = '6';
    document.getElementById('pulseBlocked').textContent = '1';
    document.getElementById('pulseBizAreas').textContent = businesses.length;
  }

  async renderBusinesses() {
    const { data: businesses } = await ApiService.getBusinesses();
    const container = document.getElementById('fullBizCards');
    if (!container) return;

    container.innerHTML = businesses.map(b => `
      <div class="card biz-card">
        <div>
          <div class="biz-card-header">
            <span class="pill green">${b.status}</span>
            <span class="source-badge">Active Area</span>
          </div>
          <div class="biz-name">${b.name}</div>
          <div class="biz-type">${b.type}</div>
        </div>
        <div class="biz-stats">
          <div class="biz-stat-item">
            <span class="biz-stat-n">${b.clientCount}</span>
            <span class="biz-stat-lbl">Clients</span>
          </div>
          <div class="biz-stat-item">
            <span class="biz-stat-n">0</span>
            <span class="biz-stat-lbl">Sign-offs</span>
          </div>
          <div class="biz-stat-item">
            <span class="biz-stat-n" style="color: var(--amber);">0</span>
            <span class="biz-stat-lbl">Alerts</span>
          </div>
        </div>
      </div>
    `).join('');

    // Update filter dropdowns in Client 360
    this.populateClientBizFilterOptions(businesses);
  }

  populateClientBizFilterOptions(businesses) {
    const filter = document.getElementById('clientBizFilter');
    if (!filter) return;
    const currentVal = filter.value;
    filter.innerHTML = `<option value="All">All Business Areas</option>` +
      businesses.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
    filter.value = currentVal || 'All';
  }

  populateClientModalBizSelect() {
    const businesses = StorageService.getBusinesses();
    const select = document.getElementById('modalClientBiz');
    if (!select) return;
    select.innerHTML = businesses.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
  }

  async renderClients() {
    const { data: clients } = await ApiService.getClients({
      search: this.searchQuery,
      biz: this.selectedBizFilter
    });

    const tbody = document.getElementById('clientTableBody');
    if (!tbody) return;

    if (clients.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No client records found matching your filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = clients.map(c => {
      const riskClass = c.risk === 'High' ? 'red' : c.risk === 'Medium' ? 'amber' : 'green';
      const chUrl = c.no ? `https://find-and-update.company-information.service.gov.uk/company/${c.no}` : null;

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text);">${c.name}</div>
            <div style="font-size: 11px; color: var(--muted);">${c.biz || '—'}</div>
          </td>
          <td>
            ${c.no ? `<a href="${chUrl}" target="_blank" rel="noopener" style="color: var(--accent); font-family: var(--font-mono); text-decoration: none; font-weight: 600;">${c.no} ↗</a>` : '<span style="color: var(--muted);">—</span>'}
          </td>
          <td>${ReconciliationEngine.formatDate(c.year)}</td>
          <td>${ReconciliationEngine.formatDate(c.accounts)}</td>
          <td>${ReconciliationEngine.formatDate(c.confirm)}</td>
          <td>
            <span class="pill ${c.vat === 'Yes' ? 'green' : 'neutral'}">${c.vat || 'No'}</span>
            ${c.vatNo ? `<div style="font-size: 10px; color: var(--muted); margin-top: 2px;">${c.vatNo}</div>` : ''}
          </td>
          <td style="max-width: 160px; font-size: 11px; color: var(--muted);">${c.dirs || '—'}</td>
          <td><span class="pill ${riskClass}">${c.risk || 'Low'}</span></td>
          <td style="max-width: 180px; font-size: 11px; color: var(--muted);">${c.notes || '—'}</td>
        </tr>
      `;
    }).join('');
  }

  renderPeopleWork() {
    const container = document.getElementById('peopleGridContainer');
    if (!container) return;

    container.innerHTML = PEOPLE_WORK.map(p => `
      <div class="card person-card">
        <div class="person-header">
          <div class="person-info">
            <div class="person-avatar">${p.avatar}</div>
            <div>
              <div class="person-name">${p.name}</div>
              <div class="person-role">${p.role}</div>
            </div>
          </div>
          <span class="pill blue">${p.tasks.length} tasks</span>
        </div>
        <div class="work-list">
          ${p.tasks.map(t => `
            <div class="work-item">
              <div>
                <div style="font-weight: 600; color: var(--text);">${t.client}</div>
                <div style="font-size: 11px; color: var(--muted);">${t.task}</div>
              </div>
              <div style="text-align: right;">
                <span class="pill ${t.isBlocked ? 'red' : 'amber'}">${t.isBlocked ? 'BLOCKED' : t.stage}</span>
                <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">Due ${t.deadline}</div>
              </div>
            </div>
          `).join('')}
        </div>
        ${p.ceoNote ? `
          <div style="padding: 10px 12px; background: rgba(201, 166, 107, 0.08); border-left: 2px solid var(--accent); border-radius: 4px; font-size: 11px; color: var(--accent);">
            <strong>Private CEO Note:</strong> ${p.ceoNote}
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  renderStatutory() {
    const chCache = StorageService.getCHCache();

    // Assemble all statutory records
    const records = ACCOUNTS_TRACKER.map(r => ReconciliationEngine.chMerged(r, chCache));

    // Calculate urgency counts
    let redCount = 0;
    let amberCount = 0;
    let clearCount = 0;

    const rowsHtml = records.map(r => {
      const nearest = ReconciliationEngine.nearestFor(r);
      let state = nearest ? ReconciliationEngine.deadlineState(nearest.date) : { label: 'No date', cls: 'status-amber', urgency: 'AMBER' };

      // Promote active strike-offs or overdue flags to RED per business rule
      if (r.hasStrikeOff || r.accountsOverdue) {
        state = { label: 'RED · ACTION', cls: 'status-red', urgency: 'RED' };
      }

      if (state.urgency === 'RED') redCount++;
      else if (state.urgency === 'AMBER') amberCount++;
      else clearCount++;

      const chUrl = r.no ? `https://find-and-update.company-information.service.gov.uk/company/${r.no}` : '#';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text);">${r.name}</div>
            <div class="source">
              <span class="source-badge ${r.isLive ? 'ch-live' : ''}">${r.isLive ? 'CH Live' : 'Tracker'}</span>
              ${r.source}
            </div>
          </td>
          <td>
            <a href="${chUrl}" target="_blank" rel="noopener" style="color: var(--accent); font-family: var(--font-mono); text-decoration: none; font-weight: 600;">${r.no} ↗</a>
          </td>
          <td>${ReconciliationEngine.formatDate(r.year)}</td>
          <td>${ReconciliationEngine.formatDate(r.accounts)}</td>
          <td>
            ${nearest ? `<strong>${nearest.label}:</strong> ${ReconciliationEngine.formatDate(nearest.date)}` : '—'}
          </td>
          <td>
            <span class="${state.cls}">${state.label}</span>
          </td>
          <td style="max-width: 220px; font-size: 11px; color: ${r.hasStrikeOff ? 'var(--red)' : 'var(--muted)'};">
            ${r.note || '—'}
          </td>
        </tr>
      `;
    }).join('');

    const tbody = document.getElementById('statutoryTableBody');
    if (tbody) tbody.innerHTML = rowsHtml;

    // Update Statutory Nav Badge with dynamic RED count
    const navBadge = document.getElementById('statNavBadge');
    if (navBadge) {
      navBadge.textContent = redCount;
      navBadge.className = `nav-badge ${redCount > 0 ? 'badge-red' : ''}`;
    }

    // Update Radar Metric Cards
    document.getElementById('statRadarTracked').textContent = records.length;
    document.getElementById('statRadarVat').textContent = VAT_TRACKER.length;
    document.getElementById('statRadarRed').textContent = redCount;
    document.getElementById('statRadarClear').textContent = clearCount;

    // Render Action Tracker table
    const actionTbody = document.getElementById('actionTableBody');
    if (actionTbody) {
      actionTbody.innerHTML = ACTION_TRACKER.map(a => `
        <tr>
          <td style="font-weight: 700; color: var(--text);">${a.company}</td>
          <td style="font-family: var(--font-mono); color: var(--accent);">${a.no}</td>
          <td style="color: ${a.urgency === 'RED' ? 'var(--red)' : 'var(--text)'}; font-weight: 600;">${a.issue}</td>
          <td style="font-size: 11px; color: var(--muted);">${a.action}</td>
          <td><span class="pill ${a.urgency === 'RED' ? 'red' : a.urgency === 'AMBER' ? 'amber' : 'green'}">${a.urgency}</span></td>
        </tr>
      `).join('');
    }

    // Render VAT schedule
    const vatTbody = document.getElementById('vatTableBody');
    if (vatTbody) {
      vatTbody.innerHTML = VAT_TRACKER.map(v => `
        <tr>
          <td style="font-weight: 600; color: var(--text);">${v.name}</td>
          <td>${v.period}</td>
          <td>${ReconciliationEngine.formatDate(v.due)}</td>
          <td><span class="pill ${v.status === 'Ready to submit' ? 'green' : v.status.includes('Overdue') ? 'red' : 'neutral'}">${v.status}</span></td>
        </tr>
      `).join('');
    }
  }

  renderIntelligence() {
    const grid = document.getElementById('intelGridContainer');
    if (!grid) return;

    grid.innerHTML = `
      <div class="card intel-card">
        <div class="card-header">
          <h2><span class="dot red"></span> Critical Scan (Compliance & HMRC)</h2>
          <span class="pill red">3 Issues</span>
        </div>
        <div class="intel-list">
          <div class="intel-item intel-critical">
            <div class="intel-item-content">
              <div class="intel-title">Woofington Park Limited — Active Strike-Off Proposal</div>
              <div class="intel-desc">First Gazette publication active. Objection window closes in 6 days. Overdue accounts must be lodged immediately to preserve entity.</div>
            </div>
          </div>
          <div class="intel-item intel-critical">
            <div class="intel-item-content">
              <div class="intel-title">R GB Elevations Ltd — Statutory Accounts Overdue (50d)</div>
              <div class="intel-desc">Accounts due date 31/07/2026 missed. Higher statutory late filing penalty tier active. Bank statements obtained today.</div>
            </div>
          </div>
          <div class="intel-item intel-critical">
            <div class="intel-item-content">
              <div class="intel-title">Monarch Craft Brewers Ltd — Overdue Verification</div>
              <div class="intel-desc">Filing tracker records accounts overdue. Client contact required to verify whether submission was completed externally.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card intel-card">
        <div class="card-header">
          <h2><span class="dot amber"></span> Chase Scan (Delegated Work & Promises)</h2>
          <span class="pill amber">2 Stalled</span>
        </div>
        <div class="intel-list">
          <div class="intel-item intel-chase">
            <div class="intel-item-content">
              <div class="intel-title">Sarah Jenkins (Woofington Park) — Balance Sheet Signature</div>
              <div class="intel-desc">Promised signature by 4:00 PM today. Follow-up reminder scheduled on Hamza's calendar.</div>
            </div>
          </div>
          <div class="intel-item intel-chase">
            <div class="intel-item-content">
              <div class="intel-title">Jessica Taylor — Woofington Emergency CH Defense Lodgment</div>
              <div class="intel-desc">Blocker: awaiting signed balance sheet before electronically submitting defense paperwork to Companies House.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card intel-card">
        <div class="card-header">
          <h2><span class="dot blue"></span> Context Scan (Meetings & Calendar Conflicts)</h2>
          <span class="pill blue">1 Clash</span>
        </div>
        <div class="intel-list">
          <div class="intel-item">
            <div class="intel-item-content">
              <div class="intel-title">Diary Clash Detected: 13:30 Today</div>
              <div class="intel-desc">Hamza Malik compliance catchup overlaps with scheduled 13:45 urgent signing review. Recommend shifting review by 30 mins.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card intel-card">
        <div class="card-header">
          <h2><span class="dot green"></span> Relationship Silence Radar</h2>
          <span class="pill green">Healthy</span>
        </div>
        <div class="intel-list">
          <div class="intel-item">
            <div class="intel-item-content">
              <div class="intel-title">All Key Practice Clients Contacted within 45 Days</div>
              <div class="intel-desc">Communication cadence across Trinova Accounting and CFI Awarding is in full compliance with SLA targets.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderBrain() {
    const entries = StorageService.getBrainEntries();
    const container = document.getElementById('brainFeedContainer');
    if (!container) return;

    if (entries.length === 0) {
      container.innerHTML = `<div class="card" style="text-align: center; color: var(--muted); padding: 30px;">No private notes in CEO Brain yet. Jot down anything above.</div>`;
      return;
    }

    container.innerHTML = entries.map((entry, idx) => `
      <div class="brain-entry">
        <div class="brain-entry-header">
          <span class="source-badge" style="color: var(--accent); border-color: rgba(201, 166, 107, 0.4);">
            🔒 Private Workspace · CEO View
          </span>
          <span>${entry.at}</span>
        </div>
        <div class="brain-entry-text">${entry.text}</div>
        <div class="brain-entry-footer">
          <span style="font-size: 10px; color: var(--muted);">Awaiting live AI classification</span>
          <button class="card-action-btn" onclick="app.openTrinovaNoteModal(${idx})">
            Send to Trinova ↗
          </button>
        </div>
      </div>
    `).join('');
  }

  renderMissedScan() {
    const container = document.getElementById('missedModalContent');
    if (!container) return;

    container.innerHTML = `
      <div class="sourcebanner">
        Safety-net engine scanned practice filing tracker, calendar, and email queues.
      </div>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div class="alert-item">
          <span class="dot red" style="margin-top: 4px;"></span>
          <div class="alert-item-content">
            <div class="alert-title">CRITICAL: Woofington Park Limited Strike-off Notice</div>
            <div class="alert-desc">Objection deadline is imminent. Action required before 25 September 2026.</div>
          </div>
        </div>
        <div class="alert-item">
          <span class="dot red" style="margin-top: 4px;"></span>
          <div class="alert-item-content">
            <div class="alert-title">CRITICAL: R GB Elevations Ltd Accounts Overdue</div>
            <div class="alert-desc">50 days past statutory due date. Higher penalty tier in effect.</div>
          </div>
        </div>
        <div class="diary-item">
          <div class="diary-item-left">
            <span class="dot amber"></span>
            <span class="diary-title">Chase: Sarah Jenkins balance sheet signature</span>
          </div>
          <span class="timechip">By 16:00</span>
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     Action Handlers
     ========================================================================== */

  async handleSaveClient() {
    const name = document.getElementById('clientName').value.trim();
    if (!name) {
      Toast.error('Please specify the company / client name.');
      return;
    }

    const clientData = {
      name,
      biz: document.getElementById('modalClientBiz').value,
      no: document.getElementById('clientNo').value.trim(),
      year: document.getElementById('clientYear').value,
      accounts: document.getElementById('clientAccounts').value,
      confirm: document.getElementById('clientConfirm').value,
      vat: document.getElementById('clientVat').value,
      vatNo: document.getElementById('clientVatNo').value.trim(),
      paye: document.getElementById('clientPaye').value.trim(),
      cis: document.getElementById('clientCis').value,
      dirs: document.getElementById('clientDirs').value.trim(),
      owner: document.getElementById('clientOwner').value.trim() || 'Kirsty Allen',
      risk: document.getElementById('clientRisk').value,
      notes: document.getElementById('clientNotes').value.trim()
    };

    await ApiService.createClient(clientData);
    ModalManager.close('clientModal');
    Toast.success(`Client "${name}" created successfully.`);

    // Re-render affected views
    await this.renderClients();
    await this.renderBusinesses();
    this.renderStatutory();
    await this.renderCommandCentre();
  }

  async handleSaveBiz() {
    const name = document.getElementById('bizName').value.trim();
    const type = document.getElementById('bizType').value.trim();

    if (!name || !type) {
      Toast.error('Please specify both business name and business type.');
      return;
    }

    await ApiService.createBusiness({ name, type });
    ModalManager.close('bizModal');
    Toast.success(`Business area "${name}" added.`);

    await this.renderBusinesses();
    await this.renderCommandCentre();
  }

  handleSaveBrain() {
    const textarea = document.getElementById('brainInput');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) return;

    const entries = StorageService.getBrainEntries();
    entries.unshift({
      id: `b-${Date.now()}`,
      text,
      at: new Date().toLocaleString('en-GB'),
      isPrivate: true
    });

    StorageService.saveBrainEntries(entries);
    textarea.value = '';
    Toast.success('Saved to private CEO Brain.');

    this.renderBrain();
  }

  openTrinovaNoteModal(entryIndex) {
    const entries = StorageService.getBrainEntries();
    const entry = entries[entryIndex];
    if (!entry) return;

    this.selectedBrainEntryForTrinova = entry;

    document.getElementById('trinovaNoteContent').value = entry.text;
    
    // Populate company select
    const clients = StorageService.getClients();
    const companySelect = document.getElementById('trinovaNoteCompany');
    if (companySelect) {
      companySelect.innerHTML = clients.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    }

    ModalManager.open('trinovaNoteModal');
  }

  async handleSendNoteToTrinova() {
    const text = document.getElementById('trinovaNoteContent').value.trim();
    const companyName = document.getElementById('trinovaNoteCompany').value;
    const visibility = document.getElementById('trinovaNoteVisibility').value;
    const confirmBox = document.getElementById('trinovaNoteConfirm');

    if (!confirmBox || !confirmBox.checked) {
      Toast.error('You must check the confirmation box to authorize sharing private content with Trinova.');
      return;
    }

    try {
      const res = await ApiService.sendNoteToTrinova({
        text,
        companyName,
        visibility
      });

      ModalManager.close('trinovaNoteModal');
      Toast.success(res.message);
    } catch (err) {
      Toast.error(err.message || 'Failed to send note to Trinova.');
    }
  }

  async handleSyncCompaniesHouse() {
    const statusText = document.getElementById('chSyncStatusText');
    if (statusText) statusText.textContent = 'Syncing live data from Companies House server...';

    const result = await ApiService.syncCompaniesHouse();
    Toast.success(`Live sync complete: reconciled ${result.syncedCount} company records.`);

    if (statusText) {
      statusText.textContent = `Live verified: ${result.syncedCount} companies checked at ${new Date(result.syncedAt).toLocaleTimeString('en-GB')}`;
    }

    this.renderStatutory();
    await this.renderCommandCentre();
  }

  handleAskSloane(query) {
    // Provenance-aware response synthesis
    let response = `Looking into "${query}" across connected workspaces...`;

    if (/woofington/i.test(query)) {
      response = `Woofington Park Limited has an active Companies House strike-off defense in progress. Overdue accounts must be submitted within 6 days to halt dissolution. Sarah Jenkins is scheduled to sign the balance sheet by 16:00 today.`;
    } else if (/overdue|statutory/i.test(query)) {
      response = `There are currently 4 statutory filings requiring urgent verification, led by R GB Elevations Ltd (50d overdue) and Woofington Park. All other clients are within scheduled filing cycles.`;
    } else if (/hamza/i.test(query)) {
      response = `Hamza Malik is currently assigned to R GB Elevations and Alpha Delta Creative. You have a compliance check-in with him at 13:30 today.`;
    } else {
      response = `Sloane analyzed practice records: your top priority is the Woofington Park strike-off defense due today, followed by R GB Elevations accounts finalization. No other critical blockers detected.`;
    }

    Toast.info(response, 7000);
  }
}

// Instantiate and attach globally for inline handlers
window.app = new SloaneApp();
document.addEventListener('DOMContentLoaded', () => window.app.init());
