# PM QMS — Remediation Plan

**Date:** 2026-08-04 · branch `feat/grn-iqc-redesign` · last good deploy **@573**
**Status:** PLAN ONLY — awaiting approval. Nothing in phases 1-6 is built.

---

## Phase 0 — UNBLOCK (yours, ~5 min) · **GATES EVERYTHING**

`clasp deploy` fails: *"Script has reached the limit of 200 versions."* Re-verified
2026-08-04. No code below can ship until this clears.

**Action:** Apps Script editor → project history → delete ~50 oldest versions.
**Keep:** @222 (documented rollback), @573 (current), any deployment in `clasp list-deployments`.

**Verify:** `clasp deploy --deploymentId AKfycbx... --description "unblock check"` succeeds.

> Everything below is written assuming Phase 0 is done. Sequence is deliberate:
> each phase depends on the one before it. Do not reorder without re-reading the
> dependency notes.

---

## Phase 0.5 — SNAPSHOT before any live write  *(5 min)*

Every phase below writes to the live spreadsheet backing real inventory. Sheets
version history is not a tested rollback.

**Before Phase 1C and again before Phase 4:** File → Make a copy of the bound
spreadsheet, named `PM QMS BACKUP <date> <phase>`. Record the copy's URL in the
phase log. **Save every dry-run JSON to a file** (`audit-out/<diag>-<date>.json`)
before running `&confirm=YES` — the dry run is the only record of intended state,
and eyeballing it in a terminal leaves no evidence.

---

## Phase 1 — Locations: stop the bleeding  *(~2h)*

| # | Task | Risk |
|---|---|---|
| 1A | `?diag=ghostfix` dry run → **save JSON** → `&confirm=YES` (defines 7 locations, **moves no stock**) | LOW — ledger untouched |
| 1B | Validate Default Location on material save; **WARN-ONLY** at GRN receipt (see below) | **HIGH — can halt receiving** |
| 1C | `?diag=ghostmerge` dry run → **save JSON** → `&confirm=YES` (the 2 `-AA` typos) | **HIGH — writes real stock movements** |
| 1D | Correct `Floor` on the 7 new rows (all currently `GF`) | LOW — one cell each |
| 1E | Resolve `HOLD` vs `FG-HOLD` (13,699 units) | MED — needs a decision, then a transfer |

### 1B is a soft block, not a hard reject — CORRECTED

An earlier draft of this plan framed 1B's risk as "ghosts regenerate if it ships
late." That is the *lesser* failure. The real danger is the reverse: a hard reject
at `GRN.js:97` for an unknown location **halts physical receiving on the factory
floor** for every material whose default is not yet defined — and 128 of 180
materials are in that state until 1A completes.

Therefore:
- 1B ships in the **same deploy** as 1A, never before it.
- First cycle is **warn + allow + flag for admin**, not reject. Promote to a hard
  reject only after `?diag=ghostloc` has returned 0 for a full week of receiving.
- Verify `GHOST_LOCATION_DEFS_` is exhaustive against **all 180** material defaults
  (`?diag=ghostdefaults` → 0 rows) before 1B goes live, not just against the 8
  ghosts that happen to hold stock today.

### 1C rollback — state it before running

`ghostLocationMerge` is idempotent only if the first run fully succeeds: a failed
lot leaves `status: FAILED`, the loop continues, and a re-run retries only lots
still showing a positive `-AA` balance. There is **no scripted undo**.

**To reverse:** run `recordLocationTransfer` with `from`/`to` swapped, per lot, using
the exact quantities in the saved dry-run `moves[]` array. This is why the dry-run
JSON must be saved to a file first — it *is* the rollback script.

**Gates (all four must hold):**
1. `?diag=ghostloc` returns 0 ghosts (excluding any deliberately deferred)
2. `?diag=ghostdefaults` returns 0 materials with an undefined default
3. `Floor` on the 7 rows is verified against the physical building — **not** left
   at the `GF` placeholder. Gate 1 cannot detect this; it needs a human to confirm.
4. `getNegativeStockLots()` returns no new negatives after 1C

---

## Phase 2 — Save-path defects  *(~4h)*

Known-broken today. Independent of Phase 1; could run in parallel by a second agent.

| # | Task |
|---|---|
| 2A | GRN latch: release `_grnSaveInFlight` when the operator modal is cancelled/dismissed (form is currently **dead until reload**) |
| 2B | Move the spinner/"Saving…" to *after* operator confirm — it currently lies about what is happening |
| 2C | Re-run `syncSubmitHint_()` on state change (hint says "Add a batch number" when batch is filled) |
| 2D | Idempotency key for GRN + Rework (only Gatepass has one; a retry after a dropped response can duplicate) |
| 2E | Watchdog + offline gate for the 7 forms lacking them (OQC, IPQC, Dispatch, CustomerReturn, POP, NCR, Rework) |

**Gates:**
1. `e2e-savepaths.js` shows GRN **PASS**, not INCONCLUSIVE; no form double-dispatches
2. **Live-DOM verification, not a green test.** A green suite has already coexisted
   with a dead GRN save once — that is why this phase exists. Each fix must be
   confirmed by reading the live DOM after deploy (the project's own
   `pmqms-verify-live-dom-not-source` rule), not by the suite passing.
3. Specifically for 2A: dismiss the operator modal, then confirm the Save button is
   usable **without a page reload**.

---

## Phase 3 — E2E rebuild  *(~5h)* · **the reason defects survived**

`e2e-suite.js` was 153/153 green while GRN's save was dead. It tests *rendering*.

| # | Task |
|---|---|
| 3A | **Fixtures** — a known supplier/material/GRN/IPQC session so the 6 skipped forms become drivable. This is the actual blocker, not test logic. |
| 3B | Fold `e2e-savepaths.js` into the suite as a real gate |
| 3C | Add `e2e-backnav.js` (SPA history) + a ghost-location assertion to the suite |
| 3D | Schema guard: assert **live sheet width** for LOCATIONS + MASTERS_Materials (the `MAT_COL` lesson — a smoke test passed 18/18 for weeks by asserting a constant) |

**Gate:** 9/9 write forms exercised, 0 skipped, 0 records written.

---

## Phase 4 — FG booking → buffer → OQC putaway  *(~6h)*

Scoped in `FG-PUTAWAY.scope.md`. Depends on Phase 1 (locations must be real first).

| # | Task |
|---|---|
| 4A | Book FG to `FG-HOLD` at production booking (currently **no FG stock entry exists at all** — `PROD_BOOK` 84 vs `OQC_RELEASE` 12) |
| 4B | **Convert `OQC_RELEASE` from a bare IN to a paired transfer** (OUT of FG-HOLD → IN to slot) |
| 4C | Fix `Qmsv2.js:329` — its inbound regex matches `FG-HOLD`, so booked FG would appear in the raw-material putaway queue |
| 4D | Point the existing putaway queue at FG rather than building a second screen |

### 4A + 4B MUST SHIP AS ONE ATOMIC DEPLOY

Not two tasks in sequence — **one push, one deploy, one gate.** If 4A lands and 4B
does not, every OQC release in that window **double-counts FG**: booking credits
FG-HOLD and `OQC.js:302` still writes a bare IN to the slot. That window includes
the gap between `clasp push` and `clasp deploy`, and any point where an agent stops
after 4A's gate passes. Neither may be deployed alone, and no agent may treat 4A as
independently shippable.

**Historical stock is NOT affected** and needs no migration: pre-cutover OQC
releases were bare INs with no FG-HOLD counterpart, which is internally balanced.
Only bookings *after* 4A creates an FG-HOLD balance are at risk.

**Business decision to surface, not bury:** the 84 historical `PROD_BOOK` rows have
no FG stock entry and are excluded from retroactive correction
(`FG-PUTAWAY.scope.md:121`). That production remains permanently invisible in stock.
That is a silent gap, not a corruption — but the owner should agree to it explicitly
rather than find it later.

**Gates:**
1. Booked → released quantities reconcile exactly on a **live** booking (not reasoning)
2. `getNegativeStockLots()` (`Warehouse.js:246`) shows **no negative at FG-HOLD** — a
   mis-paired OUT/IN surfaces there first, and aggregate reconciliation can miss it
3. Ledger conserves: booked in = allocated + remainder

---

## Phase 5 — Sampling  *(~4h)*

| # | Task |
|---|---|
| 5A | Sample disposition for the 800 cabinet units (`?diag=samplefate`: 800 in, **0 out**) — human closes them out; **no auto-assignment**, that would fabricate quality records |
| 5B | Per-item sampling plan + verdict (lot size currently sums all GRN lines: 3 materials → one plan, under-samples 32 vs 60, cannot attribute a defect to a material) |
| 5C | Material-master sample size with ISO fallback |

---

## Phase 6 — Location schema + multi-floor  *(~8h)* · **do last**

Depends on **1A + 1B + 1E** — not just 1D. Locations must exist (1A), be validated
(1B), and the `HOLD`/`FG-HOLD` ambiguity must be resolved (1E), because 6D replaces
exactly the substring-matching that ambiguity lives in. 1D (Floor) additionally
gates 6B/6C, the multi-floor map. Defining `Zone ID`/`Behaviour` for locations that
don't exist yet is backwards.

| # | Task |
|---|---|
| 6A | Append `Zone ID`/`Behaviour`/`Sort` to LOCATIONS (**append, never insert**) |
| 6B | `LOCATION_ZONES` sheet; floorplan derives its grid from it |
| 6C | Floor selector (GF/1F/2F); render the 11 logical zones so `RM-STORE-A`'s 60,938 units stop being invisible |
| 6D | Replace substring-matching (`/QUARANTINE\|HOLD\|SCRAP/`) with the explicit `Behaviour` column — today a location named `RM-HOLDING-BAY` is silently treated as non-issuable |
| 6E | `Cap Basis`/`Cap Value` per location |

---

## NOT in this plan

- **Capacity-aware auto-suggest** — blocked on data, not code: 178/180 materials lack
  `perPallet` and dimensions. Data entry by someone who knows the products.
- **Z1.4 II-B/II-C tables** — the severity dropdown records Tightened/Reduced but
  Ac/Re stay normal-plan. Needs the authoritative tables.
- **2 HANGER materials** — need inspection criteria from the operator.
- **FIFO enforcement on dispatch** — existing TODO, advisory only today.

## Cross-cutting: idempotency applies to diags too

Phase 2D adds idempotency keys to GRN and Rework because "a retry after a dropped
response can duplicate." **`?diag=ghostmerge` has the same exposure and more
consequence** — `google.script.run` timeouts are a documented risk in this codebase,
and a double-fire on the same lot within one request has nothing marking it in
flight. Before 1C runs, give `ghostLocationMerge` the same treatment: a natural
dedup key on the transfer so a double-fire is at minimum detectable afterwards.

---

## Execution method

Sonnet subagents, one phase at a time, each with: read live DOM not source · never
write production records · `?diag=` dry run before any live write · report honestly
including failures. Full `e2e-suite.js` after every phase.

## Open questions

1. GRN-level disposition when items disagree — per-item only, or `PARTIAL`? (blocks 5B)
2. Did the GRN reporter actually see the operator modal? If they confirmed it and it
   *still* failed, there is a second bug behind 2A.
3. `HOLD` — same as `FG-HOLD`, or a distinct area? (blocks 1E)
