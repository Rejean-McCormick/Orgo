import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ReportsService } from './reports.service';

/**
 * Canonical task enums (mirroring Doc 2 / Doc 1).
 */
export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ESCALATED = 'ESCALATED',
  CANCELLED = 'CANCELLED',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum TaskSeverity {
  MINOR = 'MINOR',
  MODERATE = 'MODERATE',
  MAJOR = 'MAJOR',
  CRITICAL = 'CRITICAL',
}

/**
 * Reporting‑specific enums.
 */
export enum TaskVolumeGranularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export enum TaskVolumeGroupBy {
  STATUS = 'status',
  TYPE = 'type',
  PRIORITY = 'priority',
  SEVERITY = 'severity',
  LABEL = 'label',
}

/**
 * Query DTO for the task‑volume report endpoint.
 *
 * This maps to aggregations over insights.fact_tasks (by date and dimension).
 */
export class TaskVolumeReportQueryDto {
  /**
   * Tenant / organization identifier (required).
   */
  @IsUUID('4')
  organizationId!: string;

  /**
   * Inclusive start of the reporting window (ISO‑8601).
   * If omitted, the service will use its own default window.
   */
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  /**
   * Inclusive end of the reporting window (ISO‑8601).
   */
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  /**
   * Time bucket size for aggregation (day/week/month).
   */
  @IsOptional()
  @IsEnum(TaskVolumeGranularity)
  granularity?: TaskVolumeGranularity;

  /**
   * Primary dimension to group by (status/type/priority/severity/label).
   */
  @IsOptional()
  @IsEnum(TaskVolumeGroupBy)
  groupBy?: TaskVolumeGroupBy;

  /**
   * Optional status filter; if present, only these statuses are counted.
   */
  @IsOptional()
  @IsEnum(TaskStatus, { each: true })
  @Type(() => String)
  statuses?: TaskStatus[];

  /**
   * Optional priority filter.
   */
  @IsOptional()
  @IsEnum(TaskPriority, { each: true })
  @Type(() => String)
  priorities?: TaskPriority[];

  /**
   * Optional severity filter.
   */
  @IsOptional()
  @IsEnum(TaskSeverity, { each: true })
  @Type(() => String)
  severities?: TaskSeverity[];
}

/**
 * Query DTO for the SLA‑breach report endpoint.
 *
 * This focuses on tasks whose reactivity/completion deadlines were exceeded.
 */
export class SlaBreachesReportQueryDto {
  @IsUUID('4')
  organizationId!: string;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  /**
   * Minimum severity to include (e.g. only MAJOR/CRITICAL).
   */
  @IsOptional()
  @IsEnum(TaskSeverity)
  minSeverity?: TaskSeverity;

  /**
   * Optional status filter; defaults to unresolved states in the service layer.
   */
  @IsOptional()
  @IsEnum(TaskStatus, { each: true })
  @Type(() => String)
  statuses?: TaskStatus[];

  /**
   * When true (default), only unresolved/open tasks are considered breaches.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyOpen?: boolean;
}

/**
 * Query DTO for the profile‑effectiveness score endpoint.
 *
 * This compares actual behaviour vs profile expectations (reactivity, SLAs, etc.).
 */
export class ProfileScoreReportQueryDto {
  @IsUUID('4')
  organizationId!: string;

  /**
   * Optional explicit profile key (e.g. "hospital", "advocacy_group").
   * If omitted, the org’s active profile is used.
   */
  @IsOptional()
  @IsString()
  profileKey?: string;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

@Controller('insights/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /insights/reports/tasks/volume
   *
   * Returns aggregated task volume over time, grouped by a primary dimension.
   */
  @Get('tasks/volume')
  getTaskVolumeReport(@Query() query: TaskVolumeReportQueryDto) {
    const {
      organizationId,
      startDate,
      endDate,
      granularity,
      groupBy,
      statuses,
      priorities,
      severities,
    } = query;

    return this.reportsService.getTaskVolumeReport({
      organizationId,
      startDate,
      endDate,
      granularity: granularity ?? TaskVolumeGranularity.DAY,
      groupBy: groupBy ?? TaskVolumeGroupBy.STATUS,
      statuses,
      priorities,
      severities,
    });
  }

  /**
   * GET /insights/reports/tasks/sla-breaches
   *
   * Returns tasks that breached SLAs (reactivity or completion), with optional
   * severity and status filters.
   */
  @Get('tasks/sla-breaches')
  getSlaBreachesReport(@Query() query: SlaBreachesReportQueryDto) {
    const {
      organizationId,
      startDate,
      endDate,
      minSeverity,
      statuses,
      onlyOpen,
    } = query;

    return this.reportsService.getSlaBreaches({
      organizationId,
      startDate,
      endDate,
      minSeverity,
      statuses,
      onlyOpen: onlyOpen !== undefined ? onlyOpen : true,
    });
  }

  /**
   * GET /insights/reports/profiles/score
   *
   * Returns an effectiveness score for the organization’s behavioural profile
   * over the selected time window.
   */
  @Get('profiles/score')
  getProfileScore(@Query() query: ProfileScoreReportQueryDto) {
    const { organizationId, profileKey, startDate, endDate } = query;

    return this.reportsService.getProfileScore({
      organizationId,
      profileKey,
      startDate,
      endDate,
    });
  }
}
