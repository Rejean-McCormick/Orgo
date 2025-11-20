// apps/api/src/orgo/config/feature-flag.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiProperty,
} from '@nestjs/swagger';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Canonical environment values for Orgo v3 (Doc 2 – ENVIRONMENT).
 * This is kept local to avoid coupling to config-loader details.
 */
export type OrgoEnvironment = 'dev' | 'staging' | 'prod' | 'offline';

/**
 * Scope for listing / reading / deleting feature flags.
 * Flags can be global (organizationId = null) or scoped to a specific org.
 */
export class FeatureFlagScopeQueryDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Organization to scope flags to. If omitted, global flags are used (organization_id = NULL).',
  })
  organizationId?: string;

  @ApiProperty({
    required: false,
    enum: ['dev', 'staging', 'prod', 'offline'],
    description:
      'Environment to scope flags to. If omitted, derived from the server environment (NODE_ENV / ORGO_ENV).',
  })
  environment?: OrgoEnvironment;
}

/**
 * DTO representing a feature flag as exposed via the API.
 * The underlying storage will typically include additional fields;
 * this shape is stable for external consumers.
 */
export class FeatureFlagDto {
  @ApiProperty({
    description:
      'Stable feature flag key (e.g. "orgo.insights.enabled", "orgo.workflow.new_router").',
  })
  key!: string;

  @ApiProperty({
    description:
      'Whether the flag is currently enabled for the given org/environment scope.',
  })
  enabled!: boolean;

  @ApiProperty({
    required: false,
    description:
      'Optional human-readable description for admins; does not affect behaviour.',
  })
  description?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: 0,
    maximum: 100,
    description:
      'Optional rollout percentage (0–100). When set, downstream services may use gradual rollout.',
  })
  rolloutPercentage?: number | null;

  @ApiProperty({
    enum: ['dev', 'staging', 'prod', 'offline'],
    description: 'Environment this flag value applies to.',
  })
  environment!: OrgoEnvironment;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Organization this flag value applies to. NULL / undefined means global default (organization_id = NULL).',
  })
  organizationId?: string | null;

  @ApiProperty({
    required: false,
    type: String,
    format: 'date-time',
    description: 'Last update timestamp in ISO‑8601 (UTC), if available.',
  })
  updatedAt?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'User ID that last updated the flag (if tracked by the implementation).',
  })
  updatedByUserId?: string | null;

  @ApiProperty({
    required: false,
    description:
      'True if this value is inherited from a global default rather than defined explicitly for the org.',
  })
  inherited?: boolean;
}

/**
 * Payload for creating/updating (upserting) a feature flag value.
 * The key is taken from the URL path; this DTO controls value-level fields.
 */
export class UpsertFeatureFlagDto {
  @ApiProperty({
    description:
      'Whether the flag should be enabled for this org/environment scope.',
  })
  enabled!: boolean;

  @ApiProperty({
    required: false,
    description:
      'Optional human-readable description; stored with the flag for admin UIs.',
  })
  description?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: 0,
    maximum: 100,
    description:
      'Optional rollout percentage (0–100). When undefined, no gradual rollout is configured.',
  })
  rolloutPercentage?: number | null;

  @ApiProperty({
    required: false,
    enum: ['dev', 'staging', 'prod', 'offline'],
    description:
      'Environment to scope this flag value to. If omitted, derived from the server environment.',
  })
  environment?: OrgoEnvironment;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Organization to scope this flag value to. If omitted, the flag is treated as global (organization_id = NULL).',
  })
  organizationId?: string | null;
}

@ApiTags('Config / Feature Flags')
@Controller('orgo/config/feature-flags')
export class FeatureFlagController {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolve an Orgo ENVIRONMENT value from an optional explicit value
   * plus process / config environment variables.
   *
   * Canonical values: "dev" | "staging" | "prod" | "offline"
   * (Doc 2 – Foundations, §2.1 Environments).
   */
  private resolveEnvironment(explicit?: string): OrgoEnvironment {
    const raw =
      explicit ??
      this.configService.get<string>('ORGO_ENV') ??
      this.configService.get<string>('NODE_ENV') ??
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

  // ---------------------------------------------------------------------------
  // GET /orgo/config/feature-flags
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'List feature flags',
    description:
      'Returns all feature flags for the given org/environment scope. If organizationId is omitted, global flags are returned.',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description:
      'Organization to filter flags for. If omitted, returns global flags (organization_id = NULL).',
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    enum: ['dev', 'staging', 'prod', 'offline'],
    description:
      'Environment to filter flags for. If omitted, derived from server environment.',
  })
  @ApiResponse({ status: 200, type: FeatureFlagDto, isArray: true })
  async listFeatureFlags(
    @Query() scope: FeatureFlagScopeQueryDto,
  ): Promise<FeatureFlagDto[]> {
    const environment = this.resolveEnvironment(scope.environment);
    const organizationId = scope.organizationId ?? null;

    return this.featureFlagService.listFlags({
      environment,
      organizationId,
    });
  }

  // ---------------------------------------------------------------------------
  // GET /orgo/config/feature-flags/:key
  // ---------------------------------------------------------------------------

  @Get(':key')
  @ApiOperation({
    summary: 'Get a single feature flag',
    description:
      'Returns the effective value of a feature flag for the given org/environment scope.',
  })
  @ApiParam({
    name: 'key',
    description:
      'Feature flag key (e.g. "orgo.insights.enabled", "orgo.workflow.new_router").',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description:
      'Organization scope. If omitted, the global value (organization_id = NULL) is returned.',
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    enum: ['dev', 'staging', 'prod', 'offline'],
    description:
      'Environment scope. If omitted, derived from server environment.',
  })
  @ApiResponse({ status: 200, type: FeatureFlagDto })
  @ApiResponse({ status: 404, description: 'Flag not found for given scope.' })
  async getFeatureFlag(
    @Param('key') key: string,
    @Query() scope: FeatureFlagScopeQueryDto,
  ): Promise<FeatureFlagDto> {
    const environment = this.resolveEnvironment(scope.environment);
    const organizationId = scope.organizationId ?? null;

    const flag = await this.featureFlagService.getFlag({
      key,
      environment,
      organizationId,
    });

    if (!flag) {
      throw new NotFoundException(
        `Feature flag "${key}" not found for environment="${environment}" and organizationId="${organizationId ?? 'null'}".`,
      );
    }

    return flag;
  }

  // ---------------------------------------------------------------------------
  // PUT /orgo/config/feature-flags/:key
  // ---------------------------------------------------------------------------

  @Put(':key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create or update a feature flag (upsert)',
    description:
      'Creates or updates a feature flag value for a given org/environment scope. The key is taken from the URL path.',
  })
  @ApiParam({
    name: 'key',
    description:
      'Feature flag key (e.g. "orgo.insights.enabled", "orgo.workflow.new_router").',
  })
  @ApiBody({ type: UpsertFeatureFlagDto })
  @ApiResponse({ status: 200, type: FeatureFlagDto })
  async upsertFeatureFlag(
    @Param('key') key: string,
    @Body() body: UpsertFeatureFlagDto,
  ): Promise<FeatureFlagDto> {
    const environment = this.resolveEnvironment(body.environment);
    const organizationId = body.organizationId ?? null;

    return this.featureFlagService.setFlag({
      key,
      enabled: body.enabled,
      description: body.description,
      rolloutPercentage: body.rolloutPercentage ?? null,
      environment,
      organizationId,
    });
  }

  // ---------------------------------------------------------------------------
  // DELETE /orgo/config/feature-flags/:key
  // ---------------------------------------------------------------------------

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a feature flag value for a scope',
    description:
      'Removes a feature flag value for the given org/environment scope. Global defaults and other scopes are left untouched.',
  })
  @ApiParam({
    name: 'key',
    description: 'Feature flag key to delete.',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description:
      'Organization scope. If omitted, deletes the global value (organization_id = NULL).',
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    enum: ['dev', 'staging', 'prod', 'offline'],
    description:
      'Environment scope. If omitted, derived from the server environment.',
  })
  @ApiResponse({ status: 204, description: 'Flag deleted (or not present).' })
  async deleteFeatureFlag(
    @Param('key') key: string,
    @Query() scope: FeatureFlagScopeQueryDto,
  ): Promise<void> {
    const environment = this.resolveEnvironment(scope.environment);
    const organizationId = scope.organizationId ?? null;

    await this.featureFlagService.deleteFlag({
      key,
      environment,
      organizationId,
    });
  }
}
