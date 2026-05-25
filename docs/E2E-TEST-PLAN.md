# PM QMS — End-to-End Test Plan

**Version:** 1.0 · **Date:** 2026-05-25 · **Target deployment:** `@214` (Apps Script primary)
**Branch:** `main` · **Commit at plan time:** `c09ddee`
**Status:** Draft for review. Do not start execution until journeys J01–J05 have a confirmed test data set and the diagnostic gates pass.

---

## 1. Scope & Test Taxonomy

### What this plan covers

| Layer | Tooling | What it proves |
|---|---|---|
| **Diagnostic gate** | `_Diag.js` functions in Apps Script editor | The Sheets back-end is structurally sound before any journey runs |
| **Unit (server)** | Direct Apps Script function calls with crafted payloads, logged to `TEST_RESULTS` sheet | Each server function returns expected shape under normal and edge inputs |
| **Integration** | Operator-style flow across forms, observing both UI state and resulting sheet rows | Cross-form data contracts hold (e.g., OQC PASS produces a `FG_DISPATCH_LOTS` row with non-empty `productCode`) |
| **UI / layout regression** | Manual checklist on the live deployment URL at narrow (375px) + wide (1280px) viewports | Recent BottomNav removal + `+ New` button work; no submit buttons cut off |
| **Data-integrity** | Snapshot the spreadsheet → run a journey → diff snapshots | Stock ledger reconciles; status columns advance correctly; no orphaned rows |

### What is **out of scope** for this plan

- Settings_F.html, DocView_F.html, ImportCSV_F.html, MastersCrud_F.html (admin utilities) — smoke test only, no journey
- WhatsApp notification delivery — separate channel test
- KPI dashboard correctness — read-only aggregate; verified by journey side effects, not directly
- Performance / load testing — not yet required at user volume
- Browser matrix — Chrome on Windows + iOS Safari only (matches operator devices)
- GitHub Pages mirror — not an operational surface
- Stitch HTML mockups in `stitchhtml/` — design artifacts only

### Environments

| Env | Spreadsheet | Apps Script deployment | Use |
|---|---|---|---|
| **Production** | Current live sheet | `@214` (primary deployment) | Final acceptance only, after staging passes |
| **Staging (recommended)** | Copy of production sheet, sanitized | New deployment from same `main` HEAD, separate deploymentId | All journey execution |
| **Dev** | Throwaway sheet | `clasp push` to `@HEAD` deployment | Author edits, repeat-run journeys |

**Open question:** A staging deployment does not exist yet. Section 11 lists this as a prerequisite for execution.

---

## 2. Test Data Setup

### Required masters (minimum viable seed)

| Sheet | Rows needed | Specifics |
|---|---|---|
| `MASTERS_Suppliers` | ≥ 2 | one with category=RM, one with category=PACK |
| `MASTERS_Customers` | ≥ 2 | one domestic, one export (for Gatepass UI variants) |
| `MASTERS_Materials` | ≥ 4 | 2× RM (one with default location), 1× PACK, 1× FG with BOM linking to the 2 RMs |
| `MASTERS_Personnel` | ≥ 3 | one inspector, one operator, one approver — different names |
| `LOCATIONS` | ≥ 4 | one each: `RM-STORE-A` (RM), `QUARANTINE` (QUARANTINE), `FG-STORE` (FG), `FG-HOLD` (FG-HOLD) |
| `MASTERS_Parameters` | full IPQC + IQC + OQC param sets | Otherwise checks render empty; FG product must have parameters mapped via `CONTROL_FG_PARAMS` |

### Bootstrap transactional data

| Sheet | Rows | Purpose |
|---|---|---|
| `PO_HEADER` + `PO_LINE` | 2 OPEN POs against the seeded RM supplier, 2 lines each | Lets J01 start; verifies multi-line PO path |
| All other transactional logs | empty | Each journey writes its own rows |

### Reset strategy

Until a snapshot/restore utility exists, the only safe reset is **work on a copied spreadsheet**. Do not run destructive journeys against production. A future `_TestSeed.js` (not yet written) should provide:
- `seedTestMasters()` — idempotent insert of the masters above
- `seedTestPOs()` — insert 2 bootstrap POs, log their docNos
- `snapshotTransactionalSheets()` → writes JSON to a `TEST_SNAPSHOTS` sheet
- `restoreFromSnapshot(snapshotId)` → blocks if any sheet has rows newer than the snapshot

Out of scope for this plan — implementation tracked separately.

### Operator persona

All journeys use one **named operator** (e.g., `TEST_OPERATOR`) via `OperatorPicker`. This proves the audit trail columns (`Disposition By`, `ModifiedBy`, `operatorId`) are correctly written — the recent NCR fix relies on this exact code path.

---

## 3. Business Journeys

Each journey: **Goal · Pre-state · Steps · Assertions · Pass criteria · Cleanup**.

### J01 — RM happy-path receive → release ★ P1

**Goal:** Prove the receive→inspect→stock-available chain for a clean RM batch.

**Pre-state:**
- One OPEN PO with one line for material RM-001, qty 100 kg
- Supplier from seed, RM location seeded

**Steps:**
1. Home → tap `+` on GRN row → expect blank GRN form
2. Select supplier → PO dropdown populates with the seeded PO (post-fix: was loading all suppliers)
3. Select PO → line table renders the RM-001 line
4. Enter qty received = 100, disposition = ACCEPT, batch = `BTH-J01-001`
5. Save GRN → expect success toast with docNo `PM/GRN/…`
6. Home → tap IQC row body (not `+`) → expect Records list filtered to IQC pending
7. Open the GRN's IQC inspection → fill all params PASS, disposition = ACCEPTED, sample size = 5
8. Save IQC → expect success toast

**Assertions:**
- `GRN_LOG` row: qtyReceived=100, qtyAccepted=100, disposition=ACCEPT, poLineNo=1, locationId=`QUARANTINE`
- `STOCK_LEDGER` row 1: `GRN_RECEIPT` in qty=100 at QUARANTINE
- `IQC_LOG` row: materialCode=RM-001 (not blank — recent fix), disposition=ACCEPTED
- `STOCK_LEDGER` row 2: `IQC_ACCEPT` out 100 from QUARANTINE
- `STOCK_LEDGER` row 3: `IQC_ACCEPT` in 100 at the RM material's default location (post-fix: matCode must propagate or this row is skipped)
- Net stock at RM-STORE-A for RM-001 batch BTH-J01-001 = 100

**Pass:** All 4 ledger entries present, net stock visible in Warehouse view.

**Cleanup:** Restore from snapshot.

---

### J02 — RM rejection at GRN ★ P2

**Goal:** Prove REJECT disposition writes correct ledger and raises NCR without IQC.

**Pre-state:** Same as J01.

**Steps:**
1. Same as J01 steps 1–4 but disposition = REJECT, qtyAccepted defaults to 0 (post-fix in multi-PO mode)
2. Save GRN

**Assertions:**
- `GRN_LOG` row: qtyAccepted=0, disposition=REJECT, storageZone='Rejected Zone'
- `STOCK_LEDGER`: only the REJECT-zone entry (no IQC_ACCEPT ledger)
- `NCR_LOG`: auto-raised row, source=GRN, status=OPEN
- IQC pending dropdown does **not** show this GRN

**Pass:** NCR raised, no IQC available, qtyAccepted = 0.

---

### J03 — RM IQC fail ★ P1

**Goal:** Verify HOLD/REJECT at IQC raises NCR with non-zero `qtyAffected` (post-fix).

**Pre-state:** Run J01 steps 1–5 first to create an ACCEPTED GRN awaiting IQC.

**Steps:**
1. Open IQC for that GRN
2. Mark one param FAIL, set rejectedQty = 100, disposition = HOLD
3. Save IQC

**Assertions:**
- `IQC_LOG` row: disposition=HOLD, materialCode populated, qtyReceived propagated (post-fix — was NaN→0)
- `NCR_LOG`: auto-raised row, `qtyAffected=100` (post-fix — was 0 because qtyReceived missing)
- `STOCK_LEDGER`: stock remains at QUARANTINE (no IQC_ACCEPT moves)

**Pass:** NCR has `qtyAffected=100`, not 0.

---

### J04 — Production issue happy-path ★ P1

**Goal:** Verify multi-BOM issue debits all components atomically (or surfaces partial state clearly).

**Pre-state:**
- J01 completed for 2 RM materials (both released to RM-STORE-A)
- FG-PROD-001 exists with BOM = {RM-001: 0.6 kg/unit, RM-002: 0.4 kg/unit}

**Steps:**
1. Home → tap `+` on Production row → "Quick Issue" or "Production Issue" tab
2. Select FG-PROD-001, qty = 50 units (requires 30 kg RM-001 + 20 kg RM-002)
3. Tap Issue → expect single success toast with consolidated job ID

**Assertions:**
- `PROD_JOBS` row appended with both component issue IDs
- `STOCK_LEDGER`: two PROD_BOOK out entries, one per component, matching FIFO lots
- RM-001 stock now 70 kg, RM-002 now 80 kg
- `requiresReversal` flag absent in success response

**Pass:** Both ledger debits visible, FG-PROD-001 marked in-progress.

---

### J05 — Production partial-issue failure ★ P2

**Goal:** Verify the new `requiresReversal:true` path when mid-loop component fails.

**Pre-state:** Set RM-002 stock to 10 kg (insufficient for the 20 kg the BOM requires).

**Steps:**
1. Attempt same issue as J04 (FG-PROD-001 × 50 units)
2. Inspect error toast

**Assertions:**
- Error toast contains `PARTIAL ISSUE` and lists `RM-001(ISS-…)` as already-debited
- Server response includes `requiresReversal: true, partial: [...]`
- `STOCK_LEDGER`: RM-001 was debited 30 kg (audit-trail intact), RM-002 untouched
- `PROD_JOBS` row was **not** written

**Pass:** Operator can read exactly which issue ID needs manual reversal.

---

### J06 — IPQC session lifecycle ★ P1

**Goal:** End-to-end open → rounds → close, plus regression on closed-session write guard.

**Pre-state:** Production job from J04 in progress.

**Steps:**
1. Home → tap IPQC `+` → setup screen
2. Pick FG-PROD-001, batch = J04 job ID, inspector = TEST_OPERATOR
3. Tap "New Check" → round 1: all params PASS → Save Round
4. Round 2: one param FAIL → Save Round → expect NCR warning toast
5. Tap Close Session → confirmation → home
6. **Regression check:** in a second tab (or after reload), attempt to save another round to the same `sessionId` via the diag console (calling `saveRound` directly). Expect `{ok:false, error: 'Session ... is CLOSED'}` (post-fix).

**Assertions:**
- `IPQC_Sessions` row: status=CLOSED, rounds=2, end_time set
- `IPQC_LOG` rows: 2× round entries with all param values
- `NCR_LOG`: 1 auto-raised row for the failed param
- Closed-session-write attempt rejected server-side

**Pass:** Closed session cannot accept more rounds. NCR raised exactly once.

---

### J07 — FG release happy-path ★ P1

**Goal:** Prove the recent OQC→FG_DISPATCH_LOTS auto-mirror works with correct `productCode`.

**Pre-state:** J06 completed; session available in OQC's "closed IPQC sessions" dropdown.

**Steps:**
1. Home → tap OQC `+` → form opens
2. Select customer, material FG-PROD-001 (this carries `materialCode` in option value — recent fix)
3. Pick the closed IPQC session as `ipqcSessionRef`
4. Enter batch, qty = 50, all checks PASS, disposition = ACCEPTED, FG location = FG-STORE
5. Save OQC

**Assertions:**
- `OQC_LOG` row: releaseDecision=ACCEPTED, item.materialCode='FG-PROD-001'
- `FG_DISPATCH_LOTS` row auto-created with:
  - `productCode='FG-PROD-001'` (NOT empty — this is the regression seam from the audit)
  - qtyReleased=50, qtyAvailable=50, status='AVAILABLE'
  - fgLocation='FG-STORE'
- `STOCK_LEDGER`: OQC_RELEASE in 50 at FG-STORE
- OQC_LOG col 23 = the new lot ID (back-fill works)

**Pass:** FG_DISPATCH_LOTS productCode is non-empty. This single assertion validates the root-cause fix for the "no FIFO plan" symptom.

---

### J08 — OQC reject ★ P2

**Goal:** REJECT path does **not** create FG lot, raises NCR.

**Pre-state:** Another closed IPQC session available.

**Steps:** Same as J07 but disposition = REJECTED.

**Assertions:**
- `OQC_LOG` row: releaseDecision=REJECTED
- `FG_DISPATCH_LOTS`: no new row for this OQC ref
- `NCR_LOG`: auto-raised

**Pass:** No FG lot, NCR present.

---

### J09 — Dispatch happy-path ★ P1

**Goal:** End-to-end FIFO preview → confirm → Gatepass record.

**Pre-state:** J07 completed; FG-PROD-001 has 50 units available for the chosen customer.

**Steps:**
1. Home → tap Dispatch `+` → form opens (post-fix: BottomNav not covering Create Gatepass button)
2. Select same customer, same product, qty requested = 30
3. Tap "Preview FIFO" → expect plan with one lot, 30 of 50
4. Tap "Create Gatepass" → expect success toast with GP number

**Assertions:**
- `GATEPASS_LOG` row: type=`OUTBOUND` (post-fix — was 'Finished Goods'), disposition matches button choice
- `FG_DISPATCH_LOTS` row updated: qtyDispatched=30, qtyAvailable=20, status='PARTIAL'
- `STOCK_LEDGER`: DISPATCH out 30 from FG-STORE
- The same OQC ref cannot be selected again in a new Gatepass attempt (replay-guard fires server-side)

**Pass:** Stock balances reconcile; OQC ref is now consumed.

---

### J10 — Dispatch FIFO override ★ P2

**Goal:** Override path requires reason and writes audit row.

**Pre-state:** Two FG lots available for same customer/product, FIFO would pick the older one.

**Steps:**
1. Open Dispatch → preview FIFO → uncheck the older lot, check the newer one
2. Attempt Confirm with no override reason → expect "Override reason ≥ 5 chars required"
3. Add reason "QA-hold on earlier lot" → Confirm

**Assertions:**
- `FG_FIFO_OVERRIDE_LOG` row: chosenPlan, fifoPlan, skipped lots, reason all populated
- Lot order in `canonicalizePlan_` preserves insertion order (post-fix — was sort-by-lotId)
- Dispatch saves successfully with `override=true` flag

**Pass:** Override row written; reason short-circuits if < 5 chars.

---

### J11 — Customer return RESTOCK ★ P2

**Goal:** Verify ledger-before-CLOSED transactional ordering (recent fix).

**Pre-state:** A dispatched FG batch exists; one unit comes back.

**Steps:**
1. Home → tap Returns `+` → "New Return" tab (post-fix: was defaulting to "Triage")
2. Log return: customer, FG-PROD-001, batch, qty=1, reason=`Wrong colour`, photo upload (JPG)
3. Save → switch to Triage tab → disposition = RESTOCK → Save

**Assertions:**
- `CUSTOMER_RETURN_LOG`: row status moves OPEN → INSPECTED → CLOSED (only on ledger success)
- `STOCK_LEDGER`: 2 entries (QUARANTINE out, FG-STORE in)
- If a `writeStockLedger_` error is forced, status = `PENDING_RETRY` and return stays visible
- Photo upload accepts JPG; an attempted .exe upload returns `Invalid mimeType`

**Pass:** Status transitions correctly; non-image MIME rejected.

---

### J12 — Customer return SCRAP ★ P3

**Goal:** SCRAP path uses `recordScrap` and raises NCR.

**Steps:** Same as J11 but disposition = SCRAP.

**Assertions:**
- `SCRAP_LOG` row from `recordScrap` (not the customer return's own ledger calls)
- `NCR_LOG` auto-raised
- `CUSTOMER_RETURN_LOG` status = CLOSED

**Pass:** Scrap recorded once (not duplicated by `CUSTOMER_RETURN_SCRAP_OUT` ledger calls).

---

### J13 — NCR lifecycle ★ P2

**Goal:** Disposition advances status correctly; `WHO` is populated (recent fix).

**Pre-state:** Any auto-raised OPEN NCR from J03/J06/J08.

**Steps:**
1. Home → tap NCR row → list view
2. Tap a card → expand detail
3. Pick a disposition (e.g., REWORK) → status becomes IN_PROGRESS
4. Tap "Close NCR" → fill rootCause, capa, evidence → Submit
5. Verify CLOSED filter tab → tap the now-closed NCR → confirm **no Close button** rendered (recent fix)

**Assertions:**
- `NCR_LOG`: `Disposition By` column non-empty (recent fix — was always blank)
- After Close: `Closed By` non-empty, status=CLOSED
- The CLOSED card UI shows neither disposition picker nor Close button

**Pass:** Audit columns populated; CLOSED cards cannot be re-actioned.

---

### J14 — Records cross-module navigation ★ P1

**Goal:** Verify recent fix — tapping an NCR/IPQC/CustomerReturn card from Records actually opens the record.

**Pre-state:** At least one NCR, one IPQC session, one customer return exist.

**Steps:**
1. Home → tap Records row body → Records list
2. Filter by NCR → tap the first card
3. Expect: NCR form opens **with the tapped NCR auto-expanded** (post-fix: was dumping operator on the bare NCR list)
4. Back → filter by IPQC → tap a session → IPQC list scrolls to that session
5. Back → filter by CustomerReturn → tap a card → CR triage tab scrolls to it

**Assertions:**
- `sessionStorage.pmAutoOpenDoc` is cleared after each target form consumes it (no leak)
- The correct record is visually highlighted/centered in viewport

**Pass:** All three cross-module types navigate to the specific record.

---

### J15 — Masters CRUD ★ P3

**Goal:** Add / edit / delete works for each master type; duplicate-name guard fires.

**Pre-state:** Owner mode enabled.

**Steps:**
1. Masters → Suppliers → Add a new supplier
2. Edit the same supplier
3. Delete it
4. Personnel → try to add a name that already exists with different case (e.g., existing "Ravi Kumar", try "RAVI KUMAR")
5. Expect error: `A row with code "Ravi Kumar" already exists (case-insensitive match)` (recent fix)

**Assertions:**
- Each add/edit/delete reflects in the source `MASTERS_*` sheet
- Duplicate guard blocks insert; no row created

**Pass:** All four operations succeed; duplicate blocked.

---

### J16 — Concurrent-save race ★ P3

**Goal:** Two tabs racing the same Dispatch → exactly one succeeds.

**Pre-state:** One FG lot with 30 available, customer/product matching.

**Steps:**
1. Open Dispatch in tab A, complete the form to Confirm-ready state
2. Open Dispatch in tab B, same form, same lot
3. Tap Confirm in both within ~1 second of each other

**Assertions:**
- Exactly one succeeds, exactly one returns a clean error (likely "qtyAvailable insufficient" after the other tab committed)
- `LockService` holds the second caller until the first finishes — no corrupted FG_DISPATCH_LOTS row
- Both `GATEPASS_LOG` rows are **not** created — only one

**Pass:** Stock balance is correct (no double-debit); error toast is informative.

---

### J17 — Cache invalidation across deploys ★ P3

**Goal:** Recent `pmqms_html_v1_ → v2_` bump force-clears stale form HTML; future bumps work the same.

**Steps:**
1. Open any form, leave the tab open
2. (Out-of-band) Bump the `PFX` in `HtmlCache.html` to `v3_`, push & deploy
3. Navigate within the still-open tab to another form
4. Expect: a fresh fetch from server (visible loader), NOT instant cached render

**Assertions:**
- DevTools shows `getFormHtml` network call on the next nav
- `sessionStorage` no longer holds `pmqms_html_v2_*` keys after the v3 sweep runs
- Form renders correctly

**Pass:** Cache busts cleanly without requiring users to close the tab.

---

## 4. Negative & Edge Cases

These run **inside** the relevant journeys, not as separate flows:

| Case | Where to inject | Expected behavior |
|---|---|---|
| Empty `LOCATIONS` sheet | Before J07 | OQC form shows toast "No FG locations defined…" (recent fix), Save button disabled for ACCEPTED |
| `LOCATIONS` Type column moved to col 5 | Before J09 | Dispatch still resolves Type via header lookup (recent fix); no silent lot-rejection |
| `MASTERS_Materials` missing | Before J01 | GRN init returns empty materials list with toast, not a dead form |
| OQC saved without FG location | During J07 | Save button stays disabled; explicit error toast (not silent fail) |
| Gatepass for already-used OQC ref | After J09, re-attempt | Server replay guard fires (`type === 'OUTBOUND'` — recent fix); error toast surfaces |
| Photo upload with `image/svg+xml` MIME | During J11 | Rejected by allowlist (recent fix) |
| IPQC session closed in another tab while open in current | Mid-J06 | Save Round in current tab returns `Session is CLOSED` (recent fix) |
| Network drop mid-save | During any save | Toast surfaces failure (no silent button-disabled state) — visible because BottomNav no longer covers toast (recent fix) |
| User cancels OperatorPicker | During GRN save | Button re-enables; no zombie spinner |
| `FG_DISPATCH_LOTS` empty when Dispatch opens | Before J09, drop the table | Error toast "No released FG lots available…"; operator can run `diagBackfillFGFromOQC` |

---

## 5. UI / Layout Regression Suite

Run on **both 375px (iPhone) and 1280px (desktop)** viewports.

| Check | Expected |
|---|---|
| Submit/Save button visible at bottom of every transactional form | Visible without scroll-clipping on mobile; visible centered on desktop |
| BottomNav present on Landing, Records, KPI, Masters, Dashboard | Yes, 5-icon bar at bottom |
| BottomNav absent on GRN, IQC, IPQC, OQC, NCR, Dispatch, Gatepass, POP, CustomerReturn, Production, ControlPlan, Warehouse, DocView, ImportCSV | Confirmed (include was physically removed) |
| `+` button on Landing rows for PO, GRN, IQC, IPQC, Production, OQC, Gatepass, Dispatch, Returns | Yes |
| `+` button absent from NCR, KPI, Warehouse, Masters, Control Plan rows | Yes |
| Tapping `+` → form opens in "new record" view | Yes (handled by `pmFormIntent` for CustomerReturn; other forms already default to new view) |
| Tapping row body → opens records list (not new record) | Yes |
| `sessionStorage.pmFormIntent` cleared after target form reads it | Confirmed via DevTools after each `+` tap |
| `sessionStorage.pmAutoOpenDoc` cleared after target form reads it | Confirmed via DevTools after each Records → detail nav |
| Dispatch error toast visible above where BottomNav used to sit (`bottom: 88px`) | Toast not hidden by anything |
| Dispatch form centered on wide desktop (NOT right-aligned as in the prior screenshot) | `.dsp-wrap` margin: 0 auto applies cleanly |
| iOS Safari with on-screen keyboard open | Save button still reachable; form scrolls above keyboard |

**Open question for execution:** the desktop right-alignment in the screenshot was never explicitly fixed. Add a follow-up if it reproduces during this suite.

---

## 6. Diagnostic Gates (run before every journey set)

From the Apps Script editor, in order:

1. **`diagSheets()`** — required output: `FG_DISPATCH_LOTS`, `LOCATIONS`, `OQC_LOG`, `GATEPASS_LOG`, `MATERIALS` all present with non-empty header rows. Block execution if any reports `MISSING`.

2. **`diagLocations()`** — required output: `Type column resolved at index 8`. FG location count ≥ 1. If Type column is at a different index, the header-lookup fix is being exercised and the result is informational, not a block — but log it.

3. **`diagDispatchPlan()`** — informational. If FG_DISPATCH_LOTS has < 1 row, J07+ journeys must run first to populate it, OR `diagBackfillFGFromOQC()` must be invoked to mirror historical OQC PASS rows.

4. **`getSpreadsheet()` smoke test** — call it from the editor; confirm it returns a non-null ID matching the staging spreadsheet (defense against running against production by mistake).

---

## 7. Tooling Proposal

| Option | Cost | Coverage | Recommendation |
|---|---|---|---|
| **Manual checklist (this document)** | Lowest. Ship today. | UI + happy paths | **Start here.** Print J01–J05 + J07 + J09 as a 6-page checklist. |
| **Apps Script test runner** (`runJ01() … runJ17()` in `_Tests.js`, logs to `TEST_RESULTS` sheet) | ~1 day to write. Server-side only. | All assertions involving sheet rows. No UI. | **Phase 2.** Best ROI — covers data-layer correctness without flaky UI automation. |
| **Vercel Agent Browser / Playwright** against live deployment URL | ~3–5 days. Plus session-auth complexity for Apps Script. | Full UI + server | **Phase 3.** Only after Phase 2 is green. Apps Script auth makes browser automation harder than it sounds. |

**Recommendation for this stage:** Phase 1 (manual) for the first full pass, then Phase 2 (Apps Script runner) once journeys stabilize. Do not start Phase 3 until the operator has shipped to two real users without issues.

---

## 8. Coverage Matrix

Save paths × journeys. ✓ = journey exercises this save path. ✗ = gap.

| Save path | J01 | J02 | J03 | J04 | J05 | J06 | J07 | J08 | J09 | J10 | J11 | J12 | J13 | J14 | J15 | J16 | J17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `saveGRN` | ✓ | ✓ | | | | | | | | | | | | | | | |
| `saveIQC` | ✓ | | ✓ | | | | | | | | | | | | | | |
| `issueProductionJob` / `issueRMMultiLot` | | | | ✓ | ✓ | | | | | | | | | | | | |
| `startSession` / `saveRound` / `closeSession` (IPQC) | | | | | | ✓ | | | | | | | | | | | |
| `saveOQC` | | | | | | | ✓ | ✓ | | | | | | | | | |
| `saveDispatchWithFIFO` | | | | | | | | | ✓ | ✓ | | | | | | ✓ | |
| `saveGatepass` | | | | | | | | | ✓ | | | | | | | | |
| `saveCustomerReturn` / `disposeCustomerReturn` | | | | | | | | | | | ✓ | ✓ | | | | | |
| `setNCRDisposition` / `closeNCR` | | | | | | | | | | | | | ✓ | | | | |
| `getFormHtml` routing | | | | | | | | | | | | | | ✓ | | | ✓ |
| `upsertMasterRow` / `deleteMasterRow` | | | | | | | | | | | | | | | ✓ | | |
| `savePO` / `updateDraftPO` (POP) | seed only | | | | | | | | | | | | | | | | |

**Gaps identified:**
- ✗ **POP save path (savePO, updateDraftPO)** — not in any journey. Add **J18: POP create/edit/submit lifecycle** before execution starts.
- ✗ **Control Plan save** (if Control Plan has writes) — verify if read-only; if writable, add J19.
- ✗ **`uploadCustomerReturnPhoto`** independently — covered transitively in J11 but never tested with malformed input as the primary assertion. Add a "negative test" sub-checklist.

---

## 9. Risk-Ranked Execution Order

Run these first — they catch ≥ 80% of likely regressions from the recent fixes:

1. **J07** — FG release happy-path. Validates the single most important recent fix (`materialCode` propagation → FG_DISPATCH_LOTS auto-mirror with correct productCode). If this passes, the entire OQC→Dispatch chain is structurally sound.
2. **J09** — Dispatch happy-path. Validates BottomNav removal (submit button visible) AND the `type='OUTBOUND'` Gatepass replay-guard fix.
3. **J14** — Records detail navigation. Three previously-broken nav paths in one journey.
4. **J01** — RM happy-path. Smoke test for the entire receive/IQC chain plus the GRN PO-dropdown gating fix.
5. **J13** — NCR lifecycle. Validates the WHO/operator audit-trail fix AND the CLOSED card UI fix.

If all 5 pass: continue with J03, J04, J06, J11 (P1/P2 mix).
If J07 fails: stop; the auto-mirror fix isn't holding. Re-audit `OQC.js:138` payload to FG_DISPATCH_LOTS write.

---

## 10. Acceptance Criteria for "System is E2E-tested"

| Criterion | Pass bar |
|---|---|
| All 5 risk-ranked journeys (J07, J09, J14, J01, J13) pass | **Twice in a row** with no manual sheet edits between runs |
| All 4 diagnostic gates pass on staging | No `MISSING` reports; FG location count ≥ 1 |
| UI regression checklist (Section 5) | 100% pass on Chrome desktop + iOS Safari |
| Negative cases (Section 4) | At least 6 of 10 tested; remaining 4 explicitly deferred with rationale |
| Coverage gaps (Section 8) | J18 added and run for POP; control-plan gap either filled or marked out-of-scope with reason |
| Defect log | All CRITICAL defects discovered during testing fixed and re-verified; HIGH defects either fixed or accepted-risk-documented |

Hitting this bar = ready to merge `fix/section-a-structural` into a release tag and roll to the operator's primary device.

---

## 11. Prerequisites Before Execution

1. **Create a staging deployment.** Production at `@214` should not be the test target. Open question with the user: clone the production spreadsheet, deploy `main` HEAD to a new deploymentId, document both URLs.
2. **Seed test masters and POs.** Until `_TestSeed.js` exists, do this manually once on the staging sheet.
3. **Designate a test operator.** The OperatorPicker must store a stable name across all journey runs.
4. **Print the manual checklist.** Convert J01–J05, J07, J09, J13, J14 into a tickable Markdown doc (`docs/E2E-CHECKLIST.md` — not yet written).
5. **Snapshot the staging sheet** before the first run.

## 12. Open Questions for User Review

1. Is there an existing staging spreadsheet, or do we need to clone production?
2. Should the test operator be a real person or a synthetic name (e.g., `QA-AUTOMATION`)?
3. Are there known production data sensitivities that would prevent running J02/J03/J05 (which create NCRs and partial debits)?
4. Confirm scope: the recent screenshot showed Dispatch right-aligned on wide desktop. Is that an in-scope bug for this test pass, or a known-deferred issue?
5. What's the acceptable false-negative rate? Manual testing has known flakes — do we re-run on any failure, or accept and log?

---

**End of plan.** Next step: user review of journey list and Section 12. Once approved, write `docs/E2E-CHECKLIST.md` (the printable tester checklist) and `_TestSeed.js` (the data setup runner). Do not execute against production until staging exists.
