import { Injectable, Logger } from '@nestjs/common';

export type MetadataEntity = 'task' | 'case';

export interface NormalizeMetadataResult {
  /**
   * Sanitized metadata object that is safe to persist in tasks.metadata / cases.metadata.
   */
  metadata: Record<string, unknown>;
  /**
   * Top-level keys that were removed during normalization.
   */
  removedKeys: string[];
  /**
   * Human-readable explanations of normalization steps that dropped or changed values.
   */
  warnings: string[];
}

/**
 * Keys that must never be accepted from external payloads because they can
 * mutate Object.prototype or otherwise cause prototype pollution.
 */
const PROTOTYPE_POLLUTION_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype']);

/**
 * Canonical Task fields and common aliases that must not appear inside tasks.metadata.
 * Based on the canonical Task JSON contract and DB schema.
 */
const TASK_RESERVED_METADATA_KEYS = new Set<string>([
  // Identifiers
  'task_id',
  'id',
  'taskId',
  'organization_id',
  'organizationId',
  'org_id',
  'orgId',
  'case_id',
  'caseId',

  // Timestamps
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',

  // Classification
  'type',
  'category',
  'subtype',
  'label',

  // Core state
  'status',
  'priority',
  'severity',
  'visibility',
  'source',

  // Actors / routing
  'title',
  'description',
  'created_by_user_id',
  'createdByUserId',
  'requester_person_id',
  'requesterPersonId',
  'owner_role_id',
  'ownerRoleId',
  'owner_user_id',
  'ownerUserId',
  'assignee_role',
  'assigneeRole',

  // SLA / escalation
  'due_at',
  'dueAt',
  'reactivity_time',
  'reactivityTime',
  'reactivity_deadline_at',
  'reactivityDeadlineAt',
  'escalation_level',
  'escalationLevel',
  'closed_at',
  'closedAt',

  // Nested metadata container itself
  'metadata',
]);

/**
 * Canonical Case fields and common aliases that must not appear inside cases.metadata.
 * Based on the canonical Case JSON contract and DB schema.
 */
const CASE_RESERVED_METADATA_KEYS = new Set<string>([
  // Identifiers
  'case_id',
  'id',
  'caseId',
  'organization_id',
  'organizationId',
  'org_id',
  'orgId',

  // Source
  'source_type',
  'sourceType',
  'source_reference',
  'sourceReference',

  // Core fields
  'label',
  'title',
  'description',
  'status',
  'severity',

  // SLA / routing
  'reactivity_time',
  'reactivityTime',
  'origin_vertical_level',
  'originVerticalLevel',
  'origin_role',
  'originRole',

  // Collections
  'tags',
  'location',

  // Nested metadata container itself
  'metadata',

  // Timestamps
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
]);

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  /**
   * Normalizes free-form metadata to a JSON-safe, canonical shape and strips
   * out any fields that would conflict with canonical Task/Case fields
   * or introduce unsafe keys.
   *
   * Default entity is "task" to match the primary use in Core Services.
   */
  normalizeMetadata(
    raw: unknown,
    entity: MetadataEntity = 'task',
  ): NormalizeMetadataResult {
    const removedKeys: string[] = [];
    const warnings: string[] = [];

    if (raw == null) {
      // Nothing to normalize.
      return { metadata: {}, removedKeys, warnings };
    }

    if (Array.isArray(raw) || typeof raw !== 'object') {
      warnings.push(
        `Expected metadata to be an object for ${entity}, received ${
          Array.isArray(raw) ? 'array' : typeof raw
        }; dropping value.`,
      );
      this.logDiagnostics(entity, removedKeys, warnings);
      return { metadata: {}, removedKeys, warnings };
    }

    const input = raw as Record<string, unknown>;
    const metadata = this.normalizeMetadataObject(input, entity, 0, removedKeys, warnings);

    this.logDiagnostics(entity, removedKeys, warnings);
    return { metadata, removedKeys, warnings };
  }

  private normalizeMetadataObject(
    input: Record<string, unknown>,
    entity: MetadataEntity,
    depth: number,
    removedKeys: string[],
    warnings: string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const reservedKeys = this.getReservedKeys(entity);

    for (const [key, value] of Object.entries(input)) {
      if (!key) {
        removedKeys.push(key);
        warnings.push('Removed empty metadata key.');
        continue;
      }

      if (this.isPrototypePollutionKey(key)) {
        removedKeys.push(key);
        warnings.push(
          `Removed unsafe metadata key "${key}" to prevent prototype pollution.`,
        );
        continue;
      }

      // Only enforce canonical field conflicts at the top level of metadata.
      if (depth === 0 && reservedKeys.has(key)) {
        removedKeys.push(key);
        warnings.push(
          `Removed metadata key "${key}" because it conflicts with a canonical ${entity} field.`,
        );
        continue;
      }

      const normalizedValue = this.normalizeMetadataValue(
        value,
        entity,
        depth + 1,
        removedKeys,
        warnings,
      );

      if (normalizedValue !== undefined) {
        result[key] = normalizedValue;
      }
    }

    return result;
  }

  private normalizeMetadataValue(
    value: unknown,
    entity: MetadataEntity,
    depth: number,
    removedKeys: string[],
    warnings: string[],
  ): unknown {
    if (value === undefined) {
      // undefined is not valid JSON; drop it.
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const valueType = typeof value;

    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      const normalizedArray: unknown[] = [];

      for (const item of value) {
        const normalizedItem = this.normalizeMetadataValue(
          item,
          entity,
          depth + 1,
          removedKeys,
          warnings,
        );

        if (normalizedItem !== undefined) {
          normalizedArray.push(normalizedItem);
        }
      }

      return normalizedArray;
    }

    if (valueType === 'object') {
      return this.normalizeMetadataObject(
        value as Record<string, unknown>,
        entity,
        depth,
        removedKeys,
        warnings,
      );
    }

    // Drop functions, symbols, bigint, etc.
    warnings.push(
      `Dropping non-serializable metadata value of type "${typeof value}" at depth ${depth}.`,
    );
    return undefined;
  }

  private getReservedKeys(entity: MetadataEntity): ReadonlySet<string> {
    return entity === 'case' ? CASE_RESERVED_METADATA_KEYS : TASK_RESERVED_METADATA_KEYS;
  }

  private isPrototypePollutionKey(key: string): boolean {
    return PROTOTYPE_POLLUTION_KEYS.has(key);
  }

  private logDiagnostics(
    entity: MetadataEntity,
    removedKeys: string[],
    warnings: string[],
  ): void {
    if (!removedKeys.length && !warnings.length) {
      return;
    }

    const summaryParts: string[] = [];

    if (removedKeys.length) {
      summaryParts.push(`removedKeys=[${removedKeys.join(', ')}]`);
    }

    if (warnings.length) {
      summaryParts.push(`warnings=${warnings.length}`);
    }

    this.logger.debug(
      `Metadata normalization for ${entity}: ${summaryParts.join(' ')}.`,
    );

    for (const warning of warnings) {
      this.logger.debug(`Metadata normalization warning: ${warning}`);
    }
  }
}
