import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Canonical TASK_STATUS values (Doc 2 / Doc 5 / Doc 8).
 */
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

export class UpdateTaskStatusDto {
  @ApiProperty({
    description:
      'New status for the task. Uses the canonical TASK_STATUS enum; lower-case forms will be normalised.',
    enum: TASK_STATUS_VALUES,
    example: 'IN_PROGRESS',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @IsIn(TASK_STATUS_VALUES)
  status!: TaskStatus;

  @ApiPropertyOptional({
    description:
      'Optional human-readable reason explaining the status change; used for audit/task events.',
    maxLength: 2048,
    example: 'Work completed and verified on site.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  reason?: string;
}
