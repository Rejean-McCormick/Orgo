# Konvergence → Orgo seed adapter

The Konvergence universe package declares its `koa-orgo-sim/v1` material as an editorial simulation contract, not a native Orgo runtime seed. This adapter deliberately converts only the operational `orgo/examples/cases.json` subset into the existing controlled `orgo.scenario.v1` injector contract.

It preserves source identity/provenance in metadata (`source_case_id`, `origin_world`, `origin_topic`, `source_status`, `konvergence_owner_ref`) and does not fabricate Orgo user UUID assignments from editorial actor IDs.

```bash
node tools/konvergence-seed/build-scenario.mjs \
  /path/to/Konnaxion-Koali-Konvergence-Universe-1.0.0/orgo/examples/cases.json \
  validation/kor-orgo-konvergence/konvergence.scenario.json

node tools/scenario-injector/cli.mjs validate validation/kor-orgo-konvergence/konvergence.scenario.json
node tools/scenario-injector/cli.mjs inject validation/kor-orgo-konvergence/konvergence.scenario.json --apply
```

The editorial workflow JSON files are retained as source material. They are not silently promoted to executable Orgo workflows because the source package explicitly does not claim runtime compatibility.
