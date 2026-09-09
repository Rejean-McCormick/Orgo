# Orgo — UI Architecture and Koali Integration

**Status:** Canonical direction for the Orgo vNext frontend and Koali hosting boundary.

**Delivery update:** The active frontend implements shared OrgoApp composition and a code-level hosted entry. Native Koali manifest admission and host execution remain unverified because those contract packages are not supplied. See `IMPLEMENTATION_STATUS.md`.

This document defines the intended architecture. The current Orgo web snapshot is smaller than this target and must be aligned incrementally. The UI composition is backed by the same operational model defined in `TARGET_ARCHITECTURE.md`: Signal intake, Case-centered Work, Tasks and Orchestration.

## 1. Ownership invariant

Orgo is a proprietary integrated subsystem/application. It owns its operational domain and its business UI.

Orgo owns:

- Cases, Tasks, Signals and Workflows;
- routing, escalation and operational actions;
- Orgo tenant rules and business authorization;
- Orgo routes and inner navigation;
- the Orgo Control Panel, inspectors and commands;
- Orgo presentation profiles.

Koali owns the outer hosting/composition environment when Orgo is installed there. Koali does not become the owner of Orgo business state, business authorization or UI behavior.

Required invariant:

```text
Koali --hosts--> Orgo

Koali -X-> owns Orgo business/UI
Orgo  -X-> requires Koali to function
```

Orgo must remain installable/removable as a subsystem and must remain usable standalone.

## 2. Two runtime presentation modes, one Orgo application

Orgo supports two presentation modes over the same application code and business APIs:

```text
ORGO UI
├── standalone
└── hosted by Koali
```

The hosted mode is not a second frontend. It mounts/contributes the Orgo application through the canonical Koali module interface.

Conceptual structure:

```text
orgo-ui/
  app/
  routes/
  features/
  shell/
  inspectors/
  commands/
  presentation/

  standalone-entry
  koali-module-entry
```

## 3. Koali hosting boundary

Koali Spaces already has an outer `GlobalShell`. Orgo must not introduce a second global Koali shell.

Canonical relationship:

```text
Koali Spaces
└── GlobalShell
    ├── ModuleSelector
    ├── SharedTopBar
    ├── ActiveModuleSidebar
    └── MainPageSurface
            │
            └── Orgo local_module_surface
                    │
                    └── Orgo application
```

The canonical Koali application route family is `/apps/[moduleId]/...`. Orgo contributes through the installed/admitted module manifest mechanism rather than hard-coding itself into a global product switcher.

The Koali integration concepts are the existing Koali concepts:

```text
Space
  └── module_instance
        └── Module Interface Manifest
              ├── routes
              ├── sidebar
              ├── widgets
              ├── required capabilities
              └── surface references
```

Do not create a parallel Koali taxonomy named `Product`, `SurfaceProfile` or `Capability`.

For Koali integration, use the canonical concepts such as `module`, `moduleInstance`, `surface`, `capabilityProjection` and `presentationPolicy`.

When hosted, Orgo is presented as a `local_module_surface`: a complete owner-managed application surface rendered inside the Koali environment.

## 4. Outer navigation vs inner navigation

Two navigation layers are intentional:

```text
OUTER — KOALI
ModuleSelector
Space navigation
SharedTopBar
context shortcuts

        ↓

INNER — ORGO
My Work
Cases
Tasks
Signals
Workflows
Routing
People
Organizations
Insights
Integrations
Audit
System
```

The outer shell knows which module is active. Orgo knows how work is performed inside Orgo. Do not merge both layers into one large Koali sidebar.

## 5. Orgo UI composition model

The canonical UI principle is not “build the full Control Panel and hide items for smaller interfaces.”

It is:

```text
shared Orgo UI primitives
        ↓
routes / capabilities / panels / actions
        ↓
presentation composition
        ↓
Orgo presentation profile
```

The full Control Panel is the maximal composition, not the physical parent of every reduced UI.

Orgo presentation profiles may include:

```text
Full Control Panel
Operations
My Work
Supervisor
Intake
Workflow Admin
Executive
Embedded
```

These are internal Orgo UX profiles, not Koali surface categories.

A presentation profile may control:

- its home route;
- navigation groups;
- exposed product capabilities;
- available actions;
- widgets;
- search/command scopes;
- inspector behavior;
- density and other presentation policy.

Presentation is not authorization. Backend authorization remains authoritative.

## 6. Authorization boundary

Koali may consume non-authoritative capability projections to decide presentation behavior such as:

```text
show / hide
enable / disable
choose a safe route
show unavailable
```

An Orgo mutation must still be authorized by Orgo:

```text
Koali capability projection
        ↓
presentation decision
        ↓
Orgo receives command
        ↓
Orgo revalidates
  identity
  RBAC
  tenant
  policy
        ↓
mutation
```

Do not replace Orgo RBAC with Koali RBAC. Do not assume that a Koali login/session is automatically an authorized Orgo session unless a separate SSO contract explicitly establishes that mapping.

## 7. Case-centered operational UX

`Case` is the primary operational workspace. `Task` and `Signal` remain first-class entities and transverse views, but they should not read as three unrelated applications.

```text
Signals ───────┐
Signals ───────┼──> Case
               │     ├── Tasks
               │     ├── Workflow
               │     ├── People / ownership
               │     ├── Evidence / attachments
               │     ├── Timeline
               │     └── Audit
               │
               └── contextual evolution
```

A Case workspace should make these relationships visible.

Transverse views serve different operational questions:

- **Cases:** where are situations and durable contexts?
- **Tasks:** what work must be executed?
- **Signals:** what is arriving or changing?
- **My Work:** what requires the current user's attention?

A Signal may enrich an existing Case; it is not only a one-time Case creation trigger.

## 8. Orgo Control Panel

The maximal Orgo presentation remains a large operational control panel:

```text
┌──────────────┬──────────────────────────────┬──────────────┐
│ ORGO NAV     │                              │ INSPECTOR    │
│              │                              │              │
│ My Work      │                              │ selected     │
│ Cases        │          WORKSPACE           │ entity       │
│ Tasks        │                              │              │
│ Signals      │                              │ context      │
│              │                              │ relations    │
│ Workflows    │                              │ quick actions│
│ Routing      │                              │              │
│              │                              │              │
│ People       │                              │              │
│ Insights     │                              │              │
│ Audit        │                              │              │
└──────────────┴──────────────────────────────┴──────────────┘
```

The exact inner navigation is presentation-profile dependent. Technical/admin entries such as Integrations, System, Organizations or workflow configuration should not appear to operators unless their Orgo profile and permissions require them.

There is no universal `Overview` route. Home is a presentation-profile property, for example:

```text
Operations  -> Operations Dashboard
Supervisor  -> Team Overview
My Work     -> Work Queue
Executive   -> Situation Overview
Admin       -> System Overview
```

## 9. Inspector rule

The Inspector is initially an Orgo-owned primitive. Do not modify the Koali `GlobalShell` merely to make the Inspector universal. If multiple modules later need the same contract, promotion into Koali can be considered separately.

Use three levels of depth:

```text
Row / Card
  -> summary

Inspector
  -> context
  -> quick edit
  -> quick action
  -> related entities
  -> deep link

Full Page / Workspace
  -> complex work
  -> full history
  -> structured configuration
```

The Inspector must not reproduce an entire full page in a narrow panel. It should provide a deep link to the full workspace when deeper work is required.

## 10. Command system

Orgo should have an internal command/action system suitable for fast operational work. A command registry may power buttons, context actions, bulk actions and an Orgo command launcher.

Examples:

```text
Open case…
Create case…
Assign task…
Escalate…
Search signal…
Go to workflow…
Run action…
```

Koali's `SharedTopBar` may accept module command references through its existing contracts. A global Koali `Ctrl+K` behavior is a separate architecture decision and must not be assumed by Orgo.

## 11. Konnaxion reuse rule

Konnaxion is a useful implementation reference for layout mechanics and UI patterns, including sidebar, header, mobile drawer, page shells, navigation ergonomics and dashboard density.

Do not use Konnaxion to redefine Koali's global architecture.

Correct direction:

```text
Konnaxion frame/patterns
        ↓ selective reuse/adaptation
Orgo-owned shell and UI primitives
        ↓
Orgo application
```

Incorrect direction:

```text
Konnaxion
  ↓
new KoaliShell
  ↓
Orgo
```

## 12. Integration with Kristal and other systems

UI integration does not change ownership boundaries. Orgo may expose actions/workflows that invoke Kristal or another external system through explicit adapters, operations and receipts.

Do not represent external epistemic/platform/civic state as Orgo Task/Case status merely because it is visible in the Orgo Control Panel.

The UI should display external state as referenced/provenanced external state and route mutations through the owning system's contract.

## 13. Implementation direction

Target organization (names may be adjusted to the actual framework/repository layout):

```text
apps/web/src/orgo/
├── app/
│   ├── OrgoApp
│   ├── standalone-entry
│   └── koali-module-entry
├── shell/
│   ├── OrgoShell
│   ├── OrgoNavigation
│   ├── OrgoHeader
│   ├── OrgoWorkspace
│   └── OrgoInspectorHost
├── presentation/
│   ├── full
│   ├── operations
│   ├── my-work
│   ├── supervisor
│   ├── intake
│   ├── workflow-admin
│   ├── executive
│   └── embedded
├── cases/
├── tasks/
├── signals/
├── workflows/
├── routing/
├── organization/
├── insights/
├── inspectors/
├── commands/
├── actions/
└── integration/koali/
```

Do not force this target directory structure mechanically if the current framework layout has a cleaner equivalent. The architectural boundaries are normative; exact filenames are not.

## 14. Current-state note

The current Orgo web snapshot is not yet this application. It contains useful types/screens/hooks but a small effective route tree. Build/runtime repair and core-domain stabilization should precede or accompany the UI composition work.
