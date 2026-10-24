/**
 * Settings → Sign-in security: two-step sign-in with an authenticator app (Microsoft
 * Authenticator, Google Authenticator ...), recovery codes, and trusted browsers.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { FormModal, ConfirmDialog } from '../components/formModal.js';
import { escapeHtml, formatDateGB } from '../utils/html.js';

export const SECURITY_ACTIONS = [
  'startTwoFactorSetup', 'confirmTwoFactorSetup', 'cancelTwoFactorSetup',
  'copyRecoveryCodes', 'downloadRecoveryCodes', 'finishRecoveryCodes',
  'renewRecoveryCodes', 'turnOffTwoFactor', 'forgetTrustedBrowser', 'forgetAllTrustedBrowsers'
];

function when(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

const header = (on) => `
  <div class="card-header">
    <h2>Sign-in security</h2>
    <span class="pill ${on ? 'green' : 'amber'}">${on ? 'Two-step sign-in on' : 'Two-step sign-in off'}</span>
  </div>`;

const PASSWORD_TIP = `<p class="card-help security-tip">Your browser can save your password: after signing in, choose <strong>Save</strong> when it offers. Only save it on your own computer.</p>`;

export const securityMethods = {
  async renderSecurity() {
    const card = document.getElementById('securityCard');
    if (!card) return;

    // In the middle of setting up, or showing new recovery codes: keep that on screen
    if (this.recoveryCodesToShow) return this.renderRecoveryCodes(card);
    if (this.twoFactorSetup) return this.renderSetup(card);

    let s;
    try {
      s = (await ApiService.getTwoFactorStatus()).data;
    } catch (err) {
      card.innerHTML = `${header(false)}<p class="card-help">Sloane could not check your sign-in security just now: ${escapeHtml(err.message)}</p>`;
      return;
    }
    this.twoFactorStatus = s;

    if (!s.enabled) {
      card.innerHTML = `${header(false)}
        <p class="card-help">Turn on two-step sign-in and signing in will need your password <strong>and</strong> a 6-digit code from an app on your phone. Even if someone learns your password, they cannot get in without your phone.</p>
        <button type="button" class="btn btn-primary" data-action="startTwoFactorSetup">🔐 Set up with an authenticator app</button>
        ${PASSWORD_TIP}`;
      return;
    }

    const low = s.recoveryCodesLeft <= 3;
    const browsers = s.trustedBrowsers || [];
    card.innerHTML = `${header(true)}
      <p class="card-help">On since ${escapeHtml(formatDateGB(s.enabledAt))}. Signing in needs your password and a code from your authenticator app.
        <span class="${low ? 'text-amber' : ''}">${s.recoveryCodesLeft} of 10 recovery codes left.${low ? ' Make new ones soon.' : ''}</span></p>

      <div class="security-sub">Trusted browsers (no code for ${s.trustDays} days)</div>
      ${browsers.length ? `<div class="security-list">${browsers.map(b => `
        <div class="security-row">
          <div class="security-row-main">
            <div class="security-row-title">${escapeHtml(b.label)}${b.current ? ' <span class="pill blue">This browser</span>' : ''}</div>
            <div class="security-row-meta">Trusted ${escapeHtml(when(b.createdAt))} · last used ${escapeHtml(when(b.lastUsedAt))} · asks again after ${escapeHtml(formatDateGB(b.expiresAt))}</div>
          </div>
          <button type="button" class="card-action-btn text-red" data-action="forgetTrustedBrowser" data-id="${escapeHtml(b.id)}">Forget</button>
        </div>`).join('')}</div>` : '<p class="card-help">No browsers are trusted. Tick "Trust this browser" when you type your code, and that browser will not ask again for 30 days.</p>'}

      <div class="security-actions">
        <button type="button" class="btn btn-secondary" data-action="renewRecoveryCodes">Make new recovery codes</button>
        ${browsers.length > 1 ? '<button type="button" class="btn btn-secondary" data-action="forgetAllTrustedBrowsers">Forget all browsers</button>' : ''}
        <button type="button" class="btn btn-danger" data-action="turnOffTwoFactor">Turn off two-step sign-in</button>
      </div>
      ${PASSWORD_TIP}`;
  },

  renderSetup(card) {
    const st = this.twoFactorSetup;
    card.innerHTML = `${header(false)}
      <ol class="security-steps">
        <li>
          <strong>Install an authenticator app on your phone.</strong>
          <span>Microsoft Authenticator or Google Authenticator are free in the App Store and Google Play.</span>
        </li>
        <li>
          <strong>In the app, add an account and scan this QR code.</strong>
          <div class="security-qr">${st.qrSvg}</div>
          <span>Cannot scan it? In the app choose "Enter a setup key" and type this key:</span>
          <code class="security-key">${escapeHtml(st.secret)}</code>
          <span class="security-phone-link">On your phone already? <a href="${escapeHtml(st.uri)}">Open in my authenticator app</a></span>
        </li>
        <li>
          <strong>Type the 6-digit code the app now shows for Sloane.</strong>
          <div class="security-confirm">
            <input type="text" class="form-control security-code-input" id="twoFactorSetupCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" aria-label="6-digit code from your app">
            <button type="button" class="btn btn-primary" data-action="confirmTwoFactorSetup">Switch on</button>
            <button type="button" class="btn btn-secondary" data-action="cancelTwoFactorSetup">Cancel</button>
          </div>
        </li>
      </ol>`;
    setTimeout(() => document.getElementById('twoFactorSetupCode')?.focus(), 60);
  },

  renderRecoveryCodes(card) {
    const codes = this.recoveryCodesToShow;
    card.innerHTML = `${header(true)}
      <div class="sourcebanner security-save-banner"><span>🔑</span><span><strong>Save these recovery codes now.</strong> If you lose your phone, each code lets you sign in once. They will not be shown again.</span></div>
      <div class="security-codes">${codes.map(c => `<code>${escapeHtml(c)}</code>`).join('')}</div>
      <div class="security-actions">
        <button type="button" class="btn btn-secondary" data-action="copyRecoveryCodes">📋 Copy codes</button>
        <button type="button" class="btn btn-secondary" data-action="downloadRecoveryCodes">⬇ Download as a text file</button>
      </div>
      <label class="form-check security-saved"><input type="checkbox" id="recoveryCodesSaved"> I have saved my recovery codes somewhere safe (not on this computer only)</label>
      <button type="button" class="btn btn-primary" data-action="finishRecoveryCodes">Done</button>`;
  },

  async startTwoFactorSetup() {
    const res = await ApiService.startTwoFactorSetup();
    this.twoFactorSetup = res.data;
    await this.renderSecurity();
  },

  async cancelTwoFactorSetup() {
    this.twoFactorSetup = null;
    await this.renderSecurity();
  },

  async confirmTwoFactorSetup() {
    const input = document.getElementById('twoFactorSetupCode');
    const code = (input?.value || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) {
      Toast.error('Please type the 6 digits your authenticator app shows.');
      input?.focus();
      return;
    }
    try {
      const res = await ApiService.confirmTwoFactorSetup(code);
      this.twoFactorSetup = null;
      this.recoveryCodesToShow = res.data.recoveryCodes;
      Toast.success('Two-step sign-in is on.');
      await this.renderSecurity();
    } catch (err) {
      Toast.error(err.message);
      if (input) { input.value = ''; input.focus(); }
    }
  },

  recoveryCodesText() {
    return [
      'Sloane recovery codes',
      `Made ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}`,
      '',
      'Each code lets you sign in once if you do not have your phone.',
      'Keep this somewhere safe. Making new codes stops these from working.',
      '',
      ...(this.recoveryCodesToShow || [])
    ].join('\r\n');
  },

  async copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(this.recoveryCodesText());
      Toast.success('Recovery codes copied. Paste them somewhere safe.');
    } catch (_) {
      Toast.error('Your browser did not allow copying. Use "Download as a text file" instead.');
    }
  },

  downloadRecoveryCodes() {
    const blob = new Blob([this.recoveryCodesText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sloane-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  async finishRecoveryCodes() {
    if (!document.getElementById('recoveryCodesSaved')?.checked) {
      Toast.error('Please tick the box once your recovery codes are saved.');
      return;
    }
    this.recoveryCodesToShow = null;
    await this.renderSecurity();
  },

  /** Asks for a current code in the shared form dialog. */
  askForCode({ title, intro, submitLabel, onCode }) {
    FormModal.open({
      title,
      intro,
      submitLabel,
      fields: [{ name: 'code', label: 'Code from your authenticator app (or a recovery code)', required: true, placeholder: '123456', maxlength: 11 }],
      onSubmit: async v => onCode(v.code)
    });
  },

  renewRecoveryCodes() {
    this.askForCode({
      title: 'Make new recovery codes',
      intro: 'Your old recovery codes will stop working. Type the code your authenticator app shows now.',
      submitLabel: 'Make new codes',
      onCode: async code => {
        const res = await ApiService.renewRecoveryCodes(code);
        this.recoveryCodesToShow = res.data.recoveryCodes;
        await this.renderSecurity();
      }
    });
  },

  turnOffTwoFactor() {
    this.askForCode({
      title: 'Turn off two-step sign-in?',
      intro: 'Signing in will need only your password. Your recovery codes and trusted browsers will be removed. To confirm, type the code your authenticator app shows now.',
      submitLabel: 'Turn off',
      onCode: async code => {
        const res = await ApiService.turnOffTwoFactor(code);
        Toast.success(res.message || 'Two-step sign-in is off.');
        await this.renderSecurity();
      }
    });
  },

  async forgetTrustedBrowser(id) {
    const b = (this.twoFactorStatus?.trustedBrowsers || []).find(x => x.id === id);
    const ok = await ConfirmDialog.ask({
      title: 'Forget this browser?',
      message: `${b ? b.label : 'This browser'}${b && b.current ? ' (the one you are using)' : ''} will ask for a code the next time you sign in on it.`,
      confirmLabel: 'Forget browser'
    });
    if (!ok) return;
    const res = await ApiService.forgetTrustedBrowser(id);
    Toast.success(res.message || 'Done.');
    await this.renderSecurity();
  },

  async forgetAllTrustedBrowsers() {
    const ok = await ConfirmDialog.ask({
      title: 'Forget all trusted browsers?',
      message: 'Every browser, this one included, will ask for a code the next time you sign in. Use this if a computer or phone is lost.',
      confirmLabel: 'Forget all'
    });
    if (!ok) return;
    const res = await ApiService.forgetAllTrustedBrowsers();
    Toast.success(res.message || 'Done.');
    await this.renderSecurity();
  }
};
