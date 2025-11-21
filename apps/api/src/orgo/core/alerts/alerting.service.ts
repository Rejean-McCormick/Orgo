import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LogService } from '../logging/log.service';
import {
  FN_ALERT_ESCALATION_DELAY,
  FN_ALERT_ERROR_RATE,
} from '../functional-ids';

/**
 * Canonical log levels for Core Services (Doc 2 / Doc 5).
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/**
 * Canonical log categories for Core Services (Doc 2 / Doc 5).
 */
export type LogCategory = 'WORKFLOW' | 'TASK' | 'SYSTEM' | 'SECURITY' | 'EMAIL';

/**
 * Canonical environment values (Doc 2).
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
 * Alert types handled by AlertingService.
 */
export type AlertType = 'ESCALATION_DELAY' | 'ERROR_RATE';

/**
 * Result payload describing whether an alert was emitted.
 */
export interface AlertTriggerResult {
  alertType: AlertType;
  triggered: boolean;
  reason: string;
  metadata?: Record<string, unknown>;
}

/**
 * Input payload for escalation-delay alerts.
 *
 * The job `orgo.alerts.escalation-delay` is expected to compute these metrics
 * using SLA rules derived from profiles/config (Docs 2, 5, 7, 8) and pass them here.
 */
export interface EscalationDelayAlertInput {
  /**
   * Organization the metrics apply to (tenant).
   */
  organizationId: string;

  /**
   * Profile key used for SLA expectations (e.g. "hospital", "default").
   * See Doc 7 – profiles YAML.
   */
  profileKey: string;

  /**
   * Environment in which the alert is being evaluated.
   */
  environment: Environment;

  /**
   * Number of unresolved Tasks whose `reactivity_deadline_at` has passed
   * (as per Doc 8 §8.7.2).
   */
  overdueUnresolvedCount: number;

  /**
   * Number of those overdue Tasks that are `CRITICAL` severity.
   */
  overdueCriticalCount: number;

  /**
   * Maximum delay in seconds beyond `reactivity_deadline_at`
   * among the overdue Tasks.
   */
  maxDelaySeconds: number;

  /**
   * Optional threshold overrides already resolved by the caller.
   * If omitted, defaults derived from config are used.
   */
  thresholds?: {
    /**
     * Minimum overdue Task count required before an alert is emitted.
     */
    minOverdueCount?: number;

    /**
     * Minimum maximum delay (in seconds) beyond SLA before emitting an alert.
     */
    minMaxDelaySeconds?: number;
  };
}

/**
 * Input payload for error-rate alerts.
 *
 * The job `orgo.alerts.error-rate` is expected to compute these metrics from
 * observability data (e.g. Prometheus / logs) and pass them here.
 */
export interface ErrorRateAlertInput {
  /**
   * Identifier of the service / worker being monitored (e.g. "task_handler").
   */
  serviceId: string;

  /**
   * Environment in which the alert is being evaluated.
   */
  environment: Environment;

  /**
   * Rolling window size (in minutes) used to compute the error rate.
   */
  windowMinutes: number;

  /**
   * Error rate in the window, expressed as a fraction between 0 and 1.
   * Example: 0.02 = 2% error rate.
   */
  errorRate: number;

  /**
   * Total request count in the window; used for sanity checks and logging.
   */
  requestCount: number;

  /**
   * Optional threshold override already resolved by the caller.
   * If omitted, defaults derived from config are used.
   */
  thresholdErrorRate?: number;
}

/**
 * AlertingService
 *
 * Infrastructure & Monitoring sub-module responsible for emitting alerts
 * when SLA- and error-related conditions are breached (Doc 4 §3.8).
 *
 * Code names (Doc 4 §3.8):
 * - Trigger escalation delay alert → AlertingService.triggerEscalationDelayAlert,
 *   job `orgo.alerts.escalation-delay`.
 * - Trigger error-rate alert → AlertingService.triggerErrorRateAlert,
 *   job `orgo.alerts.error-rate`.
 */
@Injectable()
export class AlertingService {
  /**
   * Default thresholds used when no explicit values are provided via config
   * or method parameters. These values are conservative and intended to be
   * overridden per-environment via configuration.
   */
  private readonly defaultEscalationMinOverdueCount: number;
  private readonly defaultEscalationMinMaxDelaySeconds: number;
  private readonly defaultErrorRateThreshold: number;

  constructor(
    private readonly logService: LogService,
    private readonly configService: ConfigService,
  ) {
    // Escalation-delay thresholds (may be overridden by config).
    this.defaultEscalationMinOverdueCount =
      Number(
        this.configService.get(
          'alerts.escalationDelay.min_overdue_count',
        ) as number | string,
      ) || 1;

    this.defaultEscalationMinMaxDelaySeconds =
      Number(
        this.configService.get(
          'alerts.escalationDelay.min_max_delay_seconds',
        ) as number | string,
      ) || 60;

    // Error-rate threshold (may be overridden by config).
    // Default: 1% error rate.
    this.defaultErrorRateThreshold =
      Number(
        this.configService.get('alerts.errorRate.threshold') as number | string,
      ) || 0.01;
  }

  /**
   * Emits an alert when escalations fall behind SLAs derived from profiles/config.
   *
   * This method is typically called by the background job
   * `orgo.alerts.escalation-delay`, which aggregates metrics across Tasks and
   * passes them in the `input` payload.
   */
  async triggerEscalationDelayAlert(
    input: EscalationDelayAlertInput,
  ): Promise<StandardResult<AlertTriggerResult>> {
    try {
      const minOverdueCount =
        input.thresholds?.minOverdueCount ??
        this.defaultEscalationMinOverdueCount;
      const minMaxDelaySeconds =
        input.thresholds?.minMaxDelaySeconds ??
        this.defaultEscalationMinMaxDelaySeconds;

      const breached =
        input.overdueUnresolvedCount >= minOverdueCount &&
        input.maxDelaySeconds >= minMaxDelaySeconds;

      const reason = breached
        ? `Escalation delay thresholds breached: overdue_unresolved=${input.overdueUnresolvedCount}, overdue_critical=${input.overdueCriticalCount}, max_delay_seconds=${input.maxDelaySeconds}, min_overdue_count=${minOverdueCount}, min_max_delay_seconds=${minMaxDelaySeconds}.`
        : `Escalation delay thresholds not breached: overdue_unresolved=${input.overdueUnresolvedCount}, overdue_critical=${input.overdueCriticalCount}, max_delay_seconds=${input.maxDelaySeconds}, min_overdue_count=${minOverdueCount}, min_max_delay_seconds=${minMaxDelaySeconds}.`;

      await this.logService.logEvent({
        category: 'SYSTEM' as LogCategory,
        level: (breached ? 'WARNING' : 'INFO') as LogLevel,
        message: breached
          ? 'Escalation delay alert evaluated: thresholds breached.'
          : 'Escalation delay alert evaluated: thresholds not breached.',
        identifier: `org_id:${input.organizationId}`,
        functionId: FN_ALERT_ESCALATION_DELAY,
        metadata: {
          environment: input.environment,
          profileKey: input.profileKey,
          overdueUnresolvedCount: input.overdueUnresolvedCount,
          overdueCriticalCount: input.overdueCriticalCount,
          maxDelaySeconds: input.maxDelaySeconds,
          minOverdueCount,
          minMaxDelaySeconds,
          breached,
        },
      });

      return {
        ok: true,
        data: {
          alertType: 'ESCALATION_DELAY',
          triggered: breached,
          reason,
          metadata: {
            organizationId: input.organizationId,
            profileKey: input.profileKey,
            environment: input.environment,
          },
        },
        error: null,
      };
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error('Unknown error in triggerEscalationDelayAlert');

      await this.logService.logEvent({
        category: 'SYSTEM' as LogCategory,
        level: 'ERROR' as LogLevel,
        message: 'Failed to evaluate escalation delay alert.',
        identifier: `org_id:${input.organizationId}`,
        functionId: FN_ALERT_ESCALATION_DELAY,
        metadata: {
          error: err.message,
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'ALERT_EVALUATION_ERROR',
          message: err.message,
          details: {
            alertType: 'ESCALATION_DELAY',
          },
        },
      };
    }
  }

  /**
   * Emits an alert when error rates across services exceed configured thresholds.
   *
   * This method is typically called by the background job
   * `orgo.alerts.error-rate`, which aggregates error-rate metrics from the
   * observability stack (Prometheus/Grafana, logs, etc.) and passes them here.
   */
  async triggerErrorRateAlert(
    input: ErrorRateAlertInput,
  ): Promise<StandardResult<AlertTriggerResult>> {
    try {
      const threshold =
        input.thresholdErrorRate ?? this.defaultErrorRateThreshold;

      const breached =
        input.errorRate >= threshold && input.requestCount > 0 && threshold > 0;

      const reason = breached
        ? `Error-rate threshold breached for service "${input.serviceId}" in ${input.environment}: error_rate=${input.errorRate}, threshold=${threshold}, window_minutes=${input.windowMinutes}, request_count=${input.requestCount}.`
        : `Error-rate threshold not breached for service "${input.serviceId}" in ${input.environment}: error_rate=${input.errorRate}, threshold=${threshold}, window_minutes=${input.windowMinutes}, request_count=${input.requestCount}.`;

      await this.logService.logEvent({
        category: 'SYSTEM' as LogCategory,
        level: (breached ? 'WARNING' : 'INFO') as LogLevel,
        message: breached
          ? 'Error-rate alert evaluated: thresholds breached.'
          : 'Error-rate alert evaluated: thresholds not breached.',
        identifier: `service_id:${input.serviceId}`,
        functionId: FN_ALERT_ERROR_RATE,
        metadata: {
          environment: input.environment,
          serviceId: input.serviceId,
          errorRate: input.errorRate,
          requestCount: input.requestCount,
          threshold,
          windowMinutes: input.windowMinutes,
          breached,
        },
      });

      return {
        ok: true,
        data: {
          alertType: 'ERROR_RATE',
          triggered: breached,
          reason,
          metadata: {
            serviceId: input.serviceId,
            environment: input.environment,
          },
        },
        error: null,
      };
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error('Unknown error in triggerErrorRateAlert');

      await this.logService.logEvent({
        category: 'SYSTEM' as LogCategory,
        level: 'ERROR' as LogLevel,
        message: 'Failed to evaluate error-rate alert.',
        identifier: `service_id:${input.serviceId}`,
        functionId: FN_ALERT_ERROR_RATE,
        metadata: {
          error: err.message,
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'ALERT_EVALUATION_ERROR',
          message: err.message,
          details: {
            alertType: 'ERROR_RATE',
          },
        },
      };
    }
  }
}
