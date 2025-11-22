// apps/web/src/screens/insights/InsightsOverviewPage.tsx

import React, { useMemo, useState } from "react";
import { useInsightsOverviewQuery } from "../../store/services/orgoApi";

type TaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "FAILED"
  | "ESCALATED"
  | "CANCELLED";

type TimeFilter = "7d" | "30d" | "90d" | "180d" | "365d" | "all";

/**
 * One bucket in the task volume report – counts per day and status.
 * Mirrors the backend TaskVolumeBucket shape from the reports service.
 */
interface TaskVolumeBucket {
  date: string; // ISO date (YYYY-MM-DD)
  status: TaskStatus;
  count: number;
}

/**
 * Aggregated SLA breach data per domain (Task.type).
 * Mirrors the backend SlaBreachRow shape.
 */
interface SlaBreachRow {
  domainType: string;
  totalTasks: number;
  breachedTasks: number;
  breachRate: number; // 0–1
}

/**
 * Overall profile effectiveness score plus per-domain breakdown.
 * Mirrors the backend ProfileScore shape.
 */
interface ProfileScore {
  organizationId: string;
  fromDate: string; // ISO date (YYYY-MM-DD)
  toDate: string; // ISO date (YYYY-MM-DD)
  overallTasks: number;
  overallBreachedTasks: number;
  overallScore: number; // 0–100, 100 = no breaches
  perDomain: SlaBreachRow[];
}

/**
 * Combined payload returned by useInsightsOverviewQuery.
 * The orgoApi slice should implement this shape.
 */
interface InsightsOverviewResponse {
  taskVolume: TaskVolumeBucket[];
  profileScore: ProfileScore | null;
}

/**
 * Query args passed to useInsightsOverviewQuery.
 * The orgoApi slice should accept this shape and translate it to
 * the underlying reporting API (task volume + profile score).
 */
interface InsightsOverviewQueryArgs {
  /**
   * Lookback window in days (e.g. 7, 30, 90). When omitted, the
   * backend should apply its default window (e.g. 30 days).
   */
  windowDays?: number;
  /**
   * Optional domain type filter (e.g. "maintenance", "hr_case").
   * Used consistently across volume and SLA/profile reports.
   */
  type?: string;
}

interface DailyVolume {
  date: string; // ISO date (YYYY-MM-DD)
  total: number;
}

const UNRESOLVED_STATUSES: TaskStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "ON_HOLD",
  "ESCALATED",
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

function buildDailyVolume(buckets: TaskVolumeBucket[]): DailyVolume[] {
  const map = new Map<string, number>();

  for (const bucket of buckets) {
    const current = map.get(bucket.date) ?? 0;
    map.set(bucket.date, current + bucket.count);
  }

  return Array.from(map.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function formatShortDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(from?: string, to?: string): string {
  if (!from && !to) return "—";
  const fromLabel = from ? formatShortDate(from) : "…";
  const toLabel = to ? formatShortDate(to) : "…";
  if (fromLabel === toLabel) return fromLabel;
  return `${fromLabel} – ${toLabel}`;
}

function formatPercent(value: number | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value * 100;
  return `${pct.toFixed(digits)}%`;
}

function getScoreLabel(score: number | undefined): string {
  if (score == null || Number.isNaN(score)) return "Unknown";
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Watch";
  return "At risk";
}

function getScoreBadgeClasses(score: number | undefined): string {
  if (score == null || Number.isNaN(score)) {
    return "bg-gray-100 text-gray-700";
  }
  if (score >= 90) {
    return "bg-green-100 text-green-800";
  }
  if (score >= 75) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (score >= 60) {
    return "bg-yellow-100 text-yellow-800";
  }
  return "bg-red-100 text-red-800";
}

function getBreachBadgeClasses(rate: number): string {
  if (rate >= 0.4) return "bg-red-100 text-red-800";
  if (rate >= 0.25) return "bg-orange-100 text-orange-800";
  if (rate >= 0.1) return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-800";
}

const InsightsOverviewPage: React.FC = () => {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("30d");
  const [domainType, setDomainType] = useState("");

  const queryArgs: InsightsOverviewQueryArgs = useMemo(() => {
    const args: InsightsOverviewQueryArgs = {};
    const windowDays = timeFilterToDays(timeFilter);
    if (typeof windowDays === "number") {
      args.windowDays = windowDays;
    }
    const trimmedType = domainType.trim();
    if (trimmedType.length > 0) {
      args.type = trimmedType;
    }
    return args;
  }, [timeFilter, domainType]);

  // Cast to the expected response type for local usage; the orgoApi slice
  // should be implemented so that this cast matches the real response.
  const { data, isLoading, isError, isFetching, refetch } =
    useInsightsOverviewQuery(queryArgs) as {
      data?: InsightsOverviewResponse;
      isLoading: boolean;
      isError: boolean;
      isFetching: boolean;
      refetch: () => void;
    };

  const taskVolume = data?.taskVolume ?? [];
  const profileScore = data?.profileScore ?? null;

  const dailyVolume = useMemo(
    () => buildDailyVolume(taskVolume),
    [taskVolume]
  );

  const maxDailyVolume = useMemo(
    () =>
      dailyVolume.reduce(
        (max, bucket) => (bucket.total > max ? bucket.total : max),
        0
      ),
    [dailyVolume]
  );

  const {
    totalTasksInWindow,
    unresolvedApprox,
    breachRate,
    highRiskDomainCount,
  } = useMemo(() => {
    const totalTasks = taskVolume.reduce(
      (sum, bucket) => sum + bucket.count,
      0
    );

    const unresolvedApproxCount = taskVolume.reduce(
      (sum, bucket) =>
        UNRESOLVED_STATUSES.includes(bucket.status)
          ? sum + bucket.count
          : sum,
      0
    );

    const overallTasks =
      profileScore?.overallTasks && profileScore.overallTasks > 0
        ? profileScore.overallTasks
        : totalTasks;

    const overallBreached = profileScore?.overallBreachedTasks ?? 0;
    const rate =
      overallTasks > 0 ? overallBreached / overallTasks : 0;

    const highRiskDomains =
      profileScore?.perDomain?.filter(
        (row) => row.breachRate >= 0.25
      ).length ?? 0;

    return {
      totalTasksInWindow: overallTasks,
      unresolvedApprox: unresolvedApproxCount,
      breachRate: rate,
      highRiskDomainCount: highRiskDomains,
    };
  }, [taskVolume, profileScore]);

  const perDomain = useMemo(() => {
    const rows = profileScore?.perDomain ?? [];
    return [...rows].sort(
      (a, b) => b.breachRate - a.breachRate
    );
  }, [profileScore]);

  const hasAnyData =
    dailyVolume.length > 0 ||
    (profileScore != null &&
      (profileScore.overallTasks > 0 ||
        profileScore.perDomain.length > 0));

  return (
    <div className="px-6 py-4">
      <header className="mb-4 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Insights overview
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Task volume, SLA health and profile effectiveness for
            this organization.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="insights-window"
              className="text-xs font-medium text-gray-700"
            >
              Window
            </label>
            <select
              id="insights-window"
              value={timeFilter}
              onChange={(event) =>
                setTimeFilter(
                  event.target.value as TimeFilter
                )
              }
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="180d">Last 180 days</option>
              <option value="365d">Last 12 months</option>
              <option value="all">All available</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="insights-domain-type"
              className="text-xs font-medium text-gray-700"
            >
              Domain type
            </label>
            <input
              id="insights-domain-type"
              type="text"
              value={domainType}
              onChange={(event) =>
                setDomainType(event.target.value)
              }
              placeholder='e.g. "maintenance", "hr_case"'
              className="w-44 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </header>

      {isError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Failed to load insights. Please try again or adjust
          the filters.
        </div>
      )}

      {isLoading && !hasAnyData && (
        <div className="mb-4 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
          Loading insights…
        </div>
      )}

      {/* Summary cards */}
      {hasAnyData && (
        <section
          aria-label="Insights overview summary"
          className="mb-4 grid gap-3 md:grid-cols-4"
        >
          <div className="rounded-md border border-gray-200 bg-white p-4">
            <div className="text-xs font-medium uppercase text-gray-500">
              Tasks in window
            </div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">
              {totalTasksInWindow}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Across all included domains
            </div>
          </div>

          <div className="rounded-md border border-yellow-100 bg-yellow-50 p-4">
            <div className="text-xs font-medium uppercase text-yellow-800">
              Unresolved (approx.)
            </div>
            <div className="mt-1 text-2xl font-semibold text-yellow-900">
              {unresolvedApprox}
            </div>
            <div className="mt-1 text-xs text-yellow-900">
              Based on current status distribution
            </div>
          </div>

          <div className="rounded-md border border-red-100 bg-red-50 p-4">
            <div className="text-xs font-medium uppercase text-red-800">
              SLA breach rate
            </div>
            <div className="mt-1 text-2xl font-semibold text-red-900">
              {formatPercent(breachRate, 1)}
            </div>
            <div className="mt-1 text-xs text-red-900">
              Share of tasks breaching profile SLAs
            </div>
          </div>

          <div className="rounded-md border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase text-gray-500">
                Profile score
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${getScoreBadgeClasses(
                  profileScore?.overallScore
                )}`}
              >
                {getScoreLabel(profileScore?.overallScore)}
              </span>
            </div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">
              {profileScore?.overallScore ?? "—"}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {highRiskDomainCount > 0
                ? `${highRiskDomainCount} domain${
                    highRiskDomainCount === 1 ? "" : "s"
                  } with breach rate ≥ 25%`
                : "No high‑risk domains in this window"}
            </div>
          </div>
        </section>
      )}

      {/* Task volume over time */}
      {hasAnyData && (
        <section className="mb-4 rounded-md border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Task volume over time
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Tasks created per day in the selected window.
              </p>
            </div>
            {profileScore && (
              <p className="text-xs text-gray-500">
                Window:{" "}
                {formatDateRange(
                  profileScore.fromDate,
                  profileScore.toDate
                )}
              </p>
            )}
          </div>

          {dailyVolume.length === 0 ? (
            <p className="text-xs text-gray-500">
              No tasks in this window yet.
            </p>
          ) : (
            <div className="space-y-2">
              {dailyVolume.map((bucket) => {
                const widthPct =
                  maxDailyVolume > 0
                    ? (bucket.total / maxDailyVolume) * 100
                    : 0;
                return (
                  <div
                    key={bucket.date}
                    className="flex items-center gap-2"
                  >
                    <div className="w-16 text-xs text-gray-500">
                      {formatShortDate(bucket.date)}
                    </div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-indigo-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-10 text-right text-xs text-gray-700">
                      {bucket.total}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SLA / domain risk breakdown */}
      {hasAnyData && (
        <section
          aria-label="SLA and domain risk"
          className="mb-4 rounded-md border border-gray-200 bg-white p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                SLA breaches by domain
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Domains are ordered by highest breach rate first.
              </p>
            </div>
          </div>

          {perDomain.length === 0 ? (
            <p className="text-xs text-gray-500">
              No SLA breach data for this window. This usually means
              there are few or no tasks in scope.
            </p>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="min-w-full table-fixed border-t border-gray-100 text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Domain
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Tasks
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Breached
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Breach rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perDomain.map((row) => (
                    <tr
                      key={row.domainType}
                      className="border-t border-gray-100"
                    >
                      <td className="px-4 py-2 align-top text-sm text-gray-900">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {row.domainType || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-900">
                        {row.totalTasks}
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-900">
                        {row.breachedTasks}
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-900">
                        <span
                          className={`inline-flex items-center justify-end rounded-full px-2 py-0.5 text-xs font-medium ${getBreachBadgeClasses(
                            row.breachRate
                          )}`}
                        >
                          {formatPercent(row.breachRate, 1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!isLoading && !isError && !hasAnyData && (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
          No insights are available yet for this organization and
          filter combination.
        </div>
      )}

      {isFetching && !isLoading && (
        <div className="mt-2 text-xs text-gray-500">
          Updating…
        </div>
      )}
    </div>
  );
};

export default InsightsOverviewPage;
