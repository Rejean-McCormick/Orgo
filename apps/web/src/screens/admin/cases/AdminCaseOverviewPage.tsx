import React from "react";
import { useAdminCaseOverviewQuery } from "../../../store/services/orgoApi";

type CaseStatus = "open" | "in_progress" | "resolved" | "archived";

type CaseSeverity = "minor" | "moderate" | "major" | "critical";

type TimeFilter = "all" | "7d" | "30d" | "90d" | "180d" | "365d";

export interface AdminCaseOverviewCase {
  case_id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  label: string;
  status: CaseStatus;
  severity: CaseSeverity;
  source_type: "email" | "api" | "manual" | "sync";
  reactivity_time?: string | null;
  reactivity_deadline_at?: string | null;
  created_at: string;
  updated_at: string;
  open_tasks_count?: number;
  overdue_tasks_count?: number;
  profile_key?: string;
}

export interface AdminCaseOverviewResponse {
  cases: AdminCaseOverviewCase[];
  totalCount: number;
}

export interface AdminCaseOverviewQueryArgs {
  status?: CaseStatus;
  severity?: CaseSeverity;
  search?: string;
  profileKey?: string;
  windowDays?: number;
}

interface SummaryCounts {
  total: number;
  unresolved: number;
  overdue: number;
  critical: number;
}

const unresolvedStatuses: CaseStatus[] = [
  "open",
  "in_progress",
];

function timeFilterToDays(value: TimeFilter): number | undefined {
  switch (value) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "180d":
      return 180;
    case "365d":
      return 365;
    case "all":
    default:
      return undefined;
  }
}

function formatDate(dateString?: string | null): string {
  if (!dateString) {
    return "—";
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleString();
}

function formatStatusLabel(status: CaseStatus): string {
  if (status === "in_progress") {
    return "in progress";
  }
  return status;
}

function getStatusBadgeClasses(status: CaseStatus): string {
  switch (status) {
    case "open":
      return "bg-yellow-100 text-yellow-800";
    case "in_progress":
      return "bg-blue-100 text-blue-800";
    case "resolved":
      return "bg-green-100 text-green-800";
    case "archived":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getSeverityBadgeClasses(severity: CaseSeverity): string {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-800";
    case "major":
      return "bg-orange-100 text-orange-800";
    case "moderate":
      return "bg-yellow-100 text-yellow-800";
    case "minor":
    default:
      return "bg-blue-100 text-blue-800";
  }
}

type TableCellProps = React.PropsWithChildren<{ className?: string }>;

function Th({ children, className = "" }: TableCellProps) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: TableCellProps) {
  return (
    <td className={`px-4 py-3 align-top text-sm text-gray-900 ${className}`}>
      {children}
    </td>
  );
}

const Badge: React.FC<{ className?: string }> = ({
  className = "",
  children,
}) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
  >
    {children}
  </span>
);

function buildSummary(cases: AdminCaseOverviewCase[]): SummaryCounts {
  const now = Date.now();

  let total = 0;
  let unresolved = 0;
  let overdue = 0;
  let critical = 0;

  for (const c of cases) {
    total += 1;

    const isUnresolved = unresolvedStatuses.includes(c.status);
    if (isUnresolved) {
      unresolved += 1;
    }

    if (c.severity === "critical") {
      critical += 1;
    }

    if (isUnresolved && c.reactivity_deadline_at) {
      const deadline = new Date(c.reactivity_deadline_at).getTime();
      if (!Number.isNaN(deadline) && deadline < now) {
        overdue += 1;
      }
    }
  }

  return { total, unresolved, overdue, critical };
}

export function AdminCaseOverviewPage() {
  const [statusFilter, setStatusFilter] = React.useState<
    "all" | CaseStatus
  >("open");
  const [severityFilter, setSeverityFilter] = React.useState<
    "all" | CaseSeverity
  >("all");
  const [timeFilter, setTimeFilter] =
    React.useState<TimeFilter>("30d");
  const [searchTerm, setSearchTerm] = React.useState("");

  const queryArgs: AdminCaseOverviewQueryArgs =
    React.useMemo(() => {
      const args: AdminCaseOverviewQueryArgs = {};

      if (statusFilter !== "all") {
        args.status = statusFilter;
      }

      if (severityFilter !== "all") {
        args.severity = severityFilter;
      }

      const trimmedSearch = searchTerm.trim();
      if (trimmedSearch.length > 0) {
        args.search = trimmedSearch;
      }

      const windowDays = timeFilterToDays(timeFilter);
      if (typeof windowDays === "number") {
        args.windowDays = windowDays;
      }

      return args;
    }, [statusFilter, severityFilter, timeFilter, searchTerm]);

  const { data, isLoading, isFetching, isError, refetch } =
    useAdminCaseOverviewQuery(queryArgs);

  const cases: AdminCaseOverviewCase[] = (
    data?.cases ?? []
  ) as AdminCaseOverviewCase[];

  const summary = React.useMemo(
    () => buildSummary(cases),
    [cases]
  );

  const totalCount =
    typeof data?.totalCount === "number"
      ? data.totalCount
      : cases.length;

  return (
    <div className="px-6 py-4">
      <header className="mb-4 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Case overview
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            High-level view of Cases for cyclic reviews and
            systemic follow-up.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </header>

      <section
        aria-label="Case overview summary"
        className="mb-4 grid gap-3 md:grid-cols-4"
      >
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium uppercase text-gray-500">
            Total cases
          </div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {summary.total}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Across all profiles and labels
          </div>
        </div>
        <div className="rounded-md border border-yellow-100 bg-yellow-50 p-4">
          <div className="text-xs font-medium uppercase text-yellow-800">
            Unresolved
          </div>
          <div className="mt-1 text-2xl font-semibold text-yellow-900">
            {summary.unresolved}
          </div>
          <div className="mt-1 text-xs text-yellow-900">
            Open or in progress
          </div>
        </div>
        <div className="rounded-md border border-red-100 bg-red-50 p-4">
          <div className="text-xs font-medium uppercase text-red-800">
            Overdue (by reactivity)
          </div>
          <div className="mt-1 text-2xl font-semibold text-red-900">
            {summary.overdue}
          </div>
          <div className="mt-1 text-xs text-red-900">
            Past reactivity deadline and unresolved
          </div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium uppercase text-gray-500">
            Critical severity
          </div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {summary.critical}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Cases marked as critical
          </div>
        </div>
      </section>

      <section
        aria-label="Filters"
        className="mb-4 grid gap-3 rounded-md border border-gray-200 bg-white p-4 md:grid-cols-4"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="case-search"
            className="text-xs font-medium text-gray-700"
          >
            Search
          </label>
          <input
            id="case-search"
            type="search"
            placeholder="Title, label, ID…"
            value={searchTerm}
            onChange={(event) =>
              setSearchTerm(event.target.value)
            }
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="case-status-filter"
            className="text-xs font-medium text-gray-700"
          >
            Status
          </label>
          <select
            id="case-status-filter"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target
                  .value as "all" | CaseStatus
              )
            }
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="case-severity-filter"
            className="text-xs font-medium text-gray-700"
          >
            Severity
          </label>
          <select
            id="case-severity-filter"
            value={severityFilter}
            onChange={(event) =>
              setSeverityFilter(
                event.target
                  .value as "all" | CaseSeverity
              )
            }
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All severities</option>
            <option value="minor">Minor</option>
            <option value="moderate">Moderate</option>
            <option value="major">Major</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="case-window-filter"
            className="text-xs font-medium text-gray-700"
          >
            Time window
          </label>
          <select
            id="case-window-filter"
            value={timeFilter}
            onChange={(event) =>
              setTimeFilter(
                event.target.value as TimeFilter
              )
            }
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="30d">
              Last 30 days
            </option>
            <option value="7d">Last 7 days</option>
            <option value="90d">
              Last 90 days
            </option>
            <option value="180d">
              Last 180 days
            </option>
            <option value="365d">
              Last 365 days
            </option>
            <option value="all">All time</option>
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-6 text-sm text-gray-600">
            Loading cases…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-4 p-6 text-sm text-red-700">
            <span>
              Unable to load cases. Please try again.
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        ) : cases.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">
            No cases match your filters.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-xs text-gray-600">
              <span>
                Showing{" "}
                <span className="font-medium">
                  {cases.length}
                </span>{" "}
                of{" "}
                <span className="font-medium">
                  {totalCount}
                </span>{" "}
                cases
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Case</Th>
                    <Th>Label</Th>
                    <Th>Status</Th>
                    <Th>Severity</Th>
                    <Th>Open / overdue tasks</Th>
                    <Th>Created</Th>
                    <Th>Last updated</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {cases.map((c) => (
                    <tr key={c.case_id}>
                      <Td className="max-w-xs">
                        <div className="flex flex-col">
                          <span className="truncate text-sm font-medium text-gray-900">
                            {c.title}
                          </span>
                          <span className="mt-0.5 text-xs text-gray-500">
                            #{c.case_id.slice(0, 8)} ·{" "}
                            {c.source_type}
                          </span>
                        </div>
                      </Td>
                      <Td className="max-w-xs">
                        <div className="flex flex-col">
                          <span className="truncate text-xs text-gray-700">
                            {c.label}
                          </span>
                          {c.profile_key && (
                            <span className="mt-0.5 text-xs text-gray-400">
                              Profile: {c.profile_key}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <Badge
                          className={getStatusBadgeClasses(
                            c.status
                          )}
                        >
                          {formatStatusLabel(c.status)}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge
                          className={getSeverityBadgeClasses(
                            c.severity
                          )}
                        >
                          {c.severity}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex flex-col text-xs">
                          <span>
                            Open:{" "}
                            {typeof c.open_tasks_count ===
                            "number"
                              ? c.open_tasks_count
                              : "—"}
                          </span>
                          <span>
                            Overdue:{" "}
                            {typeof c.overdue_tasks_count ===
                            "number"
                              ? c.overdue_tasks_count
                              : "—"}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-xs text-gray-700">
                          {formatDate(c.created_at)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs text-gray-700">
                          {formatDate(c.updated_at)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {isFetching && !isLoading && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
            Updating…
          </div>
        )}
      </section>
    </div>
  );
}

export default AdminCaseOverviewPage;
