/**
 * Alerts on this device.
 *
 * While Sloane is open (in a browser tab or added to the phone's home screen), it checks every few
 * minutes for things that need attention (late filings, stuck tasks, work due today ...) and shows
 * a notification on the device for any it has not shown before. It does not nag: each alert is
 * shown once, and the first time it is switched on, what is already late is counted but not
 * announced one by one.
 *
 * When Sloane is completely closed, the server pushes new alerts (and the weekday morning briefing)
 * to this device through the browser's push service (Web Push; see server/src/services/webPush.js).
 * The page registers the device when alerts are turned on, and again each time Sloane is opened.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { escapeHtml } from '../utils/html.js';

export const ALERT_ACTIONS = ['enableAlerts', 'disableAlerts', 'sendTestAlert', 'sendClosedTestAlert', 'checkAlertsNow'];

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

/** Can this browser receive pushes from the server while Sloane is closed? */
export function pushSupported() {
  return alertsSupported() && 'PushManager' in window;
}

/** The server's public key, as the bytes a browser wants. */
function keyBytes(base64Url) {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function sameBytes(a, b) {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
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
    // Each time Sloane is opened, make sure this device is still registered for closed-app alerts
    if (this.alertsOn()) this.setUpPush().then(() => { if (this.currentView === 'settings') this.renderAlertsCard(); });
  },

  /**
   * Registers this device with the server for alerts while Sloane is closed.
   * Never throws: the result says what happened.
   */
  async setUpPush() {
    const state = { supported: pushSupported(), configured: false, subscribed: false, permanent: false, error: null };
    this.pushState = state;
    if (!state.supported) return state;
    try {
      const cfg = (await ApiService.getPushConfig()).data;
      state.configured = Boolean(cfg && cfg.publicKey);
      state.permanent = Boolean(cfg && cfg.permanentKeys);
      if (!state.configured) return state;
      const reg = await workerRegistration();
      const key = keyBytes(cfg.publicKey);
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with another key (the server's key changed) cannot be used: start again
      if (sub && !sameBytes(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await ApiService.subscribePush(sub.toJSON());
      state.subscribed = true;
    } catch (err) {
      const msg = String((err && err.message) || '');
      state.error = /permission|denied|notallowed/i.test(msg) ? 'this browser would not register this device for them (it may be blocked in the browser’s settings)'
        : /network|abort|service|timeout|fetch/i.test(msg) ? 'the browser’s push service could not be reached just now'
        : 'something went wrong';
    }
    return state;
  },

  /** Forgets this device on the server and in the browser. */
  async stopPush() {
    try {
      const reg = await workerRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await ApiService.unsubscribePush(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
    } catch (_) { /* nothing to undo */ }
    this.pushState = null;
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
        ${this.pushState && this.pushState.subscribed ? '<button type="button" class="btn btn-secondary btn-sm" data-action="sendClosedTestAlert">Test it with Sloane closed (10 seconds)</button>' : ''}
        <button type="button" class="btn btn-secondary btn-sm" data-action="disableAlerts">Turn off on this device</button></div>`;
    } else {
      control = '<button type="button" class="btn btn-primary" data-action="enableAlerts">🔔 Turn on alerts on this device</button>';
    }

    const list = data && data.alerts.length
      ? `<div class="alerts-now"><div class="alerts-now-title">Needing attention right now (${data.counts.red} urgent, ${data.counts.amber} due today or unassigned${data.counts.info ? `, ${data.counts.info} for information` : ''})</div>
          ${data.alerts.slice(0, 6).map(a => `<div class="alerts-line ${a.level}"><span class="alerts-dot ${a.level}" aria-hidden="true"></span><span>${escapeHtml(a.title)}</span></div>`).join('')}
          ${data.alerts.length > 6 ? `<div class="alerts-more">and ${data.alerts.length - 6} more (see the Morning briefing)</div>` : ''}</div>`
      : `<p class="card-help">${data ? 'Nothing needs your attention right now, from what is saved in Sloane.' : 'Checking…'}</p>`;

    // Whether alerts also arrive while Sloane is closed
    const ps = this.pushState;
    let closed = '';
    if (on) {
      if (!pushSupported()) closed = '<p class="card-help alerts-note">This browser cannot receive alerts while Sloane is closed. On an iPhone or iPad, add Sloane to the Home Screen and open it from there.</p>';
      else if (!ps) closed = '<p class="card-help alerts-note">Checking alerts while Sloane is closed…</p>';
      else if (ps.error) closed = `<p class="card-help alerts-note text-amber">Alerts while Sloane is closed could not be set up on this device: ${escapeHtml(ps.error)}. Alerts still work while Sloane is open.</p>`;
      else if (!ps.configured) closed = '<p class="card-help alerts-note">Alerts while Sloane is closed are not available yet.</p>';
      else if (ps.subscribed) closed = `<p class="card-help alerts-note">✓ Alerts also reach this device when Sloane is closed, and so does your morning briefing on weekday mornings.${ps.permanent ? '' : ' The person who looks after Sloane still needs to make this permanent; until then, open Sloane once after each update.'}</p>`;
    }

    card.innerHTML = `
      <div class="card-header"><h2>Alerts</h2>${status}</div>
      <p class="card-help">Sloane can tell you when something needs you: a filing or VAT return that has gone late, a stuck task, work due today, or a task due soon that nobody has. You get each alert once, on this computer or phone.</p>
      ${control}
      ${list}
      ${on ? closed : '<p class="card-help alerts-note">Once on, alerts reach this computer or phone even when Sloane is closed. On an iPhone or iPad, add Sloane to the Home Screen first.</p>'}`;
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
    await this.setUpPush();
    const data = await this.checkAlerts({ announceAll: true });
    const n = data ? data.counts.red + data.counts.amber : 0;
    await show('Sloane alerts are on', n ? `Right now ${data.counts.red} urgent and ${data.counts.amber} due today or unassigned. You will only be told about new ones.` : 'Nothing needs your attention right now. You will be told when something does.', { tag: 'sloane-on', view: 'briefing' });
    Toast.success('Alerts are on for this device.');
    await this.renderAlertsCard();
  },

  async disableAlerts() {
    store.remove(ON_KEY);
    await this.stopPush();
    Toast.info('Alerts are off for this device.');
    await this.renderAlertsCard();
  },

  async sendTestAlert() {
    const ok = await show('Test alert from Sloane', 'If you can see this, alerts work on this device.', { tag: 'sloane-test', view: 'command' });
    if (!ok) Toast.error('The test alert could not be shown. Check this browser’s notification settings.');
    else Toast.success('Test alert sent. Look for it on your screen.');
  },

  /** A test that arrives from the server, so the owner can close Sloane first and still see it. */
  async sendClosedTestAlert() {
    try {
      await ApiService.sendTestPush(10000);
      Toast.success('Close this tab (or the app) now. A test alert arrives in about 10 seconds.');
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async checkAlertsNow() {
    await this.checkAlerts();
    Toast.info('Checked.');
  }
};
