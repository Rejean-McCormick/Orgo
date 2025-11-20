import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { TaskService } from '../tasks/task.service';
import { NotifierService } from '../notifications/notification.service';
import { LogService } from '../logging/log.service';
import { FN_ESCALATION_EVALUATE } from '../functional-ids';

/**
 * Standard result shape for core services.
 */
export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Options for running escalation evaluation.
 */
export interface EvaluateEscalationsOptions {
  organizationId?: string;
  /**
   * Optional override for "now", mainly for tests.
   */
  now?: Date;
  /**
   * Max number of overdue tasks to process in one run.
   */
  limitTasks?: number;
  /**
   * Max number of escalation instances to process in one run.
   */
  limitInstances?: number;
}

/**
 * Summary of what the escalation evaluation did.
 */
export interface EscalationEvaluationResult {
  processedTasks: number;
  escalatedTasks: number;
  processedInstances: number;
  advancedInstances: number;
}

/**
 * Unresolved task statuses: eligible for escalation.
 */
const UNRESOLVED_STATUSES: readonly string[] = [
  'PENDING',
  'IN_PROGRESS',
  'ON_HOLD',
  'ESCALATED',
];

/**
 * Escalation instance runtime status.
 */
export type EscalationInstanceStatus =
  | 'idle'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/**
 * Escalation actions that can be taken at each step.
 */
export type EscalationActionType =
  | 'notify_role'
  | 'notify_user'
  | 'auto_reassign'
  | 'auto_close'
  | 'raise_severity';

export interface EscalationStepAction {
  type: EscalationActionType;
  targetRoleId?: string;
  targetUserId?: string;
  /**
   * Notification channel when notifying.
   */
  channel?: 'email' | 'in_app';
  /**
   * For raise_severity.
   */
  newSeverity?: string;
  /**
   * Arbitrary additional payload for the action.
   */
  payload?: Record<string, unknown>;
}

export interface EscalationStep {
  /**
   * Relative delay (seconds) from when this step is executed to the next one.
   */
  delaySeconds: number;
  actions: EscalationStepAction[];
}

export interface EscalationPolicyDefinition {
  steps: EscalationStep[];
}

/**
 * Workflow escalation service.
 *
 * Invoked by background job "orgo.workflow.check-escalations".
 * Responsibilities:
 * - Escalate overdue tasks based on reactivity_deadline_at.
 * - Advance multi-step escalation instances backed by escalation_policies.
 * - Record escalation events and log structured entries.
 */
@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly notifier: NotifierService,
    private readonly logService: LogService,
  ) {}

  async evaluateEscalations(
    options: EvaluateEscalationsOptions = {},
  ): Promise<Result<EscalationEvaluationResult>> {
    const now = options.now ?? new Date();
    const limitTasks = options.limitTasks ?? 500;
    const limitInstances = options.limitInstances ?? 500;

    try {
      const overdueTasks = await this.findOverdueTasks(
        now,
        options.organizationId,
        limitTasks,
      );

      let escalatedTasks = 0;

      for (const task of overdueTasks) {
        const escalated = await this.handleOverdueTask(task, now);
        if (escalated) {
          escalatedTasks += 1;
        }
      }

      const dueInstances = await this.findDueEscalationInstances(
        now,
        options.organizationId,
        limitInstances,
      );

      let advancedInstances = 0;

      for (const instance of dueInstances) {
        const advanced = await this.handleEscalationInstance(instance, now);
        if (advanced) {
          advancedInstances += 1;
        }
      }

      const result: EscalationEvaluationResult = {
        processedTasks: overdueTasks.length,
        escalatedTasks,
        processedInstances: dueInstances.length,
        advancedInstances,
      };

      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'INFO',
        message: 'Escalation evaluation completed',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          ...result,
          organizationId: options.organizationId ?? null,
        },
      });

      return { ok: true, data: result };
    } catch (error) {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'ERROR',
        message: 'Escalation evaluation failed',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          organizationId: options.organizationId ?? null,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        },
      });

      return {
        ok: false,
        error: {
          code: 'ESCALATION_EVALUATION_ERROR',
          message: 'Failed to evaluate escalations',
          details:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        },
      };
    }
  }

  /**
   * Find unresolved tasks whose reactivity_deadline_at has passed.
   */
  private async findOverdueTasks(
    now: Date,
    organizationId?: string,
    limit = 500,
  ) {
    return this.prisma.task.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: UNRESOLVED_STATUSES as string[] },
        reactivityDeadlineAt: {
          lte: now,
        },
      },
      take: limit,
    });
  }

  /**
   * Escalate a single overdue task via TaskService and notify stakeholders.
   */
  private async handleOverdueTask(task: any, now: Date): Promise<boolean> {
    if (!task.reactivityDeadlineAt || task.reactivityDeadlineAt > now) {
      return false;
    }
    if (!UNRESOLVED_STATUSES.includes(task.status)) {
      return false;
    }

    const result = await this.taskService.escalateTask(task.id, {
      reason: 'Reactivity deadline exceeded',
      triggeredAt: now,
    });

    if (!result?.ok) {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'ERROR',
        message: 'Failed to escalate overdue task',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          taskId: task.id,
          organizationId: task.organizationId,
          error: result?.error ?? null,
        },
      });
      return false;
    }

    await this.notifier.sendTaskNotification({
      taskId: task.id,
      organizationId: task.organizationId,
      eventType: 'ESCALATED',
      payload: {
        source: 'reactivity_deadline',
        triggeredAt: now.toISOString(),
      },
    });

    return true;
  }

  /**
   * Find escalation instances whose next step is due.
   */
  private async findDueEscalationInstances(
    now: Date,
    organizationId?: string,
    limit = 500,
  ) {
    return this.prisma.escalationInstance.findMany({
      where: {
        status: { in: ['scheduled', 'in_progress'] as EscalationInstanceStatus[] },
        nextFireAt: {
          lte: now,
        },
        ...(organizationId
          ? {
              task: {
                organizationId,
              },
            }
          : {}),
      },
      take: limit,
      include: {
        task: true,
        policy: true,
      },
    });
  }

  /**
   * Advance a single escalation instance according to its policy definition.
   */
  private async handleEscalationInstance(
    instance: any,
    now: Date,
  ): Promise<boolean> {
    const { task, policy } = instance;

    if (!task) {
      return false;
    }

    // If task is no longer unresolved, cancel the instance.
    if (!UNRESOLVED_STATUSES.includes(task.status)) {
      await this.markInstanceCompleted(instance.id, 'cancelled', now);
      return false;
    }

    if (!policy || !policy.definition) {
      // No policy definition → nothing to do; mark as completed to avoid loops.
      await this.markInstanceCompleted(instance.id, 'completed', now);
      return false;
    }

    const definition = policy.definition as EscalationPolicyDefinition;
    const steps: EscalationStep[] = definition.steps ?? [];
    const nextIndex: number = (instance.currentStepIndex ?? -1) + 1;

    if (nextIndex >= steps.length) {
      await this.markInstanceCompleted(instance.id, 'completed', now);
      return false;
    }

    const step = steps[nextIndex];
    let anyActionSucceeded = false;

    for (const action of step.actions ?? []) {
      const success = await this.executeEscalationAction(
        action,
        task,
        instance,
        now,
        nextIndex,
      );
      anyActionSucceeded = anyActionSucceeded || success;

      await this.prisma.escalationEvent.create({
        data: {
          escalationInstanceId: instance.id,
          taskId: task.id,
          stepIndex: nextIndex,
          actionType: action.type,
          actionPayload: action,
          executedAt: now,
          success,
          errorMessage: success ? null : 'Escalation action failed',
        },
      });
    }

    const hasMoreSteps = nextIndex + 1 < steps.length;
    await this.prisma.escalationInstance.update({
      where: { id: instance.id },
      data: {
        currentStepIndex: nextIndex,
        status: hasMoreSteps ? ('scheduled' as EscalationInstanceStatus) : 'completed',
        nextFireAt: hasMoreSteps
          ? new Date(now.getTime() + steps[nextIndex + 1].delaySeconds * 1000)
          : null,
        completedAt: hasMoreSteps ? null : now,
      },
    });

    return anyActionSucceeded;
  }

  private async markInstanceCompleted(
    id: string,
    status: 'completed' | 'cancelled',
    at: Date,
  ): Promise<void> {
    await this.prisma.escalationInstance.update({
      where: { id },
      data: {
        status,
        completedAt: at,
        nextFireAt: null,
      },
    });
  }

  /**
   * Execute one escalation action against a task.
   */
  private async executeEscalationAction(
    action: EscalationStepAction,
    task: any,
    instance: any,
    now: Date,
    stepIndex: number,
  ): Promise<boolean> {
    try {
      switch (action.type) {
        case 'notify_role':
        case 'notify_user': {
          await this.notifier.sendTaskNotification({
            taskId: task.id,
            organizationId: task.organizationId,
            eventType: 'ESCALATED',
            payload: {
              escalationInstanceId: instance.id,
              stepIndex,
              targetRoleId: action.targetRoleId,
              targetUserId: action.targetUserId,
              channel: action.channel,
              payload: action.payload ?? {},
            },
          });
          break;
        }

        case 'auto_reassign': {
          if (action.targetRoleId || action.targetUserId) {
            await this.taskService.reassignTask(task.id, {
              targetRoleId: action.targetRoleId,
              targetUserId: action.targetUserId,
              reason: 'Escalation auto_reassign',
              triggeredAt: now,
            });
          }
          break;
        }

        case 'auto_close': {
          await this.taskService.updateTaskStatus(task.id, 'COMPLETED', {
            reason: 'Escalation auto_close',
            triggeredAt: now,
          });
          break;
        }

        case 'raise_severity': {
          if (action.newSeverity) {
            await this.taskService.updateTaskSeverity(task.id, action.newSeverity, {
              reason: 'Escalation raise_severity',
              triggeredAt: now,
            });
          }
          break;
        }

        default: {
          await this.logService.logEvent({
            category: 'WORKFLOW',
            level: 'WARNING',
            message: 'Unknown escalation action type',
            identifier: FN_ESCALATION_EVALUATE,
            metadata: {
              taskId: task.id,
              action,
            },
          });
          break;
        }
      }

      return true;
    } catch (error) {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'ERROR',
        message: 'Escalation action execution failed',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          taskId: task.id,
          action,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        },
      });
      return false;
    }
  }
}
