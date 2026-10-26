/**
 * The morning briefing across all the owner's businesses: what to do first, how each business is
 * doing, who is doing what, what is at risk, and what Sloane recommends.
 *
 * It is built from Sloane's own records (deadlines, VAT returns, tasks), so every line can be
 * traced to something she can open. The diary and flagged emails come from Outlook in the browser
 * when Outlook is connected.
 *
 * The wording is rule-based and plain. It never invents a fact, and never says that work is
 * on track when nothing says so.
 */

import { mockDb } from '../data/db.js';
import { buildWeeklyReport, ukToday } from './weeklyReport.js';
import { buildBusinessOverview } from './businessOverview.js';
import { buildSuggestions } from './taskSuggestions.js';
import { businessOfTask, inBusiness } from './businessOf.js';
import { ukPartOfDay } from './ukTime.js';

const CLOSED = ['Completed', 'Cancelled'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function whenWords(days) {
  if (days < 0) return days === -1 ? '1 day late' : `${-days} days late`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

/** 2026-07-31 -> 31 Jul 2026 */
function shortDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function niceDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** How urgent an item is, as a number to sort by (bigger = first). */
function score(item) {
  const days = item.days;
  let s = 0;
  if (days !== null && days !== undefined) {
    if (days < 0) s = 1000 + Math.min(-days, 365);
    else if (days === 0) s = 700;
    else if (days <= 3) s = 650 - days;
    else s = 400 - days;
  }
  // Late filings carry penalties, so they come first; late VAT next; then anything stuck
  if (item.kind === 'filing' && days < 0) s += 300;
  else if (item.kind === 'vat' && days < 0) s += 250;
  else if (item.kind !== 'task' && days >= 0) s += 50;
  if (item.kind === 'task' && item.stuck) s = Math.max(s, 600) + 200;
  return s;
}

function describe(item) {
  if (item.kind === 'filing' || item.kind === 'vat') return { title: `${item.what} for ${item.name}`, why: `${whenWords(item.days)} (${shortDate(item.date)})` };
  const bits = [];
  if (item.stuck) bits.push(`stuck: ${item.stuck}`);
  if (item.days !== null && item.days !== undefined) bits.push(whenWords(item.days));
  if (item.waiting && item.waiting.length) bits.push(`waiting for ${item.waiting.join(', ')}`);
  return { title: `${item.what}${item.name && item.name !== 'General task' ? ` (${item.name})` : ''}`, why: bits.join('; ') || 'open' };
}

/** Open tasks of one person, late first. */
function itemsFor(who) {
  const today = ukToday();
  return (mockDb.tasks || [])
    .filter(t => !CLOSED.includes(t.status) && (t.assigneeName || 'Nobody yet') === who)
    .map(t => ({ title: t.title, client: t.companyName || '', dueDate: t.dueDate || null, late: Boolean(t.dueDate && t.dueDate < today), stuck: t.isBlocked ? (t.blocker || 'Held up') : '' }))
    .sort((a, b) => Number(b.late) - Number(a.late) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 3);
}

/**
 * @param {Date} [now]
 * @param {object} [options]
 * @param {string} [options.business]  Only this business ('' = all of them)
 */
export function buildMorningBriefing(now = new Date(), { business = '' } = {}) {
  const today = ukToday(now);
  const whole = buildWeeklyReport(now, { business });
  const overview = buildBusinessOverview(now);
  const suggestions = buildSuggestions(now, { business }).suggestions;
  const scoped = business && business.toLowerCase() !== 'all';

  // ---- What to do first ----
  const candidates = [...whole.late, ...whole.dueThisWeek, ...whole.stuck]
    .filter((item, i, all) => all.findIndex(o => o.kind === item.kind && o.what === item.what && o.name === item.name && o.date === item.date) === i);
  const priorities = candidates
    .map(item => ({ item, score: score(item) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item }) => ({ ...describe(item), business: item.business || null, who: item.kind === 'task' ? item.who : null, kind: item.kind }));

  // ---- Each business ----
  const businesses = overview.businesses
    .filter(b => !scoped || b.name.toLowerCase() === business.toLowerCase())
    .map(b => {
      const r = buildWeeklyReport(now, { business: b.name });
      const lines = [];
      if (r.late.length) lines.push(`${plural(r.late.length, 'item is', 'items are')} late${r.late[0].days !== null ? `, the oldest ${whenWords(r.late[0].days)}` : ''}.`);
      if (r.dueThisWeek.length) lines.push(`${plural(r.dueThisWeek.length, 'item is', 'items are')} due in the next 7 days.`);
      if (r.stuck.length) lines.push(`${plural(r.stuck.length, 'task is', 'tasks are')} stuck.`);
      if (b.waitingTasks) lines.push(`${plural(b.waitingTasks, 'task is', 'tasks are')} waiting for another task.`);
      if (!lines.length) lines.push(b.openTasks || b.clients || b.deadlines || b.vatOpen || b.doneThisWeek ? 'Nothing urgent.' : 'Nothing is saved for this business yet.');
      return {
        name: b.name,
        type: b.type,
        health: b.health,
        clients: b.clients,
        openTasks: b.openTasks,
        summary: lines.join(' '),
        late: r.late.slice(0, 4).map(i => ({ ...describe(i) })),
        dueThisWeek: r.dueThisWeek.slice(0, 4).map(i => ({ ...describe(i) })),
        stuck: r.stuck.slice(0, 3).map(i => ({ ...describe(i) })),
        counts: { late: b.late, dueThisWeek: b.dueThisWeek, stuck: b.stuckTasks, waiting: b.waitingTasks, doneThisWeek: b.doneThisWeek }
      };
    });

  // ---- Who is doing what ----
  const staff = whole.workload.map(p => ({ ...p, items: itemsFor(p.who) }));

  // ---- Risks and recommendations ----
  const risks = [];
  const recommendations = [];

  for (const b of businesses) {
    if (b.counts.late > 0) risks.push({ business: b.name, text: `${b.name}: ${plural(b.counts.late, 'item is', 'items are')} late.` });
  }
  for (const s of whole.stuck.slice(0, 4)) {
    risks.push({ business: s.business || null, text: `"${s.what}" is stuck: ${s.stuck}.` });
    recommendations.push(`Unblock "${s.what}"${s.who && s.who !== 'Nobody yet' ? ` with ${s.who}` : ''}: ${s.stuck}.`);
  }
  for (const t of whole.late.filter(i => i.kind === 'task' && i.waiting && i.waiting.length).slice(0, 2)) {
    risks.push({ business: t.business || null, text: `"${t.what}" is late and is waiting for ${t.waiting.join(', ')}.` });
  }
  for (const p of staff) {
    if (p.who !== 'Nobody yet' && (p.open >= 8 || p.late >= 3)) {
      risks.push({ business: null, text: `${p.who} has ${plural(p.open, 'open task', 'open tasks')}, ${p.late} late.` });
      recommendations.push(`${p.who} has a lot on (${plural(p.open, 'open task', 'open tasks')}, ${p.late} late). Consider moving some to someone else.`);
    }
  }
  const nobodyDue = whole.dueThisWeek.filter(i => i.kind === 'task' && i.who === 'Nobody yet');
  if (nobodyDue.length) {
    risks.push({ business: null, text: `${plural(nobodyDue.length, 'task due this week has', 'tasks due this week have')} nobody working on ${nobodyDue.length === 1 ? 'it' : 'them'}.` });
    recommendations.push(`Give ${nobodyDue.length === 1 ? 'the task' : 'the tasks'} due this week to someone: ${nobodyDue.slice(0, 2).map(i => `"${i.what}"`).join(', ')}.`);
  }
  if (suggestions.length) {
    recommendations.unshift(`Sloane found ${plural(suggestions.length, 'piece of work', 'pieces of work')} with no task yet. Look at "Sloane suggests" on Today and approve what is needed.`);
    risks.push({ business: null, text: `${plural(suggestions.length, 'deadline has', 'deadlines have')} no task and nobody working on ${suggestions.length === 1 ? 'it' : 'them'}.` });
  }
  const lateFilings = whole.late.filter(i => i.kind === 'filing');
  if (lateFilings.length) {
    const first = lateFilings[0];
    recommendations.unshift(`${first.what} for ${first.name} ${whenWords(first.days)}${lateFilings.length > 1 ? `, and ${plural(lateFilings.length - 1, 'other filing is', 'other filings are')} late too` : ''}. Ask for these to be filed first.`);
  }
  if (!recommendations.length) {
    const ahead = whole.comingNext.filings + whole.comingNext.vat + whole.comingNext.tasks;
    recommendations.push(ahead
      ? `Nothing needs you urgently. It is a good day to look ahead: ${plural(ahead, 'thing falls', 'things fall')} due in the following three weeks.`
      : 'Nothing needs you urgently today.');
  }

  // ---- The headline ----
  const lateCount = whole.counts.late;
  const parts = [];
  if (lateCount) parts.push(`${plural(lateCount, 'item is', 'items are')} late`);
  if (whole.counts.dueThisWeek) parts.push(`${whole.counts.dueThisWeek} fall due in the next 7 days`);
  if (whole.counts.stuckTasks) parts.push(`${plural(whole.counts.stuckTasks, 'task is', 'tasks are')} stuck`);
  const headline = priorities.length
    ? `${plural(Math.min(priorities.length, 5), 'thing needs', 'things need')} you first. Across ${scoped ? business : 'your businesses'}, ${parts.join(', ')}.`
    : 'Nothing needs you urgently today.';

  return {
    greeting: `Good ${ukPartOfDay(now)}, Kirsty`,
    date: today,
    dateLabel: niceDate(today),
    generatedAt: now.toISOString(),
    business: scoped ? business : null,
    headline,
    priorities,
    businesses,
    staff,
    risks: risks.slice(0, 8),
    recommendations: recommendations.slice(0, 6),
    suggestionsCount: suggestions.length,
    counts: whole.counts,
    doneThisWeek: whole.done.slice(0, 5).map(d => ({ title: d.what, who: d.who, client: d.name })),
    total: overview.total
  };
}

// For tests
export const _internals = { score, describe, whenWords, businessOfTask, inBusiness };
