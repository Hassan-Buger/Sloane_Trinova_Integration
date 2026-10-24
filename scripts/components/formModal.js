/**
 * Reusable dialogs: one form dialog for every "add / change" action, and one confirm dialog
 * for every "are you sure?" question. Both use the shared modals in index.html.
 */

import { ModalManager } from './modal.js';
import { escapeHtml } from '../utils/html.js';

function el(id) {
  return document.getElementById(id);
}

/**
 * Field options:
 *   name, label, type (text | textarea | date | email | select | file | checkbox | number)
 *   required, placeholder, help, options [{ value, label }], value, full (span both columns),
 *   maxlength, accept (for files)
 */
function fieldHtml(f, value) {
  const id = `ff_${f.name}`;
  const req = f.required ? ' required' : '';
  const label = `<label for="${id}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>`;
  const help = f.help ? `<div class="form-help">${escapeHtml(f.help)}</div>` : '';
  const maxlength = f.maxlength ? ` maxlength="${Number(f.maxlength)}"` : '';
  const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : '';
  const cls = `form-group${f.full === false ? '' : ' full'}`;
  const v = value === undefined || value === null ? '' : value;

  let control;
  if (f.type === 'textarea') {
    control = `<textarea class="form-control" id="${id}" name="${f.name}"${req}${maxlength}${ph}>${escapeHtml(v)}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map(o =>
      `<option value="${escapeHtml(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    control = `<select class="form-control" id="${id}" name="${f.name}"${req}>${opts}</select>`;
  } else if (f.type === 'file') {
    control = `<input type="file" class="form-control" id="${id}" name="${f.name}"${req}${f.accept ? ` accept="${escapeHtml(f.accept)}"` : ''}>`;
  } else if (f.type === 'checkbox') {
    return `<div class="${cls}"><label class="form-check"><input type="checkbox" id="${id}" name="${f.name}"${v ? ' checked' : ''}> ${escapeHtml(f.label)}</label>${help}</div>`;
  } else {
    const type = ['date', 'email', 'number'].includes(f.type) ? f.type : 'text';
    control = `<input type="${type}" class="form-control" id="${id}" name="${f.name}" value="${escapeHtml(v)}"${req}${maxlength}${ph}>`;
  }
  return `<div class="${cls}">${label}${control}${help}</div>`;
}

export const FormModal = {
  _onSubmit: null,
  _fields: [],
  _bound: false,

  _bind() {
    if (this._bound) return;
    const form = el('formModalForm');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      this._submit();
    });
    this._bound = true;
  },

  /**
   * Opens the form dialog.
   * @param {object} cfg { title, intro, fields, values, submitLabel, onSubmit(values) }
   *   onSubmit may throw: the message is shown inside the dialog and nothing is closed.
   */
  open(cfg) {
    this._bind();
    this._fields = cfg.fields || [];
    this._onSubmit = cfg.onSubmit;

    el('formModalTitle').textContent = cfg.title || '';
    const intro = el('formModalIntro');
    intro.textContent = cfg.intro || '';
    intro.hidden = !cfg.intro;
    this.showError('');

    const values = cfg.values || {};
    el('formModalFields').innerHTML = this._fields.map(f => fieldHtml(f, values[f.name] !== undefined ? values[f.name] : f.value)).join('');

    const btn = el('formModalSubmit');
    btn.textContent = cfg.submitLabel || 'Save';
    btn.disabled = false;

    ModalManager.open('formModal');
  },

  showError(message) {
    const box = el('formModalError');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  },

  /** Reads the dialog into a plain object. Files are File objects; checkboxes are true/false. */
  read() {
    const out = {};
    for (const f of this._fields) {
      const input = el(`ff_${f.name}`);
      if (!input) continue;
      if (f.type === 'file') out[f.name] = input.files && input.files[0] ? input.files[0] : null;
      else if (f.type === 'checkbox') out[f.name] = input.checked;
      else out[f.name] = typeof input.value === 'string' ? input.value.trim() : input.value;
    }
    return out;
  },

  async _submit() {
    const values = this.read();
    for (const f of this._fields) {
      if (f.required && f.type !== 'checkbox' && (values[f.name] === '' || values[f.name] === null || values[f.name] === undefined)) {
        this.showError(`Please fill in: ${f.label}.`);
        const input = el(`ff_${f.name}`);
        if (input) input.focus();
        return;
      }
    }
    const btn = el('formModalSubmit');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    this.showError('');
    try {
      await this._onSubmit(values);
      ModalManager.close('formModal');
    } catch (err) {
      this.showError((err && err.message) || 'Something went wrong. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
};

export const ConfirmDialog = {
  _resolve: null,
  _bound: false,
  _observer: null,

  _bind() {
    if (this._bound) return;
    const modal = el('confirmModal');
    if (!modal) return;
    el('confirmModalOk').addEventListener('click', () => this._finish(true));
    el('confirmModalCancel').addEventListener('click', () => this._finish(false));
    // Closing with the × button, Escape or a click outside counts as "no".
    this._observer = new MutationObserver(() => {
      if (!modal.classList.contains('open') && this._resolve) this._finish(false, false);
    });
    this._observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    this._bound = true;
  },

  _finish(answer, closeIt = true) {
    const resolve = this._resolve;
    this._resolve = null;
    if (closeIt) ModalManager.close('confirmModal');
    if (resolve) resolve(answer);
  },

  /**
   * Asks a yes / no question. Resolves true only when the owner presses the confirm button.
   * @param {object} cfg { title, message, confirmLabel, danger }
   */
  ask(cfg) {
    this._bind();
    return new Promise(resolve => {
      if (this._resolve) this._finish(false);
      this._resolve = resolve;
      el('confirmModalTitle').textContent = cfg.title || 'Are you sure?';
      el('confirmModalMessage').textContent = cfg.message || '';
      const ok = el('confirmModalOk');
      ok.textContent = cfg.confirmLabel || 'Delete';
      ok.className = cfg.danger === false ? 'btn btn-primary' : 'btn btn-danger';
      ModalManager.open('confirmModal');
      // Start on "Cancel" so a stray Enter key never deletes anything.
      setTimeout(() => el('confirmModalCancel').focus(), 60);
    });
  }
};
