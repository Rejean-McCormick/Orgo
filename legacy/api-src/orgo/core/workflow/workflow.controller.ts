import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WorkflowEngineService } from './workflow-engine.service';

/**
 * Standard result shape used across Core Services.
 * Mirrors the spec in Core Services doc (ok / data / error).
 */
export interface StandardResult<TData> {
  ok: boolean;
  data: TData | null;
  error: {
    code: string;
    message: string;
    // Extra details (validation errors, offending fields, etc.)
    details?: Record<string, unknown>;
  } | null;
}

/**
 * Allowed workflow event sources (NOT the task_source_enum).
 * Matches spec: EMAIL | API | SYSTEM | TIMER.
 */
export type WorkflowExecutionSource = 'EMAIL' | 'API' | 'SYSTEM' | 'TIMER';

/**
 * Context passed to the workflow engine from the controller.
 * This is the “logical context” described in the Core Services spec:
 * includes organization_id, source and any additional data needed
 * to evaluate rules (task/case references, signal payloads, etc.).
 */
export interface WorkflowExecuteContext {
  workflowId: string;
  organizationId: string;
  source: WorkflowExecutionSource;
  /**
   * Arbitrary context for the workflow:
   * - task / case JSON
   * - signal payload
   * - email envelope
   * - domain-specific hints
   */
  context?: Record<string, unknown>;
}

/**
 * Body of POST /api/v3/workflows/:workflowId/execute.
 * `workflowId` itself is taken from the route param; the body supplies
 * the organization, source and arbitrary context.
 */
export interface ExecuteWorkflowDto {
  /**
   * Tenant identifier; all workflow evaluation is scoped to an organization.
   */
  organizationId: string;

  /**
   * Workflow event source (EMAIL | API | SYSTEM | TIMER).
   * This is the workflow-engine source, not the DB task_source_enum.
   */
  source: WorkflowExecutionSource;

  /**
   * Optional free-form context object consumed by the workflow engine.
   * This may include task/case JSON, signal payloads, domain hints, etc.
   */
  context?: Record<string, unknown>;

  /**
   * When true, the workflow engine is invoked in “dry run” mode
   * (simulation) and must not persist side-effects.
   */
  dryRun?: boolean;
}

/**
 * Controller responsible for public Workflow API endpoints.
 *
 * Interface mapping (from Orgo v3 specs):
 * - Trigger workflow execution → WorkflowController.execute
 *   POST /api/v3/workflows/:id/execute
 */
@ApiTags('workflows')
@Controller('api/v3/workflows')
export class WorkflowController {
  constructor(
    private readonly workflowEngineService: WorkflowEngineService,
  ) {}

  /**
   * Manually trigger a workflow execution for a given workflow ID.
   *
   * Route:
   *   POST /api/v3/workflows/:workflowId/execute
   *
   * Behaviour:
   *   - When dryRun = true: calls WorkflowEngineService.simulate(...)
   *     and returns the preview of actions without side-effects.
   *   - When dryRun = false or omitted: calls
   *     WorkflowEngineService.executeWorkflow(...) and returns its result.
   *
   * Both service calls are expected to return the standard
   * { ok, data, error } result shape.
   */
  @Post(':workflowId/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger workflow execution',
    description:
      'Manually executes a workflow definition for the given workflowId within an organization. ' +
      'Set dryRun=true to simulate without applying side-effects.',
  })
  @ApiParam({
    name: 'workflowId',
    type: String,
    description:
      'Identifier of the workflow definition to execute (as defined in workflow config).',
  })
  @ApiBody({
    description: 'Workflow execution context',
    schema: {
      type: 'object',
      required: ['organizationId', 'source'],
      properties: {
        organizationId: {
          type: 'string',
          format: 'uuid',
          description: 'Tenant / organization identifier.',
        },
        source: {
          type: 'string',
          enum: ['EMAIL', 'API', 'SYSTEM', 'TIMER'],
          description: 'Workflow event source (not the DB task_source_enum).',
        },
        context: {
          type: 'object',
          additionalProperties: true,
          nullable: true,
          description:
            'Arbitrary context object (task/case JSON, signal payload, domain hints, etc.).',
        },
        dryRun: {
          type: 'boolean',
          nullable: true,
          default: false,
          description:
            'When true, runs the workflow in simulation mode without side-effects.',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Workflow executed successfully. Payload shape follows the standard { ok, data, error } result format.',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid input, unknown workflow, or violation of workflow validation rules. ' +
      'Error payload uses the standard { ok: false, error: { code, message, details } } shape.',
  })
  async execute(
    @Param('workflowId') workflowId: string,
    @Body() body: ExecuteWorkflowDto,
  ): Promise<StandardResult<unknown>> {
    const { organizationId, source, context, dryRun = false } = body;

    const execContext: WorkflowExecuteContext = {
      workflowId,
      organizationId,
      source,
      context,
    };

    if (dryRun) {
      // Simulation / dry-run path (no side-effects).
      return this.workflowEngineService.simulate(execContext);
    }

    // Normal execution path (caller applies side-effects according
    // to the workflow engine’s returned actions).
    return this.workflowEngineService.executeWorkflow(execContext);
  }
}
