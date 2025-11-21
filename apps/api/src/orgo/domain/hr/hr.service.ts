import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Canonical enums (aligned with Doc 2 / Doc 8)
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

export type HrCaseStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

export type HrCaseConfidentialityLevel = 'sensitive' | 'highly_sensitive';

export type HrCaseParticipantRole =
  | 'complainant'
  | 'respondent'
  | 'witness'
  | 'advocate'
  | 'other';

/**
 * Minimal row shapes used for mapping raw SQL results.
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
  category: 'request' | 'incident' | 'update' | 'report' | 'distribution';
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
 * This is a service-level DTO; controller-level DTOs can extend/validate this shape.
 */
export interface RegisterHrReportInput {
  organizationId: string;

  /**
   * Human-facing title and description of the report.
   */
  title: string;
  description: string;

  /**
   * Canonical enums (JSON inputs may be lower-case; normalization happens in service).
   */
  severity?: TaskSeverity | string;
  priority?: TaskPriority | string;
  visibility?: Visibility | string;

  /**
   * Task category & subtype (domain-specific for HR).
   * Category must be one of: request | incident | update | report | distribution.
   */
  category?: 'request' | 'incident' | 'update' | 'report' | 'distribution';
  subtype?: string; // e.g. "onboarding" | "offboarding" | "harassment" | "policy_question"

  /**
   * Canonical information label; if omitted, a sane HR default is used.
   * Example: "100.94.HR.CaseOfficer"
   */
  label?: string;

  /**
   * Signal/source metadata (aligned with task_source_enum / cases.source_type).
   */
  sourceType?: TaskSource;
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
  location?: unknown;
  caseMetadata?: Record<string, unknown> | null;
  taskMetadata?: Record<string, unknown> | null;

  /**
   * Explicit confidentiality hint (in addition to severity/subtype-based derivation).
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
   * Optional HR-specific title/description overrides for the HR case record.
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

  private readonly prisma: PrismaClient;

  constructor() {
    // Note: if you already have a shared PrismaService / DatabaseService,
    // inject it here instead of instantiating PrismaClient directly.
    this.prisma = new PrismaClient();
  }

  /**
   * Register a new HR report:
   * - Creates a generic Case (`cases`)
   * - Creates an HR Case (`hr_cases`) linked 1:1 with the Case
   * - Creates a primary Task (`tasks`) of type "hr_case"
   * - Creates hr_case_participants for reporter/respondent/others
   * - Creates a primary hr_case_task_links entry
   */
  async registerReport(input: RegisterHrReportInput): Promise<HrCaseWithPrimaryTask> {
    this.ensureRequiredFields(input);

    const severity = this.normalizeSeverity(input.severity);
    const priority = this.normalizePriority(input.priority ?? this.derivePriorityFromSeverity(severity));
    const visibility = this.normalizeVisibility(input.visibility ?? 'RESTRICTED');
    const sourceType: TaskSource = (input.sourceType ?? 'manual') as TaskSource;
    const category: 'request' | 'incident' | 'update' | 'report' | 'distribution' =
      input.category ?? 'request';

    const label = input.label?.trim() || HrModuleService.DEFAULT_HR_LABEL;
    const { verticalBase, horizontalRole } = this.parseLabel(label);

    const now = new Date();
    const organizationId = input.organizationId;
    const originVerticalLevel = verticalBase;
    const originRole = horizontalRole;

    const confidentialityLevel = this.deriveConfidentialityLevel({
      severity,
      subtype: input.subtype,
      requiresHighConfidentiality: input.requiresHighConfidentiality,
    });

    const dueAt = this.normalizeOptionalDate(input.dueAt);

    const tags = input.tags ?? [];
    const locationJson = input.location != null ? JSON.stringify(input.location) : 'null';
    const caseMetadataJson = JSON.stringify(input.caseMetadata ?? {});
    const taskMetadataJson = JSON.stringify(
      input.taskMetadata ?? {
        domain: 'hr_case',
        subtype: input.subtype ?? null,
        reporter_person_id: input.reporterPersonId ?? null,
        respondent_person_id: input.respondentPersonId ?? null,
      },
    );

    return this.prisma.$transaction(async (tx: TxClient) => {
      // 1. Insert into cases
      const [caseRow] = await tx.$queryRaw<CaseRow[]>`
        INSERT INTO cases (
          organization_id,
          source_type,
          source_reference,
          label,
          title,
          description,
          status,
          severity,
          reactivity_time,
          origin_vertical_level,
          origin_role,
          tags,
          location,
          metadata
        ) VALUES (
          ${organizationId},
          ${sourceType},
          ${input.sourceReference ?? null},
          ${label},
          ${input.title},
          ${input.description},
          ${'open'},
          ${severity},
          ${null},
          ${originVerticalLevel},
          ${originRole},
          ${tags},
          ${locationJson}::jsonb,
          ${caseMetadataJson}::jsonb
        )
        RETURNING
          id,
          organization_id,
          label,
          title,
          description,
          status,
          severity,
          origin_vertical_level,
          origin_role,
          created_at,
          updated_at
      `;

      if (!caseRow) {
        throw new Error('Failed to create Case for HR report');
      }

      // 2. Generate a human-readable HR case code (e.g. HR-2025-0001)
      const caseCode = await this.generateCaseCode(tx, organizationId, now);

      // 3. Insert into hr_cases
      const hrTitle = input.hrTitleOverride?.trim() || input.title;
      const hrDescription = input.hrDescriptionOverride?.trim() || input.description;

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
          ${null},
          ${now},
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
        throw new Error('Failed to create HrCase for HR report');
      }

      // 4. Insert primary Task
      const [taskRow] = await tx.$queryRaw<TaskRow[]>`
        INSERT INTO tasks (
          organization_id,
          case_id,
          type,
          category,
          subtype,
          label,
          title,
          description,
          status,
          priority,
          severity,
          visibility,
          source,
          created_by_user_id,
          requester_person_id,
          owner_role_id,
          owner_user_id,
          assignee_role,
          due_at,
          reactivity_time,
          reactivity_deadline_at,
          escalation_level,
          closed_at,
          metadata
        ) VALUES (
          ${organizationId},
          ${caseRow.id},
          ${'hr_case'},
          ${category},
          ${input.subtype ?? null},
          ${label},
          ${`HR case: ${hrTitle}`},
          ${hrDescription},
          ${'PENDING'},
          ${priority},
          ${severity},
          ${visibility},
          ${sourceType},
          ${input.createdByUserId ?? null},
          ${input.reporterPersonId ?? null},
          ${input.caseOwnerRoleId ?? null},
          ${input.caseOwnerUserId ?? null},
          ${input.assigneeRole ?? 'HR.CaseOfficer'},
          ${dueAt},
          ${null},
          ${null},
          ${0},
          ${null},
          ${taskMetadataJson}::jsonb
        )
        RETURNING
          id,
          organization_id,
          case_id,
          type,
          category,
          subtype,
          label,
          title,
          description,
          status,
          priority,
          severity,
          visibility,
          source,
          created_by_user_id,
          requester_person_id,
          owner_role_id,
          owner_user_id,
          assignee_role,
          due_at,
          reactivity_deadline_at,
          escalation_level,
          closed_at
      `;

      if (!taskRow) {
        throw new Error('Failed to create primary Task for HR report');
      }

      // 5. Update HrCase with primary_task_id
      const [updatedHrCaseRow] = await tx.$queryRaw<HrCaseRow[]>`
        UPDATE hr_cases
        SET primary_task_id = ${taskRow.id}
        WHERE id = ${hrCaseRow.id}
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

      const finalHrCaseRow = updatedHrCaseRow ?? hrCaseRow;

      // 6. Insert hr_case_participants rows
      const participants: HrCaseParticipantRow[] = [];

      if (input.reporterPersonId) {
        const [p] = await tx.$queryRaw<HrCaseParticipantRow[]>`
          INSERT INTO hr_case_participants (
            hr_case_id,
            person_id,
            role_in_case,
            notes
          ) VALUES (
            ${finalHrCaseRow.id},
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
            ${finalHrCaseRow.id},
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
              ${finalHrCaseRow.id},
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

      // 7. Link HrCase and Task in hr_case_task_links (link_type "primary")
      await tx.$queryRaw`
        INSERT INTO hr_case_task_links (
          hr_case_id,
          task_id,
          link_type
        ) VALUES (
          ${finalHrCaseRow.id},
          ${taskRow.id},
          ${'primary'}
        )
      `;

      return {
        case: caseRow,
        hrCase: finalHrCaseRow,
        primaryTask: taskRow,
        participants,
      };
    });
  }

  /**
   * List HR cases for an organization with basic filtering and pagination.
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

  private normalizeSeverity(severity?: TaskSeverity | string): TaskSeverity {
    if (!severity) {
      return 'MODERATE';
    }
    const raw = severity.toString().trim();
    const upper = raw.toUpperCase();

    if (upper === 'INFO') {
      // Historical mapping rule: treat "info" as MINOR
      return 'MINOR';
    }

    const allowed: TaskSeverity[] = ['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'];

    if (!allowed.includes(upper as TaskSeverity)) {
      throw new BadRequestException(
        `Invalid severity "${severity}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    return upper as TaskSeverity;
  }

  private normalizePriority(priority?: TaskPriority | string): TaskPriority {
    if (!priority) {
      return 'MEDIUM';
    }
    const upper = priority.toString().trim().toUpperCase();
    const allowed: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

    if (!allowed.includes(upper as TaskPriority)) {
      throw new BadRequestException(
        `Invalid priority "${priority}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    return upper as TaskPriority;
  }

  private normalizeVisibility(visibility?: Visibility | string): Visibility {
    if (!visibility) {
      return 'RESTRICTED';
    }
    const upper = visibility.toString().trim().toUpperCase();
    const allowed: Visibility[] = ['PUBLIC', 'INTERNAL', 'RESTRICTED', 'ANONYMISED'];

    if (!allowed.includes(upper as Visibility)) {
      throw new BadRequestException(
        `Invalid visibility "${visibility}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    return upper as Visibility;
  }

  private derivePriorityFromSeverity(severity: TaskSeverity): TaskPriority {
    switch (severity) {
      case 'CRITICAL':
        return 'CRITICAL';
      case 'MAJOR':
        return 'HIGH';
      case 'MODERATE':
        return 'MEDIUM';
      case 'MINOR':
      default:
        return 'LOW';
    }
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

  private parseLabel(label: string): { verticalBase: number | null; horizontalRole: string | null } {
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
