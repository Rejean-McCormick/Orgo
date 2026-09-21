import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Commands, type Tx } from '../../platform/database';
import { DomainError, type ExecutionContext, parse } from '../../platform/contracts';
import { IntakeService } from '../intake/intake.service';
import { WorkflowService } from '../orchestration/workflow.service';
import {
  decisionExecuteData,
  ikReceipt,
  ikRequestFingerprint,
  ikSemanticProjection,
  interactionEnvelope,
  type InteractionEnvelope,
} from '../../integrations/interaction-kernel/contracts';

const category = z.enum(['request','incident','update','report','distribution']);
const severity = z.enum(['MINOR','MODERATE','MAJOR','CRITICAL']);
const label = z.string().regex(/^[1-9]\d*\.[1-9][1-5](?:\.[A-Za-z0-9]+)*$/);

@Injectable()
export class InteractionKernelService {
  constructor(
    @Inject(Commands) private readonly commands: Commands,
    @Inject(IntakeService) private readonly intake: IntakeService,
    @Inject(WorkflowService) private readonly workflow: WorkflowService,
  ) {}

  private validate(ctx: ExecutionContext, raw: unknown) {
    const envelope = parse(interactionEnvelope, raw);
    if (envelope.class !== 'command' || envelope.profile.id !== 'governance.decision.execute' || envelope.profile.version !== '1.0.0')
      throw new DomainError('IK_UNKNOWN_PROFILE', 'Only governance.decision.execute/1.0.0 is accepted', 422);
    if (envelope.source.system !== 'konnaxion')
      throw new DomainError('IK_UNAUTHORIZED', 'Konnaxion source required', 403);
    if (envelope.target?.system !== 'orgo')
      throw new DomainError('IK_TARGET_NOT_FOUND', 'Orgo target required', 422);
    if (envelope.target.organization && envelope.target.organization !== ctx.organizationId)
      throw new DomainError('IK_TARGET_NOT_FOUND', 'Target organization does not match authenticated tenant', 404);
    if (envelope.subject.type !== 'decision')
      throw new DomainError('IK_INVALID_ENVELOPE', 'subject.type must be decision', 422);
    if (!envelope.idempotency_key)
      throw new DomainError('IK_INVALID_ENVELOPE', 'idempotency_key is required', 400);
    if (ctx.idempotencyKey && ctx.idempotencyKey !== envelope.idempotency_key)
      throw new DomainError('IK_IDEMPOTENCY_CONFLICT', 'Header idempotency key differs from envelope', 409);
    if (envelope.authority?.kind !== 'governance-mandate')
      throw new DomainError('IK_UNAUTHORIZED', 'governance-mandate authority is required', 403);
    if (!envelope.artifact_refs.some((ref) => ref.owner.system === 'konnaxion' && ref.artifact_type === 'konnaxion.decision_record'))
      throw new DomainError('IK_INVALID_ENVELOPE', 'A Konnaxion decision artifact is required', 422);
    const expectedWorld = process.env.ORGO_IK_WORLD?.trim();
    if (expectedWorld && envelope.target.world && envelope.target.world !== expectedWorld)
      throw new DomainError('IK_TARGET_NOT_FOUND', 'Target World does not match configured Orgo routing', 404);
    return { envelope, data: parse(decisionExecuteData, envelope.data ?? {}) };
  }

  private route() {
    const workflowCode = process.env.KONNAXION_DECISION_WORKFLOW_CODE?.trim();
    const rawLabel = process.env.KONNAXION_DECISION_LABEL?.trim();
    if (!workflowCode || !rawLabel)
      throw new DomainError('IK_TARGET_NOT_READY', 'Configure KONNAXION_DECISION_WORKFLOW_CODE and KONNAXION_DECISION_LABEL', 409);
    return {
      workflowCode,
      label: parse(label, rawLabel),
      type: process.env.KONNAXION_DECISION_TYPE?.trim() || 'governance_decision',
      category: parse(category, process.env.KONNAXION_DECISION_CATEGORY?.trim() || 'request'),
      severity: parse(severity, process.env.KONNAXION_DECISION_SEVERITY?.trim() || 'MODERATE'),
    };
  }

  async receive(original: ExecutionContext, raw: unknown) {
    const { envelope, data } = this.validate(original, raw);
    const route = this.route();
    const ctx: ExecutionContext = {
      ...original,
      idempotencyKey: envelope.idempotency_key!,
      correlationId: envelope.correlation_id || original.correlationId,
      source: 'api',
    };
    const semantic = ikSemanticProjection(envelope);
    try {
      return await this.commands.run(ctx, 'ik.governance.decision.execute', semantic, async (tx: Tx) => {
        const version = await this.workflow.activeVersionByCode(ctx, route.workflowCode, tx);
        const signal = await this.intake.accept(ctx, {
          source: 'api',
          external_reference: `konnaxion:decision:${envelope.subject.id}:r${data.decision_revision}`,
          type: route.type,
          category: route.category,
          severity: route.severity,
          label: route.label,
          title: `Governed decision ${envelope.subject.id}`,
          description: `Konnaxion DecisionRecord revision ${data.decision_revision}`,
          payload: {
            interaction_id: envelope.id,
            correlation_id: envelope.correlation_id,
            decision_id: envelope.subject.id,
            decision_revision: data.decision_revision,
            effective_at: data.effective_at ?? null,
            execution_scope: data.execution_scope ?? {},
            source: envelope.source,
            target: envelope.target,
            artifact_refs: envelope.artifact_refs,
            request_fingerprint: ikRequestFingerprint(envelope),
          },
          workflow_version_id: version.id,
        }, tx);
        return ikReceipt({
          interactionId: envelope.id,
          organizationId: ctx.organizationId,
          correlationId: envelope.correlation_id,
          status: 'accepted',
          externalReference: `orgo:signal:${signal.id}`,
          data: {
            signal_id: signal.id,
            workflow_version_id: version.id,
            request_fingerprint: ikRequestFingerprint(envelope),
          },
        });
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'IDEMPOTENCY_CONFLICT')
        throw new DomainError('IK_IDEMPOTENCY_CONFLICT', error.message, 409, error.details);
      throw error;
    }
  }
}
