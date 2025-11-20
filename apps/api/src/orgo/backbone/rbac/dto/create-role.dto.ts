import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  Matches,
} from 'class-validator';

/**
 * DTO for creating a new Role within an organization.
 *
 * Maps to the `roles` table (Doc 1):
 *   - organization_id
 *   - code
 *   - display_name
 *   - description
 *   - is_system_role (implicitly false for API-created roles)
 */
export class CreateRoleDto {
  @ApiProperty({
    description:
      'Organization that owns this role (tenant identifier). For tenant-defined roles this is required.',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'organizationId must be a valid UUID' })
  organizationId: string;

  @ApiProperty({
    description:
      'Stable code for the role, unique within the organization. Lower_snake_case; used in config, logs and routing rules.',
    example: 'ops_maintenance_coordinator',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[a-z0-9_]+$/, {
    message:
      'code must use lower_snake_case (lowercase letters, digits, and underscores only)',
  })
  code: string;

  @ApiProperty({
    description: 'Human-readable name for the role.',
    example: 'Maintenance Coordinator',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  displayName: string;

  @ApiPropertyOptional({
    description:
      'Longer free-text description of what this role is responsible for.',
    example: 'Coordinates all maintenance tasks for facilities and equipment.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  description?: string;
}
