> **Implementation update (2026-09-15).** The common-identity changes described here are present in the current development tree and are covered by current unit/integration evidence plus the E16/E17 browser UI contract. Real external IdP interoperability remains a separate acceptance boundary. See `2026-09-15-current-status.md`.

# Orgo — common identity login update

## Scope

This update aligns Orgo login behavior with the kOA common identity architecture without changing the Prisma schema or removing local authentication.

## Changes

- keep local email/password login available;
- preserve explicit `issuer + subject` SSO mappings;
- expose the common identity profile in `GET /auth/sso/config`;
- add a configurable SSO button label through `OIDC_DISPLAY_NAME`;
- reject attempts to link the same federated identity to two different Orgo users with `SSO_IDENTITY_CONFLICT`;
- make exact replay of the same SSO link idempotent;
- update `last_login_at` for successful local or federated sessions;
- allow HTTP OIDC/public URLs only for localhost in non-production, enabling a local development IdP without weakening production HTTPS enforcement;
- add unit and integration coverage for the common identity invariants.

## Non-changes

- no Prisma migration;
- no shared user database;
- no password synchronization;
- no email-based auto-linking;
- no JIT SSO provisioning;
- no mapping of Konnaxion or Moodle roles into Orgo permissions;
- no change to the RC1 tag.

## Validation status

The 2026-09-15 development baseline passed the relevant automated evidence:

- TypeScript checks;
- 16/16 unit tests, including OIDC URL-policy tests;
- 33/33 native PostgreSQL integration tests;
- production API/web builds;
- browser E16 with the real local API proving local login remains available when SSO is unconfigured;
- browser E17 proving that advertising the SSO option does not remove local-login controls.

E17 deliberately mocks only the public SSO configuration response. Discovery, JWKS, authorization-code exchange and interoperability with a real Identity Provider are not claimed by this browser result.

## kOA conformance pointer

Canonical ecosystem profile:

```text
kOA_Digital_Ecosystem/docs/2-Technical-Reference/40-integration/identity-oidc/
```

Architecture decision:

```text
kOA_Digital_Ecosystem/docs/2-Technical-Reference/90-reference/adr/adr-0006-common-identity-oidc.md
```
