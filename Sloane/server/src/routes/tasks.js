/**
 * Trinova Tasks & Workflow API Routes
 * Implements task reads, idempotent creation, updates, completion, and workflow transitions.
 *
 * Adheres strictly to:
 * - context/04_backend_integration_context.md §4–5, §7
 * - context/05_data_security_context.md §3, §6
 * - context/specs/04-tasks-workflow-read-write.md
 */

import { mockDb } from '../data/db.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { WorkflowEngine } from '../services/workflow.js';

export function registerTaskRoutes(app, { authenticate, requireScope }) {
  /**
   * GET /api/v1/tasks
   * Reads outstanding tasks with filtering across companies, assignees, and statuses.
   */
  app.get('/api/v1/tasks', authenticate, requireScope('sloane:read'), (req, res) => {
    req.auditAction = 'read_tasks_list';
    req.resourceType = 'task';

    let tasks = [...(mockDb.tasks || [])];

    if (req.query.companyId) {
      tasks = tasks.filter(t => t.companyId === req.query.companyId);
    }

    if (req.query.status) {
      tasks = tasks.filter(t => t.status.toLowerCase() === req.query.status.toLowerCase());
    }

    if (req.query.assigneeId) {
      tasks = tasks.filter(t => t.assigneeId === req.query.assigneeId);
    }

    if (req.query.isBlocked !== undefined) {
      const isBlockedBool = req.query.isBlocked === 'true';
      tasks = tasks.filter(t => Boolean(t.isBlocked) === isBlockedBool);
    }

    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      tasks = tasks.filter(t => {
        return (t.title && t.title.toLowerCase().includes(q)) ||
               (t.description && t.description.toLowerCase().includes(q)) ||
               (t.companyName && t.companyName.toLowerCase().includes(q));
      });
    }

    // Sort by due date ascending (urgent first)
    tasks.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    res.status(200).json({
      status: 'success',
      data: tasks,
      meta: {
        total: tasks.length,
        unfilteredTotal: (mockDb.tasks || []).length
      }
    });
  });

  /**
   * GET /api/v1/companies/:companyId/tasks
   * Reads tasks linked specifically to a company ID.
   */
  app.get('/api/v1/companies/:companyId/tasks', authenticate, requireScope('sloane:read'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'read_company_tasks';
    req.resourceType = 'task';
    req.resourceId = companyId;

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: `Company with ID '${companyId}' not found.`
        }
      });
    }

    const tasks = (mockDb.tasks || []).filter(t => t.companyId === companyId);

    res.status(200).json({
      status: 'success',
      data: tasks,
      meta: {
        companyId,
        companyName: company.companyName,
        total: tasks.length
      }
    });
  });

  /**
   * GET /api/v1/tasks/:id
   * Reads details of a single task.
   */
  app.get('/api/v1/tasks/:id', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'read_task_detail';
    req.resourceType = 'task';
    req.resourceId = id;

    const task = (mockDb.tasks || []).find(t => t.id === id);
    if (!task) {
      return res.status(404).json({
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task with ID '${id}' not found.`
        }
      });
    }

    res.status(200).json({
      status: 'success',
      data: task
    });
  });

  /**
   * Helper to handle task creation logic (shared by POST /tasks and POST /companies/:id/tasks)
   */
  function handleCreateTask(req, res, targetCompanyId) {
    const companyId = targetCompanyId || req.body?.companyId;

    if (!companyId) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Target companyId is required.'
        }
      });
    }

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      return res.status(422).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: `Cannot create task: Company with ID '${companyId}' does not exist.`
        }
      });
    }

    const title = (req.body?.title || '').trim();
    if (!title) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Task title is required.'
        }
      });
    }

    if (title.length > 255) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Task title cannot exceed 255 characters.'
        }
      });
    }

    if (req.body.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate)) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'dueDate must be a valid ISO date string (YYYY-MM-DD).'
        }
      });
    }

    const newTask = {
      id: `tsk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      companyId: company.id,
      companyName: company.companyName,
      title,
      description: req.body.description || '',
      status: req.body.status || 'Pending',
      priority: req.body.priority || 'Normal',
      dueDate: req.body.dueDate || null,
      isBlocked: Boolean(req.body.isBlocked),
      blocker: req.body.blocker || null,
      assigneeId: req.body.assigneeId || null,
      assigneeName: req.body.assigneeName || null,
      creatorId: req.actor?.actorId || 'unknown_actor',
      creatorName: req.actor?.actorName || 'Authorized Staff',
      idempotencyKey: req.idempotencyKey,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!mockDb.tasks) mockDb.tasks = [];
    mockDb.tasks.unshift(newTask);

    req.auditAction = 'task_created';
    req.resourceType = 'task';
    req.resourceId = newTask.id;

    res.status(201).json({
      status: 'success',
      message: 'Task created successfully.',
      data: newTask
    });
  }

  /**
   * POST /api/v1/companies/:companyId/tasks
   * Creates a task linked to a specific company with mandatory Idempotency-Key.
   */
  app.post('/api/v1/companies/:companyId/tasks', authenticate, requireScope('sloane:write'), requireIdempotency, (req, res) => {
    handleCreateTask(req, res, req.params.companyId);
  });

  /**
   * POST /api/v1/tasks
   * Creates a task with mandatory Idempotency-Key and companyId in body.
   */
  app.post('/api/v1/tasks', authenticate, requireScope('sloane:write'), requireIdempotency, (req, res) => {
    handleCreateTask(req, res, req.body?.companyId);
  });

  /**
   * PATCH /api/v1/tasks/:id
   * Updates task details with optimistic concurrency conflict detection.
   */
  app.patch('/api/v1/tasks/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'task_updated';
    req.resourceType = 'task';
    req.resourceId = id;

    const task = (mockDb.tasks || []).find(t => t.id === id);
    if (!task) {
      return res.status(404).json({
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task with ID '${id}' not found.`
        }
      });
    }

    // Optimistic Concurrency Control
    if (req.body.version !== undefined) {
      const versionCheck = WorkflowEngine.validateVersion(task.version, req.body.version);
      if (!versionCheck.valid) {
        return res.status(409).json({
          error: {
            code: versionCheck.code,
            message: versionCheck.message
          }
        });
      }
    }

    // Validations
    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task title cannot be empty.'
          }
        });
      }
      task.title = title;
    }

    if (req.body.description !== undefined) {
      task.description = String(req.body.description);
    }

    if (req.body.dueDate !== undefined) {
      if (req.body.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate)) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'dueDate must be a valid ISO date string (YYYY-MM-DD).'
          }
        });
      }
      task.dueDate = req.body.dueDate;
    }

    if (req.body.status !== undefined) {
      if (!WorkflowEngine.PERMITTED_TASK_STATUSES.includes(req.body.status)) {
        return res.status(422).json({
          error: {
            code: 'INVALID_TASK_STATUS',
            message: `Task status '${req.body.status}' is not permitted. Permitted statuses: [${WorkflowEngine.PERMITTED_TASK_STATUSES.join(', ')}].`
          }
        });
      }
      task.status = req.body.status;
    }

    if (req.body.priority !== undefined) {
      task.priority = req.body.priority;
    }

    if (req.body.assigneeId !== undefined) {
      task.assigneeId = req.body.assigneeId;
      task.assigneeName = req.body.assigneeName || task.assigneeName;
    }

    if (req.body.isBlocked !== undefined) {
      task.isBlocked = Boolean(req.body.isBlocked);
      task.blocker = task.isBlocked ? (req.body.blocker || 'Blocked') : null;
    }

    task.version = (task.version || 1) + 1;
    task.updatedAt = new Date().toISOString();

    res.status(200).json({
      status: 'success',
      message: 'Task updated successfully.',
      data: task
    });
  });

  /**
   * POST /api/v1/tasks/:id/complete
   * Enforces Trinova completion rules and marks task as Completed.
   */
  app.post('/api/v1/tasks/:id/complete', authenticate, requireScope('sloane:write'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'task_completed';
    req.resourceType = 'task';
    req.resourceId = id;

    const task = (mockDb.tasks || []).find(t => t.id === id);
    if (!task) {
      return res.status(404).json({
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task with ID '${id}' not found.`
        }
      });
    }

    // Validate completion rules
    const completionCheck = WorkflowEngine.validateTaskCompletion(task, req.body || {});
    if (!completionCheck.valid) {
      return res.status(422).json({
        error: {
          code: completionCheck.code,
          message: completionCheck.message
        }
      });
    }

    task.status = 'Completed';
    task.isBlocked = false;
    task.blocker = null;
    task.completedAt = new Date().toISOString();
    task.completedBy = req.actor?.actorName || 'Authorized Staff';
    task.completionNotes = req.body?.completionNotes || req.body?.resolution || 'Task completed via portal.';
    task.version = (task.version || 1) + 1;
    task.updatedAt = new Date().toISOString();

    res.status(200).json({
      status: 'success',
      message: 'Task successfully completed.',
      data: task
    });
  });

  /**
   * POST /api/v1/companies/:companyId/workflow
   * Transitions company statutory/operational workflow stage via permitted state transitions.
   */
  app.post('/api/v1/companies/:companyId/workflow', authenticate, requireScope('sloane:write'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'workflow_transition_updated';
    req.resourceType = 'company';
    req.resourceId = companyId;

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: `Company with ID '${companyId}' not found.`
        }
      });
    }

    const currentStage = company.workflowStage || 'Onboarding';
    const targetStage = req.body?.targetStatus;

    const transitionResult = WorkflowEngine.validateWorkflowTransition(currentStage, targetStage);
    if (!transitionResult.valid) {
      return res.status(422).json({
        error: {
          code: 'INVALID_WORKFLOW_TRANSITION',
          message: transitionResult.message
        }
      });
    }

    const previousStage = currentStage;
    company.workflowStage = targetStage;
    company.workflowUpdatedAt = new Date().toISOString();
    company.workflowUpdatedBy = req.actor?.actorName || 'Authorized Staff';

    res.status(200).json({
      status: 'success',
      message: `Workflow status for '${company.companyName}' transitioned from '${previousStage}' to '${targetStage}'.`,
      data: {
        companyId: company.id,
        companyName: company.companyName,
        previousStatus: previousStage,
        currentStatus: company.workflowStage,
        updatedAt: company.workflowUpdatedAt,
        updatedBy: company.workflowUpdatedBy
      }
    });
  });
}
