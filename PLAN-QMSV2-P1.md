# PLAN-QMSV2-P1 — Implementation Plan: Phase 1 (Cockpit foundation)

**Spec:** [PLAN-QMSV2.md](PLAN-QMSV2.md) · **Design:** [DESIGN.md](DESIGN.md) (authority) + [DESIGN-QMSV2-STITCH.md](DESIGN-QMSV2-STITCH.md) (mockups, Stitch `10290620691745788406`)
**Scope:** P1 only — action picker + Tier-1 inline form + Kanban board + role dropdown + nav collapse. **Reuse-heavy, zero stock-engine change.**
**Out of P1:** QR scanning (P2), stock map (P3), FIFO enforcement / Trace fan-out (P4), capacity/floor-plan (needs data).

---

## 1. Goal & success criteria (P1)

Ship a single responsive cockpit (`QMSV2_F.html`) that becomes a **new home** (old forms stay reachable), where:
1. A user picks their name (top-right) → board filters to **"My Work"** (their role's live stage); switching re-filters instantly.
2. The home is a **doc-type-tabbed Kanban** (status columns) fed by existing `getRecordsList` + `computePendingCounts_`; cards carry a labeled 6-stage pipeline; overdue flagged red.
3. An **action picker** ("+") groups actions (Receive·Inspect·Make·Ship·Move·Resolve); **Tier-1** actions render an inline form, **Tier-2** actions `navigateTo` the existing form.
4. One **Tier-1 inline action works end-to-end** (Move/transfer → `recordLocationTransfer`) writing the correct `STOCK_LEDGER` txnType — *location picked from dropdown* (QR is P2).
5. Full `e2e-run-all.js` stays green; a new `e2e-qmsv2.js` passes.

**Done = all 5, deployed, E2E green.** Other Tier-1 actions are wired by config but only Move is the proof-of-flow in P1.

---

## 2. Components & dependencies

```
NEW FILES
  QMSV2_F.html      cockpit shell (top bar + role dropdown + board + action picker + inline form)
  Qmsv2.js          server: getQmsv2Board(), getRoleStageMap(), ACTION_REGISTRY_, runAction(), getRecordsByStatus()
  e2e-qmsv2.js      E2E suite (added to e2e-run-all.js)

EDIT
  Code.js           add 'QMSV2' -> 'QMSV2_F' to getFormHtml pageMap; bump cache key v10 -> v11
  Landing.html      add a "Cockpit (v2)" entry so it's reachable (new home, old reachable)

REUSE (do NOT modify)
  Warehouse.js  recordLocationTransfer, getStockSummary, getLocations, getStockBalance_
  Code.js       computePendingCounts_  (+ __breakdowns)
  Records.js    getRecordsList(type, filters)
  Scan.js       getOperators()  (role/shift source for the dropdown)
  Trace.js      traceBatch()    (pipeline data — read-only; P1 may stub stages from status)
```

**Dependency order (must build first → last):**
1. `getOperators()` already exists → role dropdown data is free.
2. `getRecordsList` + `computePendingCounts_` exist → board data is free, but **needs a status→column mapper** (NEW, client or server).
3. Pipeline stages on cards: P1 derives them from each record's `status` (a NEW `statusToStage()` map) — full `Trace.traceBatch` per card is too heavy for a list; defer rich trace to the Pipeline Detail screen.
4. Action registry + `runAction` dispatch → calls existing fns.

---

## 3. Key design decisions (resolve before coding)

| Decision | Choice | Why |
|---|---|---|
| Board data source | `getRecordsList(type)` per active doc-type tab | already returns per-record `status`; filter client-side into columns |
| Status→column map | **NEW server fn** `getQmsv2Board(type, role)` returns `{columns:{pending:[],inProgress:[],done:[]}}` | keeps mapping server-side, one source of truth; lets role filter happen server-side |
| Pipeline on cards | derive 6-stage state from `status` via `statusToStage()` (NOT full trace) | list performance; rich trace only on detail tap |
| Role→stage filter | `getRoleStageMap()` from spec §13 matrix (gate→GRN, inspector→IQC/IPQC/OQC, storage→Putaway/Move/Issue, dispatch→Dispatch, manager→all) | spec-confirmed |
| Identity persistence | localStorage `pmQmsOperator` (like the scan flow) | survives reloads; no auth |
| Tier-1 inline form | config-driven from `ACTION_REGISTRY_`; **location = dropdown only in P1** | QR is P2 |
| Rollout | new home, Landing keeps a link; do NOT replace Landing | spec §13 |
| Cache | bump `getFormHtml` key on every HTML change | GAS gotcha |

**RESOLVED (2026-06-26):** P1 board shows **all 7 doc-type tabs** for every user; defaults to the current role's primary tab; "My Work" filters cards within. (User-confirmed.)

---

## 4. Tasks (ordered by dependency; each ≤5 files, each verifiable)

> **P1 COMPLETE (2026-06-26).** All T1–T8 shipped + deployed @324. Full
> `e2e-run-all.js` green: 159 checks, 0 failures, no regressions. T6 move
> proof-of-write verified live (9/9, self-reverting ledger writes).
> Commits: 7757511 (T1–T2), f389a46 (T3), 2ae93c6 (T4+T7+age-fix),
> 962e74d (T5), cf1cb11 (T6). Next: P2 (QR scan + Putaway/Issue/Return inline).

- [x] **T1 — Server: role + board data**
  - Build `Qmsv2.js`: `getRoleStageMap()`, `getOperators()` passthrough, `getQmsv2Board(type, role)` → reads `getRecordsList(type)`, maps each record's `status` into `{pending|inProgress|done}` columns + a `stage` index via `statusToStage(type,status)`, flags `overdue` by age.
  - Acceptance: `getQmsv2Board('GRN','storage')` returns columns with records carrying `{docNo, name, status, stage, overdue, ageDays}`.
  - Verify: E2E RPC call asserts shape + non-empty for a type with records.
  - Files: `Qmsv2.js`.

- [x] **T2 — Route the new page**
  - `Code.js`: add `QMSV2:'QMSV2_F'` to `getFormHtml` pageMap; bump cache key `v10→v11`. Create minimal `QMSV2_F.html` shell (top bar + empty board) that loads.
  - Acceptance: `navigateTo('QMSV2')` opens the shell; page mounts.
  - Verify: E2E nav + assert a root element id exists.
  - Files: `Code.js`, `QMSV2_F.html`.

- [x] **T3 — Identity dropdown + role filter**
  - Top-right user dropdown from `getOperators()`; persist to localStorage; selecting sets `currentRole`, re-requests `getQmsv2Board(type,currentRole)`.
  - Apply `DESIGN.md`: navy top bar, mono nothing here, 44px target.
  - Acceptance: switching user re-filters the board ("My Work").
  - Verify: E2E sets dropdown, asserts board reloads.
  - Files: `QMSV2_F.html`.

- [x] **T4 — Kanban board + cards (labeled pipeline)**
  - Doc-type tab row (GRN·IQC·IPQC·OQC·Dispatch·Production·NCR); status columns; card = status word + mono doc id + desc + **labeled 6-stage tracker** (GRN·IQC·PUTAWAY·ISSUE·OQC·DISPATCH; filled-navy/blue-ring/gray-hollow from `stage`); 3px red left-edge when overdue. Match the revised Stitch mockup.
  - Acceptance: cards render with correct stage node states; overdue flagged.
  - Verify: E2E asserts ≥1 card + a `.pipeline` node with current-stage class.
  - Files: `QMSV2_F.html`.

- [x] **T5 — Action registry + picker**
  - `ACTION_REGISTRY_` in `Qmsv2.js` (id,label,group,kind:'inline'|'launch',serverFn,fields[]). Picker UI ("+" → grouped tiles). `kind:'launch'` → `navigateTo(form)`; `kind:'inline'` → open inline form.
  - Acceptance: picker lists grouped actions; tapping a launch action opens the existing form.
  - Verify: E2E opens picker, asserts groups present; taps a launch action → existing form mounts.
  - Files: `Qmsv2.js`, `QMSV2_F.html`.

- [x] **T6 — Tier-1 inline action (Move) end-to-end**
  - Inline form for `move` from registry: material (getStockSummary), lot, from/to location (getLocations dropdowns — **no QR in P1**), qty + on-hand reference, by:user → review/confirm card → `runAction('move', payload)` → calls `recordLocationTransfer`.
  - Acceptance: a move writes OUT+IN `LOCATION_TRANSFER` rows; balance moves.
  - Verify: E2E performs a move on a seeded lot, asserts `STOCK_LEDGER` balance via `getStockSummary` before/after.
  - Files: `Qmsv2.js` (runAction), `QMSV2_F.html`.

- [x] **T7 — Nav collapse + reachability**
  - Add "Cockpit (v2)" entry on Landing (new home, old reachable). Do not remove old surfaces in P1 (defer full collapse).
  - Acceptance: Landing → Cockpit opens QMSV2; old forms still reachable.
  - Verify: E2E nav both ways.
  - Files: `Landing.html`.

- [x] **T8 — E2E suite + regression**
  - `e2e-qmsv2.js` covering T1–T6 RPC + UI; add to `e2e-run-all.js`. Run full suite.
  - Acceptance: `e2e-qmsv2.js` green; full `e2e-run-all.js` green (no regressions).
  - Verify: `node e2e-run-all.js`.
  - Files: `e2e-qmsv2.js`, `e2e-run-all.js`.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `getRecordsList` caps at 200 / no status filter | board does client/server bucketing of the 200; sufficient for P1 visibility; note the cap in UI ("showing recent 200") |
| Pipeline stage from `status` is approximate (not real trace) | acceptable for P1 list; rich trace is the detail screen (P2+). Document `statusToStage` as a heuristic. |
| Per-doc-type `getQmsv2Board` calls are N round-trips | lazy-load only the active tab; cache per tab in the session |
| Double-iframe identity (`getActiveUser` unreliable) | identity is the name dropdown — already the design; no reliance on Google email |
| Cache serves stale HTML | bump key every HTML change (T2 onwards) |
| Touching a rich flow by accident | P1 only *launches* them via `navigateTo`; zero edits to their files |

---

## 6. Verification checkpoints (gates between tasks)

- After **T2**: page mounts live (deploy + nav).
- After **T4**: board renders real records with correct pipeline nodes (screenshot review vs Stitch mockup).
- After **T6**: a real move changes `STOCK_LEDGER` (E2E balance assertion) — *the* proof P1 writes correctly.
- After **T8**: full regression green → P1 done.

---

## 7. Definition of Done (P1)

- `QMSV2_F.html` deployed; reachable from Landing; old forms intact.
- Role dropdown filters board; labeled-pipeline cards render; action picker launches Tier-2 + runs Tier-1 Move.
- Move writes correct `LOCATION_TRANSFER` txnType (E2E-verified).
- `e2e-qmsv2.js` + full `e2e-run-all.js` green.
- Committed; `DESIGN.md` tokens applied; cache key bumped.

**Next (P2):** QR location scanning + Putaway/Issue/Return inline actions + multi-select — after location QRs printed + LOCATIONS hierarchy populated.
