import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AnalyticsExportService } from './analytics-export.service';
import { PatternDetectionService } from './pattern-detection.service';
import { InsightsCacheWarmupService } from './insights-cache-warmup.service';

/**
 * InsightsModule
 *
 * Wires up the reporting / analytics slice of Orgo over the `insights.*`
 * star schema (see Orgo v3 Docs 4 & 6 for functional + config contracts).
 */
@Module({
  imports: [
    // Provides ConfigService so insights services can read ENV / config.yaml
    ConfigModule,
  ],
  controllers: [
    // HTTP reporting API (task volume, SLA breaches, profile scores, etc.)
    ReportsController,
  ],
  providers: [
    // Read-only reporting over the insights star schema
    ReportsService,
    // Export and materialized-view refresh hooks (used by jobs / queues)
    AnalyticsExportService,
    // Weekly / monthly / yearly pattern detection orchestration
    PatternDetectionService,
    // Cache warmup for high-traffic dashboards
    InsightsCacheWarmupService,
  ],
  exports: [
    ReportsService,
    AnalyticsExportService,
    PatternDetectionService,
    InsightsCacheWarmupService,
  ],
})
export class InsightsModule {}
