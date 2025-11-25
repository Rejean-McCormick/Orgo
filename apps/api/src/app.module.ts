// C:\MyCode\Orgo\apps\api\src\app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validationSchemaForEnv } from './config/environment-variables';
import { PersistenceModule } from './persistence/persistence.module';

// Orgo core + backbone
import { OrgoModule } from './orgo/orgo.module';
import { OrganizationModule } from './orgo/backbone/organizations/organization.module';
import { PersonProfileModule } from './orgo/backbone/persons/person-profile.module';
import { IdentityLinkModule } from './orgo/backbone/identity/identity-link.module';

// Domain modules
import { EducationModule } from './orgo/domain/education/education.module';
import { HrModule } from './orgo/domain/hr/hr.module';

// Insights / analytics
import { InsightsModule } from './orgo/insights/insights.module';

@Module({
  imports: [
    // Global ENV config + validation
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: validationSchemaForEnv,
    }),

    // Prisma-based core persistence (operational DB)
    PersistenceModule,

    // TypeORM DataSource for Insights (analytics / star-schema).
    // Uses INSIGHTS_WAREHOUSE_URL when set, otherwise falls back to DATABASE_URL.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url =
          config.get<string>('INSIGHTS_WAREHOUSE_URL') ||
          config.get<string>('DATABASE_URL');

        if (!url) {
          throw new Error(
            'INSIGHTS_WAREHOUSE_URL or DATABASE_URL must be configured for Insights reporting.',
          );
        }

        return {
          type: 'postgres' as const,
          url,
          // Insights services use raw SQL; entities are not required here.
          autoLoadEntities: false,
          synchronize: false,
          logging: false,
        };
      },
    }),

    // Core Orgo services (tasks, cases, workflow, labels, config, logging)
    OrgoModule,

    // Backbone: organizations, persons, identity links
    OrganizationModule,
    PersonProfileModule,
    IdentityLinkModule,

    // Domain-level modules
    EducationModule,
    HrModule,

    // Read-only reporting / analytics API
    InsightsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
