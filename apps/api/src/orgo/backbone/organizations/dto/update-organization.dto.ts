import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsFQDN,
  IsLocale,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * JSON-facing representation of organization_status_enum.
 *
 * Canonical DB enum: organization_status_enum = 'active' | 'suspended' | 'archived'
 * JSON uses the same lower-case tokens.
 */
export enum OrganizationStatus {
  Active = 'active',
  Suspended = 'suspended',
  Archived = 'archived',
}

/**
 * DTO for partially updating an Organization.
 *
 * All fields are optional; only provided fields will be updated.
 * To clear nullable fields (legal_name, primary_domain), send them explicitly as null.
 */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({
    description:
      'Short, URL-safe slug used as the stable organization identifier (e.g. in URLs and config).',
    example: 'northside-hospital',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must be lower-case, alphanumeric, and may contain single hyphens between segments',
  })
  @MaxLength(190)
  slug?: string;

  @ApiPropertyOptional({
    description: 'Human-friendly display name for the organization.',
    example: 'Northside Hospital',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  display_name?: string;

  @ApiPropertyOptional({
    description: 'Registered legal name for the organization (nullable).',
    example: 'Northside Hospital Inc.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string | null;

  @ApiPropertyOptional({
    description:
      'Primary email/web domain for the organization (nullable). Used for email routing and link generation.',
    example: 'northside.example.org',
    nullable: true,
  })
  @IsOptional()
  @IsFQDN()
  @MaxLength(255)
  primary_domain?: string | null;

  @ApiPropertyOptional({
    description: 'Operational status of the organization.',
    enum: OrganizationStatus,
    example: OrganizationStatus.Active,
  })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @ApiPropertyOptional({
    description: 'Default IANA timezone for the organization.',
    example: 'America/New_York',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({
    description:
      'Default locale (BCP 47) for the organization, e.g. "en", "fr-CA".',
    example: 'en',
  })
  @IsOptional()
  @IsLocale()
  @MaxLength(20)
  default_locale?: string;

  @ApiPropertyOptional({
    description:
      'Behavioral profile code linked to organization_profiles.profile_code (e.g. "default", "hospital", "friend_group").',
    example: 'default',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  profile_code?: string;
}
