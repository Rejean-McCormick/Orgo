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

## Validation target

Run the normal Orgo gates after applying the overlay:

```text
npm run typecheck
npm run test
npm run test:integration
npm run build
```

Integration tests require a dedicated PostgreSQL test/validation database as documented by Orgo.

## kOA conformance pointer

Canonical ecosystem profile:

```text
kOA_Digital_Ecosystem/docs/2-Technical-Reference/40-integration/identity-oidc/
```

Architecture decision:

```text
kOA_Digital_Ecosystem/docs/2-Technical-Reference/90-reference/adr/adr-0006-common-identity-oidc.md
```

