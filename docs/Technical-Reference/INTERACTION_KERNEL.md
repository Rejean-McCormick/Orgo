# Orgo Interaction Kernel boundary

Orgo exposes `POST /api/v3/ik/interactions` as an authenticated machine boundary. The envelope remains IK `ik/1.1`; the profiles determine use-case semantics.

## Accepted inbound profiles

### `governance.decision.execute/1.0.0`

Source: Konnaxion. Orgo validates target tenant/world, governance authority and the referenced Konnaxion DecisionRecord, then creates exactly one local Signal under semantic idempotency. The configured Orgo workflow owns the resulting Case/Task effects.

### `kristal.artifact.ready/2.0.0`

Source: Da’at. Orgo validates the target and artifact event, persists exactly one `kristal_artifact_ready` Signal, and preserves returned ArtifactRefs. `KRISTAL_ARTIFACT_WORKFLOW_CODE` may route it into a local workflow, but is optional.

The event may contain Kristal v6 `record_role` or `actionability` metadata inside artifact content. These are descriptive/policy inputs only. They never authorize an Orgo mutation by themselves.

### `orgo.work.status.submit/1.1.0`

Source: Kor. Orgo requires an existing Task subject, `data.work_ref == subject.id`, authenticated `work:read` + `work:comment` permissions, and the owner authority kind `kor-user-action`. The command appends a traceable internal Task comment containing the human checkpoint report and returns a final `succeeded` IK Receipt in the same transaction. It does not infer or change Task status.

## Outbound profiles

- Konnaxion accountability output: `accountability.impact.publish/1.0.0`.
- Kristal build via Da’at: `kristal.build.request/2.0.0`.
- Kristal revision via Da’at: `kristal.revision.request/2.0.0`.

Kristal build requests pin contract set `6.0.0` and carry an immutable Orgo Work snapshot ArtifactRef.

## Idempotency

Commands require an idempotency key. Kristal artifact events may supply one; otherwise Orgo derives a stable event key from the interaction id. Replays with the same semantic request return the stored result; conflicting reuse is rejected.

## Ownership invariant

Interaction Kernel transports interactions and ArtifactRefs. It does not own Orgo Work or Kristal knowledge. Orgo is the only writer of Orgo operational state.
