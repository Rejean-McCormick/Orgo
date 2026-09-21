# Senior Architecture Pattern Alignment

Orgo already has a canonical selection in `docs/Technical-Reference/TARGET_ARCHITECTURE.md` §17. This root note makes that selection discoverable without redefining it.

| Pattern | Orgo decision |
|---|---|
| Modular Monolith | **Primary architecture** |
| Hexagonal Architecture | **Selective at meaningful boundaries** |
| Anti-Corruption Layer | **Required for external systems** |
| Idempotency | **Required at retry-prone boundaries** |
| Transactional Outbox | **Required for durable post-commit effects** |
| CQRS | **Light/read-side only** |
| Circuit Breaker / Timeout / Backoff | **External/fallible boundaries** |
| Bulkhead | **External/AI/high-cost workloads when needed** |
| Graceful Degradation | **When semantically safe** |
| Dead Letter Queue / manual redrive | **Async poison/permanent failures when needed** |
| Saga / Process Manager | **Only for long-running cross-system workflows** |
| Broker Pub/Sub | **Not required initially** |
| Event Sourcing | **Not selected** |
| BFF as a separate service | **Not selected currently** |
| Sharding / Cell architecture / Service mesh | **Not selected currently** |

Orgo also applies explicit health/readiness and observability conventions: correlation IDs, system metrics, worker heartbeat, and liveness/readiness separation.

## Canonical references

- `docs/Technical-Reference/TARGET_ARCHITECTURE.md` — especially §§12–17
- `docs/Technical-Reference/ARCHITECTURE_TO_CODE.md`
- `docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`
