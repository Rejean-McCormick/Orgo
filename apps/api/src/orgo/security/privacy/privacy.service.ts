import { Injectable } from '@nestjs/common';

/**
 * Canonical VISIBILITY values (DB enum visibility_enum).
 *
 * See Orgo v3 foundations doc for semantics:
 *   PUBLIC      – visible across the org (subject to RBAC)
 *   INTERNAL    – limited to org-internal teams/roles
 *   RESTRICTED  – minimal set of users/roles
 *   ANONYMISED  – pseudonymised or fully anonymised content
 */
export type Visibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';

/**
 * Options controlling how anonymisation is applied.
 *
 * - piiFieldPaths / strongPiiFieldPaths:
 *     Dot-separated path selectors (e.g. "metadata.person.email").
 *     These are matched in a case-insensitive, punctuation-insensitive way.
 * - maskStrategy:
 *     "redact" – replace value with a redaction marker (default).
 *     "hash"   – replace value with a deterministic non-cryptographic hash.
 *     "drop"   – remove the field entirely from the payload.
 * - customRedactionText:
 *     Custom marker to use instead of "[redacted]" when maskStrategy = "redact".
 */
export interface AnonymizeOptions {
  piiFieldPaths?: string[];
  strongPiiFieldPaths?: string[];
  maskStrategy?: 'redact' | 'hash' | 'drop';
  customRedactionText?: string;
}

/**
 * Options for export-time masking.
 *
 * - allowedVisibilities:
 *     VISIBILITY values that may appear in raw exports.
 *     If omitted, defaults to ["PUBLIC","INTERNAL"] (per Insights export guardrails).
 * - dropIfVisibilityDisallowed:
 *     If true (default), entities with disallowed visibility are dropped (return null).
 *     If false, entities with disallowed visibility are anonymised instead.
 *
 * All other fields are forwarded to anonymisation logic if masking is needed.
 */
export interface ExportPrivacyOptions extends AnonymizeOptions {
  allowedVisibilities?: Visibility[];
  dropIfVisibilityDisallowed?: boolean;
}

/**
 * PrivacyService centralises anonymisation and export-time masking rules.
 *
 * Typical usage:
 *   - When persisting highly sensitive records with visibility = ANONYMISED,
 *     call anonymizePayloadForVisibility before writing to the DB.
 *   - When preparing exports, call maskForExport on each record to enforce
 *     allowedVisibilities and PII masking.
 */
@Injectable()
export class PrivacyService {
  /**
   * Default visibilities allowed for raw exports from analytics/reporting.
   * This mirrors the default ["PUBLIC","INTERNAL"] configuration for
   * analytics exports.
   */
  public static readonly DEFAULT_EXPORT_ALLOWED_VISIBILITIES: readonly Visibility[] = [
    'PUBLIC',
    'INTERNAL',
  ] as const;

  /**
   * Default text used when maskStrategy = "redact".
   */
  private static readonly DEFAULT_REDACTION_TEXT = '[redacted]';

  /**
   * Field-name heuristics for PII. Keys are stored in a normalised form:
   *   - lower-cased
   *   - all non-alphanumeric characters removed
   *
   * Example:
   *   "full_name"   → "fullname"
   *   "emailAddress" → "emailaddress"
   */
  private readonly defaultPiiKeys: Set<string> = new Set<string>([
    // Names
    'name',
    'fullname',
    'firstname',
    'lastname',
    // Emails
    'email',
    'emailaddress',
    'primarycontactemail',
    // Phones
    'phone',
    'phonenumber',
    'primarycontactphone',
    // Dates of birth
    'dateofbirth',
    'dob',
    // Addresses
    'address',
    'homeaddress',
    'postaladdress',
    // Identity / reference IDs
    'personid',
    'employeeid',
    'studentid',
    'subjectid',
    'hrcaseid',
  ]);

  /**
   * Field-name heuristics for strong PII (national IDs, sensitive identifiers).
   * These are treated the same as defaultPiiKeys by this service, but are
   * separated to allow more aggressive strategies in the future if needed.
   */
  private readonly defaultStrongPiiKeys: Set<string> = new Set<string>([
    'nationalid',
    'ssn',
    'socialsecuritynumber',
    'passportnumber',
  ]);

  /**
   * Normalises a VISIBILITY token from API/JSON/config form into the canonical
   * upper-case enum used in the DB.
   *
   * Throws if the token is not recognised.
   */
  public normalizeVisibilityToken(visibility: string | Visibility): Visibility {
    const upper = String(visibility).toUpperCase().trim();

    switch (upper) {
      case 'PUBLIC':
      case 'INTERNAL':
      case 'RESTRICTED':
      case 'ANONYMISED':
        return upper;
      default:
        throw new Error(`Unknown visibility token: "${visibility}"`);
    }
  }

  /**
   * Apply anonymisation according to a target VISIBILITY.
   *
   * Currently:
   *   - For ANONYMISED: deep-clone and anonymise using the provided options.
   *   - For PUBLIC / INTERNAL / RESTRICTED: payload is returned unchanged.
   *
   * This method is intended to be used when creating/updating entities where
   * the persisted visibility is known (e.g. HR cases with ANONYMISED visibility).
   */
  public anonymizePayloadForVisibility<T>(
    payload: T,
    visibility: Visibility | string,
    options?: AnonymizeOptions,
  ): T {
    const normalised = this.normalizeVisibilityToken(visibility);

    if (normalised !== 'ANONYMISED') {
      // Non-anonymised visibilities are passed through unchanged here.
      // Access control and visibility enforcement are handled elsewhere.
      return payload;
    }

    return this.anonymizePayload(payload, options);
  }

  /**
   * Deep-clone and anonymise a payload using a combination of:
   *   - builtin PII heuristics (field-name based), and
   *   - explicit piiFieldPaths / strongPiiFieldPaths.
   *
   * The original payload is never mutated.
   */
  public anonymizePayload<T>(payload: T, options?: AnonymizeOptions): T {
    const merged = this.mergeOptions(options);
    return this.deepCloneAndAnonymize(payload as unknown, merged) as T;
  }

  /**
   * Apply export-time visibility and PII rules to a single record.
   *
   * Behaviour:
   *   1. Normalises the record's visibility token.
   *   2. If visibility is not in allowedVisibilities:
   *        - If dropIfVisibilityDisallowed (default true): returns null.
   *        - Otherwise: returns an anonymised version of the payload.
   *   3. If visibility is allowed:
   *        - If no masking options are provided, returns payload unchanged.
   *        - If piiFieldPaths / strongPiiFieldPaths are provided (and/or
   *          maskStrategy is set), returns an anonymised clone of the payload.
   */
  public maskForExport<T>(
    payload: T,
    visibility: Visibility | string,
    options?: ExportPrivacyOptions,
  ): T | null {
    const normalisedVisibility = this.normalizeVisibilityToken(visibility);
    const allowed =
      options?.allowedVisibilities ??
      (PrivacyService.DEFAULT_EXPORT_ALLOWED_VISIBILITIES.slice() as Visibility[]);
    const dropIfDisallowed = options?.dropIfVisibilityDisallowed ?? true;

    if (!allowed.includes(normalisedVisibility)) {
      if (dropIfDisallowed) {
        return null;
      }

      // Visibility is disallowed for raw export, but caller opted to keep the
      // record in anonymised form.
      return this.anonymizePayload(payload, options);
    }

    // Visibility is allowed. If caller provided no masking-related options,
    // return the payload unchanged.
    const hasExplicitMaskingConfig =
      (options?.piiFieldPaths && options.piiFieldPaths.length > 0) ||
      (options?.strongPiiFieldPaths && options.strongPiiFieldPaths.length > 0) ||
      typeof options?.maskStrategy === 'string';

    if (!hasExplicitMaskingConfig) {
      return payload;
    }

    // Caller requested masking even though visibility is allowed.
    return this.anonymizePayload(payload, options);
  }

  /**
   * Merge user-provided options with service defaults.
   */
  private mergeOptions(options?: AnonymizeOptions): Required<AnonymizeOptions> {
    return {
      piiFieldPaths: options?.piiFieldPaths ?? [],
      strongPiiFieldPaths: options?.strongPiiFieldPaths ?? [],
      maskStrategy: options?.maskStrategy ?? 'redact',
      customRedactionText:
        options?.customRedactionText ?? PrivacyService.DEFAULT_REDACTION_TEXT,
    };
  }

  /**
   * Deep-clone and anonymise a value (object/array/primitive) according to the
   * provided options. Objects and arrays are cloned; primitives are returned as-is.
   */
  private deepCloneAndAnonymize(
    value: unknown,
    options: Required<AnonymizeOptions>,
    path: string[] = [],
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        this.deepCloneAndAnonymize(item, options, path.concat(String(index))),
      );
    }

    if (this.isPlainObject(value)) {
      const clone: Record<string, unknown> = {};

      for (const [key, child] of Object.entries(value)) {
        const nextPath = path.concat(key);

        if (this.shouldMaskKey(key, nextPath, options)) {
          // Apply masking strategy at this field.
          if (options.maskStrategy === 'drop') {
            // Field is omitted entirely from the clone.
            continue;
          }

          if (options.maskStrategy === 'hash') {
            clone[key] = this.hashValue(child);
          } else {
            // "redact" or anything unknown falls back to redaction text.
            clone[key] = options.customRedactionText;
          }
        } else {
          clone[key] = this.deepCloneAndAnonymize(child, options, nextPath);
        }
      }

      return clone;
    }

    // Primitives are returned unchanged unless specifically targeted via paths,
    // which is handled at the object level above.
    return value;
  }

  /**
   * Decide whether a field should be treated as PII and masked, based on:
   *   - known PII key heuristics, and
   *   - configured piiFieldPaths / strongPiiFieldPaths.
   */
  private shouldMaskKey(
    key: string,
    path: string[],
    options: Required<AnonymizeOptions>,
  ): boolean {
    const normalisedKey = this.normalizeToken(key);

    if (
      this.defaultPiiKeys.has(normalisedKey) ||
      this.defaultStrongPiiKeys.has(normalisedKey)
    ) {
      return true;
    }

    const pathStr = path.map((segment) => this.normalizeToken(segment)).join('.');

    if (
      options.piiFieldPaths.some((configuredPath) =>
        this.isPathMatch(configuredPath, pathStr),
      )
    ) {
      return true;
    }

    if (
      options.strongPiiFieldPaths.some((configuredPath) =>
        this.isPathMatch(configuredPath, pathStr),
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Compare a configured path (dot-separated string) with a concrete path,
   * using the same token normalisation as for field names.
   *
   * No wildcards are supported here; matching is exact after normalisation.
   */
  private isPathMatch(configuredPath: string, actualPath: string): boolean {
    const normalisedConfigured = configuredPath
      .split('.')
      .map((segment) => this.normalizeToken(segment))
      .join('.');

    return normalisedConfigured === actualPath;
  }

  /**
   * Normalise a token (field name or path segment) by:
   *   - removing non-alphanumeric characters
   *   - lowercasing the result
   */
  private normalizeToken(token: string): string {
    return token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  }

  /**
   * Simple deterministic, non-cryptographic hash for masking purposes.
   *
   * This is intentionally lightweight and NOT suitable for cryptographic use
   * cases. For strong privacy requirements, a cryptographic hash (e.g. SHA-256)
   * should be implemented at the infrastructure level and wired in here.
   */
  private hashValue(value: unknown): string {
    const str = value == null ? '' : String(value);
    let hash = 0;

    for (let i = 0; i < str.length; i += 1) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32-bit integer
    }

    const hex = (hash >>> 0).toString(16);
    return `hash:${hex}`;
  }

  /**
   * Detect whether a value is a plain object (i.e. `{}` or an object with
   * prototype Object.prototype or null). This avoids treating class instances,
   * Dates, etc. as generic records.
   */
  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (Object.prototype.toString.call(value) !== '[object Object]') {
      return false;
    }

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
}
