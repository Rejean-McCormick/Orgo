# Orgo — Explicit integration bridge protocol

The concrete APIs of Kristal, Konnaxion, Architect and kOA are not supplied. The adapters in `apps/api/src/orgo/integrations` implement the following **Orgo-owned bridge protocol**, not assumed native provider endpoints. A provider-side adapter must translate it and enforce its own authorization. Never point this code at a native API without an explicit compatible adapter.

Configure one exact endpoint per provider: `KRISTAL_BRIDGE_URL`, `KONNAXION_BRIDGE_URL`, `ARCHITECT_BRIDGE_URL`, `KOA_BRIDGE_URL`, with the corresponding optional `_TOKEN`. Production requires HTTPS. Development permits HTTP on localhost/127.0.0.1 only. URLs come from deployment configuration, never request payloads; redirects are rejected.

The worker POSTs JSON with a stable `Idempotency-Key`, `X-Correlation-ID` and optional bearer authorization:

```json
{
  "operation_id": "uuid",
  "organization_id": "uuid",
  "operation": "validate",
  "idempotency_key": "organization-uuid:operation-uuid",
  "correlation_id": "correlation",
  "subject": { "type": "case", "id": "uuid" },
  "input": {}
}
```

Configured operation allowlists:

| Adapter | Operations |
| --- | --- |
| Kristal | `validate` |
| Konnaxion | `publish`, `distribute` |
| Architect | `generate` |
| kOA | `execute` |

A successful, completed response is:

```json
{
  "status": "succeeded",
  "external_reference": "provider-owned-reference",
  "data": { "valid": false }
}
```

Here `succeeded` means the operation returned a receipt. `valid: false` remains false; delivery success is never approval, publication or a Work lifecycle transition by implication. The bridge must durably deduplicate operation IDs and return the same completed result on retries.

The bridge may alternatively return `{"status":"accepted","external_reference":"ref","data":{}}`. This acknowledges durable acceptance only. The operation remains RUNNING until a final authenticated callback to `POST /api/v3/integration-operations/:id/receipt` with `Idempotency-Key` and a tenant API token carrying `integrations:callback` plus the provider-specific permission (for example `kristal:callback`). The final callback shape is `{"status":"succeeded"|"failed","external_reference":"ref","data":{},"error":"optional failure code"}`. Contradictory terminal receipts are rejected.

`DurableProcess` waits for these receipts with an explicit deadline. To require a business predicate, declare `expect` on the integration step. Paths are relative to receipt `data`, for example `{"expect":{"validated":true}}`. A successful transport without that required value blocks the process. A completed workflow's `ACTIONS_COMMITTED` and a completed process still never mutate Work status by implication. Unsupported compensation operations are rejected by the same adapter allowlist.

The adapter has a 10-second deadline, a 256 KB response limit, a circuit opening after five failures for 30 seconds, and a per-process limit of four active requests per adapter. The worker normally handles one delivery at a time. HTTP 408/409/425/429 and 5xx retry; other failed responses are terminal. No response body, bearer token or configured URL is copied into an error log.

Outbox delivery is at least once. Retries use the same external identity. No external network effect runs inside a Work transaction. IntegrationOperation holds request metadata, receipt, external reference and errors independently of Case/Task status.

For notifications, `in_app` delivery is implemented; email uses configured `SMTP_URL` and `SMTP_FROM`. SMS and webhook delivery can use fixed `SMS_GATEWAY_URL` / `WEBHOOK_GATEWAY_URL` endpoints and corresponding `_TOKEN` variables. The endpoint is configured by the operator, never taken from a recipient address. POST payload: `{id, organization_id, recipient, subject, body, correlation_id, channel}` with stable organization/notification Idempotency-Key. A gateway must durably deduplicate and return `{"status":"delivered"}` only when its delivery contract is satisfied. A generic gateway is not a native SMS vendor adapter. Browser push is not implemented. SMTP uses a stable Message-ID but does not provide exactly-once guarantees.
