// apps/web/src/orgo/types/person.ts

/**
 * Person-related types for the Orgo web application.
 *
 * These map to the `person_profiles` table and related enums in the Orgo v3
 * specification. Field names follow the JSON/API contract.
 */

/**
 * Canonical confidentiality levels for person profiles.
 *
 * DB / spec values:
 *   - normal
 *   - sensitive
 *   - highly_sensitive
 */
export type PersonConfidentialityLevel =
  | 'normal'
  | 'sensitive'
  | 'highly_sensitive';

/**
 * Stable identifier type alias for persons.
 *
 * Maps to:
 *   - DB: person_profiles.id
 *   - API/JSON: person_id
 */
export type PersonId = string;

/**
 * Core Person / PersonProfile representation as exposed via the API.
 *
 * This is a direct mapping of the `person_profiles` schema plus default
 * audit columns. Timestamps are ISO‑8601 strings in UTC.
 */
export interface Person {
  /**
   * Stable identifier for the person.
   * DB: person_profiles.id
   */
  person_id: PersonId;

  /**
   * Owning organization (tenant).
   * DB: person_profiles.organization_id
   */
  organization_id: string;

  /**
   * Optional linked user account if this person also has an Orgo login.
   * DB: person_profiles.linked_user_id
   */
  linked_user_id: string | null;

  /**
   * External reference such as student ID or employee number.
   * DB: person_profiles.external_reference
   */
  external_reference: string | null;

  /**
   * Full human name.
   * DB: person_profiles.full_name
   */
  full_name: string;

  /**
   * Date of birth in ISO‑8601 date format (YYYY‑MM‑DD), if known.
   * DB: person_profiles.date_of_birth
   */
  date_of_birth: string | null;

  /**
   * Primary contact email address, if any.
   * DB: person_profiles.primary_contact_email
   */
  primary_contact_email: string | null;

  /**
   * Primary contact phone number, if any.
   * DB: person_profiles.primary_contact_phone
   */
  primary_contact_phone: string | null;

  /**
   * Confidentiality level for this person, used by higher‑level
   * visibility and guardrail logic.
   * DB: person_profiles.confidentiality_level
   */
  confidentiality_level: PersonConfidentialityLevel;

  /**
   * Creation timestamp (UTC, ISO‑8601).
   * DB: person_profiles.created_at
   */
  created_at: string;

  /**
   * Last update timestamp (UTC, ISO‑8601).
   * DB: person_profiles.updated_at
   */
  updated_at: string;
}

/**
 * Alias for compatibility with code that prefers the PersonProfile name.
 * Both refer to the same underlying shape.
 */
export type PersonProfile = Person;
