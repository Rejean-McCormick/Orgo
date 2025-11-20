import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LogService } from './log.service';
import { LogRotationService } from './log-rotation.service';
import { LogQueryService } from './log-query.service';

/**
 * Injection token for the core Orgo logger_service.
 *
 * This matches the logical service identifier used in the Orgo
 * Core Services specification and can be used with:
 *
 *   @Inject(LOGGER_SERVICE_TOKEN) private readonly logService: LogService
 */
export const LOGGER_SERVICE_TOKEN = 'logger_service';

@Global()
@Module({
  imports: [
    // Uses the global ConfigModule instance from AppModule.
    // LogService is responsible for reading logging_config.yaml or
    // equivalent configuration via ConfigService.
    ConfigModule,
  ],
  providers: [
    LogService,
    {
      // Provide LogService under the stable string token "logger_service"
      // so other modules can depend on the logical core service id
      // instead of the concrete class name.
      provide: LOGGER_SERVICE_TOKEN,
      useExisting: LogService,
    },
    LogRotationService,
    LogQueryService,
  ],
  exports: [
    // Export both the concrete class and the string token so that
    // consumers can choose either style of injection.
    LogService,
    LOGGER_SERVICE_TOKEN,
    LogRotationService,
    LogQueryService,
  ],
})
export class LoggerModule {}
