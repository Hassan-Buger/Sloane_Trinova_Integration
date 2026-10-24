/**
 * Unit 52 Test Suite: two-step sign-in (authenticator app), recovery codes, trusted browsers
 *
 * Verifies:
 * - Codes match the RFC 6238 test values; a code cannot be used twice; a clock one step off is fine
 * - The QR code reads back exactly with an independent reader (tests/lib/qrRead.js)
 * - Set-up only switches on after a correct code; recovery codes are shown once
 * - Sign-in: password, then code; wrong codes count towards the lockout; 5 wrong codes end the try
 * - "Trust this browser": an HttpOnly, SameSite=Strict cookie limited to /api/v1/auth, 30 days;
 *   a trusted browser skips the code (never the password); forgetting it asks again
 * - Recovery codes work once each; new codes replace the old ones
 * - Turning off needs a code; API keys cannot use any of this
 * - Stored data holds no readable secret, recovery code or browser token
 * - TWO_FACTOR_RESET switches it off (the developer's emergency switch)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { sessionStore } from '../src/services/sessionStore.js';
import * as totp from '../src/services/totp.js';
import { makeQr, qrSvg } from '../src/services/qrcode.js';
import * as twoFactor from '../src/services/twoFactor.js';
import { readQr } from './lib/qrRead.js';
import { TEST_API_KEY, TEST_PASSWORD } from './fixtures.js';

const PORT = 5052;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Unit 52: two-step sign-in', () => {
  describe('1. Authenticator codes', () => {
    test('1.1 the RFC 6238 test values', () => {
      const key = Buffer.from('12345678901234567890');
      for (const [sec, want] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
        assert.equal(totp.codeForStep(key, Math.floor(sec / 30), 8), want);
      }
      assert.equal(totp.base32Encode(key), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      assert.equal(totp.base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').toString(), '12345678901234567890');
    });

    test('1.2 a clock one step off is accepted, two is not, and a code cannot be used twice', () => {
      const secret = totp.generateSecret();
      const now = Date.now();
      const step = totp.stepAt(now);
      assert.equal(totp.verifyCode(secret, totp.codeForStep(secret, step - 1), { now }), step - 1);
      assert.equal(totp.verifyCode(secret, totp.codeForStep(secret, step + 1), { now }), step + 1);
      assert.equal(totp.verifyCode(secret, totp.codeForStep(secret, step + 2), { now }), null);
      assert.equal(totp.verifyCode(secret, totp.codeForStep(secret, step), { now, lastUsedStep: step }), null, 'replay refused');
      assert.equal(totp.verifyCode(secret, 'abcdef', { now }), null);
      assert.equal(totp.verifyCode(secret, '12345', { now }), null);
    });

    test('1.3 the set-up address is what the apps expect, and its QR code reads back exactly', () => {
      const secret = totp.generateSecret();
      const uri = totp.otpauthUri({ secret, account: 'kirsty.allen@trinova.co.uk' });
      assert.equal(uri, `otpauth://totp/Sloane:kirsty.allen%40trinova.co.uk?secret=${secret}&issuer=Sloane`);
      const qr = makeQr(uri);
      assert.equal(readQr(qr.modules).text, uri);
      assert.ok(qr.version <= 6, 'small enough to scan easily');
      for (const text of ['A', 'x'.repeat(14), 'x'.repeat(15), 'y'.repeat(120), 'z'.repeat(213), 'é£ ✓']) {
        assert.equal(readQr(makeQr(text).modules).text, text, `reads back: ${text.slice(0, 10)}`);
      }
      const svg = qrSvg(uri);
      assert.match(svg, /^<svg [^>]*viewBox="0 0 49 49"/, 'a 41-module code plus a 4-module quiet border');
      assert.throws(() => makeQr('x'.repeat(214)), /too much text/);
    });
  });

  describe('2. Sign-in, set-up and settings over HTTP', () => {
    let server;
    let baseUrl;
    let ip = 0;
    const email = () => process.env.SLON_OWNER_EMAIL;
    // A different (made-up) address per request group, so the lockout of one test cannot affect another
    const nextIp = () => `10.52.0.${++ip}`;
    const post = (p, body, headers = {}) => fetch(`${baseUrl}/api/v1${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
    const cookiesOf = res => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).filter(Boolean);
    const cookieValue = (res, name) => {
      const c = cookiesOf(res).find(x => x.startsWith(`${name}=`));
      return c ? c.split(';')[0] : null;
    };
    const rec = () => mockDb.security.find(r => r.id === `owner:${email().toLowerCase()}`);
    let secret;

    const signIn = async (extraCookie = '', forwardedFor = nextIp()) => {
      const res = await post('/auth/login', { email: email(), password: TEST_PASSWORD }, { Cookie: extraCookie, 'X-Forwarded-For': forwardedFor });
      return { res, body: await res.json(), session: cookieValue(res, 'slon_session') };
    };
    // Each new code needs a new time step; in the test, "wait 30 seconds" by forgetting the last step used
    const freshCode = () => { rec().lastUsedStep = null; return totp.codeForStep(secret, totp.stepAt()); };

    before(async () => {
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });

    after(async () => {
      twoFactor.resetAll();
      if (server) await new Promise(resolve => server.close(resolve));
    });

    test('2.1 off by default: the password alone signs in', async () => {
      const { res, body, session } = await signIn();
      assert.equal(res.status, 200);
      assert.equal(body.status, 'success');
      assert.ok(session, 'session cookie set');
    });

    test('2.2 only the signed-in owner can open sign-in security; an API key cannot', async () => {
      const key = await fetch(`${baseUrl}/api/v1/auth/two-factor`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.equal(key.status, 403);
      const setup = await post('/auth/two-factor/setup', {}, { Authorization: `Bearer ${TEST_API_KEY}` });
      assert.equal(setup.status, 403);
      const anon = await fetch(`${baseUrl}/api/v1/auth/two-factor`);
      assert.equal(anon.status, 401);
    });

    test('2.3 set-up: a QR code and key; nothing changes until a correct code is typed', async () => {
      const { session } = await signIn();
      const s = await post('/auth/two-factor/setup', {}, { Cookie: session });
      assert.equal(s.status, 200);
      const setup = (await s.json()).data;
      secret = setup.secret.replace(/\s/g, '');
      assert.match(setup.secret, /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/, 'key shown in groups of four');
      assert.match(setup.qrSvg, /^<svg /);
      assert.equal(setup.uri, totp.otpauthUri({ secret, account: email() }));

      const wrong = await post('/auth/two-factor/confirm', { code: '000000' }, { Cookie: session });
      assert.equal(wrong.status, 422);
      assert.equal(twoFactor.isEnabled(email()), false, 'still off after a wrong code');

      const ok = await post('/auth/two-factor/confirm', { code: totp.codeForStep(secret, totp.stepAt()) }, { Cookie: session });
      assert.equal(ok.status, 200);
      const codes = (await ok.json()).data.recoveryCodes;
      assert.equal(codes.length, 10);
      for (const c of codes) assert.match(c, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
      assert.equal(twoFactor.isEnabled(email()), true);
      globalThis.__recoveryCodes = codes;

      const again = await post('/auth/two-factor/setup', {}, { Cookie: session });
      assert.equal(again.status, 409, 'cannot start a second set-up while on');
    });

    test('2.4 nothing readable is stored: secret encrypted, recovery codes hashed', () => {
      const r = rec();
      const stored = JSON.stringify(r);
      assert.equal(stored.includes(secret), false, 'no plain secret');
      for (const c of globalThis.__recoveryCodes) {
        assert.equal(stored.includes(c), false);
        assert.equal(stored.includes(c.replace('-', '')), false);
      }
      assert.match(r.secretEnc, /^v1\./);
      assert.throws(() => twoFactor._internals.decrypt(r.secretEnc.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))), 'a changed secret is refused');
    });

    test('2.5 sign-in now asks for the code; no session until the code is right', async () => {
      const { res, body, session } = await signIn();
      assert.equal(res.status, 200);
      assert.equal(body.status, 'two_factor_required');
      assert.ok(body.challengeId);
      assert.equal(session, null, 'no session after the password alone');

      const forwardedFor = nextIp();
      const wrong = await post('/auth/login/verify', { challengeId: body.challengeId, code: '000000' }, { 'X-Forwarded-For': forwardedFor });
      assert.equal(wrong.status, 401);
      assert.equal((await wrong.json()).error.code, 'INVALID_CODE');
      assert.equal(cookieValue(wrong, 'slon_session'), null);

      const right = await post('/auth/login/verify', { challengeId: body.challengeId, code: freshCode() }, { 'X-Forwarded-For': forwardedFor });
      assert.equal(right.status, 200);
      assert.ok(cookieValue(right, 'slon_session'), 'signed in');
      assert.equal(cookieValue(right, 'slon_trusted'), null, 'not trusted unless asked');

      const reuse = await post('/auth/login/verify', { challengeId: body.challengeId, code: freshCode() });
      assert.equal(reuse.status, 401, 'a finished challenge cannot be used again');
      assert.equal((await reuse.json()).error.code, 'CHALLENGE_EXPIRED');
    });

    test('2.6 five wrong codes end the try; wrong codes count towards the lockout', async () => {
      const forwardedFor = nextIp();
      const { body } = await signIn('', forwardedFor);
      let last;
      for (let i = 0; i < 5; i++) last = await post('/auth/login/verify', { challengeId: body.challengeId, code: '111111' }, { 'X-Forwarded-For': forwardedFor });
      assert.equal((await last.json()).error.code, 'CHALLENGE_EXPIRED');
      const locked = await post('/auth/login', { email: email(), password: TEST_PASSWORD }, { 'X-Forwarded-For': forwardedFor });
      assert.equal(locked.status, 429, 'locked out after 5 failures');
      sessionStore.resetFailures(forwardedFor);
    });

    test('2.7 "Trust this browser": a safe 30-day cookie; that browser skips the code (not the password)', async () => {
      const { body } = await signIn();
      const res = await post('/auth/login/verify', { challengeId: body.challengeId, code: freshCode(), trustBrowser: true }, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0' });
      assert.equal(res.status, 200);
      const raw = cookiesOf(res).find(c => c.startsWith('slon_trusted='));
      assert.ok(raw, 'trusted cookie set');
      assert.match(raw, /Path=\/api\/v1\/auth/);
      assert.match(raw, /HttpOnly/);
      assert.match(raw, /SameSite=Strict/);
      assert.match(raw, /Max-Age=2592000/);
      const trusted = raw.split(';')[0];
      assert.equal(JSON.stringify(rec()).includes(decodeURIComponent(trusted.split('=')[1])), false, 'only a hash is stored');

      const next = await signIn(trusted);
      assert.equal(next.body.status, 'success', 'no code asked on the trusted browser');
      assert.ok(next.session);

      const wrongPassword = await post('/auth/login', { email: email(), password: 'not-the-password' }, { Cookie: trusted, 'X-Forwarded-For': nextIp() });
      assert.equal(wrongPassword.status, 401, 'the password is still needed');

      const st = await (await fetch(`${baseUrl}/api/v1/auth/two-factor`, { headers: { Cookie: `${next.session}; ${trusted}` } })).json();
      const mine = st.data.trustedBrowsers.find(b => b.current);
      assert.ok(mine, 'this browser is marked');
      assert.equal(mine.label, 'Edge on Windows');

      // Forget it: the next sign-in asks for the code again, and the cookie is cleared
      const forget = await fetch(`${baseUrl}/api/v1/auth/two-factor/browsers/${mine.id}`, { method: 'DELETE', headers: { Cookie: `${next.session}; ${trusted}` } });
      assert.equal(forget.status, 200);
      assert.match(cookiesOf(forget).find(c => c.startsWith('slon_trusted=')) || '', /Max-Age=0/);
      const after = await signIn(trusted);
      assert.equal(after.body.status, 'two_factor_required');
    });

    test('2.8 recovery codes: each works once; new codes replace the old ones', async () => {
      const codes = globalThis.__recoveryCodes;
      const first = await signIn();
      const ok = await post('/auth/login/verify', { challengeId: first.body.challengeId, code: codes[0].toLowerCase() });
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).usedRecoveryCode, true);

      const second = await signIn();
      const used = await post('/auth/login/verify', { challengeId: second.body.challengeId, code: codes[0] });
      assert.equal(used.status, 401, 'a used recovery code does not work again');

      const { session } = await (async () => {
        const s = await signIn();
        const r = await post('/auth/login/verify', { challengeId: s.body.challengeId, code: codes[1] });
        return { session: cookieValue(r, 'slon_session') };
      })();
      const status = await (await fetch(`${baseUrl}/api/v1/auth/two-factor`, { headers: { Cookie: session } })).json();
      assert.equal(status.data.recoveryCodesLeft, 8);

      const renew = await post('/auth/two-factor/recovery-codes', { code: freshCode() }, { Cookie: session });
      assert.equal(renew.status, 200);
      const fresh = (await renew.json()).data.recoveryCodes;
      const third = await signIn();
      assert.equal((await post('/auth/login/verify', { challengeId: third.body.challengeId, code: codes[2] })).status, 401, 'old codes stop working');
      const fourth = await signIn();
      assert.equal((await post('/auth/login/verify', { challengeId: fourth.body.challengeId, code: fresh[0] })).status, 200, 'new codes work');
      globalThis.__session = cookieValue(await (async () => { const s = await signIn(); return post('/auth/login/verify', { challengeId: s.body.challengeId, code: fresh[1] }); })(), 'slon_session');
    });

    test('2.9 turning off needs a code; afterwards the password alone signs in again', async () => {
      const session = globalThis.__session;
      const refused = await post('/auth/two-factor/disable', { code: '000000' }, { Cookie: session });
      assert.equal(refused.status, 422);
      assert.equal(twoFactor.isEnabled(email()), true);
      const off = await post('/auth/two-factor/disable', { code: freshCode() }, { Cookie: session });
      assert.equal(off.status, 200);
      assert.equal(twoFactor.isEnabled(email()), false);
      const { body, session: s } = await signIn();
      assert.equal(body.status, 'success');
      assert.ok(s);
    });

    test('2.10 the emergency switch turns it off', async () => {
      const { session } = await signIn();
      const setup = (await (await post('/auth/two-factor/setup', {}, { Cookie: session })).json()).data;
      secret = setup.secret.replace(/\s/g, '');
      await post('/auth/two-factor/confirm', { code: totp.codeForStep(secret, totp.stepAt()) }, { Cookie: session });
      assert.equal(twoFactor.isEnabled(email()), true);
      assert.equal(twoFactor.resetAll(), 1);
      assert.equal(twoFactor.isEnabled(email()), false);
    });
  });

  describe('3. The pages', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'scripts/app.js'), 'utf8');
    const server = fs.readFileSync(path.join(root, 'server/src/server.js'), 'utf8');

    test('3.1 the sign-in form lets browsers save the password and fill the code', () => {
      assert.match(html, /id="loginEmail"[^>]*autocomplete="username"/);
      assert.match(html, /id="loginPassword"[^>]*autocomplete="current-password"/);
      assert.match(html, /id="loginCode"[^>]*autocomplete="one-time-code"/);
      assert.match(html, /id="trustBrowser"/);
      assert.match(html, /Trust this browser for 30 days/);
      assert.match(html, /id="useRecoveryLink"/);
      assert.match(fs.readFileSync(path.join(root, 'scripts/services/auth.js'), 'utf8'), /navigator\.credentials\.store\(new window\.PasswordCredential/);
    });

    test('3.2 Settings has the Sign-in security card, and the emergency switch is wired at start-up', () => {
      assert.match(html, /id="securityCard"/);
      assert.match(app, /this\.renderSecurity\(\)/);
      assert.match(server, /TWO_FACTOR_RESET/);
    });
  });
});
