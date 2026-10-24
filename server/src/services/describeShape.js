/**
 * Describes a value without revealing it: field names and kinds of value only.
 * Used by the TriNova data check (the server button and check-trinova.js) so its report can be
 * shared safely.
 */

// Short label fields whose values are not personal (status, type, risk ...)
export const LABEL_FIELDS = new Set(['status', 'type', 'entity_type', 'risk_tier', 'risk', 'urgency', 'state', 'role', 'category', 'source']);

/** Describes a value without revealing it. */
export function shape(value, keyName = '', depth = 0) {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'list (empty)' : { list: `${value.length} item(s)`, firstItem: depth > 4 ? '…' : shape(value[0], '', depth + 1) };
  }
  if (typeof value === 'object') {
    if (depth > 4) return 'object';
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = shape(v, k, depth + 1);
    return out;
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return `yes/no (${value})`;
  const text = String(value);
  if (LABEL_FIELDS.has(keyName) && text.length <= 40) return `label: "${text}"`;
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(text)) return 'date';
  if (text === '') return 'text (empty)';
  return `text (${text.length} characters)`;
}
