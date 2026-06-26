# Rack Detail — Screen Design Spec

**Stitch screen:** `projects/10290620691745788406/screens/132dfaac862e4ce29cf54ed63ea2dc00` (Mobile)
**Mockup HTML:** `11-rack-detail.html`
**Design system:** Industrial Quality Management System — `assets/f1c072ac30ee4901b96547757f18a349`

## Purpose
Drill-down from a Stock Map zone into one rack's bin slots. Phone-first (operator at the rack).

## Layout
- **Top bar** (navy): back arrow, title "Rack J12 · Bulk RM", subtitle "1st Floor · Aisle J".
- **Occupancy card**: large mono fill % (e.g. 78%), "6 of 8 bins occupied", capacity bar.
- **Bin list** (BIN 1…8), each occupied slot = white card, 1px outline, **4px left status strip** (FIFO age emerald/amber/red): material (Plus Jakarta), mono lot pill, mono qty, age, 6-stage pipeline mini-tracker.
  - **Aged bin**: red-striped pattern + "AGED >30d" badge.
  - **Empty bin**: dashed outline "Empty — tap to assign".
- **Sticky bottom bar** (navy): "Move lot" + "Putaway here" (48px, Public Sans, Material icons) → wire to `runAction('move')` / putaway flow.

## Data dependency (P3 — blocked)
Per-rack bin occupancy needs the LOCATIONS hierarchy (FLOOR-SECTION-AISLE-RACK-SHELF-BIN) populated, which is not yet done. Actions reuse existing `recordLocationTransfer`.

## Tokens
primary `#000747`/`#0d1b6e`, secondary `#0070f3`, emerald/amber/red FIFO. Mono for ids/quantities. 48px touch targets, 0.5rem radius.
