// apps/api/src/orgo/domain/education/education.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Request } from 'express';

import {
  TaskCategory,
  TaskPriority,
  TaskSeverity,
  TaskVisibility,
  TaskSource,
} from '../../core/tasks/dto/create-task.dto';
import { EducationModuleService } from './education-module.service';

/**
 * Request type of the Nest app: auth / multi‑tenant middleware
 * injects organizationId and userId.
 *
 * This mirrors the pattern used in PersonProfileController.
 */
interface RequestWithContext extends Request {
  organizationId?: string;
  userId?: string;
}

/**
 * Request body for registering a student / classroom incident
 * in the Education domain.
 *
 * This is a thin wrapper over the canonical Task create payload,
 * with additional education‑specific context fields.
 */
export class RegisterStudentIncidentDto {
  @ApiProperty({
    description:
      'Canonical information label for this incident (e.g. "100.94.Education.Safety").',
    example: '100.94.Education.Safety',
  })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({
    description: 'Short human‑readable title of the incident.',
    maxLength: 512,
    example: 'Verbal conflict during math class',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  title!: string;

  @ApiProperty({
    description: 'Detailed description of what happened.',
    example:
      'Two students had a verbal conflict during the lesson; no physical violence reported.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({
    description:
      'Global task category; typically "incident" for education incidents.',
    enum: TaskCategory,
    example: TaskCategory.INCIDENT,
    default: TaskCategory.INCIDENT,
  })
  @IsOptional()
  @IsEnum(TaskCategory)
  category?: TaskCategory;

  @ApiPropertyOptional({
    description: 'Priority of the incident. JSON uses lower‑case tokens.',
    enum: TaskPriority,
    example: TaskPriority.MEDIUM,
    default: TaskPriority.MEDIUM,
  })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({
    description: 'Severity of the incident. JSON uses lower‑case tokens.',
    enum: TaskSeverity,
    example: TaskSeverity.MINOR,
    default: TaskSeverity.MINOR,
  })
  @IsOptional()
  @IsEnum(TaskSeverity)
  severity?: TaskSeverity;

  @ApiPropertyOptional({
    description:
      'Visibility of the incident within the organization. Drives who can see it by default.',
    enum: TaskVisibility,
    example: TaskVisibility.INTERNAL,
    default: TaskVisibility.INTERNAL,
  })
  @IsOptional()
  @IsEnum(TaskVisibility)
  visibility?: TaskVisibility;

  @ApiPropertyOptional({
    description:
      'Source through which the incident was recorded (email, api, manual, sync).',
    enum: TaskSource,
    example: TaskSource.MANUAL,
    default: TaskSource.MANUAL,
  })
  @IsOptional()
  @IsEnum(TaskSource)
  source?: TaskSource;

  @ApiPropertyOptional({
    description:
      'Learning group providing context for the incident (class, team, study group).',
    format: 'uuid',
    nullable: true,
    example: '5f65b1f8-2b2a-4e6f-9634-2f2b1b5e12ab',
  })
  @IsOptional()
  @IsUUID('4')
  learning_group_id?: string;

  @ApiPropertyOptional({
    description:
      'Primary person the incident is about (e.g. student). Maps to person_profiles.id.',
    format: 'uuid',
    nullable: true,
    example: '3b1f0c66-0272-4bf7-8f03-4620e2a7f8da',
  })
  @IsOptional()
  @IsUUID('4')
  person_id?: string;

  @ApiPropertyOptional({
    description:
      'Free‑text context note such as "attendance", "performance", or "conflict".',
    maxLength: 1024,
    nullable: true,
    example: 'conflict',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  context_note?: string;

  @ApiPropertyOptional({
    description:
      'Optional due date for follow‑up action related to this incident (ISO‑8601 timestamp, UTC).',
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2025-01-10T12:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  due_at?: string;

  @ApiPropertyOptional({
    description:
      'Arbitrary domain‑specific metadata attached to the task (must not duplicate core Task fields).',
    type: 'object',
    nullable: true,
    example: { location: 'Room 204', period: 3 },
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

/**
 * Education incident view returned by the domain API.
 *
 * For now this wraps the canonical Task JSON plus education context.
 * The concrete shape of `task` follows the Task JSON schema (Doc 8).
 */
export class EducationIncidentDto {
  @ApiProperty({
    description:
      'Canonical Task representation for the incident (see Task JSON schema).',
    type: 'object',
  })
  // Use a loose type here to avoid tight coupling to the TaskController DTO.
  // Callers should treat this as the standard Task JSON envelope.
  task!: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Learning group associated with this incident, if any (learning_groups.id).',
    format: 'uuid',
    nullable: true,
  })
  learning_group_id?: string | null;

  @ApiPropertyOptional({
    description:
      'Person the incident is primarily about, if any (person_profiles.id).',
    format: 'uuid',
    nullable: true,
  })
  person_id?: string | null;

  @ApiPropertyOptional({
    description:
      'Domain‑level context note (e.g. "attendance", "performance", "conflict").',
    nullable: true,
  })
  context_note?: string | null;
}

/**
 * Paginated list response for classroom incidents.
 */
export class EducationIncidentListResponseDto {
  @ApiProperty({ type: [EducationIncidentDto] })
  items!: EducationIncidentDto[];

  @ApiProperty({
    description: 'Total number of matching incidents for the current filters.',
    example: 42,
  })
  total!: number;

  @ApiProperty({
    description: 'Current page number (1‑based).',
    example: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Page size (number of items per page).',
    example: 25,
  })
  pageSize!: number;
}

/**
 * Education domain API controller.
 *
 * Route base is kept narrow; the global Nest app prefix (e.g. /api/v3)
 * is assumed to be configured at bootstrap level.
 *
 * External paths (with a global /api/v3 prefix) will look like:
 *   POST /api/v3/domain/education/incidents
 *   GET  /api/v3/domain/education/incidents
 */
@ApiTags('domain-education')
@ApiBearerAuth()
@Controller('domain/education')
export class EducationController {
  constructor(
    private readonly educationService: EducationModuleService,
  ) {}

  @Post('incidents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a student / classroom incident',
    description:
      'Wraps Task creation for education incidents, attaching learning group and person context metadata on top of the canonical Task model.',
  })
  @ApiResponse({
    status: 201,
    type: EducationIncidentDto,
    description: 'Incident created successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or missing organization context.',
  })
  async registerStudentIncident(
    @Req() req: RequestWithContext,
    @Body() payload: RegisterStudentIncidentDto,
  ): Promise<EducationIncidentDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    const actorUserId = this.getUserIdFromRequest(req);

    // Delegate to the domain service. The service is responsible for:
    // - Constructing the canonical Task (type = "education_support")
    // - Applying domain/workflow overrides
    // - Creating the EducationTaskLink row with group/person context
    return this.educationService.registerStudentIncident(
      organizationId,
      payload,
      actorUserId,
    );
  }

  @Get('incidents')
  @ApiOperation({
    summary: 'List classroom incidents for the current organization',
    description:
      'Returns a paginated list of education‑scoped incidents (Task + education context), filtered by group/person/status/severity as needed.',
  })
  @ApiResponse({
    status: 200,
    type: EducationIncidentListResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
  })
  @ApiQuery({
    name: 'learning_group_id',
    required: false,
    description:
      'Filter by learning group (class/team) identifier (learning_groups.id).',
  })
  @ApiQuery({
    name: 'person_id',
    required: false,
    description:
      'Filter by primary person the incident is about (person_profiles.id).',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Optional Task status filter (PENDING, IN_PROGRESS, COMPLETED, etc.).',
  })
  @ApiQuery({
    name: 'severity',
    required: false,
    description:
      'Optional severity filter (MINOR, MODERATE, MAJOR, CRITICAL). Uses DB enum tokens.',
    enum: TaskSeverity,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Free‑text search over label, title and description for incidents in this organization.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1‑based). Defaults to 1.',
  })
  @ApiQuery({
    name: 'page_size',
    required: false,
    description: 'Page size (items per page). Defaults to 25.',
  })
  async listIncidents(
    @Req() req: RequestWithContext,
    @Query('learning_group_id') learningGroupId?: string,
    @Query('person_id') personId?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: TaskSeverity,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('page_size', new DefaultValuePipe(25), ParseIntPipe) pageSize = 25,
  ): Promise<EducationIncidentListResponseDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);

    return this.educationService.listIncidents(organizationId, {
      learningGroupId,
      personId,
      status,
      severity,
      search,
      page,
      pageSize,
    });
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
