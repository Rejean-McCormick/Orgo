import { randomBytes } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
/** Structured request spans. An operator can ingest stdout with their chosen telemetry collector. */
export function requestTelemetry(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const start = process.hrtime.bigint();
  const incoming = req.get('traceparent');
  const match = incoming?.match(
    /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/,
  );
  const trace =
    match && match[1] !== '0'.repeat(32)
      ? match[1]
      : randomBytes(16).toString('hex');
  res.setHeader('X-Trace-ID', trace);
  res.once('finish', () => {
    const ctx = (
      req as Request & {
        orgoContext?: {
          organizationId: string;
          actorUserId: string | null;
          correlationId: string;
        };
      }
    ).orgoContext;
    console.log(
      JSON.stringify({
        event: 'http.request',
        trace_id: trace,
        correlation_id: ctx?.correlationId,
        organization_id: ctx?.organizationId,
        actor_id: ctx?.actorUserId,
        method: req.method,
        route: req.route?.path ?? 'unmatched',
        status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
      }),
    );
  });
  next();
}
