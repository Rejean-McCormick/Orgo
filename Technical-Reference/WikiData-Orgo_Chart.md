# Orgo × Wikidata: System documentation (charts, IDs, files, and build pipeline)

## 1) Goal and constraints

**Goal:** Orgo represents organisational knowledge (tasks, roles, cases, processes, resources) as a graph using **Wikidata-compatible identifiers** so data can stay interoperable.

**Constraints:**

* Orgo must run in a **closed/offline bubble** (no heavy external LLM dependency).
* Orgo must stay usable for **any organisation**, by composing reusable “families” + small domain specialisations.

---

## 2) What we reuse from Wikidata (and what we don’t)

### Reused “as-is”

* **QIDs (`Q…`)** for concepts/items (roles, objects, concepts, places, etc.).
* **Property IDs (`P…`)** when a property is universal enough and matches Orgo’s meaning.

### Not reused “as-is”

* Wikidata’s full statement graph is **not imported**. Orgo creates its own relations between filtered Q-items, focused on organisational workflows.

### Licensing note (data vs software)

* Wikidata data is published under **CC0 (“No rights reserved”)**, including official access channels and dumps.
* Wikibase (the software behind Wikidata) is **GPL-licensed** (software licensing is separate from data licensing).

---

## 3) Identifier spaces in Orgo

### 3.1 QIDs (concepts)

* **`Q####`**: Concepts/items aligned with Wikidata QIDs.
* Orgo maintains a **filtered subset** of Wikidata items (QIDs) relevant to organisations.

### 3.2 P (public/universal properties)

* **`P####`**: Properties identical to Wikidata property IDs when the meaning is universal and compatible.

### 3.3 R (Orgo workflow refinements of P)

R are generic Orgo workflow relations that refine a base Wikidata property.

**Rule:**

* If `based_on` is `P####`, then `id` must be `R####NNN` (3-digit sequence).

Example:

* `R710001` (default responsible for) based on `P710`
* `R710002` (assigned to) based on `P710`

### 3.4 S (Orgo-specific properties)

S are Orgo properties that **do not exist as a Wikidata P**, but where we still want numeric alignment with the closest `P####` *when possible*.

**Rules:**

1. If `based_on` is `P####`, then `id` must be `S####NNN` (3-digit sequence).

   * Example: if based on `P1552`, first specialisation is `S1552001`.
2. If `based_on` is `null`, use the reserved Orgo-only range:

   * `S0000NNN` (3-digit sequence).

---

## 4) Charter architecture (3 levels)

All charts are JSON files in a flat folder.

### Level 1: global base

* `/charters/general.json`
  Contains:
* universal **P** (reused Wikidata properties)
* universal Orgo workflow **R** (derived from P)
* universal Orgo-only **S** (no `P` match) like visibility/editability.

### Level 2: families (each refines `general.json`)

* `/charters/care.json`
* `/charters/programs.json`
* `/charters/operations.json`
* `/charters/groups.json`
* `/charters/incidents.json`

These add **family-specific S** (and rarely P/R if needed).

### Level 3: domains (each refines exactly one family)

Examples we established:

* `/charters/care_hospital.json`
* `/charters/care_school.json`
* `/charters/care_social_services.json`
* `/charters/programs_government.json`
* `/charters/programs_humanitarian.json`
* `/charters/operations_manufacturing.json`
* `/charters/operations_transport_logistics.json`
* `/charters/operations_facilities.json`
* `/charters/groups_sports.json`
* `/charters/groups_associations.json`
* `/charters/incidents_sst.json`
* `/charters/incidents_it_helpdesk.json`

**Principle:** create a Level-3 file only when the domain introduces **new relation types**, not just different wording.

---

## 5) JSON file standard (schema)

Every charter file follows the same top-level structure:

```json
{
  "P": [
    { "id": "P####", "label_en": "...", "wikidata_label_en": "..." }
  ],
  "R": [
    { "id": "R####NNN", "based_on": "P####", "label_en": "..." }
  ],
  "S": [
    { "id": "S####NNN", "based_on": "P####", "label_en": "..." },
    { "id": "S0000NNN", "based_on": null,  "label_en": "..." }
  ]
}
```

**Field rules:**

* `id`: required
* `label_en`: required (Orgo label)
* `wikidata_label_en`: optional (only meaningful for P)
* `based_on`: required for R/S; `P####` or `null`

---

## 6) Composition/inheritance rules

Orgo loads charts in this order:

1. `general.json`
2. one family chart (`care.json`, `operations.json`, etc.)
3. optional domain chart (`care_hospital.json`, etc.)

Merge behavior:

* Same `id` must not be defined twice.
* If two charts need similar semantics, they must create distinct IDs (`…001`, `…002`, …).
* Domain charts should prefer **S** that align to the closest `P####` (`S####NNN`) rather than `S0000NNN`.

---

## 7) Building Orgo’s QID subset from Wikidata (offline-friendly)

### 7.1 Input

* Wikidata dumps / exports (CC0).

### 7.2 Filtering concept

Orgo stores only the Q-items needed for organisational reasoning, using filters such as:

* “organisation/role/task/process/resource” relevance
* removal of irrelevant domains (celebrities, astronomy, etc.)
* optional domain packs (hospital, government) that add more Q-items

### 7.3 Update process (repeatable)

1. Download/refresh dump snapshot.
2. Run Orgo filters to produce:

   * `qitems_core` subset
   * optional domain subsets (e.g., hospital pack)
3. Rebuild Orgo indexes (labels, aliases, search keys).
4. Leave Orgo’s **relations graph** intact (Orgo relations are authored separately).

---

## 8) From user input to QIDs (without heavy LLM)

Orgo needs a local “lexicon layer” to map text → QIDs.

Recommended offline approach (lightweight):

* tokenization + normalization (casefolding, accents)
* dictionary/alias tables (Orgo curated)
* string similarity (Levenshtein, trigram)
* BM25-style retrieval over labels/aliases
* optional lightweight embeddings (local) if needed, but not required

Output:

* candidate QIDs with confidence scores
* user-facing disambiguation when multiple close QIDs

---

## 9) The charts we created in this conversation

Core/base:

* `/charters/general.json`

Families:

* `/charters/care.json`
* `/charters/programs.json`
* `/charters/operations.json`
* `/charters/groups.json`
* `/charters/incidents.json`

Domains already drafted:

* `/charters/care_hospital.json`
* `/charters/care_school.json`
* `/charters/care_social_services.json`

(Other domain paths are part of the target architecture; their content follows the same standard.)

---

## 10) Naming/numbering summary (the “hard rules”)

* **P**: `P####` (Wikidata property IDs)
* **R**: `R####NNN` where `####` = base P number, `NNN` = 001..999
* **S**:

  * `S####NNN` if based on `P####`
  * `S0000NNN` if `based_on = null`
* Domain/family/general are **file-level**, not encoded in the ID.

