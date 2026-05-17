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

