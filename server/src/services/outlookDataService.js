/**
 * Outlook Data Service: Mapping & In-Memory Caching
 * Implements Tasks P6.1, P6.2, and P6.3 per docs/outlook-build/SPEC.md §4.3:
 * - Pure mapping functions: mapGraphEventsToDiary, mapGraphMessagesToFlagged
 * - Clash detection for overlapping calendar events
 * - 2-minute per-user in-memory caching keyed by actor and resource
 * - Clean empty states with exact specification messages
 */

import { outlookDataCache, clearOutlookDataCache } from '../routes/outlookSettings.js';

export const DATA_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes per §4.3

/**
 * Formats start and end datetime into a London-localized time string.
 *
 * @param {object} start - Graph start dateTime object { dateTime, timeZone }
 * @param {object} end - Graph end dateTime object { dateTime, timeZone }
 * @param {boolean} [isAllDay=false]
 * @returns {string} Formatted string e.g. "10:00 - 11:00" or "All day"
 */
export function formatEventTimeRange(start, end, isAllDay = false) {
  if (isAllDay) return 'All day';
  if (!start?.dateTime && !end?.dateTime) return '';

  const formatTimeStr = (dtStr) => {
    if (!dtStr) return '';
    const match = String(dtStr).match(/T(\d{2}:\d{2})/);
    if (match) return match[1];
    const d = new Date(dtStr);
    if (!isNaN(d.getTime())) {
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    }
    return '';
  };

  const startTime = formatTimeStr(start?.dateTime);
  const endTime = formatTimeStr(end?.dateTime);

  if (startTime && endTime) {
    return `${startTime} - ${endTime}`;
  }
  return startTime || endTime || '';
}

/**
 * Identifies IDs of events that overlap with another non-all-day event today.
 * Overlap condition: (StartA < EndB) and (EndA > StartB)
 *
 * @param {Array<object>} events - Raw Graph events
 * @returns {Set<string>} Set of clashing event IDs
 */
export function detectEventClashes(events = []) {
  const clashIds = new Set();
  if (!Array.isArray(events)) return clashIds;

  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (a.isAllDay) continue;
    const aStart = new Date(a.start?.dateTime).getTime();
    const aEnd = new Date(a.end?.dateTime).getTime();
    if (isNaN(aStart) || isNaN(aEnd)) continue;

    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (b.isAllDay) continue;
      const bStart = new Date(b.start?.dateTime).getTime();
      const bEnd = new Date(b.end?.dateTime).getTime();
      if (isNaN(bStart) || isNaN(bEnd)) continue;

      if (aStart < bEnd && aEnd > bStart) {
        if (a.id) clashIds.add(String(a.id));
        if (b.id) clashIds.add(String(b.id));
      }
    }
  }

  return clashIds;
}

/**
 * Pure mapping function converting Microsoft Graph calendarView items to Sloane DIARY_ITEMS shape.
 *
 * @param {Array<object>} rawEvents - Graph calendarView value items
 * @returns {Array<object>} Mapped diary items
 */
export function mapGraphEventsToDiary(rawEvents = []) {
  if (!Array.isArray(rawEvents)) return [];

  const clashIds = detectEventClashes(rawEvents);

  return rawEvents.map(event => {
    const isClash = Boolean(event.id && clashIds.has(String(event.id)));
    const time = formatEventTimeRange(event.start, event.end, Boolean(event.isAllDay));
    let chip = 'TODAY';
    if (isClash || event.importance === 'high') {
      chip = 'URGENT';
    }

    return {
      id: String(event.id || ''),
      title: String(event.subject || '(No subject)'),
      time,
      chip,
      location: String(event.location?.displayName || ''),
      isAllDay: Boolean(event.isAllDay),
      isClash,
      showAs: String(event.showAs || 'busy'),
      start: event.start || null,
      end: event.end || null
    };
  });
}

/**
 * Formats sender and received date into a human-readable subtitle.
 *
 * @param {string} fromStr - Sender display name or email address
 * @param {string} receivedDateTime - ISO datetime string
 * @returns {string} Formatted subtitle
 */
export function formatMessageSub(fromStr, receivedDateTime) {
  const sender = fromStr || 'Unknown sender';
  if (!receivedDateTime) return sender;

  const d = new Date(receivedDateTime);
  if (isNaN(d.getTime())) return sender;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatted = `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${sender} · ${formatted}`;
}

/**
 * Pure mapping function converting Microsoft Graph messages to Sloane ATTENTION_EMAILS shape.
 *
 * @param {Array<object>} rawMessages - Graph messages value items
 * @returns {Array<object>} Mapped attention emails
 */
export function mapGraphMessagesToFlagged(rawMessages = []) {
  if (!Array.isArray(rawMessages)) return [];

  return rawMessages.map(msg => {
    const fromName = msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown sender';
    const priority = msg.importance === 'high' ? 'High' : 'Normal';
    const sub = formatMessageSub(fromName, msg.receivedDateTime);

    return {
      id: String(msg.id || ''),
      title: String(msg.subject || '(No subject)'),
      sub,
      priority,
      from: fromName,
      receivedDateTime: msg.receivedDateTime || null,
      webLink: msg.webLink || null
    };
  });
}

/**
 * Retrieves cached response data for an actor and resource if not expired.
 *
 * @param {string} actorId - Session actor identifier
 * @param {string} resource - 'diary' | 'flagged-emails'
 * @returns {object|null}
 */
export function getCachedResource(actorId, resource) {
  const key = `${actorId || 'default'}:${resource}`;
  const entry = outlookDataCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    outlookDataCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Stores response data in memory with 2-minute TTL.
 *
 * @param {string} actorId - Session actor identifier
 * @param {string} resource - 'diary' | 'flagged-emails'
 * @param {object} data - Payload to cache
 * @param {number} [ttlMs=DATA_CACHE_TTL_MS]
 */
export function setCachedResource(actorId, resource, data, ttlMs = DATA_CACHE_TTL_MS) {
  const key = `${actorId || 'default'}:${resource}`;
  outlookDataCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

export { clearOutlookDataCache };

export const outlookDataService = {
  DATA_CACHE_TTL_MS,
  formatEventTimeRange,
  detectEventClashes,
  mapGraphEventsToDiary,
  formatMessageSub,
  mapGraphMessagesToFlagged,
  getCachedResource,
  setCachedResource,
  clearOutlookDataCache
};

export default outlookDataService;
