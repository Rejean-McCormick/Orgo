import React, { useCallback, useEffect, useState } from 'react';

type Timeframe = '7d' | '30d' | '90d';

export interface InsightsMetric {
  id: string;
  label: string;
  value: number;
  formattedValue?: string;
  /**
   * Percentage change vs previous comparable period.
   * Example: 0.12 for +12%, -0.05 for -5%.
   */
  changePercent?: number | null;
}

export interface TimeSeriesPoint {
  /**
   * ISO 8601 date string, e.g. "2025-01-15".
   */
  date: string;
  value: number;
}

export interface InsightsOverview {
  timeframe: Timeframe;
  metrics: InsightsMetric[];
  primaryTrend: TimeSeriesPoint[];
  secondaryTrend?: TimeSeriesPoint[];
  /**
   * ISO timestamp when this snapshot was generated.
   */
  generatedAt?: string;
}

interface UseInsightsOverviewResult {
  data: InsightsOverview | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export const InsightsOverviewPage: React.FC = () => {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d');
  const { data, loading, error, refetch } = useInsightsOverview(timeframe);

  const hasMetrics = !!data && data.metrics.length > 0;
  const hasTrend = !!data && data.primaryTrend && data.primaryTrend.length > 0;

  return (
    <div className="insights-page">
      <header className="insights-page__header">
        <div className="insights-page__heading">
          <h1 className="insights-page__title">Insights overview</h1>
          <p className="insights-page__subtitle">
            High‑level product usage metrics and trends for your workspace.
          </p>
        </div>

        <div className="insights-page__controls">
          <TimeframeSelect value={timeframe} onChange={setTimeframe} />
        </div>
      </header>

      {loading && !data && <LoadingState />}

      {!loading && error && (
        <ErrorState message={error.message} onRetry={refetch} />
      )}

      {!loading && !error && !hasMetrics && (
        <EmptyState />
      )}

      {!loading && !error && data && hasMetrics && (
        <>
          <MetricsGrid
            metrics={data.metrics}
            generatedAt={data.generatedAt}
          />

          <section className="insights-page__section">
            <div className="insights-page__section-header">
              <h2 className="insights-page__section-title">Activity over time</h2>
              {hasTrend && (
                <p className="insights-page__section-subtitle">
                  {formatDateRangeFromPoints(data.primaryTrend)}
                </p>
              )}
            </div>

            {hasTrend ? (
              <TrendChart points={data.primaryTrend} />
            ) : (
              <div className="insights-page__section-empty">
                <p>No trend data available for the selected timeframe.</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default InsightsOverviewPage;

function TimeframeSelect(props: {
  value: Timeframe;
  onChange: (value: Timeframe) => void;
}) {
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    props.onChange(event.target.value as Timeframe);
  };

  return (
    <label className="insights-timeframe-select">
      <span className="insights-timeframe-select__label">Timeframe</span>
      <select
        className="insights-timeframe-select__control"
        value={props.value}
        onChange={handleChange}
      >
        {TIMEFRAME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetricsGrid(props: {
  metrics: InsightsMetric[];
  generatedAt?: string;
}) {
  return (
    <section className="insights-page__section">
      <div className="insights-page__section-header">
        <h2 className="insights-page__section-title">Key metrics</h2>
        {props.generatedAt && (
          <p className="insights-page__section-subtitle">
            Last updated {formatRelativeDateTime(props.generatedAt)}
          </p>
        )}
      </div>

      <div className="insights-metrics-grid">
        {props.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function MetricCard(props: { metric: InsightsMetric }) {
  const { metric } = props;
  const hasChange =
    typeof metric.changePercent === 'number' &&
    !Number.isNaN(metric.changePercent);

  const changeLabel = hasChange
    ? formatPercent(metric.changePercent as number)
    : null;

  const changePositive =
    hasChange && (metric.changePercent as number) > 0;

  const changeNegative =
    hasChange && (metric.changePercent as number) < 0;

  const changeClassName = [
    'insights-metric-card__change',
    changePositive && 'insights-metric-card__change--positive',
    changeNegative && 'insights-metric-card__change--negative',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className="insights-metric-card">
      <header className="insights-metric-card__header">
        <span className="insights-metric-card__label">
          {metric.label}
        </span>
      </header>

      <div className="insights-metric-card__value">
        {metric.formattedValue ?? metric.value.toLocaleString()}
      </div>

      {hasChange && changeLabel && (
        <div className={changeClassName}>
          <span className="insights-metric-card__change-value">
            {changeLabel}
          </span>
          <span className="insights-metric-card__change-caption">
            vs previous period
          </span>
        </div>
      )}
    </article>
  );
}

function TrendChart(props: { points: TimeSeriesPoint[] }) {
  const { points } = props;

  if (!points.length) {
    return null;
  }

  const sortedPoints = [...points].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const values = sortedPoints.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const width = 100;
  const height = 40;

  const pathD = sortedPoints
    .map((point, index) => {
      const x =
        (index / Math.max(sortedPoints.length - 1, 1)) * width;
      const y =
        height -
        ((point.value - min) / range) * height;

      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <div className="insights-chart">
      <svg
        className="insights-chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <path
          d={pathD}
          className="insights-chart__line"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="insights-chart__axis insights-chart__axis--x">
        <span className="insights-chart__axis-label">
          {formatShortDate(sortedPoints[0].date)}
        </span>
        <span className="insights-chart__axis-label insights-chart__axis-label--end">
          {formatShortDate(
            sortedPoints[sortedPoints.length - 1].date,
          )}
        </span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="insights-state insights-state--loading">
      <div className="insights-state__content">
        <div className="insights-state__spinner" aria-hidden="true" />
        <div className="insights-state__text">
          <h2 className="insights-state__title">Loading insights</h2>
          <p className="insights-state__description">
            Fetching your latest metrics and trends…
          </p>
        </div>
      </div>
    </section>
  );
}

function ErrorState(props: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="insights-state insights-state--error">
      <div className="insights-state__content">
        <h2 className="insights-state__title">
          Unable to load insights
        </h2>
        <p className="insights-state__description">
          {props.message || 'Something went wrong while fetching data.'}
        </p>
        <button
          type="button"
          className="insights-state__action"
          onClick={props.onRetry}
        >
          Try again
        </button>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="insights-state insights-state--empty">
      <div className="insights-state__content">
        <h2 className="insights-state__title">No insights yet</h2>
        <p className="insights-state__description">
          We haven&apos;t generated insights for this workspace and
          timeframe yet. Try expanding the timeframe or check back
          later once more data is available.
        </p>
      </div>
    </section>
  );
}

/**
 * Data fetching hook for the overview.
 *
 * This uses the Fetch API directly so it does not depend on a specific
 * query library. If your app uses React Query / SWR / etc., you can
 * replace the internals with your standard pattern.
 */
function useInsightsOverview(timeframe: Timeframe): UseInsightsOverviewResult {
  const [data, setData] = useState<InsightsOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const refetch = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/admin/insights/overview?timeframe=${encodeURIComponent(
            timeframe,
          )}`,
        );

        if (!response.ok) {
          throw new Error('Failed to load insights overview');
        }

        const json = (await response.json()) as InsightsOverview;

        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err
              : new Error('Unknown error while loading insights'),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [timeframe, reloadToken]);

  return { data, loading, error, refetch };
}

/**
 * Helpers
 */

function formatRelativeDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.round(diffMs / (1000 * 60));

  if (diffMinutes < 1) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatShortDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatDateRangeFromPoints(points: TimeSeriesPoint[]): string {
  if (!points.length) {
    return '';
  }

  const sorted = [...points].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const start = new Date(sorted[0].date);
  const end = new Date(sorted[sorted.length - 1].date);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return '';
  }

  const sameYear = start.getFullYear() === end.getFullYear();

  const formatter = new Intl.DateTimeFormat(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });

  return `${formatter.format(start)} – ${formatter.format(end)}`;
}
