# Orgo — documentation alignment 2026-09-16

## Scope

Documentation-only alignment with the current kOA Digital Ecosystem / Interaction Kernel / Kristal v5 integration model. No executable source or release tag is modified by this package.

## Status

Current snapshot: generic bridge implemented; IK/Da’at is a documented migration target, not claimed implemented.

## Changes applied

- clarified Orgo ownership versus Konnaxion, Kristal/Da’at and kOA-Linux;
- aligned Konnaxion handoff with `governance.decision.execute/1.0.0`;
- aligned outbound impact publication with `accountability.impact.publish/1.0.0`;
- documented Da’at as the target/current boundary for new Kristal v5 build/revision work as supported by the snapshot;
- retained direct `Kristal validate` generic bridge as compatibility-only and explicitly separated Orgo process predicates from Kristal compile semantics;
- aligned Kristal baseline to `5.0.0-rc.1` and Working/Reference separation;
- documented kOA Build Record v2 / Release Record v2 semantic separation;
- documented physical Runtime Pack activation as deployment-owned, with kOA-Linux owning it when present;
- corrected stale Signal/model wording;
- reclassified `v3/1-Orgo v3 - Database Schema Reference.md` as a historical v3 baseline rather than current schema authority;
- extended local acceptance guidance for IK/idempotency/Da’at/Build-Release compatibility.

## Important non-claims

This documentation package does not by itself prove provider interoperability, IK conformance, Da’at/Kristal execution, vendored schema byte identity or deployment acceptance. Those require the executable repository and the validation procedures described in `Technical-Reference/LOCAL_VALIDATION.md`.
