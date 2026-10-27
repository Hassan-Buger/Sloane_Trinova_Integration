/**
 * Plain answers to the questions an owner asks about the work itself:
 *
 *   "What's Mark working on?"            -> one person's open tasks, late and stuck ones first
 *   "Which TriNova clients are behind?"  -> clients with late filings, VAT returns or tasks
 *   "What needs chasing at Emerald?"     -> late, stuck and waiting work, with who to chase
 *   "How is MTDflow doing?"              -> one business at a glance
 *   "Who has too much on?"               -> the team's workload
 *
 * Every line comes from what is saved in Sloane (deadlines, VAT returns, tasks). Nothing is
 * guessed: when a name is not known, or nothing is saved, the answer says so. Sloane cannot see
 * emails or Teams replies yet, so "chasing" is based on what is recorded as late, stuck or waiting.
 *
 * The same facts are also handed to the real AI model (buildWorkContext) so it can answer these
 * questions when an AI key is set.
 */

import { mockDb } from '../../data/db.js';
import { buildWeeklyReport } from '../weeklyReport.js';
import { buildBusinessOverview } from '../businessOverview.js';
import { buildMorningBriefing } from '../morningBriefing.js';
import { businessOfTask } from '../businessOf.js';
import { clientDirectory } from '../clientDirectory.js';

const CLOSED = ['Completed', 'Cancelled'];
const NOBODY = 'Nobody yet';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function whenWords(days) {
  if (days === null || days === undefined) return '';
  if (days < 0) return days === -1 ? '1 day late' : `${-days} days late`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

function shortDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A one-line description of a report item. */
function line(item) {
  if (item.kind === 'task') {
    const bits = [];
    if (item.stuck) bits.push(`stuck: ${item.stuck}`);
    if (item.days !== null) bits.push(whenWords(item.days));
    if (item.waiting && item.waiting.length) bits.push(`waiting for ${item.waiting.join(', ')}`);
    return `${item.what}${item.name && item.name !== 'General task' ? ` (${item.name})` : ''}${bits.length ? ` - ${bits.join('; ')}` : ''}`;
  }
  return `${item.what} for ${item.name} - ${whenWords(item.days)} (${shortDate(item.date)})`;
}

/** Everyone Sloane knows by name: the team list and anyone a task is given to. */
function knownPeople() {
  const names = new Set();
  for (const m of mockDb.teamMembers || []) if (m && m.name) names.add(m.name);
  for (const t of mockDb.tasks || []) if (t.assigneeName && t.assigneeName !== NOBODY) names.add(t.assigneeName);
  return [...names];
}

const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which known people does the question name? Matches a full name, or a first name. */
function peopleIn(q) {
  const found = [];
  for (const name of knownPeople()) {
    const first = name.split(/\s+/)[0];
    const rx = new RegExp(`\\b(${escapeRx(name)}|${escapeRx(first)})(?:'s)?\\b`, 'i');
    if (first.length >= 2 && rx.test(q)) found.push(name);
  }
  return found;
}

/** Which business does the question name? "Emerald", "TriNova", "CFI", "MTD" all work. */
function businessIn(q) {
  const lower = q.toLowerCase();
  for (const b of mockDb.businesses || []) {
    const full = b.name.toLowerCase();
    if (lower.includes(full)) return b.name;
    const first = full.split(/\s+/)[0];
    if (first.length >= 3 && new RegExp(`\\b${escapeRx(first)}\\b`, 'i').test(q)) return b.name;
    if (full.startsWith('mtd') && /\bmtd\b/i.test(q)) return b.name;
  }
  return null;
}

function result(answer, { risk = 'neutral', reasons = [], actions = [] } = {}) {
  return {
    response_type: 'practice_assessment',
    answer,
    risk_level: risk,
    key_reasons: reasons,
    recommended_actions: actions,
    evidence: []
  };
}

/** What one person is working on. */
function aboutPerson(name, now) {
  const report = buildWeeklyReport(now);
  const mine = [...report.late, ...report.dueThisWeek, ...report.stuck]
    .filter(i => i.kind === 'task' && i.who === name)
    .filter((i, idx, all) => all.findIndex(o => o.what === i.what && o.name === i.name && o.date === i.date) === idx);
  const open = (mockDb.tasks || []).filter(t => !CLOSED.includes(t.status) && t.assigneeName === name);
  const person = report.workload.find(p => p.who === name) || { open: 0, late: 0, stuck: 0 };
  if (!open.length) {
    return result(`${name} has no open tasks in Sloane.`, { reasons: ['Sloane only knows about tasks that have been saved and given to a person.'] });
  }
  const today = report.period.from;
  const rank = t => (t.isBlocked ? 0 : t.dueDate && t.dueDate < today ? 1 : 2);
  const next = [...open]
    .sort((a, b) => rank(a) - rank(b) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 6)
    .map(t => {
      const bits = [];
      if (t.isBlocked) bits.push(`stuck: ${t.blocker || 'held up'}`);
      if (t.dueDate) bits.push(t.dueDate < today ? `late since ${shortDate(t.dueDate.slice(0, 10))}` : `due ${shortDate(t.dueDate.slice(0, 10))}`);
      if (t.status === 'In_Progress') bits.push('in progress');
      return `${t.title}${t.companyName ? ` (${t.companyName})` : ''}${bits.length ? ` - ${bits.join('; ')}` : ''}`;
    });
  const parts = [`${plural(person.open, 'open task', 'open tasks')}`];
  if (person.late) parts.push(`${person.late} late`);
  if (person.stuck) parts.push(`${person.stuck} stuck`);
  const risk = person.stuck || person.late >= 3 ? 'red' : person.late ? 'amber' : 'low';
  const actions = [];
  const stuck = mine.find(i => i.stuck);
  if (stuck) actions.push({ action: `Help ${name} unblock "${stuck.what}": ${stuck.stuck}`, priority: 'high' });
  if (person.open >= 8 || person.late >= 3) actions.push({ action: `${name} has a lot on. Consider moving some work to someone else.`, priority: 'normal' });
  return result(`${name} has ${parts.join(', ')}.`, { risk, reasons: next, actions });
}

/** Who has what on: the team's workload. */
function aboutTeam(now) {
  const people = buildWeeklyReport(now).workload;
  if (!people.length) return result('No open tasks are saved in Sloane yet, so nobody has anything on.');
  const named = people.filter(p => p.who !== NOBODY);
  const busiest = named[0];
  const reasons = people.map(p => `${p.who}: ${plural(p.open, 'open task', 'open tasks')}${p.late ? `, ${p.late} late` : ''}${p.stuck ? `, ${p.stuck} stuck` : ''}`);
  const nobody = people.find(p => p.who === NOBODY);
  const answer = busiest
    ? `${busiest.who} has the most on: ${plural(busiest.open, 'open task', 'open tasks')}${busiest.late ? `, ${busiest.late} late` : ''}.${nobody ? ` ${plural(nobody.open, 'task has', 'tasks have')} nobody working on ${nobody.open === 1 ? 'it' : 'them'}.` : ''}`
    : `${plural(nobody.open, 'task has', 'tasks have')} nobody working on ${nobody.open === 1 ? 'it' : 'them'}.`;
  const actions = [];
  if (nobody) actions.push({ action: 'Give the tasks that have nobody to someone (Team & Tasks)', priority: 'normal' });
  return result(answer, { risk: busiest && busiest.late >= 3 ? 'amber' : 'neutral', reasons, actions });
}

/** Which clients are behind: late filings, VAT returns or tasks, grouped by client. */
function clientsBehind(business, now) {
  const report = buildWeeklyReport(now, { business: business || '' });
  const scope = business ? `in ${business}` : 'across your businesses';
  const byClient = new Map();
  let general = 0;
  for (const item of report.late) {
    if (!item.name || item.name === 'General task') { general++; continue; }
    const row = byClient.get(item.name) || { name: item.name, items: [], oldest: 0 };
    row.items.push(item);
    row.oldest = Math.min(row.oldest, item.days);
    byClient.set(item.name, row);
  }
  const rows = [...byClient.values()].sort((a, b) => a.oldest - b.oldest || b.items.length - a.items.length);
  if (!rows.length) {
    return result(general
      ? `No client is behind ${scope}. ${plural(general, 'task not linked to a client is', 'tasks not linked to a client are')} late.`
      : `No client is behind ${scope} - nothing saved in Sloane is past its date.`, { risk: general ? 'amber' : 'low' });
  }
  const top = rows.slice(0, 3).map(r => r.name).join(', ');
  return result(
    `${plural(rows.length, 'client is', 'clients are')} behind ${scope}. The furthest behind: ${top}.`,
    {
      risk: 'red',
      reasons: rows.slice(0, 8).map(r => `${r.name}: ${r.items.map(i => `${i.what} ${whenWords(i.days)}`).join('; ')}`),
      actions: [{ action: `Ask for ${rows[0].name} to be dealt with first (${rows[0].items[0].what}, ${whenWords(rows[0].items[0].days)})`, priority: 'high' }]
    }
  );
}

/** What needs chasing: late, stuck and waiting work, with who to chase. */
function whatNeedsChasing(business, now) {
  const report = buildWeeklyReport(now, { business: business || '' });
  const where = business ? ` at ${business}` : '';
  const items = [];
  const seen = new Set();
  const add = (item, why) => {
    const key = `${item.kind}|${item.what}|${item.name}|${item.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ item, why });
  };
  for (const t of report.stuck) add(t, `stuck: ${t.stuck}${t.who !== NOBODY ? ` - chase ${t.who}` : ''}`);
  for (const i of report.late) {
    if (i.kind === 'task') add(i, `${whenWords(i.days)}${i.who !== NOBODY ? ` - chase ${i.who}` : ' - nobody is working on it'}`);
    else add(i, `${whenWords(i.days)} - needs filing`);
  }
  for (const i of report.dueThisWeek) {
    if (i.kind === 'task' && i.waiting && i.waiting.length) add(i, `${whenWords(i.days)} but waiting for ${i.waiting.join(', ')}`);
  }
  if (!items.length) {
    const overview = buildBusinessOverview(now).businesses.find(b => b.name === business);
    const nothingSaved = business && overview && !overview.clients && !overview.openTasks && !overview.deadlines && !overview.vatOpen;
    return result(nothingSaved
      ? `Nothing is saved for ${business} yet, so there is nothing to chase.`
      : `Nothing needs chasing${where} from what is saved in Sloane: no late, stuck or waiting work.`, { risk: nothingSaved ? 'neutral' : 'low', reasons: ['Sloane cannot see emails or Teams replies yet, so it only knows what has been recorded as late, stuck or waiting.'] });
  }
  const lines = items.slice(0, 10).map(({ item, why }) => `${item.kind === 'task' ? item.what + (item.name && item.name !== 'General task' ? ` (${item.name})` : '') : `${item.what} for ${item.name}`}: ${why}`);
  const first = items[0];
  return result(
    `${plural(items.length, 'thing needs', 'things need')} chasing${where}.`,
    {
      risk: 'amber',
      reasons: lines,
      actions: [{ action: `Start with ${first.item.kind === 'task' ? `"${first.item.what}"` : `${first.item.what} for ${first.item.name}`}: ${first.why}`, priority: 'high' }]
    }
  );
}

/** One business at a glance. */
function aboutBusiness(business, now) {
  const overview = buildBusinessOverview(now).businesses.find(b => b.name === business);
  if (!overview) return result(`Sloane has no business called "${business}".`);
  const empty = !overview.clients && !overview.openTasks && !overview.deadlines && !overview.vatOpen && !overview.doneThisWeek;
  if (empty) return result(`Nothing is saved for ${business} yet: no clients, deadlines, VAT returns or tasks.`);
  const report = buildWeeklyReport(now, { business });
  const bits = [];
  if (overview.late) bits.push(`${plural(overview.late, 'item is', 'items are')} late`);
  if (overview.dueThisWeek) bits.push(`${overview.dueThisWeek} fall due in the next 7 days`);
  if (overview.stuckTasks) bits.push(`${plural(overview.stuckTasks, 'task is', 'tasks are')} stuck`);
  const reasons = [
    `${plural(overview.clients, 'client', 'clients')}, ${plural(overview.openTasks, 'open task', 'open tasks')}, ${overview.doneThisWeek} finished in the last 7 days`,
    ...report.late.slice(0, 4).map(line),
    ...report.stuck.slice(0, 2).map(line)
  ];
  return result(
    bits.length ? `${business}: ${bits.join(', ')}.` : `${business}: nothing is late, due this week or stuck.`,
    { risk: overview.health === 'red' ? 'red' : overview.health === 'amber' ? 'amber' : 'low', reasons }
  );
}


/* ------------------------------------------------------------------ searching what is saved */

const STOP = new Set(('what whats where which when about with have does from this that been were they them their there work working going status update '
  + 'progress across business businesses clients client tasks task much many need needs show tell give take left over into than then also just some more most long '
  + 'high week month today tomorrow please could would should still behind late chase chasing doing happening happen things thing anything everything '
  + 'know like want look looking check').split(/\s+/));

/** The words in a question worth looking for: no filler, no business or people names. */
export function keywordsOf(q) {
  const skip = new Set(['mtd', 'mtdflow']);
  for (const b of mockDb.businesses || []) for (const w of b.name.toLowerCase().split(/\s+/)) skip.add(w);
  for (const n of knownPeople()) for (const w of n.toLowerCase().split(/\s+/)) skip.add(w);
  const words = String(q || '').toLowerCase().replace(/'s|’s/g, '').match(/[a-z0-9][a-z0-9'-]{3,}/g) || [];
  return [...new Set(words)].filter(w => !STOP.has(w) && !skip.has(w));
}

const todayIso = now => buildWeeklyReport(now).period.from;

/** Tasks and clients that mention the words in a question (for "Where are we with the launch?"). */
export function searchWork(query, { business = null, limit = 12 } = {}, now = new Date()) {
  const words = keywordsOf(query);
  if (!words.length) return { keywords: [], tasks: [], clients: [] };
  const today = todayIso(now);
  const found = [];
  for (const t of mockDb.tasks || []) {
    if (business && businessOfTask(t) !== business) continue;
    const notes = (t.progressNotes || []).map(n => n.text).join(' ');
    const hay = `${t.title} ${t.description} ${t.nextAction} ${t.department} ${t.companyName} ${notes}`.toLowerCase();
    const score = words.filter(w => hay.includes(w)).length;
    if (!score) continue;
    const open = !CLOSED.includes(t.status);
    const last = (t.progressNotes || []).slice(-1)[0];
    found.push({
      score, open,
      row: {
        title: t.title,
        client: t.companyName || null,
        business: businessOfTask(t) || null,
        who: t.assigneeName || NOBODY,
        status: t.status,
        due: t.dueDate ? String(t.dueDate).slice(0, 10) : null,
        late: Boolean(open && t.dueDate && String(t.dueDate).slice(0, 10) < today),
        stuck: t.isBlocked ? (t.blocker || 'Held up') : null,
        lastNote: last && last.text ? String(last.text).slice(0, 140) : null
      }
    });
  }
  found.sort((a, b) => b.score - a.score || Number(b.open) - Number(a.open) || (a.row.due || '9999').localeCompare(b.row.due || '9999'));
  const clients = clientDirectory.all()
    .filter(c => c.name && words.some(w => c.name.toLowerCase().includes(w)))
    .slice(0, 5).map(c => ({ name: c.name, source: c.source }));
  return { keywords: words, tasks: found.slice(0, limit).map(f => f.row), clients };
}

/** "Where are we with the MTDflow launch?": what is saved about those words, and how it is going. */
function aboutTopic(q, business, now) {
  const { keywords, tasks, clients } = searchWork(q, { business, limit: 15 }, now);
  const label = keywords.join(' ');
  const where = business ? ` in ${business}` : '';
  if (!tasks.length && !clients.length) {
    const base = business ? ` ${aboutBusiness(business, now).answer}` : '';
    return result(`Sloane has no task, note or client about "${label}"${where}.${base}`, {
      reasons: ['Nothing that is saved matches those words. If this is a project, add its tasks under Team & Tasks and Sloane can track it.']
    });
  }
  const done = tasks.filter(t => t.status === 'Completed').length;
  const open = tasks.filter(t => !CLOSED.includes(t.status));
  const late = open.filter(t => t.late).length;
  const stuck = open.filter(t => t.stuck).length;
  const parts = [`${done} done`, `${open.length} open`];
  if (late) parts.push(`${late} late`);
  if (stuck) parts.push(`${stuck} stuck`);
  const reasons = tasks.slice(0, 10).map(t => `${t.title} - ${t.status.replace('_', ' ').toLowerCase()}${t.who !== NOBODY ? ` (${t.who})` : ' (nobody yet)'}${t.due ? `, due ${shortDate(t.due)}` : ''}${t.stuck ? `, stuck: ${t.stuck}` : ''}${t.lastNote ? `. Last note: ${t.lastNote}` : ''}`);
  if (clients.length) reasons.push(`Clients with those words in the name: ${clients.map(c => c.name).join(', ')}`);
  const stuckOne = open.find(t => t.stuck);
  return result(
    tasks.length ? `${plural(tasks.length, 'task', 'tasks')} about "${label}"${where}: ${parts.join(', ')}.` : `Sloane has no task about "${label}"${where}, only a client with that name.`,
    {
      risk: stuck || late ? 'red' : open.length ? 'amber' : 'low',
      reasons,
      actions: stuckOne ? [{ action: `Unblock "${stuckOne.title}": ${stuckOne.stuck}`, priority: 'high' }] : []
    }
  );
}

/** "What's happening across my businesses?": the morning briefing in short. */
function acrossBusinesses(now) {
  const b = buildMorningBriefing(now);
  const reasons = [
    ...b.priorities.map(p => `${p.title}${p.business ? ` (${p.business})` : ''}: ${p.why}`),
    ...b.businesses.map(x => `${x.name}: ${x.summary}`)
  ];
  const red = b.counts.late || b.counts.stuckTasks;
  return result(b.headline, {
    risk: red ? 'red' : b.counts.dueThisWeek ? 'amber' : 'neutral',
    reasons: reasons.slice(0, 12),
    actions: b.recommendations.slice(0, 3).map(a => ({ action: a, priority: 'normal' }))
  });
}

/** Everything about one business that the AI may need to look into it. */
function focusBlock(business, now) {
  const report = buildWeeklyReport(now, { business });
  const overview = buildBusinessOverview(now).businesses.find(b => b.name === business);
  const open = (mockDb.tasks || []).filter(t => !CLOSED.includes(t.status) && businessOfTask(t) === business);
  return {
    business,
    overview: overview ? { clients: overview.clients, openTasks: overview.openTasks, late: overview.late, dueThisWeek: overview.dueThisWeek, stuckTasks: overview.stuckTasks, health: overview.health } : null,
    late: report.late.slice(0, 12).map(i => ({ what: i.what, client: i.name, daysLate: -i.days, who: i.who || null })),
    dueThisWeek: report.dueThisWeek.slice(0, 12).map(i => ({ what: i.what, client: i.name, date: i.date, who: i.who || null })),
    stuck: report.stuck.slice(0, 8).map(i => ({ what: i.what, client: i.name, who: i.who, why: i.stuck })),
    openTasks: open.slice(0, 25).map(t => ({ title: t.title, client: t.companyName || null, who: t.assigneeName || NOBODY, status: t.status, due: t.dueDate ? String(t.dueDate).slice(0, 10) : null }))
  };
}

/**
 * Tries to answer a question about people, clients behind, chasing or one business.
 * Returns the answer fields, or null when the question is about something else.
 */
export function answerWorkQuestion(query, now = new Date()) {
  const q = String(query || '').trim();
  if (!q) return null;
  const business = businessIn(q);
  const people = peopleIn(q);

  const asksAboutWork = /\b(working on|work(s|ing)? on|doing|workload|on (his|her|their) plate|has on|have on|busy|busiest|tasks?|assigned|on the go|next up)\b/i.test(q);
  const asksWhoHasToomuch = /\b(who|which (person|member|one))\b.*\b(too much|busiest|most|overloaded|overworked|behind|stretched)\b/i.test(q)
    || /\b(workload|capacity)\b/i.test(q) && !people.length;
  const asksChase = /\b(chas(e|ing)|follow(ing)?\s*up|nudge|nudging|remind(er|ing)?|waiting (on|for)|holding things up)\b/i.test(q);
  const asksBehind = /\b(behind|overdue|late|slipping|missed|struggling)\b/i.test(q);
  const asksClients = /\bclients?\b/i.test(q);
  const asksBusinessStatus = /\b(how('s| is| are)|status|update on|what'?s (happening|going on)|doing at|state of)\b/i.test(q);

  // "What's Mark working on?" - one person
  const who = q.match(/\b(?:what(?:'s| is| are)|what does|how much (?:does|is)|show me|tell me what)\s+([A-Za-z][A-Za-z'-]+)\s+(?:is\s+|has\s+|have\s+)?(?:working on|doing|got on|on)\b/i);
  if (people.length === 1 && (asksAboutWork || asksBehind) && !asksChase) return aboutPerson(people[0], now);
  if (people.length > 1 && asksAboutWork) {
    const first = aboutPerson(people[0], now);
    const rest = people.slice(1).map(n => aboutPerson(n, now));
    return { ...first, answer: [first, ...rest].map(r => r.answer).join(' '), key_reasons: [first, ...rest].flatMap(r => r.key_reasons).slice(0, 12) };
  }
  if (who && !people.length && /working on|doing|got on/i.test(q)) {
    const name = who[1];
    if (!/^(the|our|my|this|that|everyone|everybody|anyone|anybody|someone|nobody)$/i.test(name) && !businessIn(name)) {
      return result(`Sloane has no one called ${name} in the team, and no task is given to anyone by that name.`, { reasons: ['Add them under Team & Tasks, or check the spelling.'] });
    }
  }

  // "Who has too much on?"
  if (asksWhoHasToomuch && !business) return aboutTeam(now);

  // "What needs chasing at Emerald?"
  if (asksChase) return whatNeedsChasing(business, now);

  // "Which TriNova clients are behind?"
  if (asksBehind && (asksClients || business)) return clientsBehind(business, now);

  // "Where are we with the MTDflow launch?"
  const asksWhere = /\b(where are we|where we are|status of|progress (on|with)|update on|how far|how('s| is) .+ going)\b/i.test(q);
  if (asksWhere && keywordsOf(q).length) return aboutTopic(q, business, now);

  // "What's happening across my businesses?"
  if (!business && !people.length && /\b(what'?s (happening|going on)|across (all )?(of )?(my )?businesses|all (of )?my businesses|how are (my )?businesses)\b/i.test(q)) return acrossBusinesses(now);

  // "How is MTDflow doing?"
  if (business && asksBusinessStatus) return aboutBusiness(business, now);

  return null;
}

/**
 * The same facts in a small block for the real AI model: each person's workload and what is
 * late or stuck in each business. Names and counts only; nothing private.
 */
export function buildWorkContext(now = new Date(), { query = '' } = {}) {
  const report = buildWeeklyReport(now);
  const overview = buildBusinessOverview(now);
  const today = report.period.from;
  const open = (mockDb.tasks || []).filter(t => !CLOSED.includes(t.status));
  const asked = query ? businessIn(query) : null;
  const found = query ? searchWork(query, { business: asked }, now) : null;
  const brief = buildMorningBriefing(now);
  const extra = {
    briefing: {
      headline: brief.headline,
      counts: brief.counts,
      doFirst: brief.priorities.map(x => ({ what: x.title, why: x.why, business: x.business })),
      risks: brief.risks.map(x => x.text),
      recommendations: brief.recommendations
    },
    ...(asked ? { focusBusiness: focusBlock(asked, now) } : {}),
    ...(found && (found.tasks.length || found.clients.length) ? { matches: found } : {})
  };
  return {
    ...extra,
    today,
    team: report.workload.map(p => ({
      person: p.who,
      openTasks: p.open,
      lateTasks: p.late,
      stuckTasks: p.stuck,
      nextUp: open
        .filter(t => (t.assigneeName || NOBODY) === p.who)
        .sort((a, b) => Number(Boolean(b.isBlocked)) - Number(Boolean(a.isBlocked)) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
        .slice(0, 4)
        .map(t => ({ title: t.title, client: t.companyName || null, dueDate: t.dueDate ? t.dueDate.slice(0, 10) : null, stuck: t.isBlocked ? (t.blocker || 'Held up') : null }))
    })),
    businesses: overview.businesses.map(b => ({
      name: b.name,
      health: b.health,
      clients: b.clients,
      openTasks: b.openTasks,
      late: b.late,
      dueThisWeek: b.dueThisWeek,
      stuckTasks: b.stuckTasks
    })),
    lateItems: report.late.slice(0, 15).map(i => ({ kind: i.kind, what: i.what, client: i.name, business: i.business, daysLate: -i.days, who: i.who || null })),
    stuckItems: report.stuck.slice(0, 10).map(i => ({ what: i.what, client: i.name, who: i.who, why: i.stuck, business: i.business }))
  };
}
