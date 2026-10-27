/**
 * Reports → "This week": a one-page summary that reads like a document and prints on one or two
 * A4 pages. "Print or save as PDF" opens the browser's print window, where "Save as PDF" is a
 * choice, so no extra program is needed.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { escapeHtml, formatDateGB } from '../utils/html.js';

export const REPORT_ACTIONS = ['printWeeklyReport', 'refreshWeeklyReport'];

function weekdayDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "3 days late", "today", "tomorrow", "in 5 days" */
function whenText(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return days === -1 ? '1 day late' : `${-days} days late`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The class names for a cell: numbers right-aligned, short values on one line, plus any per-row class. */
function cellClass(c, r) {
  const names = [c.right ? 'num' : '', c.nowrap ? 'nowrap' : '', r && c.cls ? c.cls(r) : ''].filter(Boolean);
  return names.length ? ` class="${names.join(' ')}"` : '';
}

function table(rows, columns, emptyText) {
  if (!rows.length) return `<p class="report-empty">${escapeHtml(emptyText)}</p>`;
  return `
    <table class="report-table">
      <thead><tr>${columns.map(c => `<th${cellClass(c)}>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, rIdx) => `<tr>${columns.map(c => `<td${cellClass(c, r)}>${c.html ? c.html(r, rIdx) : escapeHtml(c.value(r, rIdx))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

const ITEM_COLUMNS = [
  { label: '#', value: (_r, idx) => String(idx + 1), nowrap: true, right: true },
  { label: 'What', value: r => r.what },
  { label: 'Client or company', value: r => r.name },
  { label: 'Due', value: r => formatDateGB(r.date), nowrap: true },
  { label: 'When', value: r => whenText(r.days), nowrap: true, cls: r => (r.days !== null && r.days < 0 ? 'late' : '') },
  { label: 'Who', value: r => (r.kind === 'task' ? r.who : '') }
];

export const reportMethods = {
  async renderWeeklyReport() {
    const box = document.getElementById('weeklyReport');
    if (!box) return;
    box.innerHTML = '<p class="report-empty">Preparing your week...</p>';

    let r;
    try {
      r = (await ApiService.getWeeklyReport()).data;
    } catch (err) {
      box.innerHTML = `<p class="report-empty">Sloane could not prepare the report just now: ${escapeHtml(err.message)}</p>`;
      return;
    }
    this.weeklyReport = r;
    const c = r.counts;
    const name = (document.getElementById('sidebarUserName')?.textContent || '').trim();
    // UK time, like every other date in the report
    const made = new Date(r.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

    const tile = (n, label, tone = '') => `<div class="report-tile ${tone}"><div class="n">${n}</div><div class="lbl">${escapeHtml(label)}</div></div>`;
    const next = r.comingNext;
    const nextTotal = next.filings + next.vat + next.tasks;

    box.innerHTML = `
      <header class="report-head">
        <div>
          <div class="report-eyebrow">Sloane · This week</div>
          <h1 class="report-title">Your week at a glance</h1>
          <div class="report-period">${escapeHtml(weekdayDate(r.period.from))} to ${escapeHtml(weekdayDate(r.period.to))}</div>
        </div>
        <div class="report-made">${name ? `For ${escapeHtml(name)}<br>` : ''}Made ${escapeHtml(made)}</div>
      </header>

      <div class="report-tiles">
        ${tile(c.late, 'Late', c.late ? 'red' : '')}
        ${tile(c.dueThisWeek, 'Due in the next 7 days', c.dueThisWeek ? 'amber' : '')}
        ${tile(c.vatThisWeek, 'VAT returns due this week')}
        ${tile(c.openTasks, 'Open tasks')}
        ${tile(c.stuckTasks, 'Stuck tasks', c.stuckTasks ? 'red' : '')}
        ${tile(c.doneThisWeek, 'Finished in the last 7 days', c.doneThisWeek ? 'green' : '')}
      </div>

      <section class="report-section">
        <h2>1. Late: needs action now</h2>
        ${table(r.late, ITEM_COLUMNS, 'Nothing is late. Well done.')}
      </section>

      <section class="report-section">
        <h2>2. Due in the next 7 days</h2>
        ${table(r.dueThisWeek, ITEM_COLUMNS, 'Nothing is due in the next 7 days.')}
      </section>

      <section class="report-section">
        <h2>3. Stuck tasks</h2>
        ${table(r.stuck, [
          { label: 'Task', value: x => x.what },
          { label: 'Client', value: x => x.name },
          { label: 'Who', value: x => x.who },
          { label: 'Held up by', value: x => x.stuck }
        ], 'No task is marked as stuck.')}
      </section>

      <section class="report-section">
        <h2>4. Who is doing what</h2>
        ${table(r.workload, [
          { label: 'Person', value: p => p.who },
          { label: 'Open tasks', value: p => p.open, right: true },
          { label: 'Late', value: p => p.late, right: true },
          { label: 'Stuck', value: p => p.stuck, right: true }
        ], 'There are no open tasks.')}
      </section>

      <section class="report-section">
        <h2>5. Finished in the last 7 days</h2>
        ${table(r.done, [
          { label: 'Task', value: x => x.what },
          { label: 'Client', value: x => x.name },
          { label: 'Who', value: x => x.who },
          { label: 'Finished', value: x => formatDateGB(x.date), nowrap: true }
        ], 'No tasks were finished in the last 7 days.')}
      </section>

      <section class="report-section">
        <h2>6. Coming next (8 to 30 days)</h2>
        <p class="report-text">${nextTotal
          ? `After this week, ${escapeHtml(plural(next.filings, 'filing', 'filings'))}, ${escapeHtml(plural(next.vat, 'VAT return', 'VAT returns'))} and ${escapeHtml(plural(next.tasks, 'task', 'tasks'))} fall due in the following three weeks. See the Deadlines page for the full list.`
          : 'Nothing else falls due in the following three weeks.'}</p>
      </section>

      <footer class="report-foot">
        Made by Sloane from your saved deadlines, VAT returns and tasks, and your TriNova clients where Sloane can read them. Dates are UK dates.
      </footer>`;
  },

  async refreshWeeklyReport() {
    await this.renderWeeklyReport();
    Toast.success('The report is up to date.');
  },

  /** Opens the print window. "Save as PDF" is one of the printer choices. */
  async printWeeklyReport() {
    if (!this.weeklyReport) await this.renderWeeklyReport();
    // Only the report is printed (see "Printing the This week report" in views.css)
    const view = document.getElementById('view-reports');
    document.body.classList.add('printing-report');
    if (view) view.classList.add('print-this');
    const done = () => {
      document.body.classList.remove('printing-report');
      if (view) view.classList.remove('print-this');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    // Some browsers do not send "afterprint"; tidy up anyway once the print window has closed
    setTimeout(done, 1000);
  }
};
