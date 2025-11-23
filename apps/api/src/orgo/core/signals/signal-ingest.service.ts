// apps/api/src/orgo/core/signals/signal-ingest.service.ts

import { Injectable, Logger } from '@nestjs/common';

import { LogService } from '../logging/log.service';
import { FN_SIGNAL_INGEST } from '../functional-ids';

import {
  WorkflowContext,
  WorkflowEngineResult,
  WorkflowExecutionResultData,
  ResolvedWorkflowAction,
  WorkflowEngineService,
} from '../workflow/workflow-engine.service';

import {
  TaskService,
  CreateTaskInput,
  TaskDto,
  TaskCategory,
  TaskPriority,
  TaskSeverity,
  TaskVisibility,
  TaskSource,
} from '../tasks/task.service';

import { CreateSignalDto } from './dto/create-signal.dto';

/**
 * Standard error shape (Doc 5 §2.4).
 */
export interface StandardError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Standard result shape (ok / data / error).
 */
export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error: StandardError | null;
}

/**
 * Result payload for SignalIngestService.ingest.
 */
export interface SignalIngestResult {
  organizationId: string;
  source: TaskSource | string;
  /**
   * Full workflow execution details (matched rules + resolved actions).
   */
  workflowExecution: WorkflowExecutionResultData;
  /**
   * Tasks created as a consequence of workflow actions.
   */
  createdTasks: TaskDto[];
}

/**
 * Normalised in-memory representation of a Signal, derived from the
 * public CreateSignalDto or the legacy snake_case DTO.
 */
interface NormalizedSignal {
  organizationId: string;
  externalId?: string;
  caseId?: string;
  source: TaskSource | string;

  type?: string;
  category?: TaskCategory;
  subtype?: string;
  label?: string;

  title: string;
  description: string;

  priority?: TaskPriority | Lowercase<TaskPriority>;
  severity?: TaskSeverity | Lowercase<TaskSeverity>;
  visibility?: TaskVisibility | Lowercase<TaskVisibility>;

  requesterPersonId?: string;
  createdByUserId?: string;
  sourceReference?: string;

  metadata?: Record<string, any>;

  /**
   * Original raw DTO, kept for logging / debugging.
   */
  raw: unknown;
}

/**
 * Legacy DTO shape used in the earlier SignalController implementation
 * (snake_case keys, enum-less source).
 *
 * This is defined here for structural compatibility; the controller's
 * class-based DTO will be assignable to this interface.
 */
interface LegacySignalDto {
  organization_id: string;
  source: 'email' | 'api' | 'manual' | 'sync';
  type?: string;
  title?: string;
  description?: string;
  label?: string;
  created_by_user_id?: string;
  requester_person_id?: string;
  payload?: Record<string, unknown>;
}

type SignalInput = CreateSignalDto | LegacySignalDto;

@Injectable()
export class SignalIngestService {
  private readonly logger = new Logger(SignalIngestService.name);

  constructor(
    private readonly workflowEngine: WorkflowEngineService,
    private readonly taskService: TaskService,
    private readonly logService: LogService,
  ) {}

  /**
   * Core entry point for API / UI / webhook signals.
   *
   * Responsibilities (aligned with Docs 2, 4, 5 and 8):
   *  - Normalise the incoming payload into a canonical Signal shape.
   *  - Build a WorkflowContext from that Signal.
   *  - Execute workflow rules via WorkflowEngineService.
   *  - Apply CREATE_TASK actions by delegating to TaskService.
   *  - Return a standard { ok, data, error } envelope.
   */
  async ingest(dto: SignalInput): Promise<StandardResult<SignalIngestResult>> {
    const normalisedResult = this.normaliseSignal(dto);

    if (!normalisedResult.ok || !normalisedResult.data) {
      return normalisedResult;
    }

    const signal = normalisedResult.data;

    const workflowContext: WorkflowContext = {
      // WorkflowEngineService expects camelCase organizationId + WorkflowEventSource.
      organizationId: signal.organizationId,
      // All non-email signals are treated as coming from the "API" event source.
      source: 'API',
      type: signal.type,
      category: signal.category,
      severity: signal.severity,
      label: signal.label,
      title: signal.title,
      description: signal.description,
      metadata: {
        ...(signal.metadata ?? {}),
        organizationId: signal.organizationId,
        externalId: signal.externalId ?? null,
        caseId: signal.caseId ?? null,
        sourceReference: signal.sourceReference ?? null,
        createdByUserId: signal.createdByUserId ?? null,
        requesterPersonId: signal.requesterPersonId ?? null,
        signalSource: signal.source,
      },
      payload: {
        signal,
        raw: dto,
      },
    };

    let workflowResult: WorkflowEngineResult<WorkflowExecutionResultData>;

    try {
      workflowResult = await this.workflowEngine.executeWorkflow(
        workflowContext,
      );
    } catch (err: unknown) {
      const error: StandardError = {
        code: 'SIGNAL_WORKFLOW_EXECUTION_ERROR',
        message: 'Failed to execute workflow for signal.',
        details: {
          organizationId: signal.organizationId,
          error:
            err instanceof Error ? err.message : (err as string | unknown),
        },
      };

      await this.logService.logEvent({
        category: 'WORKFLOW',
        logLevel: 'ERROR',
        message: error.message,
        identifier: FN_SIGNAL_INGEST,
        metadata: {
          functionId: FN_SIGNAL_INGEST,
          stage: 'workflow_execute_throw',
          organizationId: signal.organizationId,
          source: signal.source,
          error: error.details,
        },
      });

      this.logger.error(
        `Workflow execution failed for signal (org=${signal.organizationId})`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );

      return {
        ok: false,
        data: null,
        error,
      };
    }

    if (!workflowResult.ok || !workflowResult.data) {
      const error: StandardError = {
        code:
          workflowResult.error?.code ?? 'SIGNAL_WORKFLOW_EXECUTION_FAILED',
        message:
          workflowResult.error?.message ??
          'Workflow execution failed for signal.',
        details: workflowResult.error?.details,
      };

      await this.logService.logEvent({
        category: 'WORKFLOW',
        logLevel: 'ERROR',
        message: error.message,
        identifier: FN_SIGNAL_INGEST,
        metadata: {
          functionId: FN_SIGNAL_INGEST,
          stage: 'workflow_execute_result_error',
          organizationId: signal.organizationId,
          source: signal.source,
          error: error.details,
        },
      });

      return {
        ok: false,
        data: null,
        error,
      };
    }

    const execution = workflowResult.data;

    const createdTasks: TaskDto[] = [];
    const failedActions: StandardError[] = [];

    // Apply CREATE_TASK actions only; other action types (ROUTE, ESCALATE, NOTIFY)
    // are intentionally left for future extensions or domain-specific services.
    for (const resolved of execution.actions) {
      if (resolved.action.type !== 'CREATE_TASK') {
        continue;
      }

      const result = await this.applyCreateTaskAction(signal, resolved);

      if (!result.ok || !result.data) {
        failedActions.push(
          result.error ?? {
            code: 'SIGNAL_CREATE_TASK_FAILED',
            message: 'Task creation failed for signal (no error payload).',
          },
        );
        continue;
      }

      createdTasks.push(result.data);
    }

    if (failedActions.length > 0) {
      await this.logService.logEvent({
        category: 'TASK',
        logLevel: 'ERROR',
        message:
          'One or more CREATE_TASK actions failed while ingesting signal.',
        identifier: FN_SIGNAL_INGEST,
        metadata: {
          functionId: FN_SIGNAL_INGEST,
          organizationId: signal.organizationId,
          source: signal.source,
          failedActions,
        },
      });
    }

    await this.logService.logEvent({
      category: 'WORKFLOW',
      logLevel: 'INFO',
      message: 'Signal ingested via API / UI.',
      identifier: FN_SIGNAL_INGEST,
      metadata: {
        functionId: FN_SIGNAL_INGEST,
        organizationId: signal.organizationId,
        source: signal.source,
        workflowId: execution.workflowId,
        matchedRuleIds: execution.matchedRules.map((r) => r.id),
        createdTaskIds: createdTasks.map((t) => t.taskId ?? t.task_id),
      },
    });

    return {
      ok: true,
      data: {
        organizationId: signal.organizationId,
        source: signal.source,
        workflowExecution: execution,
        createdTasks,
      },
      error: null,
    };
  }

  /**
   * Normalise either the new CreateSignalDto or the legacy snake_case DTO
   * into a single internal NormalizedSignal shape.
   */
  private normaliseSignal(
    dto: SignalInput,
  ): StandardResult<NormalizedSignal> {
    try {
      const isLegacy =
        (dto as LegacySignalDto).organization_id !== undefined;

      if (isLegacy) {
        const legacy = dto as LegacySignalDto;

        if (!legacy.organization_id || !legacy.source) {
          return {
            ok: false,
            data: null,
            error: {
              code: 'SIGNAL_VALIDATION_ERROR',
              message:
                'organization_id and source are required to ingest a signal.',
              details: { dto },
            },
          };
        }

        const title =
          legacy.title && legacy.title.trim()
            ? legacy.title.trim()
            : `Signal from ${legacy.source}`;

        const description =
          legacy.description && legacy.description.trim()
            ? legacy.description.trim()
            : title;

        const normalised: NormalizedSignal = {
          organizationId: legacy.organization_id,
          source: legacy.source,
          type: legacy.type,
          title,
          description,
          label: legacy.label,
          createdByUserId: legacy.created_by_user_id,
          requesterPersonId: legacy.requester_person_id,
          metadata: legacy.payload ? { ...legacy.payload } : undefined,
          raw: dto,
        };

        return {
          ok: true,
          data: normalised,
          error: null,
        };
      }

      const modern = dto as CreateSignalDto;

      if (
        !modern.organizationId ||
        !modern.source ||
        !modern.title ||
        !modern.description
      ) {
        return {
          ok: false,
          data: null,
          error: {
            code: 'SIGNAL_VALIDATION_ERROR',
            message:
              'organizationId, source, title and description are required to ingest a signal.',
            details: { dto },
          },
        };
      }

      const normalised: NormalizedSignal = {
        organizationId: modern.organizationId,
        externalId: modern.externalId,
        caseId: modern.caseId,
        source: modern.source as TaskSource | string,
        type: modern.type,
        category: modern.category as TaskCategory | undefined,
        subtype: modern.subtype,
        label: modern.label,
        title: modern.title,
        description: modern.description,
        priority: modern.priority as
          | TaskPriority
          | Lowercase<TaskPriority>
          | undefined,
        severity: modern.severity as
          | TaskSeverity
          | Lowercase<TaskSeverity>
          | undefined,
        visibility: modern.visibility as
          | TaskVisibility
          | Lowercase<TaskVisibility>
          | undefined,
        requesterPersonId: modern.requesterPersonId,
        createdByUserId: modern.createdByUserId,
        sourceReference: modern.sourceReference,
        metadata: modern.metadata ? { ...modern.metadata } : undefined,
        raw: dto,
      };

      return {
        ok: true,
        data: normalised,
        error: null,
      };
    } catch (err: unknown) {
      const error: StandardError = {
        code: 'SIGNAL_NORMALISATION_ERROR',
        message: 'Failed to normalise signal payload.',
        details: {
          error:
            err instanceof Error ? err.message : (err as string | unknown),
        },
      };

      this.logger.error(
        `Failed to normalise signal payload: ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );

      return {
        ok: false,
        data: null,
        error,
      };
    }
  }

  /**
   * Apply a single CREATE_TASK workflow action by building a CreateTaskInput
   * from the normalised Signal plus action.set overrides, then delegating
   * to TaskService.
   */
  private async applyCreateTaskAction(
    signal: NormalizedSignal,
    resolved: ResolvedWorkflowAction,
  ): Promise<StandardResult<TaskDto>> {
    const action = resolved.action;
    const set = (action.set ?? {}) as Record<string, unknown>;

    const mergeString = (
      override: unknown,
      base: string | undefined | null,
      fallback: string,
    ): string =>
      typeof override === 'string' && override.trim()
        ? override.trim()
        : base && base.trim()
        ? base.trim()
        : fallback;

    const mergeOptionalString = (
      override: unknown,
      base?: string | null,
    ): string | null =>
      typeof override === 'string' && override.trim()
        ? override.trim()
        : base && base.trim()
        ? base.trim()
        : null;

    const mergedCategory =
      (set.category as TaskCategory | undefined) ??
      (signal.category as TaskCategory | undefined) ??
      ('request' as TaskCategory);

    const mergedPriority =
      (set.priority as TaskPriority | Lowercase<TaskPriority> | undefined) ??
      signal.priority ??
      ('MEDIUM' as TaskPriority);

    const mergedSeverity =
      (set.severity as TaskSeverity | Lowercase<TaskSeverity> | undefined) ??
      signal.severity ??
      ('MINOR' as TaskSeverity);

    const mergedVisibility =
      (set.visibility as TaskVisibility | Lowercase<TaskVisibility> | undefined) ??
      signal.visibility ??
      ('INTERNAL' as TaskVisibility);

    const mergedSource =
      (set.source as TaskSource | string | undefined) ??
      signal.source ??
      'api';

    const mergedLabel = mergeString(
      set.label,
      signal.label,
      '000.00.Unclassified',
    );

    const createInput: CreateTaskInput = {
      organizationId: signal.organizationId,
      type: mergeString(set.type, signal.type, 'generic'),
      category: mergedCategory,
      title: mergeString(set.title, signal.title, 'Signal'),
      description: mergeString(
        set.description,
        signal.description,
        'Signal ingested via API/UI.',
      ),
      priority: mergedPriority,
      severity: mergedSeverity,
      visibility: mergedVisibility,
      label: mergedLabel,
      source: mergedSource as TaskSource,

      caseId:
        (set.caseId as string | undefined) ??
        signal.caseId ??
        null,
      subtype:
        mergeOptionalString(set.subtype, signal.subtype) ?? null,
      createdByUserId:
        (set.createdByUserId as string | undefined) ??
        signal.createdByUserId ??
        null,
      requesterPersonId:
        (set.requesterPersonId as string | undefined) ??
        signal.requesterPersonId ??
        null,
      ownerRoleId:
        (set.ownerRoleId as string | undefined) ?? null,
      ownerUserId:
        (set.ownerUserId as string | undefined) ?? null,
      assigneeRole:
        (set.assigneeRole as string | undefined) ??
        (action.to_role as string | undefined) ??
        null,

      dueAt: (set.dueAt as string | Date | undefined) ?? null,

      metadata: this.buildTaskMetadataFromSignal(signal, resolved),

      reactivitySeconds:
        (set.reactivitySeconds as number | undefined) ?? null,
      reactivityTimeIso:
        (set.reactivityTimeIso as string | undefined) ?? null,
      reactivityDeadlineAt:
        (set.reactivityDeadlineAt as string | Date | undefined) ?? null,
    };

    try {
      const result = await this.taskService.createTask(createInput);

      if (!result.ok || !result.data) {
        return {
          ok: false,
          data: null,
          error:
            (result.error as StandardError | null) ?? {
              code: 'SIGNAL_CREATE_TASK_FAILED',
              message: 'TaskService.createTask returned error for signal.',
              details: { createInput },
            },
        };
      }

      return {
        ok: true,
        data: result.data,
        error: null,
      };
    } catch (err: unknown) {
      const error: StandardError = {
        code: 'SIGNAL_CREATE_TASK_ERROR',
        message: 'Unhandled error while creating task from signal.',
        details: {
          organizationId: signal.organizationId,
          error:
            err instanceof Error ? err.message : (err as string | unknown),
        },
      };

      this.logger.error(
        `Unhandled error while creating task from signal (org=${signal.organizationId})`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );

      return {
        ok: false,
        data: null,
        error,
      };
    }
  }

  /**
   * Build the metadata object passed to TaskService.createTask, merging
   * existing signal metadata with workflow/action-level context.
   */
  private buildTaskMetadataFromSignal(
    signal: NormalizedSignal,
    resolved: ResolvedWorkflowAction,
  ): Record<string, any> {
    const baseMetadata: Record<string, any> =
      signal.metadata && typeof signal.metadata === 'object'
        ? { ...signal.metadata }
        : {};

    const workflowMeta: Record<string, any> = {
      workflowId: resolved.workflowId,
      ruleId: resolved.ruleId,
      actionId: resolved.id,
      actionType: resolved.action.type,
      origin: 'signal_ingest',
    };

    const signalMeta: Record<string, any> = {
      organizationId: signal.organizationId,
      externalId: signal.externalId ?? null,
      caseId: signal.caseId ?? null,
      source: signal.source,
      sourceReference: signal.sourceReference ?? null,
      createdByUserId: signal.createdByUserId ?? null,
      requesterPersonId: signal.requesterPersonId ?? null,
    };

    return {
      ...baseMetadata,
      workflow: {
        ...(baseMetadata.workflow ?? {}),
        ...workflowMeta,
      },
      signal: {
        ...(baseMetadata.signal ?? {}),
        ...signalMeta,
      },
    };
  }
}
