import { SsoController } from './orgo/adapters/inbound/http/sso.controller';
import { ProductOperationsController } from './orgo/adapters/inbound/http/product-operations.controller';
import { CompletionController } from './orgo/adapters/inbound/http/completion.controller';
import { IngressController } from './orgo/adapters/inbound/http/ingress.controller';
import { RoutingController } from './orgo/adapters/inbound/http/routing.controller';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RuntimeModule } from './orgo/runtime.module';
import { AuthGuard, Envelope } from './orgo/adapters/inbound/http/boundary';
import { AuthController } from './orgo/adapters/inbound/http/auth.controller';
import { WorkController } from './orgo/adapters/inbound/http/work.controller';
import { ProcessController } from './orgo/adapters/inbound/http/process.controller';
import { OperationsController } from './orgo/adapters/inbound/http/operations.controller';
import { AdminController } from './orgo/adapters/inbound/http/admin.controller';
import { SyncController } from './orgo/adapters/inbound/http/sync.controller';
import { HealthController } from './orgo/adapters/inbound/http/health.controller';
@Module({
  imports: [RuntimeModule],
  controllers: [
    SsoController,
    CompletionController,
    ProductOperationsController,
    IngressController,
    RoutingController,
    AuthController,
    WorkController,
    ProcessController,
    OperationsController,
    AdminController,
    SyncController,
    HealthController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: Envelope },
  ],
})
export class AppModule {}
