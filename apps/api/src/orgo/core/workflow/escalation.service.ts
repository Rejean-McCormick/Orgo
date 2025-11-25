// apps/api/src/orgo/core/workflow/escalation.service.ts

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { TaskService, TaskDto } from '../tasks/task.service';
import {
  NotifierService,
  NotifiableTask,
  TaskNotificationEventType,
} from '../notifications/notification.service';
import { LogService } from '../logging/log.service';
import { FN_ESCALATION_EVALUATE } from '../functional-ids';
import { FeatureFlagService } from '../../config/feature-flag.service';
import { OrgProfileService } from '../../config/org-profile.service';
import {
  AlertingService,
  EscalationDelayAlertInput,
} from '../alerts/alerting.service';

/**
 * Standard result shape for core services (aligned with other Orgo core services).
 */
export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    details?: any;
  };
}

/**
 * Options for running escalation evaluation.
 *
 * This is designed to be called periodically by the background job
 * `orgo.workflow.check-escalations` (Docs 3, 5, 8).
 */
export interface EvaluateEscalationsOptions {
  /**
   * Optional tenant scope. When omitted, the scan is global across all orgs.
   */
  organizationId?: string;

  /**
   * Evaluation point-in-time. Defaults to current UTC time.
   * All comparisons against `reactivity_deadline_at` and `next_fire_at`
   * use this timestamp.
   */
  now?: Date;

  /**
   * Safety limits for batch size. Defaults are intentionally conservative.
   */
  limitTasks?: number;
  limitInstances?: number;

  /**
   * When true and organizationId + environment are provided, escalation-delay
   * alert thresholds are evaluated and AlertingService is invoked with
   * the derived metrics (Docs 5 & 6).
   */
  evaluateAlerts?: boolean;

  /**
   * Logical environment passed down to AlertingService when alerts are
   * evaluated. This mirrors the Environment type used by AlertingService.
   */
  environment?: EscalationDelayAlertInput['environment'];
}

/**
 * Result summary for a single evaluation run.
 *
 * This is intentionally compact but carries enough information
 * for logging, observability, and alerting/inights.
 */
export interface EscalationEvaluationResult {
  // Core counters
  processedTasks: number;
  escalatedTasks: number;
  processedInstances: number;
  advancedInstances: number;

  // SLA / alert-friendly metrics (aligned with EscalationDelayAlertInput)
  overdueUnresolvedCount: number;
  overdueCriticalCount: number;
  /**
   * Max delay (in seconds) beyond `reactivity_deadline_at` among
   * overdue unresolved tasks in this batch.
   */
  maxDelaySeconds: number;

  /**
   * Optional profile code used for this evaluation (if org-scoped).
   */
  profileCode?: string;

  /**
   * Whether an escalation-delay alert was actually triggered
   * during this evaluation (if alerts were enabled).
   */
  alertTriggered?: boolean;
}

/**
 * Canonical unresolved Task statuses, aligned with Doc 8
 * and the TASK_STATUS enum:
 *   - PENDING
 *   - IN_PROGRESS
 *   - ON_HOLD
 *   - ESCALATED
 *
 * Completed/terminal statuses (COMPLETED, FAILED, CANCELLED) are excluded.
 */
const UNRESOLVED_STATUSES = ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'] as const;
type UnresolvedStatus = (typeof UNRESOLVED_STATUSES)[number];

/**
 * Shape of an escalation policy definition stored as JSON
 * and hydrated into EscalationInstance.policy.definition.
 *
 * This mirrors the high-level EscalationPolicyDefinition described
 * in Docs 3, 5, and 8.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EscalationStepActionDefinition {
  type: 'notify_role' | 'notify_user' | 'auto_reassign' | 'update_metadata';
  /**
   * Target role ID for notify_role / auto_reassign actions.
   */
  targetRoleId?: string | null;
  /**
   * Target user ID for notify_user / auto_reassign actions.
   */
  targetUserId?: string | null;
  /**
   * Optional notification channel hint (email, in_app, sms, etc.).
   * Actual routing is handled by NotificationRecipientResolver.
   */
  channel?: string | null;
  /**
   * Arbitrary structured payload attached to the action.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

export interface EscalationStepDefinition {
  /**
   * Human-readable label for this step (e.g. "Escalate to department head").
   */
  label?: string;
  /**
   * Seconds to wait after the previous step before firing this one.
   * If omitted, falls back to policy.default_wait_seconds.
   */
  wait_seconds?: number;
  /**
   * Actions to execute when this step fires.
   */
  actions?: EscalationStepActionDefinition[];
}

export interface EscalationPolicyDefinition {
  /**
   * Default waiting time between steps when a step-specific wait_seconds
   * is not set.
   */
  default_wait_seconds?: number;
  /**
   * Ordered list of escalation steps for this policy.
   */
  steps?: EscalationStepDefinition[];
}

@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly notifier: NotifierService,
    private readonly logService: LogService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly orgProfileService: OrgProfileService,
    private readonly alertingService: AlertingService,
  ) {}

  /**
   * Convenience wrapper for org-scoped evaluation.
   *
   * Typical usage in the job `orgo.workflow.check-escalations`:
   *   await escalationService.evaluateEscalationsForOrg(orgId, { now });
   */
  async evaluateEscalationsForOrg(
    organizationId: string,
    options: Omit<EvaluateEscalationsOptions, 'organizationId'> = {},
  ): Promise<Result<EscalationEvaluationResult>> {
    return this.evaluateEscalations({
      ...options,
      organizationId,
    });
  }

  /**
   * Main entry point for escalation evaluation.
   *
   * Responsibilities (Docs 3, 5, 8):
   * - Scan Tasks whose `reactivity_deadline_at` has passed and status is unresolved.
   * - For each overdue Task, trigger TaskService.escalateTask (which bumps
   *   escalation_level and status to ESCALATED).
   * - Emit ESCALATED Task notifications via NotifierService.
   * - Advance active EscalationInstances according to their policy definition
   *   (multi-step escalation flows).
   * - Compute SLA-friendly metrics (overdue counts, maxDelaySeconds) which
   *   can feed into AlertingService and Insights.
   * - Respect feature flags for FN_ESCALATION_EVALUATE.
   */
  async evaluateEscalations(
    options: EvaluateEscalationsOptions = {},
  ): Promise<Result<EscalationEvaluationResult>> {
    const now = options.now ?? new Date();
    const limitTasks = options.limitTasks ?? 500;
    const limitInstances = options.limitInstances ?? 500;
    const organizationId = options.organizationId ?? null;

    try {
      // -----------------------------------------------------------------------
      // Feature flag check (per FN_ESCALATION_EVALUATE)
      // -----------------------------------------------------------------------
      const disabledByFlag = await this.isEscalationEvaluationDisabled(
        organizationId,
      );
      if (disabledByFlag) {
        const result: EscalationEvaluationResult = {
          processedTasks: 0,
          escalatedTasks: 0,
          processedInstances: 0,
          advancedInstances: 0,
          overdueUnresolvedCount: 0,
          overdueCriticalCount: 0,
          maxDelaySeconds: 0,
          alertTriggered: false,
        };

        await this.logService.logEvent({
          category: 'WORKFLOW',
          level: 'INFO',
          message:
            'Escalation evaluation skipped; feature flag FN_ESCALATION_EVALUATE disabled.',
          identifier: FN_ESCALATION_EVALUATE,
          metadata: {
            organizationId,
            result,
          },
        });

        return { ok: true, data: result };
      }

      // -----------------------------------------------------------------------
      // Load org profile for SLA context (reactivity_seconds, etc.)
      // -----------------------------------------------------------------------
      let profileCode: string | undefined;
      if (organizationId) {
        try {
          const resolvedProfile = await this.orgProfileService.loadProfile(
            organizationId,
          );
          profileCode = resolvedProfile.profileCode;
        } catch (profileError: unknown) {
          // Fail soft: escalations must still run even if profile lookup fails.
          const message =
            profileError instanceof Error
              ? profileError.message
              : String(profileError ?? '');
          await this.logService.logEvent({
            category: 'CONFIG',
            level: 'WARN',
            message:
              'Failed to load organization profile during escalation evaluation. Continuing with defaults.',
            identifier: FN_ESCALATION_EVALUATE,
            metadata: {
              organizationId,
              error: message,
            },
          });
        }
      }

      // -----------------------------------------------------------------------
      // 1) Reactivity deadline-based escalations (Tasks)
      // -----------------------------------------------------------------------
      const overdueTasks = await this.findOverdueTasks(
        now,
        organizationId ?? undefined,
        limitTasks,
      );

      let escalatedTasks = 0;
      let overdueCriticalCount = 0;
      let maxDelaySeconds = 0;

      for (const task of overdueTasks) {
        // SLA metrics for Alerts/Insights: delay beyond reactivity_deadline_at.
        const deadline =
          task.reactivity_deadline_at ??
          (task.reactivityDeadlineAt
            ? new Date(task.reactivityDeadlineAt)
            : null);

        if (deadline instanceof Date && deadline.getTime() <= now.getTime()) {
          const delaySeconds = Math.max(
            0,
            Math.floor((now.getTime() - deadline.getTime()) / 1000),
          );
          if (delaySeconds > maxDelaySeconds) {
            maxDelaySeconds = delaySeconds;
          }
        }

        if (task.severity === 'CRITICAL') {
          overdueCriticalCount += 1;
        }

        const escalated = await this.handleOverdueTask(task, now);
        if (escalated) {
          escalatedTasks += 1;
        }
      }

      const overdueUnresolvedCount = overdueTasks.length;

      // -----------------------------------------------------------------------
      // 2) Multi-step EscalationInstances (policy-driven flows)
      // -----------------------------------------------------------------------
      const dueInstances = await this.findDueEscalationInstances(
        now,
        organizationId ?? undefined,
        limitInstances,
      );

      let advancedInstances = 0;

      for (const instance of dueInstances) {
        const advanced = await this.handleEscalationInstance(instance, now);
        if (advanced) {
          advancedInstances += 1;
        }
      }

      const baseResult: EscalationEvaluationResult = {
        processedTasks: overdueTasks.length,
        escalatedTasks,
        processedInstances: dueInstances.length,
        advancedInstances,
        overdueUnresolvedCount,
        overdueCriticalCount,
        maxDelaySeconds,
        profileCode,
        alertTriggered: false,
      };

      // -----------------------------------------------------------------------
      // 3) Optional escalation-delay alert trigger
      // -----------------------------------------------------------------------
      if (
        organizationId &&
        options.evaluateAlerts &&
        options.environment &&
        overdueUnresolvedCount > 0
      ) {
        const alertInput: EscalationDelayAlertInput = {
          organizationId,
          profileKey: profileCode ?? 'default',
          environment: options.environment,
          overdueUnresolvedCount,
          overdueCriticalCount,
          maxDelaySeconds,
        };

        const alertResult =
          await this.alertingService.triggerEscalationDelayAlert(alertInput);

        baseResult.alertTriggered = !!(
          alertResult.ok && alertResult.data?.triggered
        );
      }

      // -----------------------------------------------------------------------
      // 4) Structured logging for Insights / observability
      // -----------------------------------------------------------------------
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'INFO',
        message: 'Escalation evaluation completed.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          organizationId,
          result: baseResult,
        },
      });

      return { ok: true, data: baseResult };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error ?? '');

      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'ERROR',
        message: 'Escalation evaluation failed.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          organizationId,
          error: message,
        },
      });

      return {
        ok: false,
        error: {
          code: 'ESCALATION_EVALUATION_ERROR',
          message,
          details: {
            organizationId,
          },
        },
      };
    }
  }

  /**
   * Scan Tasks where:
   *   - status ∈ UNRESOLVED_STATUSES
   *   - reactivity_deadline_at <= now
   *   - (optionally) organization_id = organizationId
   *
   * All field names use the Prisma/DB `snake_case` schema (Docs 1, 3, 5).
   */
  private async findOverdueTasks(
    now: Date,
    organizationId?: string,
    limit = 500,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> {
    const prismaAny = this.prisma as any;

    if (!prismaAny.task || typeof prismaAny.task.findMany !== 'function') {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'WARN',
        message:
          'Prisma model "task" not available; skipping overdue task scan.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          now: now.toISOString(),
          organizationId: organizationId ?? null,
        },
      });
      return [];
    }

    const where: Record<string, unknown> = {
      reactivity_deadline_at: {
        lte: now,
      },
      status: {
        in: UNRESOLVED_STATUSES as UnresolvedStatus[],
      },
    };

    if (organizationId) {
      where.organization_id = organizationId;
    }

    const tasks = await prismaAny.task.findMany({
      where,
      orderBy: [
        { reactivity_deadline_at: 'asc' },
        { created_at: 'asc' },
      ],
      take: limit,
    });

    return tasks;
  }

  /**
   * Handle a single overdue Task by:
   *   - Calling TaskService.escalateTask (increments escalation_level, sets status ESCALATED).
   *   - Emitting an ESCALATED Task notification via NotifierService.
   *
   * This method uses `reactivity_deadline_at` as the canonical SLA anchor
   * (Docs 5 & 8) and does not recompute SLA from raw profile values.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleOverdueTask(task: any, now: Date): Promise<boolean> {
    const organizationId: string | null =
      task.organizationId ?? task.organization_id ?? null;

    const deadline =
      task.reactivity_deadline_at ??
      (task.reactivityDeadlineAt
        ? new Date(task.reactivityDeadlineAt)
        : null);

    if (!deadline || !(deadline instanceof Date)) {
      // Should not happen because findOverdueTasks already filters, but be defensive.
      return false;
    }

    if (deadline.getTime() > now.getTime()) {
      // Not actually overdue at the precise evaluation time.
      return false;
    }

    const escalateResult = await this.taskService.escalateTask({
      organizationId: organizationId ?? '',
      taskId: task.id ?? task.taskId,
      reason: 'Reactivity deadline exceeded',
      actorUserId: null, // System-driven escalation.
    });

    if (!escalateResult.ok || !escalateResult.data) {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'WARN',
        message: 'Task escalation failed during escalation evaluation.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          organizationId,
          taskId: task.id ?? null,
          error: escalateResult.error ?? null,
        },
      });
      return false;
    }

    // Translate TaskDto into NotifiableTask and emit ESCALATED notification.
    const escalatedTask = escalateResult.data;
    const notifiable = this.toNotifiableTask(escalatedTask, {
      escalation: {
        triggered_at: now.toISOString(),
        reason: 'Reactivity deadline exceeded',
      },
    });

    await this.notifier.sendTaskNotification(
      notifiable,
      'ESCALATED' as TaskNotificationEventType,
    );

    return true;
  }

  /**
   * Find EscalationInstances that are due to fire at or before `now`.
   *
   * Uses `next_fire_at` and `status ∈ {scheduled, in_progress}`.
   * Optionally scopes by organization via the linked Task's organization_id.
   */
  private async findDueEscalationInstances(
    now: Date,
    organizationId?: string,
    limit = 500,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> {
    const prismaAny = this.prisma as any;

    if (
      !prismaAny.escalationInstance ||
      typeof prismaAny.escalationInstance.findMany !== 'function'
    ) {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'WARN',
        message:
          'Prisma model "escalationInstance" not available; skipping escalation instance scan.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          now: now.toISOString(),
          organizationId: organizationId ?? null,
        },
      });
      return [];
    }

    const where: Record<string, unknown> = {
      status: {
        in: ['scheduled', 'in_progress'],
      },
      next_fire_at: {
        lte: now,
      },
    };

    if (organizationId) {
      // Scope by the owning Task's organization.
      where.task = {
        organization_id: organizationId,
      };
    }

    const instances = await prismaAny.escalationInstance.findMany({
      where,
      include: {
        task: true,
        policy: true,
      },
      orderBy: [
        { next_fire_at: 'asc' },
        { started_at: 'asc' },
      ],
      take: limit,
    });

    return instances;
  }

  /**
   * Process a single EscalationInstance:
   *   - Resolve its EscalationPolicyDefinition.
   *   - Execute the current step's actions.
   *   - Advance to the next step or mark the instance as completed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleEscalationInstance(
    instance: any,
    now: Date,
  ): Promise<boolean> {
    const policy = instance.policy;

    if (!policy?.definition) {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'WARN',
        message:
          'EscalationInstance has no policy definition; marking as completed.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          instanceId: instance.id,
        },
      });

      await this.markInstanceCompleted(instance, now);
      return false;
    }

    let definition: EscalationPolicyDefinition;

    try {
      // policy.definition is stored as JSON; tolerate both string and object.
      definition =
        typeof policy.definition === 'string'
          ? (JSON.parse(policy.definition) as EscalationPolicyDefinition)
          : (policy.definition as EscalationPolicyDefinition);
    } catch (parseError: unknown) {
      const message =
        parseError instanceof Error ? parseError.message : String(parseError);

      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'ERROR',
        message:
          'Failed to parse escalation policy definition; marking instance as completed.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          instanceId: instance.id,
          error: message,
        },
      });

      await this.markInstanceCompleted(instance, now);
      return false;
    }

    const steps = definition.steps ?? [];
    if (!steps.length) {
      await this.markInstanceCompleted(instance, now);
      return false;
    }

    const currentIndex: number =
      typeof instance.current_step_index === 'number'
        ? instance.current_step_index
        : 0;

    const currentStep = steps[currentIndex];
    if (!currentStep) {
      await this.markInstanceCompleted(instance, now);
      return false;
    }

    const actions = currentStep.actions ?? [];
    for (const action of actions) {
      await this.executeEscalationAction(instance, action, currentIndex, now);
    }

    const nextIndex = currentIndex + 1;
    const nextStep = steps[nextIndex];

    if (!nextStep) {
      await this.markInstanceCompleted(instance, now);
      return true;
    }

    const waitSeconds =
      typeof nextStep.wait_seconds === 'number' && nextStep.wait_seconds > 0
        ? nextStep.wait_seconds
        : typeof definition.default_wait_seconds === 'number' &&
          definition.default_wait_seconds > 0
        ? definition.default_wait_seconds
        : 60;

    const nextFireAt = new Date(now.getTime() + waitSeconds * 1000);

    const prismaAny = this.prisma as any;
    await prismaAny.escalationInstance.update({
      where: { id: instance.id },
      data: {
        current_step_index: nextIndex,
        next_fire_at: nextFireAt,
        updated_at: now,
      },
    });

    return true;
  }

  /**
   * Mark an EscalationInstance as completed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async markInstanceCompleted(instance: any, now: Date): Promise<void> {
    const prismaAny = this.prisma as any;

    if (
      !prismaAny.escalationInstance ||
      typeof prismaAny.escalationInstance.update !== 'function'
    ) {
      return;
    }

    await prismaAny.escalationInstance.update({
      where: { id: instance.id },
      data: {
        status: 'completed',
        completed_at: now,
        next_fire_at: null,
        updated_at: now,
      },
    });
  }

  /**
   * Execute a single escalation step action for an instance.
   *
   * Actions are intentionally conservative and side-effect-free beyond:
   *   - Task notifications (notify_role / notify_user).
   *   - Auto-reassignment via TaskService.assignTask.
   *   - Metadata updates on the Task row.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeEscalationAction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instance: any,
    action: EscalationStepActionDefinition,
    stepIndex: number,
    now: Date,
  ): Promise<void> {
    const task = instance.task;
    if (!task) {
      await this.logService.logEvent({
        category: 'WORKFLOW',
        level: 'WARN',
        message:
          'EscalationInstance has no linked task; skipping escalation action.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          instanceId: instance.id,
          action,
        },
      });
      return;
    }

    const organizationId: string | null =
      task.organizationId ?? task.organization_id ?? null;

    switch (action.type) {
      case 'notify_role':
      case 'notify_user': {
        const notifiable = this.toNotifiableTaskFromModel(task, {
          escalation: {
            instance_id: instance.id,
            step_index: stepIndex,
            target_role_id: action.targetRoleId ?? null,
            target_user_id: action.targetUserId ?? null,
            channel: action.channel ?? null,
            payload: action.payload ?? {},
            fired_at: now.toISOString(),
          },
        });

        await this.notifier.sendTaskNotification(
          notifiable,
          'ESCALATED' as TaskNotificationEventType,
        );
        break;
      }

      case 'auto_reassign': {
        if (!organizationId) {
          await this.logService.logEvent({
            category: 'WORKFLOW',
            level: 'WARN',
            message:
              'auto_reassign escalation action skipped; missing organizationId on task.',
            identifier: FN_ESCALATION_EVALUATE,
            metadata: {
              instanceId: instance.id,
              taskId: task.id ?? null,
              action,
            },
          });
          break;
        }

        const assignResult = await this.taskService.assignTask({
          organizationId,
          taskId: task.id ?? task.taskId,
          targetRoleId: action.targetRoleId ?? null,
          targetUserId: action.targetUserId ?? null,
          reason: 'Escalation auto-reassign',
          actorUserId: null,
        });

        if (!assignResult.ok) {
          await this.logService.logEvent({
            category: 'WORKFLOW',
            level: 'WARN',
            message:
              'auto_reassign escalation action failed via TaskService.assignTask.',
            identifier: FN_ESCALATION_EVALUATE,
            metadata: {
              instanceId: instance.id,
              taskId: task.id ?? null,
              error: assignResult.error ?? null,
            },
          });
        }
        break;
      }

      case 'update_metadata': {
        const prismaAny = this.prisma as any;

        if (!prismaAny.task || typeof prismaAny.task.update !== 'function') {
          break;
        }

        const existingMetadata =
          task.metadata && typeof task.metadata === 'object'
            ? task.metadata
            : {};

        const mergedMetadata = {
          ...existingMetadata,
          ...(action.payload ?? {}),
          escalation: {
            ...(existingMetadata?.escalation ?? {}),
            instance_id: instance.id,
            step_index: stepIndex,
            updated_at: now.toISOString(),
          },
        };

        await prismaAny.task.update({
          where: { id: task.id ?? task.taskId },
          data: {
            metadata: mergedMetadata,
            updated_at: now,
          },
        });
        break;
      }

      default:
        // Future-proof: ignore unknown action types safely.
        await this.logService.logEvent({
          category: 'WORKFLOW',
          level: 'WARN',
          message:
            'Unknown escalation action type encountered; skipping action.',
          identifier: FN_ESCALATION_EVALUATE,
          metadata: {
            instanceId: instance.id,
            taskId: task.id ?? null,
            action,
          },
        });
        break;
    }
  }

  /**
   * Determine whether escalation evaluation is disabled by feature flags
   * for the given organization.
   *
   * Uses FeatureFlagService with FN_ESCALATION_EVALUATE as the code.
   * If the flag is not defined or evaluation fails, we default to
   * "enabled" to avoid silently disabling core SLA behaviour.
   */
  private async isEscalationEvaluationDisabled(
    organizationId: string | null,
  ): Promise<boolean> {
    try {
      const code = FN_ESCALATION_EVALUATE;

      // First check whether a flag is explicitly defined.
      const existingFlag = await this.featureFlagService.getFlag(
        code,
        organizationId ?? undefined,
      );

      if (!existingFlag) {
        // No explicit flag configured → default to enabled.
        return false;
      }

      const enabled = this.featureFlagService.isFeatureEnabled(code, {
        organizationId: organizationId ?? undefined,
      });

      return !enabled;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error ?? '');

      await this.logService.logEvent({
        category: 'CONFIG',
        level: 'ERROR',
        message:
          'Feature flag evaluation for FN_ESCALATION_EVALUATE failed; proceeding with escalations enabled.',
        identifier: FN_ESCALATION_EVALUATE,
        metadata: {
          organizationId,
          error: message,
        },
      });

      // Fail-open: do not disable escalations on feature-flag errors.
      return false;
    }
  }

  /**
   * Helper: map TaskDto to NotifiableTask, optionally merging extra metadata.
   */
  private toNotifiableTask(
    task: TaskDto,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraMetadata?: any,
  ): NotifiableTask {
    const baseMetadata =
      (task.metadata && typeof task.metadata === 'object'
        ? task.metadata
        : {}) ?? {};

    const mergedMetadata =
      extraMetadata && typeof extraMetadata === 'object'
        ? { ...baseMetadata, ...extraMetadata }
        : baseMetadata;

    return {
      taskId: task.taskId,
      organizationId: task.organizationId,
      title: task.title,
      description: task.description ?? undefined,
      label: task.label ?? undefined,
      status: task.status,
      priority: task.priority,
      severity: task.severity,
      visibility: task.visibility,
      source: task.source,
      ownerRoleId: task.ownerRoleId ?? null,
      ownerUserId: task.ownerUserId ?? null,
      assigneeRole: task.assigneeRole ?? null,
      createdByUserId: task.createdByUserId ?? null,
      requesterPersonId: task.requesterPersonId ?? null,
      metadata: mergedMetadata,
    };
  }

  /**
   * Helper: map a raw Prisma Task model to NotifiableTask, for cases where
   * we operate directly on DB models (e.g. EscalationInstance.task includes).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toNotifiableTaskFromModel(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taskModel: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraMetadata?: any,
  ): NotifiableTask {
    const baseMetadata =
      taskModel.metadata && typeof taskModel.metadata === 'object'
        ? taskModel.metadata
        : {};

    const mergedMetadata =
      extraMetadata && typeof extraMetadata === 'object'
        ? { ...baseMetadata, ...extraMetadata }
        : baseMetadata;

    const taskId = taskModel.taskId ?? taskModel.id;
    const organizationId =
      taskModel.organizationId ?? taskModel.organization_id;

    return {
      taskId,
      organizationId,
      title: taskModel.title,
      description: taskModel.description ?? undefined,
      label: taskModel.label ?? undefined,
      status: taskModel.status,
      priority: taskModel.priority,
      severity: taskModel.severity,
      visibility: taskModel.visibility,
      source: taskModel.source,
      ownerRoleId: taskModel.ownerRoleId ?? taskModel.owner_role_id ?? null,
      ownerUserId: taskModel.ownerUserId ?? taskModel.owner_user_id ?? null,
      assigneeRole:
        taskModel.assigneeRole ?? taskModel.assignee_role ?? null,
      createdByUserId:
        taskModel.createdByUserId ?? taskModel.created_by_user_id ?? null,
      requesterPersonId:
        taskModel.requesterPersonId ??
        taskModel.requester_person_id ??
        null,
      metadata: mergedMetadata,
    };
  }
}
