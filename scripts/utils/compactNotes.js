/**
 * Long lists of notes made pages very long. These keep a notes list short:
 *  - only the newest few are shown, with "Show all N notes" / "Show fewer notes";
 *  - a long note is cut to a few lines, with "Read more" / "Show less".
 * The choices are remembered on the app while the page is open.
 */

import { escapeHtml } from './html.js';

export const NOTES_SHOWN = 5;
export const LONG_NOTE = 260;

/** The notes to draw now, and whether some are hidden. `notes` is newest first. */
export function visibleNotes(app, listKey, notes) {
  app.notesShowAll = app.notesShowAll || {};
  const all = Boolean(app.notesShowAll[listKey]);
  return { shown: all ? notes : notes.slice(0, NOTES_SHOWN), hidden: Math.max(0, notes.length - NOTES_SHOWN), all };
}

/** The button under a list that shows the rest, or goes back to the newest few. */
export function moreNotesButton(listKey, info, total) {
  if (info.hidden === 0) return '';
  return `<div class="notes-more"><button type="button" class="card-action-btn" data-action="toggleNotesList" data-id="${escapeHtml(listKey)}">${info.all ? 'Show fewer notes' : `Show all ${total} notes`}</button></div>`;
}

/** A note's text: cut short when it is long, with a way to read it all. */
export function noteTextHtml(app, id, text, className) {
  const open = (app.expandedNotes || new Set()).has(id);
  const long = String(text).length > LONG_NOTE || String(text).split('\n').length > 5;
  return `<div class="${className}${long && !open ? ' note-clamped' : ''}">${escapeHtml(text)}</div>`
    + (long ? `<button type="button" class="note-toggle" data-action="toggleNoteText" data-id="${escapeHtml(id)}">${open ? 'Show less' : 'Read more'}</button>` : '');
}

/** Flip one note open or closed. */
export function toggleExpanded(app, id) {
  app.expandedNotes = app.expandedNotes || new Set();
  if (app.expandedNotes.has(id)) app.expandedNotes.delete(id); else app.expandedNotes.add(id);
}

export function toggleList(app, listKey) {
  app.notesShowAll = app.notesShowAll || {};
  app.notesShowAll[listKey] = !app.notesShowAll[listKey];
}
