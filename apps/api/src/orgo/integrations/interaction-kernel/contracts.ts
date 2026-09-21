import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../../platform/contracts';

export const IK_SPEC_VERSION = 'ik/1.1' as const;
export const IK_FINGERPRINT_PROFILE = 'ik.request-fingerprint/jcs-rfc8785+sha256/v1' as const;

const participant = z.object({
  system: z.string().min(1).max(120),
  instance: z.string().max(200).nullable().optional(),
  organization: z.string().max(200).nullable().optional(),
  world: z.string().max(200).nullable().optional(),
  release: z.string().max(200).nullable().optional(),
}).strict();
const profileRef = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,159}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
}).strict();
const subjectRef = z.object({ type: z.string().min(1).max(120), id: z.string().min(1).max(500) }).strict();
const artifactRef = z.object({
  owner: participant,
  artifact_type: z.string().min(1).max(200),
  artifact_id: z.string().min(1).max(1000),
  version: z.string().max(200).nullable().optional(),
  integrity: z.object({ algorithm: z.literal('sha256'), digest: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/) }).strict().nullable().optional(),
  locator: z.object({ ref: z.string().min(1).max(2000) }).strict().nullable().optional(),
  content: z.record(z.unknown()).nullable().optional(),
  scope: z.record(z.unknown()).nullable().optional(),
  provenance: z.record(z.unknown()).nullable().optional(),
  access: z.record(z.unknown()).nullable().optional(),
}).strict();

export const interactionEnvelope = z.object({
  specversion: z.literal(IK_SPEC_VERSION),
  id: z.string().min(8).max(200),
  class: z.enum(['command', 'query', 'event']),
  time: z.string().datetime({ offset: true }),
  profile: profileRef,
  source: participant,
  target: participant.optional(),
  subject: subjectRef,
  operation: z.string().max(160).nullable().optional(),
  correlation_id: z.string().min(1).max(500).nullable().optional(),
  causation_id: z.string().max(500).nullable().optional(),
  idempotency_key: z.string().min(1).max(500).nullable().optional(),
  authority: z.object({
    kind: z.string().min(1).max(120),
    claims: z.array(z.string().max(1000)).max(100).optional(),
    context: z.record(z.unknown()).optional(),
  }).strict().nullable().optional(),
  data_schema: z.string().max(2000).nullable().optional(),
  data: z.unknown().optional(),
  artifact_refs: z.array(artifactRef).max(1000).default([]),
  governance: z.record(z.unknown()).nullable().optional(),
  response: z.record(z.unknown()).nullable().optional(),
  trace: z.record(z.unknown()).nullable().optional(),
  evidence: z.array(z.string().max(2000)).nullable().optional(),
  extensions: z.record(z.unknown()).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.class === 'command' || value.class === 'query') && !value.target)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: 'Durable command/query requires a concrete target' });
});
export type InteractionEnvelope = z.infer<typeof interactionEnvelope>;

export const decisionExecuteData = z.object({
  decision_revision: z.string().min(1).max(200),
  effective_at: z.string().datetime({ offset: true }).nullable().optional(),
  execution_scope: z.record(z.unknown()).nullable().optional(),
}).strict();

function assertIJsonString(value: string) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new DomainError('IK_INVALID_IJSON', 'Unpaired high surrogate', 400);
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff)
      throw new DomainError('IK_INVALID_IJSON', 'Unpaired low surrogate', 400);
  }
}
export function ikCanonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') { assertIJsonString(value); return JSON.stringify(value); }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DomainError('IK_INVALID_IJSON', 'Non-finite number', 400);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(ikCanonicalize).join(',')}]`;
  if (typeof value === 'object' && value) {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    for (const key of keys) assertIJsonString(key);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${ikCanonicalize(object[key])}`).join(',')}}`;
  }
  throw new DomainError('IK_INVALID_IJSON', 'Unsupported JSON value', 400);
}
export function ikSha256(value: unknown) {
  return createHash('sha256').update(ikCanonicalize(value)).digest('hex');
}
const semanticFields = ['class','profile','source','target','subject','operation','authority','data_schema','data','governance','artifact_refs','evidence'] as const;
export function ikSemanticProjection(envelope: InteractionEnvelope) {
  const source = envelope as unknown as Record<string, unknown>;
  return Object.fromEntries(semanticFields.filter((key) => Object.prototype.hasOwnProperty.call(source, key)).map((key) => [key, source[key]]));
}
export function ikRequestFingerprint(envelope: InteractionEnvelope) {
  return `sha256:${ikSha256(ikSemanticProjection(envelope))}`;
}
export function ikReceipt(input: {
  interactionId: string;
  organizationId: string;
  correlationId?: string | null;
  status: 'accepted' | 'rejected' | 'blocked' | 'succeeded' | 'failed';
  code?: string | null;
  retryable?: boolean;
  externalReference?: string | null;
  data?: Record<string, unknown>;
}) {
  return {
    specversion: IK_SPEC_VERSION,
    record_type: 'receipt' as const,
    id: randomUUID(),
    time: new Date().toISOString(),
    interaction_id: input.interactionId,
    source: { system: 'orgo', organization: input.organizationId },
    status: input.status,
    code: input.code ?? null,
    retryable: input.retryable ?? false,
    external_reference: input.externalReference ?? null,
    data: input.data ?? {},
    correlation_id: input.correlationId ?? null,
  };
}
