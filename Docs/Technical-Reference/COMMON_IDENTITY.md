# Common identity and login profile

**Status:** Orgo implementation profile for the kOA common identity contract.

## Decision

Orgo remains **standalone-first** and supports optional OIDC federation without sharing passwords or authorization state with Konnaxion or UCKK-Moodle.

```text
local login
+ optional OIDC login
+ explicit issuer/subject mapping
+ Orgo-local roles and permissions
```

## Canonical federated identity

A federated login is resolved from the validated pair:

```text
issuer + subject
```

Email and display name are attributes only. Orgo never auto-links or auto-provisions an SSO identity from an email claim.

## Current implementation

The Orgo identity layer provides:

- local email/password login;
- local account recovery and invitations;
- OIDC Authorization Code flow with PKCE and nonce;
- validation of issuer, audience/authorized party, signature and token time bounds;
- explicit `SsoIdentity` records mapping an organization + issuer + subject to an Orgo user;
- Orgo-local RBAC after authentication;
- local API/service tokens separate from human SSO sessions.

Linking the same configured `issuer + subject` twice to the same local user is idempotent. Linking it to another local user returns `SSO_IDENTITY_CONFLICT`.

## Standalone behavior

OIDC is optional. A local Orgo user with a password can continue to use local login even when an SSO identity is linked.

If the IdP is unavailable:

- existing Orgo sessions follow normal session policy;
- new SSO login may fail;
- local login remains available for local accounts;
- no role or permission is fetched from Konnaxion or Moodle.

An organization may later adopt a stricter federated-login policy, but administrative recovery must remain documented separately.

## Configuration

```dotenv
ORGO_PUBLIC_URL=https://orgo.example.org
OIDC_ISSUER=https://identity.example.org
OIDC_CLIENT_ID=orgo
OIDC_CLIENT_SECRET=
OIDC_DISPLAY_NAME=kOA Identity
```

`OIDC_CLIENT_SECRET` is optional for public clients/configurations where the IdP permits it.

Production OIDC URLs require HTTPS. For local development only, Orgo permits `http://localhost` and `http://127.0.0.1` OIDC/public URLs when `NODE_ENV` is not `production`.

## Login UI

When the OIDC configuration is complete, the login screen shows both:

```text
email/password login
Se connecter avec <OIDC_DISPLAY_NAME>
```

The organization slug is still required because Orgo authorization and account mapping are organization-scoped.

## Administrative linking

Administrators with `identity:manage` use the existing `identity/sso` endpoints.

The issuer is server-configured through `OIDC_ISSUER`; an administrator supplies the local `user_id` and the IdP `subject`.

Orgo does not silently merge identities by email.

## Local authorization

Successful OIDC authentication only identifies the local Orgo user. Authorization is then computed from Orgo memberships, roles, scoped grants and permissions.

```text
OIDC issuer/sub
    -> Orgo user
    -> Orgo organization
    -> Orgo role assignments
    -> Orgo permissions
```

Konnaxion roles and Moodle roles/capabilities are not accepted as Orgo permissions by implication.

## Service identities

Human OIDC sessions are not integration credentials. UCKK adapters, Konnaxion bridges, workers and other machine-to-machine integrations use Orgo API tokens or dedicated provider credentials with explicit scopes.

## kOA contract

The ecosystem-level source of truth is intended to live in:

```text
kOA_Digital_Ecosystem/docs/2-Technical-Reference/40-integration/identity-oidc/
```

Normative ecosystem decision: `docs/2-Technical-Reference/90-reference/adr/adr-0006-common-identity-oidc.md`.

This document describes Orgo's implementation of that profile.
