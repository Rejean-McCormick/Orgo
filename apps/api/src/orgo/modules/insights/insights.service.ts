import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Database } from '../../platform/database';
import { ExecutionContext, requirePermission } from '../../platform/contracts';
import { WorkService } from '../work/public';
@Injectable()
export class InsightsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WorkService) private readonly work: WorkService,
  ) {}
  async overview(ctx: ExecutionContext) {
    requirePermission(ctx, 'insights:read');
    this.work.requireAny(ctx, 'work:read');
    const tasks = this.work.taskScope(ctx),
      cases = this.work.caseScope(ctx);
    const [taskCounts, caseCounts, overdue, workload] = await Promise.all([
      this.db.task.groupBy({
        by: ['status'],
        where: tasks,
        _count: { _all: true },
      }),
      this.db.case.groupBy({
        by: ['status'],
        where: cases,
        _count: { _all: true },
      }),
      this.db.task.count({
        where: {
          ...tasks,
          status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] },
          reactivity_deadline_at: { lt: new Date() },
        },
      }),
      this.db.task.groupBy({
        by: ['owner_user_id'],
        where: {
          ...tasks,
          status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] },
        },
        _count: { _all: true },
        take: 100,
        orderBy: { owner_user_id: 'asc' },
      }),
    ]);
    return {
      tasks: taskCounts.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
      cases: caseCounts.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
      overdue,
      workload: workload.map((r) => ({
        user_id: r.owner_user_id,
        count: r._count._all,
      })),
      generated_at: new Date().toISOString(),
    };
  }
}
