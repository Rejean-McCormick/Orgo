import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CASE_STATUS_VALUES = [
  'open',
  'in_progress',
  'resolved',
  'archived',
] as const;

export type CaseStatus = (typeof CASE_STATUS_VALUES)[number];

export class UpdateCaseStatusDto {
  @ApiProperty({
    description: 'New status for the Case.',
    enum: CASE_STATUS_VALUES,
    example: 'resolved',
  })
  @IsString()
  @IsIn(CASE_STATUS_VALUES, {
    message: `status must be one of: ${CASE_STATUS_VALUES.join(', ')}`,
  })
  status!: CaseStatus;

  @ApiProperty({
    description:
      'Optional human-readable reason explaining why the status is changing. ' +
      'For example, reasons for archiving as out-of-scope, duplicate, or spam.',
    required: false,
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
