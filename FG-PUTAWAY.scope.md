# FG Booking → Buffer → OQC Putaway

**Status:** scoped, not implemented.
**Date:** 2026-08-04 · branch `feat/grn-iqc-redesign` · deploy @567

Requested: production booking puts FG into a buffer area; the OQC person then
allocates it to available slots one at a time (pick slot → enter qty → repeat);
saving updates the warehouse. Allocation, FIFO and layout to stay seamless.

**Verdict: yes, and most of it already exists.** This is mostly wiring, not new
machinery. One genuinely new piece (the FG ledger credit at booking), one new
screen that closely mirrors an existing one.

---

## What already exists (verified in source)

| Need | Existing | Where |
|---|---|---|
| Buffer location | `FG-HOLD` — literally "FG Hold (pre-OQC)", type `FG_HOLD` | `Initialize.js:114` |
| Buffer slots | Bay F ×14 "Buffer Pallet", Bay E ×21 FG | `Initialize.js:132-133` |
| Slot suggestion | `suggestSlot(materialCode, qty)` → `.plan` | `Warehouse.js:1104` |
| **Multi-slot allocation** | `runPutawayPlan({plan:[{slotId, qty}...]})` — sequential, per-slot result, partial failure visible | `Warehouse.js:862` |
| Single move | `runPutaway` → `recordLocationTransfer` | `Warehouse.js:845` |
| Queue pattern | `getPutawayQueue()` + `PutawayQueue.html` — the exact pick-slot/enter-qty UI requested | `Warehouse.js:399` |
| FIFO | `getFIFOLots()` reads ledger balances; excludes `FG_HOLD` from picking | `Warehouse.js:328` |
| Floorplan | `WarehouseFloorplan.html` renders from `getStockSummary()` | `WarehouseFloorplan.html:704` |

**Seamlessness is free.** FIFO and the floorplan both derive from
`STOCK_LEDGER`/`getStockSummary()`. Nothing needs teaching about FG — write
correct ledger rows and both update automatically. `FG_HOLD` is already in the
FIFO exclusion list, so buffered FG is correctly non-issuable until moved.

---

## WS1 — Book FG into the buffer  *(the only real gap)*

**Today:** `Production.js` debits components (`PROD_CONSUME`/`SCRAP`/`WASTAGE`/
`LOSS`) and records FG qty in `PROD_BOOKING_LOG` — but writes **no FG stock
entry at all**. Confirmed by `OQC.js:301`: *"this is the FG side's first stock
entry (no paired OUT exists since IPQC does not currently write to
STOCK_LEDGER)"*. Live counts: `PROD_BOOK` 84 vs `OQC_RELEASE` 12 — produced
goods are invisible to stock until OQC.

**Change:** in the booking commit, after component lines are written:

```js
writeStockLedger_('PROD_FG_BOOK', fgCode, fgBatch, 'FG-HOLD',
                  fgProd, 0, 'PROD', bookingId, bookedBy,
                  'FG booked to buffer, awaiting OQC');
```

- Inside the existing lock and the existing `bookedUndo` rollback, or a
  mid-loop failure leaves phantom FG.
- `FG-HOLD` is already FIFO-excluded → buffered FG cannot be dispatched or
  issued to production. Correct: it is not released yet.
- WIP becomes visible on the floorplan for the first time.

**Risk — must be settled before building:** OQC currently writes
`OQC_RELEASE` as an **IN with no paired OUT**, because nothing had credited FG
before. Once booking credits FG-HOLD, OQC must become a **transfer**
(OUT of FG-HOLD → IN to the chosen slot), or every unit is counted twice.
This is the single most important correctness point in this scope.

**Est.** ~3h including the OQC pairing fix.

---

## WS2 — OQC putaway (slot-by-slot allocation)

Mirror `PutawayQueue.html`, which is already the requested interaction: card
per lot, suggested slot, editable slot + qty, confirm, per-slot result.

**Flow:** OQC released → lot appears in an FG putaway queue → operator picks a
slot (or accepts the suggestion), enters qty, repeats until the booked qty is
allocated → save.

**Server:** reuse `suggestSlot` (filter to FG bays E/F) and `runPutawayPlan`
unchanged. `fromLocationId: 'FG-HOLD'`, `toLocationId: <slot>`.

**Must enforce:** Σ allocated ≤ qty released, and remainder stays in FG-HOLD
rather than vanishing. `runPutawayPlan` already reports per-slot success so a
slot filled between suggest and confirm is visible, not silent.

**Est.** ~5h (new screen, reusing server functions).

---

## WS3 — Seamlessness check

No build expected; verification only.

- Floorplan shows FG in buffer after booking, in slots after putaway
- `getFIFOLots` excludes FG-HOLD, includes slotted FG, oldest first
- Dispatch can pick slotted FG, cannot pick buffered FG
- Ledger conserves: booked in = allocated + remainder (no double count)

**Est.** ~2h.

---

## Sequencing

WS1 → WS2 → WS3. WS1 alone is shippable and immediately useful (WIP visible);
WS2 without WS1 has nothing to allocate.

## Open questions

1. **Batch identity for FG.** Which batch/lot number does booked FG carry? OQC
   uses `item.batchPO`. If booking does not stamp the same value, the OUT and IN
   will not reconcile.
2. **Partial OQC release.** If OQC releases 800 of 1000 booked, the other 200
   stay in FG-HOLD — is that rejected, on hold, or still pending?
3. **Does WIP visibility change dispatch behaviour?** FG-HOLD is FIFO-excluded,
   so no — but confirm nobody reads raw balances outside `getFIFOLots`.

## Not in scope

- Enforcing FIFO on dispatch (existing TODO at `Warehouse.js:322`; advisory only today)
- IPQC writing to STOCK_LEDGER
- Retroactive FG entries for the 84 historical `PROD_BOOK` rows
