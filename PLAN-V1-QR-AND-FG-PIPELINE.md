# Plan v1 — QR Traceability + FG Batch Pipeline View

**Saved:** 2026-05-19
**Status:** Superseded by [PLAN-V3.3-QR-QMS-PROJECT.md](PLAN-V3.3-QR-QMS-PROJECT.md) — retained for reference only
**Project:** Pack Masters QMS (PM QMS)

---

## Part A — QR Traceability (v1)

### Core principle
The QR is a **permanent address**, not a snapshot. Five characters. `GRN-no:line-idx`. The server resolves state on every scan by walking forward joins.

### What the QR encodes
- Payload format: `GRN-050:2` (GRN number + line index, separator `:`)
- Nothing mutable — no batch, no qty, no disposition
- Server lookup recomputes everything on demand

### Sticker spec
- One sticker per **GRN line item** (not per pallet, not per box)
- 40mm × 60mm, single-color thermal
- Contents:
  - QR (12mm × 12mm)
  - Human-readable: `GRN-050  Line 2/3 / material code + name / batch / qty / supplier`
- If a line has N pallets, all N share the same sticker design

### Where stickers print
- **Thermal printer at the GATE** (Zebra ZD220 or equivalent, ~₹8k)
- Print on GRN save — "Print Stickers" button alongside "Save GRN"
- Unloader peels and sticks as pallets pass

### Three scan moments

| Moment | Persona | Action | UI |
|---|---|---|---|
| Receipt | (none — print only) | Stickers come off printer at gate | n/a |
| Sampling | QC Inspector | Scan QR → IQC opens on the right row | `/Scan?to=iqc` |
| Picking | Warehouse Picker | Scan QR → system validates this is the FIFO-correct lot for the job | `/Scan?to=pick&job=<jobId>` |

### The default scan behavior — lifecycle card
`/Scan` (no `?to=` param) → lifecycle card showing:

```
GRN-050  •  Line 2 of 3
2966562  CAN-M_TIN-PLT @AP TG 500ml
Batch B-AUTO-1779175521752-1  •  150 PC
─────────────────────────────────────────
STATUS: PARTIALLY CONSUMED
Available now: 70 PC at RM-STORE-A
─────────────────────────────────────────
✓ GRN          18-May 10:14   Tarun     →open
✓ IQC          18-May 15:22   Anuj      PASS
✓ Put-away     18-May 16:01   RM-STORE-A
✓ Booked       19-May 12:05   PM/PROD/2026-019
    └─ 80 PC for FG 2967583 (LOCTITE 500ml)
⊘ Consumed     — pending Book Production
⊘ Dispatched   — not yet
─────────────────────────────────────────
[ Open GRN ]  [ Open IQC ]  [ Open Job ]
```

### State resolver — derivation logic
State is computed, never stored:
1. GRN_LOG row exists? → if REJECTED disposition: `REJECTED`, stop
2. IQC_Sessions match? → `AWAITING_IQC` / `IN_IQC` / `IQC_FAILED` / `IQC_PASSED`
3. STOCK_LEDGER aggregation per (materialCode, batch):
   - opening = GRN qty
   - consumed = sum(RM_ISSUE, PROD_CONSUME, PROD_SCRAP, PROD_WASTAGE, PROD_LOSS)
   - returned = sum(PROD_RETURN)
   - booked = sum(PROD_BOOK) − sum(PROD_CONSUME+RETURN+SCRAP+WASTAGE+LOSS)
   - available = opening − consumed − booked
   - → AVAILABLE / PARTIALLY_BOOKED / FULLY_BOOKED / CONSUMED
4. PROD_BOOK rows → PROD_JOBS → OQC → Gatepass → Dispatch chain

### Backend changes (exactly 5)
1. Add `qrPayload` column to GRN_LOG (or compute on read)
2. `printGrnStickers(grnNo)` — returns HTML page with N stickers, inline QR via qrcode-generator.js (~7KB lib)
3. `Scan.html` — camera viewfinder + scan handler, routes by `?to=` param
4. `resolveScan(payload)` — returns lifecycle card data structure
5. "Scan" buttons added to IQC's "New from GRN" picker + Production Issue's job picker

### Anti-patterns (do NOT do in v1)
- ❌ Encode mutable data in QR (batch yes, qty/disposition no)
- ❌ Make scanning mandatory (must work alongside typing)
- ❌ Print one QR per box (one per line item)
- ❌ Separate scanner app (browser camera is enough)
- ❌ Auth-gate read-only lookups (lifecycle card public-read with redacted remarks)
- ❌ Use 1D barcodes (QR is forgiving for phone cameras)

### Sub-lot uniqueness (corner case)
- v1: same QR on all pallets of a line — accept it, ledger doesn't care
- v2: only if anyone asks — sub-divide line into 2a/2b/etc. at GRN save

### What ships in v1
- Stickers + scan-to-open IQC + scan-to-pick FIFO + scan-to-lifecycle-view
- Estimated 5–7 days of work

### Deferred (v2/v3/v4)
- v2: Location QRs (rack/bin), put-away scan, last-known-location tracking
- v3: Buffer zone states + dwell-time KPI
- v4: RFID + Bluetooth scanner support (when scale demands)

### Dealbreaker
**Thermal printer at the gate is mandatory.** No printer → project fails. Solve placement, power, network before any code.

### Value unlocked
1. Customer complaint triage in 60s (today: 2 hours)
2. Recall scope mapping in one query (today: 3 days of paper)
3. Genuine FIFO compliance audit per quarter
4. Free dwell-time analytics (GRN→IQC, IQC→put-away)
5. Operator self-service (no supervisor consult on which lot to pick)

---

## Part B — FG Batch Pipeline View

### What it is
A single screen per FG batch showing the full lifecycle as a horizontal track. Each stage = a node. Done stages filled, pending greyed, failed red.

### Stages (in physical order)
```
PO → GRN → IQC → Production Issue (FG Plan) → IPQC → Book Production → OQC → Gatepass → Dispatch
```

Side-branches:
- NCR appears below the stage that triggered it
- Customer Return appears after Dispatch if filed
- Control Plan is a badge (recipe reference), not a stage

### Filters at top
- FG Code (cascading from Client)
- Batch (specific batch ID — `b55`, `B2605E2E`, etc.)
- Date range (default: last 30 days)

### Quick-filter dropdown ("Show me...")
- Open batches
- NCR-flagged
- Dispatched this week
- Stuck > 3 days at any stage

### Node card spec
```
┌──────────────────┐
│ ✓ GRN            │  ← green check if done
│ GRN-050          │  ← doc number, click → DocView
│ 2026-05-18       │  ← date
│ Tarun Mishra     │  ← who
└──────────────────┘
```

Colors:
- 🟢 Green = done
- 🟠 Amber = in-progress
- 🔴 Red = failed / NCR-attached
- ⚪ Grey = not started

### Persona-driven defaults
| Persona | Default filter |
|---|---|
| Plant Manager | Last 7 days, all FGs, only red/amber |
| Customer Support | Empty, search-first |
| Production In-charge | Today, their FG, newest stage first |
| QA Head | Last 30 days, only NCR or open IPQC |

### Join lookups (the hard part)
- PO → GRN: `GRN_LOG.poNo`
- GRN → IQC: `IQC_Sessions.grnNo` (or `materialCode + batch`)
- IQC → Production Issue: STOCK_LEDGER IQC-passed lots consumed by PROD_BOOK
- Production Issue → IPQC: `IPQC_Sessions.productCode` + date proximity
- IPQC → Booking: `PROD_BOOKING_LOG.ipqcId`
- Booking → OQC → Gatepass → Dispatch: doc-chain on FG batch

### Hard problem: reverse-FIFO trace
"Which FG batches consumed this RM lot?" requires walking STOCK_LEDGER PROD_BOOK rows and matching to PROD_BOOKING_LOG. Many-to-many. **Defer to v4** unless users ask.

### Implementation order
1. Read-only batch detail page (one batch, 9 stages, deep links) — 1–2 days
2. Filter bar + materialized batch index — 1 day
3. Multi-batch list view (N rows × 9 columns) — 1 day
4. FIFO ledger walk (reverse direction) — defer
5. Drill-in modal per node — 1 day

### Skipped in v1
- Real-time updates (refresh button is fine)
- Print-friendly view (browser print works)
- PDF export
- Showing each IPQC round individually (just "IPQC ✓ (3 rounds)")

---

## Cross-cutting notes

- Both proposals scope to ~1 sprint MVP
- Both stress: ship narrow, layer based on operator usage data, don't over-engineer the data model
- Both depend on `STOCK_LEDGER` having enough columns to support the joins — verify before UI work
- Both should be backed by a stable `resolveScan(payload)` / `getBatchPipeline(batch)` server function so the UI is a thin renderer over a server-computed structure

## Open questions before implementation

1. Confirm thermal printer location at the gate (power + network)
2. Confirm IPQC_Sessions has a clean `grnNo` or `materialCode+batch` link backwards
3. Confirm PROD_BOOKING_LOG records ipqcId reliably (currently optional)
4. Confirm STOCK_LEDGER txn types cover all states (PROD_BOOK + PROD_CONSUME/RETURN/SCRAP/WASTAGE/LOSS exist)
5. Confirm appetite for adding new sheets (BUFFER_LOG, SCAN_EVENTS) vs reusing STOCK_LEDGER
