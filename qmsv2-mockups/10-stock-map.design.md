# Stock Map — Screen Design Spec

**Stitch screen:** `projects/10290620691745788406/screens/8941cc0d02ca4423b273eeeb0c4b1040` (Desktop)
**Mockup HTML:** `10-stock-map.html`
**Design system:** Industrial Quality Management System — `assets/f1c072ac30ee4901b96547757f18a349`

## Purpose
Spatial + quantitative stock overview. Find *what* is aging (treemap) and *where* it sits (floor plan) at a glance.

## Layout
- **Left side-nav**: same as KPI/Home.
- **Top bar** (navy): title "Stock Map · 1st Floor", floor selector `GF / 1F / 2F`, view toggle `Treemap / Floor Plan`, color-by `FIFO Age / Fill %`, MANAGER + Admin.
- **Treemap (left half)** — "Inventory Distribution (FIFO Age)": rectangles sized by qty, colored emerald(fresh)/amber(aging)/red(>30d). **Sharp 0px corners** (data viz rule). Mono material + qty labels. Legend.
- **Floor plan (right half)** — "Facility Layout (Fill %)": real 1F zones as CAD-style blocks (sharp, 1px outline), heat-tinted by fill %:
  - BULK RM J01–J25 (rack strip), PM A / PM B / PM C, FINISHED GOODS, BUFFER PALLETS M01–M24 (grid), LINE 1/2/3, SCRAP AREA, LAB / QA.
  - Tap a zone → tooltip with occupancy → opens **Rack Detail** (`11-rack-detail`).
- **Bottom status bar**: Total Occupancy %, Next FIFO Pull, Export / Modify Allocation.

## Data dependency (P3 — currently blocked)
Treemap qty/age = real `getStockSummary` + FIFO age. **Floor-plan geometry needs LOCATIONS hierarchy + per-zone coords, which are not yet populated.** Build treemap first (real data); floor plan once location data entered.

## Tokens
primary `#000747`/`#0d1b6e`, secondary `#0070f3`, emerald/amber/red heat scale. Data-viz elements sharp-cornered; chrome 0.5rem. Mono for quantities.
