# Orgo — Kristal v6 migration

Date: 2026-10-01

## Runtime changes

- `kristal` operations now use Da’at through Interaction Kernel rather than the retired direct Kristal validation bridge.
- `build` emits `kristal.build.request/2.0.0` and pins Kristal Standard `6.0.0`.
- `revise` emits `kristal.revision.request/2.0.0`.
- every build automatically freezes the selected Case/Task as an immutable content-digested ArtifactRef stored with the IntegrationOperation; delivery remains post-commit.
- inbound `kristal.artifact.ready/2.0.0` becomes an Orgo Signal and preserves returned artifact refs.
- `record_role` and `actionability` summaries are exposed in Signal metadata for ordinary Orgo workflow routing.
- `automatic` never bypasses Orgo RBAC/workflow admission; `human_review` and `human_decision` remain explicit human gates.

## Configuration

Use `DAAT_IK_URL` / `DAAT_IK_TOKEN` for outbound Kristal builds/revisions. Configure `KRISTAL_ARTIFACT_LABEL` before subscribing Orgo to artifact-ready events; `KRISTAL_ARTIFACT_WORKFLOW_CODE` is optional.

## Ownership preserved

Orgo remains the only writer of Orgo operational Work. Kristal remains owner of its canonical knowledge/state artifacts. Da’at maps; Interaction Kernel transports. No distributed transaction or shared mutable database was introduced.
