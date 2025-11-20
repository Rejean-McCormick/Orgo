// apps/api/src/orgo/core/cases/dto/create-case.dto.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';

// Canonical enums for Cases (JSON-facing, aligned with Docs 1/2/8)
export const CASE_SOURCE_TYPES = ['email', 'api', 'manual', 'sync'] as const;
export type CaseSourceType = (typeof CASE_SOURCE_TYPES)[number];

export const CASE_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;
export type CaseSeverity = (typeof CASE_SEVERITIES)[number];

// Canonical label shape: "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>"
// BASE: integer (e.g. 1, 11, 100, 1000)
// CATEGORY: 1–9, SUBCATEGORY: 1–5  → encoded as two digits [1-9][1-5]
// HORIZONTAL_ROLE: dot‑separated segments like "Ops.Maintenance"
export const LABEL_CODE_REGEX =
  /^\d+\.[1-9][1-5](?:\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/;

export class CreateCaseDto {
  @ApiProperty({
    description: 'Tenant organization identifier (UUID; maps to organizations.id).',
    format: 'uuid',
  })
  @IsUUID()
  organization_id!: string;

  @ApiProperty({
    description:
      'Origin channel for the Case (maps to cases.source_type / task_source_enum).',
    enum: CASE_SOURCE_TYPES,
    example: 'email',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsIn(CASE_SOURCE_TYPES)
  source_type!: CaseSourceType;

  @ApiPropertyOptional({
    description:
      'Channel-specific reference (e.g. email message-id, external URI).',
    nullable: true,
    example: '<message-id@example.org>',
  })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsString()
  @IsOptional()
  source_reference?: string;

  @ApiProperty({
    description:
      'Canonical information label "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>".',
    example: '100.94.Operations.Safety',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @Matches(LABEL_CODE_REGEX, {
    message:
      'label must match "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>" (e.g. "100.94.Operations.Safety")',
  })
  label!: string;

  @ApiProperty({
    description: 'Short human-readable title for the Case.',
    maxLength: 512,
    example: 'Wet floor in main hallway near gym entrance',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  title!: string;

  @ApiProperty({
    description: 'Detailed description or narrative for the Case.',
    example:
      'Student slipped on wet floor near the gym entrance. No serious injury, but repeated incidents reported over the past month.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    description:
      'Case severity (JSON form of TASK_SEVERITY; lower-case tokens map to DB enum).',
    enum: CASE_SEVERITIES,
    example: 'major',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsIn(CASE_SEVERITIES)
  severity!: CaseSeverity;

  @ApiPropertyOptional({
    description:
      'ISO‑8601 duration for expected responsiveness window (e.g. "PT2H").',
    nullable: true,
    example: 'PT2H',
  })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsString()
  @IsOptional()
  reactivity_time?: string;

  @ApiPropertyOptional({
    description:
      'Vertical base from the original label (e.g. 100, 1000); used for cyclic overview and broadcast semantics.',
    nullable: true,
    example: 1000,
  })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsInt()
  @Min(1)
  @IsOptional()
  origin_vertical_level?: number;

  @ApiPropertyOptional({
    description:
      'Horizontal role of origin (e.g. "Ops.Maintenance", "HR.CaseOfficer").',
    nullable: true,
    example: 'Ops.Maintenance',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value === null ? undefined : value,
  )
  @IsString()
  @IsOptional()
  origin_role?: string;

  @ApiPropertyOptional({
    description:
      'High-level classification tags for the Case (e.g. ["safety","wet_floor"]).',
    nullable: true,
    type: [String],
    example: ['safety', 'facility', 'wet_floor'],
  })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    description:
      'Structured location information (site, building, GPS, etc.). Shape is domain-specific.',
    nullable: true,
    example: {
      site: 'North Campus',
      building: 'Gym',
      floor: 1,
      area: 'Main entrance corridor',
    },
  })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsObject()
  @IsOptional()
  location?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Case-level metadata (pattern_sensitivity, review settings, visibility, escalation path, profile hints, etc.).',
    nullable: true,
    example: {
      visibility: 'internal',
      pattern_sensitivity: 'high',
      review_frequency: 'monthly',
    },
  })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
