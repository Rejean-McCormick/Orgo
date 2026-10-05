# Orgo — completion implementation decisions (2026-09-09)

This document records concrete refinements to the target architecture. It accompanies executable source; it is not a replacement target or a claim of completed local acceptance.

## Durable orchestration

`WorkflowService` still evaluates a frozen workflow version and commits its internal actions and external intents in a transaction. `ACTIONS_COMMITTED` does not mean external validation succeeded. The new `START_PROCESS` action creates a `DurableProcess` in that same transaction. The process also has its own authenticated HTTP creation endpoint.

A process freezes a plan and its hash, subject and tenant. Its worker executes ordered integration, human-approval and timer steps. The durable states are `RUNNING`, `WAITING_EXTERNAL`, `WAITING_HUMAN`, `WAITING_TIMER`, `BLOCKED`, `COMPLETED`, `CANCELLED`. Steps record results; transitions increment an optimistic revision. Polling rotation touches `updated_at` without continually invalidating a human's revision. Process locks serialize decisions and advancement.

Each integration step can declare `expect`, a map of paths within the final receipt's `data` to primitive expected values. A validation requirement must explicitly state its predicate, for example `{"expect":{"validated":true}}`. A transport success alone is not an approval. Predicate mismatch blocks the process. The supplied validate/publish example requires both a positive validation receipt and human approval.

The integration bridge can return `accepted` or `succeeded`. `accepted` leaves the operation running until an authenticated final callback. Callbacks require both `integrations:callback` and the provider permission, such as `kristal:callback`. Use a dedicated tenant token with these permissions, not an administrator session. Conflicting terminal receipts are rejected. `REQUEST_INTEGRATION` remains available independently of processes.

External timeouts block. Retrying an outbox failure preserves the original operation identity. A callback that explicitly reports a final failure requires a deliberate new process if the operator wishes to make a new external request. Pending operations are never automatically duplicated. Cancelling a process stops its orchestration; it cannot undo or retract an already-dispatched external request. A compensation is a separate reversed plan assembled only from successful steps that explicitly declare compensation requests. A still-pending external request must settle before compensation. Compensation requests must be supported by the configured provider adapter; none are fabricated.

The initiating user's or API token's current permissions are reloaded when the worker advances. A revoked principal blocks the process. An authorized operator with `workflows:manage` may adopt a blocked process, with a reason and revision; adoption does not implicitly approve or retry a step.

## Work scope and evidence

Global roles keep their existing meaning. Existing scoped `UserRoleAssignment` rows now contribute explicit `workGrants` for team, location, unit or custom references. Only explicit `work:*` permissions are activated from scoped roles; a scoped wildcard never grants administration rights. Scope assignment APIs require the role to contain `work:read`. Role grants and scopes are included in idempotency fingerprints.

Tasks and Cases have dedicated `access_scope_type` and `access_scope_reference` columns. They are not authorization fields hidden inside arbitrary metadata. Both must be present or both absent. Read filters, restricted visibility and parent visibility are enforced together. Each mutation checks its permission against the actual subject scope. Task and parent Case scopes must match. Scope references are administrator-defined identifiers, not a claim that a separate organizational hierarchy engine has been implemented.

Evidence uses a Work-owned table with bounded database content (1 MiB per file), a SHA-256 digest, filename, media type and audit event. Downloads require current subject access and are forced to file download by the UI. Deletion is a tombstone. Explicit retention can purge tombstoned bytes while retaining the digest and immutable audit trail. Large-file object storage and antivirus services are extension points, not bundled services.

Typed Work relations are references. `blocks` is visible relationship data; it does not silently introduce a new Task lifecycle rule. Task reparenting preserves restricted visibility when leaving a restricted Case. Archived Cases and terminal Tasks reject applicable edits. Title/description edits, case edits, paged timelines and attachment UI are connected.

## Identity and account lifecycle

Local login uses scrypt and hashed opaque sessions. Password creation/reset never caches plaintext secrets in command responses. Account-creation idempotency fingerprints the identity fields, not the password; replaying account creation does not change its original credentials. Password changes have a separate authenticated endpoint and terminate existing sessions.

API-token secrets are returned only in the initial successful response and are not stored in the idempotency response. If that response is lost, the caller can see the token metadata, revoke it, and issue another token. Invitations and recovery links are single-use, hashed at rest in the challenge table and expire after one hour. The delivery queue necessarily holds the link while it is being delivered; retention and access to notification storage must reflect that. The browser receives the challenge in a URL fragment, removes it from browser history, and submits it over the API.

OIDC is optional: one configured HTTPS issuer, authorization code flow, S256 PKCE, browser-bound HttpOnly state cookie, nonce, RS256 signatures using discovered JWKS, issuer/audience/authorized-party/time checks, and explicit tenant + issuer + subject enrollment. No email-based auto-linking occurs. Unknown subjects are rejected. Supported deployments use the web's same-origin API proxy and HTTPS. Provider logout, SAML, SCIM and automatic enrollment are not implied.

References for the implemented protocol subset:
- https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation
- https://www.rfc-editor.org/rfc/rfc7636.html

Login, recovery and SSO limits use PostgreSQL buckets shared across API instances. Expired buckets and OIDC attempts are cleaned by the worker.

## Domains, communication and read side

Maintenance exposes assets, task creation and non-overlapping asset reservations with explicit calendar transitions. HR exposes restricted Case/Task creation, participants, review transitions and wellbeing records. HR review status remains separate from the operational Case lifecycle. Education exposes groups, scoped person validation, membership lifecycle and linked support tasks. No new domain code writes raw Task/Case tables.

Notification templates use plain-text interpolation with required named values and no expression evaluation. In-app and SMTP remain native channels. SMS and webhook delivery use optional, fixed operator-configured gateway endpoints with stable idempotency keys; these are gateway contracts, not compatibility claims for a chosen vendor. The gateway must report delivery explicitly. Browser push is not represented as implemented.

The Python MIME adapter supports individual EML files, mbox imports and IMAP polling using TLS. Messages are bounded before parsing/fetching; attachments are bounded and are never executed or rendered as trusted HTML. A message is marked Seen only after durable Orgo acceptance. Failures remain available for retry. Tenant authority comes only from the API token, never mail headers. Intake stores a compact Signal plus a separate immutable normalized email envelope/attachments, rather than passing attachment bytes into the workflow evaluator.

Insights retains one PostgreSQL/Prisma read side with visibility-aware queries. CSV export, indexed pagination, operational gauges and structured request spans are implemented. A materialized warehouse is unnecessary for correctness and is not presented as completed merely because a target diagram mentions projections.

## UI and ecosystem

Additional routes use shared forms and product-owned components. Workflow plans, permission arrays and free-form integration payloads retain structured JSON editors where their values are inherently structured. Ordinary domain/account fields have labeled controls. An explicit per-account local command queue supports preview, export, delivery and conflict correction; it never stores authentication tokens and does not silently replace a failed online mutation with apparent success.

The hosted entry exports `OrgoApp`, `orgoSurface` and a permission-filtered command inventory. `orgo-surface/v1` is an Orgo-owned contract, not an invented Koali standard. A host imports the entry and Orgo styles and supplies routing. Actual Koali/Capsule contract packages and native provider protocols were not supplied in this workspace. Their final adapters/manifests must be based on those real contracts, not guessed names or shapes.
