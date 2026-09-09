import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

import { IdentityLinkService } from './identity-link.service';

/**
 * Standard result shape used across Core Services:
 * { ok: true, data: ..., error: null } or
 * { ok: false, data: null, error: { code, message, details? } }
 *
 * See Core Services spec for the canonical shape.
 */
export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error:
    | null
    | {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
}

/**
 * Logical view of a user–person link.
 * Physically this is backed by person_profiles.linked_user_id,
 * together with the shared organization_id invariant.
 */
export interface IdentityLinkView {
  organizationId: string;
  userId: string;
  personId: string;
}

/**
 * DTO for creating or updating a user–person link.
 *
 * The actual multi‑tenant enforcement is done in the service:
 * - userId and personId must both belong to organizationId
 * - person_profiles.linked_user_id is updated accordingly
 */
export class LinkUserToPersonDto {
  @IsUUID('4')
  userId!: string;

  @IsUUID('4')
  personId!: string;

  /**
   * If true, the service may break an existing link for the user or person
   * in order to apply this new link. If false, conflicting links should
   * cause a validation error.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/**
 * DTO for unlinking a user–person pair.
 *
 * At least one of userId or personId must be provided; the service will
 * resolve the other from existing data (if any).
 */
export class UnlinkUserFromPersonDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsUUID('4')
  personId?: string;
}

/**
 * IdentityLinkController
 *
 * Responsibility: thin HTTP layer over IdentityLinkService for linking and
 * unlinking user accounts (user_accounts) and person profiles (person_profiles)
 * within a single organization.
 *
 * Route base is kept narrow; the global Nest app prefix (e.g. /api/v3)
 * is assumed to be configured at bootstrap level.
 */
@Controller('identity-link')
export class IdentityLinkController {
  constructor(private readonly identityLinkService: IdentityLinkService) {}

  /**
   * Create or update a link between a UserAccount and a PersonProfile.
   *
   * - organizationId is taken from the X-Organization-Id header.
   * - userId and personId must both belong to that organization.
   * - If force=true, the service may overwrite existing links.
   *
   * Example request:
   *   POST /identity-link
   *   Headers:
   *     X-Organization-Id: <org-uuid>
   *   Body:
   *   {
   *     "userId": "<user-uuid>",
   *     "personId": "<person-uuid>",
   *     "force": false
   *   }
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async linkUserToPerson(
    @Headers('x-organization-id') organizationId: string,
    @Body() body: LinkUserToPersonDto,
  ): Promise<StandardResult<IdentityLinkView>> {
    const orgId = this.normalizeOrganizationId(organizationId);

    return this.identityLinkService.linkUserToPerson({
      organizationId: orgId,
      userId: body.userId,
      personId: body.personId,
      force: body.force ?? false,
    });
  }

  /**
   * Remove a link between a UserAccount and a PersonProfile.
   *
   * At least one of userId or personId must be provided. The service will
   * resolve the other side if a link exists and clear it.
   *
   * Example request:
   *   DELETE /identity-link
   *   Headers:
   *     X-Organization-Id: <org-uuid>
   *   Body:
   *   {
   *     "personId": "<person-uuid>"
   *   }
   *
   * On success, data will typically be null (no active link remains).
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  async unlinkUserFromPerson(
    @Headers('x-organization-id') organizationId: string,
    @Body() body: UnlinkUserFromPersonDto,
  ): Promise<StandardResult<IdentityLinkView | null>> {
    const orgId = this.normalizeOrganizationId(organizationId);

    if (!body.userId && !body.personId) {
      throw new BadRequestException(
        'At least one of userId or personId must be provided to unlink.',
      );
    }

    return this.identityLinkService.unlinkUserFromPerson({
      organizationId: orgId,
      userId: body.userId,
      personId: body.personId,
    });
  }

  /**
   * Fetch the current PersonProfile link for a given UserAccount.
   *
   * Example request:
   *   GET /identity-link/user/<userId>
   *   Headers:
   *     X-Organization-Id: <org-uuid>
   *
   * If no link exists, ok=true with data=null is returned.
   */
  @Get('user/:userId')
  async getLinkForUser(
    @Headers('x-organization-id') organizationId: string,
    @Param('userId') userId: string,
  ): Promise<StandardResult<IdentityLinkView | null>> {
    const orgId = this.normalizeOrganizationId(organizationId);

    if (!userId) {
      throw new BadRequestException('userId path parameter is required.');
    }

    return this.identityLinkService.getLinkByUserId({
      organizationId: orgId,
      userId,
    });
  }

  /**
   * Fetch the current UserAccount link for a given PersonProfile.
   *
   * Example request:
   *   GET /identity-link/person/<personId>
   *   Headers:
   *     X-Organization-Id: <org-uuid>
   *
   * If no link exists, ok=true with data=null is returned.
   */
  @Get('person/:personId')
  async getLinkForPerson(
    @Headers('x-organization-id') organizationId: string,
    @Param('personId') personId: string,
  ): Promise<StandardResult<IdentityLinkView | null>> {
    const orgId = this.normalizeOrganizationId(organizationId);

    if (!personId) {
      throw new BadRequestException('personId path parameter is required.');
    }

    return this.identityLinkService.getLinkByPersonId({
      organizationId: orgId,
      personId,
    });
  }

  /**
   * Normalize and validate the organization ID header.
   *
   * This keeps multi‑tenant invariants explicit at the controller boundary.
   */
  private normalizeOrganizationId(raw: string | undefined): string {
    const value = (raw || '').trim();

    if (!value) {
      throw new BadRequestException(
        'Missing X-Organization-Id header for multi-tenant operation.',
      );
    }

    return value;
  }
}
