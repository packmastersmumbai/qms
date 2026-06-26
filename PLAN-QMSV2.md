# Spec: QMS v2 — Unified Action-Driven Cockpit

**Saved:** 2026-06-26
**Status:** Specification (pre-implementation). Converged via brainstorm; integration points verified against code.
**Supersedes (entry/UX only):** the scattered 27-form + 4-nav-surface model. Does NOT supersede the stock/QMS engine — that is reused unchanged.

---

## 1. Objective

Replace PM QMS's cluttered entry experience — ~27 module forms reachable through **4 redundant navigation surfaces** (top nav, bottom nav, "More" sheet, side drawer) all repeating the same links — with **one coherent, action-first, role-based cockpit** that works on mobile and desktop.

**Who it's for:** floor operators on shared phones (gate, inspector, storage, production, dispatch) + managers on desktop.

**Success looks like:** a person opens the app, picks their name, sees **only the work waiting at their stage**, and completes an action in **2–3 taps** (often a QR scan + confirm). The next person's queue lights up automatically — the handoff is a card moving columns. Stock location, FIFO urgency, and free space are visible at a glance. **No engine rewrite; the stock ledger and all gates are reused.**

### Core principle
> The **action** defines the stock movement (txnType + direction). The **QR scan** supplies and verifies the *location*. Simple actions render inline; rich stateful flows are *launched*, not rebuilt.

---

## 2. Tech Stack & Stack Reality

- **Google Apps Script** web app; **no Node runtime in production**. Pushed via `clasp`, deployed via `clasp deploy` (deployment ID in CLAUDE.md).
- Served inside a **double iframe**: GitHub Pages (`packmastersmumbai.github.io/qms`) → `script.googleusercontent.com`.
- Form HTML served by **`getFormHtml(type)`** via its `pageMap`; cached server-side under a versioned key (`pmqms_formhtml_vN_*`). **Any new page must be added to that pageMap and the cache key bumped on change.**
- **Identity caveat:** `Session.getActiveUser().getEmail()` is **unreliable inside the double iframe** — this is *why* QMS v2 uses a **name dropdown** for identity, not Google sign-in.
- Client QR scanning: in-browser JS library (e.g. `jsQR`/`html5-qrcode`) loaded in the page; **no new server dependency**.

---

## 3. The Design (Description)

### 3.1 Identity — top-right user dropdown
A user dropdown in the top bar, sourced from the **`OPERATORS` sheet** (`getOperators()`), switchable anytime. Selecting a user:
- sets the **role filter** (their role's live stage drives "My Work"),
- **stamps that user as operator** on any action performed.

To act *as* someone else, just pick them and proceed — no login, no PIN.
**Caveat (explicit, accepted):** this is **self-attested identity** — anyone can pick any name. It is **traceability, not authentication**. The real privilege gate remains **`ownerMode`** (PIN-gated, controls admin/Settings/data-entry). Stated so it is a conscious choice, not an accident.

### 3.2 Action-first entry — two tiers
A single **action picker** ("What do you want to do?"), grouped (Receive · Inspect · Make · Ship · Move · Resolve), driven by one **action registry** (config object: `{id,label,group,role,kind,serverFn,fields[],preview,confirm}`).

- **Tier 1 — simple actions → ONE inline config-driven form.** Move/Putaway, Issue RM, Scrap, Sample, Return-to-store, Raise NCR, NCR-disposition, Rework-complete, Customer-return-triage. Fields render from registry config; calls the **existing** server fn.
- **Tier 2 — rich stateful flows → LAUNCHED, not rewritten.** GRN, IQC, IPQC session, Production booking/BOM, OQC, Dispatch FIFO. The picker opens their existing form via `navigateTo`. All their features (uploads, video, timer, BOM explosion, FIFO sub-allocation) stay intact.

### 3.3 Kanban board — the home
Doc-type tabs (GRN · IQC · IPQC · OQC · Dispatch · Production · NCR) × **status columns**; each card carries an **interactive mini-pipeline**. Default filter **"My Work"** = cards whose live stage belongs to the selected user's role. Overdue cards flagged red. **The handoff is a card advancing to the next role's column.** Toggle to "All" for the full board (managers).

### 3.4 Interactive pipeline — reuse `Trace.js`
Each card/doc shows its journey as a pipeline. Stages are **done (●, tap → trace data)**, **live (◉, tap → action: inline or launch)**, or **locked (○, grayed)**. Backed by `Trace.traceBatch()` (reused). Tapping the live stage is the few-clicks action entry; tapping a done stage opens its trace record.

### 3.5 QR location scanning
**Location QRs only — no per-lot label printing.** Hierarchical **Location ID** `FLOOR-SECTION-AISLE-RACK-SHELF-BIN`, **depth-flexible** (a pallet-only spot = shallow ID like `GF-RM-P1`; a racked bin = full depth `GF-PM-A1-R3-S2-B4`). Uses the **existing `LOCATIONS` schema** (columns already present). Behaviour:
- **Mid-action:** scan fills the active action's location field → action proceeds (with capacity + FIFO check).
- **Standalone (no action):** scan opens the **rack view** (contents + fill% + available actions).
- **Movement direction/txnType comes from the action; the scan only supplies + verifies the location.**
- **Outbound pick (issue/dispatch):** if the scanned rack/lot **mismatches the FIFO allocation → WARN + override-with-reason** (not a hard block), mirroring the existing FIFO-override pattern.

### 3.6 Stock map — two lenses (toggle)
- **(a) Treemap heatmap** — tiles **sized by qty/volume**, **colored by FIFO age OR fill%**, grouped by floor/section; tap a section header to zoom; tap a tile → actions; multi-select → batch. (Modeled on a stock-market treemap.) Needs **no new data** — renders from existing stock data.
- **(b) Floor-plan view** — the user's **real hand-drawn ground-floor layout** as an interactive map. Zones: **BULK RM (J01–J25)**, **PACKAGING MATERIAL A/B/C**, **FINISHED GOODS**, **BUFFER PALLETS (M01–M24)**, **LINES 1–3**, **SCRAP**, **LAB/QA**, plus non-storage (office/stairs/lifts). FIFO/fill colored; **zone → rack → lot → act**. Optional **safety overlay** toggle (hazard zones, extinguishers, escape paths, assembly point — all present in the drawing). Needs a **new `FLOOR_LAYOUT` definition**.

### 3.7 Capacity / space model
- Populate **`LOCATIONS.Capacity Qty` + `Capacity Unit`** (columns **exist but are blank** today).
- Add **`MASTERS_Materials.unitVolume`** (new column, same pattern as the already-added `reorderLevel` at col F).
- Compute **used vs free** per location (`Σ qty×unitVolume ÷ capacity`).
- **Capacity-unit-agnostic:** a location's capacity may be **m³ OR pallet/slot count**; material footprint matched accordingly.
- **Capacity check = advisory** on putaway/move (warn + suggest racks that fit), **not a hard block** — consistent with the FIFO warn+override choice.

### 3.8 Multi-select batch actions
- **Simple stage-actions only** (putaway, issue, move, scrap, return) — never rich stateful flows.
- **Same live stage only** (board greys out cards at other stages).
- **One input applies to all** (e.g. one location scan) **+ per-item override** (expand a row).
- **Mobile:** tap "Select" / long-press → checkboxes + sticky batch bar. **Desktop:** checkbox column + shift-click range / ctrl-click add.
- **Server:** a **batch wrapper** loops the **existing single-item fns** (each its own lock-safe ledger write), returning a per-item result array. **Each action's correct txnType is preserved.**

### 3.9 Many-to-many (graph, not line)
- **Upstream convergence (production consuming multiple GRN/IQC lots): EXISTS** — `Trace` fans out RM→FG (input lots shown as linked chips). **Reuse.**
- **Downstream fan-out (one dispatch consolidating multiple FG lots → its multiple parent jobs): does NOT exist in `Trace` today.** **NEW build.**

---

## 4. Honest Reuse-vs-New Ledger (verified against code)

### REUSE — no rewrite (verified)
| Capability | Evidence |
|---|---|
| Stock ledger write | `writeStockLedger_` — lock-safe (`LockService` `tryLock(10000)`), 14-col, computes Balance After. `Warehouse.js:12`. |
| Multi-location stock | `getStockSummary` keys on `material\|batch\|location` → same lot at many locations native. `Warehouse.js:154/164`. |
| Location transfer (putaway/move/return) | `recordLocationTransfer` = OUT@source + IN@dest, two ledger calls. `Warehouse.js:591/600-603`. |
| FIFO ordering | `getFIFOLots` oldest-first by GRN date. `Warehouse.js:239`. |
| Per-lot journey | `Trace.traceBatch()` (upstream/this/downstream). `Trace.js:27`. |
| Pending + status distribution | `computePendingCounts_` per-module pending + `__breakdowns` status map. `Code.js`. |
| Per-record lists | `getRecordsList(type, filters)` returns per-record `status`; filters by module/date/search. `Records.js:28`. |
| All rich forms + server fns | GRN/IQC/IPQC/OQC/Dispatch/Production/NCR/Rework/CustomerReturn — launched as-is. |

### NEW — must be built (labeled)
| Item | Note |
|---|---|
| Unified action form + action registry | Tier-1 inline renderer. |
| Kanban status-column UI | board layout. |
| **Status transition / handoff model** | `computePendingCounts_` only counts pending-vs-not — column-to-column movement must be derived. |
| **Server-side status filter** | `getRecordsList` has **none** today (module/date/search only). |
| Interactive pipeline stages | active/live/locked + tap behaviour over `Trace`. |
| QR scan → field plumbing | client lib + scan-to-location-field. |
| **FIFO ENFORCEMENT** | **Today FIFO is ADVISORY ONLY** — explicit code comment: *"provides a FIFO advisory only — does NOT enforce pick order"* (`Warehouse.js:232-234`). Enforcement (warn+override at pick) is **new**. |
| Treemap render | new component (no new data). |
| `FLOOR_LAYOUT` definition + floor-plan render | new sheet/JSON + interactive map. |
| Capacity/volume **compute** | new fn `getStockMapData()`. |
| Multi-select batch wrapper | loops existing fns, preserves txnType. |
| **Trace downstream fan-out** | dispatch→multiple parent FG jobs. |
| Top-bar role dropdown + role→stage filter | promotes the scan-flow name picker app-wide. |

### DATA PREREQUISITES — hard, non-code (nothing computes until done)
1. **Populate `LOCATIONS`** hierarchy (Floor/Section/Aisle/Rack/Shelf/Bin) to needed depth + adopt the ID convention.
2. **Populate `LOCATIONS.Capacity`** (Qty + Unit).
3. **Add + populate `MASTERS_Materials.unitVolume`.**
4. **Define `FLOOR_LAYOUT`** zones (from the hand-drawn plan).
5. **Print one QR per location** (the only printing required).

> ⚠️ Capacity/floor-plan/space features **cannot function** until 1–5 are entered. They are therefore **not P1** regardless of design readiness.

---

## 5. Commands

```bash
# Deploy (per CLAUDE.md)
clasp push --force
clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "<type>: <desc>"

# E2E (headless; auth state in .playwright/e2e-storageState.json)
node e2e-run-all.js
E2E_HEADED=1 node e2e-run-all.js
```
> On any form-HTML change, **bump the `getFormHtml` cache key** (`pmqms_formhtml_vN_*`).

---

## 6. Project Structure (additions)

```
QMSV2_F.html         → cockpit shell (board + pipeline + action picker), responsive
Qmsv2.js             → action registry (server side), getStockMapData(), batch wrapper,
                       role→stage filter, status-filter extension, downstream-trace fan-out
StockMap_F.html      → treemap + floor-plan views (or a panel within QMSV2_F)
FloorLayout.js       → FLOOR_LAYOUT read/define (new sheet or Script Property)
Code.js              → add QMSV2/StockMap to getFormHtml pageMap; bump cache key
Masters.js           → extend getMaterials() with unitVolume (col G)
e2e-qmsv2.js         → E2E suite for the cockpit (added to e2e-run-all.js)
```
Existing module forms/server fns are **unchanged** (launched as Tier-2).

---

## 7. Code Style

GAS-flavored ES5-ish, matching the codebase. Server fns take one `data`/payload object, return `{ok/success, …, error/warnings}`. Example (a batch wrapper looping an existing single-item fn, preserving txnType):

```js
// Qmsv2.js — batch wrapper; reuses existing single-item fns, never the ledger directly.
function batchAction(actionId, items) {
  var fn = ACTION_REGISTRY_[actionId];
  if (!fn || !fn.serverFn) throw new Error('Unknown action: ' + actionId);
  var run = this[fn.serverFn];                 // existing fn, e.g. recordLocationTransfer
  var results = [];
  (items || []).forEach(function (it, i) {
    try { results.push({ i: i, ok: true, result: run(it) }); }   // its own lock-safe write
    catch (e) { results.push({ i: i, ok: false, error: String(e).slice(0, 160) }); }
  });
  return { ok: results.every(function (r) { return r.ok; }), results: results };
}
```

---

## 8. Testing Strategy

- **Harness:** existing Playwright-CLI E2E (`e2e-run-all.js`) against the live deploy via RPC, with backend-verified assertions (the pattern already proven for low-stock + the scan lifecycle).
- **New suite `e2e-qmsv2.js`** per phase: action registry returns expected actions; inline action writes correct ledger txnType; Kanban board mounts + filters by role; pipeline stage states; QR scan fills location; capacity compute; multi-select batch result shape + per-item txnType; FIFO warn-on-mismatch.
- **Regression:** full `e2e-run-all.js` must stay green after every phase (no engine regressions).
- **Ledger truth checks:** every action E2E asserts the resulting `STOCK_LEDGER` balance/txnType — never trust UI alone.

---

## 9. Boundaries

**Always:**
- Route every stock movement through the **existing** server fns / `writeStockLedger_` — never write the ledger from new code directly.
- **Preserve every distinct ledger `txnType`** (`LOCATION_TRANSFER`, `SCRAP`, `SAMPLE`, `OQC_RELEASE`, `FG_DISPATCH`, `PROD_*`, `NCR_REWORK_*`, etc.) — **reports, badges, and KPIs filter on them.**
- Bump the form-HTML cache key on any HTML change; add new pages to `getFormHtml` pageMap.
- Keep old module forms working during transition (incremental rollout).
- Run full E2E before deploy.

**Ask first:**
- Schema changes (new columns/sheets: `unitVolume`, `FLOOR_LAYOUT`).
- Any change to a rich flow's existing server fn.
- Adding a client QR library.
- Retiring/removing an old nav surface or form.

**Never:**
- Rewrite the stock engine or a stateful flow (IPQC/Production/Dispatch) into the inline form.
- Make FIFO/capacity a hard block (they are advisory warn+override by decision).
- Treat the name dropdown as authentication.
- Collapse distinct txnTypes into one.
- Print per-lot QR labels (location QRs only).

---

## 10. Phasing (by risk)

| Phase | Scope | Risk | Data prereq |
|---|---|---|---|
| **P1** | Action picker + Tier-1 inline form + Kanban board (reuse counts/records/trace) + role dropdown + collapse 4 nav surfaces → 1 | **Low** (reuse-heavy declutter, zero engine change) | none |
| **P2** | QR location scanning + Putaway/Issue/Move/Return inline actions + multi-select batch | Medium | **LOCATIONS hierarchy populated + location QRs printed** |
| **P3** | Stock map: **treemap first** (no new data) → then floor-plan + capacity | Medium | floor-plan/capacity need **FLOOR_LAYOUT + Capacity + unitVolume entered** |
| **P4** | FIFO **enforcement** (warn+override at pick) + Trace **downstream fan-out** | **High** (genuinely new logic) | none |

Each phase ships independently; full E2E green before advancing.

---

## 11. Deferred / Out of Scope (explicit)

- **Real authentication / RBAC** — identity stays self-attested name-pick; `ownerMode` is the only privilege gate.
- **Per-lot QR labels / lot-level QR tracking** — location QRs only.
- **Pixel-exact geographic floor plan with drag-place coordinates** beyond the zone/grid `FLOOR_LAYOUT` — v1 floor-plan is zone+grid from the drawing; true CAD coordinates deferred.
- **3D bin-packing** (does this exact shape fit) — capacity uses total-volume-vs-capacity approximation.
- **Hard FIFO/capacity enforcement** — advisory warn+override only.
- **Rewriting any rich flow** — launched, not rebuilt.
- **Replacing the stock/QMS engine** — fully reused.

---

## 12. Success Criteria (specific, testable)

1. A user picks their name → board shows **only "My Work"** cards at their role's live stage; switching user re-filters instantly.
2. A simple action (e.g. putaway) completes in **≤3 taps** (scan location + confirm) and writes the **correct `txnType`** to `STOCK_LEDGER` (E2E-asserted balance).
3. A rich action (e.g. IQC) **launches its existing form** with all features intact.
4. Completing an action **advances the card** to the next role's column.
5. **4 nav surfaces → 1**; no destination appears in more than one place.
6. Treemap renders all stock sized-by-qty, colored-by-FIFO/fill, with no new data.
7. Floor-plan renders the real zones (BULK RM J01–J25, PM A/B/C, FG, BUFFER M01–M24, LINES, SCRAP, LAB) once `FLOOR_LAYOUT` is defined; tap zone→rack→lot→act works.
8. Capacity warn fires on over-fill putaway (once capacity+volume entered); never hard-blocks.
9. Multi-select batch writes **one ledger row per item with the right txnType**; per-item override works.
10. Full `e2e-run-all.js` stays green after each phase.

---

## 13. Open Questions (for human input before P1 build)

1. **Floor scope:** is the hand-drawn **Ground floor** the only floor for v1, with 1F/2F `FLOOR_LAYOUT` provided later?
2. **Role→stage matrix:** confirm which `OPERATORS` roles own which live stages (gate→GRN, inspector→IQC/IPQC/OQC, storage→Putaway/Move/Issue, dispatch→Dispatch, manager→all).
3. **Rollout:** run QMS v2 as a **new home** with old forms still reachable (recommended), or replace the landing outright once P1 is stable?
4. **Low-stock placement:** keep the existing Warehouse Low-Stock tab, or surface reorder alerts as a Stock-Map flag (recommended)?
5. **Admin modules** (PO, Control Plan, Import CSV, Masters): live under the slim "View/Manage" bar (recommended), not the action picker?

---

## 14. Next Step

Per spec-driven workflow: **human reviews + approves this spec**, then proceed to **Phase 2 (Plan)** for **P1 only** (action entry + board + role dropdown). Do not start code until P1's plan is reviewed. Recommended: `/clear`, then `/plan-task PLAN-QMSV2.md` scoped to P1.
