// apps/api/src/orgo/domain/domain-task.factory.ts

import { Injectable } from '@nestjs/common';
import {
  TaskDto as CoreTaskDto,
  TaskStatus,
  TaskPriority,
  TaskSeverity,
  TaskVisibility,
  TaskSource,
} from '../core/tasks/task.service';

/**
 * DomainTask – domain-centric projection of a canonical Task.
 *
 * Shape and mapping rules are defined in Doc 3 (Domain Modules / DomainTask model).
 * This interface is intentionally close to the Python sketch in the spec:
 *
 *   - domain      == Task.type
 *   - category    == Task.category
 *   - subtype     == Task.subtype
 *   - label       == Task.label
 *   - status      == Task.status
 *   - priority    == Task.priority
 *   - severity    == Task.severity
 *   - visibility  == Task.visibility
 *   - case_id     == Task.caseId
 *
 * NB : cette vue reste read-only vis-à-vis de la couche Core/DB.
 */
export interface DomainTask {
  task_id: string;
  organization_id: string;

  domain: string; // Task.type
  category: string; // Task.category
  subtype: string | null; // Task.subtype

  label: string; // Task.label

  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: TaskVisibility;
  source: TaskSource;

  title: string;
  description: string;

  case_id: string | null;

  created_at: string;
  updated_at: string;

  /**
   * Champs d’ownership / acteurs, alignés sur TaskDto (camelCase).
   * Ces champs sont directement mappés depuis le Task canonique.
   */
  createdByUserId: string | null;
  requesterPersonId: string | null;
  ownerRoleId: string | null;
  ownerUserId: string | null;
  assigneeRole: string | null;

  /**
   * Champs SLA / échéances, alignés sur TaskDto (camelCase).
   */
  dueAt: string | null;
  reactivityTime: string | null;
  reactivityDeadlineAt: string | null;
  escalationLevel: number;
  closedAt: string | null;

  /**
   * Current + historical assignee user ids (where known).
   * In this v3 implementation, this is primarily derived from:
   *   - Task.ownerUserId (canonical owner)
   * plus any explicit IDs provided by the caller from assignment history.
   */
  assignee_user_ids: string[];

  /**
   * Current + historical routing roles (human-readable, e.g. "Ops.Maintenance").
   * In this v3 implementation, this is primarily derived from:
   *   - Task.assigneeRole (denormalised routing role)
   * plus any explicit roles provided by the caller.
   */
  assignee_roles: string[];

  /**
   * Classification labels (codes) attached to this Task, e.g.
   *   ["self_harm_risk", "equipment_failure"].
   * Populated from entity_labels / label_definitions by callers.
   */
  classification_labels: string[];

  /**
   * Domain-specific metadata view.
   *
   * The recommended flow (per Doc 3):
   *   - Domain handler's get_domain_fields(...) computes a curated view
   *     for the specific domain.
   *   - That view is passed as metadataOverride to this factory.
   *
   * If no override is provided, the canonical Task.metadata is exposed.
   */
  metadata: Record<string, any>;
}

/**
 * Input to DomainTaskFactory.createDomainTask.
 *
 * This keeps the factory focused on projection/mapping and leaves
 * data access (tasks, assignments, labels, domain handler calls)
 * to higher-level services.
 */
export interface DomainTaskFactoryInput {
  /**
   * Canonical Task DTO from TaskService.
   * This is the logical Task view used by Core Services.
   */
  task: CoreTaskDto;

  /**
   * Optional list of assignee user IDs, typically assembled from:
   *   - task_assignments history
   *   - other domain-specific assignment sources
   *
   * If omitted, the factory will still include task.ownerUserId where present.
   */
  assigneeUserIds?: string[];

  /**
   * Optional list of assignee routing roles, typically assembled from:
   *   - task_assignments history
   *   - other domain-specific assignment sources
   *
   * If omitted, the factory will still include task.assigneeRole where present.
   */
  assigneeRoles?: string[];

  /**
   * Classification labels attached to this Task, usually loaded from
   * entity_labels / label_definitions for the "task" entity type.
   */
  classificationLabels?: string[];

  /**
   * Curated domain-specific metadata view.
   *
   * Recommended source: domain handler's get_domain_fields(ctx, task_id).
   * If omitted, Task.metadata will be used as-is.
   */
  metadataOverride?: Record<string, any>;
}

/**
 * DomainTaskFactory
 *
 * Generic, DB-agnostic factory that turns a canonical Task DTO plus
 * domain-specific context (assignments, labels, curated metadata)
 * into a DomainTask view.
 */
@Injectable()
export class DomainTaskFactory {
  /**
   * Construct a DomainTask projection from a canonical Task DTO and
   * optional domain context.
   */
  createDomainTask(input: DomainTaskFactoryInput): DomainTask {
    const {
      task,
      assigneeUserIds,
      assigneeRoles,
      classificationLabels,
      metadataOverride,
    } = input;

    const assigneeUserIdSet = new Set<string>();
    const assigneeRoleSet = new Set<string>();

    // Seed from explicit inputs (e.g. from task_assignments).
    if (Array.isArray(assigneeUserIds)) {
      for (const id of assigneeUserIds) {
        if (id) {
          assigneeUserIdSet.add(String(id));
        }
      }
    }

    if (Array.isArray(assigneeRoles)) {
      for (const role of assigneeRoles) {
        const trimmed = typeof role === 'string' ? role.trim() : '';
        if (trimmed) {
          assigneeRoleSet.add(trimmed);
        }
      }
    }

    // Add current canonical owner/assignee from the Task itself.
    if (task.ownerUserId) {
      assigneeUserIdSet.add(String(task.ownerUserId));
    }

    if (task.assigneeRole) {
      const trimmed = String(task.assigneeRole).trim();
      if (trimmed) {
        assigneeRoleSet.add(trimmed);
      }
    }

    const classification = Array.isArray(classificationLabels)
      ? Array.from(
          new Set(
            classificationLabels
              .filter((label) => typeof label === 'string')
              .map((label) => label.trim())
              .filter((label) => label.length > 0),
          ),
        )
      : [];

    const metadata =
      metadataOverride && typeof metadataOverride === 'object'
        ? metadataOverride
        : task.metadata ?? {};

    return {
      task_id: task.taskId,
      organization_id: task.organizationId,

      domain: task.type,
      category: task.category,
      subtype: task.subtype,

      label: task.label,

      status: task.status,
      priority: task.priority,
      severity: task.severity,
      visibility: task.visibility,
      source: task.source,

      title: task.title,
      description: task.description,

      case_id: task.caseId,

      created_at: task.createdAt,
      updated_at: task.updatedAt,

      createdByUserId: task.createdByUserId,
      requesterPersonId: task.requesterPersonId,
      ownerRoleId: task.ownerRoleId,
      ownerUserId: task.ownerUserId,
      assigneeRole: task.assigneeRole,

      dueAt: task.dueAt,
      reactivityTime: task.reactivityTime,
      reactivityDeadlineAt: task.reactivityDeadlineAt,
      escalationLevel: task.escalationLevel,
      closedAt: task.closedAt,

      assignee_user_ids: Array.from(assigneeUserIdSet),
      assignee_roles: Array.from(assigneeRoleSet),
      classification_labels: classification,
      metadata,
    };
  }
}
