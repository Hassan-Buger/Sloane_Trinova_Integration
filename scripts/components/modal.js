/**
 * Sloane Accessible Modal Controller
 * Enforces accessibility standards: focus trapping, Escape key closing,
 * ARIA roles, and backdrop click handling.
 */

export const ModalManager = {
  activeModal: null,
  lastFocusedElement: null,

  init() {
    // Global Escape key listener
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) {
        this.close(this.activeModal.id);
      }
    });

    // Close buttons & backdrop click
    document.querySelectorAll('.modal-overlay, .modal').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || (e.target && e.target.classList && e.target.classList.contains('modal-backdrop'))) {
          this.close(overlay.id);
        }
      });

      const closeBtns = overlay.querySelectorAll('[data-close-modal]');
      closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          this.close(overlay.id);
        });
      });
    });
  },

  open(modalId, triggerElement = null) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    this.lastFocusedElement = triggerElement || document.activeElement;
    this.activeModal = modal;

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // Lock body scroll
    document.body.style.overflow = 'hidden';

    // Focus first focusable element
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      setTimeout(() => focusable[0].focus(), 50);
    }

    // Bind tab key trap
    this._bindFocusTrap(modal);
  },

  close(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');

    // Unlock body scroll if no modals remain open
    const remainingOpen = document.querySelectorAll('.modal-overlay.open, .modal.open');
    if (remainingOpen.length === 0) {
      document.body.style.overflow = '';
    }

    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }

    if (this.activeModal && this.activeModal.id === modalId) {
      this.activeModal = null;
    }
  },

  closeAll() {
    const openModals = document.querySelectorAll('.modal-overlay.open, .modal.open');
    openModals.forEach(m => this.close(m.id));
    this.activeModal = null;
    document.body.style.overflow = '';
  },

  _bindFocusTrap(modal) {
    modal.onkeydown = (e) => {
      if (e.key !== 'Tab') return;

      const focusable = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.disabled && el.offsetParent !== null);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
  }
};
