# QR QMS Project — Mode-Aware QR System (Plan v3.1)

**Saved:** 2026-05-27
**Status:** Superseded by [PLAN-V3.2-QR-QMS-PROJECT.md](PLAN-V3.2-QR-QMS-PROJECT.md) — failed tribunal STOP 4-0 (over-correction; added infrastructure instead of cutting scope). Retained for diff reference only.
**Supersedes:** [PLAN-V1-QR-AND-FG-PIPELINE.md](PLAN-V1-QR-AND-FG-PIPELINE.md), [PLAN-V3-QR-QMS-PROJECT.md](PLAN-V3-QR-QMS-PROJECT.md)
**Project:** Pack Masters QMS (PM QMS)
**Tribunal review:** `veritas_sessions/veritas_v4_20260527_115216.json` (verdict STOP on v3 → rebuild as v3.1)

---

## What changed from v3

v3 was a strong conceptual plan (mode-aware QR, event-sourced inventory) that failed Veritas v4 Tribunal on 5 showstoppers + 12 criticals. v3.1 keeps every conceptual win and folds the fixes back in. The 10 deltas are listed at the end of this file under [Tribunal Fixes Applied](#tribunal-fixes-applied).

---

## Core inversion (unchanged from v3)

> Today the warehouse is a mystery the system tries to model.
> After this project, the warehouse is a stream of events the system observes directly.

Event-sourced inventory is the categorical change. Everything else derives from it.

---

## Pre-flight gates (NEW — must pass before Phase 1 starts)

Phase 1 will NOT begin until every gate below is GREEN. Any gate going RED is a 1-week stop, not a "we'll fix it during the sprint."

| # | Gate | How verified | Owner | Status |
|---|---|---|---|---|
| G1 | Thermal printer procured + tested with one sample location sticker | Printer at QC bench, sample sticker laminated and survived a 24h scuff + humidity test | Ops | ☐ |
| G2 | Avery A4 sticker sheet fallback printed + read by jsQR on a real BYOD Android | Photo + scan log of 10 trial codes | Dev | ☐ |
| G3 | Paper-log mode-switching pilot at ONE workstation for 2 weeks | Daily count of mis-set modes; if >5%/day, mode UX is wrong and we re-design | Ops + Dev | ☐ |
| G4 | Authn/RBAC section reviewed against existing QMS role gates and approved | Auth doc signed off; matches existing IPQC/OQC role check pattern | Dev | ☐ |
| G5 | Warehouse Wi-Fi survey on the busiest aisle — dropout map | Heatmap; any zone with >5% dropout requires offline queue before scanning there | IT | ☐ |
| G6 | Operator training curriculum drafted (1-page laminated card + 30-min hands-on) | Training card mocked up, 3 operators rehearsed on dummy stickers | Ops | ☐ |
| G7 | Change-control / validation doc per ISO 9001:2015 §8.5.6 | One-page IQ/OQ/PQ for the inventory module added to QMS DocControl | QA | ☐ |
| G8 | One-off stocktake plan + freeze window approved | Date set, manpower allocated, customer-side impact assessed | Ops + Sales | ☐ |

**No gate can be skipped.** If any gate fails twice, the plan reverts to PLAN-V3-lite (Phase 1 only, no event-sourcing commitment).

---

## The three QR types (unchanged structurally; validated rigorously)

Each has a strict 3-char prefix so they're never confused. **All QR payloads are validated against the contract below before any write.**

### Validation contract (NEW)

```
ACT|<verb>     verb ∈ {RECEIVE, SAMPLE, RETEST, RELEASE, HOLD, MOVE, PICK, RETURN, REJECT, SHIP, COUNT}
               regex: ^ACT\|[A-Z]{4,8}$
LOC|<id>       id matches /^[A-Z]{2,8}(-[A-Z0-9]{1,4})*$/
               max length 32 chars
PRD|<grn>:<n>  grn matches /^PM\/GRN\/\d{4}-\d{3,5}$/ ; n is 1..99
               max length 32 chars
```

Server-side `recordScan()` rejects any payload that fails its prefix's regex with a 400 + audit-logged `INVALID_QR_PAYLOAD` event. **No payload reaches the SCAN_EVENTS write path without passing.**

Manual entry uses the same contract — typed strings are validated identically.

### 1. Action QR (`ACT|<verb>`)
- ~10 needed total, laminated, mounted at workstations
- Encodes a verb + implicit workstation + implicit role
- **Sticky mode**: scanning sets the operator's mode until next ACT scan or 10-min timeout
- Verbs: `RECEIVE`, `SAMPLE`, `RETEST`, `RELEASE`, `HOLD`, `MOVE`, `PICK`, `RETURN`, `REJECT`, `SHIP`, `COUNT`

### 2. Location QR (`LOC|<id>`)
- ~200 needed, laminated, screwed to racks/walls/floors permanently
- Examples: `LOC|BUFFER-A`, `LOC|RACK-3-BIN-12`, `LOC|REJECT-BIN`, `LOC|DISPATCH-1`

### 3. Product QR (`PRD|<grn>:<line>`)
- Printed at GRN, **selectively** — high-value/regulated only
- Encodes: GRN number + line index. Nothing mutable in payload.

---

## Authentication, authorization, session model (NEW)

Reuses the existing PM QMS role gate. No new auth system.

### Authentication
- All Scan.html access requires an active QMS session (same as the rest of the app — `getCurrentUser()` from `Code.js`).
- Anonymous `/exec` access blocked post-Dec-2024 Google deprecation anyway; this is belt-and-braces.
- Session token check on every `setMode()` and `recordScan()` server call.

### Authorization (RBAC)

| Function | Allowed roles |
|---|---|
| `printLocationStickers()` | admin |
| `printActionStickers()` | admin |
| `setMode(verb, workstationId)` | operator, qc, warehouse, admin |
| `recordScan(targetType, targetId, qty?, jobRef?)` | role-conditional on current mode (e.g. REJECT mode requires qc or admin) |
| `resolveScan(payload)` | any authenticated user |

Mode → required-role matrix lives in `Trace.js`-style constants block, audited.

### Session
- Mode is keyed by `(userId, workstationId)`. Two operators at the same bench have independent modes.
- Mode TTL = 10 min idle; absolute cap = end-of-shift cutoff (configurable, default 18:00 IST).
- Explicit logout button on Scan.html clears mode immediately.
- Shared device: a banner persistently shows `Logged in as <X>` and a fast-switch user picker.

---

## Data model — collapsed to TWO sheets + LOCATIONS (NEW)

**Critical simplification from v3:** ACTION_EVENTS folded into SCAN_EVENTS as `targetType='ACT'`. One table, one write path, no timestamp drift.

```
SCAN_EVENTS:
  ts, userId, action, targetType (ACT|LOC|PRD), targetId,
  derivedLotId, derivedLocationId, qty, jobRef,
  grnDate,           -- NEW: enables FIFO checks (NULL for non-PRD events)
  modeContext,       -- NEW: snapshot of the operator's active mode at scan time
  invalidReason,     -- NEW: NULL on success; populated when payload fails validation
  prevHash, rowHash  -- NEW: hash-chain for audit defensibility (see §Audit-trail integrity)

LOCATIONS:
  locationId, zone, type, capacity, active
  -- ~200 rows, seeded once

(no STOCK_LEDGER changes; it remains the legacy ledger during Phase 1-2 for rollback safety)
```

**Why grnDate inline:** FIFO checks must run at pick time (`recordScan` under PICK mode reads the candidate lot's grnDate and warns if a younger lot would violate FIFO). Storing it inline avoids a join on every pick.

**Why modeContext:** lets us reconstruct "what did the system think the operator was doing at scan time" without re-deriving from interleaved ACTION rows.

**No state column.** State is computed from event log (unchanged from v3).

---

## Audit-trail integrity (NEW)

Apps Script sheets are admin-editable, which v3 ignored. v3.1 hardens defensibility without leaving the platform:

1. **Per-row hash chain**: each SCAN_EVENTS row stores `rowHash = sha256(prevHash + tabSeparatedFields)`. Tamper detection is a one-pass walk.
2. **Daily backup append**: nightly trigger writes SCAN_EVENTS delta to a separate Drive folder as an immutable CSV (signed by Apps Script service account).
3. **No "edit row" UI**: corrections are new compensating events (reversal pattern), never in-place edits.
4. **Admin-edit detection**: weekly job walks the hash chain, flags any break to the QMS owner.

This is not 21 CFR Part 11 / EU GMP Annex 11 compliant — those need a validated commercial system. But it is **defensible** to customer audits and resolves the v3 critical finding for SME-grade traceability.

---

## Offline-first scan queue (NEW)

Patchy warehouse Wi-Fi is real. v3.1 commits to offline-first from Phase 1 (not deferred).

```
Scan.html flow:
  1. operator scans → payload validated client-side against contract
  2. event appended to IndexedDB queue with `pending: true`
  3. UI immediately shows success + the suggestion panel (computed from local cache + event)
  4. background sync (every 30s + on online event) POSTs queued events
  5. server reconciles by (userId, ts, targetId) idempotency key — dedup safe
  6. queued events that fail server validation flip to `pending: false, rejected: true` and surface a red badge on Scan.html
```

A queued event count is shown on the Scan.html header. >5 queued for >5 min = banner alert.

---

## Backend surface (6 functions + 1 page)

| Component | Purpose | Auth |
|---|---|---|
| `printLocationStickers()` | HTML for all 200 location stickers (one-time print + reprint on damage) | admin |
| `printActionStickers()` | HTML for the ~10 action stickers | admin |
| `setMode(verb, workstationId)` | Validates verb, writes SCAN_EVENTS row with `targetType='ACT'`, sets sticky mode | operator+ |
| `recordScan(payload, qty?, jobRef?)` | Parse + validate + role-check + idempotency check + FIFO check (if PICK) + hash-chain + write | role-conditional |
| `resolveScan(payload)` | Lifecycle card data (v1 resolver, LOC-aware) | any |
| `verifyAuditChain(fromTs?, toTs?)` | Walk hash chain, flag breaks | admin |
| `Scan.html` | Camera + mode banner + manual entry + offline queue UI + logout | — |

Six functions, not five. Audit verification is the cost of defensibility.

---

## FIFO enforcement (NEW — fixes a tribunal critical)

v3 claimed to solve "FIFO not enforceable" but had no mechanism. v3.1 ships it:

- `SCAN_EVENTS.grnDate` populated on every PRD event from GRN lookup
- Under `PICK` mode, `recordScan()` reads all lots of the same material at that location
- If picker's chosen lot is NOT the oldest grnDate within ±3 days, system prompts: `Older lot B-AUTO-179 (GRN 2026-03-12) at same location. Pick it instead?`
- Override is allowed but logged as `FIFO_OVERRIDE` event with operator-supplied reason
- Weekly FIFO compliance report (% of picks where oldest lot was taken) goes to QMS owner

---

## Bootstrap stocktake + ongoing reconciliation (NEW)

v3 mentioned the one-time stocktake but had no story for divergence after it. v3.1 has both.

### Bootstrap (one-time, before Phase 1 cut-over)
- Freeze warehouse for 4-8 hours (per gate G8)
- Two-person count team walks zone-by-zone with phones in stocktake mode
- Each lot+location pair becomes a synthetic `ARRIVED` event with `bootstrapBatch=true` flag
- Discrepancies vs STOCK_LEDGER recorded in `BOOTSTRAP_VARIANCE` sheet for accounting review
- Sign-off by QA before Phase 1 starts using the new system

### Ongoing (post-rollout)
- Daily 10-min cycle count of ONE zone (rotates through ~20 zones over month) by `ACT|COUNT` mode
- Variance auto-computed by comparing scanned-present vs event-log-predicted
- >2% variance triggers RCA before next day's count
- Quarterly full count remains as compliance backstop

---

## Phased rollout (REVISED — honest timeline)

The v3 "5-day Phase 1" estimate was unrealistic given the pre-flight gates. v3.1 reflects real elapsed weeks, not idealized dev days.

| Phase | Elapsed time | Ships | Skips |
|---|---|---|---|
| Phase 0 — Gates | 2 weeks | All G1-G8 gates GREEN (procurement, pilot, training, validation doc) | Code |
| Phase 1 — Bootstrap + Scan MVP | 1 week | Stocktake done; Scan.html with mode banner + offline queue; receive/sample/pick/move workflows; validation contract; authn/RBAC; hash chain; FIFO check | Smart suggestions, movement contracts, predictive empty, killer enhancements |
| Phase 2 — Reject + Ship | 1 week | Reject + Ship modes; NCR auto-create from REJECT-BIN | Lifecycle card |
| Phase 3 — Product stickers | 1 week | Product QR for 5-10 high-value/regulated SKUs only | Universal stickering |
| Phase 4 — Smart layer | After 3 months of clean Phase 1-3 data | Lifecycle card, suggestions panel, mode-aware bottom nav | Movement contracts, RFID, predictive empty (Phase 5) |
| Phase 5 — Optional ambition | When scale demands | Movement contracts, predictive empty-rack, RFID, ring scanners | — |

**Hard rule:** Phase 4 does not start until Phase 1-3 have 3 months of operator-validated clean data (defined as <2% mode-mismatch rate and <2% cycle-count variance). If those targets are missed, Phase 1-3 are tuned, not replaced.

---

## Killer enhancements — moved to appendix (NEW)

v3 mixed 12 aspirational features (a-l) into the main plan. v3.1 moves them to `enhancements/QR-V3-ENHANCEMENTS.md` and explicitly defers them to Phase 4-5. A developer reading PLAN-V3.1 cannot accidentally code an unscoped feature.

The 12 enhancements (smart suggestions, zone shortcuts, movement contracts, predictive empty, input-method-agnostic, rejection-bin trick, conditional ACT QRs, implicit reservation, mode-aware nav, tap-to-explain, A4 fallback, offline queue) remain captured. Only A4 fallback (now G2) and offline queue (now Phase 1) graduate into v3.1's core scope.

---

## Mode persistence — risk & mitigation (unchanged from v3, with paper-pilot validation per G3)

| Mitigation | Force |
|---|---|
| Mode auto-expires after 10 min inactivity | Low (default) |
| Active mode shown as colored banner | Medium (visibility) |
| Mode change confirms when next action is dangerous (REJECT) | High (one extra tap) |
| Action QR can be re-scanned anytime | Low (no penalty) |
| Paper-log pre-pilot before electronic rollout | High (validates that operators can hold the model in their head BEFORE we trust software to it) |

---

## Failure modes (unchanged from v3, plus new entries)

1-11: as v3.
12. **NEW:** Hash chain breaks due to legitimate admin edit — recovery: rebuild chain from last verified row + log incident in QMS.
13. **NEW:** Offline queue grows >100 events on one device — surface red banner, force user to find Wi-Fi before more scans accepted.
14. **NEW:** Bootstrap stocktake misses a lot — caught by first cycle count of that zone within 30 days; lot added as late-bootstrap event with QA sign-off.

---

## Hardware (unchanged from v3 — see G1, G2)

| Item | Cost | Notes |
|---|---|---|
| 200 Location stickers (laminated) | ~₹10,000 | One-time, post-G1 |
| 10 Action stickers (laminated) | ~₹500 | Workstation mounts |
| Thermal printer (one, central) | ~₹8,000 | G1 procurement gate |
| Avery A4 sticker sheets | ~₹500 | G2 fallback validated |
| Bluetooth ring scanner (optional, Phase 5) | ~₹3,000 each | Gloved/wet ops |
| Phones (BYOD) | existing | Browser camera + jsQR |

---

## Tribunal Fixes Applied

For traceability against `veritas_sessions/veritas_v4_20260527_115216.json`:

| # | Tribunal finding (severity) | Where fixed in v3.1 |
|---|---|---|
| 1 | No authn/authz model (SHOWSTOPPER, security) | §Authentication, authorization, session model |
| 2 | No QR payload validation (SHOWSTOPPER, security) | §Validation contract + `recordScan` parse step |
| 3 | Timeline contradiction ~5 sprints vs 11 days (SHOWSTOPPER, devil) | §Phased rollout — honest elapsed weeks |
| 4 | False supersession of v1 (SHOWSTOPPER, devil) | v1 file status updated to "Superseded" |
| 5 | No thermal printer (SHOWSTOPPER, domain_expert) | Gate G1, must pass before Phase 1 |
| 6 | No offline-first (CRITICAL, domain_expert) | §Offline-first scan queue (Phase 1 scope, not deferred) |
| 7 | Shared device session hijack (CRITICAL, security) | §Session — mode keyed by (userId, workstationId) + fast-switch picker |
| 8 | Mode-switching UX unvalidated (CRITICAL, devil) | Gate G3 — 2-week paper-log pilot before electronic rollout |
| 9 | One-way door to event-sourced (CRITICAL, devil) | STOCK_LEDGER retained during Phase 1-2 for rollback safety |
| 10 | Dual write paths ACTION_EVENTS + SCAN_EVENTS (CRITICAL, simplicity) | Collapsed to one SCAN_EVENTS table with `targetType='ACT'` |
| 11 | Twelve killer enhancements pollute scope (CRITICAL, simplicity) | Moved to `enhancements/QR-V3-ENHANCEMENTS.md`; deferred to Phase 4-5 |
| 12 | No RBAC (CRITICAL, security) | §Authorization (RBAC) — per-function role matrix |
| 13 | No reconciliation for bootstrap drift (CRITICAL, devil) | §Bootstrap stocktake + ongoing reconciliation |
| 14 | FIFO pain unsolved (CRITICAL, domain_expert) | §FIFO enforcement — grnDate column + pick-time check + override log |
| 15 | No change-control / IQ-OQ-PQ (CRITICAL, domain_expert) | Gate G7 — validation doc per ISO 9001:2015 §8.5.6 |
| 16 | Audit trail not defensible (CRITICAL, domain_expert) | §Audit-trail integrity — hash chain + immutable daily backup + compensating-event correction model |
| 17 | Operator training absent (CRITICAL, domain_expert) | Gate G6 — training curriculum + 30-min hands-on |

**Unseen contradiction surfaced by Phase A but missed by all 4 critic seats:**

| Phase A finding | Where fixed in v3.1 |
|---|---|
| v1 and v3 both still marked "deferred" — no supersession in writing | v1 status changed to "Superseded by PLAN-V3.1"; this file is the canonical direction |

---

## Open questions before sprint commit

All v3's original 8 open questions remain valid. Adding:

9. Who owns gate G3 — the paper-log pilot? Ops lead or floor supervisor?
10. Hash chain breaks — what's the QMS incident severity tier?
11. Bootstrap variance threshold — at what % do we abort Phase 1 cut-over and re-count?
12. Phase 4 readiness criteria — who signs off that the 3-month clean-data target is met?

---

## TL;DR

- v3.1 = v3's conceptual wins (mode-aware QR, event-sourced inventory, single-thermal-printer model) + the 17 tribunal fixes folded back in
- **8 pre-flight gates** must pass before any code (thermal printer, A4 fallback, paper-log mode pilot, authn doc, Wi-Fi survey, training, validation doc, stocktake plan)
- **Authn/RBAC + QR payload validation + hash-chain audit + offline-first + FIFO check** — all in Phase 1, not deferred
- ACTION_EVENTS folded into SCAN_EVENTS — one table, one write path
- STOCK_LEDGER retained during Phase 1-2 — rollback is possible
- 12 "killer enhancements" moved to appendix — Phase 1 is genuinely small
- Honest rollout: 2 weeks gates + 1 week Phase 1 + 1 week Phase 2 + 1 week Phase 3, then 3-month earn-the-right-to-Phase-4 wait
- v1 is formally superseded; this file is the canonical direction

**The phrase to remember:** *the Action QR is not what you're doing, it's where you are and what role you're playing.* v3.1 keeps that. It just refuses to ship it without auth, validation, an offline queue, a hash chain, a printer, and a paper pilot.
