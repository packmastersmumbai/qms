# QR QMS Project — Mode-Aware QR System (Plan v3)

**Saved:** 2026-05-19
**Status:** Approved direction, deferred for later implementation
**Project:** Pack Masters QMS (PM QMS)
**Companion plan:** [PLAN-V1-QR-AND-FG-PIPELINE.md](PLAN-V1-QR-AND-FG-PIPELINE.md)

---

## Core inversion

> Today your warehouse is a mystery the system tries to model.
> After this project, the warehouse is a stream of events the system observes directly.

The shift from notional inventory to **event-sourced inventory** is the categorical change. Everything else in this plan derives from that.

---

## The three QR types

Each has a strict 3-char prefix so they're never confused.

### 1. Action QR (`ACT|<verb>`)
- ~10 needed total, laminated, mounted at workstations
- Encodes a verb + implicit workstation location + implicit role
- **Sticky mode**: scanning sets the operator's mode until next ACT scan or 10-min timeout
- Verbs: `RECEIVE`, `SAMPLE`, `RETEST`, `RELEASE`, `HOLD`, `MOVE`, `PICK`, `RETURN`, `REJECT`, `SHIP`, `COUNT`
- Killer concept: **the Action QR is "where you are + what role you're playing," not just "what you're doing"** — this is what enables single-scan workflows

### 2. Location QR (`LOC|<id>`)
- ~200 needed, laminated, screwed to racks/walls/floors permanently
- One-time print + mount, then forever
- Examples: `LOC|BUFFER-A`, `LOC|RACK-3-BIN-12`, `LOC|REJECT-BIN`, `LOC|DISPATCH-1`, `LOC|TRUCK-MH-12`

### 3. Product QR (`PRD|<grn>:<line>`)
- Printed at GRN, **selectively** — only for high-value or regulated materials
- Encodes: GRN number + line index. Five chars total.
- Nothing mutable in the payload
- Routine low-risk RM does not get a Product sticker — location + lot-key-lookup suffices

---

## The "one verb, one scan" rule

**The most recently scanned Action QR remains active until the next one is scanned or auto-expires.**

Same model as a TV remote's SOURCE button. Mode is sticky. The verb is set once at the workstation; subsequent scans default to that verb.

Result: **most actions are 1 scan after the morning's mode set**, not 3.

---

## Workflow examples (by zone)

| Zone | Action QR present | Typical scan count per transaction |
|---|---|---|
| Gate | `ACT|RECEIVE` | 1 ACT + 1 LOC for whole truck; stickers print, no PRD scans needed |
| QC Bench | `ACT|SAMPLE`, `ACT|RETEST`, `ACT|RELEASE`, `ACT|HOLD` | 1 LOC or 1 PRD (operator choice) per sample |
| Put-away | `ACT|MOVE` on in-charge phone | 1 PRD + 1 LOC (genuinely binary) |
| Picking | `ACT|PICK` on trolley | 1 LOC per pick (mode pre-set from FG Plan) |
| Return | `ACT|RETURN` on shop floor phone | 1 PRD + 1 LOC per returned component |
| Reject | `ACT|REJECT` | 1 PRD (NCR auto-created, lot stamped to REJECT-ZONE implicitly) |
| Ship | `ACT|SHIP` at dock | 1 PRD + 1 LOC|TRUCK |
| Cycle Count | `ACT|COUNT` | 1 LOC per rack |
| Ad-hoc lookup | (no mode) | 1 PRD or 1 LOC → public lifecycle / location view |

---

## Data model — three new sheets

```
ACTION_EVENTS:
  ts, userId, actionVerb, workstationId
  -- mode-switch log; audit + analytics

SCAN_EVENTS:
  ts, userId, action(from current mode), targetType(LOC|PRD), targetId,
  derivedLotId, derivedLocationId, qty, jobRef
  -- the central transaction log; THIS is the source of truth

LOCATIONS:
  locationId, zone, type, capacity, active
  -- ~200 rows, seeded once
```

**No state column.** State is always computed:
- "Where is lot X?" → latest SCAN_EVENTS row for lot X
- "What's at location Y?" → all SCAN_EVENTS at Y where last action wasn't MOVED_OUT
- "Current qty per (material, location)" → sum of in/out filtered by location
- "Lot's age at current location" → ts of last "ARRIVED" event for lot X at current location

---

## Backend surface (5 functions + 1 page)

| Component | Purpose |
|---|---|
| `printLocationStickers()` | Generates HTML for all 200 location stickers (one-time print) |
| `printActionStickers()` | Generates HTML for the ~10 action stickers (workstation mounts) |
| `setMode(actionVerb, workstationId)` | Writes ACTION_EVENT, sets the user's sticky mode |
| `recordScan(targetType, targetId, qty?, jobRef?)` | Writes SCAN_EVENT, executes action implied by current mode |
| `resolveScan(payload)` | Lifecycle card data (v1 resolver, now LOC-aware) |
| `Scan.html` | Camera viewfinder + mode banner + manual entry fallback |

---

## Workflow benefits

### Inventory management
- Real-time location truth: every move stamps `lot → location` in SCAN_EVENTS
- Inventory IS the event log — ledger and warehouse forced to agree
- Stocktake collapses from a day to an hour
- Layout knowledge externalises — new hires productive on day 1

### Locating
- **MTTL (Mean Time To Locate)** drops from 5–15 min to ~10 seconds
- Direct lookup (by material) → all locations with qty + FIFO order
- Reverse lookup (scan rack) → all lots present with batch numbers
- ~6 hours/day operator time saved at 30 lookups/day

### Issue (RM to production)
- System tells picker the exact rack to go to
- Location scan verifies they're at the right place
- **FIFO becomes physically enforceable**, not just algorithmically chosen
- Partial picks become trackable (operator took 75 of 80 PC → variance visible immediately)

### Return (production to warehouse)
- Returns backed by physical scan events, not form entries
- Returned location is known (today: ambiguous)
- Re-IQC routing possible (returned material → RECHECK zone, requires re-scan before re-issuable)

### Free-falling benefits
- Cycle counting becomes daily 10-min habit (was quarterly disruption)
- Inter-zone movement tracking (issue → consumption dwell time)
- Receiving against PO automatically (match supplier carton barcode to PO lines)
- Dispatch verification (FG pallet scan + truck location)
- Empty-rack detection / capacity planning
- Operator productivity metrics (use carefully — anonymous aggregates only)
- Audit trail that's actually defensible (ISO/GMP love this)
- **Recall surface in seconds** instead of 2-day file hunt

---

## The killer enhancements (deltas on basic plan)

### a. Smart suggestions panel after every scan
After Location scan: not just "what's here" but "what should be done here"
- "RACK-3-BIN-12: 150 PC of 2966562. Job PM/PROD/2026-019 needs 80 PC from here. [Start pick]"
- "RACK-7-BIN-99: 1 lot aged 90+ days. [Mark for clearance]"
- "BUFFER-A: 3 lots unsampled > 24h. [Send all to IQC]"

System is an active workflow engine, not a passive lookup tool.

### b. Zone shortcuts
One QR for grouped locations (column of bins) → paged view, up/down navigation. Useful for cycle counts.

### c. Movement contracts
Multi-step picks committed to a route:
- "Visit rack A, then C, then D, then back to A"
- Each scan checks off the next step
- Deviation prompts: "Expected RACK-C next; reorder route?"
- Forces optimal path

### d. Predictive empty-rack warning
Per location, count days-of-stock at current pull rate. Alert at 7 days, escalate at 3. Triggers reorder.

### e. Input-method agnostic
QR camera, manual type, voice ("scan location"), Bluetooth ring scanner (₹3k) — all produce the same SCAN_EVENT. Operator hands may be full/gloved/wet.

### f. The "rejection bin" trick
Physical rejection bin has its own `LOC|REJECT-BIN` QR. Workflow: move pallet to bin → scan LOC → NCR auto-created with default values. **The act of placing IS the workflow.**

### g. Conditional Action QRs
Same workstation can have multiple Action QRs (QC bench: SAMPLE, RETEST, RELEASE, HOLD). Operator scans the one matching current task. Workstation becomes a "control panel."

### h. Implicit reservation
Lot scanned under PICK mode is provisionally reserved for that job. Other pickers see "150 PC at RACK-3, 80 reserved by job 019, 70 available." Reservation expires if not committed within N minutes.

### i. Mode-aware bottom nav
In PICK mode: "Next item / Skip / Pause / Help" replace generic nav (Home/Records/KPIs/Masters/Dashboard). Don't waste screen real estate on irrelevant options.

### j. Tap-to-explain
"Why am I being told to do this?" → tap suggestion → "Lot X on hold awaiting IQC retest. Try lot Y instead." Builds trust.

### k. A4 print fallback
For low-volume ops: PDF on Avery A4 sticker sheets. Save the ₹15k thermal printer cost. Data layer doesn't care.

### l. Offline scan queue
Wi-Fi drops → scans queue locally → sync on reconnect. Critical for patchy warehouse connectivity.

---

## Mode persistence — the main risk & mitigation

Sticky modes can fail when operator forgets the mode is set.

| Mitigation | Force |
|---|---|
| Mode auto-expires after 10 min inactivity | Low (default behavior) |
| Active mode shown as colored banner on screen | Medium (visibility) |
| Mode change confirms when next action is dangerous (REJECT especially) | High (one extra tap when it matters) |
| Action QR can be re-scanned anytime to reset | Low (no penalty, no state cleanup) |

Don't skip the colored banner. Operators must always know what mode they're in.

---

## Failure modes (be specific)

1. **Action QR not at workstation** → fallback "Set mode manually" button, requires one tap
2. **Faded Location QR unreadable** → human-readable text on sticker, manual type field
3. **Shared tablet at bench, multiple operators** → mode per userId, explicit logout between users
4. **Mode persists across day-end** → end-of-shift timestamp cutoff (e.g., 6PM auto-clear)
5. **Mode change mid-transaction** → prompt "You have 2 picks pending. Abandon to switch?"
6. **Duplicate supplier batch numbers** → lot key is `materialCode + batch + grnNo`, never just batch
7. **Unprinted Product QR needed later** → lifecycle card queryable by typed batch from any page
8. **Bootstrapping current inventory** → one-time stocktake at rollout (~1 day per zone)
9. **Two pickers race for same lot** → row-level lock on lot key (extends existing STOCK_LEDGER lock)
10. **Lazy operator skips scan** → weekly cycle count variance review, training opportunity not punishment
11. **Mixed-lot pallet** → each lot is logical entity at location, pallet is just physical container

---

## Lots WITHOUT Product QR — how PICK mode disambiguates

- Picker scans rack with 3 lots of same material
- System asks: "Which lot? FIFO says batch B-AUTO-179. Confirm?"
- Picker visually verifies batch on pallet (supplier's own label) and confirms
- Disagreement → "operator override" event logged for review
- Overrides are warehouse-in-charge review queue: stale ledger data, or system gaming?

---

## Hardware

| Item | Cost | Notes |
|---|---|---|
| 200 Location stickers (laminated) | ~₹10,000 | One-time, mail-order from print shop |
| 10 Action stickers (laminated) | ~₹500 | Mounted at workstations |
| Thermal printer (one, anywhere central) | ~₹8,000 | For Product stickers on-demand |
| Bluetooth ring scanner (optional) | ~₹3,000 each | For gloved/wet/cold operations |
| Phones (BYOD or company) | existing | Browser camera + jsQR / BarcodeDetector |

**No gate printer required.** Single thermal printer anywhere is enough.

---

## Rollout phasing

| Phase | Duration | Ships | Skips |
|---|---|---|---|
| Phase 1 | ~5 days | Location + Action stickers, Scan.html with mode banner, receive/sample/pick/move workflows | Product stickers, reject/ship workflows, lifecycle card |
| Phase 2 | ~3 days | Reject + Ship modes | — |
| Phase 3 | ~3 days | Product stickers for high-value/regulated materials (5–10 SKUs) | Routine RM stickering |
| Phase 4 | Later | Lifecycle card (v1 resolver) + smart suggestions | — |
| Phase 5 | When scale demands | RFID + Bluetooth scanners + offline queue hardening | — |

**Bootstrap requirement:** One-time stocktake walk per zone at rollout to seed initial locations.
**Rollout strategy:** One zone at a time. Start with busiest (RM feeding production). Prove workflow. Expand.

---

## Comparison vs v1 (lot-QR-only)

| Dimension | v1 lot-QR | v3 mode-aware (this plan) |
|---|---|---|
| Sticker volume | High (daily printing) | Medium (small daily + one-time 200) |
| Hardware dependency | Gate thermal printer | One thermal printer anywhere |
| Receipt | 3 PRD prints + 0 scans | 2 scans (ACT + LOC), 0 typing |
| Sample | 1 PRD scan | 1 LOC or 1 PRD (operator choice) |
| Pick | 1 PRD scan | 1 LOC scan (mode pre-set) |
| Move | 1 LOC + 1 PRD | 1 PRD + 1 LOC |
| Reject | Multi-step form | 1 PRD scan (NCR auto-created) |
| FIFO enforcement | Strong (PRD = lot) | Strong (mode + LOC + optional PRD) |
| Operator training | Low | Medium (mode awareness) |
| Implementation effort | 5 changes | 5 changes + mode UI + 3 new sheets |
| Best for | High-value lots, regulated FG | Multi-action warehouse with variety of touches |

v3 isn't strictly better — it's better for an operation that does **many different kinds of touches** (receive + sample + pick + move + reject + ship) where the variety is the bottleneck, not per-action complexity.

---

## Long-term payoff (why this is worth doing)

Once SCAN_EVENTS is a complete event log of physical reality:

1. **Ledger ↔ warehouse forced reconciliation** — variance detectable in real time (foundation of trustworthy inventory)
2. **Event-sourced inventory** — replay events to any timestamp, audit becomes trivial
3. **Simulation unlocked** — run event stream through different policies to measure throughput change
4. **Real automation** — "5 lots at REJECT-ZONE → WhatsApp supervisor" trivially codeable
5. **Customer trust as product** — produce full event chain for any shipped batch in seconds
6. **Tender qualification** — "full physical traceability" qualifies you for regulated tenders (pharma packaging, food contact, regulated FMCG)

---

## Open questions before implementation

1. Confirm location structure — flat zone names, or hierarchical (ZONE > RACK > BIN)?
2. Confirm Action QR placement plan — which workstations, how many per station, conditional sets?
3. Confirm bootstrap stocktake plan — staff, schedule, freeze period during rollout
4. Confirm operator device strategy — BYOD phones vs company tablets at workstations
5. Confirm offline tolerance requirement — does the warehouse Wi-Fi drop often enough to justify offline queue in v1?
6. Confirm which materials get Product stickers — regulatory list + high-value threshold
7. Confirm thermal printer placement — accessible to QC/warehouse, not specific to gate
8. Confirm tap-to-explain copy ownership — who writes the "why" text for each suggestion?

---

## TL;DR

- **3 QR types**: Action (verb + workstation), Location (where), Product (what specifically) — strict prefixes, never confused
- **Action QR is the unique idea**: sticky mode switch mounted at workstations; encodes verb + place + role in one scan
- **Most actions are 1 scan** after morning mode set; receive = 2 scans for entire truck; move is the only genuine 2-scan
- **Product stickers selective**, not universal — only for high-value/regulated
- **Three new sheets, five backend functions, one new page** — less code than v1
- **No gate printer required** — one thermal printer anywhere central is enough
- **Mode persistence is the main risk** — defused by colored banner, 10-min timeout, easy re-scan
- **Deeper payoff is event-sourced inventory** — physical and digital reconciled continuously, which unlocks audit, simulation, automation, and customer trust as a product feature
- **Discipline mechanism**: scan-required step. Without scan, no update. That asymmetry forces FIFO compliance, accurate locations, trustworthy data.

**The phrase to remember**: *the Action QR is not what you're doing, it's where you are and what role you're playing.* That's why it's powerful.

---

## See also
- [PLAN-V1-QR-AND-FG-PIPELINE.md](PLAN-V1-QR-AND-FG-PIPELINE.md) — original lot-QR plan + FG batch pipeline view
- Both plans on shelf for later implementation. Pick one direction (or hybrid) when ready to commit to a sprint.
