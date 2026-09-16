# Orgo — Interaction Kernel integration target

**Status:** target migration profile for the current Orgo snapshot, 2026-09-16  
**Implementation claim:** **NOT IMPLEMENTED/NOT VERIFIED in this supplied snapshot**  
**Target protocol:** `ik/1.1`  
**Kristal target baseline:** `5.0.0-rc.1` / commit `af703bf02ee04a69a5f2ad6694fa8b8e56ae2b19`

This document aligns Orgo's external-integration target with the current kOA Digital Ecosystem contracts without claiming code that is absent from this snapshot. The existing generic Orgo bridge remains the implemented compatibility boundary described by `INTEGRATION_BRIDGE.md`.

## 1. Ownership

Interaction Kernel (IK) is a distributed boundary protocol. It does not introduce a second Orgo lifecycle, a second outbox, or shared cross-system state.

Orgo remains owner of:

- Signal;
- Workflow / WorkflowVersion;
- Case / Task;
- IntegrationOperation;
- Orgo outbox/delivery state.

Konnaxion, Kristal, SemantiK Architect and kOA-Linux retain their own authoritative states.

## 2. Target Konnaxion → Orgo profile

The target direct handoff is:

```text
Konnaxion finalized DecisionRecord
  -> governance.decision.execute/1.0.0
  -> Orgo IK admission
  -> Orgo Signal
  -> pinned WorkflowVersion
  -> Case / Tasks
```

Konnaxion never names an Orgo Case or Task by identity. Orgo resolves accepted intent into Orgo-owned workflow state.

## 3. Target Orgo → Konnaxion profile

Durable impact/accountability publication maps to:

```text
accountability.impact.publish/1.0.0
```

Orgo should reuse its existing `IntegrationOperation` + Outbox + receipt/reconciliation machinery. `accepted` is not terminal success. Retry/redrive must preserve the same logical idempotency identity.

## 4. Target Kristal boundary

New Kristal v5 workflows target **Da’at**, not a direct native Kristal assumption. Initial kOA profiles are:

- `kristal.build.request/1.0.0`;
- `kristal.revision.request/1.0.0`.

The current generic `Kristal validate` bridge remains compatibility-only until the IK/Da’at adapter is implemented and proven. An Orgo validation predicate may block an Orgo workflow step; it does **not** define Kristal's global compilation order. Kristal v5 permits a Working Exchange before final validation/recognition when the active Kristal policy permits it.

## 5. Artifact interchange

The target uses source-owned ArtifactRefs / exports rather than copying canonical external payloads into Orgo Case/Task state. Artifact references do not transfer ownership, validation status or authority recognition.

## 6. kOA Build/Release records

The aligned ecosystem contracts are **Build Record v2** and **Release Record v2**. Orgo integrations must keep these axes separate:

```text
compile_status
validation_status
recognition_status
publication_status
activation_status
```

A Working Exchange may exist even when reference/publication eligibility is not satisfied. Orgo should store Kristal outputs as opaque references and must not translate Kristal epistemic state into Task/Case status by implication.

## 7. Runtime Pack activation

Orgo may request or track an operational activation task, but it does not own the physical Runtime Pack activation state. The deployment has exactly one activation owner; with kOA-Linux, kOA-Linux owns verify/stage/activate/rollback/recovery state.

## 8. Migration acceptance

Do not mark this target implemented until evidence proves:

1. IK envelope/Profile validation;
2. same-idempotency/same-fingerprint replay and divergent-fingerprint conflict behavior;
3. finalized DecisionRecord -> one Orgo Signal/work consequence;
4. outbound accountability publication with terminal reconciliation;
5. Da’at/Kristal v5 mapping and exact dependency pin;
6. Build/Release v2 compatibility;
7. no competing Runtime Pack activation owner.
