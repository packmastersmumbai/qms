# QMS v2 Cockpit — Per-Screen Design Specs (single file)

**Design authority:** Stitch design-system *Industrial Quality Management System*
`assets/f1c072ac30ee4901b96547757f18a349` · project `10290620691745788406`.
Build every screen **verbatim** to that system. Global tokens below; per-screen
detail follows. See `DESIGN.md` for the authority banner, `qmsv2-mockups/` for HTML.

## Global tokens (apply to all screens)
- **Color:** primary `#000747`, primary-container (navy chrome/buttons/pipeline-done) `#0d1b6e`,
  secondary/link `#0070f3`. Surfaces: background `#f9f9ff`, container-lowest `#ffffff`,
  -low `#f0f3ff`, container `#e7eefe`, -high `#e2e8f8`, -highest `#dce2f3`, outline `#767682`,
  outline-variant `#c6c5d3`. Signal: pass=emerald, fail/error `#ba1a1a`, warn=amber, info=`#0070f3`.
- **Type:** Plus Jakarta Sans (display/headline), Inter (body), Public Sans (label-caps/interactive),
  JetBrains Mono (numbers, lot ids, doc ids).
- **Shape/space:** 0.5rem radius (cards/buttons), **sharp 0px** for data-viz (treemap/floor-plan),
  pill for status chips. 8px rhythm. **48px min touch target.**
- **Elevation:** L1 flat cards (1px outline, minimal shadow); L2 ambient shadow on hover/drag/modal;
  status = 2–4px color strip on a card edge.
- **Pipeline tracker:** 6 stages (GRN·IQC·PUTAWAY·ISSUE·OQC·DISP). Done=navy, active=electric-blue ring, future=gray.
- **Layout:** desktop = left side-nav rail + 12-col grid; mobile = stacked + bottom-nav + center FAB.
- **Shell (every cockpit screen):** side-nav (PM QMS v2 logo, `+ New`, doc-type nav GRN·IQC·IPQC·OQC·
  Dispatch·Production·NCR, My Work/All); navy top bar (title, role chip, persona pill).

---

## STATUS LEGEND
✅ built & live · 🟡 shell built (write deferred) · 🟦 designed, build-blocked (data) · 🔵 designed, buildable now · ➖ launches existing form (not rebuilt)

---

## 1. Home — Kanban Board  ✅
**Stitch:** Home Kanban (Desktop/Mobile/Revised) · **HTML:** `01-home-kanban.html` · **GAS:** `QMSV2_F.html`
- Doc-type tabs (all 7) + All/Urgent + Select. Status sections (Action Required / Pending / In Progress / Done).
- Card: status badge, mono doc id, name, age, 6-stage pipeline, red left-edge when overdue. Tappable → Pipeline Detail.
- **Data:** `getQmsv2Board(type, role)` (reuses `getRecordsList`).

## 2. Action Picker  ✅
**Stitch:** Action Picker (Desktop/Mobile) · **HTML:** `02-action-picker.html`
- FAB/side `+ New` → bottom sheet, grouped tiles (Receive·Inspect·Make·Ship·Move·Resolve).
- `launch` tile → existing form (`getFormHtml` + document.write); `inline` → config form; `checklist` → Putaway.
- **Data:** `getQmsv2Actions()`.

## 3. Action Form — Move Stock  ✅
**Stitch:** Move Stock (Desktop/Mobile) · **HTML:** `03-action-form-move.html`
- Inline form: material/lot/from/to/qty + live on-hand. Confirm → real `STOCK_LEDGER` write.
- **Data:** `getActionFormData()`, `getOnHand()`, `runAction('move')` → `recordLocationTransfer`.

## 4. Pipeline Detail  ✅
**Stitch:** Pipeline Detail (Desktop/Mobile) · **GAS:** detail sheet in `QMSV2_F.html`
- Card tap → header (badge, mono doc, name), 6-stage pipeline, trace lanes: upstream components,
  IPQC rounds, downstream OQC/Dispatch/FG, issues NCR/Returns.
- **Data:** `traceBatch(docNo)` (existing engine; field shapes verified in Trace.js).

## 5. Putaway Checklist  🟡
**Stitch:** Putaway Checklist (Mobile) · **HTML:** `05-putaway-checklist.html`
- Header + progress bar (N of M placed) + bin rows (lot pill, qty, Scan rack) + Confirm.
- **Data:** `getPutawayQueue()` (live, read-only). **Write (rack scan → placement) = P2.**

## 6. Multi-Select Batch Mode  🟡
**Stitch:** Multi-Select (Desktop/Mobile) · **GAS:** select mode in `QMSV2_F.html`
- Select toggle → card checkboxes (navy fill + ring) → bottom navy bar (N Selected, Select all, Batch action).
- **Batch write = P2** (stubbed).

## 7. Re-order Levels Master  ✅
**Stitch:** Re-order Levels (Mobile) · **HTML:** `06-reorder-levels.html`
- Material list with reorder thresholds. **Data:** `getMaterials().reorderLevel` (MASTERS_Materials col F).

## 8. Stock Alerts  ✅
**Stitch:** Stock Alerts (Mobile) · **HTML:** `07-stock-alerts.html`
- Low-stock items, shortfall-sorted. **Data:** `getLowStockItems()`.

## 9. KPI Dashboard  🔵 (buildable now)
**Stitch:** `259421dee2b34c58a081ecb280abc5ab` (Desktop) · **HTML:** `09-kpi-dashboard.html`
- Side-nav + navy top bar ("Quality KPIs", 7D/30D/90D). KPI grid: cards = white, 1px outline,
  **4px top status strip** (emerald on-target / red below / amber warn / gray no-data / blue info),
  label-caps name, large mono number, unit, trend line. Drill-down: FPY-by-week bar + supplier defect table.
- **Metrics:** IQC PASS %, FIRST-PASS YIELD, DISPATCH TAT, NCR RESOLVE DAYS, SUPPLIER OTIF, TOP DEFECT,
  FIFO COMPLIANCE, AGED STOCK >30D, MODULE DWELL, IPQC REJECT %, CUSTOMER RETURN %, NCR QTY AFFECTED.
- **Data:** existing KPI bundle (`KpiConfig.js` / `getLandingBundleV3Fast`). **Restyles `KPI_F.html`; no new server fns.**

## 10. Stock Map  🟦 (build-blocked: needs LOCATIONS coords)
**Stitch:** `8941cc0d02ca4423b273eeeb0c4b1040` (Desktop) · **HTML:** `10-stock-map.html`
- Top bar: "Stock Map · 1st Floor", GF/1F/2F, Treemap/Floor-Plan toggle, Color-by FIFO Age/Fill%.
- **Treemap:** rects sized by qty, FIFO-age colored (emerald/amber/red), sharp corners, mono labels, legend.
- **Floor plan (1F):** real zones — BULK RM J01–J25, PM A/B/C, FINISHED GOODS, BUFFER PALLETS M01–M24,
  LINE 1/2/3, SCRAP, LAB/QA — heat-tinted by fill %. Tap zone → Rack Detail.
- **Data:** treemap = `getStockSummary` + FIFO age (buildable). **Floor-plan geometry needs LOCATIONS
  hierarchy + per-zone coords (currently empty) → blocked.**

## 11. Rack Detail  🟦 (build-blocked: needs LOCATIONS hierarchy)
**Stitch:** `132dfaac862e4ce29cf54ed63ea2dc00` (Mobile) · **HTML:** `11-rack-detail.html`
- Top bar: back + "Rack J12 · Bulk RM" + aisle. Occupancy card (mono %, N of M bins, capacity bar).
- Bin slots (BIN 1…8): occupied = card + 4px left FIFO strip (material, mono lot pill, qty, age, mini pipeline);
  aged = red-striped + "AGED >30d"; empty = dashed "tap to assign". Sticky bar: Move lot / Putaway here.
- **Data:** per-bin occupancy needs LOCATIONS FLOOR-SECTION-AISLE-RACK-SHELF-BIN populated → blocked.
  Actions reuse `recordLocationTransfer`.

## 12–14. IQC Inspection / IPQC Round Entry / OQC Release  ➖
**Stitch:** IQC `04c5085a…`, IPQC `5b55977f…`, OQC `6ced63e7…` (Mobile) — **compact redesigns exist but are
future-reskin references only.** Locked decision: the cockpit **launches the existing IQC_F/IPQC_F/OQC_F forms**
via `getFormHtml`; do NOT rebuild them in P1/P2.

---

## Missing-screen summary
| Screen | Status | Blocker |
|---|---|---|
| KPI Dashboard | 🔵 buildable now | — (restyle KPI_F) |
| Stock Map | 🟦 blocked | LOCATIONS coords / floor-plan geometry |
| Rack Detail | 🟦 blocked | LOCATIONS hierarchy populated |
| IQC / IPQC / OQC | ➖ reuse existing | (intentional — not rebuilt) |

Other Stitch screens (Pipeline Detail, Putaway, Multi-Select, Move, Picker, Re-order, Stock Alerts) are built.
