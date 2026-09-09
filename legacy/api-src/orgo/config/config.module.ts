import { Global, Module } from '@nestjs/common';
import { PersistenceModule } from '../../persistence/persistence.module';
import { ConfigService } from './config.service';
import { OrgProfileService } from './org-profile.service';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Orgo configuration & profiles module.
 *
 * Responsibilities:
 * - Expose ConfigService for merged global/org configuration
 *   (parameter_overrides + YAML/service configs).
 * - Expose OrgProfileService for loading/applying organization profiles.
 * - Expose FeatureFlagService for feature flag toggles.
 *
 * Marked as @Global so these services can be injected anywhere
 * without re-importing the module in every feature module.
 */
@Global()
@Module({
  imports: [PersistenceModule],
  providers: [ConfigService, OrgProfileService, FeatureFlagService],
  exports: [ConfigService, OrgProfileService, FeatureFlagService],
})
export class OrgoConfigModule {}
