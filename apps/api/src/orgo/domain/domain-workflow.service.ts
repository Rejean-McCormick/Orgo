// apps/api/src/orgo/domain/domain-workflow.service.ts

import {
  Injectable,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';

/**
 * Injection token for the repository that persists workflow instances.
 *
 * Provide a concrete implementation in your module, e.g.:
 * {
 *   provide: DOMAIN_WORKFLOW_REPOSITORY,
 *   useClass: PrismaDomainWorkflowRepository,
 * }
 */
export const DOMAIN_WORKFLOW_REPOSITORY = Symbol('DOMAIN_WORKFLOW_REPOSITORY');

/**
 * Injection token for the map of workflow definitions (one per workflow type).
 *
 * Provide from your module, e.g.:
 * {
 *   provide: DOMAIN_WORKFLOW_DEFINITIONS,
 *   useValue: myWorkflowDefinitions,
 * }
 */
export const DOMAIN_WORKFLOW_DEFINITIONS = 'DOMAIN_WORKFLOW_DEFINITIONS';

/**
 * Injection token for an optional event publisher used to emit workflow events.
 *
 * Provide from your module, e.g.:
 * {
 *   provide: DOMAIN_WORKFLOW_EVENT_PUBLISHER,
 *   useExisting: DomainEventBus,
 * }
 */
export const DOMAIN_WORKFLOW_EVENT_PUBLISHER = 'DOMAIN_WORKFLOW_EVENT_PUBLISHER';

export type DomainWorkflowId = string;
export type DomainWorkflowType = string;
export type DomainId = string;
export type DomainWorkflowStateId = string;

/**
 * Base shape of workflow events emitted by the service.
 * You can extend this for your own event bus or domain events.
 */
export interface DomainWorkflowEventBase {
  readonly type: string; // e.g. 'domain_workflow.started', 'domain_workflow.transitioned'
  readonly workflowId: DomainWorkflowId;
  readonly domainId: DomainId;
  readonly workflowType: DomainWorkflowType;
  readonly payload?: Record<string, any>;
  readonly occurredAt: Date;
}

/**
 * Optional event publisher interface. Implement this if you want
 * workflow events to be propagated into your domain event bus.
 */
export interface DomainWorkflowEventPublisher {
  publish<T extends DomainWorkflowEventBase = DomainWorkflowEventBase>(
    event: T,
  ): Promise<void> | void;
}

/**
 * History entry recorded for each state transition of a workflow instance.
 */
export interface DomainWorkflowHistoryEntry {
  state: DomainWorkflowStateId;
  action: string;
  actorId?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

/**
 * Persisted workflow instance for a given domain.
 *
 * You are expected to map this shape to your actual persistence model
 * (Prisma, TypeORM, etc.) in the concrete repository implementation.
 */
export interface DomainWorkflowInstance {
  id: DomainWorkflowId;
  domainId: DomainId;
  type: DomainWorkflowType;
  state: DomainWorkflowStateId;
  isActive: boolean;
  context: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  history: DomainWorkflowHistoryEntry[];
}

/**
 * Input used when creating a new workflow instance.
 * The repository will translate this into a persisted instance.
 */
export interface DomainWorkflowCreateInput {
  domainId: DomainId;
  type: DomainWorkflowType;
  initialState: DomainWorkflowStateId;
  context?: Record<string, any> | null;
  initiatorId?: string;
}

/**
 * Repository abstraction for workflow instances.
 *
 * Implement this interface using your chosen persistence technology and
 * register it in your Nest module under the DOMAIN_WORKFLOW_REPOSITORY token.
 */
export interface DomainWorkflowRepository {
  /**
   * Creates and persists a new workflow instance with the given input.
   */
  create(input: DomainWorkflowCreateInput): Promise<DomainWorkflowInstance>;

  /**
   * Persists modifications to an existing workflow instance.
   */
  save(instance: DomainWorkflowInstance): Promise<DomainWorkflowInstance>;

  /**
   * Returns an active workflow for a given domain and type, if any.
   */
  findActiveByDomainAndType(
    domainId: DomainId,
    type: DomainWorkflowType,
  ): Promise<DomainWorkflowInstance | null>;

  /**
   * Returns a workflow instance by its ID, or null if not found.
   */
  findById(id: DomainWorkflowId): Promise<DomainWorkflowInstance | null>;
}

/**
 * Definition of a single state in a workflow.
 */
export interface DomainWorkflowStateDefinition {
  id: DomainWorkflowStateId;
  label?: string;
  terminal?: boolean;
}

/**
 * Definition of a single transition between states, triggered by an action.
 */
export interface DomainWorkflowTransitionDefinition {
  from: DomainWorkflowStateId;
  to: DomainWorkflowStateId;
  action: string;
}

/**
 * A full workflow definition for a given type.
 *
 * You should provide one of these per workflow type via
 * the DOMAIN_WORKFLOW_DEFINITIONS injection token.
 */
export interface DomainWorkflowDefinition {
  type: DomainWorkflowType;
  initialState: DomainWorkflowStateId;
  states: DomainWorkflowStateDefinition[];
  transitions: DomainWorkflowTransitionDefinition[];
}

/**
 * Map workflow type -> workflow definition.
 */
export type DomainWorkflowDefinitions = Record<
  DomainWorkflowType,
  DomainWorkflowDefinition
>;

/**
 * Error codes for workflow-related failures.
 */
export enum DomainWorkflowErrorCode {
  WORKFLOW_ALREADY_EXISTS = 'WORKFLOW_ALREADY_EXISTS',
  WORKFLOW_NOT_FOUND = 'WORKFLOW_NOT_FOUND',
  WORKFLOW_INACTIVE = 'WORKFLOW_INACTIVE',
  INVALID_TRANSITION = 'INVALID_TRANSITION',
  DEFINITION_NOT_FOUND = 'DEFINITION_NOT_FOUND',
}

/**
 * Base error for workflow operations.
 */
export class DomainWorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: DomainWorkflowErrorCode,
  ) {
    super(message);
    this.name = 'DomainWorkflowError';
  }
}

/**
 * Thrown when attempting to start a workflow that already exists and
 * idempotency is not requested.
 */
export class DomainWorkflowAlreadyExistsError extends DomainWorkflowError {
  constructor(domainId: DomainId, workflowType: DomainWorkflowType) {
    super(
      `Active workflow of type "${workflowType}" already exists for domain "${domainId}".`,
      DomainWorkflowErrorCode.WORKFLOW_ALREADY_EXISTS,
    );
    this.name = 'DomainWorkflowAlreadyExistsError';
  }
}

/**
 * Thrown when the requested workflow instance does not exist.
 */
export class DomainWorkflowNotFoundError extends DomainWorkflowError {
  constructor(id: DomainWorkflowId) {
    super(
      `Domain workflow instance "${id}" was not found.`,
      DomainWorkflowErrorCode.WORKFLOW_NOT_FOUND,
    );
    this.name = 'DomainWorkflowNotFoundError';
  }
}

/**
 * Thrown when the requested workflow instance exists but is no longer active.
 */
export class DomainWorkflowInactiveError extends DomainWorkflowError {
  constructor(id: DomainWorkflowId) {
    super(
      `Domain workflow instance "${id}" is not active.`,
      DomainWorkflowErrorCode.WORKFLOW_INACTIVE,
    );
    this.name = 'DomainWorkflowInactiveError';
  }
}

/**
 * Thrown when an invalid transition is requested for a workflow instance.
 */
export class InvalidDomainWorkflowTransitionError extends DomainWorkflowError {
  constructor(
    workflowId: DomainWorkflowId,
    action: string,
    from: DomainWorkflowStateId,
  ) {
    super(
      `Invalid transition "${action}" from state "${from}" for workflow "${workflowId}".`,
      DomainWorkflowErrorCode.INVALID_TRANSITION,
    );
    this.name = 'InvalidDomainWorkflowTransitionError';
  }
}

/**
 * Thrown when a workflow type is used that has no configured definition.
 */
export class DomainWorkflowDefinitionNotFoundError extends DomainWorkflowError {
  constructor(workflowType: DomainWorkflowType) {
    super(
      `No workflow definition configured for type "${workflowType}".`,
      DomainWorkflowErrorCode.DEFINITION_NOT_FOUND,
    );
    this.name = 'DomainWorkflowDefinitionNotFoundError';
  }
}

/**
 * Options when starting a new workflow.
 */
export interface StartDomainWorkflowOptions {
  context?: Record<string, any> | null;
  initiatorId?: string;
  /**
   * If true, and an active workflow of the same type already exists for
   * the domain, that instance will be returned instead of throwing.
   */
  idempotent?: boolean;
}

/**
 * Options when advancing a workflow by one transition.
 */
export interface AdvanceDomainWorkflowOptions {
  actorId?: string;
  metadata?: Record<string, any>;
}

/**
 * Options when cancelling a workflow.
 */
export interface CancelDomainWorkflowOptions {
  actorId?: string;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * A generic workflow service for domain-level workflows.
 * It does not assume any particular domain model beyond a domain identifier.
 *
 * You must provide:
 * - a DomainWorkflowRepository (persistence)
 * - a set of DomainWorkflowDefinitions (one per workflow type)
 *
 * Optionally provide:
 * - a DomainWorkflowEventPublisher to integrate with your event bus.
 */
@Injectable()
export class DomainWorkflowService {
  private readonly logger = new Logger(DomainWorkflowService.name);

  constructor(
    @Inject(DOMAIN_WORKFLOW_REPOSITORY)
    private readonly repository: DomainWorkflowRepository,
    @Inject(DOMAIN_WORKFLOW_DEFINITIONS)
    private readonly definitions: DomainWorkflowDefinitions,
    @Inject(DOMAIN_WORKFLOW_EVENT_PUBLISHER)
    @Optional()
    private readonly eventPublisher?: DomainWorkflowEventPublisher,
  ) {}

  /**
   * Starts a new workflow instance for a domain.
   *
   * If options.idempotent is true and an active workflow of the same type
   * already exists, that existing instance is returned.
   */
  async startWorkflow(
    domainId: DomainId,
    workflowType: DomainWorkflowType,
    options: StartDomainWorkflowOptions = {},
  ): Promise<DomainWorkflowInstance> {
    const definition = this.getDefinitionOrThrow(workflowType);

    const existing = await this.repository.findActiveByDomainAndType(
      domainId,
      workflowType,
    );

    if (existing) {
      if (options.idempotent) {
        this.logger.debug(
          `startWorkflow: returning existing active workflow "${existing.id}" for domain "${domainId}", type "${workflowType}" (idempotent).`,
        );
        return existing;
      }

      throw new DomainWorkflowAlreadyExistsError(domainId, workflowType);
    }

    const instance = await this.repository.create({
      domainId,
      type: workflowType,
      initialState: definition.initialState,
      context: options.context ?? null,
      initiatorId: options.initiatorId,
    });

    this.logger.log(
      `Started workflow "${instance.id}" of type "${workflowType}" for domain "${domainId}" in state "${instance.state}".`,
    );

    await this.publishEventSafely({
      type: 'domain_workflow.started',
      workflowId: instance.id,
      domainId: instance.domainId,
      workflowType: instance.type,
      occurredAt: new Date(),
      payload: {
        state: instance.state,
        context: instance.context,
        initiatorId: options.initiatorId,
      },
    });

    return instance;
  }

  /**
   * Returns the active workflow instance for a given domain and type, if any.
   */
  getActiveWorkflow(
    domainId: DomainId,
    workflowType: DomainWorkflowType,
  ): Promise<DomainWorkflowInstance | null> {
    return this.repository.findActiveByDomainAndType(domainId, workflowType);
  }

  /**
   * Returns the workflow instance by ID, or throws if not found.
   */
  async getWorkflowOrThrow(
    id: DomainWorkflowId,
  ): Promise<DomainWorkflowInstance> {
    const instance = await this.repository.findById(id);
    if (!instance) {
      throw new DomainWorkflowNotFoundError(id);
    }
    return instance;
  }

  /**
   * Returns the list of allowed actions for the current state of a workflow instance.
   */
  async getAllowedActions(
    workflowId: DomainWorkflowId,
  ): Promise<string[]> {
    const instance = await this.getWorkflowOrThrow(workflowId);
    if (!instance.isActive) {
      return [];
    }

    const definition = this.getDefinitionOrThrow(instance.type);
    return definition.transitions
      .filter((t) => t.from === instance.state)
      .map((t) => t.action);
  }

  /**
   * Advances the workflow to the next state using the provided action.
   *
   * Validates that the transition is allowed based on the configured definition.
   */
  async advance(
    workflowId: DomainWorkflowId,
    action: string,
    options: AdvanceDomainWorkflowOptions = {},
  ): Promise<DomainWorkflowInstance> {
    const instance = await this.getWorkflowOrThrow(workflowId);

    if (!instance.isActive) {
      throw new DomainWorkflowInactiveError(workflowId);
    }

    const definition = this.getDefinitionOrThrow(instance.type);
    const transition = definition.transitions.find(
      (t) => t.from === instance.state && t.action === action,
    );

    if (!transition) {
      throw new InvalidDomainWorkflowTransitionError(
        workflowId,
        action,
        instance.state,
      );
    }

    const now = new Date();

    const nextStateDef = definition.states.find(
      (s) => s.id === transition.to,
    );
    const terminal = nextStateDef?.terminal === true;

    const updated: DomainWorkflowInstance = {
      ...instance,
      state: transition.to,
      isActive: terminal ? false : instance.isActive,
      updatedAt: now,
      history: [
        ...instance.history,
        {
          state: transition.to,
          action,
          actorId: options.actorId,
          metadata: options.metadata,
          createdAt: now,
        },
      ],
    };

    const saved = await this.repository.save(updated);

    this.logger.log(
      `Advanced workflow "${saved.id}" of type "${saved.type}" for domain "${saved.domainId}" via action "${action}" to state "${saved.state}".`,
    );

    await this.publishEventSafely({
      type: 'domain_workflow.transitioned',
      workflowId: saved.id,
      domainId: saved.domainId,
      workflowType: saved.type,
      occurredAt: now,
      payload: {
        from: instance.state,
        to: saved.state,
        action,
        actorId: options.actorId,
        metadata: options.metadata,
        terminal,
      },
    });

    if (terminal) {
      await this.publishEventSafely({
        type: 'domain_workflow.completed',
        workflowId: saved.id,
        domainId: saved.domainId,
        workflowType: saved.type,
        occurredAt: now,
        payload: {
          finalState: saved.state,
          actorId: options.actorId,
        },
      });
    }

    return saved;
  }

  /**
   * Cancels an active workflow, marking it inactive and recording a history entry.
   *
   * This does not rely on an explicit transition definition; it is intended as
   * an operational override.
   */
  async cancel(
    workflowId: DomainWorkflowId,
    options: CancelDomainWorkflowOptions = {},
  ): Promise<DomainWorkflowInstance> {
    const instance = await this.getWorkflowOrThrow(workflowId);

    if (!instance.isActive) {
      throw new DomainWorkflowInactiveError(workflowId);
    }

    const now = new Date();

    const updated: DomainWorkflowInstance = {
      ...instance,
      isActive: false,
      updatedAt: now,
      state: instance.state, // state remains the same; only isActive is flipped
      history: [
        ...instance.history,
        {
          state: instance.state,
          action: 'cancel',
          actorId: options.actorId,
          metadata: {
            ...(options.metadata ?? {}),
            reason: options.reason,
          },
          createdAt: now,
        },
      ],
    };

    const saved = await this.repository.save(updated);

    this.logger.warn(
      `Cancelled workflow "${saved.id}" of type "${saved.type}" for domain "${saved.domainId}". Reason: "${options.reason ?? 'n/a'}".`,
    );

    await this.publishEventSafely({
      type: 'domain_workflow.cancelled',
      workflowId: saved.id,
      domainId: saved.domainId,
      workflowType: saved.type,
      occurredAt: now,
      payload: {
        actorId: options.actorId,
        reason: options.reason,
        metadata: options.metadata,
      },
    });

    return saved;
  }

  /**
   * Returns the workflow definition for the given type or throws if missing.
   */
  private getDefinitionOrThrow(
    workflowType: DomainWorkflowType,
  ): DomainWorkflowDefinition {
    const definition = this.definitions?.[workflowType];
    if (!definition) {
      throw new DomainWorkflowDefinitionNotFoundError(workflowType);
    }
    return definition;
  }

  /**
   * Publishes a workflow event using the optional event publisher, if present.
   * Errors are logged but do not fail the workflow operation itself.
   */
  private async publishEventSafely(
    event: DomainWorkflowEventBase,
  ): Promise<void> {
    if (!this.eventPublisher) {
      return;
    }

    try {
      await this.eventPublisher.publish(event);
    } catch (err) {
      this.logger.error(
        `Failed to publish workflow event "${event.type}" for workflow "${event.workflowId}": ${
          (err as Error).message
        }`,
        (err as Error).stack,
      );
    }
  }
}
