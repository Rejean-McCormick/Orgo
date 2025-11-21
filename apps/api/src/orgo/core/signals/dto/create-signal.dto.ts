import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsOptional,
  IsNotEmpty,
  IsIn,
  IsObject,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const TASK_CATEGORY_VALUES = [
  'request',
  'incident',
  'update',
  'report',
  'distribution',
] as const;

export type TaskCategory = (typeof TASK_CATEGORY_VALUES)[number];

export const TASK_PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export const TASK_SEVERITY_VALUES = ['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'] as const;
export type TaskSeverity = (typeof TASK_SEVERITY_VALUES)[number];

export const VISIBILITY_VALUES = [
  'PUBLIC',
  'INTERNAL',
  'RESTRICTED',
  'ANONYMISED',
] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];

export const TASK_SOURCE_VALUES = ['email', 'api', 'manual', 'sync'] as const;
export type TaskSource = (typeof TASK_SOURCE_VALUES)[number];

/**
 * DTO for ingesting a generic Signal via API / UI / webhooks.
 *
 * The goal is to capture enough structured information for the workflow engine
 * to decide whether to open a Case, create Task(s), or both.
 *
 * Many fields are optional hints; profiles + workflows can override them.
 */
export class CreateSignalDto {
  @ApiProperty({
    description: 'Organization this signal belongs to (tenant ID).',
    format: 'uuid',
  })
  @IsUUID('4')
  organizationId!: string;

  @ApiPropertyOptional({
    description:
      'Optional idempotency key or external correlation id from the source system.',
    example: 'ext-incident-12345',
  })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({
    description:
      'Optional existing Case to attach this signal to (otherwise workflows may open a new Case).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  caseId?: string;

  @ApiProperty({
    description: 'Origin of this signal, reusing the task source enumeration.',
    enum: TASK_SOURCE_VALUES,
    example: 'api',
  })
  @IsString()
  @IsIn(TASK_SOURCE_VALUES)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  source!: TaskSource;

  @ApiProperty({
    description: 'Short human-readable summary for this signal.',
    example: 'Student slipped on wet floor in main lobby',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Free-text body or description of the signal.',
    example:
      'A student slipped on a wet floor near the main entrance. No visible injuries, but this has happened several times this month.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({
    description:
      'Domain type hint; should match Task.type / domain module name (e.g. "maintenance", "hr_case").',
    example: 'maintenance',
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description:
      'Optional Task.category hint. If omitted, workflows will derive it.',
    enum: TASK_CATEGORY_VALUES,
    example: 'incident',
  })
  @IsOptional()
  @IsString()
  @IsIn(TASK_CATEGORY_VALUES)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  category?: TaskCategory;

  @ApiPropertyOptional({
    description:
      'Domain-specific subtype hint; must be valid for the chosen domain module (e.g. "ticket", "harassment").',
    example: 'ticket',
  })
  @IsOptional()
  @IsString()
  subtype?: string;

  @ApiPropertyOptional({
    description:
      'Optional canonical label hint ("<base>.<category><subcategory>.<horizontal_role>").',
    example: '100.94.Operations.Safety',
  })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({
    description:
      'Optional priority hint; defaults are derived from org profile and workflows.',
    enum: TASK_PRIORITY_VALUES,
    example: 'HIGH',
  })
  @IsOptional()
  @IsString()
  @IsIn(TASK_PRIORITY_VALUES)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  priority?: TaskPriority;

  @ApiPropertyOptional({
    description:
      'Optional severity hint; defaults are derived from org profile and workflows.',
    enum: TASK_SEVERITY_VALUES,
    example: 'MAJOR',
  })
  @IsOptional()
  @IsString()
  @IsIn(TASK_SEVERITY_VALUES)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  severity?: TaskSeverity;

  @ApiPropertyOptional({
    description:
      'Optional visibility hint for any Task/Case created from this signal. Guardrails may override this.',
    enum: VISIBILITY_VALUES,
    example: 'INTERNAL',
  })
  @IsOptional()
  @IsString()
  @IsIn(VISIBILITY_VALUES)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  visibility?: Visibility;

  @ApiPropertyOptional({
    description:
      'If set, the Person profile this signal is primarily about (subject of the Case/Task).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  requesterPersonId?: string;

  @ApiPropertyOptional({
    description:
      'If set, the Orgo user who submitted this signal (mapped to created_by_user_id on Tasks).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  createdByUserId?: string;

  @ApiPropertyOptional({
    description:
      'Optional external reference or URL related to the signal (ticket id, form submission id, etc.).',
    example: 'JIRA-1234',
  })
  @IsOptional()
  @IsString()
  sourceReference?: string;

  @ApiPropertyOptional({
    description:
      'Arbitrary structured payload for domain-specific context (location, group ids, tags, raw form data, etc.). Must not duplicate canonical Task fields.',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
