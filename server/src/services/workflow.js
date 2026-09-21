/**
 * Trinova Workflow State Machine & Task Rules Engine
 * Enforces valid status transitions, task completion requirements,
 * and optimistic concurrency checking.
 *
 * Adheres strictly to:
 * - context/04_backend_integration_context.md §4–5
 * - context/specs/04-tasks-workflow-read-write.md
 */

export class WorkflowEngine {
  /**
   * Permitted company statutory/operational workflow stage transitions.
   */
  static PERMITTED_WORKFLOW_TRANSITIONS = {
    'Onboarding': ['Information_Gathering', 'Suspended'],
    'Information_Gathering': ['Drafting', 'Suspended'],
    'Drafting': ['Review', 'Information_Gathering', 'Suspended'],
    'Review': ['Filed', 'Drafting', 'Suspended'],
    'Filed': ['Completed', 'Review'],
    'Completed': [], // Terminal state
    'Suspended': ['Onboarding', 'Information_Gathering', 'Drafting', 'Review']
  };

  /**
   * Permitted task status transitions.
   */
  static PERMITTED_TASK_STATUSES = [
    'Pending',
    'In_Progress',
    'Under_Review',
    'Completed',
    'Cancelled'
  ];

  /**
   * Validates whether a company workflow transition is permitted.
   */
  static validateWorkflowTransition(currentStatus, targetStatus) {
    if (!currentStatus) {
      return { valid: false, message: 'Current company workflow status is required.' };
    }
    if (!targetStatus) {
      return { valid: false, message: 'Target workflow status is required.' };
    }
    if (currentStatus === targetStatus) {
      return { valid: false, message: `Company is already in workflow state '${currentStatus}'.` };
    }

    const allowed = this.PERMITTED_WORKFLOW_TRANSITIONS[currentStatus];
    if (!allowed) {
      return {
        valid: false,
        message: `Unknown workflow state '${currentStatus}'.`
      };
    }

    if (!allowed.includes(targetStatus)) {
      return {
        valid: false,
        message: `Transition from '${currentStatus}' to '${targetStatus}' is not permitted by Trinova workflow rules. Permitted transitions from '${currentStatus}': [${allowed.join(', ')}].`
      };
    }

    return { valid: true };
  }

  /**
   * Validates task completion rules.
   */
  static validateTaskCompletion(task, completionPayload = {}) {
    if (!task) {
      return { valid: false, code: 'TASK_NOT_FOUND', message: 'Task does not exist.' };
    }

    if (task.status === 'Completed') {
      return {
        valid: false,
        code: 'TASK_ALREADY_COMPLETED',
        message: `Task '${task.id}' has already been marked as Completed.`
      };
    }

    if (task.status === 'Cancelled') {
      return {
        valid: false,
        code: 'TASK_CANCELLED',
        message: `Task '${task.id}' is cancelled and cannot be directly completed.`
      };
    }

    // Rule: Blocked tasks must supply resolution or completion notes
    if (task.isBlocked && !completionPayload.completionNotes && !completionPayload.resolution) {
      return {
        valid: false,
        code: 'BLOCKED_TASK_REQUIRES_RESOLUTION',
        message: `Task is currently blocked ('${task.blocker}'). Completion requires a resolution or completion notes.`
      };
    }

    return { valid: true };
  }

  /**
   * Validates optimistic concurrency version to prevent silent overwrite.
   */
  static validateVersion(currentVersion, clientVersion) {
    if (clientVersion === undefined || clientVersion === null) {
      // Version not passed, allow update or require depending on policy
      return { valid: true };
    }

    const numericClientVersion = parseInt(clientVersion, 10);
    if (numericClientVersion !== currentVersion) {
      return {
        valid: false,
        code: 'STALE_UPDATE_CONFLICT',
        message: `Conflict: Task was modified by another session. Current version is ${currentVersion}, provided version was ${numericClientVersion}. Refresh before modifying.`
      };
    }

    return { valid: true };
  }
}
