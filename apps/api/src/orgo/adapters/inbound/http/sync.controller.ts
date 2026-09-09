import { Inject } from '@nestjs/common';
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { Commands } from '../../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  uuid,
} from '../../../platform/contracts';
import { WorkService } from '../../../modules/work/public';
import { IntakeService } from '../../../modules/intake/intake.service';
import { Ctx } from './boundary';
const replayInput = z
  .object({
    commands: z
      .array(
        z
          .object({
            id: uuid,
            operation: z.enum(['task.create', 'task.status', 'signal.accept']),
            payload: z.record(z.unknown()),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
@Controller('sync')
export class SyncController {
  constructor(
    @Inject(Commands) private readonly commands: Commands,
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(IntakeService) private readonly intake: IntakeService,
  ) {}
  @Post('replay') async replay(
    @Ctx() original: ExecutionContext,
    @Body() body: unknown,
  ) {
    requirePermission(original, 'sync:write');
    const input = parse(replayInput, body);
    const results = [];
    for (const command of input.commands) {
      const ctx = {
        ...original,
        idempotencyKey: command.id,
        source: 'sync' as const,
      };
      try {
        const data = await this.commands.run<unknown>(
          ctx,
          `sync:${command.operation}`,
          command.payload,
          (tx) => {
            if (command.operation === 'task.create')
              return this.work.createTask(
                ctx,
                { ...command.payload, source: 'sync' },
                tx,
              );
            if (command.operation === 'signal.accept')
              return this.intake.accept(
                ctx,
                { ...command.payload, source: 'sync' },
                tx,
              );
            const p = parse(
              z
                .object({
                  task_id: uuid,
                  status: z.string(),
                  revision: z.number().int().min(0),
                })
                .strict(),
              command.payload,
            );
            return this.work.changeTaskStatus(
              ctx,
              p.task_id,
              p.status,
              p.revision,
              tx,
            );
          },
        );
        results.push({ id: command.id, ok: true, data });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({
          id: command.id,
          ok: false,
          error: { code: error.code, message: error.message },
        });
      }
    }
    return { results };
  }
}
