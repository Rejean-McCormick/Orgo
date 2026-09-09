/**
 * Permission types for the Orgo web app.
 *
 * These mirror the backend `permissions` table:
 *   - id: UUID primary key
 *   - code: stable string identifier (e.g. "task.view_sensitive")
 *   - description: human-readable explanation
 *
 * Only a subset of permission codes is explicitly enumerated here; the type
 * remains open to any additional codes the backend defines.
 */

/**
 * Canonical permission codes that are explicitly referenced
 * in the Orgo v3 specification and UI.
 *
 * NOTE: This list is not exhaustive. New permissions added on the backend
 * will still be representable via `PermissionCode`.
 */
export const KNOWN_PERMISSIONS = [
  'task.view_sensitive',
  'workflow.edit_rules',
] as const;

/**
 * Narrow type for the explicitly-known permission codes.
 */
export type KnownPermissionCode = (typeof KNOWN_PERMISSIONS)[number];

/**
 * Canonical permission code used across the web app.
 *
 * `KnownPermissionCode` captures well-known, spec-documented codes, while the
 * `string & {}` intersection keeps the type open to any additional codes
 * defined in the backend without breaking type checking.
 */
export type PermissionCode = KnownPermissionCode | (string & {});

/**
 * Permission record as exposed by the Orgo API.
 *
 * This mirrors the logical shape of the `permissions` table:
 *   - id: UUID primary key
 *   - code: stable permission identifier
 *   - description: human-readable explanation
 */
export interface Permission {
  id: string;
  code: PermissionCode;
  description: string;
}

/**
 * A collection of permission codes, typically representing
 * the effective permission set for the current user.
 */
export type PermissionSet = ReadonlyArray<PermissionCode>;

/**
 * A lookup/map representation of permissions where a present key
 * means the permission is granted.
 */
export type PermissionLookup = Readonly<Record<string, true>>;

/**
 * Union type for any permission collection representation
 * this module knows how to check.
 */
export type PermissionCollection = PermissionSet | PermissionLookup;

/**
 * Convert a list of permission codes into a lookup map suitable
 * for fast, repeated permission checks.
 */
export function toPermissionLookup(set: PermissionSet): PermissionLookup {
  const lookup: Record<string, true> = {};

  for (const code of set) {
    // Using string index here keeps this tolerant of unknown codes.
    lookup[code] = true;
  }

  return lookup;
}

/**
 * Check whether a given permission is present in the provided
 * collection (array or lookup map).
 */
export function hasPermission(
  permissions: PermissionCollection,
  code: PermissionCode,
): boolean {
  if (Array.isArray(permissions)) {
    return permissions.includes(code);
  }

  return permissions[code] === true;
}

/**
 * Check whether at least one of the given permission codes
 * is present in the collection.
 */
export function hasAnyPermission(
  permissions: PermissionCollection,
  codes: ReadonlyArray<PermissionCode>,
): boolean {
  for (const code of codes) {
    if (hasPermission(permissions, code)) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether all of the given permission codes are present
 * in the collection.
 */
export function hasAllPermissions(
  permissions: PermissionCollection,
  codes: ReadonlyArray<PermissionCode>,
): boolean {
  for (const code of codes) {
    if (!hasPermission(permissions, code)) {
      return false;
    }
  }
  return true;
}
