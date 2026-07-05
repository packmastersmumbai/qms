---
title: Implement Warehouse Floorplan & Location Module for PM QMS
---

> **Required Skill**: You MUST use and analyse `gas-warehouse-floorplan` skill before doing any modification to this task file or starting implementation.
>
> Skill location: `.claude/skills/gas-warehouse-floorplan/SKILL.md`

## Initial User Prompt

Make the GRN form compact and usable with minimal taps, then (expanded through design
discussion) build a full warehouse location system:

- Emphasize storage location; allow mapping a location via QR.
- A visual floorplan layout selector was considered, then dropped in favour of a compact
  minimal tile selector (Floor → Section → Aisle → Rack/Pallet → Shelf → Bin), each level
  with a defined capacity; let the user choose Rack vs Pallet.
- A Floorplan Creator / LEGO-style toolbar builder: click icon tools (Floor, Section, Aisle,
  Rack, Pallet, Shelf, Bin) to build the plan one block at a time into the active parent;
  drag-drop with grid + edge snap and auto-nest by containment; per-floor canvases.
- Each building block configurable with capacity in a base unit — dimensions drive everything
  (L×W×H → volume in m³/ltr, weight in kg via density, or count).
- Drill-down navigation: click a section to see its internals in a side pane / minimap that
  zooms in; keep drilling Rack → Shelf → Bin; leaf shows capacity + "put stock here".
- Define a product's storage by its most basic storage unit using the researched universal
  method: base-UOM ladder (each dimensions + weight, eaches per case, TI×HI pallet stacking);
  location holds anything that physically fits; capacity = min(volume, weight). Handles labels
  (many/light, volume-bound), rolls (bulky/light, volume-bound), and 27 kg FG boxes 4×4 on a
  pallet (weight-bound) with one model.
- Reconcile with the real PM QMS masters: extend MASTERS_Materials (currently 5 cols:
  code/desc/unit/category/defaultLocation) with base-UOM storage columns F→M, seeded from
  category and QC weight params (QP014/QP021); add a new MASTERS_Floorplan location-tree sheet
  seeded from the shared 04 floorplan.jpg; wire the location picker into GRN and STOCK_LEDGER.

Full design, decisions, schema, capacity method, and 8 interactive mockups are captured in
FLOORPLAN-MODULE.design.md and qmsv2-mockups/16–23. Aesthetic: architectural blueprint
matching the PM ISO print house-style; SVG + CSS only (GAS double-iframe blocks CDN scripts);
native BarcodeDetector for QR.

### Requirements (reconciled 2026-07-05 — supersedes conflicting parts of the original prompt above)

Re-brainstormed against four stated goals: **easily identify locations, manage inventory
visually, record material movement, instant stock view for the whole warehouse.**

**Key finding — most of the backend already exists (verified in source, not memory):**
- `Warehouse.js` (747 lines): `STOCK_LEDGER` (scalar qty, running balance), all four movements
  (`recordScan`, `recordLocationTransfer`, `issueRMForProduction`, GRN putaway + FIFO dispatch),
  and rollups `getStockView`, `getStockSummary`, `getStockByMaterial`, `getLowStockItems`,
  `getLocations`, `saveLocation`.
- `Scan.js` (711 lines): QR scan infra — `recordScan`, `whereIsLot`, `SCAN_RECEIVE/MOVE/SHIP`.
- `LOCATIONS` sheet exists (12 cols incl. Floor col B, Type col I, capacityQty/Unit cols J/K
  currently empty & unused) — seeded today with 8 logical zones, NOT physical pallet slots.
- `MASTERS_Materials`: 5 cols only (A code, B desc, C unit, D category, E defaultLocation);
  **zero geometry**. `saveMaterial` (Masters.js:350) builds a fixed 5-element row.

Therefore this is mostly the **missing visual layer over an existing backend**, NOT a new WMS.
The self-referential `MASTERS_Floorplan` tree from the original prompt is DROPPED — the flat
`LOCATIONS` sheet is sufficient. IQC is NOT redesigned — material geometry belongs at material
creation, not at receipt.

**Decision: two phases. Phase 1 delivers all four goals; Phase 2 adds slot suggestion.**

#### Phase 1 — Location seed + visual map (delivers all four goals)
1. **Reseed `LOCATIONS` as real pallet positions**, counted from the shared `04 floorplan.jpg`
   (this plan is the **1st floor**). 148 positions total:
   | Bay (label) | Zone on plan | Count | Type |
   |---|---|---|---|
   | A | Bulk RM | 25 | RM |
   | B | Packaging strip | 4 | PM |
   | C | Packaging upper block | 42 | PM |
   | D | Packaging lower block | 42 | PM |
   | E | Finished Goods | 21 | FG |
   | F | Buffer Pallets | 14 | FG |
   - **Location ID = floor letter + sequential number**: `B001`–`B148` (A=ground, B=1st,
     C=2nd floor). Regex `^[ABC]\d{3}$`. QR is location-based, no symbols, short.
   - **Bay is a display/grouping column only** — for human understanding and map grouping,
     NOT parsed from the ID and NOT used in any capacity/fit calculation. Renumbering a bay
     never changes an ID.
   - Floor lives in existing col B; Type in existing col I. Counts C/D (=42 each) are
     floorplan pixel-reads — **verify on the floor** before go-live.
2. **One new file — `WarehouseFloorplan.html`** (blueprint aesthetic, SVG+CSS, light+dark):
   - To-scale map from the floorplan (positions placed from the plan; optional posX/Y columns
     added later if placement needs sharpening — auto-grid fallback until then).
   - **Heatmap**: per-position occupied/empty (Phase 1 capacity = **1 pallet per slot** — a
     slot holds one pallet, so fullness = occupied ÷ total, no volume math needed).
   - **Tap a position** → what's stored there (from `getStockView`).
   - **Search a lot** → `whereIsLot` highlights the position.
   - **KPI strip**: `getStockSummary` + `getLowStockItems` (warehouse % full, alerts).
   - Movement fallback: tile-pick a position when scan unavailable, calling the **existing**
     `recordScan` / `recordLocationTransfer` / `issueRMForProduction` — no new movement backend.

#### Phase 2 — Material geometry + optimal-slot suggestion (later; not one of the 4 goals)
3. **Extend `MASTERS_Materials` cols F→L** for storage geometry, configured **at material
   creation** (the material create/edit form), NOT at IQC:
   `F baseUnit, G eachL, H eachW, I eachH, J eachWeight, K perPallet (TI×HI), L fitClass`.
   - `eachVolume` = L×W×H is computed, not stored. `fitClass` (WEIGHT|VOLUME) is a display hint
     only — `min(volume,weight)` computes the true ceiling regardless.
   - Categories are **loose**, so category-seeding is unreliable → fill per-material at creation;
     backfill existing catalogue once via the same form.
   - **Regression fix required first:** `saveMaterial` (Masters.js:350) writes a fixed 5-element
     row that truncates F→L. Pad the writer to 12 cols (write by column) before adding fields.
4. **Fit engine `min(volume, weight)`** + **`suggestSlot(material, qty)`** in `Warehouse.js`:
   walk open positions, keep those that fit, prefer a slot already holding the same material
   (consolidate), return best. Worker taps **Accept** → movement recorded. Minimum-tap putaway.
   - Since Phase-1 slots are "1 pallet each", geometry's role is converting a receipt qty into
     **pallet count** (qty ÷ perPallet) = how many slots to consume.
   - One runnable check: assert suggestSlot prefers the consolidating slot over an emptier
     separate one, and that a 27kg pack goes weight-bound while empty cans go volume-bound.

**Explicitly NOT built** (YAGNI): `MASTERS_Floorplan` tree, LEGO builder/drag-drop authoring,
IQC form redesign, per-material location capacity (slots are 1-pallet), posX/Y coords (add only
if auto-grid placement is wrong). Aesthetic + QR constraints unchanged from above.

## Description

The PM QMS already records stock and material movements in a scalar ledger with QR-scan
infrastructure and a `LOCATIONS` sheet, but it has no spatial or visual representation of the
warehouse. Locations today are 8 logical zones rather than physical pallet positions, so the
warehouse's occupancy, the physical whereabouts of any given lot, and which pallet slots are
free are all invisible — staff must walk the floor and mis-placement risk is unmanaged. This
task adds the missing **visual layer over the existing backend** (it is not a new WMS) so that
ledger data becomes spatially actionable.

The work delivers four operational goals: **(1) easily identify where a material or lot is,
(2) manage inventory visually, (3) record a material movement even when scanning is
unavailable, and (4) get an instant, warehouse-wide stock view.** It is split into two phases.
**Phase 1 delivers all four goals** by reseeding `LOCATIONS` into 148 real per-pallet positions
(`B001`–`B148`, one floor) and adding a single new blueprint-style floorplan map that shows an
occupancy heatmap, position contents, lot search, a KPI strip, and a tile-pick movement
fallback — all wired to the existing stock/movement/scan backend, which is reused verbatim with
no new movement backend written. **Phase 2 (later, not one of the four goals)** adds per-material
storage geometry captured at material creation and an optimal-slot suggestion for minimum-tap
putaway.

Primary users are warehouse operators (find, place, and move stock), supervisors and managers
(occupancy and low-stock at a glance), and the QMS as a whole (accurate location data feeding
traceability). Key constraints: the GAS double-iframe blocks CDN scripts, so the map is SVG+CSS
only with native `BarcodeDetector` for QR; it must render in light and dark themes in an
architectural-blueprint aesthetic matching the PM ISO print house-style; location IDs must match
`^[ABC]\d{3}$`; the Bay is a display/grouping attribute only and is never parsed from the ID nor
used in any capacity calculation; and in Phase 1 a slot holds exactly one pallet.

**Scope**:
- Included (Phase 1): reseed `LOCATIONS` to 148 pallet positions (`B001`–`B148`) across bays
  A–F with Floor, Type, and Bay grouping columns; one new floorplan map view with occupancy
  heatmap, tap-position-to-contents, lot search highlight, KPI strip, and a tile-pick movement
  fallback that reuses the existing backend.
- Included (Phase 2, later): extend `MASTERS_Materials` with storage-geometry columns entered
  at material creation; fix the `saveMaterial` truncation regression first; add the fit engine
  and optimal-slot suggestion.
- Excluded (YAGNI): `MASTERS_Floorplan` self-referential tree, LEGO/drag-drop authoring builder,
  IQC form redesign, per-material location capacity, posX/Y coordinates (add only if auto-grid
  placement proves wrong), any new stock/movement/scan backend, and category-based geometry
  seeding.

**User Scenarios**:
1. **Primary Flow**: A manager opens the floorplan map and instantly sees all 148 positions
   grouped by bay with an occupancy heatmap and a KPI strip (% full, low-stock alerts); an
   operator searches a lot to highlight its position, taps a position to see its contents, and —
   when the scanner is unavailable — tile-picks a position to record a movement.
2. **Alternative Flow**: On an empty warehouse all positions render empty at 0% full; in Phase 2,
   receiving stock triggers an optimal-slot suggestion the operator accepts to record the move.
3. **Error Handling**: A lot search with no match shows "Lot not found"; tapping an empty
   position shows an empty state; an unsupported `BarcodeDetector` falls back to tile-pick; a
   full warehouse with no free slot shows "No available position"; and any floorplan count
   mismatch found during floor verification is corrected before go-live.

---

## Acceptance Criteria

### Functional Requirements — Phase 1 (delivers all four goals)

- [ ] **Location reseed count & format**: `LOCATIONS` contains real per-pallet positions.
  - Given the reseed has run
  - When the `LOCATIONS` sheet is inspected
  - Then it holds exactly 148 rows with contiguous, unique IDs `B001`–`B148`, every ID matching
    `^[ABC]\d{3}$`.

- [ ] **Bay distribution & columns**: bays are grouped and typed correctly.
  - Given the reseeded `LOCATIONS`
  - When rows are grouped by Bay
  - Then bay counts are A=25 (RM), B=4 (PM), C=42 (PM), D=42 (PM), E=21 (FG), F=14 (FG); Floor is
    stored in the Floor column, Type in the Type column, and Bay in a display/grouping column that
    is never parsed from the ID nor used in any capacity calculation.

- [ ] **Floor-count verification before go-live**: pixel-read counts are confirmed physically.
  - Given the floorplan-derived counts (notably bays C and D at 42 each)
  - When the positions are verified against the physical floor before go-live
  - Then any mismatch is corrected in the seed and the map reflects the corrected count.

- [ ] **Map renders in both themes without CDN scripts**: the floorplan view is a single new map.
  - Given the floorplan map view is opened inside the GAS double-iframe
  - When it loads in light theme and in dark theme
  - Then all 148 positions render grouped by bay in an architectural-blueprint aesthetic using
    only SVG and CSS, with no external/CDN scripts required.

- [ ] **Occupancy heatmap and % full**: occupancy is glanceable (goal: manage inventory visually).
  - Given N of the 148 positions hold stock (one pallet per slot)
  - When the map renders
  - Then exactly N positions display as occupied and the remaining (148 − N) as empty, and the
    warehouse fullness reads N ÷ 148.

- [ ] **Tap a position shows its contents** (goal: easily identify locations).
  - Given a position that holds known stock
  - When the user taps that position
  - Then the stored material, lot, and quantity are shown from the existing stock view; tapping a
    position with no stock shows an empty state.

- [ ] **Lot search highlights its position** (goal: easily identify locations).
  - Given a lot stored at a known position
  - When the user searches that lot ID
  - Then the map highlights exactly that position; searching an unknown lot shows a "Lot not
    found" message and highlights nothing.

- [ ] **KPI strip shows instant warehouse view** (goal: instant warehouse-wide stock view).
  - Given the map is open
  - When the KPI strip renders
  - Then it displays warehouse % full and low-stock alerts drawn from the existing stock summary
    and low-stock rollups.

- [ ] **Tile-pick movement fallback** (goal: record material movement).
  - Given scanning is unavailable
  - When the user tile-picks a position and confirms a movement
  - Then the movement is recorded through the existing scan/transfer/issue backend and the ledger
    reflects the move, with no new movement backend introduced; if no free position exists the
    system shows "No available position".

### Functional Requirements — Phase 2 (later; not one of the four goals)

- [ ] **`saveMaterial` truncation regression fixed first**: the material writer preserves all columns.
  - Given a material is created or edited
  - When it is saved
  - Then all 12 columns are written by column so the new geometry columns are not truncated, and
    existing materials still save correctly.

- [ ] **Material storage geometry at creation**: geometry is captured on the material form.
  - Given the material create/edit form
  - When a material is saved
  - Then base unit, each dimensions, each weight, per-pallet count, and fit class are stored;
    each-volume is computed (not stored) and fit class is a display hint only.

- [ ] **Fit engine and optimal-slot suggestion**: minimum-tap putaway.
  - Given a material with stored geometry and a receipt quantity
  - When an optimal slot is requested
  - Then the system computes the capacity ceiling as the minimum of the volume-bound and
    weight-bound limits, walks open positions keeping those that fit, prefers a slot already
    holding the same material (consolidation) over an emptier separate slot, and returns the best;
    accepting the suggestion records the movement.

### Non-Functional Requirements

- [ ] **Compatibility**: the map renders inside the GAS double-iframe using SVG+CSS only (no
  CDN/external scripts) and in both light and dark themes.
- [ ] **Aesthetic**: the map follows the architectural-blueprint / PM ISO print house-style.
- [ ] **Backend reuse**: no new stock, movement, or scan backend is written in Phase 1; existing
  functions are reused verbatim.
- [ ] **Data integrity**: every location ID satisfies `^[ABC]\d{3}$`; counts are verified against
  the physical floor before go-live.

### Definition of Done

- [ ] All Phase 1 acceptance criteria pass
- [ ] Phase 2 acceptance criteria pass (when Phase 2 is implemented)
- [ ] Tests written and passing
- [ ] Documentation updated

---

## Architecture Overview

> Synthesized from: skill `.claude/skills/gas-warehouse-floorplan/SKILL.md`, analysis
> `.specs/analysis/analysis-warehouse-floorplan.md`, scratchpad `.specs/scratchpad/ac281f09.md`.

### Solution Strategy

This is a **thin presentation (view) layer over the existing, verified GAS service layer — not a
new WMS**. `Warehouse.js` and `Scan.js` already own the ledger, all four movements, and every
rollup; they are reused **verbatim**. The architecture pattern is **layered read-only presentation
over an existing service layer**, matching the established codebase convention: `*_F.html`
HtmlService templates render and call `*.js` service functions through async `google.script.run`
(precedent: `Landing.html` → `getLandingBundleV3Fast`, `Records_F.html` → `getRecordsList`). One new
template — `WarehouseFloorplan.html` — renders a CDN-free inline-SVG blueprint map whose slot fills,
KPI strip, lot search, and tile-pick movement are all derived live from existing reads/writes.

**Phase 1** (all four goals) = a `LOCATIONS` reseed (148 pallet slots `B001`–`B148`) **plus** the
new map, wired via a `Code.js` pageMap entry and a `QMSV2_F.html` cockpit tile. **Phase 2** (later)
adds per-material geometry columns to `MASTERS_Materials` and a `suggestSlot` fit engine — strictly
gated behind first repairing the `saveMaterial` truncation regression.

**Key decisions & trade-offs:**
1. **Reuse backend verbatim; write zero new movement/stock/scan code in P1.** Trade-off: accept the
   existing scalar-ledger and chokepoint model rather than an ideal WMS schema — correct per YAGNI
   and the "visual layer, not new WMS" mandate.
2. **Reseed EXTENDS, never REPLACES (RISK-2).** Add `B001`–`B148` and KEEP all 8 legacy zone IDs
   (`RM-STORE-A/B`, `QUARANTINE`, `FG-STORE`, `FG-HOLD`, `SCRAP-AREA`, `SAMPLE-CABINET`,
   `REWORK-AREA`), which are hardcoded across IQC/OQC/NCR/CustomerReturn/Rework/`_J07` and 3
   `Scan.js` chokepoint rows. Seed is idempotent so `Initialize.js:552` reset keeps both sets.
   Trade-off: `LOCATIONS` holds two conceptual kinds of row (logical zones + physical slots); the
   map filters to `^[ABC]\d{3}$` slots, zones stay invisible to it.
3. **Type every slot at the source AND harden `inferLocType` (RISK-1).** Every `B###` seed row sets
   col I `Type` from a bay→type map (A=RM; B/C/D=PM; E/F=FG); additionally extend
   `inferLocType` (`Warehouse.js:329`) with a floor-letter→type fallback so `getStockView`
   colouring never resolves to `''` even for an untyped row. Defence-in-depth, not either/or.
4. **Tile-pick putaway routes through `recordLocationTransfer`, never `recordScan`.** `recordScan`
   validates against 4 chokepoint IDs only and would reject free `B###` slots. Trade-off: none —
   `recordLocationTransfer` is the correct existing entry point for free-tile moves.
5. **`saveMaterial` becomes a 12-col by-index read-modify-write BEFORE any P2 field is added
   (RISK-3).** The current fixed 5-element row silently truncates F→L on every edit; `getMaterials`
   widens to 12 cols in lockstep. This is the hard gate for Phase 2.
6. **Flat `LOCATIONS` sheet, auto-grid placement fallback.** Drop the self-referential
   `MASTERS_Floorplan` tree; render via `posX/posY` if present else CSS auto-grid. YAGNI for a
   single-building warehouse.

### Architecture Decomposition

| Component | Responsibility | Dependencies | Reuses From |
|---|---|---|---|
| `WarehouseFloorplan.html` (NEW) | Blueprint SVG+CSS map: heatmap, tap→PIP contents, lot-search highlight, KPI strip, tile-pick movement, native `BarcodeDetector` w/ fallback; light+dark | `getStockView`, `getStockSummary`, `getLowStockItems`, `whereIsLot`, `recordLocationTransfer`, `issueRMForProduction` | New — no existing map; consumes existing reads/writes only |
| `LOCATIONS_SEED` reseed (P1) | Add 148 `B001`–`B148` rows (Floor col B, Type col I, Bay grouping col), keep 8 zones | `Initialize.js` seed runner | Extend `Initialize.js:107` |
| `inferLocType` hardening (P1) | Floor-letter→type fallback so untyped rows still colour | — | Adapt `Warehouse.js:329` |
| `pageMap` + cockpit tile (P1) | Route `WarehouseFloorplan.html`; add nav tile | `doGet`/`createTemplateFromFile` (no new plumbing) | Add `Code.js:~270` entry + `QMSV2_F.html` tile |
| `saveMaterial` 12-col writer (P2 gate) | Read-modify-write by column index, pad to 12 | `getMaterials` (widen) | Adapt `Masters.js:350` + `Masters.js:14` |
| `MASTERS_Materials` F→L geometry (P2) | Store baseUnit, each L/W/H, each weight, perPallet (TI×HI), fitClass at material creation | 12-col writer above | Extend material create/edit form |
| `suggestSlot` fit engine (P2) | `min(volume,weight)` ceiling; walk open slots; prefer consolidating slot; return best | `getLocations`, geometry cols | New — no existing fit engine; movement stays `recordLocationTransfer` |

Interaction (P1):

```
WarehouseFloorplan.html
   │  google.script.run (async, .withSuccessHandler)
   ├─► getStockView ──────┐
   ├─► getStockSummary    ├─► render: <rect> heatmap fill + KPI strip + PIP
   ├─► getLowStockItems ──┘
   ├─► whereIsLot(lot) ──────► highlight slot id
   └─► recordLocationTransfer(lot,from,to,qty) ──► STOCK_LEDGER append ──► re-read getStockView
```

### Building Block View (WarehouseFloorplan.html)

```
┌──────────────── WarehouseFloorplan.html ────────────────┐
│  KPI strip (%-full, low-stock alerts)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ SVG map  │  │ lot      │  │ tile-pick│                │
│  │ + heatmap│  │ search   │  │ movement │                │
│  │ (rects)  │  │ highlight│  │ + QR/    │                │
│  └────┬─────┘  └────┬─────┘  │ fallback │                │
│       │             │        └────┬─────┘                │
│       └──────► PIP detail overlay ◄┘  (tap slot → contents)│
└──────────────────────────────────────────────────────────┘
        all data via google.script.run → existing *.js services
```

### Runtime Scenarios

**Heatmap render (goals 2 & 4):**
```
open map ─► getStockView + getStockSummary + getLowStockItems
        ─► map id→occupancy over 148 B### slots
        ─► set <rect> fill class (occupied/empty), N÷148 fullness ─► KPI strip
```

**Tile-pick movement (goal 3, scanner unavailable):**
```
BarcodeDetector absent ─► showTilePicker ─► tap slot ─► confirm move
   ─► recordLocationTransfer(lot, fromLoc, toLoc, qty)   [NOT recordScan]
   ─► STOCK_LEDGER append ─► re-read getStockView ─► map refreshes
   (no free slot ─► "No available position")
```

**Lot search (goal 1):** `whereIsLot(lot)` → hit: highlight that slot; miss: "Lot not found".

### Contracts

Reused (verbatim, async via `google.script.run.withSuccessHandler`):
```
getStockView()                → [{ id/location, material, lot, qty, type, ... }]
getStockSummary()             → { percentFull, ... }
getLowStockItems()            → [{ material, qty, ... }]
getLocations(typeFilter?)     → [{ id, floor, type, ..., capacityQty, capacityUnit, active }]
whereIsLot(lotId)             → { location } | null      // Scan.js
recordLocationTransfer(lot, fromLoc, toLoc, qty)         // tile-pick movement
issueRMForProduction(...)                                // RM issue fallback
```

Phase 2 new:
```
suggestSlot(materialCode, qty) → { slotId, palletsNeeded, bound: 'VOLUME'|'WEIGHT' } | null
  // capacity = min(floor(loc.volume/eachVolume), floor(loc.maxWeight/eachWeight))
  // palletsNeeded = ceil(qty / (TI*HI)); prefer slot already holding same material
```
Data (P2 `MASTERS_Materials` cols): `F baseUnit, G eachL, H eachW, I eachH, J eachWeight,
K perPallet(TI×HI), L fitClass`. `eachVolume` = L·W·H computed, never stored. Location ID regex
`^[ABC]\d{3}$`; Bay is a display/grouping column, never parsed from the ID nor used in fit math.

### Expected Changes

```
WarehouseFloorplan.html   # NEW (P1): blueprint SVG+CSS map, heatmap, PIP, lot search, KPI,
                          #           tile-pick + BarcodeDetector fallback; light+dark
Code.js                   # MODIFY (P1): pageMap entry (~line 270) + cockpit nav route
QMSV2_F.html              # MODIFY (P1): cockpit tile linking to the floorplan map
Initialize.js             # MODIFY (P1): LOCATIONS_SEED (line 107) — ADD B001–B148 (keep 8 zones)
Warehouse.js              # MODIFY (P1): inferLocType (329) floor-letter→type fallback [RISK-1]
                          # MODIFY (P2): add suggestSlot + min(volume,weight) fit engine
Masters.js                # MODIFY (P2, GATE FIRST): saveMaterial (350) 5→12-col by-index writer
                          #                          [RISK-3]; getMaterials (14) widen to 12 cols;
                          #                          ensureMaterialsLocationColumn_ (75) seed F→L
```
Explicitly NOT changed: no new stock/movement/scan backend; `computePendingCounts_`,
GRN putaway, and the 8 legacy zone IDs are untouched (zones kept, not replaced).

### Architecture Decisions

**AD-1: Reseed extends `LOCATIONS`, never replaces it.**
Status: Accepted. Context: 8 legacy zone IDs are hardcoded across reject/return/rework flows +
3 Scan chokepoints (RISK-2). Options: (1) replace zones with slots, (2) add slots keep zones,
(3) new sheet for slots. Decision: (2) — add `B001`–`B148`, keep all zones, idempotent seed.
Consequences: reject/return/rework unaffected; map filters to `^[ABC]\d{3}$`; reset re-run safe.

**AD-2: Tile-pick movement uses `recordLocationTransfer`, not `recordScan`.**
Status: Accepted. Context: `recordScan` validates only 4 chokepoint IDs and rejects free `B###`.
Options: extend chokepoint list vs use transfer API. Decision: `recordLocationTransfer`.
Consequences: no chokepoint changes; free-tile moves recorded through the correct existing path.

**AD-3: `saveMaterial` 12-col writer is the Phase-2 gate.**
Status: Accepted. Context: fixed 5-element row truncates F→L on edit (RISK-3). Options: add cols
then fix vs fix first. Decision: convert to 12-col by-index read-modify-write BEFORE adding
geometry fields; widen `getMaterials`. Consequences: geometry survives edits; ordering enforced.

---

## Implementation Process

> Scratchpad: `.specs/scratchpad/00c46d54.md` · Parallelization: `.specs/scratchpad/34bc9650.md`

### Parallel Execution Directive

You MUST launch a separate agent for each step, instead of performing steps yourself. For each set of steps marked "Parallel with", you MUST launch those agents **in parallel** (single message, multiple Agent tool calls).

**CRITICAL — for each agent you MUST:**
1. Use the exact **Agent** type named in the step (e.g. `developer`, `opus`, `code-reviewer`).
2. Pass the path to this task file and tell the agent exactly which step number to implement.
3. Require the agent to implement that step only — not more, not less, not other steps.
4. Respect dependencies: never launch a step until every step in its "Depends on" list has completed and its runnable check is green.
5. **Shared-file note**: Step 1 and Step 6 both edit `Warehouse.js` (different functions — `inferLocType:329` vs new `suggestSlot`). They run in different time-groups so there is no concurrency conflict; still, the Step 6 agent MUST re-read `Warehouse.js` before editing.

### Parallelization Overview

Two independent chains run in parallel. P1 (1→2→3) is a shippable slice; P2 (4→5→6) is gated internally (Step 4 blocks Step 5, RISK-3). Max parallel width = 2.

```
        t0                          t1                          t2                   t3
  ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
  │   Step 1    │            │   Step 2    │            │   Step 3    │
  │  Reseed +   │──────────▶ │ Floorplan   │──────────▶ │ pageMap +   │────┐
  │ inferLocType│  (P1 chain)│  SVG map    │  (P1 chain)│ cockpit tile│    │
  │ [developer] │            │   [opus]    │            │ [developer] │    │
  └─────────────┘            └─────────────┘            └─────────────┘    │
        ║ parallel                 ║ parallel                 ║ parallel   │   ┌──────────────┐
  ┌─────────────┐            ┌─────────────┐            ┌─────────────┐    ├──▶│  Convergence │
  │   Step 4    │            │   Step 5    │            │   Step 6    │    │   │ code review  │
  │ saveMaterial│──────────▶ │ F→L geometry│──────────▶ │ suggestSlot │────┘   │ both chains  │
  │ 12-col GATE │  (P2 chain)│  on form    │  (P2 chain)│  fit engine │        │[code-reviewer]│
  │   [opus]    │  STRICT ──▶│ [developer] │            │   [opus]    │        └──────────────┘
  └─────────────┘            └─────────────┘            └─────────────┘
   Depends: none              Depends: Step 4            Depends: Step 5
```

### Implementation Strategy

**Approach**: Mixed (bottom-up for data/backend, inside-out for the map view).
**Rationale**: The data foundation (LOCATIONS seed + type resolution) must exist and resolve
correctly before the map can render or colour anything, so build it first (bottom-up). The map
itself is wired data-first, then interactions layered on (inside-out). Phase 1 (Steps 1–3) is an
independently shippable vertical slice delivering all four goals; Phase 2 (Steps 4–6) is gated and
opens with the `saveMaterial` regression fix, which **blocks** the geometry-columns step.

### Phase Overview

```
PHASE 1 (ship first — all four goals)          PHASE 2 (later, gated)
  Step 1  Reseed + inferLocType (Foundation)      Step 4  saveMaterial 12-col writer (GATE)
     │                                                │
     ▼                                                ▼
  Step 2  WarehouseFloorplan.html (User-facing)    Step 5  MASTERS_Materials F→L geometry
     │                                                │
     ▼                                                ▼
  Step 3  pageMap + cockpit tile (Integration)     Step 6  suggestSlot fit engine + assert
```

Phase-1 chain and Phase-2 chain are independent; Phase 2 may begin any time but its internal order
(4 → 5 → 6) is strict.

---

### Step 1: Reseed LOCATIONS to 148 pallet slots + harden `inferLocType`

**Model:** sonnet · **Agent:** `developer` · **Depends on:** None · **Parallel with:** Step 4 (P2 chain head)

**Goal**: Make 148 physical pallet positions (`B001`–`B148`) exist in `LOCATIONS` with correct
Floor/Type/Bay, keeping all 8 legacy zones, and guarantee every slot resolves to a non-empty Type
even if a row is untyped (RISK-1 defence-in-depth).

#### Expected Output
- `Initialize.js` `LOCATIONS_SEED` (line 107) extended with 148 `B###` rows (8 zones preserved).
- `Warehouse.js` `inferLocType` (line 329) with a floor-letter→type fallback.

#### Success Criteria
- [ ] `Initialize.js` `LOCATIONS_SEED` contains 148 `B###` rows **AND** all 8 original zone rows (`RM-STORE-A/B`, `QUARANTINE`, `FG-STORE`, `FG-HOLD`, `SCRAP-AREA`, `SAMPLE-CABINET`, `REWORK-AREA`) — 156 rows total.
- [ ] IDs are contiguous and unique `B001`–`B148`; every `B###` ID matches `^[ABC]\d{3}$` (zero-padded).
- [ ] Bay counts: A=25, B=4, C=42, D=42, E=21, F=14 (sum = 148); each row's col I `Type` = A→RM, B/C/D→PM, E/F→FG; Floor stored in col B (`'1'` / 1st-floor letter); Bay stored in a display/grouping column and **not** parsed from the ID.
- [ ] Seed is idempotent — re-running the `Initialize.js:552` reset does not duplicate rows or drop the 8 zones.
- [ ] `inferLocType('B999')` returns a non-empty type (floor-letter fallback), so `getStockView` colouring never resolves to `''` for a `B###` row even when col I is blank.

#### Subtasks
- [ ] Generate the 148 `B###` rows (bay→type map, per-bay counts) and append to `LOCATIONS_SEED` in `Initialize.js` — do NOT remove the 8 zone rows.
- [ ] Choose the Bay display column (reuse `Section` or `Label` col) consistently; document which.
- [ ] Add floor-letter→type fallback branch to `inferLocType` (`Warehouse.js:329`).
- [ ] Write a runnable GAS check `_testLocationSeed()` asserting: 156 rows, 148 unique `^B\d{3}$`, bay counts, all Types non-empty, 8 zones present.
- [ ] Run the reseed on a scratch/test sheet and confirm counts; add "verify C & D = 42 each against the physical floor before go-live" to DoD.

#### Blockers
- Physical floor-count verification for bays C and D (pixel-reads) — **manual, cannot be code-verified**; must happen before go-live.

#### Risks
- **RISK-2 (HIGH)**: wholesale replace breaks reject/return/rework + 3 Scan chokepoints → Mitigation: ADD-only, idempotent seed, `_testLocationSeed` asserts 8 zones survive.
- **RISK-1 (HIGH)**: `B`-prefix → `''` type → Mitigation: set col I on every row AND the `inferLocType` fallback (both).

**Complexity**: Medium · **Uncertainty**: Low · **Dependencies**: none · **Integration Points**: `getStockView`/`getLocations` read this seed.

#### Verification

**Level:** ✅✅ CRITICAL — Panel of 2 Judges with Aggregated Voting (median)
**Artifacts:** `Initialize.js` (`LOCATIONS_SEED` ~line 107), `Warehouse.js` (`inferLocType` line 329), `_testLocationSeed()`
**Threshold:** 4.0/5.0
**Rationale:** HIGH criticality — RISK-1 (untyped `B` rows miscolour the heatmap) and RISK-2 (a wholesale replace breaks reject/return/rework flows + 3 Scan chokepoints). Two judges cross-check the ADD-only, idempotent seed.

**Checklist:**

| ID | Question | Category | Importance |
|----|----------|----------|------------|
| HR-1 | Does `LOCATIONS_SEED` contain exactly 148 `B###` rows PLUS all 8 legacy zone rows (156 total), with none of the 8 zones removed? | hard_rule | essential |
| HR-2 | Are the `B` IDs contiguous and unique `B001`–`B148`, zero-padded, every one matching `^[ABC]\d{3}$`? | hard_rule | essential |
| HR-3 | Do bay counts sum correctly to A=25, B=4, C=42, D=42, E=21, F=14 (=148)? | hard_rule | essential |
| HR-4 | Does every `B###` row set col I `Type` per the bay→type map (A→RM, B/C/D→PM, E/F→FG) and store Floor in col B? | hard_rule | essential |
| HR-5 | Is Bay stored in a documented display/grouping column and NEVER parsed from the ID nor used in any capacity calculation? | hard_rule | essential |
| HR-6 | Is the seed idempotent — does re-running the `Initialize.js:552` reset neither duplicate rows nor drop the 8 zones? | hard_rule | essential |
| HR-7 | Does `inferLocType('B999')` (or any untyped `B###`) return a non-empty type via a floor-letter fallback? | hard_rule | essential |
| HR-8 | Does `_testLocationSeed()` exist and assert: 156 rows, 148 unique `^B\d{3}$`, bay counts, all Types non-empty, 8 zones present? | hard_rule | essential |
| P-1 | Is the bay→type map defined once (single source) rather than duplicated per bay block? | principle | important |
| PIT-1 | Does the change delete, rename, or overwrite any of the 8 legacy zone IDs (RISK-2 anti-pattern)? | principle | pitfall |
| PIT-2 | Is Bay ever parsed back out of the location ID anywhere (violates ID/display separation)? | principle | pitfall |

**Regular Checks:**

- [ ] `clasp push` succeeds (no syntax error that breaks the deploy)
- [ ] `_testLocationSeed()` runs green in the GAS editor
- [ ] No code duplication: bay→type map and row generation not copy-pasted per bay
- [ ] Reuse honored: extends `Initialize.js:107` seed and adapts `Warehouse.js:329`; no parallel seed function created
- [ ] Every `test_matrix` row (main + edge + error) has a corresponding assert in `_testLocationSeed()`
- [ ] Every entry in **Test Cases to Cover** has an implemented assert

**Rubric:**

| Criterion | Weight |
|-----------|--------|
| Seed Correctness (count/format/bay) | 0.30 |
| Non-Destructive Extension (RISK-2) | 0.25 |
| Type Resolution Defence-in-Depth (RISK-1) | 0.20 |
| Runnable Assert Coverage | 0.10 |
| Project Guidelines Alignment | 0.15 |

**Rubric Score Definitions:**

##### Seed Correctness (count/format/bay)

Does the seed produce exactly 148 contiguous zero-padded `B001`–`B148` slots with the correct per-bay counts, Type, and Floor columns?

Judge counts generated rows, checks the regex, and tallies each bay against A=25/B=4/C=42/D=42/E=21/F=14.

Score Definitions
- 1: Wrong total, non-contiguous, or IDs not matching `^[ABC]\d{3}$` (e.g. `B1` not `B001`).
- 2: 148 rows but at least one bay count wrong or Floor/Type column mis-placed (DEFAULT — must justify higher).
- 3: All 148 IDs correct, contiguous, zero-padded; all bay counts and Type/Floor columns exact.
- 4: All of 3 AND `_testLocationSeed()` asserts every count/regex/type with evidence it ran green (IDEAL).
- 5: All of 4 AND counts driven from a single declarative bay table so a floor re-verify is a one-line edit (OVERLY PERFECT).

##### Non-Destructive Extension (RISK-2)

Does the reseed ADD slots while preserving all 8 legacy zone IDs and remaining idempotent on reset?

Judge confirms the 8 zone rows still exist post-seed and that a second reset run neither duplicates nor drops rows.

Score Definitions
- 1: Any legacy zone ID removed/renamed, or seed duplicates rows on re-run.
- 2: Zones kept but seed is not idempotent (re-run duplicates) (DEFAULT — must justify higher).
- 3: All 8 zones preserved AND seed idempotent on reset.
- 4: All of 3 AND `_testLocationSeed()` explicitly asserts the 8 zones survive (IDEAL).
- 5: All of 4 AND idempotency proven by an upsert-by-ID guard, not a length check (OVERLY PERFECT).

##### Type Resolution Defence-in-Depth (RISK-1)

Do both defences exist — col I Type set per row AND an `inferLocType` floor-letter fallback — so a `B###` slot never resolves to `''`?

Judge checks that Type is written on every seed row AND that `inferLocType('B999')` returns non-empty.

Score Definitions
- 1: Neither defence present, or a `B###` row can resolve to `''` type.
- 2: Only one of the two defences present (DEFAULT — must justify higher).
- 3: Both defences present; Type per row AND floor-letter fallback returns non-empty.
- 4: Both present AND fallback is asserted by a runnable check (IDEAL).
- 5: Fallback covers all three floor letters A/B/C with an assert per letter (OVERLY PERFECT).

##### Runnable Assert Coverage

Does `_testLocationSeed()` mechanically prove the success criteria rather than relying on manual inspection?

Score Definitions
- 1: No `_test` function.
- 2: Function exists but asserts only row count (DEFAULT).
- 3: Asserts count + regex + bay counts + zones present.
- 4: Adds Type-non-empty and idempotency asserts (IDEAL).
- 5: Also asserts the manual floor-verify TODO is surfaced in the seed comment/DoD (OVERLY PERFECT).

##### Project Guidelines Alignment

Does the change honor CLAUDE.md GAS conventions and `.claude/rules/` (early-return, no generic dumping-ground helpers, library-first)?

Score Definitions
- 1: Violates a GAS gotcha or `.claude/rules` (e.g. nested arrow code, generic `utils`).
- 2: One style-only deviation (DEFAULT).
- 3: No high-criticality violations; minor style only.
- 4: All applicable rules honored with citations (IDEAL).
- 5: Proactively strengthens a convention (OVERLY PERFECT).

**Test Strategy:**

**Artifact:** `Initialize.js` LOCATIONS_SEED + `Warehouse.js` inferLocType
**Criticality:** HIGH

**Test Matrix:**

| Type | Size | Framework | Dependencies | Gate |
|------|------|-----------|--------------|------|
| unit (GAS assert) | small | `_testLocationSeed()` runnable in GAS editor | scratch/test LOCATIONS sheet | Gate 1 |

**Test Cases to Cover**

##### Location reseed count & format
- [unit] `_testLocationSeed` asserts exactly 156 rows total (148 `B###` + 8 zones) [EP: correct total]
- [unit] asserts 148 unique IDs all matching `^B\d{3}$`, contiguous B001–B148 [BVA: B001 first, B148 last]
- [unit] asserts `B001` is zero-padded (rejects `B1`) [BVA: padding boundary]

##### Bay distribution & columns
- [unit] asserts bay counts A=25,B=4,C=42,D=42,E=21,F=14 and sum=148 [decision table: bay→count]
- [unit] asserts col I Type = A→RM, B/C/D→PM, E/F→FG for a sample row per bay [decision table: bay→type]
- [unit] asserts Bay column is populated but ID contains no bay letter parse dependency [error path: ID/display separation]

##### Data integrity (RISK-1/RISK-2)
- [unit] asserts all 8 legacy zone IDs still present after seed [error path: non-destructive]
- [unit] asserts re-running reset yields 156 rows again, no duplicates [idempotency]
- [unit] asserts `inferLocType('B999')` returns non-empty [error path: untyped fallback]

##### Floor-count verification before go-live
- [manual] verify bays C and D = 42 each against the physical floor before go-live (cannot be code-verified; DoD gate)

---

### Step 2: Build `WarehouseFloorplan.html` (blueprint SVG map, all four goals)

**Model:** opus · **Agent:** `opus` · **Depends on:** Step 1 · **Parallel with:** Step 5

**Goal**: One new CDN-free SVG+CSS blueprint map that renders the 148 slots grouped by bay with an
occupancy heatmap, tap-to-inspect, lot search, KPI strip, and a tile-pick movement fallback — all
reading/writing existing backend functions verbatim.

#### Expected Output
- `WarehouseFloorplan.html` (NEW) — inline SVG+CSS+vanilla JS, light+dark.

#### Success Criteria
- [ ] File loads inside the GAS double-iframe with **no external/CDN `<script src>`**; all 148 `^[ABC]\d{3}$` slots render grouped by bay (zone rows filtered out) in both light theme and `:root[data-theme="dark"]`.
- [ ] Heatmap: for N occupied slots (1 pallet/slot from `getStockView`), exactly N render occupied and 148−N empty; warehouse fullness reads N÷148.
- [ ] Tapping a slot opens a PIP showing material/lot/qty from `getStockView`; tapping an empty slot shows an empty state.
- [ ] Lot search calls `whereIsLot(lot)` — a hit highlights exactly that slot; a miss shows "Lot not found" and highlights nothing.
- [ ] KPI strip renders warehouse % full and low-stock alerts from `getStockSummary` + `getLowStockItems`.
- [ ] Tile-pick confirm calls `recordLocationTransfer(lot, from, to, qty)` (**never `recordScan`**); ledger reflects the move and the map re-reads `getStockView`; no free slot → "No available position".
- [ ] `BarcodeDetector` is feature-detected; absent → tile-pick fallback (no dead scan on Firefox/Safari/iOS).
- [ ] No new stock/movement/scan backend function is added (NFR: backend reuse).

#### Subtasks
- [ ] Static SVG map: `<g id="plan">` transform layer, `<rect>` per slot, auto-grid fallback placement (`repeat(auto-fill,minmax(84px,1fr))`), bay grouping.
- [ ] Theme tokens under `:root` + `@media(prefers-color-scheme:dark)` + `:root[data-theme="dark"]`; occupancy 5-stop scale.
- [ ] Wire `getStockView`/`getStockSummary`/`getLowStockItems` via `google.script.run.withSuccessHandler`; build id→occupancy map; set rect fill classes + KPI strip.
- [ ] PIP overlay on tap (with reduced-motion guard); empty-state.
- [ ] Lot search input → `whereIsLot` → highlight / "Lot not found".
- [ ] Tile-pick flow → `recordLocationTransfer` → re-read; "No available position" guard.
- [ ] `BarcodeDetector` feature-detect + `getUserMedia` video + fallback to `showTilePicker`.
- [ ] Verify in-iframe with `playwright-cli` screenshot (light + dark).

#### Blockers
- Step 1 must be complete (slots must exist and be typed to render/colour).

#### Risks
- **QR (Medium uncertainty)**: `BarcodeDetector` unsupported on many browsers → mandatory tile-pick fallback (already required).
- **Step size (Large)**: if it exceeds Large in practice, split at the QR/tile-pick boundary into "2a static+heatmap+tap+search+KPI" and "2b tile-pick+QR movement". Do NOT ship 2a without a movement path.

**Complexity**: Large · **Uncertainty**: Medium · **Dependencies**: Step 1 · **Integration Points**: all existing reads + `recordLocationTransfer`/`issueRMForProduction`.

#### Verification

**Level:** ✅ Single Judge
**Artifact:** `WarehouseFloorplan.html` (NEW)
**Threshold:** 4.0/5.0
**Rationale:** MEDIUM — user-facing view with no data write except the tile-pick, which reuses the existing backend. Single judge with manual playwright-cli QA (the GAS double-iframe blocks any automated component test).

**Checklist:**

| ID | Question | Category | Importance |
|----|----------|----------|------------|
| HR-1 | Does the file contain NO external/CDN `<script src>` (SVG+CSS+inline JS only)? | hard_rule | essential |
| HR-2 | Do all 148 `^[ABC]\d{3}$` slots render grouped by bay, with legacy zone rows filtered out? | hard_rule | essential |
| HR-3 | Does it render correctly in both light theme and `:root[data-theme="dark"]`? | hard_rule | essential |
| HR-4 | For N occupied slots from `getStockView`, do exactly N render occupied and 148−N empty, with fullness = N÷148? | hard_rule | essential |
| HR-5 | Does tapping a slot open a PIP with material/lot/qty, and an empty slot show an empty state? | hard_rule | important |
| HR-6 | Does lot search call `whereIsLot(lot)` — hit highlights that slot, miss shows "Lot not found" and highlights nothing? | hard_rule | essential |
| HR-7 | Does the KPI strip render % full + low-stock alerts from `getStockSummary` + `getLowStockItems`? | hard_rule | important |
| HR-8 | Does tile-pick confirm call `recordLocationTransfer(lot,from,to,qty)` and NEVER `recordScan`? | hard_rule | essential |
| HR-9 | Does "no free slot" show "No available position"? | hard_rule | important |
| HR-10 | Is `BarcodeDetector` feature-detected, falling back to tile-pick when absent? | hard_rule | essential |
| HR-11 | Is NO new stock/movement/scan backend function added (backend reuse verbatim)? | hard_rule | essential |
| P-1 | Are all `google.script.run` calls async via `.withSuccessHandler` (never expecting a return value)? | principle | important |
| PIT-1 | Does it use `@media (hover:none)` show/hide (unreliable in the GAS double-iframe per CLAUDE.md)? | principle | pitfall |
| PIT-2 | Does it attempt `window.parent.document` access (cross-origin blocked)? | principle | pitfall |

**Regular Checks:**

- [ ] `clasp push` succeeds and the page loads in-iframe
- [ ] `playwright-cli screenshot` captured in BOTH light and dark themes
- [ ] Reuse honored: consumes `getStockView`/`getStockSummary`/`getLowStockItems`/`whereIsLot`/`recordLocationTransfer` verbatim; no new backend
- [ ] Every entry in **Test Cases to Cover** manually verified in-iframe

**Rubric:**

| Criterion | Weight |
|-----------|--------|
| Functional Completeness (heatmap/tap/search/KPI/tile-pick) | 0.30 |
| Backend Reuse Discipline | 0.20 |
| GAS-Iframe Compatibility (no CDN, light+dark, feature-detect) | 0.20 |
| Blueprint Aesthetic Fidelity | 0.15 |
| Project Guidelines Alignment | 0.15 |

**Rubric Score Definitions:**

##### Functional Completeness (heatmap/tap/search/KPI/tile-pick)

Are all six interactions present and correct: 148-slot render, occupancy heatmap, tap→PIP, lot search highlight, KPI strip, tile-pick movement?

Score Definitions
- 1: Two or more interactions missing or non-functional.
- 2: One interaction missing or broken (e.g. no empty-state, or search never highlights) (DEFAULT).
- 3: All six present and functionally correct against the existing reads/writes.
- 4: All six plus every error/empty state ("Lot not found", empty slot, "No available position") handled (IDEAL).
- 5: All of 4 with a live re-read after movement so the map stays in sync without reload (OVERLY PERFECT).

##### Backend Reuse Discipline

Does it call only the existing functions and add zero new stock/movement/scan backend, using `recordLocationTransfer` (not `recordScan`) for tile-pick?

Score Definitions
- 1: Adds a new backend function or uses `recordScan` for free-slot moves.
- 2: Reuses reads but movement path questionable or partly reimplemented client-side (DEFAULT).
- 3: All reads/writes reuse existing functions; tile-pick uses `recordLocationTransfer`.
- 4: All of 3 with async `.withSuccessHandler` throughout and no return-value assumption (IDEAL).
- 5: Zero backend footprint AND a single data-refresh helper avoids duplicated `google.script.run` wiring (OVERLY PERFECT).

##### GAS-Iframe Compatibility (no CDN, light+dark, feature-detect)

Does it obey the double-iframe constraints: no CDN scripts, both themes, `BarcodeDetector` feature-detected with tile-pick fallback, no `window.parent` access?

Score Definitions
- 1: References a CDN script OR breaks in one theme OR has a dead scan path on unsupported browsers.
- 2: One compat issue (e.g. relies on `@media (hover:none)`) (DEFAULT).
- 3: No CDN, both themes render, QR feature-detected with fallback.
- 4: All of 3 verified via light+dark playwright-cli screenshots (IDEAL).
- 5: Also degrades gracefully with reduced-motion guard on the PIP (OVERLY PERFECT).

##### Blueprint Aesthetic Fidelity

Does the map match the architectural-blueprint / PM ISO print house-style using SVG+CSS?

Score Definitions
- 1: Generic default styling, no blueprint character.
- 2: Some blueprint cues but inconsistent (DEFAULT).
- 3: Consistent blueprint aesthetic across the map and KPI strip.
- 4: Blueprint aesthetic holds in both themes (IDEAL).
- 5: Matches the PM ISO print house-style tokens precisely (OVERLY PERFECT).

##### Project Guidelines Alignment

Honors CLAUDE.md GAS gotchas (async run, cache versioning, no parent DOM, `display:flex` over hover media queries) and `.claude/rules/`.

Score Definitions
- 1: Violates a documented GAS gotcha.
- 2: One style-only deviation (DEFAULT).
- 3: No high-criticality violations; minor style only.
- 4: All applicable gotchas honored with citations (IDEAL).
- 5: Proactively strengthens a convention (OVERLY PERFECT).

**Test Strategy:**

**Artifact:** `WarehouseFloorplan.html`
**Criticality:** MEDIUM

**Test Matrix:**

| Type | Size | Framework | Dependencies | Gate |
|------|------|-----------|--------------|------|
| manual QA / e2e | large | `playwright-cli` screenshot (in-iframe, light+dark) | deployed GAS page, existing backend reads | Gate 3/5 |

_No automated component test: the GAS double-iframe blocks a Node/jsdom test harness; verification is manual playwright-cli per project convention._

**Test Cases to Cover**

##### Map renders in both themes without CDN scripts
- [manual] open in light theme → all 148 slots render grouped by bay, zones filtered [main]
- [manual] toggle `:root[data-theme="dark"]` → renders correctly [EP: dark theme]
- [manual] grep the file for `<script src` → zero external references [error path: no CDN]

##### Occupancy heatmap and % full
- [manual] with N known-occupied slots, exactly N show occupied, 148−N empty, fullness=N÷148 [main]
- [manual] empty warehouse (N=0) → all empty, 0% full [BVA: N=0]
- [manual] full warehouse (N=148) → all occupied, 100% [BVA: N=148]

##### Tap a position shows its contents
- [manual] tap occupied slot → PIP shows material/lot/qty from getStockView [main]
- [manual] tap empty slot → empty state shown [error path]

##### Lot search highlights its position
- [manual] search a stored lot → exactly its slot highlights [main]
- [manual] search unknown lot → "Lot not found", nothing highlighted [error path]

##### KPI strip shows instant warehouse view
- [manual] KPI strip shows % full + low-stock alerts from getStockSummary + getLowStockItems [main]

##### Tile-pick movement fallback
- [manual] tile-pick + confirm → recordLocationTransfer called (verify NOT recordScan); ledger reflects move; map re-reads [main]
- [manual] no free position → "No available position" [error path]
- [manual] BarcodeDetector absent (Firefox/Safari/iOS) → tile-pick fallback, no dead scan [error path: feature-detect]

---

### Step 3: Wire `pageMap` route + cockpit tile

**Model:** sonnet · **Agent:** `developer` · **Depends on:** Step 2 · **Parallel with:** Step 6

**Goal**: Make the floorplan map reachable from the app cockpit.

#### Expected Output
- `Code.js` pageMap entry (~line 270) routing to `WarehouseFloorplan.html`.
- `QMSV2_F.html` cockpit tile linking to the map.

#### Success Criteria
- [ ] `Code.js` pageMap has an entry rendering `WarehouseFloorplan.html` via `createTemplateFromFile` (no new routing plumbing).
- [ ] `QMSV2_F.html` shows a cockpit tile that navigates to the floorplan page.
- [ ] Navigating from the cockpit opens the map and it loads its data (end-to-end reachability confirmed in-iframe).

#### Subtasks
- [ ] Add pageMap entry in `Code.js` (~270), mirroring an existing `*_F.html` route.
- [ ] Add cockpit tile in `QMSV2_F.html` matching existing tile pattern/style.
- [ ] `clasp push` + verify navigation with `playwright-cli`.

#### Blockers
- Step 2 must exist (route target).

#### Risks
- Low. Routing already supports it (analysis confirmed).

**Complexity**: Small · **Uncertainty**: Low · **Dependencies**: Step 2 · **Integration Points**: `doGet`/cockpit nav.

#### Verification

**Level:** ✅ Single Judge
**Artifact:** `Code.js` (pageMap ~line 270), `QMSV2_F.html` (cockpit tile)
**Threshold:** 4.0/5.0
**Rationale:** LOW/MEDIUM — routing wiring only; routing plumbing already supports it. Single judge confirms reachability end-to-end.

**Checklist:**

| ID | Question | Category | Importance |
|----|----------|----------|------------|
| HR-1 | Does `Code.js` pageMap have an entry rendering `WarehouseFloorplan.html` via `createTemplateFromFile`? | hard_rule | essential |
| HR-2 | Does `QMSV2_F.html` show a cockpit tile that navigates to the floorplan page? | hard_rule | essential |
| HR-3 | Does navigating from the cockpit open the map AND does it load its data (end-to-end reachability)? | hard_rule | essential |
| P-1 | Does the tile follow the existing cockpit tile pattern/style rather than a bespoke one? | principle | important |
| PIT-1 | Was new routing plumbing introduced when the existing pageMap pattern sufficed? | principle | pitfall |

**Regular Checks:**

- [ ] `clasp push` succeeds
- [ ] Navigation verified in-iframe with `playwright-cli`
- [ ] Reuse honored: mirrors an existing `*_F.html` route and existing tile pattern; no new plumbing

**Rubric:**

| Criterion | Weight |
|-----------|--------|
| Route Correctness & Reachability | 0.45 |
| Cockpit Tile Consistency | 0.25 |
| Project Guidelines Alignment | 0.30 |

**Rubric Score Definitions:**

##### Route Correctness & Reachability

Does the pageMap entry render the map via `createTemplateFromFile` and does the cockpit navigation actually open a working, data-loaded map?

Score Definitions
- 1: No pageMap entry, or navigation does not reach the map.
- 2: Route added but map opens without data or via non-standard plumbing (DEFAULT).
- 3: Route mirrors an existing `*_F.html` entry; cockpit → map opens and loads data.
- 4: All of 3 verified end-to-end in-iframe via playwright-cli (IDEAL).
- 5: All of 4 with graceful handling if the page file is missing (OVERLY PERFECT).

##### Cockpit Tile Consistency

Does the new tile match the existing QMSV2 cockpit tile pattern and style?

Score Definitions
- 1: No tile, or tile does not navigate.
- 2: Tile navigates but visually inconsistent with existing tiles (DEFAULT).
- 3: Tile matches the existing tile pattern and style, navigates correctly.
- 4: Consistent in both light and dark themes (IDEAL).
- 5: Reuses the shared tile component/markup with zero duplication (OVERLY PERFECT).

##### Project Guidelines Alignment

Honors CLAUDE.md routing conventions and reuses existing patterns (no new plumbing, cache-version bump if bundle shape changes).

Score Definitions
- 1: Introduces redundant routing plumbing or violates a GAS convention.
- 2: One style-only deviation (DEFAULT).
- 3: No high-criticality violations; minor style only.
- 4: All applicable conventions honored with citations (IDEAL).
- 5: Proactively strengthens a convention (OVERLY PERFECT).

**Test Strategy:**

**Artifact:** `Code.js` pageMap + `QMSV2_F.html` tile
**Criticality:** LOW

**Test Matrix:**

| Type | Size | Framework | Dependencies | Gate |
|------|------|-----------|--------------|------|
| manual QA / e2e | large | `playwright-cli` (navigate cockpit → map) | deployed GAS page, Step 2 map | Gate 5 |

**Test Cases to Cover**

##### Map renders in both themes without CDN scripts (reachability)
- [manual] click the cockpit tile → floorplan page opens [main]
- [manual] opened map loads its data (KPI + slots populated) [main]
- [manual] direct pageMap route renders `WarehouseFloorplan.html` [EP: route resolves]

---

### Step 4: Fix `saveMaterial` to a 12-col read-modify-write writer (PHASE 2 GATE)

**Model:** opus · **Agent:** `opus` · **Depends on:** None · **Parallel with:** Step 1 (P1 chain head) · **Blocks:** Step 5 (STRICT — RISK-3)

**Goal**: Repair the truncation regression (RISK-3) so the material writer preserves all 12 columns
by index — **this step BLOCKS Step 5**.

#### Expected Output
- `Masters.js` `saveMaterial` (line 350) rewritten as a by-column-index read-modify-write padded to 12 cols.
- `Masters.js` `getMaterials` (line 14) widened to read 12 columns.

#### Success Criteria
- [ ] `saveMaterial` writes a 12-element row by column index (no fixed 5-element array); editing a material with data in cols F→L preserves those columns (they are NOT truncated).
- [ ] Existing 5-column materials still save/round-trip correctly (backward compatible).
- [ ] `getMaterials` returns all 12 columns per material.
- [ ] Runnable GAS check asserts: save a material with F→L populated, re-read, F→L intact.

#### Subtasks
- [ ] Convert `saveMaterial` to read the existing row, patch by index, write 12 cols.
- [ ] Widen `getMaterials` to 12 cols; update `ensureMaterialsLocationColumn_` (`Masters.js:75`) to seed/pad F→L headers if needed.
- [ ] Write `_testSaveMaterialWidth()` assert (populate F→L, edit an unrelated field, confirm F→L survive).

#### Blockers
- None. This is the gate.

#### Risks
- **RISK-3 (HIGH)**: adding geometry before this fix silently drops it on every edit → Mitigation: this step is mandatory-first; Step 5 must not start until its assert passes.

**Complexity**: Medium · **Uncertainty**: Low · **Dependencies**: none · **Integration Points**: material create/edit form, `getMaterials` consumers.

#### Verification

**Level:** ✅✅ CRITICAL — Panel of 2 Judges with Aggregated Voting (median)
**Artifacts:** `Masters.js` (`saveMaterial` line 350, `getMaterials` line 14, `ensureMaterialsLocationColumn_` line 75), `_testSaveMaterialWidth()`
**Threshold:** 4.3/5.0
**Rationale:** HIGH — data-integrity fix (RISK-3). The current fixed 5-element row silently truncates cols F→L on every edit, corrupting the material master. This step GATES Step 5; a truncation escape here poisons all downstream geometry. Elevated threshold 4.3.

**Checklist:**

| ID | Question | Category | Importance |
|----|----------|----------|------------|
| HR-1 | Does `saveMaterial` write a 12-element row by column index (no fixed 5-element array literal)? | hard_rule | essential |
| HR-2 | Does editing a material with data in cols F→L preserve those columns (NOT truncated)? | hard_rule | essential |
| HR-3 | Do existing 5-column materials still save and round-trip correctly (backward compatible)? | hard_rule | essential |
| HR-4 | Does `getMaterials` return all 12 columns per material? | hard_rule | essential |
| HR-5 | Does `_testSaveMaterialWidth()` populate F→L, edit an unrelated field, re-read, and assert F→L intact? | hard_rule | essential |
| HR-6 | Is the write a read-modify-write by index (patch known cols, preserve the rest), not a blind overwrite of unknown cols? | hard_rule | essential |
| P-1 | Are the 12 columns referenced by named index constants rather than magic numbers scattered inline? | principle | important |
| PIT-1 | Does the writer still set `row.length` to 5 anywhere, or use `setValues` with a short row that clips F→L? | principle | pitfall |
| PIT-2 | Does any Step-5 geometry field get added in this step (scope creep past the gate)? | principle | pitfall |

**Regular Checks:**

- [ ] `clasp push` succeeds
- [ ] `_testSaveMaterialWidth()` runs green in the GAS editor
- [ ] No code duplication: column indices defined once, reused by writer and reader
- [ ] Reuse honored: adapts `Masters.js:350/14/75`; no parallel writer created

**Rubric:**

| Criterion | Weight |
|-----------|--------|
| Truncation Fix Correctness (12-col by index) | 0.35 |
| Backward Compatibility | 0.25 |
| Runnable Assert Proof | 0.25 |
| Project Guidelines Alignment | 0.15 |

**Rubric Score Definitions:**

##### Truncation Fix Correctness (12-col by index)

Does the writer preserve all 12 columns via read-modify-write by index so F→L survive every edit?

Judge inspects the writer for any fixed short array and confirms cols F→L are patched by index, not clipped.

Score Definitions
- 1: Still writes a fixed 5-element row, or F→L can be truncated on edit.
- 2: Writes 12 cols but blindly overwrites cols it does not know, risking data loss (DEFAULT — must justify higher).
- 3: Read-modify-write by index; F→L preserved on every edit; exactly 12 cols written.
- 4: All of 3 with named column-index constants and `getMaterials` widened in lockstep (IDEAL).
- 5: All of 4 with a single shared column schema consumed by both reader and writer (OVERLY PERFECT).

##### Backward Compatibility

Do existing 5-column materials (no F→L data) still save and round-trip unchanged?

Score Definitions
- 1: Existing materials break or lose data on save.
- 2: Save works but empty F→L cells written as garbage/`undefined` (DEFAULT).
- 3: Existing materials round-trip cleanly; empty geometry cells stay blank.
- 4: All of 3 asserted by a runnable check on a legacy-shaped material (IDEAL).
- 5: Also handles a sheet that has fewer than 12 physical columns by padding headers (OVERLY PERFECT).

##### Runnable Assert Proof

Does `_testSaveMaterialWidth()` mechanically prove F→L survive an unrelated-field edit?

Score Definitions
- 1: No assert function.
- 2: Function exists but only checks the row length (DEFAULT).
- 3: Populates F→L, edits an unrelated field, re-reads, asserts F→L intact.
- 4: Also asserts backward-compat for a 5-col material (IDEAL).
- 5: Asserts each of F,G,H,I,J,K,L individually with boundary values (OVERLY PERFECT).

##### Project Guidelines Alignment

Honors `.claude/rules/` (no magic numbers, early-return, single source of column indices) and CLAUDE.md GAS conventions.

Score Definitions
- 1: Violates a rule (magic-number column indices duplicated, generic helper).
- 2: One style-only deviation (DEFAULT).
- 3: No high-criticality violations; minor style only.
- 4: All applicable rules honored with citations (IDEAL).
- 5: Proactively strengthens a convention (OVERLY PERFECT).

**Test Strategy:**

**Artifact:** `Masters.js` saveMaterial / getMaterials
**Criticality:** HIGH

**Test Matrix:**

| Type | Size | Framework | Dependencies | Gate |
|------|------|-----------|--------------|------|
| unit (GAS assert) | small | `_testSaveMaterialWidth()` runnable in GAS editor | scratch MASTERS_Materials sheet | Gate 1 |

**Test Cases to Cover**

##### `saveMaterial` truncation regression fixed first
- [unit] populate a material with F→L, edit an unrelated field (e.g. desc), re-read → F→L intact [main: the regression]
- [unit] save an existing 5-column material (no F→L) → round-trips cleanly, no garbage in F→L [BVA: 5-col boundary]
- [unit] `getMaterials` returns 12 columns per material [EP: read width]
- [unit] save writes exactly 12 cols, not 5, not 13 [BVA: width 5→12→beyond]
- [unit] editing a material whose row is physically shorter than 12 cols pads rather than errors [error path]

---

### Step 5: Add `MASTERS_Materials` F→L geometry to the material form

**Model:** sonnet · **Agent:** `developer` · **Depends on:** Step 4 (STRICT gate) · **Parallel with:** Step 2

**Goal**: Capture storage geometry (baseUnit, each L/W/H, each weight, perPallet TI×HI, fitClass) at
material creation/edit.

#### Expected Output
- Material create/edit form fields for cols F→L; `saveMaterial` persists them (via the Step 4 writer).

#### Success Criteria
- [ ] Saving a material stores `F baseUnit, G eachL, H eachW, I eachH, J eachWeight, K perPallet, L fitClass`.
- [ ] `eachVolume` (L×W×H) is **computed, not stored**; `fitClass` (VOLUME|WEIGHT) is a display hint only.
- [ ] Existing catalogue can be backfilled through the same form (no category-based auto-seeding).
- [ ] Round-trip check: create material with geometry → `getMaterials` returns F→L intact.

#### Subtasks
- [X] Add the 6 geometry inputs to the material form (`Masters_F.html` SCHEMA.material — 5 numeric + fitClass select). Col F is the existing reorderLevel per the reconciled spec; geometry occupies G→L (indexes 6–11).
- [X] Pass values into `saveMaster` (material branch) via `_applyGeometryToPatch_` through the Step-4 `_upsertMaterialRow_` RMW; `getMaterials` exposes flat named fields (eachL/W/H, eachWeight, perPallet, fitClass) + G→L headers ensured via `ensureMaterialsGeometryColumns_`.
- [X] Verified `eachVolume` is derived (L×W×H) at compute time, never written — `_testMaterialGeometry()` asserts row stays 12 cols.

#### Blockers
- **Step 4 must pass** (writer must pad to 12 first).

#### Risks
- If Step 4 assert not green, geometry silently truncates → gate enforced.

**Complexity**: Medium · **Uncertainty**: Low · **Dependencies**: Step 4 · **Integration Points**: Masters form, `getMaterials`.

#### Verification

**Level:** ✅ Single Judge
**Artifact:** Material create/edit form (F→L geometry inputs) + `saveMaterial` persistence path
**Threshold:** 4.0/5.0
**Rationale:** MEDIUM — form UI capturing geometry; the risky writer was already gated and fixed in Step 4. Single judge confirms round-trip.

**Checklist:**

| ID | Question | Category | Importance |
|----|----------|----------|------------|
| HR-1 | Does saving store `F baseUnit, G eachL, H eachW, I eachH, J eachWeight, K perPallet, L fitClass`? | hard_rule | essential |
| HR-2 | Is `eachVolume` (L×W×H) computed, NOT stored in a column? | hard_rule | essential |
| HR-3 | Is `fitClass` (VOLUME\|WEIGHT) treated as a display hint only, not as the fit ceiling? | hard_rule | important |
| HR-4 | Can the existing catalogue be backfilled through the same form (no category auto-seeding)? | hard_rule | important |
| HR-5 | Round-trip: create a material with geometry → `getMaterials` returns F→L intact? | hard_rule | essential |
| P-1 | Do the 7 inputs follow the existing Masters form field pattern/validation? | principle | important |
| PIT-1 | Is `eachVolume` accidentally persisted to a column (violates "computed not stored")? | principle | pitfall |

**Regular Checks:**

- [ ] `clasp push` succeeds; form renders and saves in-iframe
- [ ] Round-trip verified: create with geometry → re-read F→L intact (depends on Step 4 writer green)
- [ ] Reuse honored: passes values through the Step-4 `saveMaterial` writer; no new persistence path

**Rubric:**

| Criterion | Weight |
|-----------|--------|
| Geometry Capture Correctness (F→L stored, volume computed) | 0.45 |
| Form Integration & Backfill | 0.25 |
| Project Guidelines Alignment | 0.30 |

**Rubric Score Definitions:**

##### Geometry Capture Correctness (F→L stored, volume computed)

Are all 7 geometry fields stored in F→L, with eachVolume computed (never stored) and fitClass as a hint only?

Score Definitions
- 1: A geometry field not stored, or eachVolume written to a column.
- 2: All fields stored but eachVolume persisted or fitClass mis-used as ceiling (DEFAULT).
- 3: F→L stored exactly; eachVolume computed at read; fitClass is display-only.
- 4: All of 3 with a round-trip assert proving F→L survive (IDEAL).
- 5: Also validates dimension/weight inputs are positive numbers before save (OVERLY PERFECT).

##### Form Integration & Backfill

Do the inputs fit the existing Masters form pattern and support backfilling existing materials?

Score Definitions
- 1: Fields added ad hoc, breaking the form, or backfill impossible.
- 2: Fields work but inconsistent with existing form pattern (DEFAULT).
- 3: Fields follow the existing pattern; existing catalogue backfillable via the same form.
- 4: Consistent in both themes with sensible validation (IDEAL).
- 5: Reuses shared form-field markup with zero duplication (OVERLY PERFECT).

##### Project Guidelines Alignment

Honors CLAUDE.md GAS conventions and `.claude/rules/`.

Score Definitions
- 1: Violates a documented convention.
- 2: One style-only deviation (DEFAULT).
- 3: No high-criticality violations; minor style only.
- 4: All applicable rules honored with citations (IDEAL).
- 5: Proactively strengthens a convention (OVERLY PERFECT).

**Test Strategy:**

**Artifact:** Material form F→L geometry
**Criticality:** MEDIUM

**Test Matrix:**

| Type | Size | Framework | Dependencies | Gate |
|------|------|-----------|--------------|------|
| unit (GAS assert) | small | round-trip assert via `getMaterials` | Step-4 writer, scratch sheet | Gate 1 |
| manual QA | large | `playwright-cli` (form render/save) | deployed page | Gate 5 |

**Test Cases to Cover**

##### Material storage geometry at creation
- [unit] create material with F→L populated → `getMaterials` returns all 7 fields intact [main]
- [unit] eachVolume is derived from L×W×H at compute time, absent from any stored column [error path: computed-not-stored]
- [unit] fitClass stored as VOLUME or WEIGHT string, used as hint not ceiling [decision table: fitClass values]
- [manual] backfill an existing 5-col material through the same form → F→L added, no category auto-seed [main: backfill]

---

### Step 6: Add `suggestSlot` + `min(volume,weight)` fit engine with runnable assert

**Model:** opus · **Agent:** `opus` · **Depends on:** Step 5 · **Parallel with:** Step 3 · **Note:** re-read `Warehouse.js` before editing (Step 1 also touched this file, different function).

**Goal**: Optimal-slot suggestion for minimum-tap putaway, using `min(volume,weight)` and
consolidation preference.

#### Expected Output
- `Warehouse.js` `suggestSlot(materialCode, qty)` + `min(volume,weight)` fit helper.

#### Success Criteria
- [ ] Capacity = `min(floor(loc.volume/eachVolume), floor(loc.maxWeight/eachWeight))`; `palletsNeeded = ceil(qty/(TI×HI))`.
- [ ] `suggestSlot` walks open slots, keeps those that fit, and returns `{slotId, palletsNeeded, bound}` — preferring a slot already holding the same material over an emptier separate slot; returns `null` when nothing fits.
- [ ] Runnable assert-based check proves: (a) a consolidating slot is preferred over an emptier separate one; (b) a 27 kg pack resolves `bound: 'WEIGHT'` while empty cans resolve `bound: 'VOLUME'`.

#### Subtasks
- [ ] Implement `min(volume,weight)` helper (eachVolume computed from F→I).
- [ ] Implement `suggestSlot` walk + consolidation preference using `getLocations` + geometry cols.
- [ ] Write `_testSuggestSlot()` with the two assert cases above; movement stays `recordLocationTransfer` on Accept.

#### Blockers
- Step 5 must be complete (geometry cols must be populated).

#### Risks
- Fit math edge cases (zero/empty geometry) → guard and skip un-geometried materials.

**Complexity**: Medium · **Uncertainty**: Medium · **Dependencies**: Step 5 · **Integration Points**: `getLocations`, tile-pick Accept → `recordLocationTransfer`.

#### Verification

**Level:** ✅✅ CRITICAL — Panel of 2 Judges with Aggregated Voting (median)
**Artifacts:** `Warehouse.js` (`suggestSlot(materialCode, qty)` + `min(volume,weight)` fit helper), `_testSuggestSlot()`
**Threshold:** 4.0/5.0
**Rationale:** HIGH — core business logic (fit math + consolidation preference) with a mandated runnable assert. A wrong ceiling or preference sends stock to the wrong slot. Two judges cross-check the math and the two required assert cases.

**Checklist:**

| ID | Question | Category | Importance |
|----|----------|----------|------------|
| HR-1 | Is capacity computed as `min(floor(loc.volume/eachVolume), floor(loc.maxWeight/eachWeight))`? | hard_rule | essential |
| HR-2 | Is `palletsNeeded = ceil(qty/(TI×HI))`? | hard_rule | essential |
| HR-3 | Does `suggestSlot` walk open slots, keep those that fit, and return `{slotId, palletsNeeded, bound}`? | hard_rule | essential |
| HR-4 | Does it prefer a slot already holding the SAME material (consolidation) over an emptier separate slot? | hard_rule | essential |
| HR-5 | Does it return `null` when nothing fits? | hard_rule | essential |
| HR-6 | Does `_testSuggestSlot()` assert (a) consolidating slot preferred over emptier separate one? | hard_rule | essential |
| HR-7 | Does `_testSuggestSlot()` assert (b) a 27 kg pack resolves `bound:'WEIGHT'` while empty cans resolve `bound:'VOLUME'`? | hard_rule | essential |
| HR-8 | Does the movement on Accept stay `recordLocationTransfer` (never `recordScan`)? | hard_rule | important |
| P-1 | Are materials with missing/zero geometry guarded and skipped rather than dividing by zero? | principle | important |
| PIT-1 | Does `eachVolume` get read from a stored column instead of computed from F→I? | principle | pitfall |
| PIT-2 | Is Bay used anywhere in the fit calculation (must never be)? | principle | pitfall |

**Regular Checks:**

- [ ] `clasp push` succeeds
- [ ] `_testSuggestSlot()` runs green in the GAS editor (both required assert cases)
- [ ] Re-read `Warehouse.js` before editing (Step 1 also touched this file, different function)
- [ ] Reuse honored: uses `getLocations` + geometry cols; movement stays `recordLocationTransfer`; no new movement backend

**Rubric:**

| Criterion | Weight |
|-----------|--------|
| Fit-Math Correctness (min volume/weight ceiling) | 0.30 |
| Consolidation Preference & Selection | 0.25 |
| Edge-Case Robustness (zero geometry, no fit) | 0.15 |
| Runnable Assert Proof (both cases) | 0.15 |
| Project Guidelines Alignment | 0.15 |

**Rubric Score Definitions:**

##### Fit-Math Correctness (min volume/weight ceiling)

Is the capacity ceiling exactly `min(floor(volume/eachVolume), floor(maxWeight/eachWeight))` with `palletsNeeded = ceil(qty/(TI×HI))` and eachVolume computed from F→I?

Score Definitions
- 1: Uses only volume or only weight, or wrong rounding direction.
- 2: Uses min() but floors/ceils inconsistently or reads a stored eachVolume (DEFAULT — must justify higher).
- 3: Exact min-of-two ceiling; correct floor/ceil; eachVolume computed.
- 4: All of 3 with the `bound` field correctly reporting which limit won (IDEAL).
- 5: Handles unit consistency (m³/ltr vs kg) explicitly with no silent coercion (OVERLY PERFECT).

##### Consolidation Preference & Selection

Does it prefer a slot already holding the same material over an emptier separate slot, and return the best (or null)?

Score Definitions
- 1: No consolidation preference, or returns a non-fitting slot.
- 2: Consolidation attempted but loses to "emptiest" heuristic in the tie case (DEFAULT).
- 3: Consolidating slot preferred over emptier separate one; best returned; null when nothing fits.
- 4: All of 3 proven by the required assert case (a) (IDEAL).
- 5: Deterministic tie-break beyond consolidation (e.g. nearest bay of correct Type) (OVERLY PERFECT).

##### Edge-Case Robustness (zero geometry, no fit)

Are un-geometried materials (zero/empty F→L) guarded against divide-by-zero and skipped, and full-warehouse handled?

Score Definitions
- 1: Divides by zero or throws on empty geometry.
- 2: Guards zero but returns a misleading result instead of skipping/null (DEFAULT).
- 3: Zero geometry guarded and skipped; no-fit returns null cleanly.
- 4: All of 3 asserted by a runnable check (IDEAL).
- 5: Also surfaces a reason for skip to the caller (OVERLY PERFECT).

##### Runnable Assert Proof (both cases)

Does `_testSuggestSlot()` prove both mandated cases: consolidation preference AND weight-bound vs volume-bound?

Score Definitions
- 1: No assert function.
- 2: Only one of the two cases asserted (DEFAULT).
- 3: Both cases asserted and green.
- 4: Adds a no-fit→null and zero-geometry assert (IDEAL).
- 5: Parameterized table covering both bound classes at pallet boundaries (OVERLY PERFECT).

##### Project Guidelines Alignment

Honors `.claude/rules/` (early-return guards, no magic numbers, domain naming) and CLAUDE.md conventions; re-reads the shared file before editing.

Score Definitions
- 1: Violates a rule or clobbers Step-1 changes in the shared file.
- 2: One style-only deviation (DEFAULT).
- 3: No high-criticality violations; minor style only.
- 4: All applicable rules honored with citations (IDEAL).
- 5: Proactively strengthens a convention (OVERLY PERFECT).

**Test Strategy:**

**Artifact:** `Warehouse.js` suggestSlot + fit helper
**Criticality:** HIGH

**Test Matrix:**

| Type | Size | Framework | Dependencies | Gate |
|------|------|-----------|--------------|------|
| unit (GAS assert) | small | `_testSuggestSlot()` runnable in GAS editor | stub locations + geometry fixtures | Gate 1 |

**Test Cases to Cover**

##### Fit engine and optimal-slot suggestion
- [unit] capacity = min(floor(volume/eachVolume), floor(maxWeight/eachWeight)) computed correctly [main]
- [unit] palletsNeeded = ceil(qty/(TI×HI)); qty exactly = TI×HI → 1 pallet [BVA: qty at pallet boundary]
- [unit] qty = TI×HI + 1 → 2 pallets [BVA: B+1]
- [unit] consolidating slot (same material) preferred over emptier separate slot [main: required assert (a)]
- [unit] 27 kg pack (4×4 on pallet) → bound:'WEIGHT'; empty cans → bound:'VOLUME' [required assert (b), decision table]
- [unit] nothing fits (full warehouse) → returns null / "No available position" upstream [error path]
- [unit] material with zero/empty geometry → guarded, skipped, no divide-by-zero [error path: zero geometry]

---

## Implementation Summary

| Step | Phase | Goal | Key Output | Est. Effort |
|------|-------|------|------------|-------------|
| 1 | P1 | Reseed 148 slots + harden inferLocType | `Initialize.js` seed, `Warehouse.js:329` | M |
| 2 | P1 | Blueprint SVG floorplan map | `WarehouseFloorplan.html` | L |
| 3 | P1 | Route + cockpit tile | `Code.js`, `QMSV2_F.html` | S |
| 4 | P2 | `saveMaterial` 12-col writer (GATE) | `Masters.js:350/14` | M |
| 5 | P2 | Material geometry F→L on form | material form + writer | M |
| 6 | P2 | `suggestSlot` fit engine + assert | `Warehouse.js` | M |

**Total Steps**: 6 · **Total Subtasks**: 29
**Critical Path**: P1 → 1 → 2 → 3 (shippable alone). P2 → 4 → 5 → 6 (Step 4 gates 5).
**Parallel Opportunities**: The P2 chain (Step 4) may begin in parallel with the P1 chain; within each chain steps are strictly sequential.

---

## Verification Summary

| Step | Verification Level | Judges | Threshold | Artifacts |
|------|-------------------|--------|-----------|-----------|
| 1 | ✅✅ Panel (2) | 2 | 4.0/5.0 | LOCATIONS reseed + `inferLocType` (RISK-1/RISK-2) |
| 2 | ✅ Single | 1 | 4.0/5.0 | `WarehouseFloorplan.html` blueprint SVG map |
| 3 | ✅ Single | 1 | 4.0/5.0 | `Code.js` pageMap + `QMSV2_F.html` cockpit tile |
| 4 | ✅✅ Panel (2) | 2 | 4.3/5.0 | `saveMaterial` 12-col writer (data-integrity GATE) |
| 5 | ✅ Single | 1 | 4.0/5.0 | Material form F→L geometry |
| 6 | ✅✅ Panel (2) | 2 | 4.0/5.0 | `suggestSlot` fit engine + assert |

**Total Evaluations:** 9 (Panel steps 1,4,6 = 6; Single steps 2,3,5 = 3)
**Verification Breakdown:** Panel (2): 3 steps · Single: 3 steps · Per-Item: 0 · None: 0
**Default Checklist Items:** Included in all 6 steps (adapted to GAS: `clasp push` + runnable `_test*()` asserts / `playwright-cli` manual QA — no Node build/lint/test runner exists in prod).
**Project Guidelines Alignment Dimension:** Included in all 6 step rubrics (CLAUDE.md GAS gotchas + `.claude/rules/`).
**Test Strategies Defined:** 6 of 6 steps. Backend steps (1,4,6) use runnable GAS assert `_test` functions; HTML steps (2,3) and the form (5) use manual `playwright-cli` in-iframe QA (double-iframe blocks any Node/jsdom harness).
**Implementation Command:** `/implement` on this task file.

---

## Risks & Blockers Summary

### High Priority

| Risk/Blocker | Impact | Likelihood | Mitigation |
|--------------|--------|------------|------------|
| RISK-2: reseed replaces (breaks reject/return/rework + 3 Scan chokepoints) | High | Med | ADD-only idempotent seed; `_testLocationSeed` asserts 8 zones survive (Step 1) |
| RISK-3: geometry added before `saveMaterial` fix → truncated on edit | High | High | Step 4 gates Step 5; assert must be green first |
| RISK-1: `B`-prefix → `''` type, heatmap miscolours | High | Med | Type set per row + `inferLocType` floor-letter fallback (Step 1) |
| Floor-count verification (C & D = 42) is manual | Med | Med | Go-live gate; verify physically before ship (Step 1 DoD) |
| `BarcodeDetector` unsupported on many browsers | Med | High | Mandatory tile-pick fallback (Step 2) |

---

## Definition of Done (Task Level)

- [ ] All Phase 1 steps (1–3) completed; all Phase 1 acceptance criteria pass
- [ ] Phase 2 steps (4–6) completed; Phase 2 acceptance criteria pass (when P2 is implemented)
- [ ] `saveMaterial` 12-col fix verified green BEFORE any geometry field added
- [ ] 8 legacy zones confirmed present after reseed; bay counts C & D physically verified before go-live
- [ ] Runnable GAS checks (`_testLocationSeed`, `_testSaveMaterialWidth`, `_testSuggestSlot`) written and passing; map verified in-iframe (light+dark) via `playwright-cli`
- [ ] No new stock/movement/scan backend introduced in Phase 1
- [ ] Documentation updated
