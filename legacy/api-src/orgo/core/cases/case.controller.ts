import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CaseService } from './case.service';

// -----------------------------------------------------------------------------
// Canonical enums (mirroring Docs 2 & 8 JSON shapes for Cases / Tasks)
// -----------------------------------------------------------------------------

export const CASE_STATUS_VALUES = ['open', 'in_progress', 'resolved', 'archived'] as const;
export type CaseStatus = (typeof CASE_STATUS_VALUES)[number];

export const CASE_SEVERITY_VALUES = ['minor', 'moderate', 'major', 'critical'] as const;
export type CaseSeverity = (typeof CASE_SEVERITY_VALUES)[number];

export const VISIBILITY_VALUES = ['PUBLIC', 'INTERNAL', 'RESTRICTED', 'ANONYMISED'] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];

export const TASK_STATUS_VALUES = [
  'PENDING',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'FAILED',
  'ESCALATED',
  'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export const TASK_PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export const TASK_SEVERITY_VALUES = ['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'] as const;
export type TaskSeverity = (typeof TASK_SEVERITY_VALUES)[number];

export const TASK_CATEGORY_VALUES = [
  'request',
  'incident',
  'update',
  'report',
  'distribution',
] as const;
export type TaskCategory = (typeof TASK_CATEGORY_VALUES)[number];

export type CaseSortBy = 'created_at' | 'updated_at';
export type SortDirection = 'asc' | 'desc';

// -----------------------------------------------------------------------------
// DTOs
// -----------------------------------------------------------------------------

export class ListCasesQueryDto {
  @ApiPropertyOptional({ enum: CASE_STATUS_VALUES, description: 'Filter by Case status' })
  status?: CaseStatus;

  @ApiPropertyOptional({
    enum: CASE_SEVERITY_VALUES,
    description: 'Filter by Case severity (JSON form)',
  })
  severity?: CaseSeverity;

  @ApiPropertyOptional({
    enum: VISIBILITY_VALUES,
    description: 'Filter by visibility; maps to VISIBILITY enum',
  })
  visibility?: Visibility;

  @ApiPropertyOptional({
    description:
      'Filter by canonical label "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"',
    example: '100.94.Operations.Safety',
  })
  label?: string;

  @ApiPropertyOptional({
    description: 'Free-text search over title/description/metadata (implementation-specific)',
  })
  search?: string;

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: '1-based page number for pagination',
  })
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    default: 25,
    description: 'Page size for pagination (max 200)',
  })
  pageSize?: number;

  @ApiPropertyOptional({
    enum: ['created_at', 'updated_at'],
    default: 'updated_at',
    description: 'Field to sort by',
  })
  sortBy?: CaseSortBy;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Sort direction',
  })
  sortDirection?: SortDirection;
}

/**
 * Canonical Case JSON DTO (aligned with Doc 8 §8.4.1).
 */
export class CaseDto {
  @ApiProperty({ format: 'uuid', description: 'Case identifier (maps from cases.id)' })
  case_id!: string;

  @ApiProperty({ format: 'uuid', description: 'Owning organization (tenant) id' })
  organization_id!: string;

  @ApiProperty({
    enum: ['email', 'api', 'manual', 'sync'],
    description: 'Origin channel for this Case',
  })
  source_type!: 'email' | 'api' | 'manual' | 'sync';

  @ApiPropertyOptional({
    nullable: true,
    description: 'Channel-specific reference (e.g., email message-id, external URI)',
  })
  source_reference?: string | null;

  @ApiProperty({
    description: 'Canonical label "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"',
  })
  label!: string;

  @ApiProperty({ description: 'Short human-readable title' })
  title!: string;

  @ApiProperty({ description: 'Free-text description/body' })
  description!: string;

  @ApiProperty({
    enum: CASE_STATUS_VALUES,
    description: 'Case lifecycle status (CASE_STATUS; JSON form)',
  })
  status!: CaseStatus;

  @ApiProperty({
    enum: CASE_SEVERITY_VALUES,
    description: 'Severity (JSON form mapping to TASK_SEVERITY enum)',
  })
  severity!: CaseSeverity;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO-8601 duration; SLA window for Case handling (e.g. "PT2H")',
  })
  reactivity_time?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Vertical base of the originating label (e.g. 100, 1000)',
  })
  origin_vertical_level?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Horizontal role of origin (e.g. "Ops.Maintenance")',
  })
  origin_role?: string | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description: 'Optional tag list attached to the Case',
  })
  tags?: string[] | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description: 'Structured location payload (site/building/geo, etc.)',
  })
  location?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: Object,
    description:
      'Case-level metadata (pattern_sensitivity, review settings, domain-specific fields, etc.)',
  })
  metadata?: Record<string, unknown>;

  @ApiProperty({
    description: 'Creation timestamp (ISO-8601 UTC)',
  })
  created_at!: string;

  @ApiProperty({
    description: 'Last update timestamp (ISO-8601 UTC)',
  })
  updated_at!: string;
}

/**
 * Summary view of a Task for inclusion under a Case.
 * Uses canonical Task enums from Docs 2 & 8.
 */
export class TaskSummaryDto {
  @ApiProperty({ format: 'uuid', description: 'Task identifier (maps from tasks.id)' })
  task_id!: string;

  @ApiProperty({
    enum: TASK_STATUS_VALUES,
    description: 'Task lifecycle status (TASK_STATUS)',
  })
  status!: TaskStatus;

  @ApiProperty({
    enum: TASK_PRIORITY_VALUES,
    description: 'Task priority (TASK_PRIORITY)',
  })
  priority!: TaskPriority;

  @ApiProperty({
    enum: TASK_SEVERITY_VALUES,
    description: 'Task severity (TASK_SEVERITY)',
  })
  severity!: TaskSeverity;

  @ApiProperty({
    enum: TASK_CATEGORY_VALUES,
    description: 'Global Task category',
  })
  category!: TaskCategory;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Domain-specific subtype (e.g. "plumbing", "harassment")',
  })
  subtype?: string | null;

  @ApiProperty({
    description: 'Canonical Task label',
  })
  label!: string;

  @ApiProperty({ description: 'Short Task title' })
  title!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Current owning routing role label (e.g. "Ops.Maintenance")',
  })
  assignee_role?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Due date (ISO-8601 UTC), if any',
  })
  due_at?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'First-response SLA deadline (ISO-8601 UTC; derived from created_at + reactivity_time)',
  })
  reactivity_deadline_at?: string | null;
}

/**
 * Shape returned by GET /v3/cases/:caseId – Case plus linked Tasks.
 */
export class CaseWithTasksDto {
  @ApiProperty({ type: () => CaseDto })
  case!: CaseDto;

  @ApiProperty({ type: () => [TaskSummaryDto] })
  tasks!: TaskSummaryDto[];
}

/**
 * Paginated Case list response for GET /v3/cases.
 */
export class PaginatedCaseSummaryDto {
  @ApiProperty({ type: () => [CaseDto] })
  items!: CaseDto[];

  @ApiProperty({
    description: 'Total number of Cases matching the filter (across all pages)',
  })
  total!: number;

  @ApiProperty({
    description: 'Current page index (1-based)',
    example: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Page size used for this response',
    example: 25,
  })
  pageSize!: number;
}

// Internal normalized query representation used between controller and service.
interface NormalizedCaseListQuery {
  status?: CaseStatus;
  severity?: CaseSeverity;
  visibility?: Visibility;
  label?: string;
  search?: string;
  page: number;
  pageSize: number;
  sortBy: CaseSortBy;
  sortDirection: SortDirection;
}

// -----------------------------------------------------------------------------
// Controller
// -----------------------------------------------------------------------------

@ApiTags('cases')
@ApiExtraModels(CaseDto, TaskSummaryDto, CaseWithTasksDto, PaginatedCaseSummaryDto)
@Controller('v3/cases')
export class CaseController {
  private readonly logger = new Logger(CaseController.name);

  constructor(private readonly caseService: CaseService) {}

  /**
   * List Cases for the current organization, with basic filtering and pagination.
   *
   * External path (via reverse proxy): GET /api/v3/cases
   */
  @Get()
  @ApiOperation({
    summary: 'List Cases',
    description:
      'Returns a paginated list of Cases for the current organization, filtered by status, severity, visibility, label, and/or search text.',
  })
  @ApiOkResponse({ type: PaginatedCaseSummaryDto })
  async listCases(
    @Req() req: Request,
    @Query() query: ListCasesQueryDto,
  ): Promise<PaginatedCaseSummaryDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    const normalizedQuery = this.normalizeListQuery(query);

    this.logger.debug(
      `Listing cases for org ${organizationId} (page=${normalizedQuery.page}, pageSize=${normalizedQuery.pageSize})`,
    );

    // Implementation of listCases is provided by CaseService.
    return this.caseService.listCases(organizationId, normalizedQuery);
  }

  /**
   * Fetch a single Case and its linked Tasks for the current organization.
   *
   * External path (via reverse proxy): GET /api/v3/cases/:caseId
   */
  @Get(':caseId')
  @ApiOperation({
    summary: 'Get Case details',
    description: 'Returns a Case and its linked Tasks for the current organization.',
  })
  @ApiParam({
    name: 'caseId',
    description: 'Case identifier (UUID)',
  })
  @ApiOkResponse({ type: CaseWithTasksDto })
  async getCaseById(
    @Req() req: Request,
    @Param('caseId') caseId: string,
  ): Promise<CaseWithTasksDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);

    const result = await this.caseService.getCaseWithTasks(organizationId, caseId);

    if (!result) {
      throw new NotFoundException(
        `Case ${caseId} not found for current organization or access is not permitted.`,
      );
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Extracts the current organization id from the HTTP request.
   *
   * In a real deployment this is typically injected by an Auth/RBAC guard
   * (e.g. from a JWT). For now we expect X-Org-Id or X-Organization-Id headers.
   */
  private getOrganizationIdFromRequest(req: Request): string {
    const headerValue =
      (req.headers['x-org-id'] as string | undefined) ||
      (req.headers['x-organization-id'] as string | undefined);

    if (!headerValue) {
      throw new BadRequestException(
        'Missing organization identifier (expected X-Org-Id or X-Organization-Id header).',
      );
    }

    return headerValue;
  }

  /**
   * Normalizes list query parameters, validates enums, and applies defaults.
   */
  private normalizeListQuery(query: ListCasesQueryDto): NormalizedCaseListQuery {
    const pageRaw = query.page ?? 1;
    const page = Number.isFinite(+pageRaw) && +pageRaw > 0 ? Number(pageRaw) : 1;

    const pageSizeRaw = query.pageSize ?? 25;
    const rawPageSize = Number.isFinite(+pageSizeRaw) && +pageSizeRaw > 0 ? Number(pageSizeRaw) : 25;
    const pageSize = Math.min(rawPageSize, 200);

    let status: CaseStatus | undefined;
    if (query.status !== undefined) {
      if (!CASE_STATUS_VALUES.includes(query.status)) {
        throw new BadRequestException(
          `Invalid status "${query.status}". Expected one of: ${CASE_STATUS_VALUES.join(', ')}`,
        );
      }
      status = query.status;
    }

    let severity: CaseSeverity | undefined;
    if (query.severity !== undefined) {
      if (!CASE_SEVERITY_VALUES.includes(query.severity)) {
        throw new BadRequestException(
          `Invalid severity "${query.severity}". Expected one of: ${CASE_SEVERITY_VALUES.join(', ')}`,
        );
      }
      severity = query.severity;
    }

    let visibility: Visibility | undefined;
    if (query.visibility !== undefined) {
      if (!VISIBILITY_VALUES.includes(query.visibility)) {
        throw new BadRequestException(
          `Invalid visibility "${query.visibility}". Expected one of: ${VISIBILITY_VALUES.join(', ')}`,
        );
      }
      visibility = query.visibility;
    }

    const sortBy: CaseSortBy = (query.sortBy ?? 'updated_at') as CaseSortBy;
    if (!['created_at', 'updated_at'].includes(sortBy)) {
      throw new BadRequestException('sortBy must be one of: "created_at", "updated_at".');
    }

    const sortDirection: SortDirection = (query.sortDirection ?? 'desc') as SortDirection;
    if (!['asc', 'desc'].includes(sortDirection)) {
      throw new BadRequestException('sortDirection must be one of: "asc", "desc".');
    }

    const label = query.label?.trim() || undefined;
    const search = query.search?.trim() || undefined;

    return {
      status,
      severity,
      visibility,
      label,
      search,
      page,
      pageSize,
      sortBy,
      sortDirection,
    };
  }
}
