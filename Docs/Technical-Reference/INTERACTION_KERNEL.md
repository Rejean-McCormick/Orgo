# Orgo Interaction Kernel boundary

Orgo core owns the operational consequence of `governance.decision.execute/1.0.0`.
`Orgo_Worlds` does not create Signal/Case/Task state.

## Inbound

`POST /api/v3/ik/interactions`

The request is authenticated by the normal Orgo bearer-token boundary. The token's
organization is authoritative; `target.organization` must match it.

Accepted profile: `governance.decision.execute@1.0.0`.

The boundary resolves `KONNAXION_DECISION_WORKFLOW_CODE` to the current active
WorkflowVersion, then creates exactly one Signal and queues that workflow. Existing
`IdempotencyRecord`, Signal and Outbox infrastructure provide replay safety.

Required token permissions must cover both intake and the actions executed later by the worker.
For the qualification workflow that creates a Case, a Task and publishes impact, use:
`signals:write`, `signals:read`, `workflows:execute`, `work:write`, `work:read`,
`integrations:write` and `integrations:read`. The last read scope is used by qualification
inspection; production roles may omit it if no readback is required.

For local Docker qualification only, `ORGO_ALLOW_INSECURE_LOCAL_PROVIDER_HTTP=true`
permits `http://host.docker.internal/...` for the Konnaxion callback. It is false by
default and does not permit arbitrary HTTP provider hosts.

## Outbound

The Konnaxion integration adapter emits `accountability.impact.publish@1.0.0` to
`KONNAXION_IK_URL`, using `KONNAXION_IK_TOKEN`.
