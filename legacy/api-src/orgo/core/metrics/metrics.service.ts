// apps/api/src/orgo/core/metrics/metrics.service.ts

import { Inject, Injectable, Optional } from '@nestjs/common';
import { LogCategory, LogLevel, LogService } from '../logging/log.service';
import {
  FN_METRICS_RECORD_QUEUE_DEPTH,
  FN_METRICS_RECORD_WORKFLOW_LATENCY,
} from '../functional-ids';

/**
 * Canonical environment values (Doc 2 – ENVIRONMENT).
 */
export type Environment = 'dev' | 'staging' | 'prod' | 'offline';

/**
 * Standard result error shape (Doc 5 §2.4).
 */
export interface StandardError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Standard result shape (ok / data / error) used across Core Services (Doc 5 §2.4).
 */
export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error: StandardError | null;
}

/**
 * Outcome of a workflow execution as used for latency metrics.
 */
export type WorkflowOutcome = 'success' | 'error' | 'timeout' | 'cancelled';

/**
 * Pluggable sink for metrics.
 *
 * Implementations can forward metrics to Prometheus, StatsD, OpenTelemetry, etc.
 */
export interface MetricsSink {
  /**
   * Record a latency/distribution metric (typically backed by a Histogram/Summary).
   */
  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): Promise<void> | void;

  /**
   * Record a gauge metric (current value).
   */
  setGauge(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): Promise<void> | void;
}

/**
 * Injection token for a pluggable MetricsSink implementation.
 *
 * A provider may bind to this token in a MetricsModule:
 *
 *   {
 *     provide: METRICS_SINK,
 *     useClass: PrometheusMetricsSink,
 *   }
 */
export const METRICS_SINK = 'metrics_sink';

/**
 * Input payload for recording per-workflow latency metrics.
 *
 * This is the logical payload expected from jobs such as
 * `orgo.metrics.record-workflow-latency`.
 */
export interface WorkflowLatencyMetricInput {
  /**
   * Stable workflow identifier (e.g. workflow definition code).
   */
  workflowId: string;

  /**
   * Total duration of the workflow execution in milliseconds.
   */
  durationMs: number;

  /**
   * Organization / tenant this execution belongs to, if applicable.
   */
  organizationId?: string;

  /**
   * Environment in which the workflow ran. If omitted, derived from ORGO_ENV / NODE_ENV.
   */
  environment?: string;

  /**
   * Outcome of the workflow execution.
   * Defaults to "success" if omitted.
   */
  outcome?: WorkflowOutcome;

  /**
   * Optional error code when outcome is not "success".
   */
  errorCode?: string;

  /**
   * Logical service or worker that executed the workflow (e.g. "workflow_engine").
   */
  serviceId?: string;

  /**
   * Concrete worker instance ID, if available.
   */
  workerId?: string;

  /**
   * When this latency measurement was captured.
   * Defaults to "now" if omitted.
   */
  timestamp?: Date | string;

  /**
   * Optional additional labels used for metrics backends.
   */
  labels?: Record<string, string>;

  /**
   * Free-form metadata added to logs only (not required by metrics backends).
   */
  metadata?: Record<string, unknown>;
}

/**
 * Normalised workflow-latency metric, as recorded by MetricsService.
 */
export interface WorkflowLatencyMetric {
  workflowId: string;
  durationMs: number;
  durationSeconds: number;
  organizationId?: string;
  environment: Environment;
  outcome: WorkflowOutcome;
  errorCode?: string;
  serviceId?: string;
  workerId?: string;
  timestamp: string; // ISO-8601 (UTC)
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Input describing one queue’s depth snapshot.
 *
 * Used by recordQueueDepth() to capture per-queue metrics for autoscaling/alerting.
 */
export interface QueueDepthSampleInput {
  /**
   * Stable queue name (e.g. "task_default", "email_outbound").
   */
  queueName: string;

  /**
   * Jobs waiting to be processed (ready jobs).
   */
  readyJobs?: number;

  /**
   * Jobs currently being processed by workers.
   */
  activeJobs?: number;

  /**
   * Jobs scheduled for the future / delayed.
   */
  delayedJobs?: number;

  /**
   * Jobs in failed state.
   */
  failedJobs?: number;

  /**
   * Approximate end-to-end lag for this queue in seconds, if available.
   */
  lagSeconds?: number | null;
}

/**
 * Normalised per-queue depth snapshot.
 */
export interface QueueDepthSample {
  queueName: string;
  readyJobs: number;
  activeJobs: number;
  delayedJobs: number;
  failedJobs: number;
  lagSeconds: number | null;
}

/**
 * Input payload for recording queue-depth metrics.
 *
 * Typically produced by a background job such as
 * `orgo.metrics.record-queue-depth`.
 */
export interface QueueDepthMetricInput {
  samples: QueueDepthSampleInput[];

  /**
   * Environment in which queues are running. If omitted, derived from ORGO_ENV / NODE_ENV.
   */
  environment?: string;

  /**
   * Logical service / worker group owning these queues (e.g. "task_worker").
   */
  serviceId?: string;

  /**
   * Optional organization scope; queues may be shared across orgs.
   */
  organizationId?: string;

  /**
   * When this snapshot was generated. Defaults to "now" if omitted.
   */
  timestamp?: Date | string;

  /**
   * Additional metadata to be attached to logs.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Normalised queue-depth snapshot as recorded by MetricsService.
 */
export interface QueueDepthMetric {
  environment: Environment;
  serviceId?: string;
  organizationId?: string;
  timestamp: string; // ISO-8601 (UTC)
  samples: QueueDepthSample[];
  summary: {
    totalQueues: number;
    totalReadyJobs: number;
    totalActiveJobs: number;
    totalDelayedJobs: number;
    totalFailedJobs: number;
  };
}

/**
 * MetricsService
 *
 * Core responsibilities:
 * - Record per-workflow latency metrics (recordWorkflowLatency).
 * - Record per-queue depth metrics (recordQueueDepth).
 * - Emit structured log events for observability pipelines.
 * - Optionally forward metrics to a pluggable MetricsSink (Prometheus, etc.).
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly logService: LogService,
    @Optional()
    @Inject(METRICS_SINK)
    private readonly metricsSink?: MetricsSink,
  ) {}

  /**
   * Record latency for a single workflow execution.
   *
   * This method normalises the environment and timestamp, logs a structured
   * SYSTEM event, and optionally forwards the measurement to a MetricsSink.
   */
  async recordWorkflowLatency(
    input: WorkflowLatencyMetricInput,
  ): Promise<StandardResult<WorkflowLatencyMetric>> {
    if (
      !input ||
      !input.workflowId ||
      !Number.isFinite(Number(input.durationMs)) ||
      Number(input.durationMs) < 0
    ) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'METRICS_WORKFLOW_LATENCY_INVALID_PAYLOAD',
          message:
            'workflowId and non-negative durationMs are required to record workflow latency.',
          details: { input },
        },
      };
    }

    const environment = this.resolveEnvironment(input.environment);
    const timestampDate = this.normaliseDate(input.timestamp) ?? new Date();

    const durationMs = Number(input.durationMs);
    const durationSeconds = durationMs / 1000;
    const outcome: WorkflowOutcome = input.outcome ?? 'success';

    const metric: WorkflowLatencyMetric = {
      workflowId: input.workflowId,
      durationMs,
      durationSeconds,
      organizationId: input.organizationId,
      environment,
      outcome,
      errorCode: input.errorCode,
      serviceId: input.serviceId,
      workerId: input.workerId,
      timestamp: timestampDate.toISOString(),
      labels: input.labels,
      metadata: input.metadata,
    };

    try {
      // Forward to metrics backend if available.
      if (this.metricsSink) {
        await this.metricsSink.recordHistogram(
          'orgo_workflow_latency_seconds',
          metric.durationSeconds,
          {
            environment: metric.environment,
            workflow_id: metric.workflowId,
            ...(metric.organizationId
              ? { organization_id: metric.organizationId }
              : {}),
            ...(metric.serviceId ? { service_id: metric.serviceId } : {}),
            ...(metric.workerId ? { worker_id: metric.workerId } : {}),
            outcome: metric.outcome,
            ...(metric.labels ?? {}),
          },
        );
      }

      // Always emit a structured log event for observability/log-based metrics.
      this.logService.logEvent({
        category: LogCategory.SYSTEM,
        level: LogLevel.INFO,
        message: `Workflow latency recorded for "${metric.workflowId}" (${metric.durationMs}ms).`,
        identifier: `workflow_id:${metric.workflowId}`,
        metadata: {
          functionId: FN_METRICS_RECORD_WORKFLOW_LATENCY,
          environment: metric.environment,
          organizationId: metric.organizationId ?? null,
          serviceId: metric.serviceId ?? null,
          workerId: metric.workerId ?? null,
          outcome: metric.outcome,
          errorCode: metric.errorCode ?? null,
          durationMs: metric.durationMs,
          durationSeconds: metric.durationSeconds,
          timestamp: metric.timestamp,
          labels: metric.labels ?? {},
          extraMetadata: metric.metadata ?? {},
        },
      });

      return {
        ok: true,
        data: metric,
        error: null,
      };
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error('Unknown error in recordWorkflowLatency');

      this.logService.logEvent({
        category: LogCategory.SYSTEM,
        level: LogLevel.ERROR,
        message: 'Failed to record workflow latency metric.',
        identifier: `workflow_id:${input.workflowId}`,
        metadata: {
          functionId: FN_METRICS_RECORD_WORKFLOW_LATENCY,
          environment,
          error: err.message,
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'METRICS_WORKFLOW_LATENCY_RECORD_FAILED',
          message: err.message,
          details: {
            workflowId: input.workflowId,
            environment,
          },
        },
      };
    }
  }

  /**
   * Record current depth metrics for one or more queues.
   *
   * Typical usage:
   * - Periodic job reads queue depths from the queue backend,
   *   then calls recordQueueDepth with one QueueDepthSample per queue.
   */
  async recordQueueDepth(
    input: QueueDepthMetricInput,
  ): Promise<StandardResult<QueueDepthMetric>> {
    if (!input || !Array.isArray(input.samples) || input.samples.length === 0) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'METRICS_QUEUE_DEPTH_INVALID_PAYLOAD',
          message: 'At least one queue depth sample is required.',
          details: { input },
        },
      };
    }

    const environment = this.resolveEnvironment(input.environment);
    const timestampDate = this.normaliseDate(input.timestamp) ?? new Date();

    const samples: QueueDepthSample[] = input.samples.map((sample) => ({
      queueName: sample.queueName,
      readyJobs: this.toNonNegativeInt(sample.readyJobs),
      activeJobs: this.toNonNegativeInt(sample.activeJobs),
      delayedJobs: this.toNonNegativeInt(sample.delayedJobs),
      failedJobs: this.toNonNegativeInt(sample.failedJobs),
      lagSeconds: this.toNonNegativeNumber(sample.lagSeconds),
    }));

    const summary = samples.reduce(
      (acc, s) => {
        acc.totalReadyJobs += s.readyJobs;
        acc.totalActiveJobs += s.activeJobs;
        acc.totalDelayedJobs += s.delayedJobs;
        acc.totalFailedJobs += s.failedJobs;
        return acc;
      },
      {
        totalQueues: samples.length,
        totalReadyJobs: 0,
        totalActiveJobs: 0,
        totalDelayedJobs: 0,
        totalFailedJobs: 0,
      },
    );

    const metric: QueueDepthMetric = {
      environment,
      serviceId: input.serviceId,
      organizationId: input.organizationId,
      timestamp: timestampDate.toISOString(),
      samples,
      summary,
    };

    try {
      if (this.metricsSink) {
        for (const sample of samples) {
          const labels: Record<string, string> = {
            environment: metric.environment,
            queue: sample.queueName,
          };

          if (metric.serviceId) {
            labels.service_id = metric.serviceId;
          }
          if (metric.organizationId) {
            labels.organization_id = metric.organizationId;
          }

          await this.metricsSink.setGauge(
            'orgo_queue_ready_jobs',
            sample.readyJobs,
            labels,
          );
          await this.metricsSink.setGauge(
            'orgo_queue_active_jobs',
            sample.activeJobs,
            labels,
          );
          await this.metricsSink.setGauge(
            'orgo_queue_delayed_jobs',
            sample.delayedJobs,
            labels,
          );
          await this.metricsSink.setGauge(
            'orgo_queue_failed_jobs',
            sample.failedJobs,
            labels,
          );

          if (sample.lagSeconds != null) {
            await this.metricsSink.setGauge(
              'orgo_queue_lag_seconds',
              sample.lagSeconds,
              labels,
            );
          }
        }
      }

      this.logService.logEvent({
        category: LogCategory.SYSTEM,
        level: LogLevel.INFO,
        message: 'Queue depth metrics recorded.',
        identifier: input.serviceId
          ? `service_id:${input.serviceId}`
          : input.organizationId
          ? `org_id:${input.organizationId}`
          : undefined,
        metadata: {
          functionId: FN_METRICS_RECORD_QUEUE_DEPTH,
          environment: metric.environment,
          serviceId: metric.serviceId ?? null,
          organizationId: metric.organizationId ?? null,
          timestamp: metric.timestamp,
          summary: metric.summary,
          samples: metric.samples,
          extraMetadata: input.metadata ?? {},
        },
      });

      return {
        ok: true,
        data: metric,
        error: null,
      };
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error('Unknown error in recordQueueDepth');

      this.logService.logEvent({
        category: LogCategory.SYSTEM,
        level: LogLevel.ERROR,
        message: 'Failed to record queue depth metrics.',
        identifier: input.serviceId
          ? `service_id:${input.serviceId}`
          : input.organizationId
          ? `org_id:${input.organizationId}`
          : undefined,
        metadata: {
          functionId: FN_METRICS_RECORD_QUEUE_DEPTH,
          environment,
          error: err.message,
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'METRICS_QUEUE_DEPTH_RECORD_FAILED',
          message: err.message,
          details: {
            serviceId: input.serviceId,
            organizationId: input.organizationId,
            environment,
          },
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve an Orgo ENVIRONMENT value from an optional explicit value
   * plus process environment variables.
   *
   * Canonical values: "dev" | "staging" | "prod" | "offline".
   */
  private resolveEnvironment(explicit?: string): Environment {
    const raw =
      explicit ??
      process.env.ORGO_ENV ??
      process.env.ORGO_ENVIRONMENT ??
      process.env.NODE_ENV ??
      'dev';

    const value = raw.toLowerCase();

    if (value === 'dev' || value === 'development' || value === 'local') {
      return 'dev';
    }

    if (value === 'staging' || value === 'stage') {
      return 'staging';
    }

    if (value === 'prod' || value === 'production') {
      return 'prod';
    }

    if (value === 'offline') {
      return 'offline';
    }

    // Fallback: be explicit and predictable.
    return 'dev';
  }

  /**
   * Normalise a timestamp value to a Date, or null if invalid.
   */
  private normaliseDate(value?: string | Date): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  /**
   * Coerce an optional number into a non-negative integer (default 0).
   */
  private toNonNegativeInt(value?: number | null): number {
    const num = typeof value === 'number' ? value : 0;
    if (!Number.isFinite(num) || num <= 0) {
      return 0;
    }
    return Math.floor(num);
  }

  /**
   * Coerce an optional number into a non-negative number (or null if unavailable).
   */
  private toNonNegativeNumber(value?: number | null): number | null {
    if (value == null) {
      return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return null;
    }
    return num < 0 ? 0 : num;
  }
}
