import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Request } from 'express';
import { PersonProfileService } from './person-profile.service';

interface RequestWithContext extends Request {
  /**
   * Organization (tenant) identifier injected by auth/multi-tenant middleware.
   */
  organizationId?: string;

  /**
   * Authenticated user identifier injected by auth middleware.
   */
  userId?: string;
}

/**
 * Mirrors the `confidentiality_level` enum on `person_profiles`:
 *   normal | sensitive | highly_sensitive
 * :contentReference[oaicite:0]{index=0}
 */
export enum ConfidentialityLevel {
  NORMAL = 'normal',
  SENSITIVE = 'sensitive',
  HIGHLY_SENSITIVE = 'highly_sensitive',
}

/**
 * Canonical Person Profile representation at the API boundary.
 * Shape is aligned to the `person_profiles` table and Insights dim_persons. 
 */
export class PersonProfileDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Stable person identifier (maps from person_profiles.id).',
  })
  person_id: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Owning organization (tenant) identifier.',
  })
  organization_id: string;

  @ApiProperty({
    required: false,
    format: 'uuid',
    nullable: true,
    description:
      'Linked user account (user_accounts.id) if the person also has a login account.',
  })
  linked_user_id: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'External reference, e.g. student ID or employee number.',
  })
  external_reference: string | null;

  @ApiProperty({
    maxLength: 512,
    description: 'Full display name for the person.',
  })
  full_name: string;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'date',
    description: 'Date of birth (YYYY-MM-DD), if known.',
  })
  date_of_birth: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Primary contact email for this person.',
  })
  primary_contact_email: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Primary contact phone number for this person.',
  })
  primary_contact_phone: string | null;

  @ApiProperty({
    enum: ConfidentialityLevel,
    description:
      'Confidentiality level; used by higher-level visibility and guardrail rules.',
  })
  confidentiality_level: ConfidentialityLevel;

  @ApiProperty({
    format: 'date-time',
    description: 'Creation timestamp (UTC).',
  })
  created_at: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Last update timestamp (UTC).',
  })
  updated_at: string;
}

/**
 * Payload for creating or updating (upserting) a person profile.
 * `person_id` is optional; if provided, the corresponding person will be updated.
 */
export class UpsertPersonProfileDto {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description:
      'Person identifier. If provided, the profile is updated; if omitted, a new profile is created.',
  })
  @IsOptional()
  @IsUUID('4')
  person_id?: string;

  @ApiProperty({
    maxLength: 512,
    description: 'Full display name for the person.',
  })
  @IsString()
  @MaxLength(512)
  full_name: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'External reference, e.g. student ID or employee number.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_reference?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'date',
    description: 'Date of birth (YYYY-MM-DD), if known.',
  })
  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Primary contact email for this person.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  primary_contact_email?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Primary contact phone number for this person.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  primary_contact_phone?: string;

  @ApiProperty({
    required: false,
    enum: ConfidentialityLevel,
    default: ConfidentialityLevel.NORMAL,
    description: 'Confidentiality level; defaults to normal if omitted.',
  })
  @IsOptional()
  @IsEnum(ConfidentialityLevel)
  confidentiality_level?: ConfidentialityLevel;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'uuid',
    description:
      'Linked user account (user_accounts.id) if the person also has a login account.',
  })
  @IsOptional()
  @IsUUID('4')
  linked_user_id?: string;
}

/**
 * Paginated list response for person profiles.
 */
export class PersonProfileListResponseDto {
  @ApiProperty({ type: [PersonProfileDto] })
  items: PersonProfileDto[];

  @ApiProperty({
    description: 'Total number of matching person profiles for the current filters.',
  })
  total: number;

  @ApiProperty({
    description: 'Maximum number of items returned in this page.',
  })
  limit: number;

  @ApiProperty({
    description: 'Number of items skipped from the start.',
  })
  offset: number;
}

@ApiTags('persons')
@Controller('persons')
export class PersonProfileController {
  constructor(
    private readonly personProfileService: PersonProfileService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List person profiles for the current organization',
    description:
      'Returns a paginated list of person profiles scoped to the requesting organization. Supports optional search and linking filters.',
  })
  @ApiResponse({ status: 200, type: PersonProfileListResponseDto })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Free-text search across full_name, external_reference, primary_contact_email and primary_contact_phone.',
  })
  @ApiQuery({
    name: 'external_reference',
    required: false,
    description: 'Filter by exact external reference (e.g. student ID, employee number).',
  })
  @ApiQuery({
    name: 'linked_user_id',
    required: false,
    description: 'Filter by linked user account ID (user_accounts.id).',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of items to return (default 50).',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Number of items to skip from the start (default 0).',
  })
  async listPersonProfiles(
    @Req() req: RequestWithContext,
    @Query('search') search?: string,
    @Query('external_reference') externalReference?: string,
    @Query('linked_user_id') linkedUserId?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ): Promise<PersonProfileListResponseDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);

    return this.personProfileService.listPersonProfiles(organizationId, {
      search,
      externalReference,
      linkedUserId,
      limit,
      offset,
    });
  }

  @Get(':personId')
  @ApiOperation({
    summary: 'Get a single person profile by ID',
  })
  @ApiResponse({ status: 200, type: PersonProfileDto })
  async getPersonProfile(
    @Req() req: RequestWithContext,
    @Param('personId', new ParseUUIDPipe()) personId: string,
  ): Promise<PersonProfileDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    return this.personProfileService.getPersonProfile(organizationId, personId);
  }

  @Get('by-external-reference/:externalReference')
  @ApiOperation({
    summary: 'Look up a person profile by external reference',
    description:
      'Convenience endpoint to fetch a person profile by an external reference (e.g. student ID, employee number) within the current organization.',
  })
  @ApiResponse({ status: 200, type: PersonProfileDto })
  async getPersonProfileByExternalReference(
    @Req() req: RequestWithContext,
    @Param('externalReference') externalReference: string,
  ): Promise<PersonProfileDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    return this.personProfileService.getPersonProfileByExternalReference(
      organizationId,
      externalReference,
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create or update a person profile (upsert)',
    description:
      'If person_id is present in the payload, updates the existing profile (scoped to the current organization). If person_id is omitted, creates a new person profile.',
  })
  @ApiResponse({ status: 200, type: PersonProfileDto })
  async upsertPersonProfile(
    @Req() req: RequestWithContext,
    @Body() payload: UpsertPersonProfileDto,
  ): Promise<PersonProfileDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    const actorUserId = this.getUserIdFromRequest(req);

    return this.personProfileService.upsertPersonProfile(
      organizationId,
      payload,
      actorUserId,
    );
  }

  @Put(':personId')
  @ApiOperation({
    summary: 'Update an existing person profile',
    description:
      'Updates an existing person profile identified by the path parameter. The path ID takes precedence over any person_id provided in the body.',
  })
  @ApiResponse({ status: 200, type: PersonProfileDto })
  async updatePersonProfile(
    @Req() req: RequestWithContext,
    @Param('personId', new ParseUUIDPipe()) personId: string,
    @Body() payload: UpsertPersonProfileDto,
  ): Promise<PersonProfileDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    const actorUserId = this.getUserIdFromRequest(req);

    const finalPayload: UpsertPersonProfileDto = {
      ...payload,
      person_id: personId,
    };

    return this.personProfileService.upsertPersonProfile(
      organizationId,
      finalPayload,
      actorUserId,
    );
  }

  @Delete(':personId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete or anonymise a person profile',
    description:
      'Deletes (or, depending on implementation, anonymises) a person profile within the current organization. Implementations should respect guardrails for sensitive data.',
  })
  @ApiResponse({ status: 204 })
  async deletePersonProfile(
    @Req() req: RequestWithContext,
    @Param('personId', new ParseUUIDPipe()) personId: string,
  ): Promise<void> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    const actorUserId = this.getUserIdFromRequest(req);

    await this.personProfileService.deletePersonProfile(
      organizationId,
      personId,
      actorUserId,
    );
  }

  /**
   * Extracts the organization identifier from the request context.
   * Throws a 400 error if the context is missing.
   */
  private getOrganizationIdFromRequest(req: RequestWithContext): string {
    const organizationId = req.organizationId;
    if (!organizationId) {
      throw new BadRequestException('Missing organization context on request.');
    }
    return organizationId;
  }

  /**
   * Extracts the authenticated user identifier from the request context, if present.
   */
  private getUserIdFromRequest(req: RequestWithContext): string | undefined {
    return req.userId;
  }
}
