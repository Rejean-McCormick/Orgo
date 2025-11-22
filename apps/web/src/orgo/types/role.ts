// apps/web/src/orgo/types/role.ts

/**
 * Role and RBAC-related types for the Orgo web application.
 *
 * These map to the `roles` and `user_role_assignments` tables in the Orgo v3
 * database schema (Doc 1) and the RBAC HTTP API (`/rbac/*`).
 */

/**
 * Stable identifier type alias for roles.
 *
 * Maps to:
 *   - DB: roles.id
 */
export type RoleId = string;

/**
 * Stable identifier type alias for users within RBAC types.
 *
 * Maps to:
 *   - DB: user_accounts.id
 */
export type UserId = string;

/**
 * Stable identifier type alias for organizations.
 *
 * Maps to:
 *   - DB: organizations.id
 */
export type OrganizationId = string;

/**
 * ISO‑8601 timestamp string (UTC), used for audit fields.
 *
 * Examples:
 *   - "2025-11-18T10:30:00Z"
 */
export type IsoDateTimeString = string;

/**
 * Canonical role code.
 *
 * Stable lower_snake_case identifier used in configuration, logs and
 * routing rules, e.g. "ops_maintenance_coordinator".
 *
 * Maps to:
 *   - DB: roles.code
 */
export type RoleCode = string;

/**
 * Scope of a role assignment within an organization.
 *
 * Mirrors `user_role_assignments.scope_type`:
 *   - global   – applies across the whole organization
 *   - team     – scoped to a specific team
 *   - location – scoped to a site / location
 *   - unit     – scoped to a unit / department
 *   - custom   – caller-defined semantics in `scope_reference`
 */
export type RoleScopeType = 'global' | 'team' | 'location' | 'unit' | 'custom';

/**
 * Core Role representation as exposed by the RBAC API.
 *
 * Mirrors the logical shape of the `roles` table:
 *   - id: UUID primary key
 *   - organization_id: tenant that owns the role (null for global/system)
 *   - code: stable lower_snake_case code
 *   - display_name: human-readable label
 *   - description: free-text description of responsibilities
 *   - is_system_role: true for built-in/protected roles
 */
export interface Role {
  /**
   * Stable identifier for the role.
   * DB: roles.id
   */
  id: RoleId;

  /**
   * Owning organization (tenant) for org-scoped roles, or null
   * for global/system roles.
   * DB: roles.organization_id
   */
  organization_id: OrganizationId | null;

  /**
   * Stable lower_snake_case code, unique within the organization.
   * DB: roles.code
   */
  code: RoleCode;

  /**
   * Human-readable name.
   * DB: roles.display_name
   */
  display_name: string;

  /**
   * Longer free-text description of the role's responsibilities.
   * DB: roles.description
   */
  description: string;

  /**
   * True for built-in roles that cannot be modified or deleted
   * by tenants.
   * DB: roles.is_system_role
   */
  is_system_role: boolean;
}

/**
 * Database-level binding between a user and a role within an organization.
 *
 * Mirrors the `user_role_assignments` table:
 *   - id: UUID primary key
 *   - user_id: user being granted the role
 *   - role_id: granted role
 *   - organization_id: tenant in which the assignment applies
 *   - scope_type / scope_reference: optional scoping information
 *   - assigned_at / revoked_at: audit timestamps
 */
export interface UserRoleAssignment {
  /**
   * Stable identifier for the assignment.
   * DB: user_role_assignments.id
   */
  id: string;

  /**
   * User receiving the role.
   * DB: user_role_assignments.user_id
   */
  user_id: UserId;

  /**
   * Assigned role.
   * DB: user_role_assignments.role_id
   */
  role_id: RoleId;

  /**
   * Organization in which this assignment is valid.
   * DB: user_role_assignments.organization_id
   */
  organization_id: OrganizationId;

  /**
   * Scope type for this assignment (global/team/location/unit/custom).
   * DB: user_role_assignments.scope_type
   */
  scope_type: RoleScopeType;

  /**
   * Optional reference whose semantics depend on scope_type
   * (e.g. team id, location code).
   * DB: user_role_assignments.scope_reference
   */
  scope_reference: string | null;

  /**
   * When the role was granted to the user.
   * DB: user_role_assignments.assigned_at
   */
  assigned_at: IsoDateTimeString;

  /**
   * When the role was revoked, if ever.
   * DB: user_role_assignments.revoked_at
   */
  revoked_at: IsoDateTimeString | null;
}
