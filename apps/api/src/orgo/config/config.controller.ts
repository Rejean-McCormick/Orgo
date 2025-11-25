import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ConfigService } from './config.service';
import { OrgProfileService } from './org-profile.service';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Canonical environment values used in configuration.
 */
export type Environment = 'dev' | 'staging' | 'prod' | 'offline';

/**
 * Standard result shape used by core services (Doc 5).
 * Controllers generally just pass this through to the client.
 */
export interface StandardResult<T = any> {
  ok: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: any;
  } | null;
}

/**
 * Global configuration request for GET /config.
 * All fields are optional; the service is expected to apply defaults.
 */
export interface GetGlobalConfigOptions {
  organizationId?: string;
  environment?: Environment;
  /**
   * Optional list of module identifiers whose config should be included.
   * Example: ["core", "insights", "maintenance"].
   */
  modules?: string[];
}

/**
 * Payload for updating a slice of service configuration.
 * This is intentionally generic; concrete validation lives in ConfigService.
 */
export interface UpdateServiceConfigRequest {
  /**
   * Optional organization scope; when omitted, applies to global/default config.
   */
  organizationId?: string;

  /**
   * Optional environment scope; must be one of the canonical ENVIRONMENT values (Doc 2).
   */
  environment?: Environment;

  /**
   * Logical module or service identifier, e.g. "core", "email", "logging", "insights".
   */
  module: string;

  /**
   * Arbitrary config patch for the module. The service is responsible
   * for schema validation and for writing to parameter_overrides / YAML.
   */
  changes: Record<string, unknown>;

  /**
   * Optional free-form description for audit logs.
   */
  reason?: string;
}

/**
 * Payload for importing a full configuration bundle (YAML/JSON).
 */
export interface ImportConfigBundleRequest {
  /**
   * The raw bundle. For JSON imports this will be an object; for YAML
   * you can send the YAML as a string and let ConfigService parse it.
   */
  bundle: string | Record<string, unknown>;

  /**
   * Optional hint for parser selection.
   */
  format?: 'yaml' | 'json';

  /**
   * When true, validate and compute the impact but do not persist.
   */
  dryRun?: boolean;

  /**
   * Optional environment this bundle targets.
   */
  environment?: Environment;

  /**
   * Optional organization scope for org-specific bundles.
   */
  organizationId?: string;

  /**
   * Optional human-readable description for audit trail.
   */
  reason?: string;
}

/**
 * Payload for previewing the impact of an organization profile change.
 * This is used by the Profile configuration screen (Admin UI).
 */
export interface PreviewOrgProfileRequest {
  /**
   * Target profile code, e.g. "friend_group", "hospital", "advocacy_group".
   * Must correspond to a profile defined in the profiles YAML (Doc 7).
   */
  profileCode: string;

  /**
   * Optional fine-grained overrides on top of the base profile.
   * The exact structure maps to the profiles YAML schema.
   */
  overrides?: Record<string, unknown>;
}

/**
 * Payload for toggling a feature flag.
 */
export interface SetFeatureFlagRequest {
  /**
   * Optional organization scope; when omitted, applies as a global flag.
   */
  organizationId?: string;

  /**
   * Whether the feature is enabled.
   */
  enabled: boolean;

  /**
   * Optional rollout strategy descriptor (JSONB column in DB),
   * e.g. percentage rollout, role filters, etc.
   */
  rolloutStrategy?: Record<string, unknown>;
}

/**
 * Options for listing feature flags.
 */
export interface ListFeatureFlagsOptions {
  organizationId?: string;
}

/**
 * Admin / configuration controller exposing:
 * - Global configuration (ConfigService)
 * - Organization profiles (OrgProfileService)
 * - Feature flags (FeatureFlagService)
 *
 * Route prefix aligns with the /api/v3 namespace used for other controllers.
 */
@ApiTags('config')
@Controller('api/v3/config')
export class ConfigController {
  constructor(
    private readonly configService: ConfigService,
    private readonly orgProfileService: OrgProfileService,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  // ---------------------------------------------------------------------------
  // Global configuration
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Fetch merged global configuration',
    description:
      'Returns merged base + environment + organization configuration, ' +
      'optionally filtered by module list.',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description:
      'Optional organization scope; when omitted, returns defaults/global config.',
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    description:
      'Optional environment; one of dev, staging, prod, offline. ' +
      'If omitted, the deployment default is used.',
  })
  @ApiQuery({
    name: 'modules',
    required: false,
    description:
      'Comma-separated list of module identifiers (e.g. "core,insights,maintenance"), ' +
      'or a repeated query param (modules=core&modules=insights).',
  })
  async getGlobalConfig(
    @Query('organizationId') organizationId?: string,
    @Query('environment') environment?: GetGlobalConfigOptions['environment'],
    @Query('modules') modules?: string | string[],
  ): Promise<StandardResult> {
    const moduleList = (() => {
      if (!modules) {
        return undefined;
      }

      const raw = Array.isArray(modules) ? modules : [modules];

      const tokens = raw
        .flatMap((value) => value.split(','))
        .map((m) => m.trim())
        .filter(Boolean);

      return tokens.length > 0 ? tokens : undefined;
    })();

    const opts: GetGlobalConfigOptions = {
      organizationId: organizationId || undefined,
      environment: environment || undefined,
      modules: moduleList,
    };

    return this.configService.getGlobalConfig(opts);
  }

  @Put()
  @ApiOperation({
    summary: 'Update service configuration',
    description:
      'Applies a configuration patch for a given module/environment/org scope. ' +
      'Changes are validated and audited by ConfigService.',
  })
  async updateServiceConfig(
    @Body() body: UpdateServiceConfigRequest,
  ): Promise<StandardResult> {
    return this.configService.updateServiceConfig(body);
  }

  @Post('import-bundle')
  @ApiOperation({
    summary: 'Import configuration bundle',
    description:
      'Imports a YAML/JSON bundle (including profiles and insights settings). ' +
      'Validation and atomic activation are handled by ConfigService.',
  })
  async importConfigBundle(
    @Body() body: ImportConfigBundleRequest,
  ): Promise<StandardResult> {
    return this.configService.importConfigBundle(body);
  }

  // ---------------------------------------------------------------------------
  // Organization profiles
  // ---------------------------------------------------------------------------

  @Get('org-profiles/:organizationId')
  @ApiOperation({
    summary: 'Load organization profile',
    description:
      'Returns the active behavioral profile for the given organization, ' +
      'including reactivity, transparency, pattern sensitivity and retention settings.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier (UUID or slug, depending on setup).',
  })
  @ApiQuery({
    name: 'includeDerivedDefaults',
    required: false,
    description:
      'When "true", includes derived defaults for tasks/cases/escalations in the response.',
  })
  async getOrganizationProfile(
    @Param('organizationId') organizationId: string,
    @Query('includeDerivedDefaults') includeDerivedDefaults?: string,
  ): Promise<StandardResult> {
    const includeDerived =
      typeof includeDerivedDefaults === 'string' &&
      includeDerivedDefaults.toLowerCase() === 'true';

    return this.orgProfileService.loadProfile(organizationId, {
      includeDerivedDefaults: includeDerived,
    });
  }

  @Post('org-profiles/:organizationId/preview')
  @ApiOperation({
    summary: 'Preview impact of profile changes',
    description:
      'Simulates profile changes and returns their impact on escalation timings, ' +
      'notification scope, retention and insights pattern sensitivity.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier (UUID or slug, depending on setup).',
  })
  async previewOrganizationProfile(
    @Param('organizationId') organizationId: string,
    @Body() body: PreviewOrgProfileRequest,
  ): Promise<StandardResult> {
    return this.orgProfileService.previewProfileDiff(organizationId, body);
  }

  // ---------------------------------------------------------------------------
  // Feature flags
  // ---------------------------------------------------------------------------

  @Get('feature-flags')
  @ApiOperation({
    summary: 'List feature flags',
    description:
      'Lists feature flags, optionally scoped to a specific organization.',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description:
      'Organization identifier; when omitted, returns global feature flags.',
  })
  async listFeatureFlags(
    @Query('organizationId') organizationId?: string,
  ): Promise<StandardResult> {
    const options: ListFeatureFlagsOptions = {
      organizationId: organizationId || undefined,
    };

    return this.featureFlagService.listFlags(options);
  }

  @Post('feature-flags/:code')
  @ApiOperation({
    summary: 'Toggle a feature flag',
    description:
      'Enables or disables a feature flag, optionally scoped to an organization, ' +
      'and records rollout strategy metadata.',
  })
  @ApiParam({
    name: 'code',
    description:
      'Feature flag code (e.g. "insights_cyclic_reviews_v2", "maintenance_module_v3").',
  })
  async setFeatureFlag(
    @Param('code') code: string,
    @Body() body: SetFeatureFlagRequest,
  ): Promise<StandardResult> {
    return this.featureFlagService.setFlag({
      code,
      organizationId: body.organizationId,
      enabled: body.enabled,
      rolloutStrategy: body.rolloutStrategy,
    });
  }
}
