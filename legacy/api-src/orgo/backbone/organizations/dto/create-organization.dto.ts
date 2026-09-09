import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ORGANIZATION_STATUS_VALUES = ['active', 'suspended', 'archived'] as const;

export type OrganizationStatus = (typeof ORGANIZATION_STATUS_VALUES)[number];

export class CreateOrganizationDto {
  @ApiProperty({
    description:
      'Short, URL-safe identifier for the organization (lowercase, hyphen-separated). Must be unique.',
    example: 'northside-hospital',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must contain only lowercase letters, digits and single hyphens between segments (e.g. "northside-hospital").',
  })
  slug!: string;

  @ApiProperty({
    description: 'Human-readable display name for the organization.',
    example: 'Northside Hospital',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  display_name!: string;

  @ApiPropertyOptional({
    description: 'Registered legal name of the organization.',
    example: 'Northside Hospital Foundation, Inc.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @ApiPropertyOptional({
    description: 'Primary email/web domain used by this organization.',
    example: 'northside.example.org',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i, {
    message: 'primary_domain must be a valid domain name (e.g. "orgo.example.org").',
  })
  primary_domain?: string;

  @ApiProperty({
    description: 'Default IANA timezone for this organization.',
    example: 'America/New_York',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone!: string;

  @ApiProperty({
    description: 'Default locale for this organization (IETF language tag, e.g. "en" or "fr-CA").',
    example: 'en',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z]{2}(?:-[A-Z]{2})?$/, {
    message: 'default_locale must look like "en" or "fr-CA".',
  })
  default_locale!: string;

  @ApiPropertyOptional({
    description:
      'Behavioral profile key to attach to this organization (see profiles YAML, e.g. "default", "hospital"). If omitted, the system default profile is used.',
    example: 'default',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'profile_code must use lowercase letters, digits and underscores only.',
  })
  profile_code?: string;

  @ApiPropertyOptional({
    description:
      'Initial status for the organization. If omitted, it defaults to "active" at the service/persistence layer.',
    enum: ORGANIZATION_STATUS_VALUES,
    example: 'active',
  })
  @IsOptional()
  @IsString()
  @IsIn(ORGANIZATION_STATUS_VALUES)
  status?: OrganizationStatus;
}
