// apps/api/src/orgo/backbone/persons/person-profile.module.ts

import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../../persistence/persistence.module';
import { LoggerModule } from '../../core/logging/logger.module';
import { PersonProfileService } from './person-profile.service';
import { PersonProfileController } from './person-profile.controller';

@Module({
  imports: [
    // Provides Prisma / DB access
    PersistenceModule,
    // Provides structured logging (LogService)
    LoggerModule,
  ],
  controllers: [PersonProfileController],
  providers: [PersonProfileService],
  exports: [PersonProfileService],
})
export class PersonProfileModule {}
