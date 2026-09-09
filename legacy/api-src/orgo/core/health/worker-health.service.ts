import { Injectable } from '@nestjs/common';
import { LogService } from '../logging/log.service';
import { FN_LOG_SYSTEM_EVENT } from '../functional-ids';

export type WorkerHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface WorkerQueueHeartbeat {
  name: string;
  activeJobs?: number;
  waitingJobs?: number;
  delayedJobs?: number;
  failedJobs?: number;
  /**
   * Queue lag in seconds (e.g. oldest waiting job age or schedule delay).
   */
  lagSeconds?: number | null;
  lastJobStartedAt?: string | Date | null;
  lastJobCompletedAt?: string | Date | null;
}

export interface WorkerHeartbeatPayload {
  /**
   * Stable worker identifier (pod name, instance id, etc.).
   */
  workerId: string;

  /**
   * Logical service / component id (`task_handler`, `email_gateway`, `insights_etl_worker`, etc.).
   * Should align with service identifiers from core services (`task_handler`, `email_gateway`, ...).
   */
  serviceId: string;

  /**
   * Environment, expected to match ENVIRONMENT enum (`dev` | `staging` | `prod` | `offline`).
   * If omitted, defaults from ORGO_ENVIRONMENT or `dev`.
   */
  environment?: string;

  /**
   * Hostname or node identifier.
   */
  hostname?: string;

  /**
   * OS process id, if applicable.
   */
  pid?: number;

  /**
   * When this worker instance started.
   */
  startedAt?: string | Date;

  /**
   * When this heartbeat was emitted. If omitted, "now" is assumed.
   */
  timestamp?: string | Date;

  /**
   * Per-queue metrics (email, workflow, task, etc.).
   */
  queues?: WorkerQueueHeartbeat[];

  /**
   * Optional numeric metrics for dashboards (CPU %, memory MB, etc.).
   */
  metrics?: Record<string, number>;

  /**
   * Free-form metadata for ops dashboards (labels, node role, region, etc.).
   */
  metadata?: Record<string, unknown>;
}

export interface WorkerHeartbeatAnomaly {
  type: 'HIGH_QUEUE_LAG' | 'HIGH_FAILED_JOBS';
  queueName?: string;
  severity: 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown>;
}

export interface WorkerHeartbeatResult {
  workerId: string;
  serviceId: string;
  environment: string;
  status: WorkerHealthStatus;
  timestamp: string;
  anomalies: WorkerHeartbeatAnomaly[];
}

export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
}

@Injectable()
export class WorkerHealthService {
  private readonly maxLagSeconds: number;
  private readonly maxFailedJobs: number;

  constructor(private readonly logService: LogService) {
    // Basic, environment-driven thresholds for anomaly detection.
    this.maxLagSeconds = this.parsePositiveInt(
      process.env.ORGO_WORKER_MAX_LAG_SECONDS,
      300, // 5 minutes
    );
    this.maxFailedJobs = this.parsePositiveInt(
      process.env.ORGO_WORKER_MAX_FAILED_JOBS,
      10,
    );
  }

  /**
   * Core entry point for the `orgo.worker.heartbeat` job.
   *
   * Records a heartbeat for a worker instance, performs simple anomaly
   * detection on queue metrics, and logs the result as a SYSTEM-level event
   * for ops dashboards and observability pipelines.
   */
  async heartbeat(
    payload: WorkerHeartbeatPayload,
  ): Promise<StandardResult<WorkerHeartbeatResult>> {
    if (!payload || !payload.workerId || !payload.serviceId) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'WORKER_HEARTBEAT_INVALID_PAYLOAD',
          message: 'workerId and serviceId are required for worker heartbeat.',
          details: { payload },
        },
      };
    }

    const environment =
      payload.environment ||
      process.env.ORGO_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'dev';

    const now = this.normaliseDate(payload.timestamp) ?? new Date();

    const anomalies = this.detectAnomalies(payload);
    const status = this.deriveStatus(anomalies);

    const result: WorkerHeartbeatResult = {
      workerId: payload.workerId,
      serviceId: payload.serviceId,
      environment,
      status,
      timestamp: now.toISOString(),
      anomalies,
    };

    const logLevel = this.chooseLogLevel(anomalies);

    try {
      await this.logService.logEvent({
        category: 'SYSTEM',
        logLevel,
        message: `Worker heartbeat (${payload.serviceId}/${payload.workerId}) – ${status.toUpperCase()}`,
        identifier: `worker:${payload.serviceId}/${payload.workerId}`,
        metadata: {
          functionId: FN_LOG_SYSTEM_EVENT,
          job: 'orgo.worker.heartbeat',
          status,
          environment,
          heartbeat: {
            ...payload,
            timestamp: result.timestamp,
          },
          anomalies,
          thresholds: {
            maxLagSeconds: this.maxLagSeconds,
            maxFailedJobs: this.maxFailedJobs,
          },
        },
      });

      return {
        ok: true,
        data: result,
        error: null,
      };
    } catch (err: any) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'WORKER_HEARTBEAT_LOG_FAILED',
          message: 'Failed to record worker heartbeat log event.',
          details: {
            error: err?.message ?? String(err),
            workerId: payload.workerId,
            serviceId: payload.serviceId,
          },
        },
      };
    }
  }

  /**
   * Inspects queue metrics to detect simple anomalies suitable for ops dashboards.
   */
  private detectAnomalies(payload: WorkerHeartbeatPayload): WorkerHeartbeatAnomaly[] {
    const anomalies: WorkerHeartbeatAnomaly[] = [];

    if (!payload.queues || payload.queues.length === 0) {
      return anomalies;
    }

    for (const queue of payload.queues) {
      const queueName = queue.name;

      if (queue.lagSeconds != null && queue.lagSeconds > this.maxLagSeconds) {
        const severity: 'warning' | 'critical' =
          queue.lagSeconds > this.maxLagSeconds * 2 ? 'critical' : 'warning';

        anomalies.push({
          type: 'HIGH_QUEUE_LAG',
          queueName,
          severity,
          message: `Queue "${queueName}" lag (${queue.lagSeconds}s) exceeds threshold (${this.maxLagSeconds}s).`,
          details: {
            lagSeconds: queue.lagSeconds,
            thresholdSeconds: this.maxLagSeconds,
            activeJobs: queue.activeJobs,
            waitingJobs: queue.waitingJobs,
            delayedJobs: queue.delayedJobs,
          },
        });
      }

      if (typeof queue.failedJobs === 'number' && queue.failedJobs > this.maxFailedJobs) {
        const severity: 'warning' | 'critical' =
          queue.failedJobs > this.maxFailedJobs * 2 ? 'critical' : 'warning';

        anomalies.push({
          type: 'HIGH_FAILED_JOBS',
          queueName,
          severity,
          message: `Queue "${queueName}" failed jobs (${queue.failedJobs}) exceeds threshold (${this.maxFailedJobs}).`,
          details: {
            failedJobs: queue.failedJobs,
            thresholdFailedJobs: this.maxFailedJobs,
            activeJobs: queue.activeJobs,
            waitingJobs: queue.waitingJobs,
          },
        });
      }
    }

    return anomalies;
  }

  private deriveStatus(anomalies: WorkerHeartbeatAnomaly[]): WorkerHealthStatus {
    if (anomalies.length === 0) {
      return 'healthy';
    }

    const hasCritical = anomalies.some((a) => a.severity === 'critical');
    if (hasCritical) {
      return 'unhealthy';
    }

    return 'degraded';
  }

  private chooseLogLevel(anomalies: WorkerHeartbeatAnomaly[]): 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' {
    if (anomalies.length === 0) {
      return 'INFO';
    }

    const hasCritical = anomalies.some((a) => a.severity === 'critical');
    return hasCritical ? 'ERROR' : 'WARNING';
  }

  private normaliseDate(value?: string | Date): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }
}
