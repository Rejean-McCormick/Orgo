import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

/**
 * Payload for linking an existing user account to an existing person profile.
 *
 * Invariants (enforced by the consuming service, not this DTO):
 * - userId and personId must both exist.
 * - Both records must belong to the same organization.
 * - A user account should be linked to at most one person profile.
 * - A person profile should be linked to at most one user account.
 */
export class LinkUserPersonDto {
  @ApiProperty({
    description:
      'ID of the user account to link (user_accounts.id in the current organization).',
    format: 'uuid',
    example: '3b1f0c66-0272-4bf7-8f03-4620e2a7f8da',
  })
  @IsUUID('4')
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description:
      'ID of the person profile to link (person_profiles.id in the current organization).',
    format: 'uuid',
    example: '5e8c3dda-38bb-4c64-a8b1-7ecaf0c2f3e4',
  })
  @IsUUID('4')
  @IsNotEmpty()
  personId!: string;
}
