import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details: unknown = {},
  ) {
    super(message);
  }
}
export interface WorkGrant {
  scope_type: string;
  scope_reference: string;
  role_id: string;
  permissions: readonly string[];
}
export interface ExecutionContext {
  workGrants?: readonly WorkGrant[];
  organizationId: string;
  actorUserId: string | null;
  apiTokenId?: string;
  actorType: 'user' | 'system';
  permissions: readonly string[];
  roleIds: readonly string[];
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  source: 'api' | 'manual' | 'email' | 'sync';
}
export function requirePermission(ctx: ExecutionContext, permission: string) {
  if (
    !ctx.organizationId ||
    !(ctx.permissions.includes('*') || ctx.permissions.includes(permission))
  ) {
    throw new DomainError(
      'FORBIDDEN',
      `Permission required: ${permission}`,
      403,
    );
  }
}
export const uuid = z.string().uuid();
export const text = z.string().trim().min(1).max(500);
export const metadata = z.record(z.unknown()).default({});
export const source = z.enum(['email', 'api', 'manual', 'sync']);
export const taskStatus = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'FAILED',
  'ESCALATED',
  'CANCELLED',
]);
export const caseStatus = z.enum([
  'open',
  'in_progress',
  'resolved',
  'archived',
]);
export const severity = z.enum(['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL']);
export const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const visibility = z.enum([
  'PUBLIC',
  'INTERNAL',
  'RESTRICTED',
  'ANONYMISED',
]);
export const category = z.enum([
  'request',
  'incident',
  'update',
  'report',
  'distribution',
]);
export const label = z
  .string()
  .regex(/^[1-9]\d*\.[1-9][1-5](?:\.[A-Za-z0-9]+)*$/, 'Invalid Orgo label');
export function isBroadcast(value: string) {
  return [10, 100, 1000].includes(Number(value.split('.')[0]));
}
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}
export function hash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function correlation(value?: string) {
  return value && /^[\w.-]{1,128}$/.test(value) ? value : randomUUID();
}
export function parse<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError(
      'VALIDATION_ERROR',
      'Invalid request',
      400,
      result.error.flatten(),
    );
  return result.data;
}
export const pageQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().max(200).optional(),
    status: z.string().max(30).optional(),
    case_id: uuid.optional(),
    mine: z.enum(['true', 'false']).optional(),
  })
  .strict();

const taskTransitions: Record<string, readonly string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'FAILED', 'ESCALATED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  ESCALATED: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};
const caseTransitions: Record<string, readonly string[]> = {
  open: ['in_progress', 'resolved', 'archived'],
  in_progress: ['resolved', 'archived'],
  resolved: ['in_progress', 'archived'],
  archived: [],
};
export function transition(kind: 'task' | 'case', from: string, to: string) {
  if (
    !(kind === 'task' ? taskTransitions : caseTransitions)[from]?.includes(to)
  ) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `${kind}: ${from} → ${to} is not allowed`,
      409,
    );
  }
}
export const terminalTask = (status: string) =>
  ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status);
