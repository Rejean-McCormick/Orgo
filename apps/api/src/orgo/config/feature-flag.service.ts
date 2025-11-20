import { Injectable, Logger } from '@nestjs/common';
import { FeatureFlag } from '@prisma/client';
import { PrismaService } from '../../persistence/prisma/prisma.service';

/**
 * Rollout strategies supported via feature_flags.rollout_strategy (JSONB).
 *
 * Stored JSON is expected to contain at least a "type" discriminator:
 *
 *   { "type": "all" }
 *   { "type": "percentage", "percentage": 10, "seed": "optional-stable-seed" }
 *   { "type": "roles", "roleCodes": ["maintenance_coordinator", "hr_officer"] }
 *   { "type": "users", "userIds": ["<uuid>", ...] }
 */
export type RolloutStrategy =
  | { type: 'all' }
  | { type: 'percentage'; percentage: number; seed?: string }
  | { type: 'roles'; roleCodes: string[] }
  | { type: 'users'; userIds: string[] };

/**
 * Context used when evaluating whether a flag is effectively enabled.
 */
export interface FeatureFlagEvaluationContext {
  organizationId?: string | null;
  userId?: string | null;
  roleCodes?: string[];
}

/**
 * Input for FeatureFlagService.setFlag.
 *
 * organizationId:
 *   - UUID string for org‑scoped flags.
 *   - null / undefined for global flags.
 */
export interface SetFeatureFlagInput {
  organizationId?: string | null;
  code: string;
  enabled: boolean;
  description?: string;
  rolloutStrategy?: RolloutStrategy | Record<string, unknown> | null;
  enabledFrom?: Date | string | null;
  disabledAt?: Date | string | null;
}

/**
 * FeatureFlagService
 *
 * Manages feature_flags to gradually roll out or restrict features per organization.
 * Physical table shape is defined in the Orgo DB schema reference (Doc 1, feature_flags). 
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the effective set of flags for an organization:
   * - Includes both global flags (organizationId = null) and org‑scoped flags.
   * - For each code, org‑scoped row overrides the global row when both exist.
   */
  async listFlagsForOrganization(
    organizationId?: string | null,
  ): Promise<FeatureFlag[]> {
    const orgId = organizationId ?? null;

    const flags = await this.prisma.featureFlag.findMany({
      where: {
        OR: [{ organizationId: orgId }, { organizationId: null }],
      },
      orderBy: [{ code: 'asc' }, { organizationId: 'asc' }],
    });

    const byCode = new Map<string, FeatureFlag>();

    for (const flag of flags) {
      const existing = byCode.get(flag.code);
      if (!existing) {
        byCode.set(flag.code, flag);
        continue;
      }

      // Prefer org‑specific override over global flag.
      if (flag.organizationId && !existing.organizationId) {
        byCode.set(flag.code, flag);
      }
    }

    return Array.from(byCode.values());
  }

  /**
   * Fetch a single flag by code for an organization, with override resolution:
   * - Prefers org‑scoped flag if present.
   * - Falls back to global flag.
   */
  async getFlag(
    code: string,
    organizationId?: string | null,
  ): Promise<FeatureFlag | null> {
    const orgId = organizationId ?? null;

    const flag = await this.prisma.featureFlag.findFirst({
      where: {
        code,
        OR: [{ organizationId: orgId }, { organizationId: null }],
      },
      orderBy: [
        // Non‑null organizationId (org‑specific) should win over global.
        { organizationId: 'desc' },
      ],
    });

    return flag ?? null;
  }

  /**
   * Evaluate whether a feature is effectively enabled for the given context:
   * - resolves org/global override,
   * - checks enabled boolean + time window,
   * - applies rollout_strategy (percentage / roles / users) if present.
   */
  async isFeatureEnabled(
    code: string,
    params: {
      organizationId?: string | null;
      context?: FeatureFlagEvaluationContext;
    } = {},
  ): Promise<boolean> {
    const { organizationId, context } = params;
    const flag = await this.getFlag(code, organizationId);

    if (!flag) {
      return false;
    }

    if (!flag.enabled) {
      return false;
    }

    if (!this.isWithinActiveWindow(flag)) {
      return false;
    }

    const mergedContext: FeatureFlagEvaluationContext = {
      organizationId: flag.organizationId ?? organizationId ?? null,
      ...(context ?? {}),
    };

    const rolloutOk = this.evaluateRolloutStrategy(
      flag.rolloutStrategy,
      mergedContext,
    );

    return rolloutOk;
  }

  /**
   * Create or update a feature flag for an organization.
   *
   * Semantics:
   * - (orgId, code) pair is treated as unique (org override vs global default).
   * - If a row exists, it is updated; otherwise a new row is created.
   * - When enabled = true and no enabledFrom is provided, enabledFrom defaults to now.
   * - When enabled = false and no disabledAt is provided, disabledAt defaults to now.
   */
  async setFlag(input: SetFeatureFlagInput): Promise<FeatureFlag> {
    const orgId = input.organizationId ?? null;
    const now = new Date();

    const existing = await this.prisma.featureFlag.findFirst({
      where: {
        organizationId: orgId,
        code: input.code,
      },
    });

    const description =
      input.description ?? existing?.description ?? input.code;

    const enabledFrom = (() => {
      const explicit = this.toDateOrNull(input.enabledFrom);
      if (explicit) {
        return explicit;
      }

      if (input.enabled) {
        // Default to "now" whenever explicitly enabling without a schedule.
        return now;
      }

      // For disabled flags, keep any existing enabledFrom (historical info),
      // or leave null if there was none.
      return existing?.enabledFrom ?? null;
    })();

    const disabledAt = (() => {
      const explicit = this.toDateOrNull(input.disabledAt);
      if (explicit) {
        return explicit;
      }

      if (!input.enabled) {
        // When disabling without an explicit schedule, mark disabled "now".
        return now;
      }

      // When enabling and no explicit disabledAt is set, clear any previous value.
      return null;
    })();

    const rolloutStrategy =
      input.rolloutStrategy === undefined
        ? existing?.rolloutStrategy ?? null
        : (input.rolloutStrategy as unknown);

    if (existing) {
      const updated = await this.prisma.featureFlag.update({
        where: { id: existing.id },
        data: {
          enabled: input.enabled,
          description,
          rolloutStrategy,
          enabledFrom,
          disabledAt,
        },
      });

      this.logger.log(
        `Updated feature flag "${updated.code}" for org=${updated.organizationId ?? 'GLOBAL'} enabled=${updated.enabled}`,
      );

      return updated;
    }

    const created = await this.prisma.featureFlag.create({
      data: {
        organizationId: orgId,
        code: input.code,
        enabled: input.enabled,
        description,
        rolloutStrategy,
        enabledFrom,
        disabledAt,
      },
    });

    this.logger.log(
      `Created feature flag "${created.code}" for org=${created.organizationId ?? 'GLOBAL'} enabled=${created.enabled}`,
    );

    return created;
  }

  /**
   * Checks whether the current time falls within the active window of a flag.
   *
   * Active when:
   * - enabledFrom is null or <= now, AND
   * - disabledAt is null or > now.
   */
  private isWithinActiveWindow(
    flag: FeatureFlag,
    now: Date = new Date(),
  ): boolean {
    const { enabledFrom, disabledAt } = flag;

    if (enabledFrom && enabledFrom > now) {
      return false;
    }

    if (disabledAt && disabledAt <= now) {
      return false;
    }

    return true;
  }

  /**
   * Apply rollout_strategy for a flag based on evaluation context.
   *
   * If rollout_strategy is null/undefined, it is treated as "no additional gating"
   * and returns true (flag state is controlled solely by enabled/time window).
   *
   * If rollout_strategy is present but malformed or of an unknown type, the
   * strategy is treated as invalid and the feature is considered disabled,
   * which is the safe default for configuration errors.
   */
  private evaluateRolloutStrategy(
    rawStrategy: unknown,
    context: FeatureFlagEvaluationContext,
  ): boolean {
    if (rawStrategy === null || rawStrategy === undefined) {
      return true;
    }

    const strategy = this.normalizeRolloutStrategy(rawStrategy);
    if (!strategy) {
      this.logger.warn(
        'Unknown or invalid rollout strategy on feature flag; treating as disabled',
      );
      return false;
    }

    switch (strategy.type) {
      case 'all':
        return true;

      case 'percentage': {
        const percentage = Math.max(0, Math.min(100, strategy.percentage));
        if (percentage === 0) {
          return false;
        }
        if (percentage === 100) {
          return true;
        }

        const seed =
          strategy.seed ??
          (context.userId
            ? `user:${context.userId}`
            : context.organizationId
            ? `org:${context.organizationId}`
            : context.roleCodes && context.roleCodes.length > 0
            ? `roles:${context.roleCodes.sort().join(',')}`
            : 'global');

        const value = this.stableHashToUnitInterval(seed);
        return value * 100 < percentage;
      }

      case 'roles': {
        if (!context.roleCodes || context.roleCodes.length === 0) {
          return false;
        }
        const allowed = new Set(strategy.roleCodes);
        return context.roleCodes.some((role) => allowed.has(role));
      }

      case 'users': {
        if (!context.userId) {
          return false;
        }
        const allowedUsers = new Set(strategy.userIds);
        return allowedUsers.has(context.userId);
      }

      default:
        // Should not happen if normalizeRolloutStrategy is exhaustive.
        return false;
    }
  }

  /**
   * Normalizes raw JSON from rollout_strategy into a RolloutStrategy object.
   * Returns null if the JSON does not conform to any supported strategy.
   */
  private normalizeRolloutStrategy(raw: unknown): RolloutStrategy | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const obj = raw as { [key: string]: unknown };
    const type = typeof obj.type === 'string' ? obj.type : undefined;

    switch (type) {
      case 'all':
        return { type: 'all' };

      case 'percentage': {
        const rawPercentage = (obj.percentage ?? obj['pct']) as
          | number
          | string
          | undefined;

        const percentage =
          typeof rawPercentage === 'number'
            ? rawPercentage
            : rawPercentage !== undefined
            ? Number(rawPercentage)
            : NaN;

        if (!Number.isFinite(percentage)) {
          return null;
        }

        const seed =
          typeof obj.seed === 'string' ? (obj.seed as string) : undefined;

        return { type: 'percentage', percentage, seed };
      }

      case 'roles': {
        const rawRoleCodes = Array.isArray(obj.roleCodes)
          ? obj.roleCodes
          : [];
        const roleCodes = rawRoleCodes.filter(
          (v): v is string => typeof v === 'string',
        );

        if (roleCodes.length === 0) {
          return null;
        }

        return { type: 'roles', roleCodes };
      }

      case 'users': {
        const rawUserIds = Array.isArray(obj.userIds) ? obj.userIds : [];
        const userIds = rawUserIds.filter(
          (v): v is string => typeof v === 'string',
        );

        if (userIds.length === 0) {
          return null;
        }

        return { type: 'users', userIds };
      }

      default:
        return null;
    }
  }

  /**
   * Deterministic hash from a string seed into [0, 1).
   * Uses a simple 32‑bit accumulator; sufficient for stable percentage rollouts.
   */
  private stableHashToUnitInterval(seed: string): number {
    let hash = 0;

    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }

    const unsigned = hash >>> 0;
    return unsigned / 0xffffffff;
  }

  /**
   * Helper: parse Date or ISO string into Date, returning null on invalid input.
   */
  private toDateOrNull(value?: Date | string | null): Date | null {
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
}
