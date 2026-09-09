// apps/api/src/orgo/core/email/email-router.service.ts

import { Injectable, Logger } from '@nestjs/common';

import {
  WorkflowEngineService,
  WorkflowContext,
  WorkflowExecutionResultData,
  WorkflowEngineResult,
  ResolvedWorkflowAction,
  WorkflowAction,
} from '../workflow/workflow-engine.service';

import {
  TaskService,
  TaskDto,
  CreateTaskInput,
  TaskCategory,
  TaskPriority,
  TaskSeverity,
  TaskVisibility,
  TaskSource,
  AssignTaskInput,
  EscalateTaskInput,
} from '../tasks/task.service';

import {
  NotificationService,
  TaskNotificationEventType,
} from '../notifications/notification.service';

import { PersistenceService } from '../persistence/persistence.service';
import { LogService } from '../logging/log.service';
import { TaskEventsService } from '../tasks/task-events.service';
import { FN_EMAIL_ROUTE_TO_WORKFLOW } from '../functional-ids';

/**
 * Standard error / result envelopes (aligned with Docs 2, 4, 5).
 */
export interface OrgoError<TDetails = unknown> {
  code: string;
  message: string;
  details?: TDetails;
}

export interface OrgoResult<TData, TDetails = unknown> {
  ok: boolean;
  data: TData | null;
  error: OrgoError<TDetails> | null;
}

function ok<T>(data: T): OrgoResult<T> {
  return {
    ok: true,
    data,
    error: null,
  };
}

function err<TData = unknown, TDetails = unknown>(
  code: string,
  message: string,
  details?: TDetails,
): OrgoResult<TData, TDetails> {
  return {
    ok: false,
    data: null,
    error: {
      code,
      message,
      details,
    },
  };
}

/**
 * Event types for email_processing_events (Doc 1 / Doc 5).
 */
export type EmailProcessingEventType =
  | 'parsed'
  | 'classification_succeeded'
  | 'classification_failed'
  | 'task_created'
  | 'linked_to_existing_task'
  | 'dropped';

/**
 * Logical EMAIL_MESSAGE envelope used by the email gateway and workflows.
 * This mirrors the email_messages + email_threads logical view in Doc 5.
 */
export interface EmailMessageEnvelope {
  id: string;
  organization_id: string;
  email_account_config_id: string | null;
  thread_id: string | null;
  message_id_header: string | null;
  direction: 'inbound' | 'outbound';
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string;
  received_at: Date | null;
  sent_at: Date | null;
  raw_headers: Record<string, unknown>;
  text_body: string | null;
  html_body: string | null;
  related_task_id: string | null;
  sensitivity: 'normal' | 'sensitive' | 'highly_sensitive';
  parsed_metadata: Record<string, unknown>;
  attachments_meta: Array<{
    attachment_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    download_url: string | null;
    checksum: string | null;
  }>;
  security_flags: Record<string, unknown>;
}

/**
 * Options for routing an email into workflows.
 */
export interface EmailRoutingOptions {
  /**
   * If true, run workflow classification but do not create/route tasks
   * or persist any side effects besides logs.
   */
  dryRun?: boolean;

  /**
   * Optional overrides merged into the WorkflowContext before execution.
   * This is primarily intended for tests and advanced integrations.
   */
  contextOverrides?: Partial<WorkflowContext>;

  /**
   * Optional ingestion batch id so processing events can be correlated
   * with the original mailbox poll.
   */
  ingestionBatchId?: string | null;
}

interface ApplyActionsResult {
  createdTasks: TaskDto[];
  /**
   * The task that this email ended up linked to (either an existing
   * primary task on the thread or the first task created by workflow).
   */
  linkedTaskId: string | null;
  notificationsSent: number;
}

/**
 * Result payload for EmailRouterService.routeToWorkflow.
 *
 * Aligned with the shape used by SignalIngestService (Docs 2, 4, 5).
 */
export interface EmailRoutingResult {
  emailId: string;
  organizationId: string;
  /**
   * Full workflow execution details (matched rules + resolved actions).
   * May be null if the email was short-circuited to an existing task.
   */
  workflowExecution: WorkflowExecutionResultData | null;
  /**
   * Tasks created as a consequence of workflow actions.
   */
  createdTasks: TaskDto[];
  /**
   * The task ultimately associated with this email (if any).
   */
  linkedTaskId: string | null;
  /**
   * Number of notifications sent as a consequence of workflow actions.
   */
  notificationsSent: number;
}

/**
 * EmailRouterService
 *
 * Bridges parsed emails into the workflow engine and Tasks:
 *  - Builds a WorkflowContext from EMAIL_MESSAGE envelopes.
 *  - Executes workflow rules (including email_patterns / domain mappings).
 *  - Decides whether to create a new Task or link to an existing one.
 *  - Logs classification success/failure and processing events.
 *  - Applies ROUTE / ESCALATE / NOTIFY actions via TaskService / NotificationService.
 */
@Injectable()
export class EmailRouterService {
  private readonly logger = new Logger(EmailRouterService.name);

  constructor(
    private readonly workflowEngine: WorkflowEngineService,
    private readonly taskService: TaskService,
    private readonly notificationService: NotificationService,
    private readonly persistence: PersistenceService,
    private readonly logService: LogService,
    private readonly taskEvents: TaskEventsService,
  ) {}

  /**
   * Core entry point for routing a parsed email into workflows.
   *
   * Responsibilities (aligned with Docs 2, 4, 5 and 8):
   *  - Build a WorkflowContext from the EMAIL_MESSAGE envelope.
   *  - Execute workflow rules via WorkflowEngineService.
   *  - Decide whether to create a new Task or link to an existing one.
   *  - Record email_processing_events for classification + task outcomes.
   *  - Return a standard { ok, data, error } envelope.
   */
  async routeToWorkflow(
    email: EmailMessageEnvelope,
    options: EmailRoutingOptions = {},
  ): Promise<OrgoResult<EmailRoutingResult>> {
    const { dryRun = false, contextOverrides = {}, ingestionBatchId = null } =
      options;

    if (!email) {
      return err<EmailRoutingResult>(
        'EMAIL_ROUTING_INVALID_INPUT',
        'Email payload is required.',
        { stage: 'validate_input' },
      );
    }

    if (!email.organization_id) {
      return err<EmailRoutingResult>(
        'EMAIL_ROUTING_INVALID_INPUT',
        'Email.organization_id is required for routing.',
        {
          stage: 'validate_input',
          emailId: email.id,
        },
      );
    }

    // 1. If the email is already explicitly linked to a Task, short‑circuit.
    if (email.related_task_id) {
      await this.recordProcessingEvent(
        email,
        'linked_to_existing_task',
        {
          taskId: email.related_task_id,
          reason: 'email.related_task_id already set',
        },
        ingestionBatchId,
      );

      await this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'INFO',
        message:
          'Email already linked to existing task; skipping workflow execution.',
        identifier: FN_EMAIL_ROUTE_TO_WORKFLOW,
        metadata: {
          functionId: FN_EMAIL_ROUTE_TO_WORKFLOW,
          stage: 'prelinked_short_circuit',
          organizationId: email.organization_id,
          emailMessageId: email.id,
          taskId: email.related_task_id,
        },
      });

      return ok<EmailRoutingResult>({
        emailId: email.id,
        organizationId: email.organization_id,
        workflowExecution: null,
        createdTasks: [],
        linkedTaskId: email.related_task_id,
        notificationsSent: 0,
      });
    }

    // 2. Thread‑level linking: if this thread already has a primary task,
    //    attach the email to that task and avoid re‑classifying.
    const threadLinkedTaskId = await this.tryLinkToExistingTaskByThread(
      email,
      ingestionBatchId,
    );

    if (threadLinkedTaskId) {
      return ok<EmailRoutingResult>({
        emailId: email.id,
        organizationId: email.organization_id,
        workflowExecution: null,
        createdTasks: [],
        linkedTaskId: threadLinkedTaskId,
        notificationsSent: 0,
      });
    }

    // 3. Build workflow context from the email envelope.
    const workflowContext: WorkflowContext = {
      // WorkflowEngineService expects camelCase organizationId + WorkflowEventSource.
      organizationId: email.organization_id,
      source: 'EMAIL',
      type:
        (email.parsed_metadata?.['type'] as string | undefined) ?? 'generic',
      category:
        (email.parsed_metadata?.['category'] as TaskCategory | undefined) ??
        undefined,
      severity:
        (email.parsed_metadata?.['severity'] as
          | TaskSeverity
          | Lowercase<TaskSeverity>
          | undefined) ?? undefined,
      label: email.parsed_metadata?.['label'] as string | undefined,
      title: email.subject,
      description:
        (email.parsed_metadata?.['summary'] as string | undefined) ??
        email.text_body ??
        email.html_body ??
        '',
      emailSubject: email.subject,
      emailTextBody: email.text_body ?? undefined,
      metadata: {
        ...(email.parsed_metadata ?? {}),
        organizationId: email.organization_id,
        emailMessageId: email.id,
        emailThreadId: email.thread_id ?? null,
        emailDirection: email.direction,
        emailFromAddress: email.from_address,
        emailToAddresses: email.to_addresses,
        emailCcAddresses: email.cc_addresses,
        emailBccAddresses: email.bcc_addresses,
        emailAccountConfigId: email.email_account_config_id ?? null,
        sensitivity: email.sensitivity,
      },
      payload: {
        email,
      },
      ...contextOverrides,
    };

    let workflowResult: WorkflowEngineResult<WorkflowExecutionResultData>;

    try {
      workflowResult = await this.workflowEngine.executeWorkflow(
        workflowContext,
      );
    } catch (err: unknown) {
      const error: OrgoError = {
        code: 'EMAIL_WORKFLOW_EXECUTION_ERROR',
        message: 'Failed to execute workflow for email.',
        details: {
          organizationId: email.organization_id,
          emailId: email.id,
          error: err instanceof Error ? err.message : String(err),
        },
      };

      await this.recordProcessingEvent(
        email,
        'classification_failed',
        error.details as Record<string, unknown>,
        ingestionBatchId,
      );

      await this.logService.logEvent({
        category: 'WORKFLOW',
        logLevel: 'ERROR',
        message: error.message,
        identifier: FN_EMAIL_ROUTE_TO_WORKFLOW,
        metadata: {
          functionId: FN_EMAIL_ROUTE_TO_WORKFLOW,
          stage: 'workflow_execute_throw',
          organizationId: email.organization_id,
          emailMessageId: email.id,
          error: error.details,
        },
      });

      this.logger.error(
        `Workflow execution failed for email ${email.id} (org=${email.organization_id})`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );

      return {
        ok: false,
        data: null,
        error,
      };
    }

    if (!workflowResult.ok || !workflowResult.data) {
      const error: OrgoError = {
        code:
          workflowResult.error?.code ?? 'EMAIL_WORKFLOW_EXECUTION_FAILED',
        message:
          workflowResult.error?.message ??
          'Workflow execution failed for email.',
        details: {
          organizationId: email.organization_id,
          emailId: email.id,
          error: workflowResult.error?.details,
        },
      };

      await this.recordProcessingEvent(
        email,
        'classification_failed',
        error.details as Record<string, unknown>,
        ingestionBatchId,
      );

      await this.logService.logEvent({
        category: 'WORKFLOW',
        logLevel: 'ERROR',
        message: error.message,
        identifier: FN_EMAIL_ROUTE_TO_WORKFLOW,
        metadata: {
          functionId: FN_EMAIL_ROUTE_TO_WORKFLOW,
          stage: 'workflow_execute_result_error',
          organizationId: email.organization_id,
          emailMessageId: email.id,
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

    await this.recordProcessingEvent(
      email,
      'classification_succeeded',
      {
        workflowId: execution.workflowId,
        matchedRuleIds: execution.matchedRules.map((r) => r.id),
        label: execution.context.label ?? null,
        type: execution.context.type ?? null,
        category: execution.context.category ?? null,
        severity: execution.context.severity ?? null,
      },
      ingestionBatchId,
    );

    await this.logService.logEvent({
      category: 'WORKFLOW',
      logLevel: 'INFO',
      message: 'Email classified via workflow engine.',
      identifier: FN_EMAIL_ROUTE_TO_WORKFLOW,
      metadata: {
        functionId: FN_EMAIL_ROUTE_TO_WORKFLOW,
        organizationId: email.organization_id,
        emailMessageId: email.id,
        workflowId: execution.workflowId,
        matchedRuleIds: execution.matchedRules.map((r) => r.id),
      },
    });

    if (dryRun) {
      return ok<EmailRoutingResult>({
        emailId: email.id,
        organizationId: email.organization_id,
        workflowExecution: execution,
        createdTasks: [],
        linkedTaskId: null,
        notificationsSent: 0,
      });
    }

    const applyResult = await this.applyActions(
      email,
      execution,
      ingestionBatchId,
    );

    if (!applyResult.ok || !applyResult.data) {
      return {
        ok: false,
        data: null,
        error:
          applyResult.error ?? {
            code: 'EMAIL_ROUTING_APPLY_FAILED',
            message:
              'Failed to apply workflow actions for email (no error payload).',
          },
      };
    }

    const { createdTasks, linkedTaskId, notificationsSent } =
      applyResult.data;

    if (createdTasks.length === 0 && !linkedTaskId) {
      await this.recordProcessingEvent(
        email,
        'dropped',
        {
          reason:
            'No actionable workflow actions (no tasks created or linked).',
          workflowId: execution.workflowId,
        },
        ingestionBatchId,
      );
    }

    return ok<EmailRoutingResult>({
      emailId: email.id,
      organizationId: email.organization_id,
      workflowExecution: execution,
      createdTasks,
      linkedTaskId,
      notificationsSent,
    });
  }

  /**
   * Apply resolved workflow actions for an email.
   *
   * Currently supports:
   *  - CREATE_TASK → TaskService.createTask + email/task linking.
   *  - ROUTE       → TaskService.assignTask.
   *  - ESCALATE    → TaskService.escalateTask.
   *  - NOTIFY      → NotificationService.sendTaskNotification.
   */
  private async applyActions(
    email: EmailMessageEnvelope,
    execution: WorkflowExecutionResultData,
    ingestionBatchId: string | null,
  ): Promise<OrgoResult<ApplyActionsResult>> {
    const createdTasks: TaskDto[] = [];
    let linkedTaskId: string | null = null;
    let notificationsSent = 0;

    for (const resolved of execution.actions) {
      const action = resolved.action as WorkflowAction;

      try {
        switch (action.type) {
          case 'CREATE_TASK': {
            const task = await this.handleCreateTaskAction(
              email,
              resolved,
              ingestionBatchId,
            );

            if (task) {
              createdTasks.push(task);
              if (!linkedTaskId) {
                linkedTaskId = task.taskId ?? null;
              }
            }
            break;
          }

          case 'ROUTE': {
            await this.handleRouteAction(email, action);
            break;
          }

          case 'ESCALATE': {
            await this.handleEscalateAction(email, action);
            break;
          }

          case 'NOTIFY': {
            const sent = await this.handleNotifyAction(email, action);
            notificationsSent += sent;
            break;
          }

          default: {
            this.logger.debug(
              `Ignoring unsupported workflow action type "${action.type}" for email ${email.id}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed to apply action "${action.type}" for email ${email.id}`,
          err instanceof Error ? err.stack ?? err.message : String(err),
        );

        return err<ApplyActionsResult>(
          'EMAIL_ROUTING_APPLY_FAILED',
          'Failed to apply workflow action.',
          {
            emailId: email.id,
            actionType: action.type,
          },
        );
      }
    }

    return ok<ApplyActionsResult>({
      createdTasks,
      linkedTaskId,
      notificationsSent,
    });
  }

  /**
   * If the email belongs to a thread that already has a primary task,
   * link the email to that task and record a processing event.
   */
  private async tryLinkToExistingTaskByThread(
    email: EmailMessageEnvelope,
    ingestionBatchId: string | null,
  ): Promise<string | null> {
    if (!email.thread_id) {
      return null;
    }

    try {
      const threadResult = await this.persistence.fetchRecords<any>(
        'email_threads',
        {
          id: email.thread_id,
          organization_id: email.organization_id,
        },
      );

      if (!threadResult.ok || !threadResult.data || !threadResult.data[0]) {
        return null;
      }

      const thread = threadResult.data[0] as {
        id: string;
        primary_task_id: string | null;
      };

      if (!thread.primary_task_id) {
        return null;
      }

      const taskId = thread.primary_task_id;

      await this.linkEmailToExistingTask(
        email,
        taskId,
        ingestionBatchId,
        'thread_primary_task_id',
      );

      return taskId;
    } catch (err) {
      this.logger.error(
        `Failed to check thread-based linkage for email ${email.id}`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );
      // Best-effort only; do not block routing on thread lookup.
      return null;
    }
  }

  /**
   * Persist the relationship between an email and a task in email_messages /
   * email_threads tables. Best-effort: failures are logged but do not reject.
   */
  private async persistEmailTaskLink(
    email: EmailMessageEnvelope,
    taskId: string,
  ): Promise<void> {
    try {
      await this.persistence.updateRecord(
        'email_messages',
        { id: email.id },
        {
          related_task_id: taskId,
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to update email_messages.related_task_id for email ${email.id}`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );
    }

    if (!email.thread_id) {
      return;
    }

    try {
      const threadResult = await this.persistence.fetchRecords<any>(
        'email_threads',
        {
          id: email.thread_id,
          organization_id: email.organization_id,
        },
      );

      const thread =
        threadResult.ok && threadResult.data
          ? (threadResult.data[0] as {
              id: string;
              primary_task_id: string | null;
            } | null)
          : null;

      if (thread && !thread.primary_task_id) {
        await this.persistence.updateRecord(
          'email_threads',
          { id: email.thread_id },
          { primary_task_id: taskId },
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to update email_threads.primary_task_id for email ${email.id}`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );
    }
  }

  private async linkEmailToExistingTask(
    email: EmailMessageEnvelope,
    taskId: string,
    ingestionBatchId: string | null,
    reason: string,
  ): Promise<void> {
    await this.persistEmailTaskLink(email, taskId);

    await this.recordProcessingEvent(
      email,
      'linked_to_existing_task',
      {
        taskId,
        reason,
      },
      ingestionBatchId,
    );

    const eventResult = await this.taskEvents.recordEmailLinked({
      taskId,
      organizationId: email.organization_id,
      origin: 'email',
      emailMessageId: email.id,
    });

    if (!eventResult.ok) {
      this.logger.error(
        `Failed to record email_linked TaskEvent for email ${email.id} and task ${taskId}`,
        JSON.stringify(eventResult.error),
      );
    }
  }

  /**
   * Append a row to email_processing_events. Failures are logged but do not
   * block the main routing flow.
   */
  private async recordProcessingEvent(
    email: EmailMessageEnvelope,
    eventType: EmailProcessingEventType,
    details: Record<string, unknown> | null,
    ingestionBatchId: string | null,
  ): Promise<void> {
    try {
      await this.persistence.insertRecord('email_processing_events', {
        organization_id: email.organization_id,
        email_message_id: email.id,
        ingestion_batch_id: ingestionBatchId ?? null,
        event_type: eventType,
        details: details ?? null,
        occurred_at: new Date(),
        created_at: new Date(),
      });
    } catch (err) {
      this.logger.error(
        `Failed to record email_processing_event (${eventType}) for email ${email.id}`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );
    }
  }

  /**
   * Build the metadata object passed to TaskService.createTask, merging
   * existing email metadata with workflow/action-level context.
   */
  private buildTaskMetadataFromEmail(
    email: EmailMessageEnvelope,
    resolved: ResolvedWorkflowAction,
  ): Record<string, any> {
    const baseMetadata: Record<string, any> =
      email.parsed_metadata && typeof email.parsed_metadata === 'object'
        ? { ...email.parsed_metadata }
        : {};

    const workflowMeta: Record<string, any> = {
      workflowId: resolved.workflowId,
      ruleId: resolved.ruleId,
      actionId: resolved.id,
      actionType: resolved.action.type,
      origin: 'email_gateway',
    };

    const emailMeta: Record<string, any> = {
      organizationId: email.organization_id,
      emailMessageId: email.id,
      emailThreadId: email.thread_id ?? null,
      emailDirection: email.direction,
      emailFromAddress: email.from_address,
      emailToAddresses: email.to_addresses,
      emailCcAddresses: email.cc_addresses,
      emailBccAddresses: email.bcc_addresses,
      messageIdHeader: email.message_id_header,
      receivedAt: email.received_at ?? null,
      sentAt: email.sent_at ?? null,
      sensitivity: email.sensitivity,
    };

    return {
      ...baseMetadata,
      workflow: {
        ...(baseMetadata.workflow ?? {}),
        ...workflowMeta,
      },
      email: {
        ...(baseMetadata.email ?? {}),
        ...emailMeta,
      },
    };
  }

  /**
   * Apply a single CREATE_TASK workflow action by building a CreateTaskInput
   * from the email plus action.set overrides, then delegating to TaskService.
   */
  private async handleCreateTaskAction(
    email: EmailMessageEnvelope,
    resolved: ResolvedWorkflowAction,
    ingestionBatchId: string | null,
  ): Promise<TaskDto | null> {
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
      (set.category as TaskCategory | undefined) ?? ('request' as TaskCategory);

    const mergedPriority =
      (set.priority as TaskPriority | Lowercase<TaskPriority> | undefined) ??
      ('MEDIUM' as TaskPriority);

    const mergedSeverity =
      (set.severity as TaskSeverity | Lowercase<TaskSeverity> | undefined) ??
      ('MINOR' as TaskSeverity);

    const mergedVisibility =
      (set.visibility as TaskVisibility | Lowercase<TaskVisibility> | undefined) ??
      ('INTERNAL' as TaskVisibility);

    const mergedSource =
      (set.source as TaskSource | string | undefined) ?? 'email';

    const mergedLabel = mergeString(
      set.label,
      email.parsed_metadata?.['label'] as string | undefined,
      '000.00.Unclassified',
    );

    const mergedDescription = mergeString(
      set.description,
      email.text_body ?? email.html_body,
      'Email routed via workflow.',
    );

    const createInput: CreateTaskInput = {
      organizationId: email.organization_id,
      type: mergeString(
        set.type,
        email.parsed_metadata?.['type'] as string | undefined,
        'generic',
      ),
      category: mergedCategory,
      title: mergeString(
        set.title,
        email.subject,
        email.subject || 'Email',
      ),
      description: mergedDescription,
      priority: mergedPriority,
      severity: mergedSeverity,
      visibility: mergedVisibility,
      label: mergedLabel,
      source: mergedSource as TaskSource,

      caseId:
        (set.caseId as string | undefined) ??
        (email.parsed_metadata?.['case_id'] as string | undefined) ??
        null,
      subtype:
        mergeOptionalString(
          set.subtype,
          email.parsed_metadata?.['subtype'] as string | undefined,
        ) ?? null,
      createdByUserId:
        (set.createdByUserId as string | undefined) ??
        (email.parsed_metadata?.['created_by_user_id'] as string | undefined) ??
        null,
      requesterPersonId:
        (set.requesterPersonId as string | undefined) ??
        (email.parsed_metadata?.['requester_person_id'] as string | undefined) ??
        null,
      ownerRoleId: (set.ownerRoleId as string | undefined) ?? null,
      ownerUserId: (set.ownerUserId as string | undefined) ?? null,
      assigneeRole:
        (set.assigneeRole as string | undefined) ??
        (action.to_role as string | undefined) ??
        null,
      dueAt: (set.dueAt as string | Date | undefined) ?? null,

      metadata: this.buildTaskMetadataFromEmail(email, resolved),

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
        this.logger.error(
          `TaskService.createTask returned error for email ${email.id}`,
          JSON.stringify(result.error),
        );

        return null;
      }

      const task = result.data;
      const taskId = task.taskId ?? (task as any).id;

      if (!taskId) {
        this.logger.warn(
          'TaskService.createTask succeeded but returned task without taskId / id; task will not be linked to email.',
        );
        return task;
      }

      await this.recordProcessingEvent(
        email,
        'task_created',
        {
          taskId,
          workflowId: resolved.workflowId,
          ruleId: resolved.ruleId,
          actionId: resolved.id,
          actionType: resolved.action.type,
        },
        ingestionBatchId,
      );

      await this.persistEmailTaskLink(email, taskId);

      const eventResult = await this.taskEvents.recordEmailLinked({
        taskId,
        organizationId: email.organization_id,
        origin: 'email',
        emailMessageId: email.id,
      });

      if (!eventResult.ok) {
        this.logger.error(
          `Failed to record email_linked TaskEvent for email ${email.id} and task ${taskId}`,
          JSON.stringify(eventResult.error),
        );
      }

      return task;
    } catch (err) {
      this.logger.error(
        `Unhandled error while creating task from email ${email.id}`,
        err instanceof Error ? err.stack ?? err.message : String(err),
      );

      return null;
    }
  }

  private async handleRouteAction(
    email: EmailMessageEnvelope,
    action: WorkflowAction,
  ): Promise<void> {
    const payload = (action.payload ?? {}) as {
      taskId?: string;
      task_id?: string;
      assigneeRole?: string;
      assignee_role?: string;
      actorUserId?: string;
      actor_user_id?: string;
      assigneeUserId?: string;
      assignee_user_id?: string;
      [key: string]: unknown;
    };

    const taskId =
      (payload.taskId as string | undefined) ??
      (payload.task_id as string | undefined);

    if (!taskId) {
      this.logger.warn(
        'ROUTE action missing taskId/task_id; cannot perform routing.',
      );
      return;
    }

    const input: AssignTaskInput = {
      organizationId: email.organization_id,
      taskId,
      assigneeRole:
        (payload.assigneeRole as string | undefined) ??
        (payload.assignee_role as string | undefined) ??
        null,
      assigneeUserId:
        (payload.assigneeUserId as string | undefined) ??
        (payload.assignee_user_id as string | undefined) ??
        null,
      actorUserId:
        (payload.actorUserId as string | undefined) ??
        (payload.actor_user_id as string | undefined) ??
        null,
    };

    const result = await this.taskService.assignTask(input);

    if (!result.ok) {
      this.logger.error(
        `TaskService.assignTask returned error for email ${email.id} and task ${taskId}`,
        JSON.stringify(result.error),
      );
    }
  }

  private async handleEscalateAction(
    email: EmailMessageEnvelope,
    action: WorkflowAction,
  ): Promise<void> {
    const payload = (action.payload ?? {}) as {
      taskId?: string;
      task_id?: string;
      reason?: string;
      actorUserId?: string;
      actor_user_id?: string;
      [key: string]: unknown;
    };

    const taskId =
      (payload.taskId as string | undefined) ??
      (payload.task_id as string | undefined);

    if (!taskId) {
      this.logger.warn(
        'ESCALATE action missing taskId/task_id; cannot perform escalation.',
      );
      return;
    }

    const input: EscalateTaskInput = {
      organizationId: email.organization_id,
      taskId,
      reason:
        (payload.reason as string | undefined) ??
        'Escalated via email workflow.',
      actorUserId:
        (payload.actorUserId as string | undefined) ??
        (payload.actor_user_id as string | undefined) ??
        null,
    };

    const result = await this.taskService.escalateTask(input);

    if (!result.ok) {
      this.logger.error(
        `TaskService.escalateTask returned error for email ${email.id} and task ${taskId}`,
        JSON.stringify(result.error),
      );
    }
  }

  private async handleNotifyAction(
    email: EmailMessageEnvelope,
    action: WorkflowAction,
  ): Promise<number> {
    const payload = (action.payload ?? {}) as {
      taskId?: string;
      task_id?: string;
      eventType?: TaskNotificationEventType;
      event_type?: TaskNotificationEventType;
      [key: string]: unknown;
    };

    const taskId =
      (payload.taskId as string | undefined) ??
      (payload.task_id as string | undefined);

    if (!taskId) {
      this.logger.warn(
        'NOTIFY action missing taskId/task_id; cannot send notification.',
      );
      return 0;
    }

    const result = await this.taskService.getTaskById(
      email.organization_id,
      taskId,
    );

    if (!result.ok || !result.data) {
      this.logger.error(
        `TaskService.getTaskById returned error for email ${email.id} and task ${taskId}`,
        JSON.stringify(result.error),
      );
      return 0;
    }

    const eventType: TaskNotificationEventType =
      (payload.eventType as TaskNotificationEventType | undefined) ??
      (payload.event_type as TaskNotificationEventType | undefined) ??
      'UPDATED';

    await this.notificationService.sendTaskNotification(
      result.data,
      eventType,
    );

    return 1;
  }
}
