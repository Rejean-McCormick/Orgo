import { z } from 'zod';
import {
  category,
  label,
  metadata,
  priority,
  severity,
  source,
  text,
  uuid,
  visibility,
} from '../../platform/contracts';
export const workInput = z
  .object({
    access_scope_type: z
      .enum(['team', 'location', 'unit', 'custom'])
      .optional(),
    access_scope_reference: z.string().min(1).max(200).optional(),
    title: text,
    description: z.string().max(20000).default(''),
    label,
    severity: severity.default('MODERATE'),
    source: source.default('api'),
    metadata,
    visibility: visibility.default('INTERNAL'),
  })
  .strict();
export const createCaseInput = workInput.extend({
  tags: z.array(text).max(30).default([]),
  location: metadata,
  origin_role: z.string().max(200).default(''),
  origin_vertical_level: z.number().int().min(0).default(0),
});
export const createTaskInput = workInput.extend({
  type: text,
  category,
  subtype: text.optional(),
  case_id: uuid.optional(),
  priority: priority.optional(),
  owner_user_id: uuid.nullable().optional(),
  owner_role_id: uuid.nullable().optional(),
  requester_person_id: uuid.optional(),
  assignee_role: z.string().max(200).nullable().optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
  reactivity_seconds: z.number().int().min(1).max(31536000).optional(),
});
export const assignmentInput = z
  .object({
    owner_user_id: uuid.nullable().optional(),
    owner_role_id: uuid.nullable().optional(),
    assignee_role: z.string().max(200).nullable().optional(),
    reason: z.string().max(2000).optional(),
    revision: z.number().int().min(0),
  })
  .strict();
export type CreateTask = z.infer<typeof createTaskInput>;
export type CreateCase = z.infer<typeof createCaseInput>;
