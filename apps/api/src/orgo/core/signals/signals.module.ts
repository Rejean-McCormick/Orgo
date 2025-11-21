import { Module } from '@nestjs/common';
import { SignalController } from './signal.controller';
import { SignalIngestService } from './signal-ingest.service';

/**
 * Core API / Signals module.
 *
 * Exposes SignalIngestService.ingest via SignalController.createSignal to
 * normalize non-email signals (REST, UI forms, webhooks) into a common
 * signal shape that downstream workflows can turn into Cases/Tasks.
 */
@Module({
  imports: [],
  controllers: [SignalController],
  providers: [SignalIngestService],
  exports: [SignalIngestService],
})
export class SignalsModule {}
