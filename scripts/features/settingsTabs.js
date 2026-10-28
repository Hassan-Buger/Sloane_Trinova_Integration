/**
 * Settings is split into a few tabs instead of one long page of cards:
 *   Overview · Connections · Alerts & automation · Security · Your data
 * Only one group is shown at a time, and the page remembers which one was open last.
 */

export const SETTINGS_TAB_ACTIONS = ['selectSettingsTab'];

export const SETTINGS_TABS = ['overview', 'connections', 'alerts', 'security', 'data'];
const STORAGE_KEY = 'sloane_settings_tab';

function savedTab() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return SETTINGS_TABS.includes(t) ? t : 'overview';
  } catch (_) {
    return 'overview';
  }
}

export const settingsTabMethods = {
  /** Show one group of settings and hide the rest. */
  showSettingsTab(id) {
    const tab = SETTINGS_TABS.includes(id) ? id : 'overview';
    document.querySelectorAll('#view-settings .settings-pane').forEach(pane => {
      pane.classList.toggle('hidden', pane.getAttribute('data-pane') !== tab);
    });
    document.querySelectorAll('#view-settings .settings-tab').forEach(btn => {
      const on = btn.getAttribute('data-id') === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.settingsTab = tab;
  },

  /** The owner pressed a tab. */
  selectSettingsTab(id) {
    this.showSettingsTab(id);
    try { localStorage.setItem(STORAGE_KEY, this.settingsTab); } catch (_) { /* a convenience only */ }
  },

  /** When the Settings page opens: the tab used last time. */
  openSavedSettingsTab() {
    this.showSettingsTab(savedTab());
  }
};
