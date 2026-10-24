/**
 * "Check TriNova data": asks the TriNova portal the questions Sloane depends on and describes the
 * SHAPE of each answer (field names and kinds of value), never the values themselves. The report
 * is safe to show and share: no client names, emails, numbers or dates.
 *
 * Used by the button in the TriNova connection panel (with the key kept on the server) and by
 * server/scripts/check-trinova.js (with a key in the developer's own terminal).
 */

import { shape } from './describeShape.js';
import { normaliseTrinovaDeadlines } from './trinovaDeadlines.js';

/**
 * @param {object} options
 * @param {(pathAndQuery:string, opts?:{auth?:boolean}) => Promise<{status:number, ok:boolean, json:any, error?:string}>} options.get
 * @param {string} options.base  Where TriNova lives (shown in the report)
 * @param {(line:string) => void} [options.log]
 */
export async function runTrinovaCheck({ get, base, log = () => {} }) {
  const report = { checkedAt: new Date().toISOString(), base, steps: [], summary: {} };

  async function step(name, pathAndQuery, options) {
    const r = await get(pathAndQuery, options);
    const entry = { name, path: pathAndQuery, httpStatus: r.status, ok: r.ok };
    if (r.error) entry.problem = r.error;
    if (r.json) {
      entry.topLevelKeys = Array.isArray(r.json) ? ['(a list)'] : Object.keys(r.json);
      if (r.json.error) entry.error = { code: r.json.error.code, message: r.json.error.message };
      entry.shape = shape(r.json);
    }
    report.steps.push(entry);
    const mark = r.ok ? 'OK ' : 'FAIL';
    log(`${mark} ${String(r.status).padEnd(4)} ${name}  (${pathAndQuery})${r.error ? `  ${r.error}` : ''}${r.json?.error?.message ? `  ${r.json.error.message}` : ''}`);
    return r;
  }

  const up = await step('Is TriNova up? (no key needed)', '/health', { auth: false });
  const who = await step('Is the key accepted?', '/auth/verify');
  report.summary.trinovaUp = up.ok;
  report.summary.keyAccepted = who.ok;

  if (who.status === 401 || who.status === 403) {
    report.summary.message = 'TriNova refused the key. It is missing, wrong, expired or revoked. Ask TriNova for a new one.';
    log(report.summary.message);
    return report;
  }

  const clients = await step('Clients (first 2)', '/clients?per_page=2&page=1');
  await step('Clients, second page (does paging work?)', '/clients?per_page=2&page=2');
  const deadlines = await step('Deadlines feed', '/statutory');

  // How much of the deadlines feed Sloane can read (counts only)
  if (deadlines.ok && deadlines.json) {
    const read = normaliseTrinovaDeadlines(deadlines.json);
    report.summary.deadlines = {
      listFound: read.listFound,
      rowsInFeed: read.total,
      rowsSloaneCanRead: read.understood,
      companiesWithDates: read.rows.length
    };
    log(read.listFound
      ? `Deadlines: Sloane can read ${read.understood} of ${read.total} row(s), giving dates for ${read.rows.length} compan${read.rows.length === 1 ? 'y' : 'ies'}.`
      : 'Deadlines: TriNova answered, but Sloane could not find a list of deadlines in the answer.');
  } else {
    report.summary.deadlines = { available: false, httpStatus: deadlines.status };
  }

  const first = Array.isArray(clients.json?.data) ? clients.json.data[0] : null;
  const companyId = first && ((first.companies && first.companies[0] && first.companies[0].id) || first.company_id || first.id);
  if (companyId !== undefined && companyId !== null) {
    const id = encodeURIComponent(String(companyId));
    await step('One company', `/companies/${id}`);
    await step('A company\'s documents', `/companies/${id}/documents`);
    await step('A company\'s signing requests', `/companies/${id}/signing-requests`);
    await step('A company\'s notes', `/companies/${id}/notes`);
  } else {
    log('(No client came back, so the single-company checks were skipped.)');
  }

  report.summary.stepsOk = report.steps.filter(s => s.ok).length;
  report.summary.stepsTotal = report.steps.length;
  return report;
}
