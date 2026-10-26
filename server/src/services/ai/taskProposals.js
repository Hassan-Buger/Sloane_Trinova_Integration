/**
 * Turns what the owner types or pastes into proposed tasks. Nothing is created here: each
 * proposal is shown with an "Create task" button, and only that click makes the task.
 *
 *   "Ask Priya to chase the bank statements for Acme by Friday"   -> one task for Priya, due Friday
 *   "Remind me to call the accountant tomorrow"                    -> one task, due tomorrow
 *   A pasted email or meeting notes ("I'll send the figures by      -> a task for each commitment or
 *   Monday. Could you review the draft? Action: book the venue.")     request that Sloane can find
 *
 * It works from plain rules, not from understanding. It can miss things, and it says so: pasted
 * text is only ever offered as "check before you approve". It never guesses a person: a name that
 * is not in the team is reported, and the task is left with no assignee.
 */

import { mockDb } from '../../data/db.js';
import { clientDirectory } from '../clientDirectory.js';
import { businessOfClient } from '../businessOf.js';
import { ukToday } from '../weeklyReport.js';

const CLOSED = ['Completed', 'Cancelled'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NOT_NAMES = /^(me|us|you|them|him|her|someone|somebody|everyone|everybody|anyone|nobody|the|a|an|my|our|your|this|that|it|all|please)$/i;
const ACTION_VERBS = 'send|chase|review|prepare|file|submit|check|book|arrange|update|call|ring|email|confirm|provide|collect|get|finish|complete|follow up|sort|organise|organize|schedule|draft|write|renew|pay|register|sign|upload|fix|create|set up|reconcile|post|approve|share|forward|resend|issue|raise|request|gather|compile';

// A client whose name starts with one of these is not matched on its first word alone
const GENERIC_FIRST_WORDS = new Set(['the', 'group', 'first', 'general', 'london', 'british', 'national', 'international', 'north', 'south', 'east', 'west', 'new', 'trinova', 'sloane']);

const iso = d => d.toISOString().slice(0, 10);
const addDays = (day, n) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000));
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function weekdayOf(day) {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** The next time `weekday` (0-6) comes round after `today` (never today itself). */
function nextWeekday(today, weekday) {
  const diff = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, diff === 0 ? 7 : diff);
}

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? iso(dt) : null;
}

/** A date written in a sentence: today, tomorrow, Friday, next week, 31 July, 05/08, in 3 days ... */
export function findDate(text, today = ukToday()) {
  const t = String(text || '');
  let m;
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    const date = validDate(+m[1], +m[2], +m[3]);
    if (date) return { date, text: m[0] };
  }
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    let y = m[3] ? +m[3] : +today.slice(0, 4);
    if (y < 100) y += 2000;
    let date = validDate(y, +m[2], +m[1]);
    if (date && !m[3] && date < today) date = validDate(y + 1, +m[2], +m[1]);
    if (date) return { date, text: m[0] };
  }
  const monthWords = `${MONTHS.join('|')}|${MONTHS.map(x => x.slice(0, 3)).join('|')}`;
  let dm = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthWords})\\b(?:\\s+(\\d{4}))?`, 'i'));
  let parts = dm ? { day: dm[1], month: dm[2], year: dm[3], text: dm[0] } : null;
  if (!parts) {
    dm = t.match(new RegExp(`\\b(${monthWords})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'));
    parts = dm ? { day: dm[2], month: dm[1], year: dm[3], text: dm[0] } : null;
  }
  if (parts) {
    const mon = MONTHS.findIndex(x => x.startsWith(parts.month.toLowerCase().slice(0, 3))) + 1;
    const y = parts.year ? +parts.year : +today.slice(0, 4);
    let date = validDate(y, mon, +parts.day);
    if (date && !parts.year && date < today) date = validDate(y + 1, mon, +parts.day);
    if (date) return { date, text: parts.text };
  }
  if ((m = t.match(/\bin\s+(\d{1,3})\s+(day|days|week|weeks)\b/i))) return { date: addDays(today, +m[1] * (/week/i.test(m[2]) ? 7 : 1)), text: m[0] };
  if ((m = t.match(/\b(today|tonight|this evening)\b/i))) return { date: today, text: m[0] };
  if ((m = t.match(/\btomorrow\b/i))) return { date: addDays(today, 1), text: m[0] };
  if ((m = t.match(/\bnext week\b/i))) return { date: addDays(today, 7), text: m[0] };
  if ((m = t.match(/\bend of (?:the )?month\b/i))) {
    const [y, mo] = today.split('-').map(Number);
    return { date: iso(new Date(Date.UTC(y, mo, 0))), text: m[0] };
  }
  if ((m = t.match(/\b(?:end of (?:the )?week|this week)\b/i))) return { date: nextWeekday(addDays(today, -1), 5) === today ? today : nextWeekday(today, 5), text: m[0] };
  if ((m = t.match(new RegExp(`\\b(?:(?:by|before|on|until|next|this)\\s+)?(${DAYS.join('|')})\\b`, 'i')))) {
    return { date: nextWeekday(today, DAYS.indexOf(m[1].toLowerCase())), text: m[0] };
  }
  return null;
}

/** Everyone Sloane knows by name. */
function knownPeople() {
  const people = new Map();
  for (const mem of mockDb.teamMembers || []) if (mem && mem.name) people.set(mem.name, mem.id || null);
  for (const t of mockDb.tasks || []) if (t.assigneeName && !people.has(t.assigneeName)) people.set(t.assigneeName, t.assigneeId || null);
  return people;
}

/** A team member from a first name or a full name, or null. */
export function resolvePerson(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  for (const [name, id] of knownPeople()) {
    if (name.toLowerCase() === w || name.split(/\s+/)[0].toLowerCase() === w) return { name, id };
  }
  return null;
}

/** The client named in a sentence (the longest name found), or null. */
function findClient(text) {
  const lower = text.toLowerCase();
  const clients = clientDirectory.all().filter(c => c.name && c.name.length >= 3);
  // The first word of a name ("Acme" for "Acme Holdings Limited") only counts when it is long
  // enough and no other client starts with the same word
  const firstWords = new Map();
  for (const c of clients) {
    const w = c.name.toLowerCase().split(/\s+/)[0];
    firstWords.set(w, (firstWords.get(w) || 0) + 1);
  }
  let best = null;
  for (const c of clients) {
    const n = c.name.toLowerCase();
    const short = n.replace(/\s+(limited|ltd\.?|llp|plc)$/i, '');
    const first = n.split(/\s+/)[0];
    const asWord = w => new RegExp(`\\b${escapeRx(w)}\\b`, 'i').test(text);
    let hit = null;
    if (lower.includes(n)) hit = n;
    else if (short.length >= 3 && asWord(short)) hit = short;
    else if (first.length >= 4 && firstWords.get(first) === 1 && !GENERIC_FIRST_WORDS.has(first) && asWord(first)) hit = first;
    if (hit && (!best || hit.length > best.hit.length)) best = { client: c, hit };
  }
  return best ? best.client : null;
}

const tidy = s => s.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+|[\s,;:.]+$/g, '').trim();
const capital = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Cuts the date phrase (and a "by"/"before"/"on" in front of it) out of a title. */
function withoutDate(text, found) {
  if (!found) return tidy(text);
  const rx = new RegExp(`\\b(?:by|before|on|until|for|due)?\\s*${escapeRx(found.text)}\\b\\s*`, 'i');
  return tidy(text.replace(rx, ' '));
}

function build({ title, assignee = null, unknownPerson = null, today, source, kind, confidence }) {
  const found = findDate(title, today);
  const clean = capital(withoutDate(title, found));
  if (clean.length < 4) return null;
  const client = findClient(title);
  return {
    title: clean.slice(0, 200),
    assigneeName: assignee ? assignee.name : null,
    assigneeId: assignee ? assignee.id : null,
    dueDate: found ? found.date : null,
    clientId: client ? client.id : null,
    clientName: client ? client.name : null,
    businessArea: client ? businessOfClient(client.id) : null,
    priority: 'Normal',
    source: tidy(source).slice(0, 220),
    kind,
    confidence,
    note: unknownPerson
      ? `Sloane has no one called ${unknownPerson} in the team, so this task has no assignee yet.`
      : kind === 'text'
        ? 'Found in the text. Check who should do this before you create it.'
        : null
  };
}

/** One instruction typed to Sloane: "Ask Priya to ...", "Remind me to ...", "Assign X to Priya". */
function delegation(text, today) {
  const t = tidy(text);

  // "Remind me to call the accountant tomorrow", "Add a task to ...", "I need to ..."
  let m = t.match(/^(?:please\s+)?(?:remind me to|add a task to|add task to|create a task to|make a task to|new task:?|i need to|i have to|i must)\s+(.+)$/i);
  if (m) return build({ title: m[1], today, source: t, kind: 'instruction', confidence: 'high' });

  // "Ask Priya to chase ...", "Tell Mark to ...", "Get Sam to ...", "Have Lena ..."
  m = t.match(/^(?:please\s+)?(?:can you\s+|could you\s+)?(?:ask|tell|get|have|let)\s+(.+)$/i);
  if (m) {
    const who = nameAtStart(m[1]);
    if (who) {
      const rest = who.rest.replace(/^(?:to|about)\s+/i, '');
      return build({ title: rest, assignee: who.person, unknownPerson: who.person ? null : who.word, today, source: t, kind: 'instruction', confidence: 'high' });
    }
  }

  // "Assign the VAT return for Acme to Priya", "Give the report to Mark by Friday"
  m = t.match(/^(?:please\s+)?(?:assign|give|pass|hand)\s+(.+?)\s+to\s+(.+)$/i);
  if (m) {
    const who = nameAtStart(m[2]);
    if (who) {
      return build({ title: `${m[1]} ${who.rest}`, assignee: who.person, unknownPerson: who.person ? null : who.word, today, source: t, kind: 'instruction', confidence: 'high' });
    }
  }
  return null;
}

/**
 * A person's name at the start of some words: "Priya Shah to chase" or "Priya to chase".
 * A team member is matched by full or first name; a capitalised word that is not in the team is
 * reported as unknown; anything else (me, the, someone ...) is not a name.
 */
function nameAtStart(words) {
  const parts = words.split(/\s+/);
  if (!parts[0]) return null;
  const two = resolvePerson(`${parts[0]} ${parts[1]}`);
  if (two) return { person: two, word: parts[0], rest: parts.slice(2).join(' ') };
  const one = resolvePerson(parts[0]);
  if (one) return { person: one, word: parts[0], rest: parts.slice(1).join(' ') };
  if (/^[A-Z][A-Za-z'-]+$/.test(parts[0]) && !NOT_NAMES.test(parts[0])) return { person: null, word: parts[0], rest: parts.slice(1).join(' ') };
  return null;
}

/** Commitments and requests found in a pasted email, message or meeting notes. */
function commitments(text, today) {
  const open = new Set((mockDb.tasks || []).filter(t => !CLOSED.includes(t.status)).map(t => String(t.title).trim().toLowerCase()));
  const sentences = String(text).split(/(?:\r?\n|[.!?;])+/).map(tidy).filter(s => s.length >= 12);
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    let clause = null;
    let m;
    if ((m = s.match(/\b(?:i|we)(?:'ll| will| shall| can| am going to| are going to| promise to)\s+(.+)/i))) clause = m[1];
    else if ((m = s.match(/\b(?:could|can|would|will) you (?:please )?(.+)/i))) clause = m[1];
    else if ((m = s.match(new RegExp(`\\bplease\\s+((?:${ACTION_VERBS})\\b.*)`, 'i')))) clause = m[1];
    else if ((m = s.match(/\b(?:action|actions|todo|to do|to-do|next step|next steps)\s*[:-]\s*(.+)/i))) clause = m[1];
    else if ((m = s.match(/\b(?:needs?|need|must|have|has) to\s+(.+)/i))) clause = m[1];
    if (!clause) continue;
    const startsWithAction = new RegExp(`^(?:${ACTION_VERBS})\\b`, 'i').test(clause);
    const hasDate = Boolean(findDate(clause, today));
    if (!startsWithAction && !hasDate) continue;
    const p = build({ title: clause.replace(/\?+$/, ''), today, source: s, kind: 'text', confidence: 'check' });
    if (!p) continue;
    const key = p.title.toLowerCase();
    if (seen.has(key) || open.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * What the text would become as tasks.
 * @returns {{ kind: 'instruction'|'text'|null, proposals: object[] }}
 */
export function proposeTasks(text, now = new Date()) {
  const today = ukToday(now);
  const raw = String(text || '').trim();
  if (!raw) return { kind: null, proposals: [] };
  const short = raw.length <= 260 && !/\n/.test(raw);
  if (short) {
    const one = delegation(raw, today);
    if (one) return { kind: 'instruction', proposals: [one] };
  }
  // Long text, or several lines: look for things people promised or asked for
  if (raw.length >= 60 && !/^(what|which|who|when|where|how|why|is|are|do|does|show|tell me)\b/i.test(raw)) {
    const found = commitments(raw, today);
    if (found.length) return { kind: 'text', proposals: found };
  }
  return { kind: null, proposals: [] };
}
