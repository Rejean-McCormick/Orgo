import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const fsPromises = fs.promises;

const TASK_CATEGORIES = ['request', 'incident', 'update', 'report', 'distribution'] as const;
type TaskCategory = (typeof TASK_CATEGORIES)[number];

const TASK_SEVERITIES = ['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'] as const;
type TaskSeverity = (typeof TASK_SEVERITIES)[number];

const WORKFLOW_EVENT_SOURCES = ['EMAIL', 'API', 'SYSTEM', 'TIMER'] as const;
type WorkflowEventSource = (typeof WORKFLOW_EVENT_SOURCES)[number];

const WORKFLOW_ACTION_TYPES = [
  'CREATE_TASK',
  'UPDATE_TASK',
  'ROUTE',
  'ESCALATE',
  'ATTACH_TEMPLATE',
  'SET_METADATA',
  'NOTIFY',
] as const;
type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export interface WorkflowMatchCriteria {
  source?: WorkflowEventSource;
  /**
   * Domain-level type, e.g. "maintenance", "hr_case" (maps to Task.type)
   */
  type?: string;
  /**
   * Global Task.category (request | incident | update | report | distribution)
   */
  category?: TaskCategory;
  /**
   * Canonical severity enum (MINOR | MODERATE | MAJOR | CRITICAL)
   */
  severity?: TaskSeverity;
  /**
   * Numeric base of canonical label (e.g. 10, 100, 1000, 11, 101, ...)
   */
  labelBase?: number;
  /**
   * String prefix for label matching (e.g. "100.94.")
   */
  labelPrefix?: string;
  /**
   * At least one of these must appear in searchable text (case-insensitive)
   */
  keywordsAny?: string[];
  /**
   * All of these must appear in searchable text (case-insensitive)
   */
  keywordsAll?: string[];
  /**
   * Reserved for future metadata-based matching
   */
  metadata?: Record<string, unknown>;
}

export interface WorkflowAction {
  /**
   * Action type (CREATE_TASK, UPDATE_TASK, ROUTE, ESCALATE, ATTACH_TEMPLATE, SET_METADATA, NOTIFY)
   */
  type: WorkflowActionType | string;
  /**
   * Other keys depend on action type (set, to_role, channel, template_id, etc.)
   */
  [key: string]: any;
}

export interface WorkflowRule {
  id: string;
  version: string;
  description?: string;
  /**
   * Matching criteria; any unspecified field is treated as "no constraint"
   */
  match: WorkflowMatchCriteria;
  /**
   * Ordered list of actions to emit when rule matches
   */
  actions: WorkflowAction[];
  /**
   * Disabled rules are ignored at runtime
   */
  enabled: boolean;
  /**
   * Source file on disk (for debugging and validation reporting)
   */
  sourceFile?: string;
}

export interface WorkflowContext {
  organizationId: string;
  /**
   * Workflow event source: EMAIL | API | SYSTEM | TIMER
   * (This is distinct from task_source_enum: email | api | manual | sync.)
   */
  source: WorkflowEventSource;

  /**
   * Domain-level type (Task.type), e.g. "maintenance", "hr_case"
   */
  type?: string;

  /**
   * Global Task.category (request | incident | update | report | distribution)
   */
  category?: string;

  /**
   * Severity string; normalised against TASK_SEVERITY (MINOR | MODERATE | MAJOR | CRITICAL)
   */
  severity?: string;

  /**
   * Canonical label for Case/Task, e.g. "100.94.Operations.Safety"
   */
  label?: string;

  /**
   * Human title / summary (Task.title / Case.title / email subject)
   */
  title?: string;

  /**
   * Human description/body (Task.description / Case.description)
   */
  description?: string;

  /**
   * Parsed email subject (for EMAIL sources)
   */
  emailSubject?: string;

  /**
   * Parsed plain-text email body (for EMAIL sources)
   */
  emailTextBody?: string;

  /**
   * Arbitrary metadata associated with the event/context
   */
  metadata?: Record<string, unknown>;

  /**
   * Raw payload for the event (email envelope, API body, etc.)
   */
  payload?: Record<string, unknown>;
}

export interface ResolvedWorkflowAction {
  ruleId: string;
  ruleVersion: string;
  actionIndex: number;
  action: WorkflowAction;
}

export interface WorkflowExecutionResultData {
  context: WorkflowContext;
  matchedRules: WorkflowRule[];
  actions: ResolvedWorkflowAction[];
}

export interface WorkflowRuleValidationError {
  ruleId: string;
  sourceFile?: string;
  message: string;
  /**
   * JSONPath-like hint into the rule, e.g. "match.category", "actions[0].type"
   */
  path?: string;
}

export interface WorkflowEngineError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface WorkflowEngineResult<T> {
  ok: boolean;
  data: T | null;
  error: WorkflowEngineError | null;
}

/**
 * WorkflowEngineService
 *
 * Core service that:
 * - Loads workflow rule definitions from the filesystem.
 * - Validates rule structure and canonical enum usage.
 * - Evaluates rules against a WorkflowContext and emits an ordered list of actions.
 *
 * Side effects (creating tasks, routing, notifications, etc.) are performed by callers
 * using the returned actions; this service is intentionally pure in that sense.
 */
@Injectable()
export class WorkflowEngineService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowEngineService.name);
  private readonly rulesDirectory: string;

  private rules: WorkflowRule[] = [];
  private loadedAt: Date | null = null;

  constructor(private readonly configService: ConfigService) {
    // Allow override via env; default to ../../config/workflows relative to apps/api
    const envDir =
      this.configService.get<string>('WORKFLOW_RULES_DIR') ??
      this.configService.get<string>('ORGO_WORKFLOW_RULES_DIR');

    const defaultDir = path.resolve(process.cwd(), '..', '..', 'config', 'workflows');

    this.rulesDirectory = envDir || defaultDir;
  }

  async onModuleInit(): Promise<void> {
    await this.reloadRules();
  }

  /**
   * Reload rules from disk and validate them.
   * Intended for startup and for administrative hot-reload.
   */
  async reloadRules(): Promise<void> {
    try {
      const rules = await this.loadRulesFromDisk();
      this.rules = rules;
      this.loadedAt = new Date();

      const validation = this.internalValidateRules(rules);

      if (!validation.valid) {
        this.logger.error(
          `Workflow rules loaded with ${validation.ruleErrors.length} validation error(s).`,
        );
        for (const err of validation.ruleErrors) {
          this.logger.error(
            `[${err.ruleId}] ${err.message}` +
              (err.path ? ` (path: ${err.path})` : '') +
              (err.sourceFile ? ` [${err.sourceFile}]` : ''),
          );
        }
      } else {
        this.logger.log(
          `Workflow rules loaded successfully (${rules.length} rule(s)) from ${this.rulesDirectory}.`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to load workflow rules from ${this.rulesDirectory}: ${
          error?.message ?? error
        }`,
        error?.stack,
      );
      this.rules = [];
      this.loadedAt = null;
    }
  }

  /**
   * Execute workflow rules for a given context and return the resolved actions.
   */
  async executeWorkflow(
    context: WorkflowContext,
  ): Promise<WorkflowEngineResult<WorkflowExecutionResultData>> {
    try {
      if (!this.loadedAt) {
        await this.reloadRules();
      }

      const matchedRules: WorkflowRule[] = [];
      const resolvedActions: ResolvedWorkflowAction[] = [];

      for (const rule of this.rules) {
        if (!rule.enabled) {
          continue;
        }
        if (!this.ruleMatches(rule, context)) {
          continue;
        }

        matchedRules.push(rule);

        rule.actions.forEach((action, index) => {
          resolvedActions.push({
            ruleId: rule.id,
            ruleVersion: rule.version,
            actionIndex: index,
            action,
          });
        });
      }

      this.logger.debug(
        `Workflow executed for org=${context.organizationId}, source=${context.source}. ` +
          `Matched ${matchedRules.length} rule(s), produced ${resolvedActions.length} action(s).`,
      );

      return {
        ok: true,
        data: {
          context,
          matchedRules,
          actions: resolvedActions,
        },
        error: null,
      };
    } catch (error: any) {
      this.logger.error(
        `Workflow execution failed: ${error?.message ?? error}`,
        error?.stack,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'WORKFLOW_EXECUTION_ERROR',
          message: 'Workflow execution failed',
          details: {
            error: String(error?.message ?? error),
          },
        },
      };
    }
  }

  /**
   * Validate currently loaded rules and return structured errors.
   * Does not reload from disk by itself.
   */
  async validateWorkflowRules(): Promise<
    WorkflowEngineResult<{
      valid: boolean;
      ruleErrors: WorkflowRuleValidationError[];
    }>
  > {
    try {
      if (!this.loadedAt) {
        await this.reloadRules();
      }

      const validation = this.internalValidateRules(this.rules);

      return {
        ok: true,
        data: validation,
        error: null,
      };
    } catch (error: any) {
      this.logger.error(
        `Workflow rule validation failed: ${error?.message ?? error}`,
        error?.stack,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'WORKFLOW_VALIDATION_ERROR',
          message: 'Workflow rule validation failed',
          details: {
            error: String(error?.message ?? error),
          },
        },
      };
    }
  }

  /**
   * Load workflow rule files from disk and normalise them to WorkflowRule objects.
   * Supports .yaml/.yml (YAML) and .json files. Files may contain a single rule
   * object or an array of rule objects.
   */
  private async loadRulesFromDisk(): Promise<WorkflowRule[]> {
    const rules: WorkflowRule[] = [];

    try {
      const dirEntries = await fsPromises.readdir(this.rulesDirectory, {
        withFileTypes: true,
      });

      const files = dirEntries.filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith('.yaml') ||
            entry.name.endsWith('.yml') ||
            entry.name.endsWith('.json')),
      );

      let ruleIndex = 0;

      for (const entry of files) {
        const fullPath = path.join(this.rulesDirectory, entry.name);
        const rawContent = await fsPromises.readFile(fullPath, 'utf8');

        if (!rawContent.trim()) {
          continue;
        }

        let parsed: unknown;

        try {
          if (entry.name.endsWith('.json')) {
            parsed = JSON.parse(rawContent);
          } else {
            parsed = yaml.load(rawContent);
          }
        } catch (parseError: any) {
          this.logger.error(
            `Failed to parse workflow file ${fullPath}: ${
              parseError?.message ?? parseError
            }`,
          );
          continue;
        }

        const rawRules = Array.isArray(parsed) ? parsed : [parsed];

        for (const rawRule of rawRules) {
          if (!rawRule || typeof rawRule !== 'object') {
            continue;
          }

          const normalised = this.normaliseRawRule(
            rawRule as Record<string, unknown>,
            fullPath,
            ruleIndex++,
          );

          rules.push(normalised);
        }
      }
    } catch (error: any) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.logger.warn(
          `Workflow rules directory does not exist: ${this.rulesDirectory}. No workflow rules loaded.`,
        );
        return [];
      }
      throw error;
    }

    return rules;
  }

  /**
   * Normalise a raw rule object (as parsed from YAML/JSON) into a WorkflowRule.
   */
  private normaliseRawRule(
    raw: Record<string, unknown>,
    sourceFile: string,
    index: number,
  ): WorkflowRule {
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
    const id = rawId || `${path.basename(sourceFile)}#${index}`;

    const rawVersion = typeof raw.version === 'string' ? raw.version.trim() : '';
    const version = rawVersion || '0.0.0';

    const description =
      typeof raw.description === 'string' ? raw.description.trim() : undefined;

    const enabled =
      typeof raw.enabled === 'boolean' ? raw.enabled : true;

    const rawMatch = (raw.match ?? {}) as Record<string, unknown>;
    const match = this.normaliseMatchCriteria(rawMatch);

    const rawActions = Array.isArray(raw.actions)
      ? (raw.actions as unknown[])
      : [];
    const actions = rawActions.map((a) => this.normaliseAction(a));

    return {
      id,
      version,
      description,
      enabled,
      match,
      actions,
      sourceFile,
    };
  }

  private normaliseMatchCriteria(
    raw: Record<string, unknown>,
  ): WorkflowMatchCriteria {
    const source = this.normaliseEventSource(raw.source);

    const type =
      typeof raw.type === 'string' && raw.type.trim().length > 0
        ? raw.type.trim()
        : undefined;

    const category = this.normaliseCategory(raw.category);
    const severity = this.normaliseSeverity(raw.severity);
    const labelBase = this.normaliseLabelBase(raw.label_base ?? raw.labelBase);

    const labelPrefix =
      typeof (raw.label_prefix ?? raw.labelPrefix) === 'string'
        ? String(raw.label_prefix ?? raw.labelPrefix)
        : undefined;

    const keywordsAny = this.normaliseStringArray(
      (raw.keywords_any ?? raw.keywordsAny) as unknown,
    );
    const keywordsAll = this.normaliseStringArray(
      (raw.keywords_all ?? raw.keywordsAll) as unknown,
    );

    const metadata =
      raw.metadata && typeof raw.metadata === 'object'
        ? (raw.metadata as Record<string, unknown>)
        : undefined;

    return {
      source,
      type,
      category,
      severity,
      labelBase,
      labelPrefix,
      keywordsAny,
      keywordsAll,
      metadata,
    };
  }

  private normaliseAction(raw: unknown): WorkflowAction {
    if (!raw || typeof raw !== 'object') {
      return { type: 'UNKNOWN' };
    }

    const obj = raw as Record<string, unknown>;
    const rawType = typeof obj.type === 'string' ? obj.type : 'UNKNOWN';
    const type = rawType.toUpperCase();

    return {
      ...obj,
      type,
    };
  }

  private normaliseStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const result = value
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);

    return result.length > 0 ? result : undefined;
  }

  private normaliseLabelBase(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const asString =
      typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : undefined;

    if (!asString) {
      return undefined;
    }

    const parsed = Number.parseInt(asString, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private normaliseEventSource(value: unknown): WorkflowEventSource | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const upper = value.toUpperCase();
    const match = WORKFLOW_EVENT_SOURCES.find(
      (s) => s.toUpperCase() === upper,
    );

    return match;
  }

  private normaliseCategory(value: unknown): TaskCategory | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const lower = value.toLowerCase();
    const match = TASK_CATEGORIES.find((c) => c.toLowerCase() === lower);

    return match;
  }

  private normaliseSeverity(value: unknown): TaskSeverity | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const upper = value.toUpperCase();
    const match = TASK_SEVERITIES.find((s) => s === upper);

    return match;
  }

  /**
   * Core matching logic for a single rule against a given context.
   */
  private ruleMatches(rule: WorkflowRule, context: WorkflowContext): boolean {
    const { match } = rule;

    if (match.source) {
      const ctxSource = this.normaliseEventSource(context.source);
      if (!ctxSource || ctxSource !== match.source) {
        return false;
      }
    }

    if (match.type) {
      if (!context.type || context.type !== match.type) {
        return false;
      }
    }

    if (match.category) {
      const ctxCategory = this.normaliseCategory(context.category);
      if (!ctxCategory || ctxCategory !== match.category) {
        return false;
      }
    }

    if (match.severity) {
      const ctxSeverity = this.normaliseSeverity(context.severity);
      if (!ctxSeverity || ctxSeverity !== match.severity) {
        return false;
      }
    }

    if (typeof match.labelBase === 'number') {
      const ctxLabelBase = this.extractLabelBase(context.label);
      if (ctxLabelBase === undefined || ctxLabelBase !== match.labelBase) {
        return false;
      }
    }

    if (match.labelPrefix) {
      if (!context.label || !context.label.startsWith(match.labelPrefix)) {
        return false;
      }
    }

    const haystack = this.buildSearchableText(context);

    if (match.keywordsAny && match.keywordsAny.length > 0) {
      const anyMatched = match.keywordsAny.some((kw) =>
        haystack.includes(kw.toLowerCase()),
      );
      if (!anyMatched) {
        return false;
      }
    }

    if (match.keywordsAll && match.keywordsAll.length > 0) {
      const allMatched = match.keywordsAll.every((kw) =>
        haystack.includes(kw.toLowerCase()),
      );
      if (!allMatched) {
        return false;
      }
    }

    // metadata-based matching can be added here in future without changing the public API.
    return true;
  }

  private extractLabelBase(label: string | undefined): number | undefined {
    if (!label) {
      return undefined;
    }

    const [basePart] = label.split('.', 1);
    const parsed = Number.parseInt(basePart, 10);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /**
   * Build a lowercase concatenated text representation used for keyword matching.
   */
  private buildSearchableText(context: WorkflowContext): string {
    const parts: string[] = [];

    if (context.title) {
      parts.push(context.title);
    }

    if (context.description) {
      parts.push(context.description);
    }

    if (context.emailSubject) {
      parts.push(context.emailSubject);
    }

    if (context.emailTextBody) {
      parts.push(context.emailTextBody);
    }

    if (context.metadata) {
      try {
        parts.push(JSON.stringify(context.metadata));
      } catch {
        // ignore serialization errors
      }
    }

    if (context.payload) {
      try {
        parts.push(JSON.stringify(context.payload));
      } catch {
        // ignore serialization errors
      }
    }

    return parts.join(' ').toLowerCase();
  }

  /**
   * Internal validator for WorkflowRule objects.
   */
  private internalValidateRules(
    rules: WorkflowRule[],
  ): { valid: boolean; ruleErrors: WorkflowRuleValidationError[] } {
    const errors: WorkflowRuleValidationError[] = [];

    for (const rule of rules) {
      if (!rule.id || rule.id.trim().length === 0) {
        errors.push({
          ruleId: rule.id,
          sourceFile: rule.sourceFile,
          message: 'Rule id is required',
          path: 'id',
        });
      }

      if (!rule.version || rule.version.trim().length === 0) {
        errors.push({
          ruleId: rule.id,
          sourceFile: rule.sourceFile,
          message: 'Rule version is required',
          path: 'version',
        });
      }

      if (!rule.actions || rule.actions.length === 0) {
        errors.push({
          ruleId: rule.id,
          sourceFile: rule.sourceFile,
          message: 'Rule must have at least one action',
          path: 'actions',
        });
      }

      if (rule.match.category && !TASK_CATEGORIES.includes(rule.match.category)) {
        errors.push({
          ruleId: rule.id,
          sourceFile: rule.sourceFile,
          message: `Invalid category '${rule.match.category}'`,
          path: 'match.category',
        });
      }

      if (rule.match.severity && !TASK_SEVERITIES.includes(rule.match.severity)) {
        errors.push({
          ruleId: rule.id,
          sourceFile: rule.sourceFile,
          message: `Invalid severity '${rule.match.severity}'`,
          path: 'match.severity',
        });
      }

      if (rule.match.source && !WORKFLOW_EVENT_SOURCES.includes(rule.match.source)) {
        errors.push({
          ruleId: rule.id,
          sourceFile: rule.sourceFile,
          message: `Invalid source '${rule.match.source}'`,
          path: 'match.source',
        });
      }

      rule.actions.forEach((action, index) => {
        const type = typeof action.type === 'string' ? action.type : 'UNKNOWN';

        if (!WORKFLOW_ACTION_TYPES.includes(type as WorkflowActionType)) {
          errors.push({
            ruleId: rule.id,
            sourceFile: rule.sourceFile,
            message: `Unknown action type '${type}'`,
            path: `actions[${index}].type`,
          });
        }

        if (type === 'CREATE_TASK') {
          if (typeof action.set !== 'object' || action.set === null) {
            errors.push({
              ruleId: rule.id,
              sourceFile: rule.sourceFile,
              message: 'CREATE_TASK action must have a non-empty "set" object',
              path: `actions[${index}].set`,
            });
          }
        }

        if (type === 'ROUTE') {
          if (
            typeof action.to_role !== 'string' &&
            typeof (action as any).toRole !== 'string'
          ) {
            errors.push({
              ruleId: rule.id,
              sourceFile: rule.sourceFile,
              message:
                'ROUTE action must specify "to_role" (or "toRole") as a string',
              path: `actions[${index}].to_role`,
            });
          }
        }

        if (type === 'NOTIFY') {
          if (typeof action.channel !== 'string') {
            errors.push({
              ruleId: rule.id,
              sourceFile: rule.sourceFile,
              message: 'NOTIFY action must specify "channel" as a string',
              path: `actions[${index}].channel`,
            });
          }
        }
      });
    }

    return {
      valid: errors.length === 0,
      ruleErrors: errors,
    };
  }
}
