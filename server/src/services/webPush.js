/**
 * Web Push: alerts that reach the owner's computer or phone even when Sloane is completely closed.
 *
 * How it works
 *  - Each device the owner turns alerts on for gives the server a "subscription" (an address at the
 *    browser maker's push service, plus keys). Sloane keeps these and sends to them, encrypted, signed
 *    with its own VAPID key pair (so only this Sloane can push to them).
 *  - Every 5 minutes the server looks at the alerts (services/alerts.js). The first time, it only
 *    notes what is already there. After that, a NEW alert (late, stuck, due today, nobody has it) is
 *    pushed once: up to 3 on their own, then one line for the rest.
 *  - On weekday mornings (UK time, from 08:00) it pushes the morning briefing's headline once.
 *  - A device that the push service says is gone (404 / 410) is forgotten. The page registers itself
 *    again each time it is opened, so a lost subscription heals itself.
 *
 * Keys: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (set both, in Railway). Without them Sloane makes a
 * temporary pair that lasts until the next restart; devices then register again the next time Sloane
 * is opened, but nothing can be pushed to a closed device in between. The Settings card says so.
 */

import crypto from 'node:crypto';
import webpush from 'web-push';
import { mockDb } from '../data/db.js';
import { config } from '../config.js';
import { buildAlerts } from './alerts.js';
import { buildMorningBriefing } from './morningBriefing.js';
import { ukToday } from './weeklyReport.js';

const META_ID = 'web-push';
const MAX_SINGLE = 3;
const FAILURES_BEFORE_DROP = 8;

let sender = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);
/** For tests: replace the call that talks to the push service. */
export function setSender(fn) { sender = fn || ((s, p, o) => webpush.sendNotification(s, p, o)); }

/* ------------------------------------------------------------------ keys */

let temporary = null;

/** The VAPID pair in use: the one set in the environment, or a temporary one. */
export function vapidKeys() {
  const { publicKey, privateKey } = config.push;
  if (publicKey && privateKey) return { publicKey, privateKey, temporary: false };
  if (!temporary) temporary = webpush.generateVAPIDKeys();
  return { ...temporary, temporary: true };
}

function subject() {
  const s = config.push.subject;
  if (s) return s;
  return config.owner.email ? `mailto:${config.owner.email}` : 'mailto:sloane@example.com';
}

function options(extra = {}) {
  const k = vapidKeys();
  return { vapidDetails: { subject: subject(), publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 12 * 60 * 60, urgency: 'normal', ...extra };
}

/* ------------------------------------------------------------------ state */

function meta() {
  if (!Array.isArray(mockDb.appMeta)) mockDb.appMeta = [];
  let row = mockDb.appMeta.find(m => m.id === META_ID);
  if (!row) {
    row = { id: META_ID, primed: false, seen: [], lastBriefing: null, lastScanAt: null };
    mockDb.appMeta.push(row);
  }
  return row;
}

function subs() {
  if (!Array.isArray(mockDb.pushSubscriptions)) mockDb.pushSubscriptions = [];
  return mockDb.pushSubscriptions;
}

export const subscriptionCount = () => subs().length;

const idFor = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

/** Checks and stores a browser's subscription. Returns { error } or { ok, count }. */
export function saveSubscription(sub, userAgent = '') {
  const endpoint = sub && typeof sub.endpoint === 'string' ? sub.endpoint : '';
  const p256dh = sub && sub.keys && sub.keys.p256dh;
  const auth = sub && sub.keys && sub.keys.auth;
  let url;
  try { url = new URL(endpoint); } catch (_) { url = null; }
  if (!url || url.protocol !== 'https:' || endpoint.length > 1000) return { error: 'That device address does not look right.' };
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100 || !p256dh || !auth) return { error: 'That device did not send its keys.' };

  const now = new Date().toISOString();
  const id = idFor(endpoint);
  const existing = subs().find(s => s.id === id);
  if (existing) {
    Object.assign(existing, { keys: { p256dh, auth }, userAgent: String(userAgent).slice(0, 200), lastSeenAt: now, failures: 0 });
  } else {
    subs().push({ id, endpoint, keys: { p256dh, auth }, userAgent: String(userAgent).slice(0, 200), createdAt: now, lastSeenAt: now, lastSuccessAt: null, failures: 0 });
  }
  // The first device only needs to hear about NEW things from now on
  const m = meta();
  if (!m.primed) {
    m.seen = buildAlerts().alerts.filter(a => a.level !== 'info').map(a => a.id);
    m.primed = true;
  }
  return { ok: true, count: subs().length };
}

export function removeSubscription(endpoint) {
  const list = subs();
  const i = list.findIndex(s => s.endpoint === endpoint);
  if (i >= 0) list.splice(i, 1);
  return list.length;
}

/* ------------------------------------------------------------------ sending */

/**
 * Sends one notification to every device.
 * @param {{title:string, body?:string, tag?:string, view?:string}} message
 */
export async function sendToAll(message, extra = {}) {
  const payload = JSON.stringify({
    title: String(message.title || 'Sloane').slice(0, 120),
    body: String(message.body || '').slice(0, 300),
    tag: message.tag ? String(message.tag).slice(0, 120) : undefined,
    view: message.view || 'command'
  });
  const out = { sent: 0, removed: 0, failed: 0 };
  for (const s of [...subs()]) {
    try {
      await sender({ endpoint: s.endpoint, keys: s.keys }, payload, options(extra));
      s.lastSuccessAt = new Date().toISOString();
      s.failures = 0;
      out.sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        removeSubscription(s.endpoint);
        out.removed++;
      } else {
        s.failures = (s.failures || 0) + 1;
        out.failed++;
        if (s.failures >= FAILURES_BEFORE_DROP) { removeSubscription(s.endpoint); out.removed++; }
      }
    }
  }
  return out;
}

/** Pushes a test to every device after a short wait, so the owner can close Sloane first. */
export function scheduleTest(delayMs = 10000) {
  const wait = Math.max(0, Math.min(30000, Number(delayMs) || 0));
  const run = () => sendToAll({ title: 'Test alert from Sloane', body: 'This arrived while Sloane was closed, so alerts work on this device.', tag: 'sloane-push-test', view: 'command' }, { urgency: 'high' });
  if (wait === 0) return run();
  const timer = setTimeout(() => { run().catch(() => {}); }, wait);
  if (timer.unref) timer.unref();
  return Promise.resolve({ scheduled: true, inMs: wait });
}

/* ------------------------------------------------------------------ what to send, and when */

/** UK weekday (1 = Monday) and hour for a moment. */
function ukClock(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday').value;
  return { weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday) + 1, hour: Number(parts.find(p => p.type === 'hour').value) };
}

/** Pushes new alerts (once each) and, on weekday mornings, the briefing's headline. */
export async function scanAndPush(now = new Date()) {
  const result = { alerts: 0, briefing: false, primed: false };
  if (!subs().length) return result;
  const m = meta();
  m.lastScanAt = now.toISOString();

  const current = buildAlerts(now).alerts.filter(a => a.level !== 'info');
  if (!m.primed) {
    m.seen = current.map(a => a.id);
    m.primed = true;
    result.primed = true;
  } else {
    const seen = new Set(m.seen);
    const fresh = current.filter(a => !seen.has(a.id));
    // Only what is still a problem is remembered, so something that comes back is announced again
    m.seen = current.map(a => a.id);
    for (const a of fresh.slice(0, MAX_SINGLE)) {
      await sendToAll({ title: a.title, body: a.detail, tag: a.id, view: a.view });
      result.alerts++;
    }
    if (fresh.length > MAX_SINGLE) {
      await sendToAll({ title: `${fresh.length - MAX_SINGLE} more alerts`, body: 'Open Sloane to see them.', tag: 'sloane-more', view: 'briefing' });
      result.alerts++;
    }
  }

  const clock = ukClock(now);
  const day = ukToday(now);
  if (clock.weekday <= 5 && clock.hour >= 8 && clock.hour < 12 && m.lastBriefing !== day) {
    const b = buildMorningBriefing(now);
    const first = b.priorities[0];
    await sendToAll({
      title: b.greeting,
      body: first ? `${b.headline} First: ${first.title}, ${first.why}.` : b.headline,
      tag: 'sloane-morning',
      view: 'briefing'
    });
    m.lastBriefing = day;
    result.briefing = true;
  }
  return result;
}

/** What the Settings page shows. */
export function getPushStatus() {
  const k = vapidKeys();
  return { publicKey: k.publicKey, permanentKeys: !k.temporary, devices: subs().length, lastScanAt: meta().lastScanAt };
}

export const _internals = { meta, ukClock, options, subs };
