/**
 * Morning briefing: one page for the start of the day, across all the businesses (or one).
 * What to do first, the diary, how each business is doing, who is doing what, risks, the emails
 * that need her, and what Sloane recommends. It prints like a document.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { escapeHtml } from '../utils/html.js';

export const BRIEFING_ACTIONS = ['printMorningBriefing', 'refreshMorningBriefing'];

const li = items => `<ul class="brief-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

function itemLines(items) {
  return items.map(i => `<strong>${escapeHtml(i.title)}</strong> <span class="brief-why">${escapeHtml(i.why)}</span>`);
}

function outlookNote(data, fallback) {
  return (data && data.message) || fallback;
}

export const briefingMethods = {
  async renderMorningBriefing() {
    const box = document.getElementById('morningBriefing');
    if (!box) return;
    box.innerHTML = '<p class="report-empty">Putting your briefing together...</p>';

    // Sloane's own records, and (in parallel) the diary and flagged emails from Outlook
    const [briefingRes, diaryRes, emailsRes] = await Promise.all([
      ApiService.getMorningBriefing().then(r => ({ ok: true, r })).catch(err => ({ ok: false, err })),
      ApiService.getOutlookDiary('today').catch(() => null),
      ApiService.getOutlookFlaggedEmails().catch(() => null)
    ]);
    if (!briefingRes.ok) {
      box.innerHTML = `<p class="report-empty">Sloane could not put your briefing together just now: ${escapeHtml(briefingRes.err.message)}</p>`;
      return;
    }
    const b = briefingRes.r.data;
    this.morningBriefing = b;

    const diary = diaryRes && (diaryRes.data !== undefined ? diaryRes.data : diaryRes);
    const diaryItems = diary && diary.connected && diary.enabled && Array.isArray(diary.items) ? diary.items : null;
    const emails = emailsRes && (emailsRes.data !== undefined ? emailsRes.data : emailsRes);
    const emailItems = emails && emails.connected && emails.enabled && Array.isArray(emails.items) ? emails.items : null;
    const made = new Date(b.generatedAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
    const c = b.counts;
    const tile = (n, label, tone = '') => `<div class="report-tile ${tone}"><div class="n">${n}</div><div class="lbl">${escapeHtml(label)}</div></div>`;

    box.innerHTML = `
      <header class="report-head">
        <div>
          <div class="report-eyebrow">Sloane · Morning briefing${b.business ? ` · ${escapeHtml(b.business)}` : ''}</div>
          <h1 class="report-title">${escapeHtml(b.greeting)}</h1>
          <div class="report-period">${escapeHtml(b.dateLabel)}</div>
        </div>
        <div class="report-made">Made ${escapeHtml(made)}</div>
      </header>
      <p class="brief-headline">${escapeHtml(b.headline)}</p>

      <div class="report-tiles">
        ${tile(c.late, 'Late', c.late ? 'red' : '')}
        ${tile(c.dueThisWeek, 'Due in the next 7 days', c.dueThisWeek ? 'amber' : '')}
        ${tile(c.stuckTasks, 'Stuck tasks', c.stuckTasks ? 'red' : '')}
        ${tile(c.openTasks, 'Open tasks')}
        ${tile(b.suggestionsCount, 'Tasks Sloane suggests', b.suggestionsCount ? 'amber' : '')}
        ${tile(c.doneThisWeek, 'Finished in the last 7 days', c.doneThisWeek ? 'green' : '')}
      </div>

      <section class="report-section">
        <h2>1. Do these first</h2>
        ${b.priorities.length
          ? `<ol class="brief-priorities">${b.priorities.map(p => `<li><strong>${escapeHtml(p.title)}</strong> <span class="brief-why">${escapeHtml(p.why)}</span>${p.business ? ` <span class="pill neutral">${escapeHtml(p.business)}</span>` : ''}${p.who && p.who !== 'Nobody yet' ? ` <span class="brief-who">${escapeHtml(p.who)}</span>` : ''}</li>`).join('')}</ol>`
          : '<p class="report-empty">Nothing needs you first today.</p>'}
      </section>

      <section class="report-section">
        <h2>2. Your diary today</h2>
        ${diaryItems
          ? (diaryItems.length
            ? li(diaryItems.map(e => `<strong>${escapeHtml(e.time || 'All day')}</strong> ${escapeHtml(e.title)}${e.location ? ` <span class="brief-why">${escapeHtml(e.location)}</span>` : ''}${e.isClash ? ' <span class="pill red">Clashes with another meeting</span>' : ''}`))
            : '<p class="report-empty">No meetings today.</p>')
          : `<p class="report-empty">${escapeHtml(outlookNote(diary, 'Connect your Outlook (Settings) to see today\'s meetings here.'))}</p>`}
      </section>

      <section class="report-section">
        <h2>3. Your businesses</h2>
        <div class="brief-grid">
          ${b.businesses.map(x => `
            <div class="brief-biz ${x.health}">
              <div class="brief-biz-head"><span class="biz-dot ${x.health}" aria-hidden="true"></span><strong>${escapeHtml(x.name)}</strong></div>
              <p class="brief-biz-summary">${escapeHtml(x.summary)}</p>
              ${x.late.length ? `<div class="brief-sub">Late</div>${li(itemLines(x.late))}` : ''}
              ${x.dueThisWeek.length ? `<div class="brief-sub">Due in the next 7 days</div>${li(itemLines(x.dueThisWeek))}` : ''}
              ${x.stuck.length ? `<div class="brief-sub">Stuck</div>${li(itemLines(x.stuck))}` : ''}
              <div class="brief-biz-foot">${x.clients} client${x.clients === 1 ? '' : 's'} · ${x.openTasks} open task${x.openTasks === 1 ? '' : 's'}</div>
            </div>`).join('') || '<p class="report-empty">No businesses yet.</p>'}
        </div>
      </section>

      <section class="report-section">
        <h2>4. Who is doing what</h2>
        ${b.staff.length ? `
          <table class="report-table">
            <thead><tr><th>Person</th><th class="num">Open</th><th class="num">Late</th><th class="num">Stuck</th><th>Next up</th></tr></thead>
            <tbody>${b.staff.map(p => `<tr><td>${escapeHtml(p.who)}</td><td class="num">${p.open}</td><td class="num">${p.late}</td><td class="num">${p.stuck}</td><td>${p.items.map(i => `${escapeHtml(i.title)}${i.late ? ' <span class="late-tag">late</span>' : ''}`).join('<br>')}</td></tr>`).join('')}</tbody>
          </table>` : '<p class="report-empty">There are no open tasks.</p>'}
      </section>

      <section class="report-section">
        <h2>5. Risks and delays</h2>
        ${b.risks.length ? li(b.risks.map(r => `${escapeHtml(r.text)}${r.business ? ` <span class="pill neutral">${escapeHtml(r.business)}</span>` : ''}`)) : '<p class="report-empty">Nothing is at risk that Sloane can see.</p>'}
      </section>

      <section class="report-section">
        <h2>6. Emails that need you</h2>
        ${emailItems
          ? (emailItems.length
            ? li(emailItems.slice(0, 8).map(m => `<strong>${escapeHtml(m.title)}</strong> <span class="brief-why">${escapeHtml(m.sub || m.from || '')}</span>${m.priority === 'High' ? ' <span class="pill red">High importance</span>' : ''}`))
            : '<p class="report-empty">No flagged emails.</p>')
          : `<p class="report-empty">${escapeHtml(outlookNote(emails, 'Connect your Outlook (Settings) to see the emails that need you here.'))}</p>`}
      </section>

      <section class="report-section">
        <h2>7. What Sloane recommends</h2>
        ${li(b.recommendations.map(r => escapeHtml(r)))}
      </section>

      <footer class="report-foot">
        Made by Sloane from your saved deadlines, VAT returns and tasks, and your TriNova clients where Sloane can read them. Meetings and emails come from Outlook when it is connected. Teams is not connected yet. Dates are UK dates.
      </footer>`;
  },

  async refreshMorningBriefing() {
    await this.renderMorningBriefing();
    Toast.success('Your briefing is up to date.');
  },

  /** Opens the print window. "Save as PDF" is one of the printer choices. */
  async printMorningBriefing() {
    if (!this.morningBriefing) await this.renderMorningBriefing();
    const view = document.getElementById('view-briefing');
    document.body.classList.add('printing-report');
    if (view) view.classList.add('print-this');
    const done = () => {
      document.body.classList.remove('printing-report');
      if (view) view.classList.remove('print-this');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000);
  }
};
