/**
 * The Bin page: what was deleted in the last 30 days, put it back, or delete it for good.
 *
 * GET    /api/v1/bin              items in the Bin, newest first
 * POST   /api/v1/bin/:id/restore  put an item back where it was
 * DELETE /api/v1/bin/:id          delete one item for good (cannot be undone)
 * DELETE /api/v1/bin              empty the Bin (cannot be undone)
 *
 * Only the signed-in owner can use the Bin: it can hold private notes.
 */

import { BIN_DAYS, BIN_KIND_LABEL, listBin, findBinEntry, restoreFromBin, deleteForGood, emptyBin, clearExpired } from '../services/bin.js';
import { sendError, requireSession } from './helpers.js';

const GONE = 'That item is no longer in the Bin. It may already have been put back or deleted for good.';

/** Where a restored item can be found again. */
const WHERE_BACK = {
  business: 'It is back in My Businesses.',
  client: 'It is back in Clients, with its tasks, notes, documents and history.',
  task: 'It is back in Team & Tasks.',
  team_member: 'They are back in Team & Tasks.',
  deadline: 'It is back in Deadlines.',
  vat_return: 'It is back in Deadlines, under VAT returns.',
  note: 'It is back on the client\'s Notes tab.',
  document: 'It is back on the client\'s Documents tab.',
  history: 'It is back on the client\'s History tab.',
  private_note: 'It is back in My Private Notes.'
};

export function registerBinRoutes(app, { authenticate, requireScope }) {
  const ownerOnly = [authenticate, requireScope('sloane:write'), requireSession];

  app.get('/api/v1/bin', authenticate, requireScope('sloane:read'), requireSession, (req, res) => {
    req.auditAction = 'bin_read';
    req.resourceType = 'bin';
    clearExpired();
    const data = listBin({ includeOwnerOnly: true });
    res.status(200).json({ status: 'success', data, meta: { total: data.length, keepDays: BIN_DAYS } });
  });

  app.post('/api/v1/bin/:id/restore', ...ownerOnly, (req, res) => {
    req.auditAction = 'bin_restore';
    req.resourceType = 'bin';
    req.resourceId = req.params.id;
    const result = restoreFromBin(req.params.id);
    if (result.error) return sendError(res, result.error[0], result.error[1], result.error[2]);
    const { entry } = result;
    const what = BIN_KIND_LABEL[entry.kind] || 'Item';
    res.status(200).json({
      status: 'success',
      message: `${what} "${entry.label}" has been put back. ${WHERE_BACK[entry.kind] || ''}`.trim(),
      data: { id: entry.id, kind: entry.kind, restored: result.restored, skipped: result.skipped }
    });
  });

  app.delete('/api/v1/bin/:id', ...ownerOnly, (req, res) => {
    req.auditAction = 'bin_delete_for_good';
    req.resourceType = 'bin';
    req.resourceId = req.params.id;
    if (!findBinEntry(req.params.id)) return sendError(res, 404, 'NOT_FOUND', GONE);
    const entry = deleteForGood(req.params.id);
    res.status(200).json({ status: 'success', message: `"${entry.label}" has been deleted for good.`, data: { id: entry.id } });
  });

  app.delete('/api/v1/bin', ...ownerOnly, (req, res) => {
    req.auditAction = 'bin_emptied';
    req.resourceType = 'bin';
    const n = emptyBin();
    res.status(200).json({
      status: 'success',
      message: n ? `The Bin has been emptied: ${n} item${n === 1 ? '' : 's'} deleted for good.` : 'The Bin was already empty.',
      data: { deleted: n }
    });
  });
}
