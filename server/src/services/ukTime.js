/**
 * UK time for greetings. The server runs on UTC (Railway), but Kirsty is in the UK, so "Good
 * morning" must follow the UK clock, including British Summer Time.
 * Same rule as the browser (scripts/utils/html.js → ukPartOfDay).
 */

/** The hour in the UK (0-23). */
export function ukHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(date));
}

/** "morning" (5:00-11:59), "afternoon" (12:00-16:59) or "evening" (17:00-4:59), UK time. */
export function ukPartOfDay(date = new Date()) {
  const h = ukHour(date);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  return 'evening';
}
