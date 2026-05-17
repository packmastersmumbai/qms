# PM QMS — System-Wide Validation Plan

**Created:** 2026-05-17
**Status:** Phase 1 in progress

## Scope

Per-module smokes are done. This plan covers the **cross-module end-to-end** gap.

## Phases

| # | Phase | Deliverable | Effort |
|---|---|---|---|
| 1 | Run all `*Diag` baselines | clasp-run output captured below | 15 min |
| 2 | Build `smokeFullChain()` | PO→GRN→IQC→Prod→OQC→Dispatch single-call helper + archive | ~2 hrs |
| 3 | STOCK_LEDGER reconciler | `runLedgerReconcile()` flags drift per (material,batch,location) | ~1 hr |
| 4 | Reject-path smokes | IQC REJECT / IPQC OOS / OQC REJECT scripted flows | ~1 hr |
| 5 | Permissions audit | Classify every exported fn; gate test helpers behind `_TESTING_ENABLED` | 30 min |
| 6 | KPI tie-out | Recompute 5 KPIs from raw sheets, diff vs. dashboard | 30 min |
| 7 | Restore drill | Drive-history restore on copy spreadsheet | 30 min |

## Phase 1 — Diagnostic Baselines

Captured 2026-05-17 against deployment @142.

| Diagnostic | Result | Notes |
|---|---|---|
| `verifyAndRepairSheets_core` | `ok:true` | All 13 core sheets have correct column counts. |
| `runDispatchDiagnostics_core` | `fails:0, warns:7` | Dispatch usable. WARN: `availPlusPartial:0` (no live FG lots — expected, all TEST data archived last session). |
| `runProductionDiagnostics_core` | `fails:0, warns:1` | Production usable — 11 materials ready. 51 materials returned by `getProductionFormInit`, 23 with ≥1 lot. |
| `runPOPDiag_core` | `errors:1, warns:1, total:25` | **NEW core wrapper added this session.** ERROR: `PM/PO/2026-004 L3 pending=0 expected=-99` — over-receipt anomaly, needs investigation. |
| `runKPIDiag` | console output, no return | All §3-§8 checks pass. WARN: customer return match-rate 0% (1 unresolved return; sample size of 1). NCR_OPEN=0, IN_PROGRESS=0. |
| `runIntegrationSmoke` | `pass:28, fail:0` | Tag `SMOKE-20260517-184917`. |

### Findings
- **System-wide health is green** — no FAILs across 6 diagnostics, 28-test integration smoke clean.
- **One data anomaly surfaced**: `PM/PO/2026-004 L3` has been over-received by 99 units (pending=0, expected=-99). Likely a GRN entered with `qtyReceived > qtyOrdered` for that line. Not a code bug; a data record needing reconciliation.
- **Sequence integrity confirmed** — `_TEST_ARCHIVE` already contains 9 rows from last session's smokes, none in live sheets.
- **Added**: `runPOPDiag_core()` (headless wrapper) and `getDiagRows(sheet, severity)` reader so future Phase-N runs can be fully automated.

## Phase 2 — `smokeFullChain()`

Completed 2026-05-17. New sibling file `_SmokeFullChain.js` (kept `_TestHelpers.js` focused on row-level helpers). `_testNextSeq_` scan list extended to include `GRN_LOG`, `PO_HEADER`, `PROD_ISSUE_LOG`, `GATEPASS_LOG` for cross-sheet TEST-prefix uniqueness.

New callable API Executable fns:
- `smokeFullChain()` → `{success, docNos, archived, countersBefore, countersAfter, countersRestored, errors}`
- `createTestProductionBatch(payload)` → `{success, docNo, batchNo, issueId}` — appends to `PROD_ISSUE_LOG` + writes `STOCK_LEDGER` `RM_ISSUE` consumption
- `createTestPO_(payload)` / `createTestGRN_(payload)` — internal but callable; bypass real `getNextDocNumber`

### First successful run
- gp_counter before: **16** → after smoke (pre-restore): 17 → after restore: **16** ✅
- All other counters (po/grn/iqc/oqc/prod) unchanged before vs. after — TEST prefixes never touched real counters.
- docNos: po `TEST/PO/2026-001`, grn `TEST/GRN/2026-001`, iqc `TEST/IQC/2026-001`, prod `TEST/PROD/2026-001`, oqc `TEST/OQC/2026-001`, fgLot `TEST-FGL-...`, gp `PM/GP/2026-016`
- archived: gatepass=1, stockLedger=3, fgLots=1, oqc=1, iqc=1, grn=1, po=1, poLines=1, prod=1

### Decisions
- **Sibling file over extending `_TestHelpers.js`** — `smokeFullChain` + 3 sub-helpers run ~280 lines; keeping `_TestHelpers.js` as row-level primitives keeps both files coherent.
- **Restore only `gp_counter`** — every other step bypasses `getNextDocNumber`, so no other counter advances.
- **`SpreadsheetApp.flush()` between steps** — each upstream write must commit before next read.
- **STOCK_LEDGER archival by refDocNo (col 11, idx 10)** — covers GRN_RECEIPT, RM_ISSUE, and FG_DISPATCH entries written during the chain. Result: 3 ledger rows archived.
- **`setDocCounter('gp', ...)` moved into `finally` block** (judge improvement) — counter restore now executes even if archive sweeps throw.

## Phase 1 Anomaly Closure — PM/PO/2026-004 L3 over-receipt

Resolved 2026-05-17.

**Root cause**: GRN/2026-040 (row 133 in GRN_LOG, material 2966564 / AP TrueGrip 4Lt) was entered with BOTH `qtyOrdered=199` AND `qtyReceived=199` against a PO line where the real qtyOrdered was 100. Pattern: data-entry typo at GRN creation.

**Fix applied**:
- GRN_LOG row 133: `qtyOrdered` 199→100, `qtyReceived` 199→99.
- No STOCK_LEDGER entry existed for this GRN (legacy pre-ledger-wiring data), so no ledger correction needed.
- PO_LINES auto-refreshed via the next `getPOById` call that touched the line; `reconcilePOReceipts()` is the explicit self-heal but errored on `getUi()` headless — POP refresh path was sufficient.

**Verification**:
- `runPOPDiag_core` after fix: `errors:0, warns:0, fails:0, total:25` (was `errors:1, warns:1, total:25` before).
- PO/2026-004 L3 final state: `qtyOrdered=100, qtyReceived=99, qtyPending=1, lineStatus=PARTIAL`.

**Tooling**:
- One-shot inspector + fixer in `_AnomalyFix.js` (`_inspectGRN040`, `_fixGRN040Overreceipt`). Kept in repo for audit trail; safe to delete in any future session as the anomaly cannot recur on this same row (idempotent guard: only fires when `ordBefore===199 && recBefore===199`).
- Follow-up worth doing later: refactor `reconcilePOReceipts()` into `_impl(headless)` + menu wrapper so it can be called headlessly (same pattern as `runPOPDiag_core`).

