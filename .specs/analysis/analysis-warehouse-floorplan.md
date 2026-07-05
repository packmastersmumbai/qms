# Codebase Impact Analysis — Warehouse Floorplan & Location Module

Task: `.specs/tasks/draft/implement-warehouse-floorplan-location-module.feature.md`
Scratchpad: `.specs/scratchpad/c432c786.md`
Risk level: **MEDIUM–HIGH**

## Affected files
| Path | Action | Why |
|---|---|---|
| `WarehouseFloorplan.html` | CREATE | Blueprint SVG+CSS map; consumes existing `getStockView`/`getStockSummary`/`getLowStockItems`/`whereIsLot`/`recordScan`/`recordLocationTransfer`/`issueRMForProduction`. |
| `Code.js` | MODIFY (P1) | Add pageMap entry near line 270 + cockpit nav tile. Routing already supports it. |
| `Initialize.js` | MODIFY (P1) | Reseed `LOCATIONS_SEED` (line 107) — ADD B001–B148 (see RISK-2). |
| `Masters.js` | MODIFY (P2) | `saveMaterial` (line 350) 5→12-col writer BEFORE fields; `getMaterials` (14) widen; `ensureMaterialsLocationColumn_` (75) seed F→L. |
| `Warehouse.js` | MODIFY (P2) | Add `suggestSlot` + `min(volume,weight)`; fix `inferLocType` (329). |

## Verified backend (task claim CONFIRMED against source)
- `getLocations` (`Warehouse.js:278`) reads LOCATIONS cols 0–11 → `{id,floor,section,aisle,rack,shelf,bin,label,type,capacityQty,capacityUnit,active}`; filter `r[0] && r[11]!=='N'`; typeFilter on col 8. **`capacityQty`/`capacityUnit` populated but consumed by no caller — confirmed unused.**
- Rollups `getStockSummary` / `getStockByMaterial` (176) / `getLowStockItems` (199); `getStockView` (306); `saveLocation` (523) writes 12 cols.
- `Scan.js`: `recordScan` (289) validates against `CHOKEPOINTS_` only; `whereIsLot` (415); location resolved from chokepoint sticker, not free tile pick.

## Integration points
- Scan movements accept ONLY 4 chokepoint IDs (`Scan.js:48/56`) — B### tile-pick putaway must use `recordLocationTransfer`, NOT `recordScan`.
- GRN putaway keys off material `defaultLocation` (`GRN.js:7,59,97`; `GRN_F.html:508/919/947`) — unaffected unless defaults re-pointed to B### slots.
- New screen wires via `Code.js:270` pageMap entry + `QMSV2_F.html` cockpit tile; `doGet`/`createTemplateFromFile` needs no new plumbing.
- `computePendingCounts_` (`Code.js:407`) unaffected — floorplan is a view, not a queue.

## RISKS
- **RISK-1 (P1, HIGH, NOT in original task):** `inferLocType` (`Warehouse.js:329-341`) prefix ladder returns `''` for IDs starting with `B`. B### slots type correctly ONLY because their LOCATIONS row col I (Type) is set and `getStockView` uses `locTypeMap[id] || inferLocType(id)`. Ensure every B### row has Type populated; optionally map floor-letter→type in `inferLocType`.
- **RISK-2 (P1, HIGH):** The 8 seed zones (`Initialize.js:107` — RM-STORE-A/B, QUARANTINE, FG-STORE, FG-HOLD, SCRAP-AREA, SAMPLE-CABINET, REWORK-AREA) are referenced by hardcoded string IDs in `IQC.js:174/644`, `OQC.js:296-304`, `NCR.js:118`, `CustomerReturn.js:230/383/385/427`, `Rework.js:136`, `_J07.js:15`, plus 3 runtime chokepoint rows (`Scan.js:56`). Reseed must **ADD B001–B148 and KEEP** these; wholesale replacement breaks reject/return/rework flows. `Initialize.js:552` reset re-runs the seed, so both sets must persist.
- **RISK-3 (P2, HIGH — task headline):** `saveMaterial` (`Masters.js:350`) fixed 5-element row → convert to read-modify-write 12-col writer BEFORE adding F→L, else geometry cols are dropped on edit. `getMaterials` (14) must widen too.
- **RISK-4 (LOW):** LOCATIONS capacity cols J/K read+written but never used — safe to leave empty under the "1 pallet/slot" model.
