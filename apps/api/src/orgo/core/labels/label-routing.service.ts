import { Injectable } from '@nestjs/common';

/**
 * Domain-level representation of a canonical Orgo label:
 *   <BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>
 */
export interface LabelParts {
  /** Vertical base (hierarchy level), e.g. 1, 11, 101, 1001. */
  base: number;
  /** Information category digit (1–9). */
  categoryDigit: number;
  /** Intent / subcategory digit (1–5). */
  subcategoryDigit: number;
  /** Optional horizontal role, e.g. "Ops.Maintenance". */
  horizontalRole?: string | null;
}

/**
 * Global Task.category values (Doc 3 / Doc 8).
 */
export type TaskCategory =
  | 'request'
  | 'incident'
  | 'update'
  | 'report'
  | 'distribution';

/**
 * Task severity enum (Doc 2).
 */
export type TaskSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

export interface ResolveLabelOptions {
  /**
   * Explicit label string to validate and normalize. When present, this
   * takes precedence over all other hint fields.
   */
  label?: string;

  /**
   * Optional organization identifier for future org‑specific routing.
   * Not used directly yet, but included so the contract remains stable
   * when org‑specific rules are introduced.
   */
  organizationId?: string;

  /**
   * When no explicit label is provided, these fields are used (together
   * with task hints) to construct a canonical label.
   */
  verticalBase?: number;
  infoCategoryDigit?: number;
  infoSubcategoryDigit?: number;
  horizontalRole?: string;

  /**
   * Task‑level hints used when deriving label parts.
   */
  taskType?: string;
  taskCategory?: TaskCategory;
  severity?: TaskSeverity;
}

export interface ResolvedLabelRouting {
  /**
   * Canonical label in the "<BASE>.<CATEGORY><SUBCATEGORY>[.<ROLE>]" form.
   */
  label: string;

  /**
   * Parsed structure of the canonical label.
   */
  parts: LabelParts;

  /**
   * Denormalised role label that can be written to `tasks.assignee_role`.
   * By default this is the horizontalRole part of the label, if present.
   */
  assigneeRole: string | null;

  /**
   * True when the base is one of the reserved broadcast bases (10, 100, 1000).
   */
  isBroadcast: boolean;
}

/**
 * Thrown when a label is syntactically invalid or violates the canonical
 * constraints (digit ranges).
 */
export class InvalidLabelException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLabelException';
  }
}

@Injectable()
export class LabelRoutingService {
  /**
   * Matches labels of the form:
   *   "<BASE>.<CATEGORY><SUBCATEGORY>[.<HORIZONTAL_ROLE>]"
   *
   * Examples:
   *   "100.94.Operations.Safety"
   *   "11.11"
   */
  private readonly labelRegex = /^(\d+)\.(\d)(\d)(?:\.(.+))?$/;

  /**
   * Parse a canonical label string into its parts.
   *
   * Throws InvalidLabelException when the label does not conform to the
   * expected shape or digit ranges.
   */
  parseLabel(label: string): LabelParts {
    if (!label || !label.trim()) {
      throw new InvalidLabelException('Label must be a non-empty string');
    }

    const trimmed = label.trim();
    const match = this.labelRegex.exec(trimmed);

    if (!match) {
      throw new InvalidLabelException(
        `Label "${label}" is not in the canonical "<BASE>.<CATEGORY><SUBCATEGORY>[.<ROLE>]" format`,
      );
    }

    const base = Number(match[1]);
    const categoryDigit = Number(match[2]);
    const subcategoryDigit = Number(match[3]);
    const horizontalRole = match[4]?.trim() || null;

    this.assertBase(base);
    this.assertCategoryDigit(categoryDigit);
    this.assertSubcategoryDigit(subcategoryDigit);

    return {
      base,
      categoryDigit,
      subcategoryDigit,
      horizontalRole,
    };
  }

  /**
   * Format label parts into a canonical label string.
   *
   * Validation is applied to ensure base/category/subcategory are within
   * the allowed ranges. Horizontal role is optional.
   */
  formatLabel(parts: LabelParts): string {
    const { base, categoryDigit, subcategoryDigit } = parts;

    this.assertBase(base);
    this.assertCategoryDigit(categoryDigit);
    this.assertSubcategoryDigit(subcategoryDigit);

    const role = parts.horizontalRole?.trim();
    let label = `${base}.${categoryDigit}${subcategoryDigit}`;

    if (role) {
      label += `.${role}`;
    }

    return label;
  }

  /**
   * Resolve a canonical label and basic routing hints for a task or case.
   *
   * If `options.label` is provided, it is validated and normalized and all
   * other hints are ignored. Otherwise, the label is constructed from the
   * provided hints and reasonable defaults.
   */
  resolveLabel(options: ResolveLabelOptions): ResolvedLabelRouting {
    if (options.label) {
      const parts = this.parseLabel(options.label);
      const normalized = this.formatLabel(parts);

      return {
        label: normalized,
        parts,
        assigneeRole: parts.horizontalRole ?? null,
        isBroadcast: this.isBroadcastBase(parts.base),
      };
    }

    const severity: TaskSeverity = options.severity ?? 'MODERATE';
    const taskCategory: TaskCategory | undefined = options.taskCategory;

    const base =
      options.verticalBase ?? this.deriveBaseFromSeverity(severity);
    const categoryDigit =
      options.infoCategoryDigit ??
      this.deriveCategoryDigitFromTaskCategory(taskCategory);
    const subcategoryDigit =
      options.infoSubcategoryDigit ??
      this.deriveSubcategoryDigitFromTaskCategory(taskCategory);
    const horizontalRole =
      options.horizontalRole ?? this.deriveHorizontalRole(options.taskType);

    const parts: LabelParts = {
      base,
      categoryDigit,
      subcategoryDigit,
      horizontalRole,
    };

    const label = this.formatLabel(parts);

    return {
      label,
      parts,
      assigneeRole: horizontalRole ?? null,
      isBroadcast: this.isBroadcastBase(base),
    };
  }

  /**
   * Convenience helper that returns true when a label uses one of the
   * reserved broadcast bases (10, 100, 1000).
   */
  isBroadcastLabel(label: string): boolean {
    const parts = this.parseLabel(label);
    return this.isBroadcastBase(parts.base);
  }

  /**
   * Reserved broadcast bases are informational by default and must be
   * handled specially by higher‑level workflow/routing logic.
   */
  isBroadcastBase(base: number): boolean {
    return base === 10 || base === 100 || base === 1000;
  }

  /**
   * Derive a vertical base from severity, based on the examples in the spec:
   *
   *   1    – CEO level
   *   2    – C‑level
   *   11   – department head
   *   101  – team lead
   *   1001 – individual staff member
   *
   * Broadcast bases (10 / 100 / 1000) are intentionally not used here;
   * those must be assigned explicitly when the intent is to broadcast.
   */
  private deriveBaseFromSeverity(severity: TaskSeverity): number {
    switch (severity) {
      case 'CRITICAL':
        return 1;
      case 'MAJOR':
        return 11;
      case 'MODERATE':
        return 101;
      case 'MINOR':
      default:
        return 1001;
    }
  }

  /**
   * Map a Task.category to the information category digit (1–9).
   *
   * See Doc 8 §8.3.3 for semantics:
   *   1 – Operational information
   *   3 – Compliance & reporting
   *   6 – Communication & coordination
   *   9 – Crisis & emergency information
   */
  private deriveCategoryDigitFromTaskCategory(
    category?: TaskCategory,
  ): number {
    switch (category) {
      case 'incident':
        // Incidents are usually crisis / emergency.
        return 9;
      case 'update':
      case 'distribution':
        // Communication / coordination.
        return 6;
      case 'report':
        // Structured reports / compliance.
        return 3;
      case 'request':
      default:
        // Default: operational information.
        return 1;
    }
  }

  /**
   * Map a Task.category to the intent/subcategory digit (1–5) as in Doc 8 §8.3.4:
   *
   *   1 – Requests
   *   2 – Updates
   *   3 – Decisions
   *   4 – Reports
   *   5 – Distribution
   */
  private deriveSubcategoryDigitFromTaskCategory(
    category?: TaskCategory,
  ): number {
    switch (category) {
      case 'request':
        return 1;
      case 'update':
        return 2;
      case 'distribution':
        return 5;
      case 'incident':
      case 'report':
        // Incident flows usually surface as reports.
        return 4;
      default:
        return 1;
    }
  }

  /**
   * Derive a horizontal role string (functional axis) from a Task.type /
   * domain identifier.
   *
   * Domain modules can still supply a more specific horizontalRole via
   * ResolveLabelOptions when needed.
   */
  private deriveHorizontalRole(taskType?: string): string | undefined {
    switch (taskType) {
      case 'maintenance':
        return 'Ops.Maintenance';
      case 'hr_case':
      case 'hr':
        return 'HR.CaseManagement';
      case 'education_support':
      case 'education':
        return 'Education.Support';
      case 'it_support':
      case 'it':
        return 'IT.Support';
      case 'operations':
        return 'Ops.General';
      case 'generic':
        return 'Operations.General';
      default:
        return undefined;
    }
  }

  private assertBase(base: number): void {
    if (!Number.isInteger(base) || base <= 0) {
      throw new InvalidLabelException(
        `Label base must be a positive integer, got "${base}"`,
      );
    }
  }

  private assertCategoryDigit(categoryDigit: number): void {
    if (
      !Number.isInteger(categoryDigit) ||
      categoryDigit < 1 ||
      categoryDigit > 9
    ) {
      throw new InvalidLabelException(
        `Label category digit must be between 1 and 9, got "${categoryDigit}"`,
      );
    }
  }

  private assertSubcategoryDigit(subcategoryDigit: number): void {
    if (
      !Number.isInteger(subcategoryDigit) ||
      subcategoryDigit < 1 ||
      subcategoryDigit > 5
    ) {
      throw new InvalidLabelException(
        `Label subcategory digit must be between 1 and 5, got "${subcategoryDigit}"`,
      );
    }
  }
}
