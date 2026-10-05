# Orgo integration bridges

## Kristal v6 / Da’at

Orgo no longer treats the `kristal` provider as a direct Kristal HTTP validation bridge. The active knowledge path is:

```text
Orgo owner transaction
  + immutable Case/Task snapshot in IntegrationOperation
  + OutboxMessage
        ↓ post-commit
Interaction Kernel
  kristal.build.request/2.0.0
  or kristal.revision.request/2.0.0
        ↓
Da’at mapping / ACL
        ↓
Kristal Standard 6.0.0
        ↓
Interaction Kernel event
  kristal.artifact.ready/2.0.0
        ↓
Orgo Signal
```

Configure `DAAT_IK_URL` and `DAAT_IK_TOKEN` for this provider. The endpoint is an Interaction Kernel endpoint exposed by the Da’at boundary, not a native Kristal API.

Supported Orgo `kristal` operations:

- `build` → `kristal.build.request/2.0.0`;
- `revise` → `kristal.revision.request/2.0.0`.

A `build` request supplies a mapping profile and requested outputs. Orgo automatically freezes the selected Case or Task as an inline `orgo.case_snapshot` / `orgo.task_snapshot` ArtifactRef in the `IntegrationOperation` before post-commit delivery. The snapshot digest and revision are part of the artifact identity.

Example Orgo integration request:

```json
{
  "provider": "kristal",
  "operation": "build",
  "subject_type": "case",
  "subject_id": "CASE_UUID",
  "request": {
    "mapping_profile": "orgo.work-snapshot/kristal-v6",
    "requested_outputs": ["kristal-state", "validation-report"]
  }
}
```

The outbound IK payload pins `kristal_contract_set = 6.0.0`.

## Returning Kristal artifacts

Orgo accepts `kristal.artifact.ready/2.0.0` from `daat` at the existing `POST /api/v3/ik/interactions` boundary. The event becomes a first-class Orgo `Signal` with the returned ArtifactRefs preserved in its payload.

Configure `KRISTAL_ARTIFACT_LABEL` before subscribing Orgo to these events. `KRISTAL_ARTIFACT_WORKFLOW_CODE` is optional: when present, the Signal is queued to that active workflow; otherwise it is persisted for explicit routing/review.

Kristal v6 `actionability` metadata is preserved in ArtifactRefs when supplied, but **Orgo does not execute it directly**. `automatic`, `human_review`, and `human_decision` are inputs to Orgo routing/policy; Cases/Tasks mutate only through Orgo-owned workflow/actions and authorization.

## Other providers

Konnaxion, SemantiK Architect and kOA generic bridge adapters remain explicit Orgo bridge protocols unless their native ecosystem boundary is separately implemented. Production endpoints require HTTPS; configured URLs are deployment configuration and never request-controlled.

## Reliability

Remote effects are post-commit and idempotent:

```text
owner mutation
+ IntegrationOperation
+ OutboxMessage
→ commit
→ worker
→ provider/IK boundary
→ receipt/event
→ Orgo reconciliation
```

No integration creates a distributed transaction across Orgo and an external owner.
