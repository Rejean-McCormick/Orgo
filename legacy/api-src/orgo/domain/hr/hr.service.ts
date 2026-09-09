// apps/api/src/orgo/domain/hr/hr.service.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../persistence/prisma.service';
import { TaskService } from '../../core/task/task.service';
import { CaseService } from '../../core/case/case.service';
import { LabelService } from '../../core/label/label.service';

/**
 * Canonical enums (aligned with Docs 1, 2, 5, 8).
 * JSON inputs may be lower‑case; normalization happens in this service.
 */
export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'FAILED'
  | 'ESCALATED'
  | 'CANCELLED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type TaskSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

export type Visibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';

export type TaskSource = 'email' | 'api' | 'manual' | 'sync';

/**
 * Canonical HR case status enum (Doc 1 / HR module spec).
 */
export type HrCaseStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

/**
 * HR confidentiality levels (Doc 1 – HR module).
 */
export type HrCaseConfidentialityLevel = 'sensitive' | 'highly_sensitive';

/**
 * HR case participant roles (Doc 1 – HR module).
 */
export type HrCaseParticipantRole =
  | 'complainant'
  | 'respondent'
  | 'witness'
  | 'advocate'
  | 'other';

/**
 * Base task category enum for tasks (Doc 1 / Doc 5).
 * HR domain uses a subset of these.
 */
export type TaskCategory =
  | 'request'
  | 'incident'
  | 'update'
  | 'report'
  | 'distribution';

/**
 * HR‑specific task categories (Doc 3 – hr_case module config).
 */
export type HrTaskCategory = 'request' | 'update' | 'report';

/**
 * Minimal row shapes for raw SQL mappings.
 * These reflect the Doc 1 schema (key columns only).
 */
export interface CaseRow {
  id: string;
  organization_id: string;
  label: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'archived';
  severity: TaskSeverity;
  reactivity_time: string | null;
  origin_vertical_level: number | null;
  origin_role: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface HrCaseRow {
  id: string;
  organization_id: string;
  case_id: string;
  case_code: string;
  title: string;
  description: string;
  status: HrCaseStatus;
  confidentiality_level: HrCaseConfidentialityLevel;
  case_owner_role_id: string | null;
  case_owner_user_id: string | null;
  primary_task_id: string | null;
  opened_at: Date;
  closed_at: Date | null;
}

export interface TaskRow {
  id: string;
  organization_id: string;
  case_id: string | null;
  type: string;
  category: TaskCategory;
  subtype: string | null;
  label: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: Visibility;
  source: TaskSource;
  created_by_user_id: string | null;
  requester_person_id: string | null;
  owner_role_id: string | null;
  owner_user_id: string | null;
  assignee_role: string | null;
  due_at: Date | null;
  reactivity_deadline_at: Date | null;
  escalation_level: number;
  closed_at: Date | null;
}

export interface HrCaseParticipantRow {
  id: string;
  hr_case_id: string;
  person_id: string;
  role_in_case: HrCaseParticipantRole;
  notes: string | null;
}

/**
 * Input DTO for registering a new HR report.
 * This is a service‑level DTO; controller‑level DTOs can extend/validate this shape.
 */
export interface RegisterHrReportInput {
  organizationId: string;

  /**
   * Human‑facing title and description of the report (user‑facing).
   */
  title: string;
  description: string;

  /**
   * Canonical enums (JSON inputs may be lower‑case; normalization happens in service).
   */
  severity?: TaskSeverity | string;
  priority?: TaskPriority | string;
  visibility?: Visibility | string;

  /**
   * Task category & subtype (domain‑specific for HR).
   * Category must be one of: request | update | report.
   * (Other task categories are reserved for non‑HR domains.)
   */
  category?: HrTaskCategory;
  subtype?: string; // e.g. "onboarding" | "offboarding" | "harassment" | "policy_question"

  /**
   * Canonical information label; if omitted, a sane HR default is used.
   * Example: "100.94.HR.CaseOfficer"
   */
  label?: string;

  /**
   * Signal/source metadata (aligned with task_source_enum / cases.source_type).
   */
  sourceType?: TaskSource | string;
  sourceReference?: string | null;

  /**
   * Ownership / routing hints.
   */
  caseOwnerRoleId?: string | null;
  caseOwnerUserId?: string | null;
  assigneeRole?: string | null;

  /**
   * HR participants (mapped into hr_case_participants).
   */
  reporterPersonId?: string | null;
  respondentPersonId?: string | null;
  otherParticipantIds?: string[];
  reporterNotes?: string | null;
  respondentNotes?: string | null;
  otherParticipantsRoleInCase?: HrCaseParticipantRole; // default: "witness"

  /**
   * Additional context.
   */
  tags?: string[];
  // Arbitrary structured location (Org unit / physical site, etc.)
  // Stored as JSONB in cases.location.
  location?: unknown;
  caseMetadata?: Record<string, unknown> | null;
  taskMetadata?: Record<string, unknown> | null;

  /**
   * Explicit confidentiality hint (in addition to severity/subtype‑based derivation).
   */
  requiresHighConfidentiality?: boolean;

  /**
   * Due date for the primary task.
   */
  dueAt?: string | Date | null;

  /**
   * Actor who is creating the report (user account).
   */
  createdByUserId?: string | null;

  /**
   * Optional HR‑specific title/description overrides for the HR case record.
   * These can differ from the generic Case title/description (e.g. for anonymisation).
   */
  hrTitleOverride?: string | null;
  hrDescriptionOverride?: string | null;
}

/**
 * Summary shape returned from listCases().
 */
export interface HrCaseSummary {
  id: string; // hr_cases.id
  caseId: string;
  caseCode: string;
  title: string;
  status: HrCaseStatus;
  severity: TaskSeverity;
  confidentialityLevel: HrCaseConfidentialityLevel;
  openedAt: string;
  closedAt?: string;
  primaryTaskId?: string;
}

/**
 * Paginated list wrapper for HR case summaries.
 */
export interface PaginatedHrCaseSummary {
  items: HrCaseSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Options for listing HR cases.
 */
export interface ListHrCasesOptions {
  organizationId: string;
  status?: HrCaseStatus | HrCaseStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Detailed result of a newly registered HR report.
 */
export interface HrCaseWithPrimaryTask {
  case: CaseRow;
  hrCase: HrCaseRow;
  primaryTask: TaskRow;
  participants: HrCaseParticipantRow[];
}

/**
 * TxClient type alias for use inside Prisma transactions.
 */
type TxClient = Prisma.TransactionClient;

@Injectable()
export class HrModuleService {
  /**
   * Default canonical label for HR case work (Doc 8 example).
   * 100  = broadcast base (department head level)
   * .9   = crisis/emergency information
   * .4   = report
   * HR.CaseOfficer = horizontal functional role
   */
  private static readonly DEFAULT_HR_LABEL = '100.94.HR.CaseOfficer';

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly caseService: CaseService,
    private readonly labelService: LabelService,
  ) {}

  /**
   * Register a new HR report:
   * - Creates a generic Case (`cases`) via CaseService
   * - Creates a primary Task (`tasks`) of type "hr_case" via TaskService
   * - Creates an HR Case (`hr_cases`) linked 1:1 with the Case
   * - Creates hr_case_participants for reporter/respondent/others
   * - Creates a primary hr_case_task_links entry
   *
   * All writes are scoped to the given organization_id (multi‑tenant safety).
   */
  async registerReport(input: RegisterHrReportInput): Promise<HrCaseWithPrimaryTask> {
    this.ensureRequiredFields(input);

    const organizationId = input.organizationId;

    // HR-specific task category
    const category: HrTaskCategory = this.normalizeHrCategory(input.category);

    // Let the shared LabelService generate a canonical HR label when none is provided.
    let label: string | null | undefined = input.label?.trim();
    if (!label) {
      try {
        // The exact API of LabelService may differ; adapt as needed.
        label =
          (await this.labelService.generateHrLabel?.({
            organizationId,
            category,
            subtype: input.subtype ?? null,
          })) ?? null;
      } catch {
        // Swallow and fall back to default HR label if the label service
        // is not yet configured for HR or throws.
      }
    }
    if (!label) {
      label = HrModuleService.DEFAULT_HR_LABEL;
    }

    const { verticalBase, horizontalRole } = this.parseLabel(label as string);

    const hrTitle = input.hrTitleOverride?.trim() || input.title;
    const hrDescription = input.hrDescriptionOverride?.trim() || input.description;

    const tags: string[] = input.tags ?? [];
    const caseMetadata: Record<string, unknown> = input.caseMetadata ?? {};
    const taskMetadata: Record<string, unknown> = {
      ...(input.taskMetadata ?? {}),
      domain: 'hr_case',
      subtype: input.subtype ?? null,
      reporter_person_id: input.reporterPersonId ?? null,
      respondent_person_id: input.respondentPersonId ?? null,
    };

    // HR-specific visibility rule: harassment tasks default to ANONYMISED;
    // otherwise we let TaskService / core defaults decide.
    let visibilityOverride: Visibility | string | undefined;
    if (input.visibility) {
      visibilityOverride = input.visibility;
    } else if (input.subtype && input.subtype.toLowerCase().trim() === 'harassment') {
      visibilityOverride = 'ANONYMISED';
    }

    const dueAt = this.normalizeOptionalDate(input.dueAt);

    return this.prisma.$transaction(async (tx: TxClient) => {
      // 1. Create the generic Case via the core CaseService.
      const caseRow = (await this.caseService.createCase(
        {
          organizationId,
          label,
          title: input.title,
          description: input.description,
          tags,
          location: input.location ?? null,
          metadata: caseMetadata,
          originVerticalLevel: verticalBase,
          originRole: horizontalRole,
          sourceType: input.sourceType,
          sourceReference: input.sourceReference ?? null,
          severity: input.severity, // let core normalize & default
        },
        tx,
      )) as CaseRow | null;

      if (!caseRow) {
        throw new BadRequestException('Failed to create Case for HR report');
      }

      const openedAt = caseRow.created_at;
      const caseCode = await this.generateCaseCode(tx, organizationId, openedAt);

      // 2. Create the primary Task via the core TaskService.
      const taskRow = (await this.taskService.createTask(
        {
          organizationId,
          caseId: caseRow.id,
          type: 'hr_case',
          category,
          subtype: input.subtype ?? null,
          label,
          title: hrTitle,
          description: hrDescription,
          // Delegate defaults (status, severity, priority, visibility, source) to TaskService / DomainTaskFactory
          severity: input.severity,
          priority: input.priority,
          visibility: visibilityOverride,
          source: input.sourceType,
          createdByUserId: input.createdByUserId ?? null,
          requesterPersonId: input.reporterPersonId ?? null,
          ownerRoleId: input.caseOwnerRoleId ?? null,
          ownerUserId: input.caseOwnerUserId ?? null,
          assigneeRole: input.assigneeRole ?? horizontalRole ?? null,
          dueAt,
          metadata: taskMetadata,
        },
        tx,
      )) as TaskRow | null;

      if (!taskRow) {
        throw new BadRequestException('Failed to create primary HR Task for report');
      }

      // Use the canonical severity as persisted by the core TaskService to derive HR confidentiality.
      const confidentialityLevel = this.deriveConfidentialityLevel({
        severity: taskRow.severity,
        subtype: input.subtype,
        requiresHighConfidentiality: input.requiresHighConfidentiality,
      });

      // 3. Insert into hr_cases (HR domain extension of the Case)
      const [hrCaseRow] = await tx.$queryRaw<HrCaseRow[]>`
        INSERT INTO hr_cases (
          organization_id,
          case_id,
          case_code,
          title,
          description,
          status,
          confidentiality_level,
          case_owner_role_id,
          case_owner_user_id,
          primary_task_id,
          opened_at,
          closed_at
        ) VALUES (
          ${organizationId},
          ${caseRow.id},
          ${caseCode},
          ${hrTitle},
          ${hrDescription},
          ${'open'},
          ${confidentialityLevel},
          ${input.caseOwnerRoleId ?? null},
          ${input.caseOwnerUserId ?? null},
          ${taskRow.id},
          ${openedAt},
          ${null}
        )
        RETURNING
          id,
          organization_id,
          case_id,
          case_code,
          title,
          description,
          status,
          confidentiality_level,
          case_owner_role_id,
          case_owner_user_id,
          primary_task_id,
          opened_at,
          closed_at
      `;

      if (!hrCaseRow) {
        throw new BadRequestException('Failed to create HR Case for report');
      }

      // 4. Insert participants into hr_case_participants
      const participants: HrCaseParticipantRow[] = [];

      if (input.reporterPersonId) {
        const [p] = await tx.$queryRaw<HrCaseParticipantRow[]>`
          INSERT INTO hr_case_participants (
            hr_case_id,
            person_id,
            role_in_case,
            notes
          ) VALUES (
            ${hrCaseRow.id},
            ${input.reporterPersonId},
            ${'complainant'},
            ${input.reporterNotes ?? null}
          )
          RETURNING
            id,
            hr_case_id,
            person_id,
            role_in_case,
            notes
        `;
        if (p) {
          participants.push(p);
        }
      }

      if (input.respondentPersonId) {
        const [p] = await tx.$queryRaw<HrCaseParticipantRow[]>`
          INSERT INTO hr_case_participants (
            hr_case_id,
            person_id,
            role_in_case,
            notes
          ) VALUES (
            ${hrCaseRow.id},
            ${input.respondentPersonId},
            ${'respondent'},
            ${input.respondentNotes ?? null}
          )
          RETURNING
            id,
            hr_case_id,
            person_id,
            role_in_case,
            notes
        `;
        if (p) {
          participants.push(p);
        }
      }

      if (input.otherParticipantIds?.length) {
        const roleForOthers: HrCaseParticipantRole =
          input.otherParticipantsRoleInCase ?? 'witness';

        for (const personId of input.otherParticipantIds) {
          const [p] = await tx.$queryRaw<HrCaseParticipantRow[]>`
            INSERT INTO hr_case_participants (
              hr_case_id,
              person_id,
              role_in_case,
              notes
            ) VALUES (
              ${hrCaseRow.id},
              ${personId},
              ${roleForOthers},
              ${null}
            )
            RETURNING
              id,
              hr_case_id,
              person_id,
              role_in_case,
              notes
          `;
          if (p) {
            participants.push(p);
          }
        }
      }

      // 5. Link HrCase and Task in hr_case_task_links (link_type "primary")
      await tx.$queryRaw`
        INSERT INTO hr_case_task_links (
          hr_case_id,
          task_id,
          link_type
        ) VALUES (
          ${hrCaseRow.id},
          ${taskRow.id},
          ${'primary'}
        )
      `;

      return {
        case: caseRow,
        hrCase: hrCaseRow,
        primaryTask: taskRow,
        participants,
      };
    });
  }

  /**
   * List HR cases for an organization with basic filtering and pagination.
   * Filters by hr_cases.status, optional free‑text search, and org‑scoped only.
   */
  async listCases(options: ListHrCasesOptions): Promise<PaginatedHrCaseSummary> {
    const { organizationId } = options;
    if (!organizationId || !organizationId.trim()) {
      throw new BadRequestException('organizationId is required');
    }

    const statuses = this.normalizeHrCaseStatusFilter(options.status);
    const search = options.search?.trim() || null;

    const limit = this.normalizeLimit(options.limit);
    const offset = this.normalizeOffset(options.offset);

    const statusCondition: Prisma.Sql = statuses.length
      ? Prisma.sql`AND hc.status = ANY(${statuses})`
      : Prisma.sql``;

    const searchCondition: Prisma.Sql = search
      ? Prisma.sql`AND (
          hc.title ILIKE ${`%${search}%`}
          OR c.title ILIKE ${`%${search}%`}
          OR c.description ILIKE ${`%${search}%`}
        )`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        case_id: string;
        case_code: string;
        title: string;
        status: HrCaseStatus;
        confidentiality_level: HrCaseConfidentialityLevel;
        opened_at: Date;
        closed_at: Date | null;
        primary_task_id: string | null;
        severity: TaskSeverity;
      }>
    >`
      SELECT
        hc.id,
        hc.case_id,
        hc.case_code,
        hc.title,
        hc.status,
        hc.confidentiality_level,
        hc.opened_at,
        hc.closed_at,
        hc.primary_task_id,
        c.severity
      FROM hr_cases hc
      JOIN cases c ON hc.case_id = c.id
      WHERE hc.organization_id = ${organizationId}
      ${statusCondition}
      ${searchCondition}
      ORDER BY hc.opened_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const [countRow] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*)::bigint AS total
      FROM hr_cases hc
      JOIN cases c ON hc.case_id = c.id
      WHERE hc.organization_id = ${organizationId}
      ${statusCondition}
      ${searchCondition}
    `;

    const total = countRow ? Number(countRow.total) : 0;

    const items: HrCaseSummary[] = rows.map((r) => ({
      id: r.id,
      caseId: r.case_id,
      caseCode: r.case_code,
      title: r.title,
      status: r.status,
      severity: r.severity,
      confidentialityLevel: r.confidentiality_level,
      openedAt: r.opened_at.toISOString(),
      closedAt: r.closed_at ? r.closed_at.toISOString() : undefined,
      primaryTaskId: r.primary_task_id ?? undefined,
    }));

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private ensureRequiredFields(input: RegisterHrReportInput): void {
    if (!input.organizationId || !input.organizationId.trim()) {
      throw new BadRequestException('organizationId is required');
    }
    if (!input.title || !input.title.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!input.description || !input.description.trim()) {
      throw new BadRequestException('description is required');
    }
  }

  /**
   * Normalizes HR task category according to the hr_case domain module config.
   */
  private normalizeHrCategory(category?: HrTaskCategory | string | null): HrTaskCategory {
    const allowed: HrTaskCategory[] = ['request', 'update', 'report'];

    if (!category) {
      return 'request';
    }

    const lower = category.toString().trim().toLowerCase() as HrTaskCategory;

    if (!allowed.includes(lower)) {
      throw new BadRequestException(
        `Invalid HR task category "${category}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    return lower;
  }

  private deriveConfidentialityLevel(opts: {
    severity: TaskSeverity;
    subtype?: string;
    requiresHighConfidentiality?: boolean;
  }): HrCaseConfidentialityLevel {
    if (opts.requiresHighConfidentiality) {
      return 'highly_sensitive';
    }

    const subtype = (opts.subtype ?? '').toLowerCase().trim();

    if (subtype === 'harassment') {
      return 'highly_sensitive';
    }

    if (opts.severity === 'MAJOR' || opts.severity === 'CRITICAL') {
      return 'highly_sensitive';
    }

    return 'sensitive';
  }

  private normalizeOptionalDate(value?: string | Date | null): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new BadRequestException('Invalid Date instance for dueAt');
      }
      return value;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid ISO date string for dueAt: "${value}"`);
    }
    return d;
  }

  /**
   * Parses a canonical label `<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>`
   * into vertical base and horizontal role.
   */
  private parseLabel(label: string): {
    verticalBase: number | null;
    horizontalRole: string | null;
  } {
    const trimmed = label.trim();
    if (!trimmed) {
      return { verticalBase: null, horizontalRole: null };
    }

    const parts = trimmed.split('.');
    if (parts.length < 2) {
      return { verticalBase: null, horizontalRole: null };
    }

    const verticalBase = Number.parseInt(parts[0]!, 10);
    const horizontalRole = parts.length > 2 ? parts.slice(2).join('.') : null;

    return {
      verticalBase: Number.isFinite(verticalBase) ? verticalBase : null,
      horizontalRole,
    };
  }

  /**
   * Generates a human‑friendly HR case code `HR-<YEAR>-<NNNN>` scoped by org.
   */
  private async generateCaseCode(
    tx: TxClient,
    organizationId: string,
    openedAt: Date,
  ): Promise<string> {
    const year = openedAt.getUTCFullYear();

    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM hr_cases
      WHERE organization_id = ${organizationId}
        AND date_part('year', opened_at) = ${year}
    `;

    const sequence = (row?.count ?? 0) + 1;
    const sequenceStr = String(sequence).padStart(4, '0');

    return `HR-${year}-${sequenceStr}`;
  }

  private normalizeHrCaseStatusFilter(
    status?: HrCaseStatus | HrCaseStatus[],
  ): HrCaseStatus[] {
    if (!status) {
      return [];
    }
    const allowed: HrCaseStatus[] = ['open', 'under_review', 'resolved', 'dismissed'];

    const arr: string[] = Array.isArray(status) ? status : [status];

    const normalized: HrCaseStatus[] = arr.map((s) => {
      const val = s.toString().trim() as HrCaseStatus;
      if (!allowed.includes(val)) {
        throw new BadRequestException(
          `Invalid hrCase status "${s}". Expected one of: ${allowed.join(', ')}`,
        );
      }
      return val;
    });

    return normalized;
  }

  private normalizeLimit(limit?: number): number {
    if (limit == null) {
      return 50;
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }
    return Math.min(Math.floor(limit), 500);
  }

  private normalizeOffset(offset?: number): number {
    if (offset == null) {
      return 0;
    }
    if (!Number.isFinite(offset) || offset < 0) {
      throw new BadRequestException('offset must be a non-negative number');
    }
    return Math.floor(offset);
  }
}
