// apps/api/src/orgo/core/validation/payload-validation.pipe.ts

import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import * as Joi from 'joi';

type ObjectSchema = Joi.ObjectSchema;

export type LogicalPayloadType =
  | 'task'
  | 'case'
  | 'email'
  | 'workflow_rule'
  | 'notification'
  | 'config'
  | 'generic';

export interface PayloadValidationOptions {
  /**
   * Logical payload type to drive default schemas and enum normalisation.
   * If a custom schema is provided, this is only used for error codes and enum mapping.
   */
  logicalType?: LogicalPayloadType;

  /**
   * Allow unknown keys when validating with Joi.
   * Defaults to true (unknown keys are allowed).
   */
  allowUnknown?: boolean;

  /**
   * Strip unknown keys from the validated payload.
   * Defaults to true (unknown keys are removed).
   */
  stripUnknown?: boolean;

  /**
   * Optional custom error code to emit instead of the default type‑specific one.
   */
  customErrorCode?: string;
}

/**
 * Canonical enum values (service‑side) – aligned with Docs 2, 5 and 8.
 * JSON inputs may use lower‑case variants; this pipe normalises to these tokens.
 */
const TASK_STATUS_VALUES = [
  'PENDING',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'FAILED',
  'ESCALATED',
  'CANCELLED',
] as const;

const TASK_PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const TASK_SEVERITY_VALUES = ['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'] as const;

const VISIBILITY_VALUES = ['PUBLIC', 'INTERNAL', 'RESTRICTED', 'ANONYMISED'] as const;

const CASE_STATUS_VALUES = [
  'open',
  'in_progress',
  'resolved',
  'archived',
] as const;

const TASK_SOURCE_VALUES = ['email', 'api', 'manual', 'sync'] as const;

const ENVIRONMENT_VALUES = ['dev', 'staging', 'prod', 'offline'] as const;

/**
 * Default Joi schema for canonical Task JSON payloads
 * (Doc 5 – Task Handler, Doc 8 – Task JSON schema).
 *
 * This is intentionally focused on core fields; domain‑specific metadata
 * lives under `metadata` and is validated separately if needed.
 */
const TASK_PAYLOAD_SCHEMA: ObjectSchema = Joi.object({
  task_id: Joi.string().optional(), // usually set by the system
  organization_id: Joi.string().required(),
  case_id: Joi.string().optional().allow(null),

  source: Joi.string()
    .valid(...TASK_SOURCE_VALUES)
    .required(),

  type: Joi.string().required(), // e.g. "maintenance", "hr_case"
  category: Joi.string()
    .valid('request', 'incident', 'update', 'report', 'distribution')
    .required(),
  subtype: Joi.string().optional().allow(null),

  label: Joi.string().required(), // "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"
  title: Joi.string().max(512).required(),
  description: Joi.string().required(),

  status: Joi.string()
    .valid(...TASK_STATUS_VALUES)
    .optional(), // default = PENDING inside the Task handler

  priority: Joi.string()
    .valid(...TASK_PRIORITY_VALUES)
    .required(),
  severity: Joi.string()
    .valid(...TASK_SEVERITY_VALUES)
    .required(),
  visibility: Joi.string()
    .valid(...VISIBILITY_VALUES)
    .required(),

  assignee_role: Joi.string().optional().allow(null),
  created_by_user_id: Joi.string().optional().allow(null),
  requester_person_id: Joi.string().optional().allow(null),
  owner_role_id: Joi.string().optional().allow(null),
  owner_user_id: Joi.string().optional().allow(null),

  due_at: Joi.string().optional().allow(null),
  reactivity_time: Joi.string().optional().allow(null),
  reactivity_deadline_at: Joi.string().optional().allow(null),
  escalation_level: Joi.number().integer().min(0).optional(),
  closed_at: Joi.string().optional().allow(null),

  metadata: Joi.object().default({}),
});

/**
 * Default Joi schema for canonical Case JSON payloads
 * (Doc 8 – Case JSON schema).
 */
const CASE_PAYLOAD_SCHEMA: ObjectSchema = Joi.object({
  case_id: Joi.string().optional(), // usually set by the system
  organization_id: Joi.string().required(),

  source_type: Joi.string()
    .valid(...TASK_SOURCE_VALUES)
    .required(),
  source_reference: Joi.string().optional().allow(null),

  label: Joi.string().required(),
  title: Joi.string().max(512).required(),
  description: Joi.string().required(),

  status: Joi.string()
    .valid(...CASE_STATUS_VALUES)
    .optional(), // default = "open" in the Case service

  // Uses the same severity enum as Tasks, but normalised to uppercase internally.
  severity: Joi.string()
    .valid(...TASK_SEVERITY_VALUES)
    .required(),

  reactivity_time: Joi.string().optional().allow(null),
  origin_vertical_level: Joi.number().integer().optional().allow(null),
  origin_role: Joi.string().optional().allow(null),

  tags: Joi.array().items(Joi.string()).optional().allow(null),
  location: Joi.object().optional().allow(null),
  metadata: Joi.object().required(),

  created_at: Joi.string().optional().allow(null),
  updated_at: Joi.string().optional().allow(null),
});

@Injectable()
export class PayloadValidationPipe implements PipeTransform {
  private readonly logger = new Logger(PayloadValidationPipe.name);

  constructor(
    private readonly schema?: ObjectSchema,
    private readonly options: PayloadValidationOptions = {},
  ) {}

  /**
   * Factory for Task payload validation.
   */
  static forTaskPayload(
    options: Omit<PayloadValidationOptions, 'logicalType'> = {},
  ): PayloadValidationPipe {
    return new PayloadValidationPipe(TASK_PAYLOAD_SCHEMA, {
      logicalType: 'task',
      ...options,
    });
  }

  /**
   * Factory for Case payload validation.
   */
  static forCasePayload(
    options: Omit<PayloadValidationOptions, 'logicalType'> = {},
  ): PayloadValidationPipe {
    return new PayloadValidationPipe(CASE_PAYLOAD_SCHEMA, {
      logicalType: 'case',
      ...options,
    });
  }

  transform(value: unknown, metadata: ArgumentMetadata): any {
    // Only validate request bodies by default; params/query can use other pipes.
    if (metadata.type && metadata.type !== 'body') {
      return value;
    }

    if (value === null || value === undefined) {
      throw this.buildException('Request body must be a JSON object', []);
    }

    if (typeof value !== 'object') {
      throw this.buildException('Request body must be a JSON object', []);
    }

    const logicalType = this.options.logicalType ?? 'generic';

    // Clone & normalise enums and other canonical fields.
    const normalised = this.normalisePayload(
      Array.isArray(value) ? [...value] : { ...(value as Record<string, any>) },
    );

    const schemaToUse = this.schema ?? this.getDefaultSchema(logicalType);

    if (!schemaToUse) {
      // No schema configured – still return the normalised payload.
      return normalised;
    }

    const allowUnknown =
      this.options.allowUnknown !== undefined ? this.options.allowUnknown : true;
    const stripUnknown =
      this.options.stripUnknown !== undefined ? this.options.stripUnknown : true;

    const { error, value: validated } = schemaToUse.validate(normalised, {
      abortEarly: false,
      allowUnknown,
      stripUnknown,
    });

    if (error) {
      this.logger.error(
        `Payload validation failed for type "${logicalType}": ${error.message}`,
      );
      throw this.buildException('Payload validation failed', error.details);
    }

    return validated;
  }

  /**
   * Returns a default schema for a given logical payload type
   * when no explicit schema is provided in the constructor.
   */
  private getDefaultSchema(type: LogicalPayloadType): ObjectSchema | undefined {
    switch (type) {
      case 'task':
        return TASK_PAYLOAD_SCHEMA;
      case 'case':
        return CASE_PAYLOAD_SCHEMA;
      default:
        return undefined;
    }
  }

  /**
   * Normalise canonical enums and structurally relevant fields
   * according to Docs 2, 5 and 8.
   *
   * It is safe to call recursively on nested objects/arrays.
   */
  private normalisePayload<T = any>(payload: T): T {
    if (payload === null || payload === undefined) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.normalisePayload(item)) as unknown as T;
    }

    if (typeof payload !== 'object') {
      return payload;
    }

    const obj = payload as Record<string, any>;

    for (const key of Object.keys(obj)) {
      const value = obj[key];

      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value) || typeof value === 'object') {
        obj[key] = this.normalisePayload(value);
        continue;
      }

      if (typeof value === 'string') {
        obj[key] = this.normaliseScalarByKey(key, value);
      }
    }

    return obj as T;
  }

  /**
   * Field‑aware normalisation for scalar string values.
   * Handles enum casing, environment values and label trimming.
   */
  private normaliseScalarByKey(key: string, raw: string): string {
    const value = raw.trim();

    switch (key) {
      case 'status': {
        const upper = value.toUpperCase();
        if (TASK_STATUS_VALUES.includes(upper as any)) {
          return upper;
        }
        const lower = value.toLowerCase();
        if (CASE_STATUS_VALUES.includes(lower as any)) {
          return lower;
        }
        return value;
      }

      case 'priority': {
        const upper = value.toUpperCase();
        if (TASK_PRIORITY_VALUES.includes(upper as any)) {
          return upper;
        }
        return value;
      }

      case 'severity': {
        const upper = value.toUpperCase();
        if (TASK_SEVERITY_VALUES.includes(upper as any)) {
          return upper;
        }
        return value;
      }

      case 'visibility': {
        const upper = value.toUpperCase();
        if (VISIBILITY_VALUES.includes(upper as any)) {
          return upper;
        }
        return value;
      }

      case 'environment': {
        const lower = value.toLowerCase();
        if (ENVIRONMENT_VALUES.includes(lower as any)) {
          return lower;
        }
        return value;
      }

      case 'source':
      case 'source_type': {
        const lower = value.toLowerCase();
        if (TASK_SOURCE_VALUES.includes(lower as any)) {
          return lower;
        }
        return value;
      }

      case 'label': {
        // Canonical labels must be whitespace‑trimmed; we do not alter structure here.
        return value;
      }

      default:
        return value;
    }
  }

  /**
   * Build a BadRequestException using the standard result shape
   * (`ok` / `data` / `error`) expected by Core Services.
   */
  private buildException(message: string, details: Joi.ValidationErrorItem[]): BadRequestException {
    const logicalType = this.options.logicalType ?? 'generic';

    const defaultErrorCode = (() => {
      switch (logicalType) {
        case 'task':
          return 'TASK_VALIDATION_ERROR';
        case 'case':
          return 'CASE_VALIDATION_ERROR';
        case 'email':
          return 'EMAIL_VALIDATION_ERROR';
        case 'workflow_rule':
          return 'WORKFLOW_RULE_VALIDATION_ERROR';
        case 'notification':
          return 'NOTIFICATION_PAYLOAD_VALIDATION_ERROR';
        case 'config':
          return 'CONFIG_VALIDATION_ERROR';
        default:
          return 'PAYLOAD_VALIDATION_ERROR';
      }
    })();

    const errorCode = this.options.customErrorCode ?? defaultErrorCode;

    const formattedDetails = details.map((d) => ({
      path: d.path.join('.'),
      message: d.message,
      type: d.type,
      context: d.context,
    }));

    const responseBody = {
      ok: false,
      data: null,
      error: {
        code: errorCode,
        message,
        details: formattedDetails,
      },
    };

    return new BadRequestException(responseBody);
  }
}
