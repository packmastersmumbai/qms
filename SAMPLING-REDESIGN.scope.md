# Sampling Redesign — Scope

**Status:** scoped, not implemented. Awaiting go-ahead.
**Date:** 2026-08-04
**Branch:** `feat/grn-iqc-redesign` (deploy @565)

Three changes, independently shippable, listed in dependency order.

---

## Decisions taken

| Question | Decision |
|---|---|
| Sample size basis | Per-material column in `MASTERS_Materials`; ISO 2859-1 as fallback when blank. Default seed value **2**. |
| Multi-material GRN | Per-item plan **and** per-item verdict. |
| Sample disposition | All four outcomes: consumed / returned / scrapped / retained. |

### Why master-override rather than fixed-2 everywhere

A fixed 2-piece sample is not an ISO 2859-1 plan. At n=2 the accept number is 0
(one defect rejects the lot) and a 10%-defective lot still passes ~81% of the
time. That is a spot-check, not lot acceptance.

That is a legitimate business choice, but it must not be *recorded* as an AQL
result. The override approach keeps both options open per material and stamps
the basis on the record, so a 2-piece check is never mistaken for an ISO plan
by a customer or an ISO 9001 auditor.

---

## WS1 — Sample size from the material master

**Problem.** Sample size is computed solely from lot size via ISO 2859-1. There
is no way to say "this material only ever needs 2 pieces".

**Schema.** `MASTERS_Materials` currently 15 cols (`MAT_WIDTH = 15`), with
`LastModified`/`ModifiedBy` at 13/14. Two new columns must be inserted BEFORE
the audit pair — the audit columns are found by name in MastersCrud but by
index in the row writers, so they shift:

```
MAT_COL.SAMPLE_SIZE  = 13   // blank = use ISO 2859-1
MAT_COL.SAMPLE_BASIS = 14   // 'FIXED' | 'ISO' | blank (blank => ISO)
LAST_MODIFIED 13 -> 15,  MODIFIED_BY 14 -> 16,  MAT_WIDTH 15 -> 17
```

> **Do not repeat the 2026-08-03 failure.** `MAT_COL.INSP_CATEGORY = 12` pointed
> past the end of a 12-column sheet and the whole category system was inert for
> weeks, while a smoke test passed 18/18 because it asserted the CONSTANT, not
> the SHEET. Migration must widen the live sheet and the test must read
> `getLastColumn()`.

**Server.**
- `_MaterialsSampleCol.js` — `?diag=matsamplecol` (dry-run) /
  `&confirm=YES` (live). Idempotent: widen sheet, insert 2 headers, move audit
  values right, seed `Sample Size = 2` on all 180 materials.
- `getMaterials()` — expose `sampleSize`, `sampleBasis`.
- `getIQCFormInit` / `getGRNItems` — return the material's sample size per item.
- `resolveSamplePlan_(item, lotSize, aql, level)` — single chokepoint:
  returns `{n, ac, re, basis}`. `basis = 'FIXED-MASTER'` when the master
  supplies n (then `ac = 0`, `re = 1`), else `'ISO-2859-1'`.

**Client.** Sampling panel shows the basis: "Fixed (material master)" vs
"ISO 2859-1 · Level I". Tooltip explains that a fixed plan carries higher risk.

**Record.** `IQC_LOG` gains `Sample Basis`. Without it the log cannot
distinguish a 2-piece spot-check from a 2-piece ISO plan on a tiny lot.

**Risk.** Column insertion is the highest-risk item in this scope — positional
readers exist across Masters/IQC/Warehouse/Import. Mitigation: run
`?diag=matsamplecol` dry-run first, back up the sheet, and extend
`e2e-schema4.js` to assert the live width BEFORE and after.

**Estimate.** ~4h including migration + schema guard.

---

## WS2 — Per-item sampling plan and verdict

**Problem.** `lotSize` auto-fills as the SUM of every GRN line
(`IQC_F.html:1025`), so one plan covers several different materials.
600 boxes + 300 tape + 100 film = "lot 1000" → 32 pieces, when ISO requires
32 + 20 + 8 = 60 across three separate judgements. It under-samples AND cannot
attribute a defect to a material.

**Note.** `itemData[]` already holds per-item `sampleSize`/`accepted`/
`rejected`/`hold`. Only the PLAN is aggregated — so this is less invasive than
it looks.

**Client.**
- Drop the GRN-level `lotSize` sum; per item, `lotSize = item.qtyReceived`.
- Move the sampling panel INTO the item card; store the plan on
  `itemData[idx].plan`.
- Per-item verdict; the GRN-level disposition becomes a roll-up
  (all accept → ACCEPTED, any reject → mixed, and mixed must be expressible).
- Chips show per-item state so an inspector sees which material failed.

**Server.** `saveIQC` already writes one row per item — write that item's own
plan and verdict into its row instead of the shared one.

**Open question for the user.** What should the GRN-level disposition be when
items disagree? Options: force per-item only (no overall), or add `PARTIAL`.
This affects downstream readers (`Records`, `Trace`, `DocView`, dispatch
eligibility) and must be decided before build.

**Estimate.** ~6h. Touches the most-used screen; needs a live-DOM check per
the "verify live DOM, not source" rule.

---

## WS3 — Sample disposition

**Problem.** Samples enter `SAMPLE-CABINET` and never leave. Measured
(`?diag=samplefate`): `SAMPLE_IN` 800, `SAMPLE_OUT` **0**, net **800 units**
across 5 materials; `SAMPLE_LOG` has 234 pulls totalling 3,135 units and **no
disposition column**. The balance only grows, and the verdict does not affect
it — accepted or rejected, the sample stays.

**Schema.** `SAMPLE_LOG` (11 cols) gains:
```
Disposition   CONSUMED | RETURNED | SCRAPPED | RETAINED
Disposed On   date
Disposed By   actor
Remarks       free text
```

**Ledger moves** (all via existing `writeStockLedger_`, all out of the cabinet):

| Outcome | Txn | Effect |
|---|---|---|
| Consumed in testing | `SAMPLE_CONSUME` | OUT of cabinet, no IN — destroyed by test |
| Returned to lot | `SAMPLE_RETURN` | OUT of cabinet, IN to original receiving location |
| Scrapped | `SAMPLE_SCRAP` | OUT of cabinet, IN to `SCRAP-AREA` (existing scrap accounting) |
| Retained as reference | `SAMPLE_RETAIN` | No stock move; marks the row closed so it stops reading as unreconciled |

`SAMPLE_RETURN` must restore stock to the ORIGINAL source location, which
`recordSample` already records — so no new field is needed.

**UI.** New "Samples" view listing open cabinet samples with age, plus a
disposition action. Optional prompt at IQC save for that inspection's sample.

**Backlog.** The existing 800 units predate this and have no disposition. Do
NOT auto-assign one — that would fabricate quality records. Offer a review
screen so a human closes them out.

**Estimate.** ~5h + UI.

---

## Sequencing

WS1 → WS2 → WS3. WS1 first because WS2's per-item plan should call the same
`resolveSamplePlan_` chokepoint; building WS2 first means writing that logic
twice.

WS3 is independent and could ship first if the frozen 800 units are the more
urgent problem.

## Not in scope

- Tightened/Reduced Ac/Re (Z1.4 II-B/II-C tables still unimplemented — the
  severity dropdown records a choice that does not change the numbers)
- Retroactive changes to existing IQC records
- OQC (same sampling engine; would need the same treatment afterwards)
