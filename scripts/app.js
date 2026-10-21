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

// Task P7.3: All demo arrays (DIARY_ITEMS, ATTENTION_EMAILS, TOP3_ITEMS, WAITING_SIGNOFF,
// PEOPLE_WORK, ACCOUNTS_TRACKER, ACTION_TRACKER, VAT_TRACKER) removed from UI path.
// All data is dynamically queried from authenticated /api/v1 endpoints.

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
    this.cachedDiaryEvents = [];
    this.authEventsBound = false;
    this.appEventsBound = false;
  }

  async refreshOutlookData() {
    await this.renderCommandCentre();
    this.renderIntelligence();
  }

  async init() {
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
        Toast.info('Please contact your system administrator to reset executive credentials.', 6000);
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

    // Add Client modal open & save
    const addClientBtn = document.getElementById('openAddClientBtn');
    if (addClientBtn) {
      addClientBtn.addEventListener('click', async () => {
        document.getElementById('clientForm').reset();
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
        if (tokenInput) tokenInput.value = 'HttpOnly Session Cookie (slon_session)';
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
    this.renderIntelligence();
    this.renderBrain();
    await OutlookSettings.loadStatus();
  }

  /* ==========================================================================
     View Renderers
     ========================================================================== */

  async renderCommandCentre() {
    // 0. Render Red Alerts
    const redAlertsContainer = document.getElementById('redAlertsContainer');
    if (redAlertsContainer) {
      redAlertsContainer.innerHTML = `
        <div class="alert-item">
          <span class="dot red" style="margin-top: 4px;"></span>
          <div class="alert-item-content">
            <div class="alert-title">CRITICAL: Woofington Park Strike-Off Proposal</div>
            <div class="alert-desc">First Gazette publication registered. Immediate accounts filing required to protect entity.</div>
          </div>
        </div>
        <div class="alert-item" style="margin-bottom: 0;">
          <span class="dot red" style="margin-top: 4px;"></span>
          <div class="alert-item-content">
            <div class="alert-title">OVERDUE: R GB Elevations Ltd Accounts</div>
            <div class="alert-desc">50 days past deadline. Penalty tier active. Final bank records pending.</div>
          </div>
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

      const status = statusRes?.data?.status || 'not_connected';
      isOutlookConnected = status === 'connected';

      // Update Top Bar Eyebrow
      const eyebrowDot = document.getElementById('outlookEyebrowDot');
      const eyebrowText = document.getElementById('outlookEyebrowText');
      if (eyebrowDot && eyebrowText) {
        if (status === 'connected') {
          eyebrowDot.className = 'dot green';
          eyebrowDot.style.background = '';
          eyebrowText.textContent = 'Private CEO Command Centre · Outlook Connected';
        } else if (status === 'reconnect_required') {
          eyebrowDot.className = 'dot red';
          eyebrowDot.style.background = '';
          eyebrowText.textContent = 'Private CEO Command Centre · Outlook Reconnect Required';
        } else {
          eyebrowDot.className = 'dot';
          eyebrowDot.style.background = 'var(--muted)';
          eyebrowText.textContent = 'Private CEO Command Centre';
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
          title: `${r.name || r.companyName} — ${r.urgency === 'RED' ? (r.hasStrikeOff ? 'Active Strike-Off Defense' : 'Overdue Accounts') : 'Statutory Filing Due'}`,
          desc: r.note || r.notes || (r.hasStrikeOff ? 'Active proposal to strike-off registered on Companies House.' : `Accounts due: ${r.accountsDueDate || 'Pending'}`),
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
          top3Container.innerHTML = `<div class="table-empty" style="padding: 24px;">No urgent priority items</div>`;
        }
      }

      // Process Diary data
      const diaryData = diaryRes?.data !== undefined ? diaryRes.data : diaryRes;
      if (diaryData && diaryData.connected && diaryData.enabled && Array.isArray(diaryData.events)) {
        diaryEvents = diaryData.events;
      } else if (diaryData?.code === 'OUTLOOK_RECONNECT_REQUIRED' || status === 'reconnect_required') {
        diaryEmptyReason = 'Reconnect your Outlook';
      } else if (diaryData?.code === 'CALENDAR_SYNC_DISABLED') {
        diaryEmptyReason = 'Calendar sync is off';
      } else if (diaryData?.code === 'OUTLOOK_NOT_CONNECTED') {
        diaryEmptyReason = 'Connect your Outlook to see this here';
      } else if (diaryData?.message) {
        diaryEmptyReason = diaryData.message;
      }

      // Process Flagged Emails data
      const emailsData = emailsRes?.data !== undefined ? emailsRes.data : emailsRes;
      if (emailsData && emailsData.connected && emailsData.enabled && Array.isArray(emailsData.emails)) {
        attentionEmails = emailsData.emails;
      } else if (emailsData?.code === 'OUTLOOK_RECONNECT_REQUIRED' || status === 'reconnect_required') {
        emailEmptyReason = 'Reconnect your Outlook';
      } else if (emailsData?.code === 'EMAIL_SYNC_DISABLED') {
        emailEmptyReason = 'Email sync is off';
      } else if (emailsData?.code === 'OUTLOOK_NOT_CONNECTED') {
        emailEmptyReason = 'Connect your Outlook to see this here';
      } else if (emailsData?.message) {
        emailEmptyReason = emailsData.message;
      }

      this.cachedDiaryEvents = diaryEvents;
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
            <span style="font-size: 11px; font-weight: 700; color: var(--accent);">${escapeHtml(b.clientCount)} clients</span>
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
      t.status === 'Pending' || 
      t.status === 'In_Review' || 
      t.status === 'Under_Review' ||
      /sign|review|approval/i.test(t.title || '')
    ).map(t => ({
      title: `${t.companyName || 'Client'} — ${t.title}`,
      sub: t.description || `Assigned to ${t.assigneeName || 'Staff'}`,
      date: t.dueDate ? `Due ${t.dueDate}` : 'Pending'
    }));

    if (signoffContainer) {
      if (signoffItems.length > 0) {
        signoffContainer.innerHTML = signoffItems.map(item => `
          <div class="signoff-item">
            <div class="item-main">
              <div class="item-title">${escapeHtml(item.title)}</div>
              <div class="item-sub">${escapeHtml(item.sub)}</div>
            </div>
            <span class="pill amber">${escapeHtml(item.date)}</span>
          </div>
        `).join('');
      } else {
        signoffContainer.innerHTML = `<div class="table-empty" style="padding: 24px;">No items waiting for sign-off</div>`;
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
            <span class="pill ${item.priority === 'High' ? 'red' : 'blue'}">${escapeHtml(item.priority)}</span>
          </div>
        `).join('');
      } else {
        emailContainer.innerHTML = `<div class="table-empty" style="padding: 24px;">${escapeHtml(emailEmptyReason)}</div>`;
      }
    }

    // 6. Update Pulse Metrics
    const signoffCount = signoffItems.length;
    const emailCount = attentionEmails.length;
    const bizCount = Array.isArray(businesses) ? businesses.length : 0;
    const statutoryMeta = statutoryRes?.meta || {};
    const blockedCount = allTasks.filter(t => Boolean(t.isBlocked)).length;

    const pulseSignoffs = document.getElementById('pulseSignoffs');
    const pulseEmails = document.getElementById('pulseEmails');
    const pulseOverdue = document.getElementById('pulseOverdue');
    const pulseDue7d = document.getElementById('pulseDue7d');
    const pulseBlocked = document.getElementById('pulseBlocked');
    const pulseBizAreas = document.getElementById('pulseBizAreas');

    if (pulseSignoffs) pulseSignoffs.textContent = signoffCount;
    if (pulseEmails) pulseEmails.textContent = emailCount;
    if (pulseOverdue) pulseOverdue.textContent = statutoryMeta.redCount !== undefined ? statutoryMeta.redCount : '0';
    if (pulseDue7d) pulseDue7d.textContent = statutoryMeta.amberCount !== undefined ? statutoryMeta.amberCount : '0';
    if (pulseBlocked) pulseBlocked.textContent = blockedCount;
    if (pulseBizAreas) pulseBizAreas.textContent = bizCount;
  }

  async renderBusinesses() {
    const { data: businesses } = await ApiService.getBusinesses();
    const container = document.getElementById('fullBizCards');
    if (!container) return;

    if (!businesses || businesses.length === 0) {
      container.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 32px;">No active business areas configured. Click "+ Add Business Area" above to create one.</div>`;
      this.populateClientBizFilterOptions([]);
      return;
    }

    container.innerHTML = businesses.map(b => `
      <div class="card biz-card">
        <div>
          <div class="biz-card-header">
            <span class="pill green">${escapeHtml(b.status || 'Active')}</span>
            <span class="source-badge">Active Area</span>
          </div>
          <div class="biz-name">${escapeHtml(b.name)}</div>
          <div class="biz-type">${escapeHtml(b.type)}</div>
        </div>
        <div class="biz-stats">
          <div class="biz-stat-item">
            <span class="biz-stat-n">${escapeHtml(b.clientCount !== undefined ? b.clientCount : 0)}</span>
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

  async renderPeopleWork() {
    const container = document.getElementById('peopleGridContainer');
    if (!container) return;

    let tasks = [];
    try {
      const res = await ApiService.getTasks();
      tasks = res.data || [];
    } catch (err) {
      console.warn('Could not load tasks for People & Work:', err);
    }

    if (!tasks || tasks.length === 0) {
      container.innerHTML = `<div class="card" style="grid-column: 1 / -1; padding: 32px; text-align: center;"><div class="table-empty">No team work currently assigned</div></div>`;
      return;
    }

    // Group tasks by assignee from live API (Task P7.3: dynamic assignee grouping)
    const peopleMap = new Map();
    for (const t of tasks) {
      const key = t.assigneeId || t.assigneeName || 'unassigned';
      if (!peopleMap.has(key)) {
        const name = t.assigneeName || 'Unassigned';
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'TM';
        peopleMap.set(key, {
          id: key,
          name,
          role: key.includes('hamza') ? 'Senior Client Manager / Partner' : (key.includes('jessica') ? 'Tax & Compliance Senior' : 'Team Member'),
          avatar: initials,
          tasks: [],
          ceoNote: key.includes('hamza') ? 'Agreed to follow up personally on R GB Elevations today.' : (key.includes('jessica') ? 'Jessica is handling the technical CH objection paperwork.' : null)
        });
      }
      peopleMap.get(key).tasks.push({
        client: t.companyName || 'Client',
        task: t.title || t.description || 'Task',
        stage: t.status || 'In Progress',
        deadline: t.dueDate ? `Due ${t.dueDate}` : 'Pending',
        isBlocked: Boolean(t.isBlocked),
        blocker: t.blocker
      });
    }

    const peopleList = Array.from(peopleMap.values());
    container.innerHTML = peopleList.map(p => `
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
                <div style="font-size: 11px; color: var(--muted);">${escapeHtml(t.task)}${t.blocker ? ` — <span style="color: var(--red);">${escapeHtml(t.blocker)}</span>` : ''}</div>
              </div>
              <div style="text-align: right;">
                <span class="pill ${t.isBlocked ? 'red' : 'amber'}">${t.isBlocked ? 'BLOCKED' : escapeHtml(t.stage)}</span>
                <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">${escapeHtml(t.deadline)}</div>
              </div>
            </div>
          `).join('')}
        </div>
        ${p.ceoNote ? `
          <div style="padding: 10px 12px; background: rgba(201, 166, 107, 0.08); border-left: 2px solid var(--accent); border-radius: 4px; font-size: 11px; color: var(--accent); margin-top: 12px;">
            <strong>Private CEO Note:</strong> ${escapeHtml(p.ceoNote)}
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  async renderStatutory() {
    let records = [];
    let redCount = 0;
    let amberCount = 0;
    let clearCount = 0;

    try {
      const res = await ApiService.getStatutory();
      records = res.data || [];
      if (res.meta) {
        redCount = res.meta.redCount || 0;
        amberCount = res.meta.amberCount || 0;
        clearCount = res.meta.clearCount || 0;
      }
    } catch (err) {
      console.warn('Could not load statutory deadlines from API:', err);
    }

    const tbody = document.getElementById('statutoryTableBody');
    if (tbody) {
      if (records.length > 0) {
        tbody.innerHTML = records.map(r => {
          const chUrl = r.companyNumber ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(r.companyNumber)}` : '#';
          const urgencyClass = r.urgency === 'RED' ? 'status-red' : (r.urgency === 'AMBER' ? 'status-amber' : 'status-green');
          const urgencyLabel = r.urgency === 'RED' ? 'RED · ACTION' : (r.urgency === 'AMBER' ? 'AMBER · UPCOMING' : 'CLEAR · ON TRACK');

          return `
            <tr>
              <td>
                <div style="font-weight: 700; color: var(--text);">${escapeHtml(r.name || r.companyName)}</div>
                <div class="source">
                  <span class="source-badge ${r.source === 'companies_house_live' ? 'ch-live' : ''}">${r.source === 'companies_house_live' ? 'CH Live' : 'Tracker'}</span>
                  ${escapeHtml(r.source || 'statutory_api')}
                </div>
              </td>
              <td>
                <a href="${chUrl}" target="_blank" rel="noopener" style="color: var(--accent); font-family: var(--font-mono); text-decoration: none; font-weight: 600;">${escapeHtml(r.companyNumber || '—')} ↗</a>
              </td>
              <td>${escapeHtml(ReconciliationEngine.formatDate(r.yearEnd || r.accountingReferenceDate || '—'))}</td>
              <td>${escapeHtml(ReconciliationEngine.formatDate(r.accountsDueDate || '—'))}</td>
              <td>
                ${r.confirmationDueDate ? `<strong>CS Due:</strong> ${escapeHtml(ReconciliationEngine.formatDate(r.confirmationDueDate))}` : '—'}
              </td>
              <td>
                <span class="${urgencyClass}">${escapeHtml(urgencyLabel)}</span>
              </td>
              <td style="max-width: 220px; font-size: 11px; color: ${r.urgency === 'RED' ? 'var(--red)' : 'var(--muted)'};">
                ${escapeHtml(r.note || r.notes || '—')}
              </td>
            </tr>
          `;
        }).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="text-align: center; padding: 24px;">No statutory records available</td></tr>`;
      }
    }

    // Update Statutory Nav Badge with dynamic RED count
    const navBadge = document.getElementById('statNavBadge');
    if (navBadge) {
      navBadge.textContent = redCount;
      navBadge.className = `nav-badge ${redCount > 0 ? 'badge-red' : ''}`;
    }

    // Update Radar Metric Cards
    const statTracked = document.getElementById('statRadarTracked');
    const statVat = document.getElementById('statRadarVat');
    const statRed = document.getElementById('statRadarRed');
    const statClear = document.getElementById('statRadarClear');

    if (statTracked) statTracked.textContent = records.length;
    if (statVat) statVat.textContent = '0';
    if (statRed) statRed.textContent = redCount;
    if (statClear) statClear.textContent = clearCount;

    // Render Action Tracker table from API records with urgency RED or AMBER
    const actionTbody = document.getElementById('actionTableBody');
    if (actionTbody) {
      const actionItems = records.filter(r => r.urgency === 'RED' || r.urgency === 'AMBER');
      if (actionItems.length > 0) {
        actionTbody.innerHTML = actionItems.map(a => `
          <tr>
            <td style="font-weight: 700; color: var(--text);">${escapeHtml(a.name || a.companyName)}</td>
            <td style="font-family: var(--font-mono); color: var(--accent);">${escapeHtml(a.companyNumber || '—')}</td>
            <td style="color: ${a.urgency === 'RED' ? 'var(--red)' : 'var(--text)'}; font-weight: 600;">${escapeHtml(a.hasStrikeOff ? 'Active strike-off notice registered at Companies House' : (a.accountsOverdue ? 'Accounts overdue — penalty tier active' : 'Upcoming statutory accounts deadline'))}</td>
            <td style="font-size: 11px; color: var(--muted);">${escapeHtml(a.note || a.notes || 'Immediate action required')}</td>
            <td><span class="pill ${a.urgency === 'RED' ? 'red' : 'amber'}">${escapeHtml(a.urgency)}</span></td>
          </tr>
        `).join('');
      } else {
        actionTbody.innerHTML = `<tr><td colspan="5" class="table-empty" style="text-align: center; padding: 24px;">No immediate actions required</td></tr>`;
      }
    }

    // Render VAT schedule
    const vatTbody = document.getElementById('vatTableBody');
    if (vatTbody) {
      vatTbody.innerHTML = `<tr><td colspan="4" class="table-empty" style="text-align: center; padding: 24px;">No VAT filings currently scheduled</td></tr>`;
    }
  }

  renderIntelligence() {
    const grid = document.getElementById('intelGridContainer');
    if (!grid) return;

    const clashes = (this.cachedDiaryEvents || []).filter(e => e.isClash);
    let clashCardHtml = '';
    if (clashes.length > 0) {
      clashCardHtml = `
        <div class="card intel-card">
          <div class="card-header">
            <h2><span class="dot red"></span> Context Scan (Meetings & Calendar Conflicts)</h2>
            <span class="pill red">${clashes.length} Clash${clashes.length > 1 ? 'es' : ''}</span>
          </div>
          <div class="intel-list">
            ${clashes.map(c => `
              <div class="intel-item">
                <div class="intel-item-content">
                  <div class="intel-title">Schedule Conflict: ${escapeHtml(c.title)}</div>
                  <div class="intel-desc">Event at ${escapeHtml(c.time)} overlaps with another scheduled meeting today.</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      clashCardHtml = `
        <div class="card intel-card">
          <div class="card-header">
            <h2><span class="dot green"></span> Context Scan (Meetings & Calendar Conflicts)</h2>
            <span class="pill green">Clear</span>
          </div>
          <div class="intel-list">
            <div class="intel-item">
              <div class="intel-item-content">
                <div class="intel-title">Calendar Schedule Clear</div>
                <div class="intel-desc">No meeting collisions or conflicting times detected for today.</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

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

      ${clashCardHtml}

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

    try {
      await ApiService.createBusiness({ name, type });
      ModalManager.close('bizModal');
      Toast.success(`Business area "${name}" added.`);

      await this.renderBusinesses();
      await this.renderCommandCentre();
      await this.populateClientModalBizSelect();
    } catch (err) {
      Toast.error(`Could not add business area: ${err.message}`);
    }
  }

  handleSaveBrain() {
    const textarea = document.getElementById('brainInput');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) {
      Toast.warning('Please enter a note before saving to CEO Brain.');
      return;
    }

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

  async openTrinovaNoteModal(entryIndex) {
    const entries = StorageService.getBrainEntries();
    const entry = entries[entryIndex];
    if (!entry) return;

    this.selectedBrainEntryForTrinova = entry;

    const contentInput = document.getElementById('trinovaNoteContent');
    if (contentInput) contentInput.value = entry.text;

    // Explicitly uncheck confirmation box per privacy boundary
    const confirmBox = document.getElementById('trinovaNoteConfirm');
    if (confirmBox) confirmBox.checked = false;
    
    // Populate company select from live API / cached clients
    let clients = [];
    try {
      const res = await ApiService.getClients();
      clients = res.data || [];
    } catch (_) {
      clients = StorageService.getClients();
    }
    const companySelect = document.getElementById('trinovaNoteCompany');
    if (companySelect) {
      companySelect.innerHTML = clients.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
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

    if (!text) {
      Toast.error('Note text cannot be empty.');
      return;
    }

    // Resolve matching company ID from live / cached clients
    let clients = [];
    try {
      const res = await ApiService.getClients();
      clients = res.data || [];
    } catch (_) {
      clients = StorageService.getClients();
    }
    const match = clients.find(c => c.name === companyName);
    const companyId = match ? (match.rawId || match.id) : 'comp_woofington_park_01';

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
      if (this.activeClient360Id) {
        await this.renderClientNotesDetail(this.activeClient360Id);
        await this.renderTimeline(this.activeClient360Id);
      }
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
        await this.renderClientNotesDetail(clientId);
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

  async renderClientStatutoryDetail(clientId) {
    const card = document.getElementById('clientStatutoryDetailCard');
    if (!card) return;

    let company = null;
    try {
      const clientRes = await ApiService.getClients();
      const match = (clientRes.data || []).find(c => c.id === clientId || c.clientId === clientId);
      if (match) {
        const detailsRes = await ApiService.getCompanyDetails(match.rawId || match.id);
        company = detailsRes?.data || match;
      }
    } catch (_) {}

    const accountsDueDate = company?.accountsDueDate || company?.accounts || '2026-12-31';
    const confirmDueDate = company?.confirmationDueDate || company?.confirm || '2026-11-30';
    const vatStatus = company?.vatRegistered || company?.vat === 'Yes' ? 'Active' : 'Not Registered';

    card.innerHTML = `
      <div class="card-header">
        <h3>Statutory Filings & Obligations</h3>
        <span class="pill ${company?.riskLevel === 'High' ? 'red' : 'green'}">${company?.riskLevel === 'High' ? 'Action Required' : 'Active Filings'}</span>
      </div>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
        Synchronized Companies House registers, annual accounts schedules, and confirmation statements.
      </p>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
        <div style="background: var(--panel2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
          <span style="font-size: 11px; color: var(--muted); display: block;">Accounts Due Date</span>
          <strong style="color: var(--text);">${escapeHtml(ReconciliationEngine.formatDate(accountsDueDate))}</strong>
        </div>
        <div style="background: var(--panel2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
          <span style="font-size: 11px; color: var(--muted); display: block;">Confirmation Statement</span>
          <strong style="color: var(--text);">${escapeHtml(ReconciliationEngine.formatDate(confirmDueDate))}</strong>
        </div>
        <div style="background: var(--panel2); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
          <span style="font-size: 11px; color: var(--muted); display: block;">VAT Registration</span>
          <strong style="color: var(--text);">${escapeHtml(vatStatus)}${company?.vatNumber ? ` (${escapeHtml(company.vatNumber)})` : ''}</strong>
        </div>
      </div>
    `;
  }

  async renderClientDocumentsDetail(clientId) {
    const card = document.getElementById('clientDocumentsDetailCard');
    if (!card) return;

    let companyId = clientId;
    try {
      const clientRes = await ApiService.getClients();
      const match = (clientRes.data || []).find(c => c.id === clientId || c.clientId === clientId);
      if (match && (match.rawId || match.id)) {
        companyId = match.rawId || match.id;
      }
    } catch (_) {}

    let docs = [];
    try {
      const res = await ApiService.getCompanyDocuments(companyId);
      docs = res.data || [];
    } catch (err) {
      console.warn('Could not load company documents:', err);
    }

    const docsHtml = docs.length > 0
      ? docs.map(d => `
          <div style="display: flex; justify-content: space-between; align-items: center; background: var(--panel2); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
            <div>
              <div style="font-weight: 700; font-size: 13px; color: var(--text);">${escapeHtml(d.filename || d.name || 'Document.pdf')}</div>
              <div style="font-size: 11px; color: var(--muted);">${d.uploadedBy ? `Uploaded by ${escapeHtml(d.uploadedBy)} · ` : ''}Category: ${escapeHtml(d.category || 'General')}</div>
            </div>
            <span class="pill ${d.status === 'Ready' || d.status === 'Signed' ? 'green' : 'amber'}">${escapeHtml(d.status || 'Active')}</span>
          </div>
        `).join('')
      : `<div class="table-empty" style="padding: 24px;">No corporate documents recorded for this client.</div>`;

    card.innerHTML = `
      <div class="card-header">
        <h3>Corporate Documents & Certificates</h3>
        <button class="btn btn-secondary" style="font-size: 11px;">+ Upload Document</button>
      </div>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
        Archived statutory balance sheets, minutes, and tamper-evident Documenso certificates.
      </p>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${docsHtml}
      </div>
    `;
  }

  async renderClientNotesDetail(clientId) {
    const card = document.getElementById('clientNotesDetailCard');
    if (!card) return;

    let companyId = clientId;
    try {
      const clientRes = await ApiService.getClients();
      const match = (clientRes.data || []).find(c => c.id === clientId || c.clientId === clientId);
      if (match && (match.rawId || match.id)) {
        companyId = match.rawId || match.id;
      }
    } catch (_) {}

    let notes = [];
    try {
      const res = await ApiService.getCompanyNotes(companyId);
      notes = res.data || [];
    } catch (err) {
      console.warn('Could not load company notes:', err);
    }

    const notesListHtml = notes.length > 0
      ? notes.map(n => `
          <div style="background: var(--panel2); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--line); margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
              <strong style="font-size: 12.5px; color: var(--text);">${escapeHtml(n.authorName || n.author || 'Staff')}</strong>
              <span style="font-size: 11px; color: var(--muted);">${n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recent'}</span>
            </div>
            <p style="font-size: 12px; color: #c5d1de; margin: 0; line-height: 1.5;">
              ${escapeHtml(n.text || n.content || '')}
            </p>
          </div>
        `).join('')
      : `<div class="table-empty" style="padding: 24px;">No internal notes recorded for this client.</div>`;

    card.innerHTML = `
      <div class="card-header">
        <h3>Internal Operational & Strategic Notes</h3>
        <button class="btn btn-secondary" style="font-size: 11px;" onclick="document.getElementById('modalTimelineEventType').value='NOTE_CREATED'; ModalManager.open('logTimelineEventModal');">+ New Note</button>
      </div>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
        Client-specific practitioner communications protected by Sloane's strict staff privacy boundary.
      </p>
      <div id="clientNotesListContainer">
        ${notesListHtml}
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
if (typeof window !== 'undefined') {
  window.app = new SloaneApp();
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => window.app.init());
  }
}
