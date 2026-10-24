/**
 * Small helpers for building screen text safely.
 */

/**
 * HTML Output Escaping Utility (Section 1.4)
 * Escapes dynamic values before DOM interpolation to prevent Stored & Reflected XSS.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strict ID Sanitizer (Section 1.4)
 * Enforces alphanumeric, hyphen, underscore, and dot pattern for entity identifiers.
 * Numbers are accepted too (TriNova may use numeric ids).
 */
export function sanitizeId(id) {
  if (typeof id === 'number') id = String(id);
  if (typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_\-\.]/g, '');
}

/** 2027-03-31 -> 31 Mar 2027. Anything that is not a date comes back as a dash. */
export function formatDateGB(value) {
  if (!value) return '—';
  const d = new Date(String(value).length <= 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Today as YYYY-MM-DD in the browser's own calendar. */
export function todayIso() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The hour in the UK (0-23), whatever time zone this computer is in. Kirsty is in the UK, so the
 * greeting follows her clock, not the clock of whoever is looking at Sloane.
 */
export function ukHour(date = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(date));
  return Number.isNaN(h) ? date.getHours() : h;
}

/** "morning" (5:00-11:59), "afternoon" (12:00-16:59) or "evening" (17:00-4:59), UK time. */
export function ukPartOfDay(date = new Date()) {
  const h = ukHour(date);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  return 'evening';
}

/** "3 days late", "due today", "due in 5 days" for a YYYY-MM-DD date. */
export function describeDue(value) {
  if (!value) return 'No due date';
  const days = Math.round((new Date(`${value}T12:00:00Z`) - new Date(`${todayIso()}T12:00:00Z`)) / 86400000);
  if (Number.isNaN(days)) return 'No due date';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1) return `Due in ${days} days`;
  return days === -1 ? '1 day late' : `${-days} days late`;
}
