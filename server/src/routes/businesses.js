import { mockDb } from '../data/db.js';

/**
 * Business Areas Routes
 * Supports GET /api/v1/businesses and POST /api/v1/businesses.
 */
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
      const count = clients.filter(c => c.businessArea === b.name || c.clientType === b.name).length;
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
          message: 'Business area name is required.'
        }
      });
    }

    if (!type || typeof type !== 'string' || !type.trim()) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Business area type is required.'
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
          message: `Business area "${trimmedName}" already exists.`
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
}
