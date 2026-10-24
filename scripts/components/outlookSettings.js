/**
 * Outlook Settings Component (§4.1 & Task P7.1)
 * Manages the "Email & Calendar (Outlook)" settings card in the Settings view:
 * - Renders every state: not connected, connected, reconnect required, sync error, syncing, disconnected
 * - Enforces escapeHtml on every server string (preventing stored/reflected XSS)
 * - Persists email & calendar sync toggles via PATCH /api/v1/integrations/outlook/settings
 * - Manages mail folder multi-selection (persisted as IDs, showing display names)
 * - Implements immediate "Sync now" with concurrency disabled state
 * - Integrates with ModalManager for accessible Disconnect confirmation dialog (§4.1 revocation guidance)
 */

import { ApiService } from '../services/api.js';
import { ModalManager } from './modal.js';
import { escapeHtml } from '../utils/html.js';

/**
 * Formats a sync ISO timestamp into Europe/London absolute time + relative time.
 * Example: "12:04 — 3 min ago"
 *
 * @param {string|null} isoStr
 * @returns {string}
 */
export function formatSyncTimestamp(isoStr) {
  if (!isoStr) return 'Never synced';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return 'Never synced';

  const absTime = d.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit'
  });

  const diffMs = Math.max(0, Date.now() - d.getTime());
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  let relTime = 'just now';
  if (diffMin >= 1 && diffMin < 60) {
    relTime = `${diffMin} min ago`;
  } else if (diffHour >= 1 && diffHour < 24) {
    relTime = `${diffHour} ${diffHour === 1 ? 'hr' : 'hrs'} ago`;
  } else if (diffDay >= 1) {
    relTime = `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
  }

  return `${absTime} — ${relTime}`;
}

export const OutlookSettings = {
  statusData: null,
  availableFolders: [],
  isSyncing: false,
  isSaving: false,
  feedbackBanner: null, // { message, type: 'success' | 'error' | 'info' }

  /**
   * Initializes the Outlook Settings component and URL param listener.
   */
  init() {
    // The URL message (?outlook=... / ?outlook_error=...) is read by the app once the page has
    // loaded and the owner is signed in (see SloaneApp.init), so it is not lost on the way.
    this.bindModalEvents();
  },

  /**
   * Checks for OAuth callback query parameters in the URL:
   * ?outlook=connected or ?outlook_error=...
   */
  checkUrlParams() {
    if (typeof window === 'undefined' || !window.location) return;
    const params = new URLSearchParams(window.location.search);

    if (params.has('outlook')) {
      const val = params.get('outlook');
      if (val === 'connected') {
        this.setBanner('Outlook account connected successfully.', 'success');
      }
      this.clearUrlParam('outlook');
      if (window.app && typeof window.app.switchView === 'function') {
        window.app.switchView('settings');
      }
    } else if (params.has('outlook_error')) {
      const err = params.get('outlook_error');
      this.setBanner(`Outlook could not be connected. ${err}`, 'error');
      this.clearUrlParam('outlook_error');
      if (window.app && typeof window.app.switchView === 'function') {
        window.app.switchView('settings');
      }
    }
  },

  clearUrlParam(key) {
    if (typeof window === 'undefined' || !window.history) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(key);
    window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ''));
  },

  setBanner(message, type = 'info') {
    this.feedbackBanner = { message, type };
    this.renderBanner();
  },

  clearBanner() {
    this.feedbackBanner = null;
    const bannerEl = document.getElementById('outlookAlertBanner');
    if (bannerEl) {
      bannerEl.style.display = 'none';
      bannerEl.innerHTML = '';
    }
  },

  renderBanner() {
    const bannerEl = document.getElementById('outlookAlertBanner');
    if (!bannerEl) return;
    if (!this.feedbackBanner) {
      bannerEl.style.display = 'none';
      bannerEl.innerHTML = '';
      return;
    }

    const { message, type } = this.feedbackBanner;
    let bg = 'rgba(201, 166, 107, 0.12)';
    let border = 'var(--line)';
    let color = 'var(--text)';
    let icon = 'ℹ️';

    if (type === 'success') {
      bg = 'var(--green-bg)';
      border = 'var(--green-border)';
      color = 'var(--green)';
      icon = '✓';
    } else if (type === 'error') {
      bg = 'var(--red-bg)';
      border = 'var(--red-border)';
      color = 'var(--red)';
      icon = '⚠️';
    }

    bannerEl.style.display = 'block';
    bannerEl.innerHTML = `
      <div class="sourcebanner" style="background: ${bg}; border-color: ${border}; color: ${color}; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>${icon}</span>
          <span>${escapeHtml(message)}</span>
        </div>
        <button type="button" class="card-action-btn" id="btnDismissOutlookBanner" style="padding: 2px 8px; font-size: 11px;">✕</button>
      </div>
    `;

    const dismissBtn = document.getElementById('btnDismissOutlookBanner');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => this.clearBanner());
    }
  },

  /**
   * Loads current status and folder list from backend API.
   */
  async loadStatus() {
    try {
      const res = await ApiService.getOutlookStatus();
      if (res && res.data) {
        this.statusData = res.data;
      } else {
        this.statusData = { status: 'not_connected' };
      }

      // If connected or sync error, load available mail folders
      if (['connected', 'sync_error'].includes(this.statusData?.status)) {
        try {
          const foldersRes = await ApiService.getOutlookFolders();
          this.availableFolders = foldersRes?.data?.folders || [];
        } catch (fErr) {
          console.warn('[OutlookSettings] Could not load mail folders:', fErr.message);
        }
      }
    } catch (err) {
      console.warn('[OutlookSettings] Failed to fetch Outlook status:', err.message);
      this.statusData = { status: 'not_connected' };
    }

    this.render();
  },

  /**
   * Master renderer for the Settings card per §4.1.
   */
  render() {
    const container = document.getElementById('outlookSettingsCard');
    if (!container) return;

    this.renderBanner();

    const data = this.statusData || { status: 'not_connected' };
    const status = data.status || 'not_connected';

    let html = '';
    switch (status) {
      case 'connected':
        html = this.renderConnected(data);
        break;
      case 'reconnect_required':
        html = this.renderReconnectRequired(data);
        break;
      case 'sync_error':
        html = this.renderSyncError(data);
        break;
      case 'not_connected':
      default:
        html = this.renderNotConnected();
        break;
    }

    container.innerHTML = html;
    this.bindCardEvents();
  },

  /**
   * State 1: Not connected per §4.1
   */
  renderNotConnected() {
    return `
      <div class="card-header" style="margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">📬</span>
          <h2 style="margin: 0; font-size: 15px;">Email & Calendar (Outlook)</h2>
        </div>
        <div class="outlook-status-pill" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 4px; background: rgba(141, 154, 170, 0.12); border: 1px solid rgba(141, 154, 170, 0.3); font-size: 11px; font-weight: 700; color: var(--muted);">
          <span class="dot" style="background: var(--muted);"></span>
          <span>Not connected</span>
        </div>
      </div>

      <p style="font-size: 12.5px; color: var(--muted); line-height: 1.5; margin-bottom: 18px;">
        Connect your Microsoft 365 or Outlook account and Sloane will show today's meetings and the emails you have flagged, right on your dashboard.
      </p>

      <div style="background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">
          What you stay in control of
        </div>
        <ul style="margin: 0; padding-left: 18px; font-size: 11.5px; color: var(--muted); line-height: 1.6;">
          <li>Sloane can only <strong>read</strong>. It cannot send, delete, move or change any email or meeting.</li>
          <li>You choose which mail folders Sloane looks in, and you can switch email or calendar off separately.</li>
          <li>You can press Disconnect at any time, right here on this page.</li>
          <li>Your Microsoft sign-in details are kept scrambled (encrypted with AES-256-GCM) and are never shown in your browser.</li>
        </ul>
      </div>

      <div>
        <a href="/api/v1/integrations/outlook/connect" class="btn btn-primary" id="btnConnectOutlook" style="padding: 9px 18px; font-size: 13px;">
          🔗 Connect Outlook account
        </a>
        <p style="font-size: 11px; color: var(--muted); margin: 10px 0 0;">
          You will be taken to Microsoft to sign in, then brought straight back here.
        </p>
      </div>
    `;
  },

  /**
   * State 2: Connected per §4.1
   */
  renderConnected(data) {
    const email = escapeHtml(data.accountEmail || '');
    const name = escapeHtml(data.displayName || data.accountEmail || '');
    const syncTimeStr = escapeHtml(formatSyncTimestamp(data.lastSyncAt));
    const isEmailOn = Boolean(data.emailSyncEnabled);
    const isCalOn = Boolean(data.calendarSyncEnabled);
    const folderIds = Array.isArray(data.mailFolderIds) ? data.mailFolderIds : ['Inbox'];

    return `
      <!-- 1. Status Line -->
      <div class="card-header" style="margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">📬</span>
          <h2 style="margin: 0; font-size: 15px;">Email & Calendar (Outlook)</h2>
        </div>
        <div class="outlook-status-pill" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 4px; background: var(--green-bg); border: 1px solid var(--green-border); font-size: 11px; font-weight: 700; color: var(--green);">
          <span class="dot green"></span>
          <span>Connected</span>
        </div>
      </div>

      <!-- 2. Connected Account Metadata -->
      <div style="background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: 18px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 12px;">
          <div>
            <span style="color: var(--muted); display: block; font-size: 11px; margin-bottom: 2px;">Connected account</span>
            <strong style="color: var(--text); font-size: 13px;">${email}</strong>
            <span style="color: var(--muted); font-size: 11.5px; display: block;">(${name})</span>
          </div>
          <div>
            <span style="color: var(--muted); display: block; font-size: 11px; margin-bottom: 2px;">Last updated</span>
            <strong id="outlookLastSyncText" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px;">${syncTimeStr}</strong>
          </div>
        </div>
      </div>

      <!-- 4. & 5. Toggles: Email sync & Calendar sync -->
      <div style="border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 16px 0; margin-bottom: 18px;">
        <div style="display: flex; flex-direction: column; gap: 14px;">
          
          <!-- Email Sync Toggle -->
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 700; font-size: 13px; color: var(--text);">Email sync <span style="font-weight: 500; color: var(--muted);">(on / off)</span></div>
              <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">
                Show your flagged emails (from the folders below) in "Emails Sloane Thinks Need You" on your dashboard.
              </div>
            </div>
            <label class="toggle-switch" aria-label="Toggle Email sync">
              <input type="checkbox" id="chkEmailSync" ${isEmailOn ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Calendar (Diary) Sync Toggle -->
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 700; font-size: 13px; color: var(--text);">Calendar (diary) sync <span style="font-weight: 500; color: var(--muted);">(on / off)</span></div>
              <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">
                Show today's meetings on your dashboard, and warn you when two meetings clash.
              </div>
            </div>
            <label class="toggle-switch" aria-label="Toggle Calendar sync">
              <input type="checkbox" id="chkCalendarSync" ${isCalOn ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

        </div>
      </div>

      <!-- 6. Folder Selection (listing from GET /me/mailFolders) -->
      <div style="margin-bottom: 22px; ${isEmailOn ? '' : 'opacity: 0.5; pointer-events: none;'}">
        <label style="font-weight: 700; font-size: 12.5px; color: var(--text); display: block; margin-bottom: 6px;">
          Mail folders Sloane looks in
        </label>
        <p style="font-size: 11px; color: var(--muted); margin-bottom: 10px;">
          Tick the folders you want Sloane to check for flagged emails. At least one must stay ticked.
        </p>

        <div id="outlookFolderList" style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${this.renderFolderCheckboxes(folderIds)}
        </div>
      </div>

      <p style="font-size: 11.5px; color: var(--muted); line-height: 1.5; margin: 0 0 14px;">
        <strong style="color: var(--text);">Remember:</strong> Sloane can only read. It never sends, deletes, moves or changes anything in your mailbox or calendar.
      </p>

      <!-- 7. & 8. Action Buttons: Sync now & Disconnect -->
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <button type="button" class="btn btn-secondary" id="btnSyncOutlookNow" ${this.isSyncing ? 'disabled' : ''} title="Fetch your latest meetings and emails now" style="padding: 7px 14px; font-size: 12px;">
          ${this.isSyncing ? '⏳ Syncing...' : '🔄 Sync now'}
        </button>

        <button type="button" class="btn btn-danger" id="btnOpenDisconnectModal" title="Stop Sloane reading your Outlook" style="padding: 7px 14px; font-size: 12px;">
          Disconnect
        </button>
      </div>
    `;
  },

  /**
   * State 3: Reconnect required per §4.1
   */
  renderReconnectRequired(data) {
    const email = escapeHtml(data.accountEmail || 'Previous account');
    const name = escapeHtml(data.displayName || '');

    return `
      <!-- 1. Status Line -->
      <div class="card-header" style="margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">📬</span>
          <h2 style="margin: 0; font-size: 15px;">Email & Calendar (Outlook)</h2>
        </div>
        <div class="outlook-status-pill" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 4px; background: var(--red-bg); border: 1px solid var(--red-border); font-size: 11px; font-weight: 700; color: var(--red);">
          <span class="dot red"></span>
          <span>Reconnect your Outlook</span>
        </div>
      </div>

      <!-- Reconnect Notice Banner -->
      <div class="sourcebanner" style="background: rgba(255, 93, 103, 0.08); border-color: var(--red-border); color: #ffb4b9; margin-bottom: 16px; font-size: 12px; line-height: 1.5;">
        <span>⚠️</span>
        <div>
          Microsoft authorization has expired or consent was revoked. Please sign in again to restore calendar and flagged email synchronization.
        </div>
      </div>

      <div style="background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 18px; font-size: 12px;">
        <span style="color: var(--muted); display: block; font-size: 11px;">Account to Reconnect</span>
        <strong style="color: var(--text);">${email}</strong> ${name ? `<span style="color: var(--muted);">(${name})</span>` : ''}
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <a href="/api/v1/integrations/outlook/connect" class="btn btn-primary" id="btnConnectOutlook" style="padding: 8px 16px; font-size: 12px;">
          🔗 Reconnect Outlook account
        </a>

        <button type="button" class="btn btn-danger" id="btnOpenDisconnectModal" style="padding: 8px 16px; font-size: 12px;">
          Disconnect
        </button>
      </div>
    `;
  },

  /**
   * State 4: Sync error per §4.1
   */
  renderSyncError(data) {
    const email = escapeHtml(data.accountEmail || '');
    const name = escapeHtml(data.displayName || data.accountEmail || '');
    const syncTimeStr = escapeHtml(formatSyncTimestamp(data.lastSyncAt));
    const shortReason = escapeHtml(data.lastError || 'Microsoft could not be reached');
    const isEmailOn = Boolean(data.emailSyncEnabled);
    const isCalOn = Boolean(data.calendarSyncEnabled);
    const folderIds = Array.isArray(data.mailFolderIds) ? data.mailFolderIds : ['Inbox'];

    return `
      <!-- 1. Status Line: Sync error — <short reason> -->
      <div class="card-header" style="margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">📬</span>
          <h2 style="margin: 0; font-size: 15px;">Email & Calendar (Outlook)</h2>
        </div>
        <div class="outlook-status-pill" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 4px; background: var(--amber-bg); border: 1px solid var(--amber-border); font-size: 11px; font-weight: 700; color: var(--amber);">
          <span class="dot amber"></span>
          <span>Sync error — ${shortReason}</span>
        </div>
      </div>

      <div class="sourcebanner" style="background: rgba(243, 181, 74, 0.08); border-color: var(--amber-border); color: #f9d892; margin-bottom: 16px; font-size: 12px;">
        <span>⚠️</span>
        <div>
          The last update did not work (${shortReason}). What you saw before is still showing. Click "Sync now" to try again.
        </div>
      </div>

      <!-- 2. Connected Account Metadata with Last Successful Sync Time -->
      <div style="background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: 18px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 12px;">
          <div>
            <span style="color: var(--muted); display: block; font-size: 11px; margin-bottom: 2px;">Connected account</span>
            <strong style="color: var(--text); font-size: 13px;">${email}</strong>
            <span style="color: var(--muted); font-size: 11.5px; display: block;">(${name})</span>
          </div>
          <div>
            <span style="color: var(--muted); display: block; font-size: 11px; margin-bottom: 2px;">Last Successful Sync</span>
            <strong style="color: var(--accent); font-family: var(--font-mono); font-size: 12px;">${syncTimeStr}</strong>
          </div>
        </div>
      </div>

      <!-- Toggles -->
      <div style="border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 16px 0; margin-bottom: 18px;">
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 700; font-size: 13px; color: var(--text);">Email sync</div>
              <div style="font-size: 11px; color: var(--muted);">Flagged messages attention feed</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="chkEmailSync" ${isEmailOn ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 700; font-size: 13px; color: var(--text);">Calendar (diary) sync</div>
              <div style="font-size: 11px; color: var(--muted);">Executive schedule & clash detection</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="chkCalendarSync" ${isCalOn ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Folders -->
      <div style="margin-bottom: 22px;">
        <label style="font-weight: 700; font-size: 12.5px; color: var(--text); display: block; margin-bottom: 6px;">
          Mail folders Sloane looks in
        </label>
        <div id="outlookFolderList" style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${this.renderFolderCheckboxes(folderIds)}
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <button type="button" class="btn btn-secondary" id="btnSyncOutlookNow" ${this.isSyncing ? 'disabled' : ''} style="padding: 7px 14px; font-size: 12px;">
          ${this.isSyncing ? '⏳ Syncing...' : '🔄 Sync now'}
        </button>

        <button type="button" class="btn btn-danger" id="btnOpenDisconnectModal" style="padding: 7px 14px; font-size: 12px;">
          Disconnect
        </button>
      </div>
    `;
  },

  /**
   * Helper to render folder checkboxes with display names.
   */
  renderFolderCheckboxes(selectedFolderIds = ['Inbox']) {
    const folders = this.availableFolders.length > 0 ? this.availableFolders : [
      { id: 'Inbox', displayName: 'Inbox', unreadItemCount: 0 }
    ];

    return folders.map(f => {
      const isChecked = selectedFolderIds.includes(f.id);
      const safeId = escapeHtml(f.id);
      const safeName = escapeHtml(f.displayName || f.id);
      const badge = f.unreadItemCount > 0 ? `<span class="source-badge" style="margin-left: 4px;">${f.unreadItemCount}</span>` : '';

      return `
        <label class="folder-select-chip" style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; background: var(--panel); border: 1px solid ${isChecked ? 'var(--accent)' : 'var(--line)'}; border-radius: var(--radius-sm); cursor: pointer; font-size: 11.5px; color: var(--text); user-select: none;">
          <input type="checkbox" class="outlook-folder-checkbox" value="${safeId}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
          <span>${safeName}</span>
          ${badge}
        </label>
      `;
    }).join('');
  },

  /**
   * Binds event listeners for buttons and toggles on the card.
   */
  bindCardEvents() {
    // 1. Email Sync Toggle
    const chkEmail = document.getElementById('chkEmailSync');
    if (chkEmail) {
      chkEmail.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await this.updateSettings({ emailSyncEnabled: enabled });
      });
    }

    // 2. Calendar Sync Toggle
    const chkCal = document.getElementById('chkCalendarSync');
    if (chkCal) {
      chkCal.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await this.updateSettings({ calendarSyncEnabled: enabled });
      });
    }

    // 3. Folder Checkboxes
    const folderCheckboxes = document.querySelectorAll('.outlook-folder-checkbox');
    folderCheckboxes.forEach(chk => {
      chk.addEventListener('change', async () => {
        const selected = Array.from(document.querySelectorAll('.outlook-folder-checkbox:checked'))
          .map(cb => cb.value);

        if (selected.length === 0) {
          chk.checked = true; // Revert
          this.setBanner('Please keep at least one mail folder ticked.', 'error');
          return;
        }

        await this.updateSettings({ mailFolderIds: selected });
      });
    });

    // 4. Sync Now Button
    const btnSync = document.getElementById('btnSyncOutlookNow');
    if (btnSync) {
      btnSync.addEventListener('click', () => this.handleSyncNow());
    }

    // 5. Open Disconnect Modal Button
    const btnDisconnect = document.getElementById('btnOpenDisconnectModal');
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
        ModalManager.open('outlookDisconnectModal', btnDisconnect);
      });
    }
  },

  /**
   * Binds modal confirmation button events once on init.
   */
  bindModalEvents() {
    const btnConfirm = document.getElementById('btnConfirmOutlookDisconnect');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => this.confirmDisconnect());
    }
  },

  /**
   * Updates settings server-side via PATCH /api/v1/integrations/outlook/settings.
   */
  async updateSettings(patch) {
    if (this.isSaving) return;
    this.isSaving = true;

    try {
      const res = await ApiService.updateOutlookSettings(patch);
      if (res && res.data) {
        this.statusData = { ...this.statusData, ...res.data };
      }
      this.setBanner('Saved.', 'success');
      setTimeout(() => this.clearBanner(), 3000);
    } catch (err) {
      console.error('[OutlookSettings] Failed to update settings:', err);
      this.setBanner(`Could not save that change: ${err.message}`, 'error');
      // Reload on failure to restore actual state
      await this.loadStatus();
    } finally {
      this.isSaving = false;
    }
  },

  /**
   * Executes manual synchronization (POST /api/v1/integrations/outlook/sync).
   */
  async handleSyncNow() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.render();

    try {
      const res = await ApiService.syncOutlook();
      if (res && res.data) {
        this.statusData.lastSyncAt = res.data.lastSyncAt;
        this.statusData.status = res.data.status || 'connected';
        this.statusData.lastError = null;
      }
      this.setBanner('Done. Your latest meetings and emails have been fetched.', 'success');
      setTimeout(() => this.clearBanner(), 3500);

      // If Command Centre is active or present, refresh diary & emails
      if (window.app && typeof window.app.refreshOutlookData === 'function') {
        window.app.refreshOutlookData();
      }
    } catch (err) {
      console.error('[OutlookSettings] Sync failed:', err);
      if (err.status === 409) {
        this.setBanner('Sloane is already fetching your latest information. Please wait a moment.', 'info');
      } else {
        this.setBanner(`Could not update: ${err.message}`, 'error');
      }
    } finally {
      this.isSyncing = false;
      this.render();
    }
  },

  /**
   * Executes account disconnection (§4.1 and §5 P7.5):
   * - Calls POST /api/v1/integrations/outlook/disconnect
   * - Closes modal
   * - Shows revocation guidance banner directing user to https://myapps.microsoft.com
   * - Resets state and re-renders card as not_connected
   */
  async confirmDisconnect() {
    const btnConfirm = document.getElementById('btnConfirmOutlookDisconnect');
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Disconnecting...';
    }

    try {
      await ApiService.disconnectOutlook();
      ModalManager.close('outlookDisconnectModal');

      this.statusData = { status: 'not_connected' };
      this.availableFolders = [];

      // Render revocation notice banner per §4.1
      const bannerEl = document.getElementById('outlookAlertBanner');
      if (bannerEl) {
        bannerEl.style.display = 'block';
        bannerEl.innerHTML = `
          <div class="sourcebanner" style="background: rgba(78, 209, 154, 0.08); border-color: var(--green-border); color: var(--green); padding: 14px; margin-bottom: 16px; font-size: 12.5px; line-height: 1.5;">
            <div style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <span>✓</span>
              <span>Outlook Account Disconnected</span>
            </div>
            <div style="color: var(--text); margin-bottom: 6px;">
              Sloane's copy of your Outlook access has been deleted, and all cached diary and email data has been cleared from your dashboard.
            </div>
            <div style="font-size: 11.5px; color: var(--muted);">
              To fully remove Sloane's access from your Microsoft account, visit
              <a href="https://myapps.microsoft.com" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline; font-weight: 600;">
                https://myapps.microsoft.com
              </a>
              (or the link Microsoft shows under your account's connected apps).
            </div>
          </div>
        `;
      }

      this.render();

      // Refresh Command Centre panels to show empty states
      if (window.app && typeof window.app.refreshOutlookData === 'function') {
        window.app.refreshOutlookData();
      }
    } catch (err) {
      console.error('[OutlookSettings] Disconnect failed:', err);
      ModalManager.close('outlookDisconnectModal');
      this.setBanner(`Disconnect failed: ${err.message}`, 'error');
    } finally {
      if (btnConfirm) {
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Disconnect Account';
      }
    }
  }
};

export default OutlookSettings;
