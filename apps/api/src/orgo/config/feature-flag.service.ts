// apps/api/src/orgo/config/feature-flag.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { FeatureFlag } from '@prisma/client';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import type { FunctionalId } from '../core/functional-ids';

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
 * Canonical environment values for Orgo v3 (Doc 2 – ENVIRONMENT).
 *
 * This is kept local to avoid taking a hard dependency on controller/config
 * classes. It must stay aligned with the values used in the HTTP layer.
 */
export type OrgoEnvironment = 'dev' | 'staging' | 'prod' | 'offline';

/**
 * Context used when evaluating whether a flag is effectively enabled.
 *
 * organizationId:
 *   - Organization that the evaluation is being performed for.
 * userId / roleCodes:
 *   - Optional user / role context for role/user‑scoped rollouts.
 * environment:
 *   - Environment in which the evaluation happens (dev/staging/prod/offline).
 * functionalId:
 *   - Optional FunctionalId the evaluation is associated with, used for
 *     per‑function flag evaluation.
 */
export interface FeatureFlagEvaluationContext {
  organizationId?: string | null;
  userId?: string | null;
  roleCodes?: string[];
  environment?: OrgoEnvironment;
  functionalId?: FunctionalId;
}

/**
 * Input for FeatureFlagService.setFlag (entity‑level upsert).
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
 * Scope for environment‑ and organization‑aware feature flag operations.
 *
 * organizationId:
 *   - UUID for org‑scoped evaluation, or null/undefined for global.
 * environment:
 *   - Canonical environment (dev/staging/prod/offline).
 */
export interface FeatureFlagScope {
  environment: OrgoEnvironment;
  organizationId?: string | null;
}

/**
 * View model for feature flags as exposed to API / other services.
 *
 * This intentionally mirrors FeatureFlagDto from feature-flag.controller.ts
 * but is defined here to avoid a circular dependency on the controller layer.
 */
export interface FeatureFlagView {
  key: string;
  enabled: boolean;
  description?: string;
  rolloutPercentage?: number | null;
  environment: OrgoEnvironment;
  organizationId?: string | null;
  updatedAt?: string;
  updatedByUserId?: string | null;
  /**
   * True if the flag value is inherited from a global default (organization_id = NULL)
   * rather than defined explicitly for the requested organization.
   */
  inherited?: boolean;
}

/**
 * Input for environment/org‑scoped upsert used by the HTTP layer.
 *
 * key:
 *   - Stable feature flag key (e.g. "orgo.insights.enabled").
 * rolloutPercentage:
 *   - Optional 0–100 rollout percentage; when undefined/null, no gradual rollout
 *     is configured and the flag is either fully on or off.
 */
export interface UpsertFeatureFlagForScopeInput {
  key: string;
  enabled: boolean;
  description?: string;
  rolloutPercentage?: number | null;
  environment: OrgoEnvironment;
  organizationId?: string | null;
}

/**
 * FeatureFlagService
 *
 * Manages feature_flags to gradually roll out or restrict features per
 * organization and environment. The physical table shape is defined in the
 * Orgo DB schema reference (Doc 1, feature_flags). 
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Entity-level operations (global/org scopes, no environment dimension)
  // ---------------------------------------------------------------------------

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
   * Entity-level get:
   * Fetch a single flag by code for an organization, with override resolution:
   * - Prefers org‑scoped flag if present.
   * - Falls back to global flag.
   */
  async getFlag(
    code: string,
    organizationId?: string | null,
  ): Promise<FeatureFlag | null>;

  /**
   * Scoped view get:
   * Returns a FeatureFlagView for the given key/org/environment scope.
   *
   * This is the entry point expected by the /orgo/config/feature-flags GET /:key
   * endpoint (FeatureFlagController.getFeatureFlag). :contentReference[oaicite:1]{index=1}
   */
  async getFlag(input: {
    key: string;
    environment: OrgoEnvironment;
    organizationId?: string | null;
  }): Promise<FeatureFlagView | null>;

  async getFlag(
    codeOrInput:
      | string
      | { key: string; environment: OrgoEnvironment; organizationId?: string | null },
    organizationId?: string | null,
  ): Promise<FeatureFlag | FeatureFlagView | null> {
    // Entity-level usage (existing behaviour).
    if (typeof codeOrInput === 'string') {
      return this.getFlagEntity(codeOrInput, organizationId);
    }

    // Scoped view usage.
    const { key, environment, organizationId: orgIdInput } = codeOrInput;
    const orgId = orgIdInput ?? null;
    const entity = await this.getFlagEntity(key, orgId);

    if (!entity) {
      return null;
    }

    return this.toView(entity, { environment, organizationId: orgId });
  }

  /**
   * Evaluate whether a feature is effectively enabled for the given context:
   * - resolves org/global override,
   * - checks enabled boolean + time window,
   * - applies rollout_strategy (percentage / roles / users) if present.
   *
   * If the flag does not exist, is disabled, is outside its active window,
   * or has an invalid rollout strategy, this returns false (safe default). 
   */
  async isFeatureEnabled(
    code: string,
    params: {
      organizationId?: string | null;
      context?: FeatureFlagEvaluationContext;
    } = {},
  ): Promise<boolean> {
    const { organizationId, context } = params;
    const flag = await this.getFlagEntity(code, organizationId);

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
   * Convenience wrapper to evaluate feature flags keyed by FunctionalId.
   *
   * Mapping:
   *   - By default, the feature flag code is the FunctionalId string itself.
   *     For example, a FunctionalId of "FN_TASK_CREATE" maps to a flag with
   *     code "FN_TASK_CREATE". This matches the "per-function overrides"
   *     design in the functional ID inventory docs. :contentReference[oaicite:3]{index=3}
   *
   * Usage:
   *   - Callers can gate behaviour on FunctionalId values without knowing the
   *     underlying flag codes or rollout strategy details.
   */
  async isFeatureEnabledForFunctionalId(
    functionalId: FunctionalId,
    params: {
      organizationId?: string | null;
      environment?: OrgoEnvironment;
      userId?: string | null;
      roleCodes?: string[];
    } = {},
  ): Promise<boolean> {
    const { organizationId, environment, userId, roleCodes } = params;

    const context: FeatureFlagEvaluationContext = {
      organizationId: organizationId ?? null,
      environment,
      userId: userId ?? undefined,
      roleCodes,
      functionalId,
    };

    const code = this.functionalIdToFlagCode(functionalId);
    return this.isFeatureEnabled(code, { organizationId, context });
  }

  /**
   * Entity-level upsert:
   * Create or update a feature flag for an organization.
   *
   * Semantics:
   * - (orgId, code) pair is treated as unique (org override vs global default).
   * - If a row exists, it is updated; otherwise a new row is created.
   * - When enabled = true and no enabledFrom is provided, enabledFrom defaults to now.
   * - When enabled = false and no disabledAt is provided, disabledAt defaults to now.
   */
  async setFlag(input: SetFeatureFlagInput): Promise<FeatureFlag>;

  /**
   * Scoped upsert used by the HTTP layer: creates or updates a flag for a
   * given org/environment scope, returning a FeatureFlagView.
   *
   * This matches the semantics of PUT /orgo/config/feature-flags/:key in
   * FeatureFlagController. 
   */
  async setFlag(input: UpsertFeatureFlagForScopeInput): Promise<FeatureFlagView>;

  async setFlag(
    input: SetFeatureFlagInput | UpsertFeatureFlagForScopeInput,
  ): Promise<FeatureFlag | FeatureFlagView> {
    // Entity-level upsert (called from internal services / ConfigController).
    if ((input as SetFeatureFlagInput).code !== undefined) {
      return this.setFlagEntity(input as SetFeatureFlagInput);
    }

    // Scoped (org + environment) upsert (called from FeatureFlagController).
    const scoped = input as UpsertFeatureFlagForScopeInput;
    const orgId = scoped.organizationId ?? null;

    const rolloutStrategy: RolloutStrategy | null =
      scoped.rolloutPercentage == null
        ? null
        : {
            type: 'percentage',
            percentage: scoped.rolloutPercentage,
          };

    const entity = await this.setFlagEntity({
      organizationId: orgId,
      code: scoped.key,
      enabled: scoped.enabled,
      description: scoped.description,
      rolloutStrategy,
    });

    return this.toView(entity, {
      environment: scoped.environment,
      organizationId: orgId,
    });
  }

  // ---------------------------------------------------------------------------
  // Org/environment-scoped helpers (used by orgo/config/feature-flags)
  // ---------------------------------------------------------------------------

  /**
   * List feature flags for a given org/environment scope.
   *
   * Behaviour:
   * - Resolves global vs org‑specific overrides as in listFlagsForOrganization.
   * - Computes the effective enabled state for each flag in the scope using
   *   the same semantics as isFeatureEnabled (enabled + time window + rollout).
   */
  async listFlags(scope: FeatureFlagScope): Promise<FeatureFlagView[]> {
    const { environment, organizationId } = scope;
    const orgId = organizationId ?? null;

    const entities = await this.listFlagsForOrganization(orgId);

    return entities.map((flag) =>
      this.toView(flag, {
        environment,
        organizationId: orgId,
      }),
    );
  }

  /**
   * Delete a feature flag value for a given org/environment scope.
   *
   * Current storage is keyed only by (organizationId, code) as per the DB
   * schema, so environment is accepted for API symmetry but not persisted.
   * Deleting a flag for an org does not affect global defaults or other orgs.
   */
  async deleteFlag(input: {
    key: string;
    environment: OrgoEnvironment;
    organizationId?: string | null;
  }): Promise<void> {
    const orgId = input.organizationId ?? null;

    await this.prisma.featureFlag.deleteMany({
      where: {
        code: input.key,
        organizationId: orgId,
      },
    });

    this.logger.log(
      `Deleted feature flag "${input.key}" for org=${orgId ?? 'GLOBAL'} env=${input.environment}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async getFlagEntity(
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

  private async setFlagEntity(input: SetFeatureFlagInput): Promise<FeatureFlag> {
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
   * Compute the effective enabled state of a flag for a given scope using the
   * same semantics as isFeatureEnabled, but without re‑querying the DB.
   */
  private isFlagEnabledForScope(
    flag: FeatureFlag,
    scope: FeatureFlagScope,
  ): boolean {
    if (!flag.enabled) {
      return false;
    }

    if (!this.isWithinActiveWindow(flag)) {
      return false;
    }

    const context: FeatureFlagEvaluationContext = {
      organizationId: flag.organizationId ?? scope.organizationId ?? null,
      environment: scope.environment,
    };

    return this.evaluateRolloutStrategy(flag.rolloutStrategy, context);
  }

  /**
   * Map a raw FeatureFlag entity to a FeatureFlagView for a given scope.
   */
  private toView(flag: FeatureFlag, scope: FeatureFlagScope): FeatureFlagView {
    const enabled = this.isFlagEnabledForScope(flag, scope);

    const normalizedStrategy = this.normalizeRolloutStrategy(
      flag.rolloutStrategy,
    );
    const rolloutPercentage =
      normalizedStrategy?.type === 'percentage'
        ? Math.max(0, Math.min(100, normalizedStrategy.percentage))
        : null;

    const orgId = scope.organizationId ?? null;
    const inherited = !!orgId && !flag.organizationId;

    return {
      key: flag.code,
      enabled,
      description: flag.description ?? undefined,
      rolloutPercentage,
      environment: scope.environment,
      organizationId: flag.organizationId ?? null,
      updatedAt: flag.updatedAt?.toISOString?.(),
      updatedByUserId: null,
      inherited,
    };
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
          : Array.isArray(obj['roles'])
          ? obj['roles']
          : [];

        const roleCodes = rawRoleCodes
          .map((value) => String(value).trim())
          .filter(Boolean);

        if (roleCodes.length === 0) {
          return null;
        }

        return { type: 'roles', roleCodes };
      }

      case 'users': {
        const rawUserIds = Array.isArray(obj.userIds)
          ? obj.userIds
          : Array.isArray(obj['users'])
          ? obj['users']
          : [];

        const userIds = rawUserIds
          .map((value) => String(value).trim())
          .filter(Boolean);

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
   * Mapping from FunctionalId → feature flag code.
   *
   * Currently this is a 1:1 mapping, but is kept as a separate helper so
   * naming conventions (e.g. prefixes) can be evolved without touching
   * callers that rely on FunctionalId.
   */
  private functionalIdToFlagCode(functionalId: FunctionalId): string {
    return functionalId;
  }

  /**
   * Deterministic hash of a string into the [0, 1) interval.
   *
   * Uses a simple FNV‑like hash; not cryptographically secure, but stable and
   * sufficient for percentage rollout bucketing.
   */
  private stableHashToUnitInterval(seed: string): number {
    let hash = 2166136261;

    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    // Convert to unsigned 32‑bit and normalize to [0, 1).
    const unsigned = hash >>> 0;
    return unsigned / 2 ** 32;
  }

  /**
   * Safely parses a Date or date‑like string into a Date, or returns null.
   */
  private toDateOrNull(value: Date | string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }
}
