# Konnaxion ↔ Orgo Interaction Kernel local qualification

This kit qualifies the main-product path after the Worlds separation:

`DecisionRecord -> governance.decision.execute -> Signal -> WorkflowVersion -> Case + Task -> accountability.impact.publish -> OrgoImpactPublication`

It intentionally does not use `Konnaxion_Worlds` or `Orgo_Worlds` as business-runtime owners.

## Prerequisites

- Windows + PowerShell 7 (`pwsh`)
- Docker Desktop running
- repositories at:
  - `C:\mycode\Konnaxion\Konnaxion`
  - `C:\mycode\Orgo\Orgo`
- existing Konnaxion local env files under `backend\.envs\.local\`
- Orgo `.env` with the correct existing PostgreSQL password if an existing volume is reused

## 1. Prepare local runtime

From any directory:

```powershell
pwsh -NoProfile -File C:\mycode\Orgo\Orgo\validation\konnaxion-orgo-ik\prepare-local.ps1
```

The script:

1. configures the IK routing variables;
2. starts/migrates/seeds Orgo;
3. publishes `konnaxion_decision_v1`;
4. issues a dedicated Orgo API token for Konnaxion;
5. writes the token/organization UUID to Konnaxion's existing local env;
6. migrates/recreates Konnaxion Django + Celery;
7. verifies container-to-container reachability through `host.docker.internal`.

Secrets are written to the local environment files and are not printed.

## 2. Run the E2E

```powershell
pwsh -NoProfile -File C:\mycode\Orgo\Orgo\validation\konnaxion-orgo-ik\run-e2e.ps1
```

The runner proves:

- one published immutable Konnaxion DecisionRecord;
- one durable Konnaxion InteractionEmission;
- Orgo admission under the authenticated organization;
- exactly one Orgo Signal;
- worker processing to exactly one Case and one Task;
- one Konnaxion IntegrationOperation reaching `SUCCEEDED`;
- exactly one Konnaxion OrgoImpactPublication;
- semantic replay does not duplicate Signal or impact;
- divergent content with the same idempotency key returns `IK_IDEMPOTENCY_CONFLICT` / HTTP 409.

The runtime script does not mark the integration qualified unless all assertions pass.

## Narrow repository tests

Konnaxion:

```powershell
cd C:\mycode\Konnaxion\Konnaxion\backend
pytest konnaxion/ethikos/tests/test_interaction_kernel_contract.py konnaxion/ethikos/tests/test_interaction_kernel_runtime.py
```

Orgo (with a dedicated `TEST_DATABASE_URL` / `DATABASE_URL` as required by the repo):

```powershell
cd C:\mycode\Orgo\Orgo
npm run test
npm run test:integration
npm run check:architecture
```

The cross-product E2E remains separate from the repositories' general qualification status.
