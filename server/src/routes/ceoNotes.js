/**
 * My Private Notes
 *
 * The owner's private notebook, saved on the Sloane server (so it survives a new browser or a
 * cleared cache). Rules:
 * - Only a signed-in browser session can use these routes (never an API key).
 * - Each note belongs to the person who wrote it; nobody else can read or change it.
 * - Notes are never sent to the AI and never shared with TriNova unless the owner chooses
 *   "Share with TriNova team" on a single note.
 */

import { mockDb } from '../data/db.js';
import { sendError, newId, cleanText, requireSession } from './helpers.js';
import { takeOut, putInBin } from '../services/bin.js';

const MAX_NOTE_LENGTH = 10000;

function mine(req) {
  return (mockDb.ceoNotes || []).filter(n => n.ownerId === req.actor.actorId);
}

function publicNote(n) {
  const { ownerId, ...safe } = n;
  return safe;
}

export function registerCeoNoteRoutes(app, { authenticate, requireScope }) {
  /** GET /api/v1/ceo-notes: the owner's notes, newest first. */
  app.get('/api/v1/ceo-notes', authenticate, requireScope('sloane:read'), requireSession, (req, res) => {
    req.auditAction = 'read_private_notes';
    req.resourceType = 'private_note';
    const notes = mine(req).map(publicNote);
    res.status(200).json({ status: 'success', data: notes, meta: { total: notes.length } });
  });

  /** POST /api/v1/ceo-notes: write a note. */
  app.post('/api/v1/ceo-notes', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'private_note_created';
    req.resourceType = 'private_note';

    const text = cleanText(req.body?.text);
    if (!text) return sendError(res, 400, 'BAD_REQUEST', 'Please write something before saving.');
    if (text.length > MAX_NOTE_LENGTH) {
      return sendError(res, 400, 'BAD_REQUEST', `A note can be up to ${MAX_NOTE_LENGTH.toLocaleString('en-GB')} characters.`);
    }

    const note = {
      id: newId('cn'),
      ownerId: req.actor.actorId,
      text,
      createdAt: new Date().toISOString(),
      editedAt: null
    };
    mockDb.ceoNotes.unshift(note);
    req.resourceId = note.id;
    res.status(201).json({ status: 'success', data: publicNote(note) });
  });

  /**
   * POST /api/v1/ceo-notes/import
   * Moves notes that were saved only in this browser onto the server. Safe to run twice:
   * a note that was already moved is skipped.
   */
  app.post('/api/v1/ceo-notes/import', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'private_notes_imported';
    req.resourceType = 'private_note';

    const incoming = Array.isArray(req.body?.notes) ? req.body.notes : null;
    if (!incoming) return sendError(res, 400, 'BAD_REQUEST', 'There were no notes to move.');
    if (incoming.length > 500) return sendError(res, 400, 'BAD_REQUEST', 'Too many notes to move at once.');

    const known = new Set(mine(req).map(n => n.clientRef).filter(Boolean));
    let imported = 0;
    let skipped = 0;
    for (const item of incoming) {
      const text = cleanText(item?.text);
      const ref = cleanText(String(item?.id || ''));
      if (!text || text.length > MAX_NOTE_LENGTH || (ref && known.has(ref))) { skipped++; continue; }
      const created = Date.parse(item.createdAt);
      mockDb.ceoNotes.push({
        id: newId('cn'),
        ownerId: req.actor.actorId,
        text,
        createdAt: Number.isNaN(created) ? new Date().toISOString() : new Date(created).toISOString(),
        editedAt: item.editedAt && !Number.isNaN(Date.parse(item.editedAt)) ? new Date(item.editedAt).toISOString() : null,
        clientRef: ref || null
      });
      if (ref) known.add(ref);
      imported++;
    }
    // Keep the newest first.
    mockDb.ceoNotes.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    res.status(200).json({ status: 'success', data: { imported, skipped } });
  });

  /** PATCH /api/v1/ceo-notes/:id: change the text of a note. */
  app.patch('/api/v1/ceo-notes/:id', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'private_note_updated';
    req.resourceType = 'private_note';
    req.resourceId = req.params.id;

    const note = mine(req).find(n => n.id === req.params.id);
    if (!note) return sendError(res, 404, 'NOT_FOUND', 'That note no longer exists.');

    const text = cleanText(req.body?.text);
    if (!text) return sendError(res, 400, 'BAD_REQUEST', 'A note cannot be empty. Use Delete to remove it.');
    if (text.length > MAX_NOTE_LENGTH) {
      return sendError(res, 400, 'BAD_REQUEST', `A note can be up to ${MAX_NOTE_LENGTH.toLocaleString('en-GB')} characters.`);
    }
    note.text = text;
    note.editedAt = new Date().toISOString();
    res.status(200).json({ status: 'success', data: publicNote(note) });
  });

  /** DELETE /api/v1/ceo-notes/:id */
  app.delete('/api/v1/ceo-notes/:id', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'private_note_deleted';
    req.resourceType = 'private_note';
    req.resourceId = req.params.id;

    const note = mine(req).find(n => n.id === req.params.id);
    if (!note) return sendError(res, 404, 'NOT_FOUND', 'That note no longer exists.');
    const text = String(note.text || note.content || '').trim();
    const entry = putInBin({
      kind: 'private_note',
      label: text.length > 60 ? `${text.slice(0, 60)}...` : (text || 'Private note'),
      where: 'My Private Notes',
      ownerOnly: true,
      removed: [takeOut('ceoNotes', mockDb.ceoNotes.indexOf(note))]
    });
    res.status(200).json({ status: 'success', message: 'Note moved to the Bin. You can put it back from the Bin within 30 days.', data: { binId: entry.id } });
  });
}
