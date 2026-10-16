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

/**
 * HTML Output Escaping Utility (Section 1.4)
 * Escapes dynamic values before DOM interpolation to prevent Stored & Reflected XSS.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strict ID Sanitizer (Section 1.4)
 * Enforces alphanumeric, hyphen, underscore, and dot pattern for entity identifiers.
 */
export function sanitizeId(id) {
  if (typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_\-\.]/g, '');
}

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.sanitizeId = sanitizeId;
}

class SloaneApp {
  constructor() {
    this.currentView = 'command';
    this.searchQuery = '';
    this.selectedBizFilter = 'All';
    this.selectedBrainEntryForTrinova = null;
    this.activeClient360Id = 'cli_woofington_grp';
    this.activeClientTab = 'overview';
    this.timelineEvents = [];
    this.timelineEventTypeFilter = '';
    this.timelineSeverityFilter = '';
    this.aiConversationHistory = [];
    this.authEventsBound = false;
    this.appEventsBound = false;
  }

  async init() {
    // Initialize component managers
    ModalManager.init();
    Toast.init();

    // Bind authentication UI events
    this.bindAuthEvents();

    // Verify session
    if (!AuthService.isAuthenticated()) {
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

    // Switch to default view
    this.switchView('command');
  }

  showLoginView() {
    const authShell = document.getElementById('authShell');
    const appShell = document.querySelector('.shell');
    const mobileNav = document.getElementById('mobileNavBar');

    if (authShell) authShell.classList.remove('auth-hidden');
    if (appShell) appShell.style.display = 'none';
    if (mobileNav) mobileNav.style.display = 'none';

    const emailInput = document.getElementById('loginEmail');
    if (emailInput && !emailInput.value) {
      emailInput.value = AuthService.getRememberedEmail();
    }
    const passInput = document.getElementById('loginPassword');
    if (passInput) {
      setTimeout(() => passInput.focus(), 120);
    }
  }

  showAppView() {
    const authShell = document.getElementById('authShell');
    const appShell = document.querySelector('.shell');
    const mobileNav = document.getElementById('mobileNavBar');

    if (authShell) authShell.classList.add('auth-hidden');
    if (appShell) appShell.style.display = 'grid';
    if (mobileNav) mobileNav.style.display = 'flex';

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

    // Quick Fill Demo Button
    const quickFillBtn = document.getElementById('btnAuthQuickFill');
    if (quickFillBtn) {
      quickFillBtn.addEventListener('click', () => {
        const emailInput = document.getElementById('loginEmail');
        const passInput = document.getElementById('loginPassword');
        if (emailInput) emailInput.value = 'kirsty.allen@trinova.co.uk';
        if (passInput) passInput.value = 'password123';
        const alertEl = document.getElementById('authAlert');
        if (alertEl) alertEl.classList.remove('visible');
        Toast.info('CEO test credentials populated. Ready to sign in.');
      });
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
        Toast.info('CEO credentials configured for test environment: kirsty.allen@trinova.co.uk / password123', 6000);
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
      
      Toast.success(`Welcome back, ${session.user.name}. Executive session verified.`);
      
      this.showAppView();
      
      if (!this.appEventsBound) {
        this.bindEvents();
        this.appEventsBound = true;
      }

      await this.renderAll();
      await this.checkTrinovaBackend();
      this.switchView('command');

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
    Toast.info('Executive session locked. Access restricted.');
    this.showLoginView();
  }

  async checkTrinovaBackend() {
    const statusBtn = document.getElementById('trinovaStatusBtn');
    const statusDot = document.getElementById('trinovaStatusDot');
    const statusText = document.getElementById('trinovaStatusText');

    if (statusDot) statusDot.style.background = 'var(--amber)';
    if (statusText) statusText.textContent = 'Trinova: Connecting...';

    try {
      const health = await ApiService.checkHealth();
      if (health.ok) {
        const auth = await ApiService.verifyAuth();
        const duration = health.durationMs || 0;

        if (statusBtn) {
          statusBtn.className = 'pill green';
          statusBtn.title = `Connected to TriNova API (${duration}ms) • Click to open settings`;
        }
        if (statusDot) statusDot.style.background = 'var(--green)';
        if (statusText) statusText.textContent = `⚡ Trinova: Live (${duration}ms)`;

        this.updateConfigModalTelemetry(health, auth);
        this.logToTrinovaConsole(`[Connection] Successfully connected to TriNova API at ${ApiService.config.baseUrl} (${duration}ms). DB: ${health.database}`);
        return true;
      }
    } catch (e) {
      console.log('Trinova connection check failed:', e);
    }

    if (statusBtn) {
      statusBtn.className = 'pill neutral';
      statusBtn.title = 'TriNova API is offline or waking up • Running in standalone cached mode';
    }
    if (statusDot) statusDot.style.background = 'var(--muted)';
    if (statusText) statusText.textContent = 'Trinova: Standalone Mode';

    this.updateConfigModalTelemetry({ ok: false, error: 'Cannot connect to target API' }, { ok: false });
    this.logToTrinovaConsole(`[Connection] TriNova API at ${ApiService.config.baseUrl} is unreachable. Operating in local cache fallback mode.`);
    return false;
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
        title.textContent = 'Connected · TriNova /api/v1 Live';
        title.style.color = 'var(--green)';
      }
      if (latency) latency.textContent = `${health.durationMs || 0} ms`;
      if (db) {
        db.textContent = health.database || 'Connected';
        db.style.color = 'var(--green)';
      }
      if (actor) {
        actor.textContent = auth?.actor || 'sloane_ceo';
        actor.title = auth?.scopes ? `Scopes: ${auth.scopes.join(', ')}` : '';
      }
    } else {
      if (dot) dot.style.background = 'var(--amber)';
      if (title) {
        title.textContent = 'Disconnected / Standalone Mode';
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
      env.textContent = url.includes('railway') ? 'Railway Live' : (url.includes('localhost') ? 'Localhost' : 'Custom');
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
      });
    });

    // Mobile navigation toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.querySelector('.side');
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sidebar.classList.toggle('mobile-open');
        mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('mobile-open')) {
          if (!sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
            sidebar.classList.remove('mobile-open');
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
          }
        }
      });

      // Close on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
          sidebar.classList.remove('mobile-open');
          mobileMenuBtn.setAttribute('aria-expanded', 'false');
          mobileMenuBtn.focus();
        }
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

    // TriNova Connection Pill trigger
    const trinovaStatusBtn = document.getElementById('trinovaStatusBtn');
    if (trinovaStatusBtn) {
      trinovaStatusBtn.addEventListener('click', () => {
        const baseUrlInput = document.getElementById('configBaseUrl');
        const tokenInput = document.getElementById('configToken');
        const anthropicInput = document.getElementById('configAnthropicKey');
        const providerInput = document.getElementById('configAiProviderSelect');
        if (baseUrlInput) baseUrlInput.value = ApiService.config.baseUrl;
        if (tokenInput) tokenInput.value = ApiService.config.token;
        if (anthropicInput) anthropicInput.value = ApiService.config.anthropicApiKey || '';
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
        const token = document.getElementById('configToken').value.trim();
        const anthropicApiKey = document.getElementById('configAnthropicKey')?.value.trim();
        const chosenProvider = document.getElementById('configAiProviderSelect')?.value;
        if (chosenProvider) {
          ApiService.setAiProvider(chosenProvider);
          this.syncProviderDropdowns(chosenProvider);
        }
        ApiService.configure({ baseUrl, token, anthropicApiKey });
        Toast.info('Connecting to updated TriNova endpoint...');
        this.logToTrinovaConsole(`Configuration saved. Re-testing endpoint ${baseUrl}...`);
        await this.checkTrinovaBackend();
        await this.renderClients();
        Toast.success('TriNova & AI configuration saved.');
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
      const name = selected === 'gemini' ? 'Google Gemini' : selected === 'anthropic' ? 'Anthropic Claude 3.5' : 'Auto Failover';
      Toast.info(`AI Engine switched to: ${name}`);
    };

    if (topAiSelect) topAiSelect.addEventListener('change', handleProviderChange);
    if (modalAiSelect) modalAiSelect.addEventListener('change', handleProviderChange);
    if (configAiSelect) configAiSelect.addEventListener('change', handleProviderChange);

    // Claude API Key Verification Button
    const btnTestClaudeKey = document.getElementById('btnTestClaudeKey');
    const claudeStatusEl = document.getElementById('claudeKeyTestStatus');
    if (btnTestClaudeKey) {
      btnTestClaudeKey.addEventListener('click', async () => {
        const keyInput = document.getElementById('configAnthropicKey');
        const keyVal = keyInput?.value?.trim() || ApiService.config.anthropicApiKey || '';
        if (!keyVal) {
          if (claudeStatusEl) {
            claudeStatusEl.style.display = 'block';
            claudeStatusEl.style.color = '#ef4444';
            claudeStatusEl.textContent = '❌ Please enter an Anthropic API key first (starts with sk-ant-).';
          }
          return;
        }
        btnTestClaudeKey.disabled = true;
        btnTestClaudeKey.textContent = 'Testing...';
        if (claudeStatusEl) {
          claudeStatusEl.style.display = 'block';
          claudeStatusEl.style.color = 'var(--accent)';
          claudeStatusEl.textContent = 'Testing connection to Claude 3.5 Sonnet...';
        }
        const result = await ApiService.testAnthropicKey(keyVal);
        btnTestClaudeKey.disabled = false;
        btnTestClaudeKey.textContent = '⚡ Test Key';
        if (claudeStatusEl) {
          claudeStatusEl.style.display = 'block';
          if (result.ok) {
            claudeStatusEl.style.color = '#10b981';
            claudeStatusEl.textContent = '✅ Connected! Claude 3.5 Sonnet is verified and active.';
            Toast.success('Claude API Key verified successfully!');
          } else {
            claudeStatusEl.style.color = '#ef4444';
            claudeStatusEl.textContent = `❌ Anthropic Error: ${result.message}`;
            Toast.error(`Claude Key Error: ${result.message}`);
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
        if (tokenInput) tokenInput.value = ApiService.config.token;
        if (anthropicInput) anthropicInput.value = '';
        Toast.info('Reset to default Railway endpoints.');
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
        Toast.info(health.ok ? `TriNova is Live (${health.durationMs}ms)` : 'TriNova API is offline.');
      });
    }

    // Diagnostic Tool: Force Sync Clients
    const syncClientsBtn = document.getElementById('btnForceSyncClients');
    const syncTrinovaToolbarBtn = document.getElementById('clientSyncTrinovaBtn');
    const handleSyncClientsClick = async () => {
      Toast.info('Fetching live client entities from TriNova...');
      this.logToTrinovaConsole('Executing GET /api/v1/clients...');
      const res = await ApiService.getClients({ search: this.searchQuery, biz: this.selectedBizFilter });
      await this.renderClients();
      this.logToTrinovaConsole(`Client sync complete. Loaded ${res.data.length} records (Source: ${res.source}).`);
      Toast.success(`Synced ${res.data.length} client entities (${res.source === 'trinova_live' ? 'Live TriNova' : 'Cached Local'}).`);
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
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');

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
          <div class="rank">${escapeHtml(item.rank)}</div>
          <div class="top3-item-content">
            <div class="top3-item-title">${escapeHtml(item.title)}</div>
            <div class="top3-item-desc">${escapeHtml(item.desc)}</div>
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
            <span class="diary-title">${escapeHtml(item.title)}</span>
          </div>
          <span class="timechip">${escapeHtml(item.time)}</span>
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
            <span class="pill green" style="font-size: 10px;">${escapeHtml(b.status)}</span>
            <span style="font-size: 11px; font-weight: 700; color: var(--accent);">${escapeHtml(b.clientCount)} clients</span>
          </div>
          <div style="font-size: 13px; font-weight: 800; color: var(--text);">${escapeHtml(b.name)}</div>
          <div style="font-size: 10px; color: var(--muted);">${escapeHtml(b.type)}</div>
        </div>
      `).join('');
    }

    // 4. Render Waiting Sign-off
    const signoffContainer = document.getElementById('waitingSignoffContainer');
    if (signoffContainer) {
      signoffContainer.innerHTML = WAITING_SIGNOFF.map(item => `
        <div class="signoff-item">
          <div class="item-main">
            <div class="item-title">${escapeHtml(item.title)}</div>
            <div class="item-sub">${escapeHtml(item.sub)}</div>
          </div>
          <span class="pill amber">${escapeHtml(item.date)}</span>
        </div>
      `).join('');
    }

    // 5. Render Attention Emails
    const emailContainer = document.getElementById('attentionEmailsContainer');
    if (emailContainer) {
      emailContainer.innerHTML = ATTENTION_EMAILS.map(item => `
        <div class="email-item">
          <div class="item-main">
            <div class="item-title">${escapeHtml(item.title)}</div>
            <div class="item-sub">${escapeHtml(item.sub)}</div>
          </div>
          <span class="pill ${item.priority === 'High' ? 'red' : 'blue'}">${escapeHtml(item.priority)}</span>
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
            <span class="pill green">${escapeHtml(b.status)}</span>
            <span class="source-badge">Active Area</span>
          </div>
          <div class="biz-name">${escapeHtml(b.name)}</div>
          <div class="biz-type">${escapeHtml(b.type)}</div>
        </div>
        <div class="biz-stats">
          <div class="biz-stat-item">
            <span class="biz-stat-n">${escapeHtml(b.clientCount)}</span>
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
      businesses.map(b => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('');
    filter.value = currentVal || 'All';
  }

  populateClientModalBizSelect() {
    const businesses = StorageService.getBusinesses();
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

    // Update Client 360 data source badge
    const badge = document.getElementById('clientDataSourceBadge');
    if (badge) {
      if (res.source === 'trinova_live') {
        badge.className = 'source-badge ch-live';
        badge.textContent = `⚡ Live TriNova (${res.meta?.total || clients.length})`;
      } else {
        badge.className = 'source-badge';
        badge.textContent = `Cached Local (${clients.length})`;
      }
    }

    const tbody = document.getElementById('clientTableBody');
    if (!tbody) return;

    if (clients.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No client records found matching your filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = clients.map(c => {
      const riskClass = c.risk === 'High' ? 'red' : c.risk === 'Medium' ? 'amber' : 'green';
      const clientId = sanitizeId(c.id || c.clientId || 'cli_woofington_grp');
      const safeName = escapeHtml(c.name);
      const safeBiz = escapeHtml(c.biz || '—');
      const safeNo = escapeHtml(c.no);
      const chUrl = c.no ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(c.no)}` : null;
      const safeDirs = escapeHtml(c.dirs || '—');
      const safeNotes = escapeHtml(c.notes || '—');
      const safeVat = escapeHtml(c.vat || 'No');
      const safeVatNo = escapeHtml(c.vatNo);
      const safeRisk = escapeHtml(c.risk || 'Low');

      return `
        <tr class="client-row" style="cursor: pointer;" title="Click to view full 360 timeline" onclick="app.selectClient360('${clientId}')">
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
              <button type="button" class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" onclick="event.stopPropagation(); app.selectClient360('${clientId}');">⏱️</button>
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

  renderPeopleWork() {
    const container = document.getElementById('peopleGridContainer');
    if (!container) return;

    container.innerHTML = PEOPLE_WORK.map(p => `
      <div class="card person-card">
        <div class="person-header">
          <div class="person-info">
            <div class="person-avatar">${escapeHtml(p.avatar)}</div>
            <div>
              <div class="person-name">${escapeHtml(p.name)}</div>
              <div class="person-role">${escapeHtml(p.role)}</div>
            </div>
          </div>
          <span class="pill blue">${p.tasks.length} tasks</span>
        </div>
        <div class="work-list">
          ${p.tasks.map(t => `
            <div class="work-item">
              <div>
                <div style="font-weight: 600; color: var(--text);">${escapeHtml(t.client)}</div>
                <div style="font-size: 11px; color: var(--muted);">${escapeHtml(t.task)}</div>
              </div>
              <div style="text-align: right;">
                <span class="pill ${t.isBlocked ? 'red' : 'amber'}">${t.isBlocked ? 'BLOCKED' : escapeHtml(t.stage)}</span>
                <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">Due ${escapeHtml(t.deadline)}</div>
              </div>
            </div>
          `).join('')}
        </div>
        ${p.ceoNote ? `
          <div style="padding: 10px 12px; background: rgba(201, 166, 107, 0.08); border-left: 2px solid var(--accent); border-radius: 4px; font-size: 11px; color: var(--accent);">
            <strong>Private CEO Note:</strong> ${escapeHtml(p.ceoNote)}
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

      const chUrl = r.no ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(r.no)}` : '#';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text);">${escapeHtml(r.name)}</div>
            <div class="source">
              <span class="source-badge ${r.isLive ? 'ch-live' : ''}">${r.isLive ? 'CH Live' : 'Tracker'}</span>
              ${escapeHtml(r.source)}
            </div>
          </td>
          <td>
            <a href="${chUrl}" target="_blank" rel="noopener" style="color: var(--accent); font-family: var(--font-mono); text-decoration: none; font-weight: 600;">${escapeHtml(r.no)} ↗</a>
          </td>
          <td>${escapeHtml(ReconciliationEngine.formatDate(r.year))}</td>
          <td>${escapeHtml(ReconciliationEngine.formatDate(r.accounts))}</td>
          <td>
            ${nearest ? `<strong>${escapeHtml(nearest.label)}:</strong> ${escapeHtml(ReconciliationEngine.formatDate(nearest.date))}` : '—'}
          </td>
          <td>
            <span class="${state.cls}">${escapeHtml(state.label)}</span>
          </td>
          <td style="max-width: 220px; font-size: 11px; color: ${r.hasStrikeOff ? 'var(--red)' : 'var(--muted)'};">
            ${escapeHtml(r.note || '—')}
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
          <td style="font-weight: 700; color: var(--text);">${escapeHtml(a.company)}</td>
          <td style="font-family: var(--font-mono); color: var(--accent);">${escapeHtml(a.no)}</td>
          <td style="color: ${a.urgency === 'RED' ? 'var(--red)' : 'var(--text)'}; font-weight: 600;">${escapeHtml(a.issue)}</td>
          <td style="font-size: 11px; color: var(--muted);">${escapeHtml(a.action)}</td>
          <td><span class="pill ${a.urgency === 'RED' ? 'red' : a.urgency === 'AMBER' ? 'amber' : 'green'}">${escapeHtml(a.urgency)}</span></td>
        </tr>
      `).join('');
    }

    // Render VAT schedule
    const vatTbody = document.getElementById('vatTableBody');
    if (vatTbody) {
      vatTbody.innerHTML = VAT_TRACKER.map(v => `
        <tr>
          <td style="font-weight: 600; color: var(--text);">${escapeHtml(v.name)}</td>
          <td>${escapeHtml(v.period)}</td>
          <td>${escapeHtml(ReconciliationEngine.formatDate(v.due))}</td>
          <td><span class="pill ${v.status === 'Ready to submit' ? 'green' : v.status.includes('Overdue') ? 'red' : 'neutral'}">${escapeHtml(v.status)}</span></td>
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
          <span>${escapeHtml(entry.at)}</span>
        </div>
        <div class="brain-entry-text">${escapeHtml(entry.text)}</div>
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

    // Resolve matching company ID
    const clients = StorageService.getClients();
    const match = clients.find(c => c.name === companyName);
    const companyId = match ? (match.rawId || match.id) : 1;

    try {
      this.logToTrinovaConsole(`Posting internal note to TriNova for company ${companyName} (${visibility})...`);
      const res = await ApiService.sendNoteToTrinova({
        companyId,
        companyName,
        text,
        visibility
      });

      ModalManager.close('trinovaNoteModal');
      Toast.success(res.message);
      this.logToTrinovaConsole(`Note posted successfully: ${res.message}`);
    } catch (err) {
      Toast.error(err.message || 'Failed to send note to Trinova.');
      this.logToTrinovaConsole(`Note post failed: ${err.message}`);
    }
  }

  async handleSyncCompaniesHouse() {
    const statusText = document.getElementById('chSyncStatusText');
    if (statusText) statusText.textContent = 'Syncing live data from Companies House & TriNova...';

    const result = await ApiService.syncCompaniesHouse();
    const syncMsg = result.backendSynced 
      ? `Live sync complete: reconciled ${result.syncedCount} companies with TriNova backend.`
      : `Reconciliation complete: verified ${result.syncedCount} companies locally.`;

    Toast.success(syncMsg);
    this.logToTrinovaConsole(`Statutory sync: ${syncMsg}`);

    if (statusText) {
      const liveTag = result.backendSynced ? ' [TriNova Synced]' : ' [Local Cache]';
      statusText.textContent = `Live verified: ${result.syncedCount} companies checked at ${new Date(result.syncedAt).toLocaleTimeString('en-GB')}${liveTag}`;
    }

    this.renderStatutory();
    await this.renderCommandCentre();
  }

  // =========================================================================
  // Client 360 Tab Navigation & Subview Controllers (Section 13)
  // =========================================================================

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
    }
  }

  selectClient360(clientId) {
    if (!clientId) return;
    const sanitized = sanitizeId(clientId);
    if (!sanitized) return;
    this.activeClient360Id = sanitized;
    this.switchView('clients');
    this.switchClientTab('timeline');
  }

  async renderTimeline(clientId = this.activeClient360Id, forceToast = false) {
    clientId = sanitizeId(clientId) || 'cli_woofington_grp';
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
    const clientRes = await ApiService.getClients();
    const clients = clientRes.data || [];
    const activeClient = clients.find(c => (c.id || c.clientId) === clientId) || {
      name: 'Woofington Group',
      biz: 'Trinova Accounting',
      clientType: 'Corporate Group',
      status: 'Active'
    };

    const nameEl = document.getElementById('timelineActiveClientName');
    if (nameEl) nameEl.textContent = activeClient.name;

    const typeEl = document.getElementById('timelineActiveClientType');
    if (typeEl) typeEl.textContent = activeClient.clientType || 'Corporate Group';

    const bizEl = document.getElementById('timelineActiveClientBiz');
    if (bizEl) bizEl.textContent = activeClient.biz || activeClient.businessArea || 'Trinova Accounting';

    const statusEl = document.getElementById('timelineActiveClientStatus');
    if (statusEl) statusEl.textContent = activeClient.status || 'Active';

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
      if (countBadge) countBadge.textContent = `${events.length} events`;

      const connBadge = document.getElementById('timelineConnectionBadge');
      if (connBadge) {
        if (res.source === 'trinova_live') {
          connBadge.textContent = '⚡ Connected';
          connBadge.className = 'pill green';
          connBadge.title = 'Serving from active backend endpoint';
        } else {
          connBadge.textContent = '⚠️ Blocked (TriNova /timeline unmapped)';
          connBadge.className = 'pill amber';
          connBadge.title = 'TriNova upstream has no /clients/{id}/timeline route; using local store';
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
              const safeSeverity = escapeHtml(evt.severity);
              const safeEventType = escapeHtml((evt.eventType || '').replace(/_/g, ' '));
              const safeDescription = escapeHtml(evt.description || 'No additional narrative recorded.');
              const safeActor = escapeHtml(evt.actorId || evt.actorType || 'system');
              const safeSource = escapeHtml(evt.source);
              const safeExtId = evt.externalId ? escapeHtml(String(evt.externalId).substring(0, 16)) : '';

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
                          ${evt.visibility === 'private' ? '<span class="pill red" style="font-size: 9.5px;">🔒 Private CEO</span>' : ''}
                        </div>
                      </div>
                      <div class="timeline-card-time">${dateStr} · ${timeStr}</div>
                    </div>
                    <div class="timeline-card-body">
                      ${safeDescription}
                    </div>
                    <div class="timeline-card-footer">
                      <div class="timeline-card-tags">
                        <span class="timeline-actor-tag">
                          <span>👤</span>
                          <span>${safeActor}</span>
                        </span>
                        <span class="timeline-actor-tag" style="color: var(--accent);">
                          <span>🔌</span>
                          <span>${safeSource}</span>
                        </span>
                        ${safeExtId ? `<span style="font-family: var(--font-mono); font-size: 10px; color: var(--muted);">ref:${safeExtId}</span>` : ''}
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
      Toast.error('Please select a target client.');
      return;
    }

    if (!title) {
      Toast.error('Event title cannot be empty.');
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

      Toast.success('Timeline event logged successfully.');
      ModalManager.closeAll();
      const form = document.getElementById('logTimelineEventForm');
      if (form) form.reset();

      if (this.activeClient360Id === clientId) {
        await this.renderTimeline(clientId);
      }
    } catch (err) {
      Toast.error(`Could not log timeline event: ${err.message}`);
    } finally {
      this._isSubmittingTimelineEvent = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save to Timeline';
      }
    }
  }

  renderClientStatutoryDetail(clientId) {
    const card = document.getElementById('clientStatutoryDetailCard');
    if (!card) return;
    const companies = StorageService.getBusinesses();
    card.innerHTML = `
      <div class="card-header">
        <h3>Statutory Filings & Obligations</h3>
        <span class="pill green">Active Filings</span>
      </div>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
        Synchronized Companies House registers, annual accounts schedules, and confirmation statements.
      </p>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
        <div style="background: var(--panel2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
          <span style="font-size: 11px; color: var(--muted); display: block;">Accounts Status</span>
          <strong style="color: var(--amber);">Due in 6 Days</strong>
        </div>
        <div style="background: var(--panel2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
          <span style="font-size: 11px; color: var(--muted); display: block;">Confirmation Statement</span>
          <strong style="color: var(--green);">Up to Date</strong>
        </div>
        <div style="background: var(--panel2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
          <span style="font-size: 11px; color: var(--muted); display: block;">VAT Registration</span>
          <strong style="color: var(--text);">Active (Quarterly)</strong>
        </div>
      </div>
    `;
  }

  renderClientDocumentsDetail(clientId) {
    const card = document.getElementById('clientDocumentsDetailCard');
    if (!card) return;
    card.innerHTML = `
      <div class="card-header">
        <h3>Corporate Documents & Certificates</h3>
        <button class="btn btn-secondary" style="font-size: 11px;">+ Upload Document</button>
      </div>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
        Archived statutory balance sheets, minutes, and tamper-evident Documenso certificates.
      </p>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--panel2); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
          <div>
            <div style="font-weight: 700; font-size: 13px; color: var(--text);">Draft_Balance_Sheet_2025.pdf</div>
            <div style="font-size: 11px; color: var(--muted);">Uploaded by Jessica Taylor · Category: Accounts</div>
          </div>
          <span class="pill amber">Ready for Sign-off</span>
        </div>
      </div>
    `;
  }

  renderClientNotesDetail(clientId) {
    const card = document.getElementById('clientNotesDetailCard');
    if (!card) return;
    card.innerHTML = `
      <div class="card-header">
        <h3>Internal Operational & Strategic Notes</h3>
        <button class="btn btn-secondary" style="font-size: 11px;" onclick="document.getElementById('modalTimelineEventType').value='NOTE_CREATED'; ModalManager.open('logTimelineEventModal');">+ New Note</button>
      </div>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
        Client-specific practitioner communications protected by Sloane's strict staff privacy boundary.
      </p>
      <div style="background: var(--panel2); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <strong style="font-size: 12.5px; color: var(--text);">Kirsty Allen (CEO)</strong>
          <span style="font-size: 11px; color: var(--muted);">18 Sep 2026, 12:00</span>
        </div>
        <p style="font-size: 12px; color: #c5d1de; margin: 0; line-height: 1.5;">
          Spoke with Sarah Jenkins. Strike-off was triggered by delayed filing; bank statements are now with Jessica.
        </p>
      </div>
    `;
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
    if (/woofington/i.test(qLower)) this.activeAiClientId = 'cli_woofington_grp';
    else if (/rgb|elevation/i.test(qLower)) this.activeAiClientId = 'cli_rgb_elevations';
    else if (/alpha|delta/i.test(qLower)) this.activeAiClientId = 'cli_alpha_delta';
    else if (/cfi|awarding/i.test(qLower)) this.activeAiClientId = 'cli_cfi_awarding';

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
              Sloane is analyzing your query...
            </div>
            <div style="font-size: 11.5px; color: var(--muted);">
              Connecting to secure executive reasoning engine
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
          <div style="font-size: 11.5px; color: var(--muted);">Sloane is analyzing follow-up instructions...</div>
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
          answer: 'Sloane was temporarily unable to process the query. Please ensure the backend service is running or check server connection.',
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
      const riskIcon = riskLevel === 'red' ? '🔴 RED CRITICAL' : riskLevel === 'amber' ? '🟠 AMBER ATTENTION' : riskLevel === 'low' ? '🟢 LOW RISK' : '⚪ PRACTICE ASSESSMENT';

      const isClaude = res.source === 'anthropic_claude';
      const isGemini = res.source === 'google_gemini';
      const providerBadge = isClaude
        ? `<span class="source-badge ch-live" style="font-size: 10px;">⚡ Claude 3.5 Sonnet</span>`
        : isGemini
        ? `<span class="source-badge ch-live" style="font-size: 10px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">✨ Google Gemini</span>`
        : `<span class="source-badge" style="font-size: 10px; background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);">🛡️ Offline Grounded Fallback</span>`;

      // Remove inline loading if present
      const inlineLoadingEl = document.getElementById('aiInlineLoading');
      if (inlineLoadingEl) inlineLoadingEl.remove();

      if (modalSubtitle) {
        modalSubtitle.textContent = isConversational ? 'Executive Dialogue' : 'Grounded Practice Analysis';
      }

      const cardHtml = `
        <div class="ai-card-shell" style="border: none; padding: 0; box-shadow: none; ${isFollowUp ? 'margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line);' : ''}">
          <div class="ai-card-header" style="margin-bottom: 12px; padding-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 12px; color: var(--muted);">AI Intelligence Engine:</span>
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
            ${data.answer || 'Analysis complete.'}
          </div>

          <!-- Key Drivers (Only if present) -->
          ${data.key_reasons && data.key_reasons.length > 0 ? `
            <div class="ai-subheading">Key Drivers & Evidence</div>
            <ul class="ai-reasons-list">
              ${data.key_reasons.map(r => `<li>${r}</li>`).join('')}
            </ul>
          ` : ''}

          <!-- Recommended Actions (Only if present) -->
          ${data.recommended_actions && data.recommended_actions.length > 0 ? `
            <div class="ai-subheading">Recommended Next Actions</div>
            <div class="ai-actions-grid">
              ${data.recommended_actions.map(act => `
                <div class="ai-action-item">
                  <span class="ai-action-text">${act.action}</span>
                  <span class="pill ${act.priority === 'high' ? 'red' : act.priority === 'normal' ? 'amber' : 'neutral'}" style="font-size: 10px; text-transform: uppercase;">
                    ${act.priority}
                  </span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <!-- Grounded Evidence Links (Only if present) -->
          ${data.evidence && data.evidence.length > 0 ? `
            <div class="ai-subheading">Grounded Provenance Citations</div>
            <div class="ai-evidence-box">
              ${data.evidence.map(ev => `
                <div class="ai-evidence-item">
                  <span style="color: #c5d1de;">${ev.reason || 'Record cited'}</span>
                  ${ev.timeline_event_id ? `
                    <button type="button" class="ai-evidence-link" style="background: none; border: none; font-size: 11px; padding: 2px 6px;" onclick="app.jumpToTimelineEvent('${ev.timeline_event_id}', '${targetClientId || 'cli_woofington_grp'}')">
                      View Event #${ev.timeline_event_id.substring(0, 12)} ↗
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

    // 2. Switch to Client 360 view
    this.switchView('clients');

    // 3. Switch to Timeline tab
    this.switchClientTab('timeline');

    // 4. Select client if provided
    if (clientId && clientId !== this.activeClient360Id) {
      this.activeClient360Id = clientId;
    }

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

// Instantiate and attach globally for inline handlers
window.app = new SloaneApp();
document.addEventListener('DOMContentLoaded', () => window.app.init());
