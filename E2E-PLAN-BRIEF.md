# PM QMS — E2E Test Plan Brief

> **Purpose:** Start a fresh session with `/plan` (or the `planner` agent) to produce a complete end-to-end test plan for the Pack Masters QMS. This document is the briefing.

## How to start the next session

1. Open Claude Code in this repo (`PM QMS`).
2. Run: `/clear` to wipe context.
3. Paste this prompt:

   > Read `E2E-PLAN-BRIEF.md`. Then produce the E2E test plan as `docs/E2E-TEST-PLAN.md`. Do not write any test code yet — only the plan. Stop after the plan is written and wait for review.

## What the QMS is

A Google Apps Script web app (mobile-first) for a packaging manufacturer's quality management. **17 forms** spanning the receive → inspect → make → ship → resolve flow, backed by a Google Sheets spreadsheet with ~25 tabs. Deployed via clasp; production deployment ID `AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA`, currently at version **@214** on branch `fix/section-a-structural` (merged to `main`).

## What just happened (last 48 hours)

Two rounds of code-reviewer audits found and fixed **29 CRITICAL/HIGH defects** across save paths. Last commit `c5e7694`. Highlights:
- OQC/Gatepass/Dispatch save chain rebuilt (materialCode propagation, OUTBOUND type tag, goHome, header-lookup LOCATIONS column)
- IQC/GRN payload completeness (silent data loss in stock ledger eliminated)
- POP `updateDraftPO` delete-row corruption fixed
- CustomerReturn ledger-before-CLOSED transactional ordering
- IPQC closed-session write guard
- Records → detail navigation (was dropping docNo)
- NCR audit-trail blank `WHO` fixed
- BottomNav removed from all 14 transactional forms (was covering submit buttons)
- `+ New record` button added to home page module rows
- PMHtmlCache prefix bumped v1→v2 to force-clear stale form HTML

Audits live in agent transcripts; key defect lists are summarized in commit messages on `main`.

## The user's brief

> *"do proper plan for e2e of entire project"*

The user wants a **complete E2E test plan**, not exploratory testing. They've reported persistent errors on OQC, Gatepass, Dispatch (now fixed in code; not user-verified). They want confidence the full system works end-to-end before declaring production-ready.

## What "E2E" means in this codebase

The QMS is **state-coupled**: most forms write or read shared sheets, and a happy-path purchase order flows through ~8 forms before becoming a delivered dispatch. A useful E2E plan must:

1. **Trace business journeys** (not just per-form CRUD): e.g., "Receive 100 kg of raw material → IQC PASS → Production issue → IPQC PASS → OQC PASS → Gatepass → Dispatch → Customer Return."
2. **Cover regression seams** where the recent fixes could re-break (materialCode propagation, BottomNav removal, FG_DISPATCH_LOTS mirror, session-storage intent flags, header-lookup column resolution).
3. **Test failure modes**, not just happy paths: empty sheets, missing optional sheets, lock contention, partial-commit ledger failures, network drops mid-save.
4. **Distinguish layers**: unit (Apps Script server functions, `_Diag.js`-style runners), integration (full form save → sheet write → cross-sheet read), UI (operator workflow on actual deployment).

## Required deliverable

Produce `docs/E2E-TEST-PLAN.md` with these sections:

### 1. Test taxonomy & scope
- Layers covered (unit / integration / UI / data-integrity / regression)
- What's out of scope (explicitly)
- Environments (production deployment vs. a copy / test spreadsheet)

### 2. Test data setup
- Required masters: suppliers, customers, FG materials, RM materials, locations (with at least one of each type: RM/QUARANTINE/FG/FG-HOLD)
- Seed POs, GRNs to bootstrap the chain
- How to reset between test runs (snapshot/restore strategy)
- A `setupTestData()` Apps Script function spec (to be implemented later) — what it creates, what it doesn't touch

### 3. Business journeys (the core of the plan)
Each journey must list:
- **Name & goal** (e.g., "J01: Happy-path RM receive → release")
- **Pre-state** (what masters/data must exist)
- **Steps** (operator actions, with expected screen + result)
- **Assertions** (sheet rows, status columns, ledger entries, computed counts, downstream availability)
- **Pass criteria** (concrete, e.g., "GRN_LOG row appears with qtyReceived=100, IQC dropdown now lists this GRN")
- **Cleanup** (or "depends on snapshot restore")

Minimum journeys to cover:
- J01: RM happy-path (PO → GRN ACCEPT → IQC PASS → stock available in RM)
- J02: RM rejection (GRN REJECT → no IQC needed → NCR auto-raised)
- J03: RM IQC fail (GRN ACCEPT → IQC REJECT → NCR auto-raised → stock stays in quarantine)
- J04: Production issue happy-path (RM available → Production Issue → BOM debits stock → IPQC session opens)
- J05: Production partial-issue failure (BOM mid-failure → operator sees `requiresReversal: true` → reversal path)
- J06: IPQC session lifecycle (start → round 1 PASS → round 2 FAIL → NCR raised → close session)
- J07: FG release happy-path (IPQC close → OQC ACCEPT → FG_DISPATCH_LOTS row auto-created with correct productCode)
- J08: OQC reject (IPQC close → OQC REJECT → NCR auto-raised → no FG lot created)
- J09: Dispatch happy-path (FG available → Preview FIFO → Confirm → Gatepass auto-flow → DISPATCH_LOG row)
- J10: Dispatch FIFO override (operator skips a lot → 5-char reason required → FG_FIFO_OVERRIDE_LOG row)
- J11: Customer return RESTOCK (return logged → triage RESTOCK → ledger moves stock back → return CLOSED)
- J12: Customer return SCRAP (return logged → triage SCRAP → recordScrap + NCR)
- J13: NCR lifecycle (auto-raised → operator dispositions → IN_PROGRESS → CAPA fields → CLOSED)
- J14: Records cross-module nav (tap an NCR card from Records → lands inside NCR with correct record auto-opened)
- J15: Masters CRUD (add/edit/delete one of each type; verify duplicate-name guard)
- J16: Concurrent-save race (two tabs save the same Dispatch simultaneously → lock holds → one succeeds, one fails cleanly)
- J17: Cache invalidation (deploy → operator with stale tab → new HTML loads after sessionStorage refresh)

### 4. Negative / edge cases
- Empty masters (no suppliers, no FG locations, no LOCATIONS sheet at all)
- LOCATIONS sheet with re-ordered columns (Type not in col 9) — exercises the header-lookup fix
- IPQC session closed in another tab while still open in current tab
- OQC saved without FG location (button must stay disabled — recently fixed)
- Gatepass for OQC that's already been gatepassed (server replay-guard must fire)
- Photo upload with non-image MIME (recently fixed)
- Multi-tab disposition of the same NCR

### 5. UI / layout regression suite
After BottomNav removal and `+ New` button addition:
- Submit buttons visible on every transactional form at narrow + wide viewports
- BottomNav present only on Landing/Records/KPI/Masters/Dashboard
- `+` button on every transactional module row of Landing; absent on NCR / KPI / Warehouse / Masters / Control Plan rows
- Form opens in "new record" mode when `+` tapped; in "list" mode when row body tapped
- pmFormIntent / pmAutoOpenDoc keys clear from sessionStorage after consumption (no leak between sessions)

### 6. Diagnostic gates
Before any journey runs, these `_Diag.js` functions must pass:
- `diagSheets()` — every required sheet present with expected header row
- `diagLocations()` — at least one of {RM, QUARANTINE, FG, FG-HOLD} type
- `diagDispatchPlan()` — confirms FG_DISPATCH_LOTS has rows for any FG product under test

Specify expected output, not just "run it."

### 7. Tooling proposal (don't build, just propose)
- Manual checklist Markdown (what testers tick off) — cheapest, ships immediately
- Apps Script-side test runner (`runJourneyJ01()` style functions logging to a TEST_RESULTS sheet) — semi-automated
- Vercel Agent Browser / Playwright against the live deployment URL — full E2E, biggest lift
- Recommend **which to start with** given the project's stage. Justify briefly.

### 8. Coverage matrix
A table: rows = each form save path (17 of them), columns = which journeys exercise it. Visually identify any form whose save path no journey hits → those are gaps to fill.

### 9. Risk-ranked execution order
Don't list 17 journeys to run sequentially. Rank by risk × likelihood-of-regression so the first 5 journeys catch 80% of bugs. Specifically the journeys that exercise:
1. The recently-fixed materialCode propagation chain
2. The recently-fixed BottomNav / submit button visibility
3. The recently-fixed Records→detail navigation
4. The auto-mirror OQC→FG_DISPATCH_LOTS path
5. The OUTBOUND type Gatepass replay guard

### 10. Acceptance criteria for "system is E2E-tested"
Concrete bar. E.g., "All P1 journeys (J01, J04, J07, J09, J13) pass twice in a row with no manual sheet edits between runs, OR a documented gap is logged."

## Files the planner should read (don't try to load everything)

Just-in-time, by area:
- **Architecture & data flow:** `PLAN-V3-QR-QMS-PROJECT.md`, `PM-QMS-PROJECT-BRIEF.md`, `Initialize.js` (sheet schemas)
- **Save paths to validate (post-fix):** `OQC.js`, `Gatepass.js`, `Dispatch.js`, `IQC.js`, `GRN.js`, `IPQC.js`, `Production.js`, `CustomerReturn.js`, `NCR.js`, `POP.js`, `MastersCrud.js`
- **Forms (for UI flows only):** `*_F.html` — don't deep-read; skim for save button onclicks, error toasts, sticky footers
- **Recent fixes (for regression seam coverage):** `git log --since="2 days ago" --oneline -p` — read the diffs from commits `285eb8f` through `c5e7694`
- **Diagnostics:** `_Diag.js`

## What NOT to do in the next session

- ❌ Write any test code. The deliverable is `docs/E2E-TEST-PLAN.md`, nothing else.
- ❌ Run the diagnostics or anything destructive against the live spreadsheet.
- ❌ Restate the entire defect history. Reference commits if needed.
- ❌ Try to cover Settings_F, DocView_F, ImportCSV_F as primary journeys — they're admin utilities, not transactional. List them under "out of scope" or "smoke test only."
- ❌ Boil the ocean. If a journey takes more than 6 steps to describe, split it.

## Pacing

Time-box the planner to ~45 min of context. The plan should be 1500–3000 words, with the journey list being the longest section. Tables are encouraged.

## Where to commit

`docs/E2E-TEST-PLAN.md` on a new branch `plan/e2e-test-suite`. Don't merge to main yet — user reviews first.
