import { requestTelemetry } from './orgo/platform/telemetry';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { Errors } from './orgo/adapters/inbound/http/boundary';
export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  app.use(requestTelemetry);
  app.use('/api/v3/ingress/email', json({ limit: '1600kb' }));
  app.use('/api/v3/work', json({ limit: '1500kb' }));
  app.use(json({ limit: '256kb' }));
  app.setGlobalPrefix('api/v3', {
    exclude: ['health/live', 'health/ready', 'health/dependencies'],
  });
  app.useGlobalFilters(new Errors());
  app.use(
    (
      _req: unknown,
      res: { setHeader(k: string, v: string): void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  if (process.env.CORS_ORIGIN)
    app.enableCors({
      origin: process.env.CORS_ORIGIN.split(','),
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Correlation-ID',
        'X-Organization-ID',
      ],
    });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
