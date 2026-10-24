import { mockDb } from '../data/db.js';

/**
 * Business Areas Routes
 * Supports GET /api/v1/businesses and POST /api/v1/businesses.
 */
/** How many TriNova clients the owner has put under this business. */
function linkedLiveClients(name) {
  return (mockDb.clientBusiness || []).filter(r => r.businessArea === name).length;
}

export function registerBusinessRoutes(app, { authenticate, requireScope }) {
  /**
   * GET /api/v1/businesses
   * Retrieves all business areas enriched with dynamic linked client counts.
   */
  app.get('/api/v1/businesses', authenticate, requireScope('sloane:read'), (req, res) => {
    req.auditAction = 'read_businesses_list';
    req.resourceType = 'business_area';

    if (!mockDb.businesses) {
      mockDb.businesses = [];
    }

    const clients = mockDb.clients || [];

    const enriched = mockDb.businesses.map(b => {
      const count = clients.filter(c => c.businessArea === b.name || c.clientType === b.name).length + linkedLiveClients(b.name);
      return {
        ...b,
        clientCount: count
      };
    });

    res.status(200).json({
      status: 'success',
      data: enriched,
      meta: {
        total: enriched.length
      }
    });
  });

  /**
   * POST /api/v1/businesses
   * Adds a new business area with input validation and uniqueness check.
   */
  app.post('/api/v1/businesses', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'create_business_area';
    req.resourceType = 'business_area';

    const { name, type } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'The business name is required.'
        }
      });
    }

    if (!type || typeof type !== 'string' || !type.trim()) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'The business type is required (for example "Property & Development").'
        }
      });
    }

    if (!mockDb.businesses) {
      mockDb.businesses = [];
    }

    const trimmedName = name.trim();
    const trimmedType = type.trim();

    // Check duplicate
    const existing = mockDb.businesses.find(b => b.name.toLowerCase() === trimmedName.toLowerCase());
    if (existing) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `A business called "${trimmedName}" already exists.`
        }
      });
    }

    const newBiz = {
      id: `biz-${Date.now()}`,
      name: trimmedName,
      type: trimmedType,
      status: 'Active',
      createdAt: new Date().toISOString()
    };

    mockDb.businesses.push(newBiz);

    res.status(201).json({
      status: 'success',
      data: {
        ...newBiz,
        clientCount: 0
      }
    });
  });

  /**
   * PATCH /api/v1/businesses/:id
   * Renames a business area or changes its category / status.
   */
  app.patch('/api/v1/businesses/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'update_business_area';
    req.resourceType = 'business_area';
    req.resourceId = req.params.id;

    const biz = (mockDb.businesses || []).find(b => b.id === req.params.id);
    if (!biz) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'That business no longer exists.' }
      });
    }

    const { name, type, status } = req.body || {};
    const previousName = biz.name;

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The business name cannot be empty.' } });
      }
      const clash = mockDb.businesses.find(b => b.id !== biz.id && b.name.toLowerCase() === trimmedName.toLowerCase());
      if (clash) {
        return res.status(409).json({ error: { code: 'CONFLICT', message: `A business called "${trimmedName}" already exists.` } });
      }
      biz.name = trimmedName;
    }

    if (type !== undefined) {
      const trimmedType = String(type).trim();
      if (!trimmedType) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The business type cannot be empty.' } });
      }
      biz.type = trimmedType;
    }

    if (status !== undefined) {
      if (!['Active', 'Paused'].includes(status)) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Status must be Active or Paused.' } });
      }
      biz.status = status;
    }

    // Keep linked clients attached to the renamed area
    if (biz.name !== previousName) {
      for (const c of (mockDb.clients || [])) {
        if (c.businessArea === previousName) c.businessArea = biz.name;
      }
      for (const r of (mockDb.clientBusiness || [])) {
        if (r.businessArea === previousName) r.businessArea = biz.name;
      }
    }
    biz.updatedAt = new Date().toISOString();

    const clientCount = (mockDb.clients || []).filter(c => c.businessArea === biz.name || c.clientType === biz.name).length + linkedLiveClients(biz.name);
    res.status(200).json({ status: 'success', data: { ...biz, clientCount } });
  });

  /**
   * DELETE /api/v1/businesses/:id
   * Removes a business area. Refused while clients are still linked to it.
   */
  app.delete('/api/v1/businesses/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'delete_business_area';
    req.resourceType = 'business_area';
    req.resourceId = req.params.id;

    const idx = (mockDb.businesses || []).findIndex(b => b.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'That business no longer exists.' }
      });
    }

    const biz = mockDb.businesses[idx];
    const linked = (mockDb.clients || []).filter(c => c.businessArea === biz.name || c.clientType === biz.name).length + linkedLiveClients(biz.name);
    if (linked > 0) {
      return res.status(409).json({
        error: {
          code: 'BUSINESS_AREA_IN_USE',
          message: `"${biz.name}" still has ${linked} client${linked === 1 ? '' : 's'}. Move or remove them first.`
        }
      });
    }

    mockDb.businesses.splice(idx, 1);
    res.status(200).json({ status: 'success', message: `"${biz.name}" has been removed.` });
  });
}
