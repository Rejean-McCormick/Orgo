import { Inject } from '@nestjs/common';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Database } from '../../../platform/database';
import { Public } from './boundary';
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get('live') live() {
    return { status: 'alive' };
  }
  @Get('ready') async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
  @Get('dependencies') dependencies() {
    return {
      required: ['postgres'],
      optional: ['spaces', 'kristal', 'konnaxion', 'architect', 'koa', 'smtp'],
    };
  }
}
