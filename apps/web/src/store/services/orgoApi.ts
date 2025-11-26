// apps/web/src/store/services/orgoApi.ts

import { api } from "./api";

import type {
  Task as OrgoTask,
  TaskStatus,
  TaskPriority,
  TaskSeverity,
  TaskCategory,
  TaskSource,
  Visibility,
} from "../../orgo/types/task";
import type {
  Case as OrgoCase,
  CaseStatus,
  CaseSeverity,
} from "../../orgo/types/case";
import type {
  OrgProfileSnapshot,
  OrgProfileCode,
  ProfilePreviewDiff,
} from "../../orgo/types/profile";
import type {
  InsightsTimeWindowKey,
  InsightsTimeSeriesPoint,
  InsightsGroupedAggregateRow,
  InsightsSlaBreachRow,
  ProfileScoreSummary,
} from "../../orgo/types/insights";

/* -------------------------------------------------------------------------- */
/*  Standard API envelope + helpers                                           */
/* -------------------------------------------------------------------------- */

export interface StandardResponse<T> {
  ok: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string | null;
}

/**
 * Helper to unwrap the standard { ok, data, error } envelope.
 * Throws on !ok or missing data.
 */
export function unwrapStandardResponse<T>(
  response: StandardResponse<T>,
): T {
  if (!response.ok || response.data == null) {
    const errorMessage =
      response.error?.message ?? "Unknown error from Orgo API";
    throw new Error(errorMessage);
  }
  return response.data;
}

/* -------------------------------------------------------------------------- */
/*  Core Task / Case DTOs (JSON-aligned)                                      */
/*  (Types come from apps/web/src/orgo/types/*)                               */
/* -------------------------------------------------------------------------- */

/**
 * Alias for clarity – this is the canonical Task JSON contract.
 */
export type OrgoTaskJson = OrgoTask;

/**
 * Canonical Case JSON contract.
 */
export type OrgoCaseJson = OrgoCase;

/* -------------------------------------------------------------------------- */
/*  Tasks                                                                     */
/* -------------------------------------------------------------------------- */

export interface ListTasksQueryParams {
  organizationId: string;
  status?: TaskStatus;
  label?: string;
  type?: string;
  assigneeRole?: string;
  severity?: TaskSeverity;
  visibility?: Visibility;
  priority?: TaskPriority;
  page?: number;
  pageSize?: number;
}

export interface ListTasksResponse {
  items: OrgoTaskJson[];
  total: number;
  nextCursor?: string | null;
}

export interface CreateTaskInput {
  organization_id: string;
  case_id?: string | null;
  type?: string | null;
  category?: TaskCategory | null;
  subtype?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  severity?: TaskSeverity;
  visibility?: Visibility;
  label?: string | null;
  source?: TaskSource;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by_user_id?: string | null;
  requester_person_id?: string | null;
}

export interface UpdateTaskStatusInput {
  taskId: string;
  status: TaskStatus;
  reason?: string;
}

/* -------------------------------------------------------------------------- */
/*  Cases                                                                     */
/* -------------------------------------------------------------------------- */

export interface ListCasesQueryParams {
  organizationId: string;
  status?: CaseStatus | "all";
  severity?: CaseSeverity;
  label?: string;
  visibility?: Visibility;
  page?: number;
  pageSize?: number;
  sortBy?: "created_at" | "updated_at" | "priority" | "severity";
  sortDirection?: "asc" | "desc";
  search?: string;
}

export interface ListCasesResponse {
  items: OrgoCaseJson[];
  total: number;
}

/**
 * Minimal Case creation payload – mirrors CaseController.createCase DTO.
 */
export interface CreateCaseInput {
  organization_id: string;
  title: string;
  description?: string | null;
  label?: string | null;
  severity?: CaseSeverity;
  visibility?: Visibility;
  requester_person_id?: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Workflow                                                                  */
/* -------------------------------------------------------------------------- */

export interface ExecuteWorkflowInput {
  workflowId: string;
  organizationId: string;
  caseId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
}

export interface WorkflowExecutionResult {
  workflow_id: string;
  started_at: string;
  completed_at?: string | null;
  status: "success" | "failed" | "partial";
  actions_executed: number;
  created_task_ids?: string[];
  created_case_ids?: string[];
}

export interface WorkflowSimulationInput {
  workflowId: string;
  organizationId: string;
  payload?: Record<string, unknown>;
}

export interface WorkflowSimulationResult {
  workflow_id: string;
  simulated_at: string;
  would_create_tasks: number;
  would_create_cases: number;
  notes?: string;
}

/* -------------------------------------------------------------------------- */
/*  Admin views: Tasks & Cases                                                */
/* -------------------------------------------------------------------------- */

/**
 * Filters for the admin Task overview.
 * These map to the Task list filters on the backend.
 */
export interface AdminTaskOverviewQueryArgs {
  organizationId: string;
  status?: TaskStatus | "all";
  label?: string;
  type?: string;
  assigneeRole?: string;
  severity?: TaskSeverity;
  priority?: TaskPriority;
  page?: number;
  pageSize?: number;
}

/**
 * Simple alias – the admin overview uses the same core Task JSON model,
 * possibly enriched on the backend. We leave the payload generic to avoid
 * coupling to a specific UI view model.
 */
export type AdminTaskOverviewResponse = ListTasksResponse;

/**
 * Filters for the admin Case overview.
 */
export interface AdminCaseOverviewQueryArgs {
  organizationId: string;
  status?: CaseStatus | "all";
  severity?: CaseSeverity;
  label?: string;
  visibility?: Visibility;
  page?: number;
  pageSize?: number;
  sortBy?: "created_at" | "updated_at" | "priority" | "severity";
  sortDirection?: "asc" | "desc";
  search?: string;
}

/**
 * Admin Case overview uses the same Case list shape.
 */
export type AdminCaseOverviewResponse = ListCasesResponse;

/* -------------------------------------------------------------------------- */
/*  Config & Profiles                                                         */
/* -------------------------------------------------------------------------- */

export interface GlobalConfigQueryArgs {
  organizationId?: string;
  environment?: string;
  /**
   * Either a single module name ("email", "workflows", "org_profiles", "insights")
   * or an array of modules.
   */
  modules?: string | string[];
}

export interface GlobalConfigResult {
  // Intentionally loose; config is a heterogeneous map.
  base?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  modules?: Record<string, unknown>;
}

export interface UpdateServiceConfigInput {
  module: string;
  organizationId?: string;
  environment?: string;
  /**
   * Arbitrary changes for the module. For the org profile screen we mainly send
   * `{ profileCode: <code> }` for `module = "org_profiles"`.
   */
  changes: Record<string, unknown>;
}

/**
 * Convenience input for the org profile settings screen.
 * This is adapted into UpdateServiceConfigInput internally.
 */
export interface UpdateOrgProfileConfigInput {
  module: "org_profiles";
  organizationId: string;
  profileCode: OrgProfileCode | string;
}

export interface FeatureFlag {
  code: string;
  enabled: boolean;
  description?: string | null;
  rollout_strategy?: Record<string, unknown> | null;
}

/* -------------------------------------------------------------------------- */
/*  Notifications                                                             */
/* -------------------------------------------------------------------------- */

export type NotificationChannel = "email" | "sms" | "in_app" | "webhook";

export type NotificationStatus =
  | "queued"
  | "sent"
  | "failed"
  | "cancelled";

export interface NotificationDto {
  id: string;
  organizationId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  recipientUserId: string | null;
  recipientAddress: string | null;
  relatedTaskId: string | null;
  payload: Record<string, unknown>;
  queuedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
}

export interface NotificationFeedResponse {
  items: NotificationDto[];
  nextCursor?: string | null;
}

export interface NotificationsFeedQueryArgs {
  cursor?: string | null;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/*  Domain modules (Maintenance, HR, Education)                               */
/* -------------------------------------------------------------------------- */

/**
 * Minimal domain-specific Task projection used by domain listings.
 * It is deliberately loose – callers can narrow it in their own views.
 */
export interface DomainTaskView extends OrgoTaskJson {
  domain_fields?: Record<string, unknown>;
}

/**
 * Maintenance incidents – wrapper over Tasks with type = "maintenance".
 */
export interface RegisterMaintenanceIncidentInput {
  organization_id: string;
  title: string;
  description?: string | null;
  category?: TaskCategory;
  subtype?: string | null;
  priority?: TaskPriority;
  severity?: TaskSeverity;
  visibility?: Visibility;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface MaintenanceIncidentsQueryArgs {
  organizationId: string;
  status?: TaskStatus | "all";
  category?: TaskCategory;
  subtype?: string;
  label?: string;
  page?: number;
  pageSize?: number;
}

/**
 * HR reports / cases.
 */
export interface RegisterHrReportInput {
  organization_id: string;
  title: string;
  description?: string | null;
  subtype?: string | null;
  severity?: TaskSeverity;
  visibility?: Visibility;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface HrCasesQueryArgs {
  organizationId: string;
  status?: CaseStatus | "all";
  severity?: CaseSeverity;
  label?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Education incidents.
 */
export interface RegisterStudentIncidentInput {
  organization_id: string;
  title: string;
  description?: string | null;
  learning_group_id?: string | null;
  student_person_id?: string | null;
  category?: TaskCategory;
  subtype?: string | null;
  severity?: TaskSeverity;
  visibility?: Visibility;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EducationIncidentsQueryArgs {
  organizationId: string;
  status?: TaskStatus | "all";
  learningGroupId?: string;
  label?: string;
  page?: number;
  pageSize?: number;
}

/* -------------------------------------------------------------------------- */
/*  Insights reporting                                                        */
/* -------------------------------------------------------------------------- */

export interface BaseInsightsQueryArgs {
  organizationId: string;
  /**
   * Window key such as "7d", "30d", "90d", etc.
   */
  window?: InsightsTimeWindowKey;
  /**
   * Optional explicit from/to ISO timestamps.
   */
  from?: string;
  to?: string;
}

export interface TaskVolumeReportQueryArgs extends BaseInsightsQueryArgs {
  /**
   * Optional domain/type filter ("maintenance", "hr_case", etc.).
   */
  domain?: string;
}

export type TaskVolumeReportResponse = InsightsTimeSeriesPoint[];

export interface SlaBreachReportQueryArgs extends BaseInsightsQueryArgs {
  /**
   * Optional domain/type filter.
   */
  domain?: string;
}

export type SlaBreachReportResponse = InsightsSlaBreachRow[];

export interface ProfileScoreReportQueryArgs extends BaseInsightsQueryArgs {
  /**
   * Optional profile code override; otherwise uses the active org profile.
   */
  profileCode?: OrgProfileCode | string;
}

export type ProfileScoreReportResponse = ProfileScoreSummary;

/**
 * Convenience response combining the three reports for the Insights dashboard.
 * This is built on the client by issuing three HTTP requests.
 */
export interface InsightsOverviewResponse {
  volume: TaskVolumeReportResponse;
  slaBreaches: SlaBreachReportResponse;
  profileScore: ProfileScoreReportResponse;
}

export type InsightsOverviewQueryArgs = BaseInsightsQueryArgs & {
  domain?: string;
  profileCode?: OrgProfileCode | string;
};

/* -------------------------------------------------------------------------- */
/*  RTK Query slice                                                           */
/* -------------------------------------------------------------------------- */

const baseOrgoApi = api.enhanceEndpoints({
  addTagTypes: [
    "Task",
    "Case",
    "Workflow",
    "AdminTasks",
    "AdminCases",
    "OrgProfile",
    "Config",
    "FeatureFlag",
    "Notification",
    "Maintenance",
    "Hr",
    "Education",
    "Insights",
  ] as const,
});

export const orgoApi = baseOrgoApi.injectEndpoints({
  endpoints: (build) => ({
    /* --------------------------------- Tasks -------------------------------- */

    tasks: build.query<
      StandardResponse<ListTasksResponse>,
      ListTasksQueryParams
    >({
      query: ({
        organizationId,
        status,
        label,
        type,
        assigneeRole,
        severity,
        visibility,
        priority,
        page,
        pageSize,
      }) => ({
        url: "/v3/tasks",
        method: "GET",
        params: {
          organization_id: organizationId,
          status,
          label,
          type,
          assignee_role: assigneeRole,
          severity,
          visibility,
          priority,
          page,
          page_size: pageSize,
        },
      }),
      providesTags: ["Task"],
    }),

    taskDetails: build.query<
      StandardResponse<OrgoTaskJson>,
      { id: string }
    >({
      query: ({ id }) => ({
        url: `/v3/tasks/${id}`,
        method: "GET",
      }),
      providesTags: (_result, _error, { id }) => [
        { type: "Task", id },
        "Task",
      ],
    }),

    createTask: build.mutation<
      StandardResponse<OrgoTaskJson>,
      CreateTaskInput
    >({
      query: (body) => ({
        url: "/v3/tasks",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Task", "Case"],
    }),

    updateTaskStatus: build.mutation<
      StandardResponse<OrgoTaskJson>,
      UpdateTaskStatusInput
    >({
      query: ({ taskId, status, reason }) => ({
        url: `/v3/tasks/${taskId}/status`,
        method: "PATCH",
        body: {
          status,
          reason,
        },
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: "Task", id: taskId },
        "Task",
      ],
    }),

    /* --------------------------------- Cases -------------------------------- */

    cases: build.query<
      StandardResponse<ListCasesResponse>,
      ListCasesQueryParams
    >({
      query: ({
        organizationId,
        status,
        severity,
        label,
        visibility,
        page,
        pageSize,
        sortBy,
        sortDirection,
        search,
      }) => ({
        url: "/v3/cases",
        method: "GET",
        params: {
          organization_id: organizationId,
          status,
          severity,
          label,
          visibility,
          page,
          pageSize,
          sortBy,
          sortDirection,
          search,
        },
      }),
      providesTags: ["Case"],
    }),

    caseDetails: build.query<
      StandardResponse<OrgoCaseJson>,
      { id: string }
    >({
      query: ({ id }) => ({
        url: `/v3/cases/${id}`,
        method: "GET",
      }),
      providesTags: (_result, _error, { id }) => [
        { type: "Case", id },
        "Case",
      ],
    }),

    createCase: build.mutation<
      StandardResponse<OrgoCaseJson>,
      CreateCaseInput
    >({
      query: (body) => ({
        url: "/v3/cases",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Case", "Task"],
    }),

    /* ------------------------------- Workflow -------------------------------- */

    executeWorkflow: build.mutation<
      StandardResponse<WorkflowExecutionResult>,
      ExecuteWorkflowInput
    >({
      query: ({ workflowId, ...body }) => ({
        url: `/workflows/${workflowId}/execute`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["Task", "Case", "Insights"],
    }),

    workflowSimulation: build.query<
      StandardResponse<WorkflowSimulationResult>,
      WorkflowSimulationInput
    >({
      query: ({ workflowId, ...body }) => ({
        url: `/workflows/${workflowId}/simulate`,
        method: "POST",
        body,
      }),
    }),

    /* -------------------------- Admin Task overview ------------------------- */

    adminTaskOverview: build.query<
      StandardResponse<AdminTaskOverviewResponse>,
      AdminTaskOverviewQueryArgs
    >({
      query: ({
        organizationId,
        status,
        label,
        type,
        assigneeRole,
        severity,
        priority,
        page,
        pageSize,
      }) => ({
        // Reuse the core Task list endpoint for admin overview.
        url: "/v3/tasks",
        method: "GET",
        params: {
          organization_id: organizationId,
          status,
          label,
          type,
          assignee_role: assigneeRole,
          severity,
          priority,
          page,
          page_size: pageSize,
        },
      }),
      providesTags: ["AdminTasks", "Task"],
    }),

    /* -------------------------- Admin Case overview ------------------------- */

    adminCaseOverview: build.query<
      StandardResponse<AdminCaseOverviewResponse>,
      AdminCaseOverviewQueryArgs
    >({
      query: ({
        organizationId,
        status,
        severity,
        label,
        visibility,
        page,
        pageSize,
        sortBy,
        sortDirection,
        search,
      }) => ({
        url: "/v3/cases",
        method: "GET",
        params: {
          organization_id: organizationId,
          status,
          severity,
          label,
          visibility,
          page,
          pageSize,
          sortBy,
          sortDirection,
          search,
        },
      }),
      providesTags: ["AdminCases", "Case"],
    }),

    /* ---------------------------- Config & profiles ------------------------- */

    globalConfig: build.query<
      StandardResponse<GlobalConfigResult>,
      GlobalConfigQueryArgs | void
    >({
      query: (args) => {
        const params: Record<string, string | string[] | undefined> = {};
        if (args?.organizationId) params.organizationId = args.organizationId;
        if (args?.environment) params.environment = args.environment;
        if (args?.modules) params.modules = args.modules;
        return {
          url: "/v3/config",
          method: "GET",
          params,
        };
      },
      providesTags: ["Config"],
    }),

    updateServiceConfig: build.mutation<
      StandardResponse<GlobalConfigResult>,
      UpdateServiceConfigInput | UpdateOrgProfileConfigInput
    >({
      query: (input) => {
        if ((input as UpdateOrgProfileConfigInput).module === "org_profiles") {
          const {
            module,
            organizationId,
            profileCode,
          } = input as UpdateOrgProfileConfigInput;
          return {
            url: "/v3/config",
            method: "PUT",
            body: {
              module,
              organizationId,
              changes: {
                profileCode,
              },
            } satisfies UpdateServiceConfigInput,
          };
        }

        return {
          url: "/v3/config",
          method: "PUT",
          body: input,
        };
      },
      invalidatesTags: ["Config", "OrgProfile", "Insights"],
    }),

    orgProfiles: build.query<
      OrgProfileSnapshot | OrgProfileSnapshot[],
      { organizationId?: string } | void
    >({
      // The admin UI currently calls useOrgProfilesQuery() with no args.
      // We support an optional organizationId for future use.
      query: (args) => {
        const organizationId = args && "organizationId" in args
          ? args.organizationId
          : undefined;

        // When no explicit organizationId is provided, we rely on the backend
        // to infer it from auth / context.
        if (!organizationId) {
          return {
            url: "/orgo/config/org-profiles/current",
            method: "GET",
          };
        }

        return {
          url: `/orgo/config/org-profiles/${organizationId}`,
          method: "GET",
        };
      },
      providesTags: ["OrgProfile"],
    }),

    profilePreview: build.mutation<
      ProfilePreviewDiff,
      {
        organizationId: string;
        currentProfileCode?: OrgProfileCode | string;
        proposedProfileCode: OrgProfileCode | string;
      }
    >({
      query: ({ organizationId, currentProfileCode, proposedProfileCode }) => ({
        url: `/orgo/config/org-profiles/${organizationId}/preview`,
        method: "POST",
        body: {
          currentProfileCode,
          proposedProfileCode,
        },
      }),
    }),

    featureFlags: build.query<
      StandardResponse<FeatureFlag[]>,
      { organizationId?: string } | void
    >({
      query: (args) => ({
        url: "/v3/config/feature-flags",
        method: "GET",
        params: {
          organizationId: args && "organizationId" in args
            ? args.organizationId
            : undefined,
        },
      }),
      providesTags: ["FeatureFlag"],
    }),

    /* ---------------------------- Notifications ----------------------------- */

    notificationsFeed: build.query<
      StandardResponse<NotificationFeedResponse>,
      NotificationsFeedQueryArgs | void
    >({
      query: (args) => ({
        url: "/notifications/feed",
        method: "GET",
        params: {
          cursor: args?.cursor,
          limit: args?.limit,
        },
      }),
      providesTags: ["Notification"],
    }),

    /* ---------------------------- Domain: Maintenance ----------------------- */

    registerMaintenanceIncident: build.mutation<
      StandardResponse<DomainTaskView>,
      RegisterMaintenanceIncidentInput
    >({
      query: (body) => ({
        url: "/domain/maintenance/tasks",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Maintenance", "Task"],
    }),

    maintenanceIncidents: build.query<
      StandardResponse<PaginatedResult<DomainTaskView>>,
      MaintenanceIncidentsQueryArgs
    >({
      query: ({
        organizationId,
        status,
        category,
        subtype,
        label,
        page,
        pageSize,
      }) => ({
        url: "/domain/maintenance/tasks",
        method: "GET",
        params: {
          organization_id: organizationId,
          status,
          category,
          subtype,
          label,
          page,
          pageSize,
        },
      }),
      providesTags: ["Maintenance"],
    }),

    /* ------------------------------- Domain: HR ----------------------------- */

    registerHrReport: build.mutation<
      StandardResponse<DomainTaskView>,
      RegisterHrReportInput
    >({
      query: (body) => ({
        url: "/domain/hr_case/reports",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Hr", "Task", "Case"],
    }),

    hrCases: build.query<
      StandardResponse<PaginatedResult<OrgoCaseJson>>,
      HrCasesQueryArgs
    >({
      query: ({ organizationId, status, severity, label, page, pageSize }) => ({
        url: "/domain/hr_case/cases",
        method: "GET",
        params: {
          organization_id: organizationId,
          status,
          severity,
          label,
          page,
          pageSize,
        },
      }),
      providesTags: ["Hr", "Case"],
    }),

    /* ---------------------------- Domain: Education ------------------------- */

    registerStudentIncident: build.mutation<
      StandardResponse<DomainTaskView>,
      RegisterStudentIncidentInput
    >({
      query: (body) => ({
        url: "/domain/education/incidents",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Education", "Task"],
    }),

    educationIncidents: build.query<
      StandardResponse<PaginatedResult<DomainTaskView>>,
      EducationIncidentsQueryArgs
    >({
      query: ({
        organizationId,
        status,
        learningGroupId,
        label,
        page,
        pageSize,
      }) => ({
        url: "/domain/education/incidents",
        method: "GET",
        params: {
          organization_id: organizationId,
          status,
          learning_group_id: learningGroupId,
          label,
          page,
          pageSize,
        },
      }),
      providesTags: ["Education"],
    }),


    /* ------------------------------ Insights -------------------------------- */

    taskVolumeReport: build.query<
      StandardResponse<TaskVolumeReportResponse>,
      TaskVolumeReportQueryArgs
    >({
      query: ({ organizationId, window, from, to, domain }) => ({
        url: "/insights/reports/tasks/volume",
        method: "GET",
        params: {
          organization_id: organizationId,
          window,
          from,
          to,
          domain,
        },
      }),
      providesTags: ["Insights"],
    }),

    slaBreachReport: build.query<
      StandardResponse<SlaBreachReportResponse>,
      SlaBreachReportQueryArgs
    >({
      query: ({ organizationId, window, from, to, domain }) => ({
        url: "/insights/reports/tasks/sla-breaches",
        method: "GET",
        params: {
          organization_id: organizationId,
          window,
          from,
          to,
          domain,
        },
      }),
      providesTags: ["Insights"],
    }),

    profileScoreReport: build.query<
      StandardResponse<ProfileScoreReportResponse>,
      ProfileScoreReportQueryArgs
    >({
      query: ({ organizationId, window, from, to, profileCode }) => ({
        url: "/insights/reports/profiles/score",
        method: "GET",
        params: {
          organization_id: organizationId,
          window,
          from,
          to,
          profile_code: profileCode,
        },
      }),
      providesTags: ["Insights"],
    }),

    /**
     * Client-side composition endpoint for the Insights dashboard.
     * This issues three HTTP calls using the same baseQuery.
     */
    insightsOverview: build.query<
      InsightsOverviewResponse,
      InsightsOverviewQueryArgs
    >({
      async queryFn(args, _api, _extraOptions, baseQuery) {
        const {
          organizationId,
          window,
          from,
          to,
          domain,
          profileCode,
        } = args;

        const [volumeRes, slaRes, scoreRes] = await Promise.all([
          baseQuery({
            url: "/insights/reports/tasks/volume",
            method: "GET",
            params: {
              organization_id: organizationId,
              window,
              from,
              to,
              domain,
            },
          }) as Promise<{ data?: StandardResponse<TaskVolumeReportResponse> }>,
          baseQuery({
            url: "/insights/reports/tasks/sla-breaches",
            method: "GET",
            params: {
              organization_id: organizationId,
              window,
              from,
              to,
              domain,
            },
          }) as Promise<{ data?: StandardResponse<SlaBreachReportResponse> }>,
          baseQuery({
            url: "/insights/reports/profiles/score",
            method: "GET",
            params: {
              organization_id: organizationId,
              window,
              from,
              to,
              profile_code: profileCode,
            },
          }) as Promise<{ data?: StandardResponse<ProfileScoreReportResponse> }>,
        ]);

        try {
          const volume = volumeRes.data
            ? unwrapStandardResponse(volumeRes.data)
            : [];
          const slaBreaches = slaRes.data
            ? unwrapStandardResponse(slaRes.data)
            : [];
          const profileScore = scoreRes.data
            ? unwrapStandardResponse(scoreRes.data)
            : ({} as ProfileScoreReportResponse);

          return {
            data: {
              volume,
              slaBreaches,
              profileScore,
            },
          };
        } catch (error) {
          return {
            error: error as unknown,
          };
        }
      },
      providesTags: ["Insights"],
    }),
  }),
});

/* -------------------------------------------------------------------------- */
/*  Hook exports                                                              */
/* -------------------------------------------------------------------------- */

export const {
  /* Core tasks & cases */
  useTasksQuery,
  useTaskDetailsQuery,
  useCreateTaskMutation,
  useUpdateTaskStatusMutation,
  useCasesQuery,
  useCaseDetailsQuery,
  useCreateCaseMutation,

  /* Workflow */
  useExecuteWorkflowMutation,
  useWorkflowSimulationQuery,

  /* Admin views */
  useAdminTaskOverviewQuery,
  useAdminCaseOverviewQuery,

  /* Config & profiles */
  useGlobalConfigQuery,
  useUpdateServiceConfigMutation,
  useOrgProfilesQuery,
  useProfilePreviewMutation,
  useFeatureFlagsQuery,

  /* Notifications */
  useNotificationsFeedQuery,

  /* Domain modules */
  useRegisterMaintenanceIncidentMutation,
  useMaintenanceIncidentsQuery,
  useRegisterHrReportMutation,
  useHrCasesQuery,
  useRegisterStudentIncidentMutation,
  useEducationIncidentsQuery,

  /* Insights */
  useTaskVolumeReportQuery,
  useSlaBreachReportQuery,
  useProfileScoreReportQuery,
  useInsightsOverviewQuery,
} = orgoApi;
