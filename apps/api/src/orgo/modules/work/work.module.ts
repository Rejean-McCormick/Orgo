import { Module } from '@nestjs/common';
import { WorkService } from './work.service';
@Module({ providers: [WorkService], exports: [WorkService] })
export class WorkModule {}
