import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../../persistence/persistence.module';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
