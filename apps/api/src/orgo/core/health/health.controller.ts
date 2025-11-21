import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

type HealthComponentState = 'up' | 'down' | 'degraded';
type HealthOverallStatus = 'ok' | 'degraded' | 'error';

export interface HealthComponentSnapshot {
  state: HealthComponentState;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthSnapshot {
  /**
   * Overall status of the Orgo backend.
   * - "ok"       → all core components are healthy
   * - "degraded" → at least one component is degraded but core is still functioning
   * - "error"    → at least one critical component is down
   */
  status: HealthOverallStatus;

  /**
   * Environment identifier ("dev" | "staging" | "prod" | "offline").
   */
  environment: string;

  /**
   * Optional version string for the running API (e.g. "3.0.1").
   */
  version?: string;

  /**
   * ISO 8601 timestamp (UTC) for when this snapshot was generated.
   */
  timestamp: string;

  /**
   * Component-level snapshots for the main dependencies.
   * Keys are stable identifiers that ops / monitoring can rely on.
   */
  components: {
    /**
     * Primary database / persistence layer.
     */
    database: HealthComponentSnapshot;

    /**
     * Task / background queues and workers.
     */
    queues: HealthComponentSnapshot;

    /**
     * Config loader and config validation status.
     */
    configLoader: HealthComponentSnapshot;

    /**
     * Domain modules discovery and basic self-checks.
     */
    domainModules: HealthComponentSnapshot;

    /**
     * Insights / analytics slice (warehouse + ETL).
     */
    insights: HealthComponentSnapshot;

    /**
     * Optional additional components (caches, external APIs, etc.).
     */
    [key: string]: HealthComponentSnapshot;
  };
}

export interface HealthError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard result shape for API responses that can fail synchronously.
 */
export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error: HealthError | null;
}

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /api/v3/health
   *
   * Returns an aggregated health snapshot for core Orgo dependencies:
   * - database
   * - queues
   * - config loader
   * - domain modules
   * - insights / analytics slice
   *
   * The HTTP status code is always 200; callers should inspect the payload:
   * - result.ok          → whether the health check itself ran successfully
   * - result.data.status → "ok" | "degraded" | "error" (overall system health)
   */
  @Get()
  async getHealth(): Promise<StandardResult<HealthSnapshot>> {
    try {
      const snapshot = await this.healthService.checkHealth();

      return {
        ok: true,
        data: snapshot,
        error: null,
      };
    } catch (err: unknown) {
      const error: HealthError =
        err instanceof Error
          ? {
              code: 'HEALTH_CHECK_FAILED',
              message: err.message,
              details: {
                name: err.name,
              },
            }
          : {
              code: 'HEALTH_CHECK_FAILED',
              message: 'Unknown error during health check',
              details: {
                error: String(err),
              },
            };

      return {
        ok: false,
        data: null,
        error,
      };
    }
  }
}
