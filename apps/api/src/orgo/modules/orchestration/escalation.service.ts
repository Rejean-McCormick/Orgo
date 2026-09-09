import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Database } from '../../platform/database';
import { WorkService } from '../work/public';
@Injectable()
export class EscalationService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WorkService) private readonly work: WorkService,
  ) {}
  async tick() {
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; organization_id: string; revision: number }[]
        >`
        SELECT t.id, t.organization_id, t.revision FROM tasks t JOIN organizations o ON o.id = t.organization_id
        WHERE t.status = 'IN_PROGRESS' AND t.reactivity_deadline_at < now() AND o.status = 'active'
        ORDER BY t.reactivity_deadline_at FOR UPDATE OF t SKIP LOCKED LIMIT 25`;
        for (const row of rows)
          await this.work.changeTaskStatus(
            {
              organizationId: row.organization_id,
              actorUserId: null,
              actorType: 'system',
              roleIds: [],
              permissions: ['*'],
              source: 'api',
              correlationId: `sla-${row.id}-${row.revision}`,
            },
            row.id,
            'ESCALATED',
            row.revision,
            tx,
            'Reactivity deadline elapsed',
          );
        return rows.length;
      },
      { timeout: 15000 },
    );
  }
}
