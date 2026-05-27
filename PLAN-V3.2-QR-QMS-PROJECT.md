# QR QMS Project — Chokepoint Pilot (Plan v3.2)

**Saved:** 2026-05-27
**Status:** Superseded by [PLAN-V3.3-QR-QMS-PROJECT.md](PLAN-V3.3-QR-QMS-PROJECT.md) — tribunal STOP 0.547 (soft); architecture right, measurement design rewritten in v3.3. Retained for diff reference.
**Supersedes:** [PLAN-V3-QR-QMS-PROJECT.md](PLAN-V3-QR-QMS-PROJECT.md), [PLAN-V3.1-QR-QMS-PROJECT.md](PLAN-V3.1-QR-QMS-PROJECT.md)
**Why this exists:** v3.1 tribunal verdict = STOP 4-0. Adding hardening was the wrong response. v3.2 cuts everything except answering one question — *will operators scan at the points where material crosses a boundary?*

---

## The Hypothesis

> If every lot is scanned at the 4 physical chokepoints it MUST pass through (Gate-In, Gate-Out, 1st-Floor-In, 2nd-Floor-In), then for any lot we can answer "where is it now" in under 2 minutes within 5 working days — without changing how anyone moves material.

Why chokepoints, not zones: a lot can be anywhere on a floor, but it cannot get onto a floor without crossing a doorway. **Scan the doorways, not the racks.** Four scanners instead of two hundred.

---

## The 4 chokepoints

| # | Chokepoint | Verb | Who scans | What triggers a scan |
|---|---|---|---|---|
| 1 | **Gate-In** (factory entry) | `RECEIVE` | Security + GRN clerk | Incoming truck unloaded; one scan per lot received |
| 2 | **Gate-Out** (factory exit) | `SHIP` | Dispatch clerk | Outgoing dispatch loaded; one scan per lot dispatched |
| 3 | **1st-Floor-In** (lift/stair landing entry to 1st floor) | `UP-1` | Floor in-charge | Lot brought onto 1st floor for production / storage |
| 4 | **2nd-Floor-In** (lift/stair landing entry to 2nd floor) | `UP-2` | Floor in-charge | Lot brought onto 2nd floor for production / storage |

Each chokepoint gets ONE physical Location QR sticker. Total: **4 stickers, 4 verbs, 4 scan stations**. That's the whole physical surface area.

There is no `DOWN-1` / `DOWN-2` in the pilot. A lot leaving a floor either goes to dispatch (→ Gate-Out catches it) or to the other floor (→ that floor's In-scanner catches it). We accept that during the pilot, intra-floor movement is invisible — the goal isn't full traceability, it's answering "which floor is this lot on right now?"

---

## What v3.2 ships

| Thing | What it is |
|---|---|
| **4 Location stickers** | `LOC|GATE-IN`, `LOC|GATE-OUT`, `LOC|FLOOR-1-IN`, `LOC|FLOOR-2-IN`. Thermal-printed if available, otherwise A4 inkjet inside an acrylic holder screwed at chest height by each doorway. |
| **1 sheet** | `SCAN_EVENTS`. Six columns: `ts, userId, locationId, verb, lotId, qty`. Nothing else. |
| **1 page** | `Scan.html` — phone camera + manual entry + last-5-scans list per user. No mode banner, no suggestions, no offline queue. |
| **1 server function** | `recordScan(locationId, lotId, qty)` — looks up the verb from the locationId (each chokepoint has a fixed verb), validates regex, requires authenticated QMS session, appends one row. |
| **1 derived query** | `whereIsLot(lotId)` — read the latest `SCAN_EVENTS` row for that lotId, return its locationId + the implied "current location" (GATE-IN → "in warehouse", FLOOR-1-IN → "1st floor", FLOOR-2-IN → "2nd floor", GATE-OUT → "dispatched"). |
| **Authn** | Reuses existing PM QMS `getCurrentUser()`. Zero new auth code. |
| **STOCK_LEDGER** | Untouched. v3.2 writes a parallel event log; ledger remains source of truth. No dual-write reconciliation, no rollback risk. |

Estimated ~200 LoC total (50 more than the rack-pilot draft, because of the 4-verb lookup and the `whereIsLot` query).

---

## Verb is fixed by location, not chosen by operator

Critical simplification: the operator never picks a verb. The sticker IS the verb.

- Scan `LOC|GATE-IN` → server knows it's a RECEIVE
- Scan `LOC|FLOOR-2-IN` → server knows it's an UP-2
- etc.

No mode-switching, no sticky mode, no Action QRs. This was the v3 tribunal's #1 unvalidated assumption ("operators will keep the right mode set"). v3.2 sidesteps it entirely — the physical location of the sticker carries the verb.

---

## What v3.2 does NOT ship (explicit deferrals)

- ❌ Action QRs / mode-switching / sticky mode (verb is fixed by sticker location)
- ❌ Product QRs / per-lot stickers
- ❌ Rack-level / bin-level location tracking
- ❌ RBAC (any authenticated QMS user can scan any chokepoint)
- ❌ Hash-chain audit / signed events / tamper detection
- ❌ Offline-first queue / IndexedDB
- ❌ FIFO enforcement / `grnDate` column
- ❌ Smart suggestions / movement contracts / predictive empty / lifecycle card
- ❌ Bootstrap stocktake (first scan of each lot starts its history; pre-existing lots are out of pilot scope)
- ❌ Validation / IQ-OQ-PQ doc
- ❌ Backup CSV / weekly chain verify
- ❌ Intra-floor movement, returns, rejections, NCRs (every "no" is the v3.1 tribunal finding it dissolves)

None of these matter until we know operators will scan at doorways.

---

## Success criterion (single, measurable)

For 5 consecutive working days:

1. **Locating accuracy**: For 5 random lots per day (25 total over the week), `whereIsLot(lotId)` returns the floor the lot is physically on — verified by warehouse-in-charge walking to that floor and finding the lot. **Target: ≥ 80% correct (≥ 20 of 25).**
2. **Scan compliance per chokepoint**: For each of the 4 chokepoints, ≥ 80% of physical crossings produced a `SCAN_EVENTS` row — verified by comparing against:
   - Gate-In: GRN log (every GRN row should have a matching RECEIVE scan)
   - Gate-Out: Dispatch log (every dispatch row should have a matching SHIP scan)
   - 1st/2nd-Floor-In: IPQC sample-request log per floor (each first-time-on-floor lot should have a matching UP scan)
3. **Time-to-locate**: For each of the 25 trial lookups, the `whereIsLot` query + walk-to-floor verification completes in **< 2 minutes**.

All three must pass. Any one fails → hypothesis falsified, don't expand.

---

## Pre-flight (NOT gates — just buy/print, half a day)

| Item | Owner | Acceptance |
|---|---|---|
| 4 chokepoint stickers printed | Ops | Stickers mounted at chest height by each doorway, readable by phone camera from 30 cm |
| Security/GRN clerk briefed (30 min) | Dev | Demo on test sheet; clerk does 3 successful Gate-In scans |
| Dispatch clerk briefed (30 min) | Dev | Demo + 3 successful Gate-Out scans |
| 1st-floor in-charge briefed (30 min) | Dev | Demo + 3 successful UP-1 scans |
| 2nd-floor in-charge briefed (30 min) | Dev | Demo + 3 successful UP-2 scans |
| Warehouse-in-charge briefed on `whereIsLot` lookup tool | Dev | Performs 3 lookups against test data |

Total briefing: 2.5 hours. Total sticker cost: ~₹500.

---

## Timeline

| Day | Activity |
|---|---|
| **Mon (Day 0)** | 4 stickers up, code deployed, all 4 clerks + warehouse-in-charge briefed |
| **Tue (Day 1) AM** | Warehouse-in-charge stands at Gate-In and Gate-Out for 2 hours, watches first crossings, corrects on the spot. Spot-check 1st/2nd floor at lunch. |
| **Tue–Sat (Days 1-5)** | Operators scan at every crossing. Warehouse-in-charge runs 5 `whereIsLot` trials/day, walks to verify. |
| **Sat evening** | Read results: 25-trial accuracy %, per-chokepoint compliance %, average time-to-locate. Pass/fail call by warehouse-in-charge + dev. |

Total elapsed: **1 calendar week**.

---

## Risks (single page, single mitigation each)

| Risk | Mitigation |
|---|---|
| Clerks forget to scan during busy unload/dispatch rushes | Warehouse-in-charge audits Gate-In and Gate-Out at end of Day 1 by counting GRN/Dispatch rows vs SCAN_EVENTS rows. If <50% match → coaching on Day 2 morning. Still <50% by Day 3 → abort. |
| Lot bypasses a floor in-scanner (e.g., goes straight from Gate-In to a floor without scanning) | This is the metric we're measuring. <80% scan compliance at a floor-in chokepoint means the chokepoint isn't enforceable — that's a real finding, not a bug. |
| Same lot scanned at both floor-ins on same day (someone moved it up then up again) | `whereIsLot` returns the latest scan. Correct behavior. No special handling needed. |
| Wi-Fi drops at Gate-In (often the worst-connected spot) | Manual-entry fallback on Scan.html — clerk types `LOC|GATE-IN` + lot ID. Acceptable. If Wi-Fi at Gate-In is unworkable >20% of day → measured failure, document it. |
| Stickers degrade | 5 days inside acrylic holders is fine. Not measuring durability in this pilot. |
| Code bug in `recordScan` or `whereIsLot` | One developer reviews both functions before deploy. No tribunal, no audit chain — just a code review. |
| Pre-existing lots already on a floor have no scan history | Out of scope. Pilot measures lots that ENTER the system from Day 1 onward. Pre-existing lots can be backfilled by a one-off bulk-insert if results warrant expansion. |
| Lot leaves a floor without being re-scanned at the other floor or at Gate-Out | `whereIsLot` will be wrong for that lot. This is exactly what the 80% accuracy metric catches. Below 80% → chokepoint set is incomplete (need a DOWN scanner). |

---

## What this resolves from the v3.1 tribunal

- **"Mode-switching unvalidated"** (devil) → no modes. Each sticker carries one fixed verb.
- **"Plan optimizes for review-passing, not pain-solving"** (devil reframe) → measures locating accuracy directly with a walk-to-floor verification.
- **"Simplest system that tests the hypothesis"** (simplicity reframe) → 4 stickers, 1 function, 1 page, 1 query.
- **"Specifications cannot be exploited but also cannot defend"** (security reframe) → shippable code with one auth check and one regex; no specification surface to argue about.
- **"Thermal printer is a hard prerequisite"** (domain_expert reframe) → 4 stickers is cheap enough that even hand-laminated will work for 5 days. Thermal is nice-to-have, not blocking.
- **"Operator training absent"** (domain_expert) → 30 min briefing × 4 clerks. Operators do nothing different except one scan at one moment.

---

## What happens after Day 5

| Outcome | Next action |
|---|---|
| All three metrics pass | Write `PLAN-V3.3` — add `DOWN-1` and `DOWN-2` chokepoints (so a lot leaving a floor without dispatching is also captured), and start `whereIsLot` exposure in Records UI. Still no hash chain, no offline, no Action QRs. Another 1-week pilot. |
| Locating accuracy passes, scan compliance fails at 1+ chokepoint | That chokepoint isn't enforceable. Either physically re-design the doorway (e.g., add a turnstile-like queue), or accept that floor isn't trackable and remove it. |
| Locating accuracy fails | Chokepoint model is wrong for this warehouse — lots are bypassing scanners. Either add `DOWN` chokepoints (v3.3 scope brought forward), or admit doorway scanning doesn't solve "where is this lot." |
| Time-to-locate fails | The `whereIsLot` UI is too slow or operator can't find the lot within the named floor. Either expose more detail (rack-level) or admit floor-level granularity is insufficient. |
| Everything fails | Document the falsification, archive v3/v3.1/v3.2. Pain remains real; doorway-scan model is not the answer. |

---

## Why chokepoints, not zones (the design insight)

A warehouse-zone model needs ~200 stickers and scans on every movement. A chokepoint model needs ~4 stickers and scans only at floor transitions. The information content is lower (we know which floor, not which rack) but the **compliance bar is much lower** — clerks already gather at doorways for GRN/Dispatch paperwork; the scan fits the existing workflow rather than fighting it.

If chokepoint scans get to 80% compliance, that's the proof that operators *will* scan when the scan is anchored to an existing ritual. Rack-level scans are then a question of "do they scan when there's no existing ritual?" — a strictly harder bar to clear, and one we haven't earned the right to ask yet.

---

## TL;DR

- 4 chokepoints (Gate-In, Gate-Out, Floor-1-In, Floor-2-In), 4 stickers, 4 verbs, all fixed by location
- 1 sheet, 1 page, 1 server function, 1 derived query, ~200 LoC
- No hash chain, no offline, no RBAC, no FIFO, no Action QRs, no Product QRs, no bootstrap, no validation doc, no rack-level
- 5 days, 3 metrics: locating accuracy ≥ 80%, per-chokepoint scan compliance ≥ 80%, time-to-locate < 2 min
- Pass → v3.3 adds `DOWN` chokepoints. Fail → doorway scanning is wrong for this warehouse.
- Total dev: ~200 LoC. Total briefing: 2.5 hours. Total calendar: 1 week.

**The phrase to remember:** *scan the doorways, not the racks.* Doorways are where existing rituals already happen; rack scans are a behavior change we haven't earned. v3.2 finds out whether anchoring scans to existing rituals works at all.
