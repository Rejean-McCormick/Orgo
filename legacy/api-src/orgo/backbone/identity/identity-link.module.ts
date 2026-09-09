import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../../persistence/persistence.module';
import { PersonProfileModule } from '../persons/person-profile.module';
import { IdentityLinkService } from './identity-link.service';
import { IdentityLinkController } from './identity-link.controller';

/**
 * IdentityLinkModule
 *
 * Backbone module responsible for linking user accounts to person profiles
 * in a multi-tenant-safe way, using the canonical Orgo identity model
 * (user_accounts vs person_profiles) and the shared persistence layer.
 *
 * Exposes IdentityLinkService so other modules can establish or query links.
 */
@Module({
  imports: [PersistenceModule, PersonProfileModule],
  providers: [IdentityLinkService],
  controllers: [IdentityLinkController],
  exports: [IdentityLinkService],
})
export class IdentityLinkModule {}
