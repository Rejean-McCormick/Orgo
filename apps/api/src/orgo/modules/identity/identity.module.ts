import { OidcService } from './oidc.service';
import { IdentityAdmin } from './identity-admin.service';
import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
@Module({
  providers: [IdentityService, IdentityAdmin, OidcService],
  exports: [IdentityService, IdentityAdmin, OidcService],
})
export class IdentityModule {}
