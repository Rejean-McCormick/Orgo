import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Commands, type Tx } from '../../platform/database';
import { DomainError, type ExecutionContext, parse } from '../../platform/contracts';
import { IntakeService } from '../intake/intake.service';
import { WorkflowService } from '../orchestration/workflow.service';
import { WorkService } from '../work/public';
import {
  decisionExecuteData,
  ikReceipt,
  ikRequestFingerprint,
  ikSemanticProjection,
  interactionEnvelope,
  kristalArtifactReadyData,
  korWorkStatusSubmitData,
  KRISTAL_STANDARD_VERSION,
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
    @Inject(WorkService) private readonly work: WorkService,
  ) {}

  private validateTarget(ctx: ExecutionContext, envelope: InteractionEnvelope) {
    if (envelope.target?.system && envelope.target.system !== 'orgo')
      throw new DomainError('IK_TARGET_NOT_FOUND', 'Orgo target required', 422);
    if (envelope.target?.organization && envelope.target.organization !== ctx.organizationId)
      throw new DomainError('IK_TARGET_NOT_FOUND', 'Target organization does not match authenticated tenant', 404);
    const expectedWorld = ctx.worldKey ?? process.env.ORGO_IK_WORLD?.trim();
    if (expectedWorld && envelope.target?.world && envelope.target.world !== expectedWorld)
      throw new DomainError('IK_TARGET_NOT_FOUND', 'Target World does not match configured Orgo routing', 404);
  }

  private validateDecision(ctx: ExecutionContext, envelope: InteractionEnvelope) {
    if (envelope.class !== 'command' || envelope.profile.id !== 'governance.decision.execute' || envelope.profile.version !== '1.0.0')
      throw new DomainError('IK_UNKNOWN_PROFILE', 'governance.decision.execute/1.0.0 required', 422);
    if (envelope.source.system !== 'konnaxion')
      throw new DomainError('IK_UNAUTHORIZED', 'Konnaxion source required', 403);
    this.validateTarget(ctx, envelope);
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
    return parse(decisionExecuteData, envelope.data ?? {});
  }

  private validateKorWorkStatus(ctx: ExecutionContext, envelope: InteractionEnvelope) {
    if (envelope.class !== 'command' || envelope.profile.id !== 'orgo.work.status.submit' || envelope.profile.version !== '1.1.0')
      throw new DomainError('IK_UNKNOWN_PROFILE', 'orgo.work.status.submit/1.1.0 required', 422);
    if (envelope.source.system !== 'kor')
      throw new DomainError('IK_UNAUTHORIZED', 'Kor source required', 403);
    this.validateTarget(ctx, envelope);
    if (envelope.subject.type !== 'task')
      throw new DomainError('IK_INVALID_ENVELOPE', 'subject.type must be task', 422);
    if (!envelope.idempotency_key)
      throw new DomainError('IK_INVALID_ENVELOPE', 'idempotency_key is required', 400);
    if (ctx.idempotencyKey && ctx.idempotencyKey !== envelope.idempotency_key)
      throw new DomainError('IK_IDEMPOTENCY_CONFLICT', 'Header idempotency key differs from envelope', 409);
    if (envelope.authority?.kind !== 'kor-user-action')
      throw new DomainError('IK_UNAUTHORIZED', 'kor-user-action authority is required', 403);
    const data = parse(korWorkStatusSubmitData, envelope.data ?? {});
    if (data.work_ref !== envelope.subject.id)
      throw new DomainError('IK_INVALID_ENVELOPE', 'data.work_ref must equal subject.id', 422);
    return data;
  }

  private validateKristalArtifact(ctx: ExecutionContext, envelope: InteractionEnvelope) {
    if (envelope.class !== 'event' || envelope.profile.id !== 'kristal.artifact.ready' || envelope.profile.version !== '2.0.0')
      throw new DomainError('IK_UNKNOWN_PROFILE', 'kristal.artifact.ready/2.0.0 required', 422);
    if (envelope.source.system !== 'daat')
      throw new DomainError('IK_UNAUTHORIZED', 'Da’at source required for Kristal artifact events', 403);
    this.validateTarget(ctx, envelope);
    if (!envelope.artifact_refs.length)
      throw new DomainError('IK_INVALID_ENVELOPE', 'Kristal artifact event requires artifact_refs', 422);
    return parse(kristalArtifactReadyData, envelope.data ?? {});
  }

  private decisionRoute() {
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

  private kristalSemanticSummary(envelope: InteractionEnvelope) {
    const roles = new Set<string>();
    const actionabilityModes = new Set<string>();
    let humanValidationRequired = false;
    const visit = (record: Record<string, unknown>) => {
      const role = record.record_role;
      if (typeof role === 'string') roles.add(role);
      const actionability = record.actionability;
      if (actionability && typeof actionability === 'object' && !Array.isArray(actionability)) {
        const value = actionability as Record<string, unknown>;
        const mode = value.mode;
        if (typeof mode === 'string') actionabilityModes.add(mode);
        if (value.requires_human_validation === true) humanValidationRequired = true;
      }
    };
    for (const ref of envelope.artifact_refs) {
      const content = ref.content;
      if (!content || typeof content !== 'object' || Array.isArray(content)) continue;
      visit(content);
      const assertions = content.assertions;
      if (Array.isArray(assertions))
        for (const assertion of assertions)
          if (assertion && typeof assertion === 'object' && !Array.isArray(assertion))
            visit(assertion as Record<string, unknown>);
    }
    return {
      record_roles: [...roles].sort(),
      actionability_modes: [...actionabilityModes].sort(),
      human_validation_required: humanValidationRequired,
    };
  }

  private kristalRoute() {
    const rawLabel = process.env.KRISTAL_ARTIFACT_LABEL?.trim();
    if (!rawLabel)
      throw new DomainError('IK_TARGET_NOT_READY', 'Configure KRISTAL_ARTIFACT_LABEL before subscribing Orgo to Kristal artifact events', 409);
    return {
      label: parse(label, rawLabel),
      workflowCode: process.env.KRISTAL_ARTIFACT_WORKFLOW_CODE?.trim() || null,
      type: process.env.KRISTAL_ARTIFACT_TYPE?.trim() || 'kristal_artifact_ready',
      category: parse(category, process.env.KRISTAL_ARTIFACT_CATEGORY?.trim() || 'update'),
      severity: parse(severity, process.env.KRISTAL_ARTIFACT_SEVERITY?.trim() || 'MINOR'),
    };
  }

  private async receiveDecision(original: ExecutionContext, envelope: InteractionEnvelope) {
    const data = this.validateDecision(original, envelope);
    const route = this.decisionRoute();
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

  private async receiveKorWorkStatus(original: ExecutionContext, envelope: InteractionEnvelope) {
    const data = this.validateKorWorkStatus(original, envelope);
    const ctx: ExecutionContext = {
      ...original,
      idempotencyKey: envelope.idempotency_key!,
      correlationId: envelope.correlation_id || original.correlationId,
      causationId: envelope.causation_id || original.causationId,
      source: 'api',
    };
    const semantic = ikSemanticProjection(envelope);
    try {
      return await this.commands.run(ctx, 'ik.orgo.work.status.submit', semantic, async (tx: Tx) => {
        const task = await this.work.getTask(ctx, envelope.subject.id, tx);
        const comment = await this.work.comment(
          ctx,
          task.id,
          `[Kor checkpoint ${data.checkpoint_ref} @ ${data.reported_at}]\n${data.report}`,
          'internal_only',
          tx,
        );
        return ikReceipt({
          interactionId: envelope.id,
          organizationId: ctx.organizationId,
          correlationId: envelope.correlation_id,
          status: 'succeeded',
          externalReference: `orgo:task-comment:${comment.id}`,
          data: {
            task_id: task.id,
            task_revision: task.revision,
            comment_id: comment.id,
            checkpoint_ref: data.checkpoint_ref,
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

  private async receiveKristalArtifact(original: ExecutionContext, envelope: InteractionEnvelope) {
    const data = this.validateKristalArtifact(original, envelope);
    const route = this.kristalRoute();
    const eventKey = envelope.idempotency_key || `kristal.artifact.ready:${envelope.id}`;
    if (original.idempotencyKey && original.idempotencyKey !== eventKey)
      throw new DomainError('IK_IDEMPOTENCY_CONFLICT', 'Header idempotency key differs from event identity', 409);
    const ctx: ExecutionContext = {
      ...original,
      idempotencyKey: eventKey,
      correlationId: envelope.correlation_id || original.correlationId,
      source: 'api',
    };
    const semantic = ikSemanticProjection(envelope);
    const kristal = this.kristalSemanticSummary(envelope);
    try {
      return await this.commands.run(ctx, 'ik.kristal.artifact.ready', semantic, async (tx: Tx) => {
        const version = route.workflowCode
          ? await this.workflow.activeVersionByCode(ctx, route.workflowCode, tx)
          : null;
        const signal = await this.intake.accept(ctx, {
          source: 'api',
          external_reference: `kristal:build:${data.build_ref}:stage:${data.stage}`,
          type: route.type,
          category: route.category,
          severity: route.severity,
          label: route.label,
          title: `Kristal artifact ready — ${data.stage}`,
          description: `Da’at announced Kristal Standard ${KRISTAL_STANDARD_VERSION} output for build ${data.build_ref}.`,
          payload: {
            interaction_id: envelope.id,
            correlation_id: envelope.correlation_id,
            kristal_standard: KRISTAL_STANDARD_VERSION,
            build_ref: data.build_ref,
            stage: data.stage,
            source: envelope.source,
            target: envelope.target ?? null,
            artifact_refs: envelope.artifact_refs,
            ...kristal,
            request_fingerprint: ikRequestFingerprint(envelope),
          },
          ...(version ? { workflow_version_id: version.id } : {}),
        }, tx);
        return ikReceipt({
          interactionId: envelope.id,
          organizationId: ctx.organizationId,
          correlationId: envelope.correlation_id,
          status: 'accepted',
          externalReference: `orgo:signal:${signal.id}`,
          data: {
            signal_id: signal.id,
            build_ref: data.build_ref,
            stage: data.stage,
            workflow_version_id: version?.id ?? null,
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

  async receive(original: ExecutionContext, raw: unknown) {
    const envelope = parse(interactionEnvelope, raw);
    if (envelope.profile.id === 'governance.decision.execute' && envelope.profile.version === '1.0.0')
      return this.receiveDecision(original, envelope);
    if (envelope.profile.id === 'kristal.artifact.ready' && envelope.profile.version === '2.0.0')
      return this.receiveKristalArtifact(original, envelope);
    if (envelope.profile.id === 'orgo.work.status.submit' && envelope.profile.version === '1.1.0')
      return this.receiveKorWorkStatus(original, envelope);
    throw new DomainError(
      'IK_UNKNOWN_PROFILE',
      'Accepted profiles: governance.decision.execute/1.0.0, kristal.artifact.ready/2.0.0, orgo.work.status.submit/1.1.0',
      422,
    );
  }
}
