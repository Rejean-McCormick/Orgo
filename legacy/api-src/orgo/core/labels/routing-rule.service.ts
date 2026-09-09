import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { LogService } from '../logging/log.service';

export type TaskCategory =
  | 'request'
  | 'incident'
  | 'update'
  | 'report'
  | 'distribution';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const PRIORITY_ORDER: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface OrgoError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error: OrgoError | null;
}

export interface ApplyRoutingRulesInput {
  /**
   * Tenant / organization that owns the task or signal.
   */
  organizationId: string;

  /**
   * Domain-level task type (maintenance, hr_case, it_support, etc.).
   */
  taskType?: string | null;

  /**
   * Canonical task category (“request” | “incident” | “update” | “report” | “distribution”).
   */
  taskCategory?: string | null;

  /**
   * Task priority. May be canonical enum casing or lower-case JSON form.
   */
  priority?: string | null;

  /**
   * Classification label codes attached to the task/signal
   * (e.g. ["anonymous", "equipment_failure"]).
   */
  labelCodes?: string[];

  /**
   * Optional task identifier (for logging correlation).
   */
  taskId?: string;
}

export interface RoutingDecision {
  /**
   * Organization that owns the chosen rule (may be null for global rules).
   */
  organizationId: string | null;

  /**
   * Target role that should initially own the task, if defined by the rule.
   */
  targetRoleId: string | null;

  /**
   * Target user that should initially own the task, if defined by the rule.
   * Used sparingly; routing should primarily be role-based.
   */
  targetUserId: string | null;

  /**
   * Identifier and name of the applied rule for auditability.
   */
  ruleId: string | null;
  ruleName: string | null;

  /**
   * Whether the selected rule is marked as a fallback.
   */
  isFallback: boolean;
}

/**
 * Internal normalized view of the routing context.
 */
interface NormalizedRoutingContext {
  organizationId: string;
  taskType?: string;
  taskCategory?: TaskCategory;
  priority?: TaskPriority;
  labelCodes: string[];
  taskId?: string;
}

/**
 * Internal normalized view of a routing rule record.
 * The physical table is `routing_rules` (Doc 1).
 */
interface NormalizedRoutingRule {
  id: string;
  organizationId: string | null;
  name: string;
  taskType?: string;
  taskCategory?: TaskCategory;
  labelCodes: string[];
  priorityMin?: TaskPriority;
  targetRoleId?: string | null;
  targetUserId?: string | null;
  isFallback: boolean;
  weight: number;
}

@Injectable()
export class RoutingRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logService: LogService,
  ) {}

  /**
   * Applies routing_rules for the given context and returns the chosen
   * role/user assignment, following Core Services + Doc 1/2 semantics.
   *
   * Matching semantics:
   * - organization_id: prefer org-specific rules over global (NULL).
   * - task_type: must match if rule.task_type is not NULL (case-insensitive).
   * - task_category: must match if rule.task_category is not NULL (lower-case).
   * - label_codes: all rule.label_codes must be present in context.labelCodes.
   * - priority_min: context.priority must be >= rule.priority_min.
   *
   * Selection semantics:
   * - First prefer non-fallback rules; if none match, use fallback rules.
   * - Within that set, prefer org-specific rules.
   * - Within org/global scope, pick rule with highest weight.
   * - If still tied, pick rule with lexicographically smallest id
   *   to keep behaviour deterministic.
   */
  async applyRoutingRules(
    input: ApplyRoutingRulesInput,
  ): Promise<StandardResult<RoutingDecision>> {
    const context = this.normalizeContext(input);

    try {
      const rawRules = await this.prisma.routingRule.findMany({
        where: {
          OR: [
            { organizationId: context.organizationId },
            { organizationId: null },
          ],
        },
      });

      const normalizedRules = rawRules.map((rule) =>
        this.normalizeRule(rule as any),
      );
      const matchingRules = normalizedRules.filter((rule) =>
        this.matchesRule(rule, context),
      );

      const selectedRule = this.pickBestRule(
        matchingRules,
        context.organizationId,
      );

      if (!selectedRule) {
        this.logService.logEvent({
          category: 'WORKFLOW',
          logLevel: 'WARNING',
          message: 'No routing rule matched context',
          identifier: context.taskId
            ? `task_id:${context.taskId}`
            : undefined,
          metadata: {
            organizationId: context.organizationId,
            taskType: context.taskType,
            taskCategory: context.taskCategory,
            priority: context.priority,
            labelCodes: context.labelCodes,
          },
        });

        return {
          ok: false,
          data: null,
          error: {
            code: 'ROUTING_RULE_NOT_FOUND',
            message: 'No routing rule matched the provided context.',
            details: {
              organizationId: context.organizationId,
              taskType: context.taskType,
              taskCategory: context.taskCategory,
            },
          },
        };
      }

      const decision: RoutingDecision = {
        organizationId: selectedRule.organizationId,
        targetRoleId: selectedRule.targetRoleId ?? null,
        targetUserId: selectedRule.targetUserId ?? null,
        ruleId: selectedRule.id,
        ruleName: selectedRule.name,
        isFallback: selectedRule.isFallback,
      };

      this.logService.logEvent({
        category: 'WORKFLOW',
        logLevel: 'INFO',
        message: 'Routing rule applied',
        identifier: context.taskId ? `task_id:${context.taskId}` : undefined,
        metadata: {
          organizationId: context.organizationId,
          taskType: context.taskType,
          taskCategory: context.taskCategory,
          priority: context.priority,
          labelCodes: context.labelCodes,
          ruleId: decision.ruleId,
          ruleName: decision.ruleName,
          targetRoleId: decision.targetRoleId,
          targetUserId: decision.targetUserId,
          isFallback: decision.isFallback,
        },
      });

      return {
        ok: true,
        data: decision,
        error: null,
      };
    } catch (error) {
      this.logService.logEvent({
        category: 'SYSTEM',
        logLevel: 'ERROR',
        message: 'Failed to evaluate routing rules',
        identifier: input.taskId ? `task_id:${input.taskId}` : undefined,
        metadata: {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'ROUTING_RULE_EVALUATION_ERROR',
          message: 'Failed to evaluate routing rules.',
          details: {},
        },
      };
    }
  }

  private normalizeContext(
    input: ApplyRoutingRulesInput,
  ): NormalizedRoutingContext {
    const labelCodes =
      input.labelCodes?.map((code) => code.trim().toLowerCase()).filter(Boolean) ??
      [];

    const taskType = input.taskType
      ? input.taskType.trim().toLowerCase()
      : undefined;

    const taskCategory = input.taskCategory
      ? (input.taskCategory.trim().toLowerCase() as TaskCategory)
      : undefined;

    const priority = this.normalizePriority(input.priority);

    return {
      organizationId: input.organizationId,
      taskType,
      taskCategory,
      priority: priority ?? undefined,
      labelCodes,
      taskId: input.taskId,
    };
  }

  private normalizeRule(rule: any): NormalizedRoutingRule {
    const labelCodes: string[] =
      (rule.labelCodes ?? rule.label_codes ?? []) as string[];

    const weightRaw: number | null | undefined =
      rule.weight !== undefined ? rule.weight : rule.weight ?? 0;

    return {
      id: String(rule.id),
      organizationId:
        (rule.organizationId ?? rule.organization_id) ?? null,
      name: rule.name,
      taskType: rule.taskType
        ? String(rule.taskType).trim().toLowerCase()
        : rule.task_type
        ? String(rule.task_type).trim().toLowerCase()
        : undefined,
      taskCategory: rule.taskCategory
        ? (String(rule.taskCategory).trim().toLowerCase() as TaskCategory)
        : rule.task_category
        ? (String(rule.task_category).trim().toLowerCase() as TaskCategory)
        : undefined,
      labelCodes: labelCodes.map((c) => c.trim().toLowerCase()).filter(Boolean),
      priorityMin: this.normalizePriority(
        rule.priorityMin ?? rule.priority_min ?? null,
      ) ?? undefined,
      targetRoleId:
        (rule.targetRoleId ?? rule.target_role_id) ?? null,
      targetUserId:
        (rule.targetUserId ?? rule.target_user_id) ?? null,
      isFallback: Boolean(rule.isFallback ?? rule.is_fallback),
      weight: typeof weightRaw === 'number' ? weightRaw : 0,
    };
  }

  private matchesRule(
    rule: NormalizedRoutingRule,
    ctx: NormalizedRoutingContext,
  ): boolean {
    if (rule.taskType && (!ctx.taskType || rule.taskType !== ctx.taskType)) {
      return false;
    }

    if (
      rule.taskCategory &&
      (!ctx.taskCategory || rule.taskCategory !== ctx.taskCategory)
    ) {
      return false;
    }

    if (rule.labelCodes.length > 0) {
      const ctxCodes = new Set(ctx.labelCodes);
      const hasAllLabels = rule.labelCodes.every((code) => ctxCodes.has(code));
      if (!hasAllLabels) {
        return false;
      }
    }

    if (rule.priorityMin) {
      if (!ctx.priority) {
        return false;
      }
      if (!this.hasRequiredPriority(ctx.priority, rule.priorityMin)) {
        return false;
      }
    }

    return true;
  }

  private pickBestRule(
    rules: NormalizedRoutingRule[],
    organizationId: string,
  ): NormalizedRoutingRule | null {
    if (rules.length === 0) {
      return null;
    }

    const nonFallback = rules.filter((r) => !r.isFallback);
    const pool = nonFallback.length > 0 ? nonFallback : rules.filter((r) => r.isFallback);

    if (pool.length === 0) {
      return null;
    }

    const orgSpecific = pool.filter((r) => r.organizationId === organizationId);
    const scopedPool = orgSpecific.length > 0 ? orgSpecific : pool;

    scopedPool.sort((a, b) => {
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }
      return a.id.localeCompare(b.id);
    });

    return scopedPool[0] ?? null;
  }

  private normalizePriority(
    priority: string | null | undefined,
  ): TaskPriority | null {
    if (!priority) {
      return null;
    }

    const upper = priority.toString().trim().toUpperCase();

    switch (upper) {
      case 'LOW':
      case 'MEDIUM':
      case 'HIGH':
      case 'CRITICAL':
        return upper;
      default:
        return null;
    }
  }

  private hasRequiredPriority(
    contextPriority: TaskPriority,
    rulePriorityMin: TaskPriority,
  ): boolean {
    const contextIndex = PRIORITY_ORDER.indexOf(contextPriority);
    const ruleIndex = PRIORITY_ORDER.indexOf(rulePriorityMin);

    if (contextIndex === -1 || ruleIndex === -1) {
      return false;
    }

    return contextIndex >= ruleIndex;
  }
}
