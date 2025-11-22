// apps/api/src/orgo/config/org-profile.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  OrgProfileService,
  ProfileTemplate,
  ProfileDiffResult,
  ResolvedOrgProfile,
} from './org-profile.service';

/**
 * Snapshot of an organization's active behaviour profile,
 * aligned with the OrgProfileSnapshot type used in the web app.
 */
export class OrgProfileSnapshotDto {
  @ApiProperty({
    description: 'Owning organization (tenant) identifier.',
    example: 'd0f9d5c6-1234-4c89-9af1-12ab34cd56ef',
  })
  organization_id!: string;

  @ApiProperty({
    description: 'Organization slug, if available.',
    required: false,
    nullable: true,
    example: 'northside-hospital',
  })
  organization_slug?: string | null;

  @ApiProperty({
    description: 'Human-readable display name, if available.',
    required: false,
    nullable: true,
    example: 'Northside Hospital',
  })
  organization_display_name?: string | null;

  @ApiProperty({
    description:
      'Behaviour profile code applied to the organization (from profiles YAML).',
    example: 'hospital',
  })
  profile_code!: string;

  @ApiProperty({
    description:
      'Profile version from organization_profiles.version, if tracked.',
    required: false,
    nullable: true,
    example: 3,
  })
  version?: number | null;

  @ApiProperty({
    description:
      'Resolved behaviour profile attributes for the organization (snake_case keys, mirrors profiles YAML).',
    type: 'object',
  })
  profile!: ProfileTemplate;
}

/**
 * Request body for previewing the impact of switching profiles.
 *
 * The RTK Query mutation signature in the web app is:
 *   { organizationId, currentProfileCode, proposedProfileCode }
 * where organizationId is carried in the URL, and the two codes
 * are sent in the JSON body.
 */
export class ProfilePreviewRequestDto {
  @ApiProperty({
    description:
      'Profile code currently applied to the organization (for context).',
    required: false,
    example: 'default',
  })
  currentProfileCode?: string;

  @ApiProperty({
    description:
      'Profile code you are considering switching the organization to.',
    example: 'hospital',
  })
  proposedProfileCode!: string;
}

/**
 * Human-readable preview of the impact of a profile change.
 * Matches the ProfilePreviewDiff type used by OrgProfileSettingsPage.
 */
export class ProfilePreviewResponseDto {
  @ApiProperty({
    description:
      'One or two sentences summarising the overall impact of the change.',
    required: false,
    example:
      'Switching from "default" to "hospital" speeds up reactivity and tightens visibility and logging.',
  })
  summary?: string;

  @ApiProperty({
    description: 'Bullet list of key behavioural changes.',
    required: false,
    type: [String],
    example: [
      'First escalation target becomes faster: 60 min → 15 min.',
      'Logging level increases from "standard" to "audit".',
    ],
  })
  impact_bullets?: string[];

  @ApiProperty({
    description:
      'Structured diff over core behavioural knobs (reactivity, notifications, patterns, logging, defaults).',
    required: false,
    type: 'object',
  })
  raw_diff?: ProfileDiffResult;
}

@ApiTags('Config / Organization Profiles')
@Controller('orgo/config/org-profiles')
export class OrgProfileController {
  constructor(private readonly orgProfileService: OrgProfileService) {}

  /**
   * Get the resolved behaviour profile for an organization.
   *
   * Typical route (with global prefix):
   *   GET /api/v3/orgo/config/org-profiles/:organizationId
   */
  @Get(':organizationId')
  @ApiOperation({
    summary: 'Get organization profile',
    description:
      'Returns the active behaviour profile for the given organization, resolved from profiles YAML and organization_profiles.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization (tenant) identifier.',
    example: 'd0f9d5c6-1234-4c89-9af1-12ab34cd56ef',
  })
  @ApiResponse({
    status: 200,
    type: OrgProfileSnapshotDto,
  })
  async getOrganizationProfile(
    @Param('organizationId') organizationId: string,
  ): Promise<OrgProfileSnapshotDto> {
    const resolved = await this.orgProfileService.loadProfile(organizationId);
    return this.toSnapshot(resolved);
  }

  /**
   * Preview the impact of switching an organization to a new profile code.
   *
   * Typical route (with global prefix):
   *   POST /api/v3/orgo/config/org-profiles/:organizationId/preview
   *
   * This uses OrgProfileService.previewProfileDiff and turns its
   * structured diff into the summary + bullet list expected
   * by OrgProfileSettingsPage.
   */
  @Post(':organizationId/preview')
  @ApiOperation({
    summary: 'Preview impact of profile change',
    description:
      'Simulates switching an organization to a new profile and returns a human-readable summary of key behavioural changes.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization (tenant) identifier.',
    example: 'd0f9d5c6-1234-4c89-9af1-12ab34cd56ef',
  })
  @ApiResponse({
    status: 200,
    type: ProfilePreviewResponseDto,
  })
  async previewProfileChange(
    @Param('organizationId') organizationId: string,
    @Body() body: ProfilePreviewRequestDto,
  ): Promise<ProfilePreviewResponseDto> {
    const candidateProfileCode = body.proposedProfileCode;

    if (!candidateProfileCode) {
      throw new BadRequestException('proposedProfileCode is required.');
    }

    const diff = await this.orgProfileService.previewProfileDiff(
      organizationId,
      candidateProfileCode,
    );

    return this.buildPreviewResponse(diff);
  }

  /* ---------------------------------------------------------------------- */
  /*  Private helpers                                                       */
  /* ---------------------------------------------------------------------- */

  private toSnapshot(resolved: ResolvedOrgProfile): OrgProfileSnapshotDto {
    const dto = new OrgProfileSnapshotDto();

    dto.organization_id = resolved.organizationId;
    dto.organization_slug = null;
    dto.organization_display_name = null;
    dto.profile_code = resolved.profileCode;
    dto.version = resolved.dbProfile?.version ?? null;
    dto.profile = resolved.template;

    return dto;
  }

  private buildPreviewResponse(
    diff: ProfileDiffResult,
  ): ProfilePreviewResponseDto {
    const response = new ProfilePreviewResponseDto();
    response.summary = this.buildSummary(diff);
    response.impact_bullets = this.buildImpactBullets(diff);
    response.raw_diff = diff;
    return response;
  }

  private buildSummary(diff: ProfileDiffResult): string {
    const {
      organizationId,
      currentProfileCode,
      candidateProfileCode,
      currentProfileSummary,
      candidateProfileSummary,
    } = diff;

    const candidateLabel =
      candidateProfileSummary?.description || candidateProfileCode;
    const currentLabel =
      currentProfileSummary?.description || currentProfileCode || 'none';

    let summary: string;

    if (!currentProfileSummary) {
      summary = `Applying profile "${candidateProfileCode}" (${candidateLabel}) for organization ${organizationId}.`;
    } else {
      summary = `Changing profile from "${currentProfileCode}" (${currentLabel}) to "${candidateProfileCode}" (${candidateLabel}) for organization ${organizationId}.`;
    }

    const reactivityChange = diff.numericChanges.find(
      (c) => c.field === 'reactivity_seconds' && c.direction !== 'same',
    );

    if (reactivityChange) {
      const directionText =
        reactivityChange.direction === 'decrease'
          ? 'faster initial response'
          : 'slower initial response';

      const fromText = this.formatSeconds(reactivityChange.from);
      const toText = this.formatSeconds(reactivityChange.to);

      summary += ` This will result in ${directionText} (${fromText} → ${toText}).`;
    }

    return summary;
  }

  private buildImpactBullets(diff: ProfileDiffResult): string[] {
    const bullets: string[] = [];

    for (const change of diff.numericChanges) {
      if (change.direction === 'same') continue;

      const { field, from, to, direction } = change;

      switch (field) {
        case 'reactivity_seconds': {
          const faster = direction === 'decrease';
          const fromText = this.formatSeconds(from);
          const toText = this.formatSeconds(to);
          bullets.push(
            `First escalation target becomes ${
              faster ? 'faster' : 'slower'
            }: ${fromText} → ${toText}.`,
          );
          break;
        }

        case 'max_escalation_seconds': {
          const fromText = this.formatSeconds(from);
          const toText = this.formatSeconds(to);
          bullets.push(
            `Full escalation window changes from ${fromText} to ${toText}.`,
          );
          break;
        }

        case 'pattern_window_days': {
          const fromText = this.formatDays(from);
          const toText = this.formatDays(to);
          bullets.push(
            `Pattern detection window changes from ${fromText} to ${toText}.`,
          );
          break;
        }

        case 'pattern_min_events': {
          const fromText =
            typeof from === 'number' ? `${from}` : 'the current default';
          bullets.push(
            `Pattern detection will require ${to} events instead of ${fromText}.`,
          );
          break;
        }

        case 'log_retention_days': {
          const fromText = this.formatDays(from);
          const toText = this.formatDays(to);
          bullets.push(
            `Log retention changes from ${fromText} to ${toText}, affecting how long detailed records are kept.`,
          );
          break;
        }

        default:
          break;
      }
    }

    for (const change of diff.enumChanges) {
      if (!change.changed) continue;

      const fromText = change.from ? change.from.toLowerCase() : 'current';
      const toText = change.to.toLowerCase();

      switch (change.field) {
        case 'notification_scope':
          bullets.push(
            `Notification scope changes from "${fromText}" to "${toText}", altering who is alerted by default.`,
          );
          break;

        case 'pattern_sensitivity':
          bullets.push(
            `Pattern sensitivity changes from "${fromText}" to "${toText}", affecting how easily systemic patterns trigger reviews.`,
          );
          break;

        case 'logging_level':
          bullets.push(
            `Logging level changes from "${fromText}" to "${toText}", adjusting traceability and audit depth.`,
          );
          break;

        case 'default_visibility':
          bullets.push(
            `Default visibility for new Tasks and Cases changes from "${fromText}" to "${toText}".`,
          );
          break;

        case 'default_priority':
          bullets.push(
            `Default priority for new Tasks and Cases changes from "${fromText}" to "${toText}".`,
          );
          break;

        default:
          break;
      }
    }

    return bullets;
  }

  private formatSeconds(value?: number | null): string {
    if (value == null || Number.isNaN(value)) return '—';

    const seconds = Math.round(value);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h`;

    const days = Math.round(hours / 24);
    return `${days} d`;
  }

  private formatDays(value?: number | null): string {
    if (value == null || Number.isNaN(value)) return '—';

    const days = Math.round(value);
    return days === 1 ? '1 day' : `${days} days`;
  }
}
