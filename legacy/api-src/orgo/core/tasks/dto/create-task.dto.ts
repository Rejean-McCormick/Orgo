import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  MaxLength,
  IsDateString,
  IsObject,
} from 'class-validator';

/**
 * JSON-level enums for Task fields.
 * These reflect the canonical API representations (lower-case),
 * which are mapped to DB enums in the service layer.
 */

export enum TaskCategory {
  REQUEST = 'request',
  INCIDENT = 'incident',
  UPDATE = 'update',
  REPORT = 'report',
  DISTRIBUTION = 'distribution',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum TaskSeverity {
  MINOR = 'minor',
  MODERATE = 'moderate',
  MAJOR = 'major',
  CRITICAL = 'critical',
}

export enum TaskVisibility {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  RESTRICTED = 'restricted',
  ANONYMISED = 'anonymised', // always with an "s"
}

export enum TaskSource {
  EMAIL = 'email',
  API = 'api',
  MANUAL = 'manual',
  SYNC = 'sync',
}

/**
 * DTO for creating a Task.
 *
 * This models the canonical create_task payload:
 * - Includes all writable, non-derived fields.
 * - Excludes DB-/service-owned fields such as:
 *   task_id, status, reactivity_time, reactivity_deadline_at,
 *   escalation_level, created_at, updated_at, closed_at.
 */
export class CreateTaskDto {
  @ApiProperty({
    description: 'Tenant / organization identifier (UUID).',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  organization_id!: string;

  @ApiProperty({
    description:
      'Domain-level task type (e.g. "maintenance", "hr_case", "education_support", "generic").',
    example: 'maintenance',
  })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({
    description:
      'Global task category. Must match the canonical category enum.',
    enum: TaskCategory,
    example: TaskCategory.REQUEST,
  })
  @IsEnum(TaskCategory)
  category!: TaskCategory;

  @ApiProperty({
    description: 'Canonical information label code.',
    example: '100.94.Operations.Safety',
  })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({
    description: 'Short human-readable title of the task.',
    maxLength: 512,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  title!: string;

  @ApiProperty({
    description: 'Detailed description / body of the task.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    description:
      'Priority of the task. JSON uses lower-case values mapping to DB enum.',
    enum: TaskPriority,
    example: TaskPriority.MEDIUM,
  })
  @IsEnum(TaskPriority)
  priority!: TaskPriority;

  @ApiProperty({
    description:
      'Severity of the task. JSON uses lower-case values mapping to DB enum.',
    enum: TaskSeverity,
    example: TaskSeverity.MINOR,
  })
  @IsEnum(TaskSeverity)
  severity!: TaskSeverity;

  @ApiProperty({
    description:
      'Visibility of the task. Controls who can see it within the organization.',
    enum: TaskVisibility,
    example: TaskVisibility.INTERNAL,
  })
  @IsEnum(TaskVisibility)
  visibility!: TaskVisibility;

  @ApiProperty({
    description:
      'Source through which the task entered the system (email, api, manual, sync).',
    enum: TaskSource,
    example: TaskSource.API,
  })
  @IsEnum(TaskSource)
  source!: TaskSource;

  @ApiProperty({
    description:
      'Domain-specific metadata. Must not duplicate core fields (type, category, severity, etc.).',
    type: 'object',
    additionalProperties: true,
    example: { asset_id: 'ASSET-123', location: 'Building A' },
  })
  @IsObject()
  metadata!: Record<string, unknown>;

  // -------------------------
  // Optional linkage fields
  // -------------------------

  @ApiPropertyOptional({
    description: 'Optional Case this Task belongs to (UUID).',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  case_id?: string | null;

  @ApiPropertyOptional({
    description:
      'Domain-specific subtype (e.g. "plumbing", "harassment", "attendance").',
    nullable: true,
    example: 'plumbing',
  })
  @IsOptional()
  @IsString()
  subtype?: string | null;

  // -------------------------
  // Optional ownership fields
  // -------------------------

  @ApiPropertyOptional({
    description: 'User that created the task (UUID).',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  created_by_user_id?: string | null;

  @ApiPropertyOptional({
    description: 'Person the work is for (UUID).',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  requester_person_id?: string | null;

  @ApiPropertyOptional({
    description: 'Primary owning role (UUID).',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  owner_role_id?: string | null;

  @ApiPropertyOptional({
    description: 'Primary owning user (UUID).',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  owner_user_id?: string | null;

  @ApiPropertyOptional({
    description:
      'Denormalised routing role label, aligned with label system (e.g. "Ops.Maintenance").',
    nullable: true,
    example: 'Ops.Maintenance',
  })
  @IsOptional()
  @IsString()
  assignee_role?: string | null;

  // -------------------------
  // Optional scheduling fields
  // -------------------------

  @ApiPropertyOptional({
    description: 'Optional due date/time for the task (ISO 8601).',
    format: 'date-time',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  due_at?: string | null;
}
