import { ProcessManager } from './orgo/modules/orchestration/process-manager.service';
import { Database } from './orgo/platform/database';
import { randomUUID } from 'node:crypto';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { setTimeout } from 'node:timers/promises';
import { RuntimeModule } from './orgo/runtime.module';
import { OutboxWorker } from './orgo/platform/outbox/worker.service';
import { EscalationService } from './orgo/modules/orchestration/escalation.service';
async function main() {
  const app = await NestFactory.createApplicationContext(RuntimeModule, {
    logger: ['error', 'warn'],
  });
  const worker = app.get(OutboxWorker),
    escalation = app.get(EscalationService);
  const processes = app.get(ProcessManager),
    db = app.get(Database),
    workerId = randomUUID(),
    startedAt = new Date();
  let lastProcess = 0,
    lastCleanup = 0;
  let stop = false,
    lastEscalation = 0;
  process.once('SIGTERM', () => {
    stop = true;
  });
  process.once('SIGINT', () => {
    stop = true;
  });
  while (!stop) {
    try {
      if (Date.now() - lastProcess >= 5000) {
        await db.workerHeartbeat.upsert({
          where: { id: workerId },
          create: {
            id: workerId,
            last_seen_at: new Date(),
            started_at: startedAt,
          },
          update: { last_seen_at: new Date() },
        });
        await processes.tick();
        if (Date.now() - lastCleanup > 3600000) {
          const before = new Date(Date.now() - 86400000);
          await db.rateLimitBucket.deleteMany({
            where: { window_start: { lt: before } },
          });
          await db.oidcAttempt.deleteMany({
            where: { expires_at: { lt: before } },
          });
          await db.workerHeartbeat.deleteMany({
            where: {
              last_seen_at: { lt: new Date(Date.now() - 7 * 86400000) },
            },
          });
          lastCleanup = Date.now();
        }
        lastProcess = Date.now();
      }
      if (Date.now() - lastEscalation >= 30000) {
        await escalation.tick();
        lastEscalation = Date.now();
      }
      if (!(await worker.tick())) await setTimeout(1000);
    } catch {
      console.error(JSON.stringify({ event: 'orgo.worker.tick_failed' }));
      await setTimeout(2000);
    }
  }
  await app.close();
}
main().catch(() => {
  console.error('Orgo worker startup failed');
  process.exitCode = 1;
});
