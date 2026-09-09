import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RoleService } from './role.service';
import { PermissionService } from './permission.service';
import { UserRoleAssignmentService } from './user-role-assignment.service';

/**
 * Orgo v3 RBAC backbone module.
 *
 * This module groups all RBAC-related services so they can be injected
 * across the application:
 *
 * - RoleService: CRUD and management for roles (backed by `roles`).
 * - PermissionService: CRUD and assignment helpers for permissions
 *   (backed by `permissions` and `role_permissions`).
 * - UserRoleAssignmentService: management of user-role bindings
 *   (backed by `user_role_assignments`).
 * - RbacService: cross-cutting permission checks used by guards and
 *   other services (`RbacService.checkPermission`, etc.).
 *
 * It is marked as @Global so that importing RbacModule once (e.g. in
 * AppModule or BackboneModule) makes these providers available
 * everywhere without repeated imports.
 */
@Global()
@Module({
  providers: [
    RbacService,
    RoleService,
    PermissionService,
    UserRoleAssignmentService,
  ],
  exports: [
    RbacService,
    RoleService,
    PermissionService,
    UserRoleAssignmentService,
  ],
})
export class RbacModule {}
