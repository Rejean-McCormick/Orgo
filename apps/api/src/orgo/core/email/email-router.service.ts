import { Injectable, Logger } from '@nestjs/common';
import { WorkflowEngineService } from '../workflow/workflow-engine.service';
import { TaskService } from '../task/task.service';
import { NotificationService } from '../notification/notification.service';

export interface OrgoError<TDetails = unknown> {
  code: string;
  message: string;
  details?: TDetails;
}

export interface OrgoResult<TData = unknown, TErrorDetails = unknown> {
  ok: boolean;
  data: TData | null;
  error: OrgoError<TErrorDetails> | null;
}

/**
 * Logical EMAIL_MESSAGE envelope, aligned with the Doc 5 logical model
 * and the `email_messages` table in Doc 1.
 */
export interface EmailMessageEnvelope {
  id: string;
  organization_id: string;
  email_account_config_id?: string | null;
  thread_id?: string | null;
  message_id_header?: string | null;
  direction: 'inbound' | 'outbound';
  from_address: string;
  to_addresses: string[];
  cc_addresses?: string[] | null;
  bcc_addresses?: string[] | null;
  subject: string;
  received_at?: Date | string | null;
  sent_at?: Date | string | null;
  raw_headers?: string | null;
  text_body?: string | null;
  html_body?: string | null;
  related_task_id?: string | null;
  sensitivity: 'normal' | 'sensitive' | 'highly_sensitive';
  parsed_metadata?: Record<string, unknown> | null;
  attachments_meta?: unknown[] | null;
  security_flags?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export type WorkflowSource = 'EMAIL' | 'API' | 'SYSTEM' | 'TIMER';

export type WorkflowActionType =
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'ROUTE'
  | 'ESCALATE'
  | 'ATTACH_TEMPLATE'
  | 'SET_METADATA'
  | 'NOTIFY';

export interface WorkflowAction<TPayload = any> {
  type: WorkflowActionType;
  payload?: TPayload;
}

export interface WorkflowExecution {
  actions: WorkflowAction[];
  rule_ids?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Context object passed into the workflow engine when routing an email.
 * At minimum, `source` and `organization_id` are required; the email
 * envelope is provided under `email`.
 */
export interface WorkflowContext {
  source: WorkflowSource;
  organization_id: string;
  email?: EmailMessageEnvelope;
  [key: string]: unknown;
}

/**
 * Minimal Task creation payload, following the canonical Task JSON
 * contract (Doc 2 §2.10 / Doc 8 §8.4.2). Most fields are optional here
 * because validation is enforced in TaskService, not in the router.
 */
export interface CreateTaskPayload {
  organization_id?: string;
  type?: string;
  category?: string;
  subtype?: string | null;
  label?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  severity?: string;
  visibility?: string;
  source?: string;
  case_id?: string | null;
  created_by_user_id?: string | null;
  requester_person_id?: string | null;
  owner_role_id?: string | null;
  owner_user_id?: string | null;
  assignee_role?: string | null;
  due_at?: string | Date | null;
  reactivity_time?: string | null;
  reactivity_deadline_at?: string | Date | null;
  escalation_level?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Minimal view of a Task returned by TaskService; we only need a stable
 * identifier and treat the rest as opaque.
 */
export type TaskDTO = {
  task_id?: string;
  id?: string;
  [key: string]: unknown;
};

export interface NotifyActionPayload {
  task_id?: string;
  event_type?: 'CREATED' | 'ASSIGNED' | 'ESCALATED' | 'COMPLETED';
  [key: string]: unknown;
}

/**
 * Options for routing a single email through the workflow engine.
 *
 * - dry_run: if true, compute actions but do not apply them.
 * - context_overrides: optional extra keys / overrides for WorkflowContext.
 */
export interface EmailRoutingOptions {
  dry_run?: boolean;
  context_overrides?: Partial<WorkflowContext>;
}

export interface ApplyActionsResult {
  created_task_ids: string[];
  notifications_sent: number;
}

export interface EmailRoutingResult {
  email_id: string;
  organization_id: string;
  workflow_execution: WorkflowExecution;
  created_task_ids: string[];
  notifications_sent: number;
}

/**
 * EmailRouterService
 *
 * Responsibilities (aligned with Docs 2, 4, 5 and 8):
 *  - Build a WorkflowContext from a parsed/validated email.
 *  - Execute workflow rules via WorkflowEngineService.
 *  - Apply the resulting actions by delegating to TaskService and
 *    NotificationService.
 *  - Return a standard result shape (ok/data/error).
 */
@Injectable()
export class EmailRouterService {
  private readonly logger = new Logger(EmailRouterService.name);

  constructor(
    private readonly workflowEngine: WorkflowEngineService,
    private readonly taskService: TaskService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Route a parsed email into the workflow engine and apply resulting actions.
   *
   * Typical flow:
   *  - Build WorkflowContext { source: "EMAIL", organization_id, email }
   *  - Execute workflow rules
   *  - For CREATE_TASK actions: create Tasks
   *  - For ROUTE / ESCALATE / NOTIFY: delegate to TaskService/NotificationService
   *
   * If `options.dry_run` is true, actions are computed but not applied.
   */
  async routeToWorkflow(
    email: EmailMessageEnvelope,
    options: EmailRoutingOptions = {},
  ): Promise<OrgoResult<EmailRoutingResult>> {
    if (!email) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'EMAIL_ROUTING_ERROR',
          message: 'Email payload is required for routing',
        },
      };
    }

    if (!email.organization_id) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'EMAIL_ROUTING_ERROR',
          message: 'Email payload must include organization_id',
          details: { email_id: email.id },
        },
      };
    }

    const { dry_run = false, context_overrides = {} } = options;

    const context: WorkflowContext = {
      source: 'EMAIL',
      organization_id: email.organization_id,
      email,
      ...context_overrides,
    };

    let executionResult: OrgoResult<WorkflowExecution>;
    try {
      executionResult = (await this.workflowEngine.executeWorkflow(
        context,
      )) as OrgoResult<WorkflowExecution>;
    } catch (err) {
      this.logger.error(
        `Workflow execution failed for email ${email.id}`,
        (err as Error).stack || String(err),
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'WORKFLOW_EXECUTION_FAILED',
          message: 'Failed to execute workflow for email',
          details: {
            email_id: email.id,
            organization_id: email.organization_id,
          },
        },
      };
    }

    if (!executionResult.ok || !executionResult.data) {
      this.logger.warn(
        `Workflow execution returned error for email ${email.id}: ${
          executionResult.error?.code ?? 'UNKNOWN_ERROR'
        }`,
      );

      return {
        ok: false,
        data: null,
        error:
          executionResult.error ??
          ({
            code: 'WORKFLOW_EXECUTION_FAILED',
            message:
              'Workflow execution failed without specific error detail',
          } as OrgoError),
      };
    }

    const workflowExecution = executionResult.data;

    if (dry_run) {
      // Only compute actions; do not apply anything.
      return {
        ok: true,
        data: {
          email_id: email.id,
          organization_id: email.organization_id,
          workflow_execution: workflowExecution,
          created_task_ids: [],
          notifications_sent: 0,
        },
        error: null,
      };
    }

    const applyResult = await this.applyActions(
      workflowExecution.actions ?? [],
      email,
    );

    if (!applyResult.ok || !applyResult.data) {
      return {
        ok: false,
        data: null,
        error:
          applyResult.error ??
          ({
            code: 'EMAIL_ROUTING_APPLY_FAILED',
            message: 'Failed to apply workflow actions for email',
          } as OrgoError),
      };
    }

    const { created_task_ids, notifications_sent } = applyResult.data;

    return {
      ok: true,
      data: {
        email_id: email.id,
        organization_id: email.organization_id,
        workflow_execution: workflowExecution,
        created_task_ids,
        notifications_sent,
      },
      error: null,
    };
  }

  /**
   * Apply workflow actions that resulted from executing rules for an email.
   * Supports:
   *  - CREATE_TASK: TaskService.createTask
   *  - ROUTE: TaskService.assignTask
   *  - ESCALATE: TaskService.escalateTask
   *  - NOTIFY: NotificationService.sendTaskNotification
   *
   * Other action types are logged and ignored at this layer.
   */
  private async applyActions(
    actions: WorkflowAction[],
    email: EmailMessageEnvelope,
  ): Promise<OrgoResult<ApplyActionsResult>> {
    const created_task_ids: string[] = [];
    let notifications_sent = 0;

    for (const action of actions) {
      if (!action || !action.type) {
        this.logger.warn(
          `Encountered workflow action without type for email ${email.id}; skipping`,
        );
        continue;
      }

      try {
        switch (action.type) {
          case 'CREATE_TASK':
            await this.handleCreateTaskAction(action, email, created_task_ids);
            break;

          case 'ROUTE':
            await this.handleRouteAction(action);
            break;

          case 'ESCALATE':
            await this.handleEscalateAction(action);
            break;

          case 'NOTIFY':
            notifications_sent += await this.handleNotifyAction(action);
            break;

          case 'ATTACH_TEMPLATE':
          case 'SET_METADATA':
          case 'UPDATE_TASK':
            // These are typically handled inside workflow-specific services.
            this.logger.debug(
              `Ignoring action type "${action.type}" in EmailRouterService.applyActions; not handled at email router layer`,
            );
            break;

          default:
            this.logger.warn(
              `Unknown workflow action type "${
                (action as any).type
              }" encountered for email ${email.id}`,
            );
        }
      } catch (err) {
        this.logger.error(
          `Failed to apply action "${action.type}" for email ${email.id}`,
          (err as Error).stack || String(err),
        );

        return {
          ok: false,
          data: null,
          error: {
            code: 'EMAIL_ROUTING_APPLY_FAILED',
            message: `Failed to apply workflow action "${action.type}"`,
            details: {
              email_id: email.id,
              action_type: action.type,
            },
          },
        };
      }
    }

    return {
      ok: true,
      data: {
        created_task_ids,
        notifications_sent,
      },
      error: null,
    };
  }

  private async handleCreateTaskAction(
    action: WorkflowAction,
    email: EmailMessageEnvelope,
    created_task_ids: string[],
  ): Promise<void> {
    const rawPayload = (action.payload ?? {}) as CreateTaskPayload;

    const payload: CreateTaskPayload = {
      ...rawPayload,
      organization_id: rawPayload.organization_id ?? email.organization_id,
      source: rawPayload.source ?? 'email',
      metadata: {
        ...(rawPayload.metadata ?? {}),
        email_message_id: email.id,
        email_thread_id: email.thread_id ?? undefined,
        email_direction: email.direction,
        email_subject: email.subject,
        email_from_address: email.from_address,
        email_to_addresses: email.to_addresses,
      },
    };

    const result = (await this.taskService.createTask(
      payload,
    )) as OrgoResult<TaskDTO>;

    if (!result.ok || !result.data) {
      throw new Error(
        result.error?.message ??
          'TaskService.createTask returned an error without details',
      );
    }

    const task = result.data;
    const taskId = (task.task_id ?? task.id) as string | undefined;

    if (!taskId) {
      this.logger.warn(
        'TaskService.createTask succeeded but returned task without task_id / id; task will not be tracked in routing result',
      );
      return;
    }

    created_task_ids.push(taskId);
  }

  private async handleRouteAction(action: WorkflowAction): Promise<void> {
    const payload = (action.payload ?? {}) as {
      task_id?: string;
      assignee_role?: string;
      actor_user_id?: string;
      assignee_user_id?: string;
      [key: string]: unknown;
    };

    if (!payload.task_id && !payload.assignee_role && !payload.assignee_user_id) {
      this.logger.debug('ROUTE action missing routing payload; nothing to do');
      return;
    }

    if (!payload.task_id) {
      this.logger.warn('ROUTE action missing task_id; cannot perform routing');
      return;
    }

    await this.taskService.assignTask(payload.task_id, {
      assignee_role: payload.assignee_role,
      actor_user_id: payload.actor_user_id,
      assignee_user_id: payload.assignee_user_id,
    });
  }

  private async handleEscalateAction(action: WorkflowAction): Promise<void> {
    const payload = (action.payload ?? {}) as {
      task_id?: string;
      reason?: string;
      actor_user_id?: string;
      [key: string]: unknown;
    };

    if (!payload.task_id) {
      this.logger.warn(
        'ESCALATE action missing task_id; cannot perform escalation',
      );
      return;
    }

    await this.taskService.escalateTask(payload.task_id, {
      reason: payload.reason ?? 'Escalation triggered by workflow',
      actor_user_id: payload.actor_user_id,
    });
  }

  private async handleNotifyAction(action: WorkflowAction): Promise<number> {
    const payload = (action.payload ?? {}) as NotifyActionPayload;

    if (!payload.task_id || !payload.event_type) {
      this.logger.debug(
        'NOTIFY action missing task_id or event_type; nothing to do',
      );
      return 0;
    }

    const taskResult = (await this.taskService.getTaskById(
      payload.task_id,
    )) as OrgoResult<TaskDTO>;

    if (!taskResult.ok || !taskResult.data) {
      this.logger.warn(
        `NOTIFY action could not load task ${payload.task_id}; skipping notification`,
      );
      return 0;
    }

    const notifyResult = await this.notificationService.sendTaskNotification(
      taskResult.data,
      payload.event_type,
    );

    if (!notifyResult.ok) {
      this.logger.warn(
        `sendTaskNotification failed for task ${
          payload.task_id
        }: ${notifyResult.error?.code ?? 'UNKNOWN_ERROR'}`,
      );
      return 0;
    }

    return 1;
  }
}
