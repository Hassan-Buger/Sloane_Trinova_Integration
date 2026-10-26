/**
 * Alerts: the few things that should not wait for the owner to open a page.
 *
 *  - late        a filing, VAT return or task whose date has passed        (red)
 *  - stuck       a task that is held up                                    (red)
 *  - today       something that falls due today                            (amber)
 *  - nobody      a task due within 3 days that nobody is working on        (amber)
 *  - suggestions deadlines that have no task yet                           (info)
 *
 * Each alert has a stable id (the same problem keeps the same id), so a device can tell which
 * ones it has already shown and only notify about new ones. Built only from what is saved in
 * Sloane; nothing is guessed.
 */

import { mockDb } from '../data/db.js';
import { buildWeeklyReport } from './weeklyReport.js';
import { buildSuggestions } from './taskSuggestions.js';
import { inBusiness, businessOfTask } from './businessOf.js';

const CLOSED = ['Completed', 'Cancelled'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const MAX_LATE = 12;

function when(days) {
  if (days === null || days === undefined) return '';
  if (days < 0) return days === -1 ? '1 day late' : `${-days} days late`;
  if (days === 0) return 'due today';
  return `due in ${days} days`;
}

const subject = i => (i.kind === 'task' ? `${i.what}${i.name && i.name !== 'General task' ? ` (${i.name})` : ''}` : `${i.what} for ${i.name}`);
const idOf = (prefix, i) => `${prefix}:${i.kind}:${i.what}:${i.name}:${i.date || ''}`;

/**
 * @param {Date} [now]
 * @param {object} [options]
 * @param {string} [options.business]  Only this business ('' = all)
 */
export function buildAlerts(now = new Date(), { business = '' } = {}) {
  const report = buildWeeklyReport(now, { business });
  const alerts = [];

  // Late: the furthest behind first, and a roll-up when there are a lot
  const late = [...report.late].sort((a, b) => a.days - b.days);
  for (const i of late.slice(0, MAX_LATE)) {
    alerts.push({
      id: idOf('late', i),
      level: 'red',
      kind: 'late',
      title: `${subject(i)} is ${when(i.days)}`,
      detail: i.kind === 'task' ? `Due ${i.date}${i.who && i.who !== 'Nobody yet' ? `, with ${i.who}` : ', nobody is working on it'}.` : `Was due ${i.date}.`,
      business: i.business || null,
      view: i.kind === 'task' ? 'people' : 'statutory'
    });
  }
  if (late.length > MAX_LATE) {
    alerts.push({ id: `late:more:${late.length - MAX_LATE}`, level: 'red', kind: 'late', title: `${plural(late.length - MAX_LATE, 'more item is', 'more items are')} late`, detail: 'Open Deadlines and Team & Tasks to see them all.', business: null, view: 'briefing' });
  }

  // Stuck tasks
  for (const t of report.stuck) {
    alerts.push({
      id: `stuck:${t.what}:${t.name}:${t.date || ''}`,
      level: 'red',
      kind: 'stuck',
      title: `"${t.what}" is stuck`,
      detail: `${t.stuck}${t.who && t.who !== 'Nobody yet' ? ` (${t.who})` : ''}.`,
      business: t.business || null,
      view: 'people'
    });
  }

  // Falling due today
  for (const i of report.dueThisWeek.filter(x => x.days === 0)) {
    alerts.push({ id: idOf('today', i), level: 'amber', kind: 'today', title: `${subject(i)} is due today`, detail: i.kind === 'task' && i.who ? `With ${i.who}.` : '', business: i.business || null, view: i.kind === 'task' ? 'people' : 'statutory' });
  }

  // Tasks due within 3 days that nobody has
  const open = (mockDb.tasks || []).filter(t => !CLOSED.includes(t.status) && !t.assigneeName && inBusiness(businessOfTask(t), business));
  for (const t of open) {
    const item = report.dueThisWeek.find(i => i.kind === 'task' && i.what === t.title && i.days <= 3 && i.days >= 0);
    if (item) alerts.push({ id: `nobody:${t.id}`, level: 'amber', kind: 'nobody', title: `Nobody is working on "${t.title}"`, detail: `It is ${when(item.days)}.`, business: item.business || null, view: 'people' });
  }

  // Deadlines with no task
  const sug = buildSuggestions(now, { business }).suggestions;
  if (sug.length) {
    // The id changes when the set of suggestions changes, so a new one is announced again
    let hash = 5381;
    for (const ch of sug.map(s => s.key).sort().join('|')) hash = ((hash << 5) + hash + ch.charCodeAt(0)) >>> 0;
    alerts.push({ id: `suggestions:${hash.toString(36)}`, level: 'info', kind: 'suggestions', title: `${plural(sug.length, 'deadline has', 'deadlines have')} no task yet`, detail: 'Sloane has worked out the tasks. Approve them on the Today page.', business: null, view: 'command' });
  }

  const counts = { red: 0, amber: 0, info: 0 };
  for (const a of alerts) counts[a.level]++;
  return { generatedAt: now.toISOString(), business: business && business.toLowerCase() !== 'all' ? business : null, counts: { ...counts, total: alerts.length }, alerts };
}
