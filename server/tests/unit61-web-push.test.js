/**
 * Unit 61 Test Suite: Web Push (alerts that reach a device when Sloane is closed)
 *
 * Verifies:
 * - The server key pair: the one set in the environment, else a temporary one (and it says which)
 * - A device's subscription is checked, stored once, and the first device only hears about NEW things
 * - What is really sent: the payload is encrypted for that device (it decrypts with the device's own keys)
 *   and signed with the VAPID key (Authorization: vapid t=..., k=<public key>), with a time to live
 * - Devices the push service says are gone (404 / 410) are forgotten; ones that keep failing are dropped
 * - The 5-minute scan: nothing is announced the first time; a new alert is pushed once with its id as the tag;
 *   more than 3 new ones become 3 plus a summary; something that clears and returns is announced again
 * - The weekday morning briefing is pushed once a day from 08:00 UK time, never at the weekend, never early
 * - Routes: owner only, bad subscriptions refused, test alert needs a device
 * - The service worker shows pushes; the page registers the device; both package files list web-push
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import ece from 'http_ece';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import {
  vapidKeys, saveSubscription, removeSubscription, subscriptionCount, sendToAll, scanAndPush, setSender, getPushStatus, _internals
} from '../src/services/webPush.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { TEST_API_KEY } from './fixtures.js';
import { loginCookie } from './support.js';

const PORT = 5161;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const KEYS = ['businesses', 'clients', 'companies', 'statutoryTracker', 'vatReturns', 'tasks', 'clientBusiness', 'teamMembers', 'suggestionDismissals', 'appMeta', 'pushSubscriptions'];
const task = (id, title, extra = {}) => ({ id, title, status: 'Pending', priority: 'Normal', dueDate: null, isBlocked: false, assigneeName: null, ...extra });

/** A real device: a P-256 key pair and an auth secret, like a browser's push subscription. */
function fakeDevice(name = 'a') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh, auth,
    subscription: {
      endpoint: `https://push.example.test/send/${name}-${crypto.randomBytes(6).toString('hex')}`,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }
    }
  };
}

describe('Unit 61: Web Push', () => {
  let saved;
  let sent;
  const savedEnv = {};

  before(() => {
    saved = {};
    for (const k of KEYS) { mockDb[k] = mockDb[k] || []; saved[k] = [...mockDb[k]]; }
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) savedEnv[k] = process.env[k];
  });
  after(() => {
    setSender(null);
    for (const k of Object.keys(savedEnv)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    for (const k of KEYS) { mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
  });
  beforeEach(() => {
    for (const k of KEYS) mockDb[k].length = 0;
    mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
    sent = [];
    setSender(async (subscription, payload, options) => { sent.push({ subscription, payload: JSON.parse(payload), options }); return { statusCode: 201 }; });
  });

  describe('1. Keys and devices', () => {
    test('1.1 a temporary pair without settings, the set pair when both are set', () => {
      delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
      const t = vapidKeys();
      assert.equal(t.temporary, true);
      assert.equal(vapidKeys().publicKey, t.publicKey, 'the same temporary pair until restart');
      assert.equal(getPushStatus().permanentKeys, false);
      const pair = webpush.generateVAPIDKeys();
      process.env.VAPID_PUBLIC_KEY = pair.publicKey; process.env.VAPID_PRIVATE_KEY = pair.privateKey;
      assert.deepEqual(vapidKeys(), { ...pair, temporary: false });
      assert.equal(getPushStatus().permanentKeys, true);
      assert.equal(JSON.stringify(getPushStatus()).includes(pair.privateKey), false, 'the private key is never shown');
    });

    test('1.2 a device is checked, stored once, and re-registering does not make a second', () => {
      const d = fakeDevice();
      assert.match(saveSubscription({ endpoint: 'http://not-secure.test/x', keys: d.subscription.keys }).error, /does not look right/);
      assert.match(saveSubscription({ endpoint: d.subscription.endpoint, keys: {} }).error, /did not send its keys/);
      assert.match(saveSubscription(null).error, /does not look right/);
      assert.equal(saveSubscription(d.subscription, 'Edge').count, 1);
      assert.equal(saveSubscription(d.subscription, 'Edge again').count, 1);
      assert.equal(subscriptionCount(), 1);
      assert.equal(removeSubscription(d.subscription.endpoint), 0);
    });
  });

  describe('2. What is really sent', () => {
    test('2.1 the message is encrypted for the device and signed with the server key', async () => {
      const pair = webpush.generateVAPIDKeys();
      process.env.VAPID_PUBLIC_KEY = pair.publicKey; process.env.VAPID_PRIVATE_KEY = pair.privateKey; process.env.VAPID_SUBJECT = 'mailto:owner@example.test';
      const d = fakeDevice();
      saveSubscription(d.subscription);
      await sendToAll({ title: 'Accounts for Late Ltd is 40 days late', body: 'Was due 2026-09-01.', tag: 'late:filing:Accounts', view: 'statutory' });
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0].payload, { title: 'Accounts for Late Ltd is 40 days late', body: 'Was due 2026-09-01.', tag: 'late:filing:Accounts', view: 'statutory' });
      assert.equal(sent[0].options.TTL, 43200);
      assert.deepEqual(sent[0].options.vapidDetails, { subject: 'mailto:owner@example.test', publicKey: pair.publicKey, privateKey: pair.privateKey });

      // The same call made for real by the library: what would go over the wire
      const wire = webpush.generateRequestDetails(sent[0].subscription, JSON.stringify(sent[0].payload), sent[0].options);
      assert.equal(wire.method, 'POST');
      assert.equal(wire.endpoint, d.subscription.endpoint);
      assert.match(wire.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
      assert.ok(wire.headers.Authorization.endsWith(`k=${pair.publicKey}`));
      assert.equal(wire.headers['Content-Encoding'], 'aes128gcm');
      assert.equal(wire.headers.TTL, 43200);
      const plain = ece.decrypt(wire.body, { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.subscription.keys.auth });
      assert.equal(JSON.parse(plain.toString('utf8')).title, 'Accounts for Late Ltd is 40 days late', 'only that device can read it');
      // The signature checks out against the public key
      const jwt = wire.headers.Authorization.match(/t=([^,]+)/)[1].split('.');
      const verify = crypto.createVerify('SHA256').update(`${jwt[0]}.${jwt[1]}`);
      const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), Buffer.from(pair.publicKey, 'base64url')]), format: 'der', type: 'spki' });
      assert.equal(verify.verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')), true);
      assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).sub, 'mailto:owner@example.test');
    });

    test('2.2 a device the push service has forgotten is dropped; one that keeps failing is dropped after 8 tries', async () => {
      const gone = fakeDevice('gone'); const flaky = fakeDevice('flaky'); const fine = fakeDevice('fine');
      for (const d of [gone, flaky, fine]) saveSubscription(d.subscription);
      setSender(async sub => {
        if (sub.endpoint === gone.subscription.endpoint) throw Object.assign(new Error('Gone'), { statusCode: 410 });
        if (sub.endpoint === flaky.subscription.endpoint) throw Object.assign(new Error('Busy'), { statusCode: 503 });
        return { statusCode: 201 };
      });
      let out = await sendToAll({ title: 't' });
      assert.deepEqual(out, { sent: 1, removed: 1, failed: 1 });
      assert.equal(subscriptionCount(), 2);
      for (let i = 0; i < 7; i++) out = await sendToAll({ title: 't' });
      assert.equal(subscriptionCount(), 1, 'the flaky device was dropped after 8 failures');
      assert.equal(_internals.subs()[0].endpoint, fine.subscription.endpoint);
    });
  });

  describe('3. The 5-minute scan', () => {
    // A Saturday, so the weekday morning briefing never fires in these tests, whatever the real time is
    const SATURDAY = new Date('2026-11-07T14:00:00Z');

    test('3.1 the first scan announces nothing; then a new alert is pushed once', async () => {
      mockDb.statutoryTracker.push({ id: 'dl1', origin: 'manual', companyNumber: '61000001', name: 'Old Ltd', accountsDueDate: plus(-30), confirmationDueDate: null, status: 'Active', businessArea: 'TriNova Accounting' });
      saveSubscription(fakeDevice().subscription);
      const first = await scanAndPush(SATURDAY);
      assert.equal(sent.length, 0, 'what was already late is not announced');
      assert.equal(first.alerts, 0);
      mockDb.tasks.push(task('s1', 'Chase statements', { isBlocked: true, blocker: 'Waiting for the client', assigneeName: 'Priya', businessArea: 'TriNova Accounting' }));
      const second = await scanAndPush(SATURDAY);
      assert.equal(second.alerts, 1);
      assert.equal(sent[0].payload.title, '"Chase statements" is stuck');
      assert.equal(sent[0].payload.body, 'Waiting for the client (Priya).');
      assert.match(sent[0].payload.tag, /^stuck:Chase statements/, 'the alert id is the tag, so it replaces rather than repeats');
      assert.equal(sent[0].payload.view, 'people');
      await scanAndPush(SATURDAY);
      assert.equal(sent.length, 1, 'announced once only');
    });

    test('3.2 more than 3 new alerts become 3 and a summary; something that clears and returns is announced again', async () => {
      saveSubscription(fakeDevice().subscription);
      await scanAndPush(SATURDAY);
      for (let i = 0; i < 5; i++) mockDb.tasks.push(task(`b${i}`, `Stuck ${i}`, { isBlocked: true, blocker: 'Held up', businessArea: 'MTDflow' }));
      await scanAndPush(SATURDAY);
      assert.equal(sent.length, 4);
      assert.equal(sent[3].payload.title, '2 more alerts');
      sent.length = 0;
      mockDb.tasks.length = 0;
      await scanAndPush(SATURDAY);
      mockDb.tasks.push(task('b0', 'Stuck 0', { isBlocked: true, blocker: 'Held up', businessArea: 'MTDflow' }));
      await scanAndPush(SATURDAY);
      assert.equal(sent.length, 1, 'it came back, so it is announced again');
    });

    test('3.3 with no device, nothing runs', async () => {
      assert.deepEqual(await scanAndPush(SATURDAY), { alerts: 0, briefing: false, primed: false });
      assert.equal(sent.length, 0);
    });
  });

  describe('4. The morning briefing', () => {
    const at = iso => new Date(iso);

    test('4.1 pushed once a day on a weekday morning (UK time), with the headline', async () => {
      mockDb.statutoryTracker.push({ id: 'dl1', origin: 'manual', companyNumber: '61000002', name: 'Late Ltd', accountsDueDate: plus(-9), confirmationDueDate: null, status: 'Active', businessArea: 'TriNova Accounting' });
      saveSubscription(fakeDevice().subscription);
      const monday = at('2026-11-02T09:30:00Z'); // 09:30 in London (GMT)
      const out = await scanAndPush(monday);
      assert.equal(out.briefing, true);
      const brief = sent.find(m => m.payload.tag === 'sloane-morning');
      assert.match(brief.payload.title, /^Good (morning|afternoon|evening), Kirsty$/);
      assert.match(brief.payload.body, /things? needs? you first/);
      assert.equal(brief.payload.view, 'briefing');
      sent.length = 0;
      assert.equal((await scanAndPush(at('2026-11-02T10:30:00Z'))).briefing, false, 'not twice on the same day');
      assert.equal((await scanAndPush(at('2026-11-03T09:00:00Z'))).briefing, true, 'again the next morning');
    });

    test('4.2 not before 08:00 UK time, and not at the weekend; British summer time counts', async () => {
      saveSubscription(fakeDevice().subscription);
      assert.equal((await scanAndPush(at('2026-11-02T07:30:00Z'))).briefing, false, '07:30');
      assert.equal((await scanAndPush(at('2026-11-07T09:30:00Z'))).briefing, false, 'Saturday');
      assert.equal((await scanAndPush(at('2026-11-08T09:30:00Z'))).briefing, false, 'Sunday');
      assert.equal(_internals.ukClock(at('2026-07-06T07:30:00Z')).hour, 8, '07:30 UTC is 08:30 in London in July');
      assert.equal((await scanAndPush(at('2026-07-06T07:30:00Z'))).briefing, true);
    });
  });

  describe('5. Routes and files', () => {
    let server; let baseUrl;
    before(async () => {
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

    test('5.1 only the signed-in owner can use them; bad devices are refused; a test needs a device', async () => {
      assert.equal((await fetch(`${baseUrl}/api/v1/push/config`)).status, 401);
      const key = await fetch(`${baseUrl}/api/v1/push/config`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.ok([401, 403].includes(key.status));
      const cookie = await loginCookie(baseUrl);
      const h = { Cookie: cookie, 'Content-Type': 'application/json' };
      const cfg = await (await fetch(`${baseUrl}/api/v1/push/config`, { headers: h })).json();
      assert.ok(cfg.data.publicKey.length > 60);
      assert.equal(JSON.stringify(cfg).includes('privateKey'), false);
      assert.equal((await fetch(`${baseUrl}/api/v1/push/subscribe`, { method: 'POST', headers: h, body: JSON.stringify({ subscription: { endpoint: 'nope' } }) })).status, 422);
      assert.equal((await fetch(`${baseUrl}/api/v1/push/test`, { method: 'POST', headers: h, body: '{}' })).status, 409);
      const d = fakeDevice();
      const ok = await fetch(`${baseUrl}/api/v1/push/subscribe`, { method: 'POST', headers: h, body: JSON.stringify({ subscription: d.subscription }) });
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).data.devices, 1);
      const test = await fetch(`${baseUrl}/api/v1/push/test`, { method: 'POST', headers: h, body: JSON.stringify({ delayMs: 0 }) });
      assert.equal(test.status, 200);
      assert.equal(sent.at(-1).payload.title, 'Test alert from Sloane');
      const gone = await fetch(`${baseUrl}/api/v1/push/unsubscribe`, { method: 'POST', headers: h, body: JSON.stringify({ endpoint: d.subscription.endpoint }) });
      assert.equal((await gone.json()).data.devices, 0);
    });

    test('5.2 the service worker shows pushes, the page registers the device, and the library is a dependency', () => {
      const sw = fs.readFileSync(path.join(root, 'scripts/sw.js'), 'utf8');
      assert.match(sw, /addEventListener\('push'/);
      assert.match(sw, /showNotification\(data\.title/);
      const page = fs.readFileSync(path.join(root, 'scripts/features/alerts.js'), 'utf8');
      assert.match(page, /pushManager\.subscribe\(\{ userVisibleOnly: true/);
      assert.match(page, /setUpPush\(\)/);
      assert.match(page, /sendClosedTestAlert/);
      for (const f of ['package.json', 'server/package.json']) {
        assert.ok(JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).dependencies['web-push'], `${f} lists web-push`);
      }
      assert.ok(fs.existsSync(path.join(root, 'server/scripts/generate-vapid-keys.js')));
    });
  });
});
