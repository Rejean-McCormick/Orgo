import { api } from "./api";

/**
 * Canonical enums & core types mirrored from Orgo docs (Docs 2 & 8).
 */

export type TaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "FAILED"
  | "ESCALATED"
  | "CANCELLED";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TaskSeverity = "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL";

export type TaskCategory =
  | "request"
  | "incident"
  | "update"
  | "report"
  | "distribution";

export type Visibility = "PUBLIC" | "INTERNAL" | "RESTRICTED" | "ANONYMISED";

export type TaskSource = "email" | "api" | "manual" | "sync";

export type CaseStatus = "open" | "in_progress" | "resolved" | "archived";

export type CaseSeverity = "minor" | "moderate" | "major" | "critical";

/**
 * Generic helper types.
 */

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StandardResponse<T> {
  ok: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
}

/**
 * Canonical Task JSON shape (aligned with Doc 8 §8.4.2).
 */
export interface OrgoTask {
  task_id: string;
  organization_id: string;
  case_id?: string | null;

  source: TaskSource;
  type: string;
  category: TaskCategory;
  subtype?: string | null;

  label: string;
  title: string;
  description: string;

  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;

  visibility: Visibility;

  assignee_role?: string | null;
  created_by_user_id?: string | null;
  requester_person_id?: string | null;
  owner_role_id?: string | null;
  owner_user_id?: string | null;

  due_at?: string | null;
  reactivity_time?: string | null;
  reactivity_deadline_at?: string | null;
  escalation_level: number;
  closed_at?: string | null;

  metadata: Record<string, unknown>;

  created_at: string;
  updated_at: string;
}

/**
 * Canonical Case JSON shape (aligned with Doc 8 §8.4.1).
 */
export interface OrgoCase {
  case_id: string;
  organization_id: string;

  source_type: TaskSource;
  source_reference?: string | null;

  label: string;
  title: string;
  description: string;

  status: CaseStatus;
  severity: CaseSeverity;

  reactivity_time?: string | null;

  origin_vertical_level?: number | null;
  origin_role?: string | null;

  tags?: string[] | null;
  location?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;

  created_at: string;
  updated_at: string;
}

/**
 * DTOs for list endpoints.
 */

export interface ListTasksParams {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  type?: string;
  category?: TaskCategory;
  label?: string;
  severity?: TaskSeverity;
  assigneeRole?: string;
  ownerUserId?: string;
  search?: string;
}

export interface ListCasesParams {
  page?: number;
  pageSize?: number;
  status?: CaseStatus;
  label?: string;
  severity?: CaseSeverity;
  search?: string;
}

/**
 * DTOs for create/update payloads.
 */

export interface CreateTaskInput {
  organization_id: string;
  type: string;
  category: TaskCategory;
  title: string;
  description: string;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: Visibility;
  label: string;
  source: TaskSource;
  subtype?: string | null;
  case_id?: string | null;
  due_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskStatusInput {
  taskId: string;
  status: TaskStatus;
  reason?: string;
}

export interface CreateCaseInput {
  organization_id: string;
  source_type: TaskSource;
  label: string;
  title: string;
  description: string;
  severity: CaseSeverity;
  reactivity_time?: string | null;
  origin_vertical_level?: number | null;
  origin_role?: string | null;
  tags?: string[];
  location?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Workflow DTOs (aligned with Doc 5/Doc 4 naming).
 */

export interface WorkflowExecutionContext {
  organization_id: string;
  task_id?: string;
  case_id?: string;
  email_message_id?: string;
  [key: string]: unknown;
}

export interface ExecuteWorkflowInput {
  workflowId: string;
  context: WorkflowExecutionContext;
}

export interface WorkflowAction {
  type: string;
  [key: string]: unknown;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  actions: WorkflowAction[];
}

/**
 * Helper to unwrap the standard { ok / data / error } envelope
 * if the backend chooses to use it. If not, it just returns the payload.
 */
function unwrapStandardResponse<T>(
  response: T | StandardResponse<T>,
): T {
  if (
    response &&
    typeof response === "object" &&
    "ok" in response &&
    "data" in response
  ) {
    const standard = response as StandardResponse<T>;
    if (!standard.ok) {
      const error = new Error(
        standard.error?.message ?? "Request failed",
      );
      // Optionally attach code/details if needed later
      throw error;
    }
    return (standard.data ?? (null as unknown as T)) as T;
  }

  return response as T;
}

/**
 * Extend the base API slice with Orgo-specific tag types.
 */
const baseOrgoApi = api.enhanceEndpoints({
  addTagTypes: ["Task", "Case", "Workflow"] as const,
});

/**
 * Orgo API slice – all Orgo v3 RTK Query endpoints live here.
 *
 * Base URL comes from ./api.ts (`baseUrl: "api"`), so all URLs here
 * are relative to `/api`, e.g. `/v3/tasks` → `/api/v3/tasks`.
 */
export const orgoApi = baseOrgoApi.injectEndpoints({
  overrideExisting: false,
  endpoints: (build) => ({
    /**
     * GET /api/v3/tasks
     * Returns a paginated list of Tasks.
     */
    tasks: build.query<
      PaginatedResult<OrgoTask>,
      ListTasksParams | void
    >({
      query: (params) => ({
        url: "/v3/tasks",
        params,
      }),
      transformResponse: (
        response: PaginatedResult<OrgoTask> | StandardResponse<PaginatedResult<OrgoTask>>,
      ) => unwrapStandardResponse(response),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((task) => ({
                type: "Task" as const,
                id: task.task_id,
              })),
              { type: "Task" as const, id: "LIST" },
            ]
          : [{ type: "Task" as const, id: "LIST" }],
    }),

    /**
     * GET /api/v3/tasks/:id
     * Returns a single Task.
     */
    taskDetails: build.query<OrgoTask, string>({
      query: (taskId) => ({
        url: `/v3/tasks/${encodeURIComponent(taskId)}`,
      }),
      transformResponse: (
        response: OrgoTask | StandardResponse<OrgoTask>,
      ) => unwrapStandardResponse(response),
      providesTags: (_result, _error, taskId) => [
        { type: "Task" as const, id: taskId },
      ],
    }),

    /**
     * POST /api/v3/tasks
     * Creates a new Task.
     */
    createTask: build.mutation<OrgoTask, CreateTaskInput>({
      query: (body) => ({
        url: "/v3/tasks",
        method: "POST",
        body,
      }),
      transformResponse: (
        response: OrgoTask | StandardResponse<OrgoTask>,
      ) => unwrapStandardResponse(response),
      invalidatesTags: [{ type: "Task" as const, id: "LIST" }],
    }),

    /**
     * PATCH /api/v3/tasks/:id/status
     * Updates only the Task status (canonical state machine).
     */
    updateTaskStatus: build.mutation<OrgoTask, UpdateTaskStatusInput>({
      query: ({ taskId, status, reason }) => ({
        url: `/v3/tasks/${encodeURIComponent(taskId)}/status`,
        method: "PATCH",
        body: { status, reason },
      }),
      transformResponse: (
        response: OrgoTask | StandardResponse<OrgoTask>,
      ) => unwrapStandardResponse(response),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: "Task" as const, id: taskId },
        { type: "Task" as const, id: "LIST" },
      ],
    }),

    /**
     * GET /api/v3/cases
     * Returns a paginated list of Cases.
     */
    cases: build.query<
      PaginatedResult<OrgoCase>,
      ListCasesParams | void
    >({
      query: (params) => ({
        url: "/v3/cases",
        params,
      }),
      transformResponse: (
        response: PaginatedResult<OrgoCase> | StandardResponse<PaginatedResult<OrgoCase>>,
      ) => unwrapStandardResponse(response),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((caze) => ({
                type: "Case" as const,
                id: caze.case_id,
              })),
              { type: "Case" as const, id: "LIST" },
            ]
          : [{ type: "Case" as const, id: "LIST" }],
    }),

    /**
     * GET /api/v3/cases/:id
     * Returns a single Case.
     */
    caseDetails: build.query<OrgoCase, string>({
      query: (caseId) => ({
        url: `/v3/cases/${encodeURIComponent(caseId)}`,
      }),
      transformResponse: (
        response: OrgoCase | StandardResponse<OrgoCase>,
      ) => unwrapStandardResponse(response),
      providesTags: (_result, _error, caseId) => [
        { type: "Case" as const, id: caseId },
      ],
    }),

    /**
     * POST /api/v3/cases
     * Creates a new Case.
     */
    createCase: build.mutation<OrgoCase, CreateCaseInput>({
      query: (body) => ({
        url: "/v3/cases",
        method: "POST",
        body,
      }),
      transformResponse: (
        response: OrgoCase | StandardResponse<OrgoCase>,
      ) => unwrapStandardResponse(response),
      invalidatesTags: [{ type: "Case" as const, id: "LIST" }],
    }),

    /**
     * POST /api/v3/workflows/:id/execute
     * Triggers workflow execution for a given context.
     */
    executeWorkflow: build.mutation<
      WorkflowExecutionResult,
      ExecuteWorkflowInput
    >({
      query: ({ workflowId, context }) => ({
        url: `/v3/workflows/${encodeURIComponent(workflowId)}/execute`,
        method: "POST",
        body: { context },
      }),
      transformResponse: (
        response:
          | WorkflowExecutionResult
          | StandardResponse<WorkflowExecutionResult>,
      ) => unwrapStandardResponse(response),
      invalidatesTags: (_result, _error, { context }) => {
        const tags: { type: "Task" | "Case" | "Workflow"; id: string }[] =
          [];

        if (context.task_id) {
          tags.push({ type: "Task", id: context.task_id });
        }
        if (context.case_id) {
          tags.push({ type: "Case", id: context.case_id });
        }

        return [
          ...tags,
          { type: "Workflow" as const, id: "LIST" },
        ];
      },
    }),

    /**
     * POST /api/v3/workflows/:id/simulate
     * Simulates workflow execution without side-effects.
     */
    workflowSimulation: build.mutation<
      WorkflowExecutionResult,
      ExecuteWorkflowInput
    >({
      query: ({ workflowId, context }) => ({
        url: `/v3/workflows/${encodeURIComponent(workflowId)}/simulate`,
        method: "POST",
        body: { context },
      }),
      transformResponse: (
        response:
          | WorkflowExecutionResult
          | StandardResponse<WorkflowExecutionResult>,
      ) => unwrapStandardResponse(response),
    }),
  }),
});

/**
 * Export typed hooks (names follow Doc 4 conventions).
 */
export const {
  useTasksQuery,
  useTaskDetailsQuery,
  useCreateTaskMutation,
  useUpdateTaskStatusMutation,
  useCasesQuery,
  useCaseDetailsQuery,
  useCreateCaseMutation,
  useExecuteWorkflowMutation,
  useWorkflowSimulationMutation,
} = orgoApi;

export default orgoApi;
