import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsOptional,
  IsString,
  IsEmail,
  IsEnum,
  MaxLength,
  IsDateString,
} from 'class-validator';

export enum PersonConfidentialityLevel {
  Normal = 'normal',
  Sensitive = 'sensitive',
  HighlySensitive = 'highly_sensitive',
}

export class UpsertPersonProfileDto {
  @ApiPropertyOptional({
    description:
      'Existing person profile ID. Omit when creating a new person; include when updating.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiPropertyOptional({
    description:
      'ID of the linked user account in the same organization, if this person also has a login.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  linkedUserId?: string;

  @ApiPropertyOptional({
    description:
      'External reference such as a student ID, employee number, or membership code.',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalReference?: string;

  @ApiProperty({
    description: 'Full display name of the person.',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  fullName!: string;

  @ApiPropertyOptional({
    description:
      'Date of birth in ISO format (YYYY-MM-DD). Must not be in the future (enforced in service layer).',
    type: String,
    format: 'date',
  })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Primary contact email address for the person.',
    maxLength: 320,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  primaryContactEmail?: string;

  @ApiPropertyOptional({
    description:
      'Primary contact phone number for the person. Format is domain-specific and validated downstream.',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryContactPhone?: string;

  @ApiPropertyOptional({
    description:
      'Confidentiality level used by visibility rules and guardrails for this person.',
    enum: PersonConfidentialityLevel,
    enumName: 'PersonConfidentialityLevel',
  })
  @IsOptional()
  @IsEnum(PersonConfidentialityLevel)
  confidentialityLevel?: PersonConfidentialityLevel;
}
