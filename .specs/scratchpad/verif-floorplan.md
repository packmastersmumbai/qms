# Verification Specification Scratchpad: Warehouse Floorplan & Location Module

Task: .specs/tasks/draft/implement-warehouse-floorplan-location-module.feature.md

---

## Stage 1: Context

### Quality Gates Found
| Gate | Command | Applies |
|------|---------|---------|
| Build | none (GAS, no Node build) | — |
| Lint | none | — |
| Unit test runner | NONE in prod. Convention = runnable GAS `_test*()` assert functions run in GAS editor (`_TestHelpers.js`). | Steps 1,4,6 (backend logic) |
| Deploy/manual QA | `clasp push` + `playwright-cli screenshot` (light+dark, in-iframe) | Step 2,3 (HTML) |

No Node test runner → NO vitest/jest/pytest. Test strategy = GAS assert `_test` functions + manual playwright-cli QA for SVG map. This is authoritative.

### Project Guidelines Found
| Source | Path |
|--------|------|
| Project CLAUDE.md | ./CLAUDE.md (GAS gotchas: double-iframe blocks CDN, @media hover unreliable, google.script.run async, cache versioning, .claspignore) |
| Global CLAUDE.md | ~/.claude/CLAUDE.md |
| .claude/rules/ddd | domain-naming, early-return, size-limits, library-first |

→ Include Project Guidelines Alignment dimension in every rubric (weight 0.15).

### Step Inventory & Classification
| Step | Artifact | Criticality | Level | Threshold |
|------|----------|-------------|-------|-----------|
| 1 | Initialize.js seed + Warehouse.js inferLocType | HIGH (RISK-1+2; breaks reject/return/rework) | Panel (2) | 4.0 |
| 2 | WarehouseFloorplan.html (NEW SVG map) | MEDIUM (user-facing, no data write except tile-pick) | Single | 4.0 |
| 3 | Code.js pageMap + QMSV2_F.html tile | LOW/MEDIUM (routing) | Single | 4.0 |
| 4 | Masters.js saveMaterial 12-col writer | HIGH (data integrity; truncation corrupts master) | Panel (2) | 4.3 |
| 5 | material form F→L geometry | MEDIUM | Single | 4.0 |
| 6 | Warehouse.js suggestSlot fit engine | HIGH (business logic, runnable assert) | Panel (2) | 4.0 |

Total evaluations: 2+1+1+2+1+2 = 9. Panel:3, Single:3, Per-Item:0, None:0.

### AC → Step coverage map
- Location reseed count/format → Step 1
- Bay distribution & columns → Step 1
- Floor-count verification (manual, DoD) → Step 1 (blocker/manual)
- Map both themes no CDN → Step 2
- Occupancy heatmap %full → Step 2
- Tap position contents → Step 2
- Lot search highlight → Step 2
- KPI strip → Step 2
- Tile-pick movement fallback → Step 2
- saveMaterial truncation fix → Step 4
- Material geometry at creation → Step 5
- Fit engine + suggestSlot → Step 6
- NFR compat/aesthetic/backend-reuse/data-integrity → Steps 1,2,4

Every AC covered. ✓

## Test Strategy notes (GAS-adapted)
- Backend steps (1,4,6): GAS `_test*()` assert functions, size=small, framework="GAS assert (editor-run)", deps=scratch sheet / stub locations. No Node runner.
- HTML steps (2,3): manual playwright-cli screenshot QA (light+dark) + in-iframe render check. type=manual/e2e, framework=playwright-cli. No automated component test possible (double-iframe).
- BVA applied: seed counts (147/148/149 rows; bay boundary), regex zero-pad (B001 vs B1), saveMaterial width (5→12), suggestSlot fit (qty at pallet boundary; weight-bound vs volume-bound).

## RRD: weights sum 1.0 per step, decomposed generic "quality"→specific. Self-verify 6Q each: discriminative, coverage, redundancy, bias(no length reward), scoring clarity, test soundness — all pass after adding BVA boundaries + backend-reuse hard rules.
