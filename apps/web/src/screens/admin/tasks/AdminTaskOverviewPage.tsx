import { useMemo, useState, ChangeEvent } from "react";
import { useAdminTaskOverviewQuery } from "../../../store/services/orgoApi";

type TaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "FAILED"
  | "ESCALATED"
  | "CANCELLED";

type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type TaskSeverity = "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL";

type TaskCategory = "request" | "incident" | "update" | "report" | "distribution";

type FilterStatusOption = TaskStatus | "ALL";
type FilterPriorityOption = TaskPriority | "ALL";
type FilterSeverityOption = TaskSeverity | "ALL";
type FilterCategoryOption = TaskCategory | "ALL";

interface AdminTaskOverviewFilters {
  status: FilterStatusOption;
  priority: FilterPriorityOption;
  severity: FilterSeverityOption;
  category: FilterCategoryOption;
  type: string; // domain type, e.g. "maintenance", "hr_case"
  role: string; // assignee/owner role label
  labelSearch: string; // free‑text search over label/title
}

interface AdminTaskOverviewTask {
  task_id: string;
  organization_id: string;
  case_id: string | null;
  source: "email" | "api" | "manual" | "sync";
  type: string;
  category: TaskCategory;
  label: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "ANONYMISED";
  assignee_role: string | null;
  owner_role_id: string | null;
  owner_user_id: string | null;
  reactivity_deadline_at: string | null;
  created_at: string;
}

interface AdminTaskOverviewResponse {
  tasks: AdminTaskOverviewTask[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Query args passed to useAdminTaskOverviewQuery.
 * The orgoApi slice should accept this shape and translate it
 * to the backend /api/v3/tasks admin listing with filters.
 */
interface AdminTaskOverviewQueryArgs {
  page: number;
  pageSize: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  severity?: TaskSeverity;
  category?: TaskCategory;
  type?: string;
  role?: string;
  labelSearch?: string;
}

const DEFAULT_PAGE_SIZE = 25;

const STATUS_OPTIONS: FilterStatusOption[] = [
  "ALL",
  "PENDING",
  "IN_PROGRESS",
  "ON_HOLD",
  "ESCALATED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

const PRIORITY_OPTIONS: FilterPriorityOption[] = ["ALL", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

const SEVERITY_OPTIONS: FilterSeverityOption[] = ["ALL", "MINOR", "MODERATE", "MAJOR", "CRITICAL"];

const CATEGORY_OPTIONS: FilterCategoryOption[] = [
  "ALL",
  "request",
  "incident",
  "update",
  "report",
  "distribution",
];

function getStatusBadgeClasses(status: TaskStatus): string {
  switch (status) {
    case "PENDING":
      return "bg-gray-100 text-gray-800";
    case "IN_PROGRESS":
      return "bg-blue-100 text-blue-800";
    case "ON_HOLD":
      return "bg-yellow-100 text-yellow-800";
    case "ESCALATED":
      return "bg-red-100 text-red-800 border border-red-300";
    case "COMPLETED":
      return "bg-green-100 text-green-800";
    case "FAILED":
      return "bg-red-100 text-red-800";
    case "CANCELLED":
      return "bg-gray-200 text-gray-700";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getPriorityBadgeClasses(priority: TaskPriority): string {
  switch (priority) {
    case "LOW":
      return "bg-gray-100 text-gray-800";
    case "MEDIUM":
      return "bg-sky-100 text-sky-800";
    case "HIGH":
      return "bg-orange-100 text-orange-800";
    case "CRITICAL":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getSeverityBadgeClasses(severity: TaskSeverity): string {
  switch (severity) {
    case "MINOR":
      return "bg-gray-100 text-gray-800";
    case "MODERATE":
      return "bg-amber-100 text-amber-800";
    case "MAJOR":
      return "bg-orange-100 text-orange-800";
    case "CRITICAL":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function isUnresolvedStatus(status: TaskStatus): boolean {
  return ["PENDING", "IN_PROGRESS", "ON_HOLD", "ESCALATED"].includes(status);
}

function isOverdue(task: AdminTaskOverviewTask): boolean {
  if (!task.reactivity_deadline_at) return false;
  if (!isUnresolvedStatus(task.status)) return false;
  const deadline = new Date(task.reactivity_deadline_at).getTime();
  if (Number.isNaN(deadline)) return false;
  return Date.now() > deadline;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function truncateLabel(label: string, max = 40): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

const AdminTaskOverviewPage = () => {
  const [filters, setFilters] = useState<AdminTaskOverviewFilters>({
    status: "ALL",
    priority: "ALL",
    severity: "ALL",
    category: "ALL",
    type: "",
    role: "",
    labelSearch: "",
  });

  const [page, setPage] = useState(1);

  const queryArgs: AdminTaskOverviewQueryArgs = useMemo(() => {
    const args: AdminTaskOverviewQueryArgs = {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    };

    if (filters.status !== "ALL") {
      args.status = filters.status;
    }

    if (filters.priority !== "ALL") {
      args.priority = filters.priority;
    }

    if (filters.severity !== "ALL") {
      args.severity = filters.severity;
    }

    if (filters.category !== "ALL") {
      args.category = filters.category;
    }

    if (filters.type.trim()) {
      args.type = filters.type.trim();
    }

    if (filters.role.trim()) {
      args.role = filters.role.trim();
    }

    if (filters.labelSearch.trim()) {
      args.labelSearch = filters.labelSearch.trim();
    }

    return args;
  }, [filters, page]);

  // Cast to the expected response type for local usage; the orgoApi slice
  // should be implemented so that this cast matches the real response.
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useAdminTaskOverviewQuery(queryArgs) as {
    data?: AdminTaskOverviewResponse;
    isLoading: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => void;
  };

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? DEFAULT_PAGE_SIZE;
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  const { openCount, overdueCount } = useMemo(() => {
    let open = 0;
    let overdue = 0;
    for (const t of tasks) {
      if (isUnresolvedStatus(t.status)) {
        open += 1;
        if (isOverdue(t)) {
          overdue += 1;
        }
      }
    }
    return { openCount: open, overdueCount: overdue };
  }, [tasks]);

  const handleSelectChange =
    <K extends keyof AdminTaskOverviewFilters>(key: K) =>
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as AdminTaskOverviewFilters[K];
      setPage(1);
      setFilters((prev) => ({
        ...prev,
        [key]: value,
      }));
    };

  const handleInputChange =
    <K extends keyof AdminTaskOverviewFilters>(key: K) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value as AdminTaskOverviewFilters[K];
      setPage(1);
      setFilters((prev) => ({
        ...prev,
        [key]: value,
      }));
    };

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin Task Overview</h1>
          <p className="mt-1 text-sm text-gray-600">
            Cross-domain task queues with filters by status, domain type, label, role, priority, and
            severity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-gray-700" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={filters.status}
            onChange={handleSelectChange("status")}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All statuses" : option.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-gray-700" htmlFor="priority">
            Priority
          </label>
          <select
            id="priority"
            className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={filters.priority}
            onChange={handleSelectChange("priority")}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All priorities" : option}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-gray-700" htmlFor="severity">
            Severity
          </label>
          <select
            id="severity"
            className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={filters.severity}
            onChange={handleSelectChange("severity")}
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All severities" : option}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-gray-700" htmlFor="category">
            Category
          </label>
          <select
            id="category"
            className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={filters.category}
            onChange={handleSelectChange("category")}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "ALL"
                  ? "All categories"
                  : option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-gray-700" htmlFor="type">
            Domain type
          </label>
          <input
            id="type"
            type="text"
            placeholder="e.g. maintenance, hr_case"
            className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={filters.type}
            onChange={handleInputChange("type")}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-xs font-medium text-gray-700" htmlFor="role">
            Role or label search
          </label>
          <input
            id="role"
            type="text"
            placeholder="role or label fragment"
            className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={filters.labelSearch}
            onChange={handleInputChange("labelSearch")}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-700">
        <span>
          <span className="font-medium">{total}</span> tasks
        </span>
        <span className="hidden text-gray-400 sm:inline">•</span>
        <span>
          <span className="font-medium">{openCount}</span> unresolved
        </span>
        <span className="hidden text-gray-400 sm:inline">•</span>
        <span>
          <span className="font-medium">{overdueCount}</span> overdue by reactivity deadline
        </span>
        {isLoading && <span className="ml-auto text-xs text-gray-500">Loading…</span>}
        {isError && !isLoading && (
          <span className="ml-auto text-xs text-red-600">
            Error loading tasks. Try adjusting filters or refreshing.
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-700">Status</th>
              <th className="px-4 py-3 font-medium text-gray-700">Priority</th>
              <th className="px-4 py-3 font-medium text-gray-700">Severity</th>
              <th className="px-4 py-3 font-medium text-gray-700">Title</th>
              <th className="px-4 py-3 font-medium text-gray-700">Type / Category</th>
              <th className="px-4 py-3 font-medium text-gray-700">Label</th>
              <th className="px-4 py-3 font-medium text-gray-700">Assignee role</th>
              <th className="px-4 py-3 font-medium text-gray-700">React. deadline</th>
              <th className="px-4 py-3 font-medium text-gray-700">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading && tasks.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={9}>
                  Loading tasks…
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={9}>
                  No tasks match the current filters.
                </td>
              </tr>
            ) : (
              tasks.map((task) => {
                const overdue = isOverdue(task);
                return (
                  <tr key={task.task_id} className={overdue ? "bg-red-50" : undefined}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClasses(
                          task.status
                        )}`}
                      >
                        {task.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getPriorityBadgeClasses(
                          task.priority
                        )}`}
                      >
                        {task.priority}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getSeverityBadgeClasses(
                          task.severity
                        )}`}
                      >
                        {task.severity}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <div className="truncate text-sm text-gray-900">{task.title}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      <div className="flex flex-col">
                        <span className="font-medium">{task.type}</span>
                        <span className="text-xs text-gray-500">{task.category}</span>
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-sm text-gray-700">
                      <span title={task.label} className="block truncate">
                        {truncateLabel(task.label)}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-sm text-gray-700">
                      {task.assignee_role ? (
                        <span className="block truncate">{task.assignee_role}</span>
                      ) : (
                        <span className="text-gray-400">Unassigned</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      <div className="flex flex-col">
                        <span>{formatDate(task.reactivity_deadline_at)}</span>
                        {overdue && (
                          <span className="text-xs font-medium text-red-600">Overdue</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {formatDate(task.created_at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-gray-700 sm:flex-row">
        <div>
          Page{" "}
          <span className="font-medium">
            {Math.min(page, totalPages)} / {totalPages}
          </span>
          {total > 0 && (
            <span className="ml-2 text-gray-500">
              • Showing {(page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, total)} of {total}
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={() => canGoPrev && setPage((p) => p - 1)}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => canGoNext && setPage((p) => p + 1)}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminTaskOverviewPage;
