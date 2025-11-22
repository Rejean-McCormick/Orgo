import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * DTO for assigning one or more permissions to a role.
 *
 * Each entry is a canonical permission code from the `permissions` table,
 * for example:
 *   - "task.view_sensitive"
 *   - "workflow.edit_rules"
 *
 * The target role is identified by the route parameter (:roleId); this DTO
 * only carries the list of permission codes to attach.
 */
export class AssignPermissionsToRoleDto {
  @ApiProperty({
    description:
      'List of permission codes to assign to the role. Each must correspond to an existing permission code.',
    example: ['task.view_sensitive', 'workflow.edit_rules'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionCodes!: string[];
}
