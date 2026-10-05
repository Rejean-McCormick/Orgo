# Orgo v3 — Labels, Profiles and Cyclic Overview

## 1. Label format

```text
<BASE>.<CATEGORY><SUBCATEGORY>[.<HORIZONTAL_ROLE>]
```

Examples:

```text
100.94.Operations.Safety
101.11.Ops.Maintenance
```

## 2. Axes

### Base

Vertical/routing scope.

Representative individual hierarchy bases may include `1`, `2`, `11`, `101`, `1001` according to configured organizational conventions.

Reserved broadcasts:

```text
10   top-management broadcast
100  department-head broadcast
1000 staff/operational broadcast
```

### Category digit

`1..9`, information category.

### Subcategory digit

`1..5`, operational intent/classification.

### Horizontal role

Optional extensible role path such as:

```text
Ops.Maintenance
HR.CaseManagement
Education.Support
IT.Support
```

## 3. Broadcast semantics

Broadcast is informational by default.

```text
broadcast label
≠ mandatory Task
```

A workflow must explicitly create/assign work when action is required.

## 4. Label vs tags

Task/Case has one canonical routing label. Additional classifications can use label/entity tagging structures or domain metadata.

Do not overload the canonical label with every taxonomy concept.

## 5. Organization profiles

Profiles tune behavior without changing core schemas.

Current profile surfaces include:

- reactivity;
- transparency;
- pattern sensitivity;
- retention;
- automation/review defaults.

Core Task/Case services apply profile defaults. The profile does not directly write Tasks outside core mutation paths.

## 6. Cyclic overview

Cyclic overview is recurring analysis/review of Cases, Tasks and organizational patterns.

Correct operational feedback:

```text
analytics/pattern
→ threshold/rule
→ explicit Case/Task creation
→ normal routing/lifecycle
```

## 7. Charters

Semantic charters can classify domain concepts and relationships. They are orthogonal to Task/Case lifecycle.

See `../Semantic-Charters.md`.
