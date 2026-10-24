/**
 * Sloane CEO Command Centre — Application Core
 * Implements reactive state management, view routing, rendering engines,
 * and event bindings.
 */

import { StorageService } from './services/storage.js';
import { ReconciliationEngine } from './services/reconciliation.js';
import { ApiService } from './services/api.js';
import { AuthService } from './services/auth.js';
import { ModalManager } from './components/modal.js';
import { Toast } from './components/toast.js';
import { OutlookSettings } from './components/outlookSettings.js';
import { FormModal, ConfirmDialog } from './components/formModal.js';
import { escapeHtml, sanitizeId } from './utils/html.js';
import { teamTaskMethods, TEAM_TASK_ACTIONS } from './features/teamTasks.js';
import { deadlineMethods, DEADLINE_ACTIONS } from './features/deadlines.js';
import { clientDetailMethods, CLIENT_DETAIL_ACTIONS } from './features/clientDetail.js';
import { privateNoteMethods, PRIVATE_NOTE_ACTIONS } from './features/privateNotes.js';

// Task P7.3: All demo arrays (DIARY_ITEMS, ATTENTION_EMAILS, TOP3_ITEMS, WAITING_SIGNOFF,
// PEOPLE_WORK, ACCOUNTS_TRACKER, ACTION_TRACKER, VAT_TRACKER) removed from UI path.
// All data is dynamically queried from authenticated /api/v1 endpoints.

// escapeHtml and sanitizeId live in ./utils/html.js (they are re-exported here for older callers).
export { escapeHtml, sanitizeId };

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.sanitizeId = sanitizeId;
}

/** Everyday words for the labels on a client's history. */
const HISTORY_KIND = {
  CLIENT_CREATED: 'Client added', CLIENT_UPDATED: 'Client changed', TASK_CREATED: 'Task added',
  TASK_COMPLETED: 'Task finished', TASK_REASSIGNED: 'Task given to someone else', NOTE_CREATED: 'Note',
  NOTE_UPDATED: 'Note changed', DOCUMENT_UPLOADED: 'Document added', DOCUMENT_SIGNED: 'Document signed',
  EMAIL_RECEIVED: 'Email received', EMAIL_SENT: 'Email sent', STATUTORY_DEADLINE: 'Official deadline',
  STATUTORY_STATUS_CHANGED: 'Filing status changed', VAT_DEADLINE: 'VAT date', VAT_RETURN_FILED: 'VAT return filed',
  COMPANIES_HOUSE_SYNC: 'Checked with Companies House', COMPANIES_HOUSE_STATUS_CHANGED: 'Companies House change',
  RISK_CHANGED: 'Risk level changed', CEO_NOTE_CREATED: 'My private note', AI_INSIGHT_GENERATED: 'Sloane\'s suggestion'
};
const HISTORY_SOURCE = {
  user: 'Written by you', system: 'Added by Sloane', companies_house: 'From Companies House', trinova: 'Note',
  outlook: 'From Outlook', document: 'Documents', task: 'Tasks', ai: 'Sloane\'s AI'
};
const HISTORY_IMPORTANCE = { critical: 'Very important', urgent: 'Urgent', warning: 'Worth watching', info: 'For information', normal: 'Normal' };

class SloaneApp {
  constructor() {
    this.currentView = 'command';
    this.searchQuery = '';
    this.selectedBizFilter = 'All';
    this.selectedBrainEntryForTrinova = null;
    this.activeClient360Id = null;
    this.activeClientTab = 'overview';
    this.timelineEvents = [];
    this.timelineEventTypeFilter = '';
    this.timelineSeverityFilter = '';
    this.aiConversationHistory = [];
    this.cachedDiaryEvents = [];
    this.authEventsBound = false;
    this.appEventsBound = false;
    this.teamMembers = null;
    this.allTasks = [];
    this.lastClients = [];
    this.showFinishedTasks = false;
    this.actionNames = new Set([
      ...TEAM_TASK_ACTIONS, ...DEADLINE_ACTIONS, ...CLIENT_DETAIL_ACTIONS, ...PRIVATE_NOTE_ACTIONS,
      'markTaskDone', 'openEditClient', 'openEditBiz', 'deleteBiz', 'deleteClient', 'selectClient360'
    ]);
    this.changeNames = new Set([
      'reassignTask', 'changeTaskStatusFromList', 'changeVatStatus', 'selectClientInTab'
    ]);
  }

  async refreshOutlookData() {
    await this.renderCommandCentre();
    this.renderIntelligence();
  }

  /** Shows which version of Sloane is running (sidebar and sign-in page), so updates can be checked. */
  async showVersion() {
    try {
      const res = await fetch('/api/v1/health', { credentials: 'same-origin' });
      const info = (await res.json()) || {};
      const data = info.data || info;
      if (!data.version) return;
      const text = `v${data.version}${data.build ? ` · ${data.build}` : ''}`;
      const longText = `Sloane version ${data.version}${data.build ? `, build ${data.build} (the commit that is running)` : ''}`;
      for (const id of ['appVersion', 'authVersion']) {
        const el = document.getElementById(id);
        if (el) { el.textContent = text; el.title = longText; }
      }
    } catch (_) {
      // The version label is a nicety: Sloane works without it.
    }
  }

  async init() {
    this.showVersion();

    // Initialize component managers
    ModalManager.init();
    Toast.init();
    OutlookSettings.init();

    // Bind authentication UI events
    this.bindAuthEvents();

    // Verify session strictly with the backend server
    const isSessionValid = await AuthService.verifySession();
    if (!isSessionValid) {
      this.showLoginView();
      return;
    }

    this.showAppView();

    // Bind navigation and UI events
    if (!this.appEventsBound) {
      this.bindEvents();
      this.appEventsBound = true;
    }

    // Synchronize active AI provider selector
    this.syncProviderDropdowns();

    // Initial render of all view pipelines
    await this.renderAll();

    // Check live Trinova backend connection
    await this.checkTrinovaBackend();

    // Switch to initial view (check for Outlook connect/error param)
    if (typeof window !== 'undefined' && window.location && window.location.search && (window.location.search.includes('outlook=') || window.location.search.includes('outlook_error='))) {
      OutlookSettings.checkUrlParams();
    } else {
      this.switchView('command');
    }
  }

  showLoginView() {
    const authShell = document.getElementById('authShell');
    const appShell = document.querySelector('.shell');
    const mobileNav = document.getElementById('mobileNavBar');

    if (authShell) authShell.classList.remove('auth-hidden');
    if (appShell) appShell.style.display = 'none';
    if (mobileNav) mobileNav.style.display = 'none';
    this.closeNavDrawer();

    document.body.classList.remove('session-check');

    const emailInput = document.getElementById('loginEmail');
    const passInput = document.getElementById('loginPassword');
    if (emailInput) {
      emailInput.value = AuthService.getRememberedEmail();
      if (!emailInput.value) {
        setTimeout(() => emailInput.focus(), 120);
      } else if (passInput) {
        setTimeout(() => passInput.focus(), 120);
      }
    }
  }

  showAppView() {
    const authShell = document.getElementById('authShell');
    const appShell = document.querySelector('.shell');
    const mobileNav = document.getElementById('mobileNavBar');

    if (authShell) authShell.classList.add('auth-hidden');
    if (appShell) appShell.style.display = 'grid';
    if (mobileNav) mobileNav.style.display = 'flex';
    document.body.classList.remove('session-check');

    // Update profile display with active authenticated user
    const user = AuthService.getUser();
    const avatarEls = document.querySelectorAll('#sidebarAvatar, .avatar');
    avatarEls.forEach(el => { el.textContent = user.avatar || 'KA'; });

    const nameEls = document.querySelectorAll('#sidebarUserName, .profile-name');
    nameEls.forEach(el => { el.textContent = user.name || 'Kirsty Allen'; });

    const greetingEl = document.querySelector('.greeting-block h1');
    if (greetingEl) {
      const firstName = (user.name || 'Kirsty').split(' ')[0];
      const hour = new Date().getHours();
      const timeOfDay = hour < 12 ? 'morning' : (hour < 18 ? 'afternoon' : 'evening');
      greetingEl.textContent = `Good ${timeOfDay}, ${firstName}`;
    }
  }

  bindAuthEvents() {
    if (this.authEventsBound) return;
    this.authEventsBound = true;

    // Login Form Submit
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    // Password Visibility Toggle
    const togglePassBtn = document.getElementById('btnTogglePassword');
    const passInput = document.getElementById('loginPassword');
    if (togglePassBtn && passInput) {
      togglePassBtn.addEventListener('click', () => {
        const isPassword = passInput.type === 'password';
        passInput.type = isPassword ? 'text' : 'password';
        togglePassBtn.classList.toggle('is-visible', isPassword);
        togglePassBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
      });
    }

    // Reset PIN Info
    const forgotLink = document.getElementById('authForgotLink');
    if (forgotLink) {
      forgotLink.addEventListener('click', () => {
        Toast.info('Please ask your Sloane administrator to reset your password.', 6000);
      });
    }

    // Lock session buttons
    const lockSidebarBtn = document.getElementById('sidebarLockBtn');
    if (lockSidebarBtn) {
      lockSidebarBtn.addEventListener('click', () => this.handleLogout());
    }

    const lockHeaderBtn = document.getElementById('headerLockBtn');
    if (lockHeaderBtn) {
      lockHeaderBtn.addEventListener('click', () => this.handleLogout());
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail')?.value;
    const password = document.getElementById('loginPassword')?.value;
    const remember = document.getElementById('loginRemember')?.checked ?? true;
    const submitBtn = document.getElementById('btnLoginSubmit');
    const alertEl = document.getElementById('authAlert');
    const alertMsg = document.getElementById('authAlertMsg');

    if (alertEl) alertEl.classList.remove('visible');
    if (submitBtn) {
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;
    }

    try {
      const session = await AuthService.login({ email, password, remember });
      
      Toast.success(`Welcome back, ${session.user.name}.`);
      
      this.showAppView();
      
      if (!this.appEventsBound) {
        this.bindEvents();
        this.appEventsBound = true;
      }

      await this.renderAll();
      await this.checkTrinovaBackend();
      if (typeof window !== 'undefined' && window.location && /[?&]outlook(_error)?=/.test(window.location.search || '')) {
        OutlookSettings.checkUrlParams();
      } else {
        this.switchView('command');
      }

      const passInput = document.getElementById('loginPassword');
      if (passInput) passInput.value = '';

    } catch (err) {
      if (alertEl && alertMsg) {
        alertMsg.textContent = err.message || 'Authentication failed. Please verify credentials.';
        alertEl.classList.add('visible');
      } else {
        Toast.error(err.message || 'Authentication failed.');
      }
      const passInput = document.getElementById('loginPassword');
      if (passInput) {
        passInput.focus();
        passInput.select();
      }
    } finally {
      if (submitBtn) {
        submitBtn.classList.remove('is-loading');
        submitBtn.disabled = false;
      }
    }
  }

  handleLogout() {
    AuthService.logout();
    Toast.info('You have been signed out.');
    this.showLoginView();
  }

  /**
   * The pill at the top says whether Sloane can really read TriNova (not just whether Sloane's own
   * server is awake). status: 'ok' | 'not_configured' | 'unreachable' | 'checking' | 'server_down'
   */
  applyTrinovaPill(status) {
    const statusBtn = document.getElementById('trinovaStatusBtn');
    const statusDot = document.getElementById('trinovaStatusDot');
    const statusText = document.getElementById('trinovaStatusText');
    const look = {
      ok: ['green', 'var(--green)', '⚡ TriNova: Connected', 'Sloane is reading your clients from TriNova. Click for details.'],
      not_configured: ['neutral', 'var(--muted)', 'TriNova: Not set up', 'Sloane has not been given TriNova\'s access key yet, so it cannot show your TriNova clients. Click for details.'],
      unreachable: ['neutral', 'var(--amber)', 'TriNova: Cannot reach', 'Sloane could not reach TriNova just now. Click for details.'],
      checking: ['neutral', 'var(--amber)', 'TriNova: Checking...', 'Sloane is checking the connection to TriNova.'],
      server_down: ['neutral', 'var(--red)', 'Sloane: Not responding', 'Sloane\'s own server is not answering. Please try again in a minute.']
    }[status] || ['neutral', 'var(--muted)', 'TriNova: Unknown', ''];
    if (statusBtn) { statusBtn.className = `pill ${look[0]}`; statusBtn.title = look[3]; }
    if (statusDot) statusDot.style.background = look[1];
    if (statusText) statusText.textContent = look[2];
    this.trinovaPillStatus = status;
  }

  async checkTrinovaBackend() {
    if (!this.trinovaStatus) this.applyTrinovaPill('checking');

    let health = { ok: false };
    try {
      health = await ApiService.checkHealth();
    } catch (e) {
      console.log('Sloane server check failed:', e);
    }
    if (!health.ok) {
      this.applyTrinovaPill('server_down');
      this.updateConfigModalTelemetry({ ok: false, error: 'Cannot connect' }, { ok: false });
      this.logToTrinovaConsole('[Connection] Sloane\'s server is not answering.');
      return false;
    }

    const auth = await ApiService.verifyAuth();
    this.updateConfigModalTelemetry(health, auth);

    // What the Clients page last heard from TriNova is the truth; otherwise ask the server.
    let status = this.trinovaStatus;
    if (!status) {
      const sys = await ApiService.getSystemStatus();
      status = sys.data ? (sys.data.trinova.configured ? 'checking' : 'not_configured') : 'checking';
    }
    this.applyTrinovaPill(status);
    this.logToTrinovaConsole(`[Connection] Sloane's server answered in ${health.durationMs || 0} ms. TriNova: ${status}.`);
    return true;
  }

  updateConfigModalTelemetry(health, auth) {
    const dot = document.getElementById('modalTrinovaStatusDot');
    const title = document.getElementById('modalTrinovaStatusTitle');
    const latency = document.getElementById('modalTrinovaLatency');
    const env = document.getElementById('modalTargetEnv');
    const db = document.getElementById('modalDbStatus');
    const actor = document.getElementById('modalActor');

    if (health && health.ok) {
      if (dot) dot.style.background = 'var(--green)';
      if (title) {
        title.textContent = 'Sloane\'s server is working';
        title.style.color = 'var(--green)';
      }
      if (latency) latency.textContent = `${health.durationMs || 0} ms`;
      if (db) {
        db.textContent = health.database || 'Connected';
        db.style.color = 'var(--green)';
      }
      if (actor) {
        actor.textContent = auth?.actor || 'You';
        actor.title = auth?.scopes ? `Scopes: ${auth.scopes.join(', ')}` : '';
      }
    } else {
      if (dot) dot.style.background = 'var(--amber)';
      if (title) {
        title.textContent = 'Sloane\'s server is not answering';
        title.style.color = 'var(--amber)';
      }
      if (latency) latency.textContent = 'Offline';
      if (db) {
        db.textContent = 'Local Cache';
        db.style.color = 'var(--muted)';
      }
      if (actor) actor.textContent = 'Local Guest';
    }

    if (env) {
      const url = ApiService.config.baseUrl;
      env.textContent = 'This Sloane server';
    }
  }

  logToTrinovaConsole(msg) {
    const consoleEl = document.getElementById('trinovaConsoleOutput');
    if (!consoleEl) return;
    const time = new Date().toLocaleTimeString('en-GB');
    consoleEl.textContent = `[${time}] ${msg}\n` + consoleEl.textContent;
  }

  bindEvents() {
    // Nav button clicks
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const viewId = btn.getAttribute('data-view');
        if (viewId) this.switchView(viewId);
        // The menu always opens the list of clients, not the last client's tab
        if (viewId === 'clients') this.switchClientTab('overview');
      });
    });

    // Mobile / Tablet Navigation Drawer Controller
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const drawerCloseBtn = document.getElementById('drawerCloseBtn');
    const drawerBackdrop = document.getElementById('drawerBackdrop');
    const sidebar = document.querySelector('.side');

    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sidebar && sidebar.classList.contains('mobile-open');
        if (isOpen) {
          this.closeNavDrawer();
        } else {
          this.openNavDrawer();
        }
      });
    }

    if (drawerCloseBtn) {
      drawerCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeNavDrawer();
        if (mobileMenuBtn) mobileMenuBtn.focus();
      });
    }

    if (drawerBackdrop) {
      drawerBackdrop.addEventListener('click', () => {
        this.closeNavDrawer();
      });
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar && sidebar.classList.contains('mobile-open')) {
        this.closeNavDrawer();
        if (mobileMenuBtn) mobileMenuBtn.focus();
      }
    });

    // Close drawer when viewport expands past 1100px
    window.addEventListener('resize', () => {
      if (window.innerWidth > 1100 && sidebar && sidebar.classList.contains('mobile-open')) {
        this.closeNavDrawer();
      }
    });

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

    // Ask Sloane modal reply form (enables ongoing dialogue inside modal)
    const aiModalReplyForm = document.getElementById('aiModalReplyForm');
    if (aiModalReplyForm) {
      aiModalReplyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('aiModalReplyInput');
        if (input && input.value.trim()) {
          const replyText = input.value.trim();
          input.value = '';
          this.handleAskSloane(replyText, true);
        }
      });
    }

    // Ask Sloane quick suggestion prompt pills
    document.querySelectorAll('.ask-pill-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        const input = document.getElementById('askInput');
        if (input) input.value = prompt;
        this.handleAskSloane(prompt);
      });
    });

    // Client 360 sub-navigation tabs
    document.querySelectorAll('.client-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-client-tab');
        this.switchClientTab(tab);
      });
    });

    // Timeline client select dropdown
    const tlClientSelect = document.getElementById('timelineClientSelect');
    if (tlClientSelect) {
      tlClientSelect.addEventListener('change', (e) => {
        this.activeClient360Id = e.target.value;
        this.renderTimeline(this.activeClient360Id);
      });
    }

    // Timeline filters
    const tlTypeFilter = document.getElementById('timelineEventTypeFilter');
    if (tlTypeFilter) {
      tlTypeFilter.addEventListener('change', (e) => {
        this.timelineEventTypeFilter = e.target.value;
        this.renderTimeline(this.activeClient360Id);
      });
    }

    const tlSevFilter = document.getElementById('timelineSeverityFilter');
    if (tlSevFilter) {
      tlSevFilter.addEventListener('change', (e) => {
        this.timelineSeverityFilter = e.target.value;
        this.renderTimeline(this.activeClient360Id);
      });
    }

    // Refresh timeline button
    const btnRefreshTimeline = document.getElementById('btnRefreshTimeline');
    if (btnRefreshTimeline) {
      btnRefreshTimeline.addEventListener('click', () => {
        this.renderTimeline(this.activeClient360Id, true);
      });
    }

    // Open log timeline event modal
    const btnOpenLogEvent = document.getElementById('btnOpenLogTimelineEvent');
    if (btnOpenLogEvent) {
      btnOpenLogEvent.addEventListener('click', () => {
        const select = document.getElementById('modalTimelineClientId');
        if (select) select.value = this.activeClient360Id;
        ModalManager.open('logTimelineEventModal', btnOpenLogEvent);
      });
    }

    // Submit log timeline event form
    const logEventForm = document.getElementById('logTimelineEventForm');
    if (logEventForm) {
      logEventForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleLogTimelineEvent();
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

    // Buttons and drop-downs drawn by the pages use data-action / data-change instead of inline code.
    // The click handler runs first (capture) so a button inside a clickable table row only does its own job.
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!el) return;
      const name = el.getAttribute('data-action');
      if (!this.actionNames.has(name) || typeof this[name] !== 'function') return;
      e.preventDefault();
      e.stopPropagation();
      Promise.resolve(this[name](el.dataset.id, el, el.dataset)).catch(err => {
        console.error(`[${name}]`, err);
        Toast.error((err && err.message) || 'Something went wrong. Please try again.');
      });
    }, true);

    document.addEventListener('change', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-change]') : null;
      if (!el) return;
      const name = el.getAttribute('data-change');
      if (!this.changeNames.has(name) || typeof this[name] !== 'function') return;
      Promise.resolve(this[name](el.dataset.id, el.value, el)).catch(err => {
        console.error(`[${name}]`, err);
        Toast.error((err && err.message) || 'Something went wrong. Please try again.');
      });
    });

    // Any "Choose what Sloane reads" link jumps to Settings
    document.addEventListener('click', (e) => {
      const link = e.target && e.target.closest ? e.target.closest('[data-goto-settings]') : null;
      if (link) {
        e.preventDefault();
        this.switchView('settings');
      }
    });

    // Add Client modal open & save
    const addClientBtn = document.getElementById('openAddClientBtn');
    if (addClientBtn) {
      addClientBtn.addEventListener('click', async () => {
        this.editingClientId = null;
        document.getElementById('clientForm').reset();
        this.setClientModalMode(false);
        await this.populateClientModalBizSelect();
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
        this.editingBizId = null;
        document.getElementById('bizForm').reset();
        this.setBizModalMode(false);
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

    // My Private Notes: write a new note
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

    // TriNova Connection Pill trigger
    const trinovaStatusBtn = document.getElementById('trinovaStatusBtn');
    if (trinovaStatusBtn) {
      trinovaStatusBtn.addEventListener('click', () => {
        const baseUrlInput = document.getElementById('configBaseUrl');
        const tokenInput = document.getElementById('configToken');
        const anthropicInput = document.getElementById('configAnthropicKey');
        const providerInput = document.getElementById('configAiProviderSelect');
        if (baseUrlInput) baseUrlInput.value = ApiService.config.baseUrl;
        if (tokenInput) tokenInput.value = 'HttpOnly Session Cookie (slon_session)';
        if (anthropicInput) anthropicInput.value = '';
        if (providerInput) providerInput.value = ApiService.getAiProvider();
        ModalManager.open('trinovaConfigModal', trinovaStatusBtn);
      });
    }

    // TriNova Config Form submit
    const trinovaConfigForm = document.getElementById('trinovaConfigForm');
    if (trinovaConfigForm) {
      trinovaConfigForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const baseUrl = document.getElementById('configBaseUrl').value.trim();
        const chosenProvider = document.getElementById('configAiProviderSelect')?.value;
        if (chosenProvider) {
          ApiService.setAiProvider(chosenProvider);
          this.syncProviderDropdowns(chosenProvider);
        }
        ApiService.configure({ baseUrl });
        Toast.info('Connecting to TriNova...');
        this.logToTrinovaConsole(`Configuration saved. Re-testing endpoint ${baseUrl}...`);
        await this.checkTrinovaBackend();
        await this.renderClients();
        Toast.success('Settings saved.');
      });
    }

    // Interactive AI Provider Switchers (Header, Chat Modal, & Config)
    const topAiSelect = document.getElementById('topAiProviderSelect');
    const modalAiSelect = document.getElementById('modalAiProviderSelect');
    const configAiSelect = document.getElementById('configAiProviderSelect');

    const handleProviderChange = (e) => {
      const selected = e.target.value;
      ApiService.setAiProvider(selected);
      this.syncProviderDropdowns(selected);
      const name = selected === 'gemini' ? 'Google Gemini' : selected === 'anthropic' ? 'Anthropic Claude 3.5' : 'Automatic';
      Toast.info(`Sloane will now use: ${name}`);
    };

    if (topAiSelect) topAiSelect.addEventListener('change', handleProviderChange);
    if (modalAiSelect) modalAiSelect.addEventListener('change', handleProviderChange);
    if (configAiSelect) configAiSelect.addEventListener('change', handleProviderChange);

    // Claude API Key Verification Button
    const btnTestClaudeKey = document.getElementById('btnTestClaudeKey');
    const claudeStatusEl = document.getElementById('claudeKeyTestStatus');
    if (btnTestClaudeKey) {
      btnTestClaudeKey.addEventListener('click', async () => {
        btnTestClaudeKey.disabled = true;
        btnTestClaudeKey.textContent = 'Testing...';
        if (claudeStatusEl) {
          claudeStatusEl.style.display = 'block';
          claudeStatusEl.style.color = 'var(--accent)';
          claudeStatusEl.textContent = 'Asking the AI a test question...';
        }
        const result = await ApiService.testAnthropicKey();
        btnTestClaudeKey.disabled = false;
        btnTestClaudeKey.textContent = '⚡ Test the AI';
        if (claudeStatusEl) {
          claudeStatusEl.style.display = 'block';
          if (result.ok) {
            claudeStatusEl.style.color = '#10b981';
            claudeStatusEl.textContent = `✅ ${result.message}`;
            Toast.success('The AI is working.');
          } else {
            claudeStatusEl.style.color = '#ef4444';
            claudeStatusEl.textContent = `❌ ${result.message}`;
            Toast.error('The AI is not working right now.');
          }
        }
      });
    }

    // TriNova Reset to Defaults
    const configResetBtn = document.getElementById('configResetDefaultsBtn');
    if (configResetBtn) {
      configResetBtn.addEventListener('click', async () => {
        ApiService.resetToDefaults();
        const baseUrlInput = document.getElementById('configBaseUrl');
        const tokenInput = document.getElementById('configToken');
        const anthropicInput = document.getElementById('configAnthropicKey');
        if (baseUrlInput) baseUrlInput.value = ApiService.config.baseUrl;
        if (tokenInput) tokenInput.value = 'HttpOnly Session Cookie (slon_session)';
        if (anthropicInput) anthropicInput.value = '';
        Toast.info('Put back the usual settings.');
        this.logToTrinovaConsole('Reset configuration to Railway defaults.');
        await this.checkTrinovaBackend();
      });
    }

    // Diagnostic Tool: Test Health & Auth
    const testHealthBtn = document.getElementById('btnTestTrinovaHealth');
    if (testHealthBtn) {
      testHealthBtn.addEventListener('click', async () => {
        this.logToTrinovaConsole('Executing GET /api/v1/health and GET /api/v1/auth/verify...');
        const health = await ApiService.checkHealth();
        const auth = await ApiService.verifyAuth();
        this.updateConfigModalTelemetry(health, auth);
        this.logToTrinovaConsole(`Result: Health=${health.ok ? 'OK' : 'FAIL'}, Database=${health.database || 'n/a'}, Actor=${auth.actor || 'none'}, Scopes=${(auth.scopes || []).join(',')}`);
        Toast.info(health.ok ? 'TriNova is connected.' : 'Sloane cannot reach TriNova right now.');
      });
    }

    // Diagnostic Tool: Force Sync Clients
    const syncClientsBtn = document.getElementById('btnForceSyncClients');
    const syncTrinovaToolbarBtn = document.getElementById('clientSyncTrinovaBtn');
    const handleSyncClientsClick = async () => {
      Toast.info('Asking TriNova for the latest clients...');
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('sloane_clients_v2');
      }
      const res = await ApiService.getClients({ search: this.searchQuery, biz: this.selectedBizFilter, refresh: true });
      await this.renderClients();
      const n = res.data.length;
      const clients = `${n} client${n === 1 ? '' : 's'}`;
      this.logToTrinovaConsole(`Refresh from TriNova: ${clients} shown (TriNova: ${res.trinovaStatus || 'unknown'}).`);
      if (res.trinovaStatus === 'ok') {
        Toast.success(`Up to date. ${clients} shown, from TriNova and Sloane.`);
      } else if (res.trinovaStatus === 'not_configured') {
        Toast.error(`TriNova is not set up yet, so only the ${clients} you added here are shown.`);
      } else {
        Toast.error(`Sloane could not reach TriNova just now. Showing ${clients} it already knew about.`);
      }
    };

    if (syncClientsBtn) syncClientsBtn.addEventListener('click', handleSyncClientsClick);
    if (syncTrinovaToolbarBtn) syncTrinovaToolbarBtn.addEventListener('click', handleSyncClientsClick);

    // Diagnostic Tool: Force Sync Statutory
    const syncStatutoryBtn = document.getElementById('btnForceSyncStatutory');
    if (syncStatutoryBtn) {
      syncStatutoryBtn.addEventListener('click', async () => {
        this.logToTrinovaConsole('Executing POST /api/v1/statutory/sync...');
        await this.handleSyncCompaniesHouse();
      });
    }
  }

  openNavDrawer() {
    const sidebar = document.querySelector('.side');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const backdrop = document.getElementById('drawerBackdrop');
    if (sidebar) sidebar.classList.add('mobile-open');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'true');
    if (backdrop) backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  closeNavDrawer() {
    const sidebar = document.querySelector('.side');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const backdrop = document.getElementById('drawerBackdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
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

    if (viewId === 'settings') {
      OutlookSettings.loadStatus();
      this.renderSystemStatus();
    }

    // Close mobile/tablet navigation drawer if open
    this.closeNavDrawer();

    // Scroll to top
    window.scrollTo(0, 0);
  }

  async renderAll() {
    await this.renderCommandCentre();
    await this.renderBusinesses();
    await this.renderClients();
    await this.renderPeopleWork();
    await this.renderStatutory();
    await this.renderIntelligence();
    await this.renderBrain();
    await OutlookSettings.loadStatus();
  }

  /* ==========================================================================
     View Renderers
     ========================================================================== */

  async renderCommandCentre() {
    // 0. Render Red Alerts placeholder
    const redAlertsContainer = document.getElementById('redAlertsContainer');
    if (redAlertsContainer) {
      redAlertsContainer.innerHTML = `
        <div style="font-size: 11.5px; color: var(--muted); padding: 8px 0;">
          Checking statutory alerts...
        </div>
      `;
    }

    // Live data fetching (§4.3, Task P7.2 & Task P7.3: no demo arrays)
    let diaryEvents = [];
    let attentionEmails = [];
    let isOutlookConnected = false;
    let diaryEmptyReason = 'Connect your Outlook to see this here';
    let emailEmptyReason = 'Connect your Outlook to see this here';
    let tasksRes = { data: [] };
    let statutoryRes = { data: [] };

    try {
      const [diaryRes, emailsRes, statusRes, tRes, sRes] = await Promise.all([
        ApiService.getOutlookDiary('today').catch(err => ({ ok: false, error: err })),
        ApiService.getOutlookFlaggedEmails().catch(err => ({ ok: false, error: err })),
        ApiService.getOutlookStatus().catch(() => ({ ok: false })),
        ApiService.getTasks().catch(() => ({ data: [] })),
        ApiService.getStatutory().catch(() => ({ data: [] }))
      ]);
      tasksRes = tRes;
      statutoryRes = sRes;

      // Remember what we loaded, for the Warnings page and the "Anything I've missed?" box
      this.cachedStatutory = statutoryRes?.data || [];
      this.cachedTasks = tasksRes?.data || [];
      this.setSampleBanners(Boolean(statutoryRes?.meta?.dataSource === 'sample' || tasksRes?.meta?.dataSource === 'sample'));

      // Render "Needs action now" from filings that are late or due very soon (RED)
      if (redAlertsContainer) {
        const urgentItems = this.cachedStatutory.filter(s => s.urgency === 'RED' || s.status === 'Overdue' || s.risk === 'Critical');
        if (urgentItems.length > 0) {
          const more = urgentItems.length - 3;
          redAlertsContainer.innerHTML = urgentItems.slice(0, 3).map(item => `
            <div class="alert-item">
              <span class="dot red" style="margin-top: 4px;"></span>
              <div class="alert-item-content">
                <div class="alert-title">${escapeHtml(item.name || item.companyName || item.clientName || 'Client')}</div>
                <div class="alert-desc">${escapeHtml(item.note || item.notes || item.urgencyReason || 'A filing is late or due very soon.')}</div>
              </div>
            </div>
          `).join('') + (more > 0 ? `<div style="font-size: 11.5px; color: var(--muted); padding: 6px 0;">…and ${more} more. See the Deadlines page.</div>` : '');
        } else {
          redAlertsContainer.innerHTML = `
            <div style="font-size: 11.5px; color: var(--muted); padding: 8px 0;">
              Nothing needs action right now.
            </div>
          `;
        }
      }

      const status = statusRes?.data?.status || 'not_connected';
      isOutlookConnected = status === 'connected';

      // Update Top Bar Eyebrow
      const eyebrowDot = document.getElementById('outlookEyebrowDot');
      const eyebrowText = document.getElementById('outlookEyebrowText');
      if (eyebrowDot && eyebrowText) {
        if (status === 'connected') {
          eyebrowDot.className = 'dot green';
          eyebrowDot.style.background = '';
          eyebrowText.textContent = 'Your private dashboard · Outlook connected';
        } else if (status === 'reconnect_required') {
          eyebrowDot.className = 'dot red';
          eyebrowDot.style.background = '';
          eyebrowText.textContent = 'Your private dashboard · Outlook needs reconnecting';
        } else {
          eyebrowDot.className = 'dot';
          eyebrowDot.style.background = 'var(--muted)';
          eyebrowText.textContent = 'Your private dashboard';
        }
      }

      // Render Reconnect Banner if status is reconnect_required (§4.1 & Task P7.5)
      const reconnectBannerEl = document.getElementById('outlookReconnectBanner');
      if (reconnectBannerEl) {
        if (status === 'reconnect_required' && !this._dismissedReconnectBanner) {
          reconnectBannerEl.style.display = 'block';
          reconnectBannerEl.innerHTML = `
            <div class="sourcebanner" style="background: rgba(255, 93, 103, 0.1); border: 1px solid var(--red-border); color: #ffb4b9; padding: 12px 16px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 16px;">⚠️</span>
                <div style="font-size: 12.5px; line-height: 1.4;">
                  <strong style="color: var(--red);">Outlook Reconnect Required:</strong>
                  <span style="color: var(--text);">Microsoft authorization has expired or consent was revoked. Reconnect your account to resume diary and email sync.</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <a href="/api/v1/integrations/outlook/connect" class="btn btn-primary" id="btnReconnectOutlookBanner" style="padding: 6px 14px; font-size: 11.5px; text-decoration: none;">
                  🔗 Reconnect Now
                </a>
                <button type="button" class="btn btn-secondary" id="btnDismissReconnectBanner" style="padding: 6px 10px; font-size: 11px;">
                  ✕
                </button>
              </div>
            </div>
          `;
          const dismissBtn = document.getElementById('btnDismissReconnectBanner');
          if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
              this._dismissedReconnectBanner = true;
              reconnectBannerEl.style.display = 'none';
            });
          }
        } else {
          if (status !== 'reconnect_required') {
            this._dismissedReconnectBanner = false;
          }
          reconnectBannerEl.style.display = 'none';
          reconnectBannerEl.innerHTML = '';
        }
      }

      // 1. Render Top 3 Ranked Items from API (Task P7.3: dynamic priority ranking)
      const top3Container = document.getElementById('top3Container');
      if (top3Container) {
        const records = statutoryRes?.data || [];
        const urgencyOrder = { 'RED': 1, 'AMBER': 2, 'CLEAR': 3 };
        const sorted = [...records].sort((a, b) => {
          const diff = (urgencyOrder[a.urgency] || 99) - (urgencyOrder[b.urgency] || 99);
          if (diff !== 0) return diff;
          if (a.daysRemaining === null || a.daysRemaining === undefined) return 1;
          if (b.daysRemaining === null || b.daysRemaining === undefined) return -1;
          return a.daysRemaining - b.daysRemaining;
        });

        const top3Items = sorted.slice(0, 3).map((r, idx) => ({
          rank: idx + 1,
          title: `${r.name || r.companyName} — ${r.urgency === 'RED' ? (r.hasStrikeOff ? 'Risk of being removed from the register' : 'Accounts are late') : 'Filing due soon'}`,
          desc: r.note || r.notes || (r.hasStrikeOff ? 'Companies House has said it plans to remove this company from the register.' : `Accounts due: ${r.accountsDueDate || 'date not known'}`),
          isRed: r.urgency === 'RED'
        }));

        if (top3Items.length > 0) {
          top3Container.innerHTML = top3Items.map(item => `
            <div class="top3-item ${item.isRed ? 'item-red' : ''}">
              <div class="rank">${escapeHtml(item.rank)}</div>
              <div class="top3-item-content">
                <div class="top3-item-title">${escapeHtml(item.title)}</div>
                <div class="top3-item-desc">${escapeHtml(item.desc)}</div>
              </div>
            </div>
          `).join('');
        } else {
          top3Container.innerHTML = `<div class="table-empty" style="padding: 24px;">Nothing urgent right now.</div>`;
        }
      }

      // Process Diary data
      const diaryData = diaryRes?.data !== undefined ? diaryRes.data : diaryRes;
      // The server sends the list as `items` (older builds used `events`); accept both.
      const diaryList = Array.isArray(diaryData?.items) ? diaryData.items : diaryData?.events;
      const diaryErrCode = diaryData?.code || diaryRes?.error?.code;
      if (diaryData && diaryData.connected && diaryData.enabled && Array.isArray(diaryList)) {
        diaryEvents = diaryList;
        if (diaryList.length === 0) diaryEmptyReason = 'No meetings in your calendar today.';
      } else if (diaryErrCode === 'OUTLOOK_RECONNECT_REQUIRED' || status === 'reconnect_required') {
        diaryEmptyReason = 'Reconnect your Outlook';
      } else if (diaryData?.code === 'CALENDAR_SYNC_DISABLED') {
        diaryEmptyReason = 'Calendar sync is off';
      } else if (diaryData?.code === 'OUTLOOK_NOT_CONNECTED') {
        diaryEmptyReason = 'Connect your Outlook to see this here';
      } else if (diaryRes?.error && isOutlookConnected) {
        diaryEmptyReason = 'Sloane could not reach Outlook just now. Try again in a minute.';
      } else if (diaryData?.message) {
        diaryEmptyReason = diaryData.message;
      }

      // Process Flagged Emails data
      const emailsData = emailsRes?.data !== undefined ? emailsRes.data : emailsRes;
      const emailList = Array.isArray(emailsData?.items) ? emailsData.items : emailsData?.emails;
      const emailErrCode = emailsData?.code || emailsRes?.error?.code;
      if (emailsData && emailsData.connected && emailsData.enabled && Array.isArray(emailList)) {
        attentionEmails = emailList;
        if (emailList.length === 0) emailEmptyReason = 'No flagged emails. You are up to date.';
      } else if (emailErrCode === 'OUTLOOK_RECONNECT_REQUIRED' || status === 'reconnect_required') {
        emailEmptyReason = 'Reconnect your Outlook';
      } else if (emailsData?.code === 'EMAIL_SYNC_DISABLED') {
        emailEmptyReason = 'Email sync is off';
      } else if (emailsData?.code === 'OUTLOOK_NOT_CONNECTED') {
        emailEmptyReason = 'Connect your Outlook to see this here';
      } else if (emailsRes?.error && isOutlookConnected) {
        emailEmptyReason = 'Sloane could not reach Outlook just now. Try again in a minute.';
      } else if (emailsData?.message) {
        emailEmptyReason = emailsData.message;
      }

      this.cachedDiaryEvents = diaryEvents;
      this.cachedEmailCount = attentionEmails.length;
    } catch (err) {
      console.warn('[renderCommandCentre] Live Outlook fetch error:', err.message);
    }

    // 2. Render Today's Diary (Live Outlook)
    const diaryContainer = document.getElementById('diaryContainer');
    const diaryPill = document.getElementById('diaryStatusPill');
    if (diaryPill) {
      if (isOutlookConnected) {
        diaryPill.style.display = 'inline-flex';
        diaryPill.className = 'pill green';
        diaryPill.textContent = 'Connected';
      } else {
        diaryPill.style.display = 'none';
      }
    }

    if (diaryContainer) {
      if (diaryEvents.length > 0) {
        diaryContainer.innerHTML = diaryEvents.map(item => `
          <div class="diary-item ${item.isClash ? 'diary-clash' : ''}">
            <div class="diary-item-left">
              <span class="dot ${item.chip === 'URGENT' ? 'red' : 'green'}"></span>
              <span class="diary-title">${escapeHtml(item.title)}</span>
            </div>
            <span class="timechip ${item.chip === 'URGENT' ? 'timechip-urgent' : ''}">${escapeHtml(item.time)}</span>
          </div>
        `).join('');
      } else {
        diaryContainer.innerHTML = `<div class="table-empty" style="padding: 24px;">${escapeHtml(diaryEmptyReason)}</div>`;
      }
    }

    // 3. Render Businesses Preview Grid
    const { data: businesses } = await ApiService.getBusinesses();
    const cmdBizGrid = document.getElementById('cmdBizCards');
    if (cmdBizGrid) {
      cmdBizGrid.innerHTML = (businesses || []).slice(0, 6).map(b => `
        <div class="card" style="padding: 14px; cursor: pointer;" onclick="app.switchView('businesses')">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span class="pill green" style="font-size: 10px;">${escapeHtml(b.status)}</span>
            <span style="font-size: 11px; font-weight: 700; color: var(--accent);">${escapeHtml(b.clientCount)} ${Number(b.clientCount) === 1 ? 'client' : 'clients'}</span>
          </div>
          <div style="font-size: 13px; font-weight: 800; color: var(--text);">${escapeHtml(b.name)}</div>
          <div style="font-size: 10px; color: var(--muted);">${escapeHtml(b.type)}</div>
        </div>
      `).join('');
    }

    // 4. Render Waiting Sign-off from API (Task P7.3: dynamic sign-off tasks)
    const signoffContainer = document.getElementById('waitingSignoffContainer');
    const allTasks = tasksRes?.data || [];
    const signoffItems = allTasks.filter(t =>
      !['Completed', 'Cancelled'].includes(t.status) && (
        t.status === 'Pending' ||
        t.status === 'In_Review' ||
        t.status === 'Under_Review' ||
        /sign|review|approval/i.test(t.title || '')
      )
    ).map(t => ({
      id: t.id,
      title: `${t.companyName || 'Client'} — ${t.title}`,
      sub: t.description || `Assigned to ${t.assigneeName || 'Staff'}`,
      date: t.dueDate ? `Due ${t.dueDate}` : 'No due date'
    }));

    if (signoffContainer) {
      if (signoffItems.length > 0) {
        signoffContainer.innerHTML = signoffItems.map(item => `
          <div class="signoff-item">
            <div class="item-main">
              <div class="item-title">${escapeHtml(item.title)}</div>
              <div class="item-sub">${escapeHtml(item.sub)}</div>
            </div>
            <div style="text-align: right;">
              <span class="pill amber">${escapeHtml(item.date)}</span>
              <div class="task-controls">
                <button type="button" class="btn-done" onclick="app.markTaskDone('${sanitizeId(item.id)}', this)" title="Tick this off as finished">✓ Mark done</button>
              </div>
            </div>
          </div>
        `).join('');
      } else {
        signoffContainer.innerHTML = `<div class="table-empty" style="padding: 24px;">Nothing is waiting for your OK.</div>`;
      }
    }

    // 5. Render Attention Emails (Live Outlook)
    const emailContainer = document.getElementById('attentionEmailsContainer');
    const emailsRadarPill = document.getElementById('emailsRadarPill');
    if (emailsRadarPill) {
      if (isOutlookConnected) {
        emailsRadarPill.style.display = 'inline-flex';
      } else {
        emailsRadarPill.style.display = 'none';
      }
    }

    if (emailContainer) {
      if (attentionEmails.length > 0) {
        emailContainer.innerHTML = attentionEmails.map(item => `
          <div class="email-item">
            <div class="item-main">
              <div class="item-title">${escapeHtml(item.title)}</div>
              <div class="item-sub">${escapeHtml(item.sub)}</div>
            </div>
            <div style="text-align: right;">
              <span class="pill ${item.priority === 'High' ? 'red' : 'blue'}">${escapeHtml(item.priority)}</span>
              ${/^https:\/\//.test(item.webLink || '') ? `<div class="task-controls"><a class="card-action-btn" href="${escapeHtml(item.webLink)}" target="_blank" rel="noopener noreferrer">Open in Outlook ↗</a></div>` : ''}
            </div>
          </div>
        `).join('');
      } else {
        emailContainer.innerHTML = `<div class="table-empty" style="padding: 24px;">${escapeHtml(emailEmptyReason)}</div>`;
      }
    }

    // Outlook panel footers: tell the user plainly what Sloane can and cannot do
    const readOnlyNote = 'Sloane only reads. It never sends, deletes or changes anything.';
    const diaryNote = document.getElementById('diaryManageNote');
    const emailNote = document.getElementById('emailManageNote');
    if (diaryNote) diaryNote.textContent = isOutlookConnected ? readOnlyNote : 'Not connected yet. Sloane cannot see your calendar.';
    if (emailNote) emailNote.textContent = isOutlookConnected ? readOnlyNote : 'Not connected yet. Sloane cannot see your emails.';

    // 6. Update Pulse Metrics
    const signoffCount = signoffItems.length;
    const emailCount = attentionEmails.length;
    const bizCount = Array.isArray(businesses) ? businesses.length : 0;
    const filingRecords = Array.isArray(statutoryRes?.data) ? statutoryRes.data : [];
    const lateCount = filingRecords.filter(r => r.accountsOverdue || (typeof r.daysRemaining === 'number' && r.daysRemaining < 0)).length;
    const dueSoonCount = filingRecords.filter(r => typeof r.daysRemaining === 'number' && r.daysRemaining >= 0 && r.daysRemaining <= 14).length;
    const blockedCount = allTasks.filter(t => Boolean(t.isBlocked) && !['Completed', 'Cancelled'].includes(t.status)).length;

    const pulseSignoffs = document.getElementById('pulseSignoffs');
    const pulseEmails = document.getElementById('pulseEmails');
    const pulseOverdue = document.getElementById('pulseOverdue');
    const pulseDue7d = document.getElementById('pulseDue7d');
    const pulseBlocked = document.getElementById('pulseBlocked');
    const pulseBizAreas = document.getElementById('pulseBizAreas');

    if (pulseSignoffs) pulseSignoffs.textContent = signoffCount;
    if (pulseEmails) pulseEmails.textContent = emailCount;
    if (pulseOverdue) pulseOverdue.textContent = lateCount;
    if (pulseDue7d) pulseDue7d.textContent = dueSoonCount;
    if (pulseBlocked) pulseBlocked.textContent = blockedCount;
    if (pulseBizAreas) pulseBizAreas.textContent = bizCount;
    this.updateNavBadges({ bizCount });
  }

  async renderBusinesses() {
    const { data: businesses } = await ApiService.getBusinesses();
    const container = document.getElementById('fullBizCards');
    if (!container) return;

    if (!businesses || businesses.length === 0) {
      container.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 32px;">You have not added any businesses yet. Click "+ Add a business" above to add one.</div>`;
      this.populateClientBizFilterOptions([]);
      return;
    }

    this.lastBusinesses = businesses;
    container.innerHTML = businesses.map(b => `
      <div class="card biz-card">
        <div>
          <div class="biz-card-header">
            <span class="pill ${b.status === 'Paused' ? 'amber' : 'green'}">${escapeHtml(b.status === 'Paused' ? 'Paused' : 'Active')}</span>
          </div>
          <div class="biz-name">${escapeHtml(b.name)}</div>
          <div class="biz-type">${escapeHtml(b.type)}</div>
        </div>
        <div class="biz-stats">
          <div class="biz-stat-item">
            <span class="biz-stat-n">${escapeHtml(b.clientCount !== undefined ? b.clientCount : 0)}</span>
            <span class="biz-stat-lbl">${b.clientCount === 1 ? 'Client' : 'Clients'}</span>
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-secondary" onclick="app.openEditBiz('${sanitizeId(b.id)}')">✎ Edit</button>
          <button type="button" class="btn btn-secondary" style="color: var(--red); border-color: rgba(239, 68, 68, 0.3);" onclick="app.deleteBiz('${sanitizeId(b.id)}')">Remove</button>
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
    filter.innerHTML = `<option value="All">All businesses</option>` +
      businesses.map(b => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('');
    filter.value = currentVal || 'All';
  }

  async populateClientModalBizSelect() {
    let businesses = [];
    try {
      const res = await ApiService.getBusinesses();
      businesses = res.data || [];
    } catch (_) {
      businesses = StorageService.getBusinesses();
    }
    const select = document.getElementById('modalClientBiz');
    if (!select) return;
    select.innerHTML = businesses.map(b => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('');
  }

  async renderClients() {
    const res = await ApiService.getClients({
      search: this.searchQuery,
      biz: this.selectedBizFilter
    });
    const clients = res.data || [];
    this.lastClients = clients;

    if (res.trinovaStatus) {
      this.trinovaStatus = res.trinovaStatus;
      this.applyTrinovaPill(res.trinovaStatus);
    }

    // Say plainly when TriNova's clients cannot be shown.
    const banner = document.getElementById('clientTrinovaBanner');
    if (banner) {
      const msgs = {
        not_configured: 'Sloane has not been given TriNova\'s access key, so it cannot show your TriNova clients yet. Ask your Sloane administrator to set it up. You can still add clients here yourself.',
        unreachable: 'Sloane could not reach TriNova just now, so only the clients you added here are shown. Try "Refresh from TriNova" in a minute.'
      };
      const msg = msgs[res.trinovaStatus];
      banner.style.display = msg ? 'flex' : 'none';
      const span = banner.querySelector('span:last-child');
      if (span && msg) span.textContent = msg;
    }

    // Update Client 360 data source badge
    const badge = document.getElementById('clientDataSourceBadge');
    if (badge) {
      if (res.source === 'trinova_live' && res.trinovaStatus === 'ok') {
        badge.className = 'source-badge ch-live';
        badge.textContent = `TriNova and Sloane (${res.meta?.total || clients.length})`;
      } else if (res.source === 'trinova_live') {
        badge.className = 'source-badge';
        badge.textContent = `Added in Sloane (${clients.length})`;
      } else {
        badge.className = 'source-badge';
        badge.textContent = `Saved on this device (${clients.length})`;
      }
    }

    const countMeta = document.getElementById('clientCountMeta');
    if (countMeta) countMeta.textContent = `Showing ${clients.length} client${clients.length === 1 ? '' : 's'}`;

    const tbody = document.getElementById('clientTableBody');
    if (!tbody) return;

    if (clients.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No clients found. Try a different search, or click "+ Add a client".</td></tr>`;
      return;
    }

    tbody.innerHTML = clients.map(c => {
      const riskClass = c.risk === 'High' ? 'red' : c.risk === 'Medium' ? 'amber' : 'green';
      const clientId = sanitizeId(c.id || c.clientId || 'client_record');
      const safeName = escapeHtml(c.name);
      const safeBiz = escapeHtml(c.biz || '—');
      const safeNo = escapeHtml(c.no);
      const chUrl = c.no ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(c.no)}` : null;
      const safeDirs = escapeHtml(c.dirs || '—');
      const safeNotes = escapeHtml(c.notes || '—');
      const safeVat = escapeHtml(c.vat || 'No');
      const safeVatNo = escapeHtml(c.vatNo);
      const safeRisk = escapeHtml(c.risk || 'Low');
      const canEdit = Boolean(c.addedInSloane);

      return `
        <tr class="client-row" style="cursor: pointer;" title="Click to see this client's history" onclick="app.selectClient360('${clientId}')">
          <td>
            <div style="font-weight: 700; color: var(--text);">${safeName}</div>
            <div style="font-size: 11px; color: var(--muted);">${safeBiz}</div>
          </td>
          <td>
            ${c.no ? `<a href="${chUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color: var(--accent); font-family: var(--font-mono); text-decoration: none; font-weight: 600;">${safeNo} ↗</a>` : '<span style="color: var(--muted);">—</span>'}
          </td>
          <td>${escapeHtml(ReconciliationEngine.formatDate(c.year))}</td>
          <td>${escapeHtml(ReconciliationEngine.formatDate(c.accounts))}</td>
          <td>${escapeHtml(ReconciliationEngine.formatDate(c.confirm))}</td>
          <td>
            <span class="pill ${c.vat === 'Yes' ? 'green' : 'neutral'}">${safeVat}</span>
            ${c.vatNo ? `<div style="font-size: 10px; color: var(--muted); margin-top: 2px;">${safeVatNo}</div>` : ''}
          </td>
          <td style="max-width: 160px; font-size: 11px; color: var(--muted);">${safeDirs}</td>
          <td><span class="pill ${riskClass}">${safeRisk}</span></td>
          <td style="max-width: 180px; font-size: 11px; color: var(--muted);">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              <span>${safeNotes}</span>
              <div style="display: flex; gap: 4px;">
                <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" title="See history" onclick="event.stopPropagation(); app.selectClient360('${clientId}');">⏱️</button>
                ${canEdit ? `
                <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" title="Edit this client" onclick="event.stopPropagation(); app.openEditClient('${clientId}');">✎</button>
                <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px; color: var(--red); border-color: rgba(239, 68, 68, 0.3);" title="Remove this client" onclick="event.stopPropagation(); app.deleteClient('${clientId}', '${safeName}');">✕</button>
                ` : `
                <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" title="Choose which of your businesses this client belongs to" data-action="openClientBusinessForm" data-id="${clientId}">🏢</button>
                <span class="source-badge" title="This client comes from TriNova, so its details are changed there.">TriNova</span>`}
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Populate timeline client selector dropdowns
    const clientOptions = clients.map(c => `<option value="${sanitizeId(c.id || c.clientId)}">${escapeHtml(c.name)}</option>`).join('');
    const tlSelect = document.getElementById('timelineClientSelect');
    if (tlSelect) {
      const currentVal = tlSelect.value || this.activeClient360Id;
      tlSelect.innerHTML = clientOptions;
      if (currentVal) tlSelect.value = currentVal;
    }
    const modalTlSelect = document.getElementById('modalTimelineClientId');
    if (modalTlSelect) {
      modalTlSelect.innerHTML = clientOptions;
      if (this.activeClient360Id) modalTlSelect.value = this.activeClient360Id;
    }
  }

  async deleteClient(clientId, clientName) {
    if (typeof clientName !== 'string') {
      const found = (this.lastClients || []).find(c => String(c.id || c.clientId) === String(clientId));
      clientName = found ? found.name : 'this client';
    }
    const ok = await ConfirmDialog.ask({
      title: `Remove ${clientName}?`,
      message: 'The client is removed from Sloane, together with its tasks, notes, documents and history. This cannot be undone.',
      confirmLabel: 'Remove client'
    });
    if (!ok) return;
    try {
      await ApiService.deleteClient(clientId);
      Toast.success(`Client "${clientName}" removed.`);
      if (String(this.activeClient360Id) === String(clientId)) this.activeClient360Id = null;
      await this.renderClients();
      await this.renderBusinesses();
      await this.renderPeopleWork();
      await this.renderStatutory();
      await this.renderCommandCentre();
      if (this.activeClientTab !== 'overview') await this.switchClientTab(this.activeClientTab);
    } catch (err) {
      Toast.error(err.message || 'Could not remove that client.');
    }
  }

  async renderIntelligence() {
    const grid = document.getElementById('intelGridContainer');
    if (!grid) return;

    let filings = this.cachedStatutory;
    let tasks = this.cachedTasks;
    try {
      if (!filings) {
        const sRes = await ApiService.getStatutory();
        filings = sRes.data || [];
        this.setSampleBanners(sRes.meta?.dataSource === 'sample');
      }
      if (!tasks) {
        const tRes = await ApiService.getTasks();
        tasks = tRes.data || [];
      }
    } catch (_) {
      filings = filings || [];
      tasks = tasks || [];
    }
    this.cachedStatutory = filings;
    this.cachedTasks = tasks;

    const clashes = (this.cachedDiaryEvents || []).filter(e => e.isClash);
    const redFilings = filings.filter(f => f.urgency === 'RED');
    const stuckTasks = tasks.filter(t => t.isBlocked && !['Completed', 'Cancelled'].includes(t.status));

    const card = (dot, title, pill, pillClass, items, emptyText) => `
      <div class="card intel-card">
        <div class="card-header">
          <h2><span class="dot ${dot}"></span> ${title}</h2>
          <span class="pill ${pillClass}">${pill}</span>
        </div>
        <div class="intel-list">
          ${items.length > 0 ? items.join('') : `
            <div class="intel-item">
              <div class="intel-item-content">
                <div class="intel-desc">${emptyText}</div>
              </div>
            </div>`}
        </div>
      </div>`;
    const item = (cls, title, desc) => `
      <div class="intel-item ${cls}">
        <div class="intel-item-content">
          <div class="intel-title">${escapeHtml(title)}</div>
          <div class="intel-desc">${escapeHtml(desc)}</div>
        </div>
      </div>`;

    const filingItems = redFilings.slice(0, 6).map(f => item('intel-critical', f.name || f.companyName || 'Client', f.note || f.notes || 'A filing is late or due very soon.'));
    if (redFilings.length > 6) filingItems.push(item('', `…and ${redFilings.length - 6} more`, 'See the Deadlines page for the full list.'));

    const stuckItems = stuckTasks.slice(0, 6).map(t => item('intel-chase', `${t.companyName || 'Client'}: ${t.title || 'Task'}`, t.blocker ? `Stuck because: ${t.blocker}` : `Given to ${t.assigneeName || 'a team member'} and currently stuck.`));

    const clashItems = clashes.map(c => item('', `Two meetings at once: ${c.title}`, `The meeting at ${c.time} overlaps with another meeting today.`));
    const calendarConnected = Array.isArray(this.cachedDiaryEvents) && this.cachedDiaryEvents.length > 0;

    grid.innerHTML = [
      card('red', 'Late or urgent filings', redFilings.length === 0 ? 'None' : `${redFilings.length}`, redFilings.length === 0 ? 'green' : 'red', filingItems, 'No filings are late or due in the next 14 days.'),
      card('amber', 'Work that is stuck', stuckTasks.length === 0 ? 'None' : `${stuckTasks.length}`, stuckTasks.length === 0 ? 'green' : 'amber', stuckItems, 'No tasks are marked as stuck.'),
      card(clashes.length > 0 ? 'red' : 'green', 'Meetings that clash', clashes.length === 0 ? 'None' : `${clashes.length}`, clashes.length === 0 ? 'green' : 'red', clashItems, calendarConnected ? 'None of today\'s meetings overlap.' : 'Connect your Outlook calendar (in Settings) and Sloane will warn you about clashing meetings.')
    ].join('');

    this.updateNavBadges({ intelCount: redFilings.length + stuckTasks.length + clashes.length });
  }

  renderMissedScan() {
    const container = document.getElementById('missedModalContent');
    if (!container) return;

    const filings = this.cachedStatutory || [];
    const tasks = (this.cachedTasks || []).filter(t => !['Completed', 'Cancelled'].includes(t.status));
    const lateFilings = filings.filter(f => f.accountsOverdue || (typeof f.daysRemaining === 'number' && f.daysRemaining < 0));
    const soonFilings = filings.filter(f => typeof f.daysRemaining === 'number' && f.daysRemaining >= 0 && f.daysRemaining <= 14);
    const stuck = tasks.filter(t => t.isBlocked);
    const waiting = tasks.filter(t => t.status === 'Pending' || t.status === 'Under_Review');
    const emailCount = this.cachedEmailCount || 0;

    const rows = [];
    const row = (dot, text, chip) => rows.push(`
      <div class="diary-item">
        <div class="diary-item-left">
          <span class="dot ${dot}"></span>
          <span class="diary-title">${escapeHtml(text)}</span>
        </div>
        <span class="timechip">${escapeHtml(chip)}</span>
      </div>`);

    if (lateFilings.length) row('red', `${lateFilings.length} filing${lateFilings.length === 1 ? ' is' : 's are'} late`, 'Deadlines');
    if (soonFilings.length) row('amber', `${soonFilings.length} filing${soonFilings.length === 1 ? ' is' : 's are'} due in the next 14 days`, 'Deadlines');
    if (stuck.length) row('red', `${stuck.length} task${stuck.length === 1 ? ' is' : 's are'} stuck`, 'Team & Tasks');
    if (waiting.length) row('amber', `${waiting.length} task${waiting.length === 1 ? ' is' : 's are'} waiting for a decision`, 'Today');
    if (emailCount) row('amber', `${emailCount} flagged email${emailCount === 1 ? '' : 's'} may need a reply`, 'Outlook');

    container.innerHTML = `
      <div class="sourcebanner">
        Sloane has just looked at your deadlines, tasks and flagged emails. This is what it found.
      </div>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${rows.length ? rows.join('') : '<div class="table-empty" style="padding: 18px;">Nothing has been missed. You are up to date.</div>'}
      </div>
    `;
  }

  /* ==========================================================================
     Action Handlers
     ========================================================================== */

  async handleSaveClient() {
    const name = document.getElementById('clientName').value.trim();
    if (!name) {
      Toast.error('Please type the client or company name.');
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

    try {
      if (this.editingClientId) {
        await ApiService.updateClient(this.editingClientId, clientData);
        Toast.success(`"${name}" has been updated.`);
      } else {
        await ApiService.createClient(clientData);
        Toast.success(`"${name}" has been added.`);
      }
    } catch (err) {
      Toast.error(err.message || 'Could not save this client.');
      return;
    }
    ModalManager.close('clientModal');
    this.editingClientId = null;

    // Re-render affected views
    await this.renderClients();
    await this.renderBusinesses();
    this.renderStatutory();
    await this.renderCommandCentre();
  }

  setClientModalMode(isEdit) {
    const title = document.getElementById('clientModalTitle');
    const btn = document.getElementById('clientFormSubmitBtn');
    if (title) title.textContent = isEdit ? 'Edit client' : 'Add a client';
    if (btn) btn.textContent = isEdit ? 'Save changes' : 'Save client';
  }

  async openEditClient(clientId) {
    const c = (this.lastClients || []).find(x => (x.id || x.clientId) === clientId);
    if (!c) { Toast.error('Could not find that client. Please refresh the page.'); return; }
    this.editingClientId = clientId;
    document.getElementById('clientForm').reset();
    this.setClientModalMode(true);
    await this.populateClientModalBizSelect();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
    set('clientName', c.name);
    set('modalClientBiz', c.biz);
    set('clientNo', c.no);
    set('clientYear', c.year);
    set('clientAccounts', c.accounts);
    set('clientConfirm', c.confirm);
    set('clientVat', c.vat === 'Yes' ? 'Yes' : 'No');
    set('clientVatNo', c.vatNo);
    set('clientPaye', c.paye);
    set('clientCis', ['Contractor', 'Subcontractor', 'Both'].includes(c.cis) ? c.cis : 'No');
    set('clientRisk', c.risk || 'Low');
    set('clientDirs', c.dirs === '—' ? '' : c.dirs);
    set('clientOwner', c.owner);
    set('clientNotes', c.notes);
    ModalManager.open('clientModal');
  }

  /* ---- Business areas: edit / remove ---- */
  setBizModalMode(isEdit) {
    const title = document.getElementById('bizModalTitle');
    const btn = document.getElementById('bizFormSubmitBtn');
    if (title) title.textContent = isEdit ? 'Edit business' : 'Add a business';
    if (btn) btn.textContent = isEdit ? 'Save changes' : 'Save';
  }

  openEditBiz(bizId) {
    const b = (this.lastBusinesses || []).find(x => x.id === bizId);
    if (!b) { Toast.error('Could not find that business. Please refresh the page.'); return; }
    this.editingBizId = bizId;
    document.getElementById('bizForm').reset();
    this.setBizModalMode(true);
    document.getElementById('bizName').value = b.name;
    document.getElementById('bizType').value = b.type;
    ModalManager.open('bizModal');
  }

  async deleteBiz(bizId) {
    const b = (this.lastBusinesses || []).find(x => x.id === bizId);
    const name = b ? b.name : 'this business';
    const ok = await ConfirmDialog.ask({
      title: `Remove ${name}?`,
      message: 'The business is taken off your list. A business that still has clients cannot be removed.',
      confirmLabel: 'Remove business'
    });
    if (!ok) return;
    try {
      await ApiService.deleteBusiness(bizId);
      Toast.success(`"${name}" has been removed.`);
      await this.renderBusinesses();
      await this.renderCommandCentre();
      await this.populateClientModalBizSelect();
    } catch (err) {
      Toast.error(err.message || 'Could not remove that business.');
    }
  }

  /* ---- Tasks: tick off / change status ---- */
  async markTaskDone(taskId, btn) {
    const task = [...(this.allTasks || []), ...(this.cachedTasks || [])].find(t => t.id === taskId);

    // A task marked as stuck needs a few words on how it was sorted out.
    if (task && task.isBlocked) {
      FormModal.open({
        title: 'How was it sorted out?',
        intro: `"${task.title}" was marked as stuck${task.blocker ? ` (${task.blocker})` : ''}. Write a few words on how it was sorted out, then it can be ticked off.`,
        submitLabel: 'Mark as done',
        fields: [{ name: 'note', label: 'What happened?', type: 'textarea', required: true, maxlength: 1000 }],
        onSubmit: async v => {
          await ApiService.completeTask(taskId, v.note);
          Toast.success('Marked as done.');
          await this.refreshTaskViews();
        }
      });
      return;
    }

    if (btn) btn.disabled = true;
    try {
      await ApiService.completeTask(taskId);
      Toast.success('Marked as done.');
      await this.refreshTaskViews();
    } catch (err) {
      if (btn) btn.disabled = false;
      Toast.error(err.message || 'Could not mark that as done.');
    }
  }

  async changeTaskStatus(taskId, status, selectEl) {
    if (selectEl) selectEl.disabled = true;
    try {
      await ApiService.updateTask(taskId, { status });
      Toast.success('Status updated.');
      this.cachedTasks = null;
      await this.renderPeopleWork();
      await this.renderCommandCentre();
      await this.renderIntelligence();
    } catch (err) {
      if (selectEl) selectEl.disabled = false;
      Toast.error(err.message || 'Could not change the status.');
      await this.renderPeopleWork();
    }
  }

  /* ---- Page-wide helpers ---- */
  setSampleBanners(isSample) {
    document.querySelectorAll('[data-sample-banner]').forEach(el => {
      el.style.display = isSample ? 'flex' : 'none';
    });
  }

  updateNavBadges({ bizCount, redCount, intelCount } = {}) {
    const set = (id, n, redStyle) => {
      const el = document.getElementById(id);
      if (!el || n === undefined) return;
      el.textContent = n;
      el.style.display = n > 0 ? '' : 'none';
      if (redStyle) el.className = `nav-badge ${n > 0 ? 'badge-red' : ''}`;
    };
    set('bizNavBadge', bizCount, false);
    set('statNavBadge', redCount, true);
    set('intelNavBadge', intelCount, true);
  }

  async handleSaveBiz() {
    const name = document.getElementById('bizName').value.trim();
    const type = document.getElementById('bizType').value.trim();

    if (!name || !type) {
      Toast.error('Please fill in both the business name and what kind of business it is.');
      return;
    }

    try {
      if (this.editingBizId) {
        await ApiService.updateBusiness(this.editingBizId, { name, type });
        Toast.success(`"${name}" has been updated.`);
      } else {
        await ApiService.createBusiness({ name, type });
        Toast.success(`"${name}" has been added.`);
      }
      ModalManager.close('bizModal');
      this.editingBizId = null;

      await this.renderBusinesses();
      await this.renderCommandCentre();
      await this.populateClientModalBizSelect();
    } catch (err) {
      Toast.error(err.message || 'Could not save that business.');
    }
  }

  async openTrinovaNoteModal(entryIndex) {
    const entry = (this.privateNotes || [])[entryIndex];
    if (!entry) return;

    this.selectedBrainEntryForTrinova = entry;

    const contentInput = document.getElementById('trinovaNoteContent');
    if (contentInput) contentInput.value = entry.text;

    // Explicitly uncheck confirmation box per privacy boundary
    const confirmBox = document.getElementById('trinovaNoteConfirm');
    confirmBox.checked = false;

    const clients = await this.getClientChoices();
    const companySelect = document.getElementById('trinovaNoteCompany');
    if (companySelect) {
      companySelect.innerHTML = clients.map(c => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`).join('');
    }

    ModalManager.open('trinovaNoteModal');
  }

  async handleSendNoteToTrinova() {
    const text = document.getElementById('trinovaNoteContent').value.trim();
    const clientId = document.getElementById('trinovaNoteCompany').value;
    const confirmBox = document.getElementById('trinovaNoteConfirm');

    if (!confirmBox || !confirmBox.checked) {
      Toast.error('Please tick the box to confirm you want to copy this note.');
      return;
    }

    if (!text) {
      Toast.error('Note text cannot be empty.');
      return;
    }

    const client = (this.lastClients || []).find(c => String(c.id || c.clientId) === clientId);
    if (!client) {
      Toast.error('Please choose which client the note is for.');
      return;
    }

    try {
      const res = await ApiService.sendNoteToTrinova({
        companyId: this.companyRef(client),
        text,
        visibility: 'staff_only'
      });

      ModalManager.close('trinovaNoteModal');
      Toast.success(`Copied to ${client.name}'s notes.`);
      this.logToTrinovaConsole(`Note copied to ${client.name} (${res.message})`);
      if (String(this.activeClient360Id) === clientId) {
        await this.renderClientNotesDetail();
        await this.renderTimeline(this.activeClient360Id);
      }
    } catch (err) {
      Toast.error(err.message || 'The note could not be copied.');
    }
  }

  async handleSyncCompaniesHouse() {
    const statusText = document.getElementById('chSyncStatusText');
    if (statusText) statusText.textContent = 'Checking Companies House... this can take a minute.';

    const result = await ApiService.syncCompaniesHouse();
    let msg;
    let ok = true;
    if (!result.reachedServer) {
      ok = false;
      msg = 'The Companies House check could not be run. Please try again in a minute.';
    } else if (result.totalRequested === 0) {
      msg = 'There are no companies to check yet.';
    } else if (result.syncedCount === 0) {
      ok = false;
      msg = `Companies House could not be reached for any of the ${result.totalRequested} companies. Ask your Sloane administrator to check the Companies House setting.`;
    } else if (result.failedCount > 0) {
      msg = `Checked ${result.syncedCount} of ${result.totalRequested} companies with Companies House. ${result.failedCount} could not be checked.`;
    } else {
      msg = `Checked all ${result.syncedCount} companies with Companies House.`;
    }

    if (ok) Toast.success(msg); else Toast.error(msg);
    this.logToTrinovaConsole(`Companies House check: ${msg}`);

    if (statusText) {
      statusText.textContent = `${msg} (${new Date(result.syncedAt).toLocaleTimeString('en-GB')})`;
    }

    await this.renderStatutory();
    await this.renderCommandCentre();
  }

  switchClientTab(tabName) {
    this.activeClientTab = tabName;

    document.querySelectorAll('.client-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-client-tab') === tabName);
    });

    document.querySelectorAll('.client-tab-content').forEach(content => {
      content.classList.add('hidden');
    });

    const activeContent = document.getElementById(`clientTabContent-${tabName}`);
    if (activeContent) {
      activeContent.classList.remove('hidden');
    }

    if (tabName === 'timeline') {
      this.renderTimeline(this.activeClient360Id);
    } else if (tabName === 'statutory') {
      this.renderClientStatutoryDetail(this.activeClient360Id);
    } else if (tabName === 'documents') {
      this.renderClientDocumentsDetail(this.activeClient360Id);
    } else if (tabName === 'notes') {
      this.renderClientNotesDetail(this.activeClient360Id);
    } else if (tabName === 'tasks') {
      this.renderClientTasksDetail(this.activeClient360Id);
    }
  }

  selectClient360(clientId) {
    if (!clientId) return;
    const sanitized = String(clientId);
    this.activeClient360Id = sanitized;
    this.switchView('clients');
    this.switchClientTab('timeline');
  }

  async renderTimeline(clientId = this.activeClient360Id, forceToast = false) {
    if (!this.lastClients || this.lastClients.length === 0) await this.ensureClients();
    clientId = clientId ? String(clientId) : (this.lastClients[0] ? String(this.lastClients[0].id || this.lastClients[0].clientId) : '');
    this.activeClient360Id = clientId;

    const container = document.getElementById('timelineEventsContainer');
    if (!container) return;

    // Loading State
    container.innerHTML = `
      <div class="timeline-loading">
        <div class="ai-pulse-bar" style="margin: 0 auto 10px auto;"></div>
        <span>Reviewing chronological practice records...</span>
      </div>
    `;

    // Retrieve client metadata to populate header
    const clients = this.lastClients || [];
    const activeClient = clients.find(c => String(c.id || c.clientId) === clientId);

    if (!activeClient) {
      const nameEl0 = document.getElementById('timelineActiveClientName');
      if (nameEl0) nameEl0.textContent = 'No client chosen';
      container.innerHTML = `<div class="timeline-empty"><strong style="color: var(--text);">No clients yet</strong><p style="margin: 4px 0 0 0;">Add a client first (the "+ Add a client" button), then its history shows here.</p></div>`;
      return;
    }

    const nameEl = document.getElementById('timelineActiveClientName');
    if (nameEl) nameEl.textContent = activeClient.name;

    const typeEl = document.getElementById('timelineActiveClientType');
    if (typeEl) typeEl.textContent = activeClient.no ? `Company number ${activeClient.no}` : '';

    const bizEl = document.getElementById('timelineActiveClientBiz');
    if (bizEl) bizEl.textContent = activeClient.assignedBusiness || activeClient.biz || '';

    const statusEl = document.getElementById('timelineActiveClientStatus');
    if (statusEl) statusEl.style.display = 'none';

    const barEl = document.getElementById('timelineClientBar');
    if (barEl) barEl.innerHTML = this.clientBarHtml(activeClient, false);

    const selectEl = document.getElementById('timelineClientSelect');
    if (selectEl && selectEl.value !== clientId) {
      selectEl.value = clientId;
    }

    try {
      // Query Timeline API (Section 11)
      const res = await ApiService.getClientTimeline(clientId, {
        event_type: this.timelineEventTypeFilter,
        severity: this.timelineSeverityFilter
      });

      const events = res.data || [];
      this.timelineEvents = events;

      // Update badge
      const countBadge = document.getElementById('clientTimelineCountBadge');
      if (countBadge) countBadge.textContent = `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`;

      const connBadge = document.getElementById('timelineConnectionBadge');
      if (connBadge) {
        if (res.source === 'trinova_live') {
          connBadge.textContent = 'Up to date';
          connBadge.className = 'pill green';
          connBadge.title = 'Loaded from your Sloane server just now';
        } else {
          connBadge.textContent = 'Could not reach Sloane';
          connBadge.className = 'pill amber';
          connBadge.title = 'Showing what was last saved on this device';
        }
      }

      if (events.length === 0) {
        container.innerHTML = `
          <div class="timeline-empty">
            <div style="font-size: 24px; margin-bottom: 8px;">⏱️</div>
            <strong style="color: var(--text);">No timeline records found</strong>
            <p style="margin: 4px 0 12px 0;">No chronological events match the current filters for ${escapeHtml(activeClient.name)}.</p>
            <button type="button" class="btn btn-secondary" style="font-size: 11px;" onclick="app.timelineEventTypeFilter=''; app.timelineSeverityFilter=''; document.getElementById('timelineEventTypeFilter').value=''; document.getElementById('timelineSeverityFilter').value=''; app.renderTimeline('${clientId}')">Clear Filters</button>
          </div>
        `;
        return;
      }

      // Group Events Chronologically: Today, Yesterday, Earlier This Week, Older
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const groups = {
        'Today': [],
        'Yesterday': [],
        'Earlier This Week': [],
        'Older': []
      };

      events.forEach(evt => {
        const evtDate = new Date(evt.occurredAt);
        evtDate.setHours(0, 0, 0, 0);

        if (evtDate.getTime() === today.getTime()) {
          groups['Today'].push(evt);
        } else if (evtDate.getTime() === yesterday.getTime()) {
          groups['Yesterday'].push(evt);
        } else if (evtDate.getTime() >= sevenDaysAgo.getTime()) {
          groups['Earlier This Week'].push(evt);
        } else {
          groups['Older'].push(evt);
        }
      });

      let html = '';
      for (const [groupName, groupEvents] of Object.entries(groups)) {
        if (groupEvents.length === 0) continue;

        html += `
          <div class="timeline-date-group">
            <div class="timeline-date-title">
              <span>📅 ${escapeHtml(groupName)}</span>
              <span style="opacity: 0.7; font-size: 10px;">(${groupEvents.length})</span>
            </div>
            ${groupEvents.map(evt => {
              const timeStr = new Date(evt.occurredAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              const dateStr = new Date(evt.occurredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              const nodeClass = evt.severity === 'critical' ? 'node-critical' : evt.severity === 'urgent' ? 'node-urgent' : evt.severity === 'info' ? 'node-info' : '';
              const sevPillClass = evt.severity === 'critical' ? 'red' : evt.severity === 'urgent' ? 'amber' : evt.severity === 'info' ? 'blue' : 'neutral';
              const safeEvtId = sanitizeId(evt.id);
              const safeTitle = escapeHtml(evt.title);
              const safeSeverity = escapeHtml(HISTORY_IMPORTANCE[evt.severity] || evt.severity);
              const safeEventType = escapeHtml(HISTORY_KIND[evt.eventType] || (evt.eventType || '').replace(/_/g, ' ').toLowerCase());
              const safeDescription = escapeHtml(evt.description || 'No more details were written down.');
              const safeActor = escapeHtml(this.describeActor(evt));
              const safeSource = escapeHtml(HISTORY_SOURCE[evt.source] || evt.source);
              
              return `
                <div class="timeline-item" id="timeline-event-${safeEvtId}">
                  <div class="timeline-node ${nodeClass}"></div>
                  <div class="timeline-card">
                    <div class="timeline-card-header">
                      <div>
                        <div class="timeline-card-title">${safeTitle}</div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                          <span class="pill ${sevPillClass}" style="font-size: 9.5px; padding: 1px 6px;">${safeSeverity}</span>
                          <span class="source-badge" style="font-size: 9.5px;">${safeEventType}</span>
                          ${evt.visibility === 'private' ? '<span class="pill red" style="font-size: 9.5px;">🔒 Only you</span>' : ''}
                        </div>
                      </div>
                      <div class="timeline-card-time">${dateStr} · ${timeStr}</div>
                    </div>
                    <div class="timeline-card-body">
                      ${safeDescription}
                    </div>
                    <div class="timeline-card-footer">
                      <div class="row-actions" style="margin: 0 0 8px 0;">
                        ${evt.source === 'user' ? `<button type="button" class="card-action-btn" data-action="openHistoryForm" data-id="${escapeHtml(evt.id)}">✎ Edit</button>` : ''}
                        <button type="button" class="card-action-btn text-red" data-action="deleteHistoryEntry" data-id="${escapeHtml(evt.id)}">🗑 Delete</button>
                      </div>
                      <div class="timeline-card-tags">
                        <span class="timeline-actor-tag">
                          <span>👤</span>
                          <span>${safeActor}</span>
                        </span>
                        <span class="timeline-actor-tag" style="color: var(--accent);">
                          <span>🔌</span>
                          <span>${safeSource}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      container.innerHTML = html;
      if (forceToast) Toast.success(`Timeline updated: ${events.length} records loaded.`);

    } catch (err) {
      container.innerHTML = `
        <div class="timeline-empty" style="border-color: var(--red);">
          <strong style="color: var(--red);">Unable to retrieve timeline</strong>
          <p style="margin: 4px 0 12px 0;">Error communicating with TriNova API: ${escapeHtml(err.message)}</p>
          <button type="button" class="btn btn-secondary" onclick="app.renderTimeline('${clientId}')">Retry</button>
        </div>
      `;
    }
  }

  async handleLogTimelineEvent() {
    if (this._isSubmittingTimelineEvent) return;
    const submitBtn = document.getElementById('btnSubmitTimelineEvent');

    const clientId = document.getElementById('modalTimelineClientId')?.value;
    const eventType = document.getElementById('modalTimelineEventType')?.value;
    const title = document.getElementById('modalTimelineTitle')?.value?.trim();
    const description = document.getElementById('modalTimelineDesc')?.value?.trim() || '';
    const severity = document.getElementById('modalTimelineSeverity')?.value || 'normal';
    const visibility = document.getElementById('modalTimelineVisibility')?.value || 'shared';

    if (!clientId) {
      Toast.error('Please choose a client.');
      return;
    }

    if (!title) {
      Toast.error('Please give the entry a short title.');
      return;
    }

    try {
      this._isSubmittingTimelineEvent = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      await ApiService.createTimelineEvent(clientId, {
        eventType,
        title,
        description,
        severity,
        visibility,
        source: 'user'
      });

      Toast.success('Added to the client history.');
      ModalManager.closeAll();
      const form = document.getElementById('logTimelineEventForm');
      if (form) form.reset();

      if (this.activeClient360Id === clientId) {
        await this.renderTimeline(clientId);
        await this.renderClientNotesDetail(clientId);
      }
    } catch (err) {
      Toast.error(`Could not save that entry: ${err.message}`);
    } finally {
      this._isSubmittingTimelineEvent = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save to Timeline';
      }
    }
  }

  // =========================================================================
  // Feature 2: Secure Claude AI Assistant ("Ask Sloane") (Section 18-41)
  // =========================================================================

  async handleAskSloane(query, isFollowUp = false) {
    if (!query || !query.trim()) return;

    const modalBody = document.getElementById('aiModalBody');
    const modalSubtitle = document.getElementById('aiModalSubtitle');

    if (modalSubtitle) {
      modalSubtitle.textContent = `Analyzing: "${query.substring(0, 48)}${query.length > 48 ? '...' : ''}"`;
    }

    // Detect target client from query if mentioned, or preserve active conversational context
    const qLower = query.toLowerCase();
    try {
      const knownClients = StorageService.getClients() || [];
      const matched = knownClients.find(c => c.name && qLower.includes(c.name.toLowerCase()));
      if (matched) this.activeAiClientId = matched.id;
    } catch (_) {}

    const targetClientId = this.activeAiClientId || null;

    // Maintain multi-turn conversational history
    if (!this.aiConversationHistory) this.aiConversationHistory = [];
    if (!isFollowUp) {
      this.aiConversationHistory = [];
    }
    this.aiConversationHistory.push({ role: 'user', content: query });

    if (!isFollowUp) {
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="ai-loading-container">
            <div class="ai-pulse-bar"></div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 6px;">
              Sloane is looking into it...
            </div>
            <div style="font-size: 11.5px; color: var(--muted);">
              Looking through your records
            </div>
          </div>
        `;
      }
      ModalManager.open('aiResponseModal');
    } else {
      // For follow-up replies, append the user bubble and show inline loading
      if (modalBody) {
        const safeUserText = String(query).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
        const userBubble = document.createElement('div');
        userBubble.className = 'ai-user-bubble';
        userBubble.innerHTML = `
          <div class="ai-user-bubble-label">Kirsty Allen (CEO)</div>
          <div>${safeUserText}</div>
        `;
        modalBody.appendChild(userBubble);

        const inlineLoading = document.createElement('div');
        inlineLoading.id = 'aiInlineLoading';
        inlineLoading.className = 'ai-loading-container';
        inlineLoading.style.padding = '16px 10px';
        inlineLoading.innerHTML = `
          <div class="ai-pulse-bar" style="width: 40px; height: 3px;"></div>
          <div style="font-size: 11.5px; color: var(--muted);">Sloane is looking into it...</div>
        `;
        modalBody.appendChild(inlineLoading);
        modalBody.scrollTop = modalBody.scrollHeight;
      }
    }

    let res = null;
    try {
      res = await ApiService.askAi({ message: query, history: this.aiConversationHistory, clientId: targetClientId });
    } catch (err) {
      console.warn('[app] ApiService.askAi error, triggering fallback:', err);
      if (ApiService && typeof ApiService.runGroundedFallback === 'function') {
        res = await ApiService.runGroundedFallback({ message: query, history: this.aiConversationHistory, clientId: targetClientId });
      }
    }

    // Record assistant turn in multi-turn conversation history
    if (res?.data?.answer) {
      this.aiConversationHistory.push({ role: 'assistant', content: res.data.answer });
    }

    // Safeguard error response if backend failed completely
    if (!res || !res.data) {
      res = {
        ok: false,
        source: 'error',
        data: {
          response_type: 'conversational',
          answer: 'Sloane could not answer just now. Please try again in a minute.',
          risk_level: null,
          key_reasons: [],
          recommended_actions: [],
          evidence: []
        }
      };
    }

    try {
      const data = res.data || {};
      const isConversational = data.response_type === 'conversational' || data.response_type === 'general_knowledge' || (!data.risk_level && (!data.key_reasons || data.key_reasons.length === 0));

      const riskLevel = data.risk_level;
      const riskClass = riskLevel === 'red' ? 'risk-red' : riskLevel === 'amber' ? 'risk-amber' : riskLevel === 'low' ? 'risk-low' : 'risk-neutral';
      const riskIcon = riskLevel === 'red' ? '🔴 RED: needs action now' : riskLevel === 'amber' ? '🟠 AMBER: keep an eye on this' : riskLevel === 'low' ? '🟢 LOW RISK' : '⚪ SUMMARY';

      const isClaude = res.source === 'anthropic_claude';
      const isGemini = res.source === 'google_gemini';
      const providerBadge = isClaude
        ? `<span class="source-badge ch-live" style="font-size: 10px;">⚡ Claude 3.5 Sonnet</span>`
        : isGemini
        ? `<span class="source-badge ch-live" style="font-size: 10px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">✨ Google Gemini</span>`
        : `<span class="source-badge" style="font-size: 10px; background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);">🛡️ Answered from your saved records (not by AI)</span>`;

      // Remove inline loading if present
      const inlineLoadingEl = document.getElementById('aiInlineLoading');
      if (inlineLoadingEl) inlineLoadingEl.remove();

      if (modalSubtitle) {
        modalSubtitle.textContent = isConversational ? 'Conversation' : 'Based on your own records';
      }

      const cardHtml = `
        <div class="ai-card-shell" style="border: none; padding: 0; box-shadow: none; ${isFollowUp ? 'margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line);' : ''}">
          <div class="ai-card-header" style="margin-bottom: 12px; padding-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 12px; color: var(--muted);">Answered by:</span>
              ${providerBadge}
            </div>
            <div style="font-size: 11px; font-family: var(--font-mono); color: var(--muted);">
              ${res.usage?.durationMs ? `${res.usage.durationMs}ms` : ''}
            </div>
          </div>

          <!-- Risk Banner (Only shown for practice assessments when risk level is present) -->
          ${!isConversational && riskLevel ? `
            <div class="ai-risk-banner ${riskClass}">
              <span>${riskIcon}</span>
            </div>
          ` : ''}

          <!-- Response Text -->
          <div class="ai-answer-text" style="line-height: 1.6; font-size: 13.5px; color: var(--text);">
            ${escapeHtml(data.answer || 'Analysis complete.').replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>')}
          </div>

          <!-- Key Drivers (Only if present) -->
          ${data.key_reasons && data.key_reasons.length > 0 ? `
            <div class="ai-subheading">Why Sloane says this</div>
            <ul class="ai-reasons-list">
              ${data.key_reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          ` : ''}

          <!-- Recommended Actions (Only if present) -->
          ${data.recommended_actions && data.recommended_actions.length > 0 ? `
            <div class="ai-subheading">What to do next</div>
            <div class="ai-actions-grid">
              ${data.recommended_actions.map(act => `
                <div class="ai-action-item">
                  <span class="ai-action-text">${escapeHtml(act.action)}</span>
                  <span class="pill ${act.priority === 'high' ? 'red' : act.priority === 'normal' ? 'amber' : 'neutral'}" style="font-size: 10px; text-transform: uppercase;">
                    ${escapeHtml(act.priority)}
                  </span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <!-- Grounded Evidence Links (Only if present) -->
          ${data.evidence && data.evidence.length > 0 ? `
            <div class="ai-subheading">Where this comes from</div>
            <div class="ai-evidence-box">
              ${data.evidence.map(ev => `
                <div class="ai-evidence-item">
                  <span style="color: #c5d1de;">${escapeHtml(ev.reason || 'Record cited')}</span>
                  ${ev.timeline_event_id ? `
                    <button type="button" class="ai-evidence-link" style="background: none; border: none; font-size: 11px; padding: 2px 6px;" onclick="app.jumpToTimelineEvent('${sanitizeId(ev.timeline_event_id)}', '${sanitizeId(targetClientId || '')}')">
                      View Event #${escapeHtml(ev.timeline_event_id.substring(0, 12))} ↗
                    </button>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;

      if (modalBody) {
        if (!isFollowUp) {
          modalBody.innerHTML = cardHtml;
        } else {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = cardHtml;
          modalBody.appendChild(wrapper);
        }
        modalBody.scrollTop = modalBody.scrollHeight;
      }

      // Re-focus reply input for fast conversational turnaround
      const replyInput = document.getElementById('aiModalReplyInput');
      if (replyInput) replyInput.focus();

    } catch (renderErr) {
      console.error('[app] Rendering error:', renderErr);
    }
  }

  async jumpToTimelineEvent(eventId, clientId) {
    // 1. Close modal
    ModalManager.closeAll();

    // 2. Select client if provided
    if (clientId) {
      this.activeClient360Id = sanitizeId(clientId) || this.activeClient360Id;
    }

    // 3. Switch to Client 360 view
    this.switchView('clients');

    // 4. Switch to Timeline tab
    this.switchClientTab('timeline');

    // 5. Render timeline
    await this.renderTimeline(this.activeClient360Id);

    // 6. Smoothly scroll to target event and highlight with glow
    setTimeout(() => {
      const el = document.getElementById(`timeline-event-${eventId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const card = el.querySelector('.timeline-card');
        if (card) {
          card.classList.add('highlighted-event');
          setTimeout(() => card.classList.remove('highlighted-event'), 4000);
        }
      }
    }, 180);
  }

  /** A plain name for who made a history entry. */
  describeActor(evt) {
    if (evt.actorId === 'actor_kirsty_allen' || evt.actorType === 'user') return 'You';
    if (evt.actorType === 'companies_house') return 'Companies House';
    if (evt.actorType === 'system') return 'Sloane';
    return evt.actorId || evt.actorType || 'Sloane';
  }

  /** Settings page: plain facts about where data is saved and what is connected. */
  async renderSystemStatus() {
    const card = document.getElementById('systemStatusCard');
    if (!card) return;
    const res = await ApiService.getSystemStatus();
    if (res.status !== 'success' || !res.data) {
      card.innerHTML = `<div class="card-header"><h3>How Sloane is set up</h3></div><div class="table-empty" style="padding: 18px;">Sloane could not check its set-up just now.</div>`;
      return;
    }
    const d = res.data;
    const saved = d.storage.persistent;
    const kind = { sqlite: 'a database file on the server', postgres: 'a Postgres database' }[d.storage.kind] || 'the server';
    const row = (ok, title, text) => `
      <div class="status-row">
        <span class="dot ${ok === true ? 'green' : ok === false ? 'red' : ''}" ${ok === null ? 'style="background: var(--muted);"' : ''}></span>
        <div><div class="status-title">${escapeHtml(title)}</div><div class="status-text">${escapeHtml(text)}</div></div>
      </div>`;
    card.innerHTML = `
      <div class="card-header"><h3>How Sloane is set up</h3></div>
      ${row(saved, saved ? 'Your information is saved' : 'Your information is NOT being saved',
        saved ? `Tasks, notes, documents, deadlines and clients you add are kept in ${kind}.${d.storage.lastSavedAt ? ` Last saved ${new Date(d.storage.lastSavedAt).toLocaleString('en-GB')}.` : ''}`
              : 'Sloane has no database to save to, so everything you add will disappear when it restarts. Ask your Sloane administrator to set one up.')}
      ${saved && d.storage.durable === false ? row(false, 'But it is only saved on a temporary disk', 'This server\'s own disk is wiped each time Sloane is updated, so everything you add would be lost then. Ask your Sloane administrator to attach a storage volume (or a Postgres database).') : ''}
      ${d.storage.lastError ? row(false, 'The last save did not work', d.storage.lastError) : ''}
      ${row(d.trinova.configured, d.trinova.configured ? 'TriNova is connected' : 'TriNova is not connected',
        d.trinova.configured ? 'Sloane reads your clients from TriNova. It never changes anything in TriNova.'
                             : 'Sloane has not been given TriNova\'s access key, so it cannot show your TriNova clients. Ask your Sloane administrator to set it up.')}
      ${row(null, 'Signing requests', 'Sloane keeps a record of who you have asked to sign a document. It does not send anything to the signers yet.')}
      ${row(null, `Version ${d.version || 'unknown'}`, d.build ? `Running build ${d.build}. Compare it with the latest commit on GitHub to be sure the newest update is live.` : 'The host did not say which build is running.')}
      ${d.demoData ? row(null, 'Example data is switched on', 'The example clients, tasks and deadlines are only there to show how Sloane works.') : ''}
    `;
  }

  syncProviderDropdowns(provider) {
    const p = provider || ApiService.getAiProvider();
    const topSelect = document.getElementById('topAiProviderSelect');
    const modalSelect = document.getElementById('modalAiProviderSelect');
    const configSelect = document.getElementById('configAiProviderSelect');
    if (topSelect) topSelect.value = p;
    if (modalSelect) modalSelect.value = p;
    if (configSelect) configSelect.value = p;
  }
}

// The Team & Tasks, Deadlines, client page and private notes features live in ./features/.
Object.assign(SloaneApp.prototype, teamTaskMethods, deadlineMethods, clientDetailMethods, privateNoteMethods);

// Instantiate and attach globally for inline handlers
if (typeof window !== 'undefined') {
  window.app = new SloaneApp();
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => window.app.init());
  }
}
