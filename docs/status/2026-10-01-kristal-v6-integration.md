# 2026-10-01 — Kristal v6 / Interaction Kernel alignment

## Scope

This snapshot updates Orgo's knowledge boundary to the ecosystem's Kristal Standard `6.0.0` and IK Kristal profiles `2.0.0` without changing Orgo's ownership of Cases, Tasks, Signals, workflows or RBAC.

## Implemented

- `kristal` integration operation `build` now becomes `kristal.build.request/2.0.0` to Da’at through Interaction Kernel;
- `revise` becomes `kristal.revision.request/2.0.0`;
- build requests pin `kristal_contract_set = 6.0.0`;
- Orgo freezes the selected Case/Task into a content-digested `orgo.case_snapshot` / `orgo.task_snapshot` ArtifactRef inside the IntegrationOperation;
- `kristal.artifact.ready/2.0.0` is accepted inbound and becomes an Orgo Signal;
- returned `record_role` / `actionability` summaries are preserved as Signal metadata for deterministic routing;
- human-review and human-decision requirements remain explicit;
- `automatic` actionability does not bypass Orgo workflow/RBAC admission.

## Environment

Outbound Da’at/IK:

- `DAAT_IK_URL`;
- `DAAT_IK_TOKEN`.

Inbound artifact routing:

- `KRISTAL_ARTIFACT_LABEL` — required before subscribing Orgo;
- `KRISTAL_ARTIFACT_WORKFLOW_CODE` — optional;
- `KRISTAL_ARTIFACT_TYPE`, `KRISTAL_ARTIFACT_CATEGORY`, `KRISTAL_ARTIFACT_SEVERITY` — optional route defaults.

## Non-goals

- Orgo does not become the owner of Kristal State;
- Kristal/Da’at do not write Orgo Cases or Tasks;
- no distributed transaction is added;
- Orgo_Worlds does not receive IK/Kristal runtime code.
