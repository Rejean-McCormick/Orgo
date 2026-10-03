# Orgo owner contract for Kor E2E

Orgo now admits one explicit Kor command Profile for this qualification path:

- `orgo.work.status.submit/1.1.0`
- class: `command`
- source: `kor`
- target: `orgo`
- subject: an existing Orgo `task`
- authority kind: `kor-user-action`
- authenticated Orgo token scopes: `work:read`, `work:comment`
- effect: append an internal Task comment containing the reported checkpoint; the command does **not** silently change Task status.

The receiver requires `data.work_ref == subject.id`, enforces the authenticated tenant target, and uses the IK idempotency key + semantic request fingerprint path. Successful receipt status is `succeeded` because the owner mutation is committed in the same Orgo transaction.
