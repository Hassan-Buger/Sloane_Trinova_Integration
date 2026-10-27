/**
 * Sloane Executive Toast Notification System
 * Replaces native blocking browser alert() dialogs with elegant non-blocking toasts.
 */

export const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'info', duration = 4000) {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ︎';
    if (type === 'success') icon = '✓';
    if (type === 'error' || type === 'warning') icon = '⚠︎';

    const iconSpan = document.createElement('span');
    iconSpan.style.fontWeight = 'bold';
    iconSpan.style.color = type === 'success' ? 'var(--green)' : type === 'error' ? 'var(--red)' : type === 'warning' ? 'var(--amber)' : 'var(--accent)';
    iconSpan.textContent = icon;

    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }, duration);
  },

  success(msg) {
    this.show(msg, 'success');
  },

  error(msg) {
    this.show(msg, 'error', 5000);
  },

  info(msg) {
    this.show(msg, 'info');
  },

  warning(msg) {
    this.show(msg, 'warning', 4500);
  }
};
