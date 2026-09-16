# Orgo — ecosystem integration documentation alignment, 2026-09-16

This is a documentation-only alignment. It does not change the tested application commit or promote a release.

## Current snapshot

- Generic Orgo per-provider bridge: implemented/documented.
- Native Interaction Kernel Konnaxion adapter: not claimed in this snapshot.
- Native IK/Da’at Kristal adapter: not claimed in this snapshot.
- Target ownership model: Orgo commits operational state locally, exports immutable snapshots/references post-commit, and retains opaque artifact references/receipts rather than canonical Kristal payloads.
- Runtime Pack physical activation ownership: external platform concern; kOA-Linux owns it when deployed.

## Target contracts recorded during alignment

- `governance.decision.execute/1.0.0`;
- `accountability.impact.publish/1.0.0`;
- `kristal.build.request/1.0.0`;
- `kristal.revision.request/1.0.0`;
- kOA Build Record v2 / Release Record v2 semantics;
- no distributed transaction or bidirectional database synchronization across Orgo, IK, Da’at and Kristal.

These names describe target ecosystem contracts considered during the alignment. The current repository does not include a normative `INTERACTION_KERNEL.md`, and this status note is not implementation evidence for those native contracts. Current implemented integration behavior is documented in `../Technical-Reference/INTEGRATION_BRIDGE.md`, with ownership boundaries in `../Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`.
