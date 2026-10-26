/**
 * Alerts on this device.
 *
 * While Sloane is open (in a browser tab or added to the phone's home screen), it checks every few
 * minutes for things that need attention (late filings, stuck tasks, work due today ...) and shows
 * a notification on the device for any it has not shown before. It does not nag: each alert is
 * shown once, and the first time it is switched on, what is already late is counted but not
 * announced one by one.
 *
 * Alerts when Sloane is completely closed need a push service, which is not set up yet (the
 * Settings card says so).
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { escapeHtml } from '../utils/html.js';

export const ALERT_ACTIONS = ['enableAlerts', 'disableAlerts', 'sendTestAlert', 'checkAlertsNow'];

const SEEN_KEY = 'sloane_alerts_seen';
const ON_KEY = 'sloane_alerts_on';
const POLL_MS = 5 * 60 * 1000;
const MAX_SINGLE = 3;

const store = {
  get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* a convenience only */ } },
  remove(key) { try { localStorage.removeItem(key); } catch (_) { /* a convenience only */ } }
};

function seenIds() {
  try { return new Set(JSON.parse(store.get(SEEN_KEY) || '[]')); } catch (_) { return new Set(); }
}

function rememberSeen(ids) {
  store.set(SEEN_KEY, JSON.stringify([...ids].slice(-400)));
}

/** Can this browser show notifications at all? */
export function alertsSupported() {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
}

let registrationPromise = null;

/** The service worker that shows notifications (phones need one). */
function workerRegistration() {
  if (!registrationPromise) {
    registrationPromise = (async () => {
      const reg = await navigator.serviceWorker.register('/scripts/sw.js');
      if (reg.active) return reg;
      const worker = reg.installing || reg.waiting;
      if (worker) {
        await new Promise(resolve => {
          if (worker.state === 'activated') return resolve();
          worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); });
          setTimeout(resolve, 5000);
        });
      }
      return reg;
    })().catch(err => { registrationPromise = null; throw err; });
  }
  return registrationPromise;
}

async function show(title, body, { tag, view } = {}) {
  const options = { body, tag, icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', data: { view: view || 'command' } };
  try {
    const reg = await workerRegistration();
    if (reg && reg.active) { await reg.showNotification(title, options); return true; }
  } catch (_) { /* fall through to the page's own notification */ }
  try { new Notification(title, options); return true; } catch (_) { return false; }
}

export const alertMethods = {
  /** Starts the regular check once the owner is signed in. */
  startAlerts() {
    if (this.alertTimer) return;
    this.alertTimer = setInterval(() => this.checkAlerts(), POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.checkAlerts(); });
    if (alertsSupported() && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'open-view' && event.data.view) this.switchView(event.data.view);
      });
    }
    this.checkAlerts();
  },

  alertsOn() {
    return alertsSupported() && Notification.permission === 'granted' && store.get(ON_KEY) === '1';
  },

  /** Fetches the alerts, updates the Settings card, and notifies about new ones. */
  async checkAlerts({ announceAll = false } = {}) {
    let data;
    try {
      data = (await ApiService.getAlerts()).data;
    } catch (_) {
      return null;
    }
    this.currentAlerts = data;
    const seen = seenIds();
    const firstRun = store.get(SEEN_KEY) === null;
    const fresh = data.alerts.filter(a => a.level !== 'info' && !seen.has(a.id));
    for (const a of data.alerts) seen.add(a.id);

    if (this.alertsOn() && fresh.length && !firstRun && !announceAll) {
      const hidden = document.visibilityState !== 'visible';
      if (hidden) {
        for (const a of fresh.slice(0, MAX_SINGLE)) await show(a.title, a.detail, { tag: a.id, view: a.view });
        if (fresh.length > MAX_SINGLE) await show(`${fresh.length - MAX_SINGLE} more alerts`, 'Open Sloane to see them.', { tag: 'sloane-more', view: 'briefing' });
      } else {
        Toast.show(fresh.length === 1 ? fresh[0].title : `${fresh.length} new alerts: ${fresh[0].title} and ${fresh.length - 1} more. See Settings.`, 'warning', 7000);
      }
    }
    rememberSeen(seen);
    if (this.currentView === 'settings') this.renderAlertsCard();
    return data;
  },

  async renderAlertsCard() {
    const card = document.getElementById('alertsCard');
    if (!card) return;
    const supported = alertsSupported();
    const permission = supported ? Notification.permission : 'unsupported';
    const on = this.alertsOn();
    const data = this.currentAlerts;

    let status;
    if (!supported) status = '<span class="pill neutral">Not available in this browser</span>';
    else if (permission === 'denied') status = '<span class="pill red">Blocked in this browser</span>';
    else if (on) status = '<span class="pill green">On for this device</span>';
    else status = '<span class="pill amber">Off for this device</span>';

    let control;
    if (!supported) {
      control = '<p class="card-help">This browser cannot show alerts. Use a recent Chrome, Edge, Safari or Firefox. On an iPhone, add Sloane to the Home Screen first (Share, then Add to Home Screen).</p>';
    } else if (permission === 'denied') {
      control = '<p class="card-help">Alerts are blocked for this site. Allow notifications for Sloane in your browser’s site settings (the padlock next to the address), then come back here.</p>';
    } else if (on) {
      control = `<div class="alerts-buttons">
        <button type="button" class="btn btn-secondary btn-sm" data-action="sendTestAlert">Send a test alert</button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="disableAlerts">Turn off on this device</button></div>`;
    } else {
      control = '<button type="button" class="btn btn-primary" data-action="enableAlerts">🔔 Turn on alerts on this device</button>';
    }

    const list = data && data.alerts.length
      ? `<div class="alerts-now"><div class="alerts-now-title">Needing attention right now (${data.counts.red} urgent, ${data.counts.amber} due today or unassigned${data.counts.info ? `, ${data.counts.info} for information` : ''})</div>
          ${data.alerts.slice(0, 6).map(a => `<div class="alerts-line ${a.level}"><span class="alerts-dot ${a.level}" aria-hidden="true"></span><span>${escapeHtml(a.title)}</span></div>`).join('')}
          ${data.alerts.length > 6 ? `<div class="alerts-more">and ${data.alerts.length - 6} more (see the Morning briefing)</div>` : ''}</div>`
      : `<p class="card-help">${data ? 'Nothing needs your attention right now, from what is saved in Sloane.' : 'Checking…'}</p>`;

    card.innerHTML = `
      <div class="card-header"><h2>Alerts</h2>${status}</div>
      <p class="card-help">Sloane can tell you when something needs you: a filing or VAT return that has gone late, a stuck task, work due today, or a task due soon that nobody has. You get each alert once, on this computer or phone.</p>
      ${control}
      ${list}
      <p class="card-help alerts-note">Alerts arrive while Sloane is open in a browser, or added to your phone’s Home Screen. Alerts when Sloane is completely closed need an extra push-notification set-up that has not been done yet.</p>`;
  },

  async enableAlerts() {
    if (!alertsSupported()) { Toast.error('This browser cannot show alerts.'); return; }
    let result;
    try { result = await Notification.requestPermission(); } catch (_) { result = 'denied'; }
    if (result !== 'granted') {
      Toast.error('Alerts were not allowed. You can allow them in your browser’s site settings.');
      await this.renderAlertsCard();
      return;
    }
    store.set(ON_KEY, '1');
    const data = await this.checkAlerts({ announceAll: true });
    const n = data ? data.counts.red + data.counts.amber : 0;
    await show('Sloane alerts are on', n ? `Right now ${data.counts.red} urgent and ${data.counts.amber} due today or unassigned. You will only be told about new ones.` : 'Nothing needs your attention right now. You will be told when something does.', { tag: 'sloane-on', view: 'briefing' });
    Toast.success('Alerts are on for this device.');
    await this.renderAlertsCard();
  },

  async disableAlerts() {
    store.remove(ON_KEY);
    Toast.info('Alerts are off for this device.');
    await this.renderAlertsCard();
  },

  async sendTestAlert() {
    const ok = await show('Test alert from Sloane', 'If you can see this, alerts work on this device.', { tag: 'sloane-test', view: 'command' });
    if (!ok) Toast.error('The test alert could not be shown. Check this browser’s notification settings.');
    else Toast.success('Test alert sent. Look for it on your screen.');
  },

  async checkAlertsNow() {
    await this.checkAlerts();
    Toast.info('Checked.');
  }
};
