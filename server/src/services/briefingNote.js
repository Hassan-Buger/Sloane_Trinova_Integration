/**
 * "Sloane's note": a few plain sentences at the top of the morning briefing, written by the AI
 * model from the briefing's own figures. It is only shown when an AI key is set.
 *
 * Guards, because a note is read first and trusted:
 *  - the model is given only the briefing's figures and told to use nothing else;
 *  - every number in the note must appear in those figures, or the note is dropped;
 *  - it may never say work is "on track" or "all good" (the figures do not say that);
 *  - it is kept for 20 minutes per business, so opening the page does not call the model each time.
 * If anything fails, there is simply no note: the page still shows the rule-based headline.
 */

import crypto from 'node:crypto';
import { claudeService } from './ai/claudeService.js';
import { BRIEFING_NOTE_PROMPT } from './ai/prompts.js';

const TTL_MS = 20 * 60 * 1000;
const cache = new Map();

/** The briefing's figures, small enough to send. */
export function compactBriefing(b) {
  return {
    date: b.date,
    business: b.business || 'all four businesses',
    headline: b.headline,
    counts: b.counts,
    doFirst: b.priorities.map(p => ({ what: p.title, why: p.why, business: p.business })),
    businesses: b.businesses.map(x => ({ name: x.name, health: x.health, summary: x.summary, late: x.counts.late, dueThisWeek: x.counts.dueThisWeek, stuck: x.counts.stuck })),
    staff: b.staff.slice(0, 8).map(p => ({ who: p.who, open: p.open, late: p.late, stuck: p.stuck })),
    risks: b.risks.map(r => r.text),
    recommendations: b.recommendations
  };
}

/** Every number written in some text, as digit strings. */
const numbersIn = text => new Set(String(text).match(/\d+/g) || []);

/** Is this note safe to show? Returns the cleaned note, or null. */
export function checkNote(note, figuresText) {
  const text = String(note || '').replace(/\s+/g, ' ').trim();
  if (text.length < 30 || text.length > 900) return null;
  if (/\b(on track|all good|everything is fine|nothing to worry)\b/i.test(text)) return null;
  const allowed = numbersIn(figuresText);
  for (const n of numbersIn(text)) if (!allowed.has(n)) return null;
  return text;
}

/**
 * @param {object} briefing  from buildMorningBriefing
 * @param {object} [options]
 * @param {object} [options.ai]  the AI service (for tests)
 * @returns {Promise<{ note: string|null, reason?: string, source?: string, model?: string }>}
 */
export async function writeBriefingNote(briefing, { ai = claudeService, now = Date.now() } = {}) {
  if (!ai.isConfigured()) return { note: null, reason: 'no_ai' };
  const figures = compactBriefing(briefing);
  const figuresText = JSON.stringify(figures);
  const key = crypto.createHash('sha256').update(figuresText).digest('hex');
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  let value;
  try {
    const res = await ai.ask({
      query: `THE BRIEFING FIGURES (use only these):\n${figuresText}`,
      context: { intent: 'GENERAL' },
      history: [],
      systemPrompt: BRIEFING_NOTE_PROMPT,
      rules: false
    });
    const fromModel = res && (res.source === 'google_gemini' || res.source === 'anthropic_claude');
    const note = fromModel ? checkNote(res.data && res.data.answer, figuresText) : null;
    value = note
      ? { note, source: res.source, model: res.model }
      : { note: null, reason: fromModel ? 'rejected' : 'ai_unavailable' };
  } catch (_) {
    value = { note: null, reason: 'ai_unavailable' };
  }
  // A failure is remembered for a short time only, so a brief outage clears itself
  cache.set(key, { at: value.note ? now : now - TTL_MS + 60 * 1000, value });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return value;
}

export function clearBriefingNoteCache() { cache.clear(); }
