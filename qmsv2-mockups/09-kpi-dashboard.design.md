# KPI Dashboard — Screen Design Spec

**Stitch screen:** `projects/10290620691745788406/screens/259421dee2b34c58a081ecb280abc5ab` (Desktop)
**Mockup HTML:** `09-kpi-dashboard.html`
**Design system:** Industrial Quality Management System — `assets/f1c072ac30ee4901b96547757f18a349` (the authority; see repo `DESIGN.md`)

## Purpose
Manager-facing quality KPI dashboard for the cockpit. Numbers are the visual hero; status is signalled by a top color strip per card.

## Layout
- **Left side-nav** (identical to Home/Stock Map): PM QMS v2 logo, `+ New`, doc-type nav (GRN·IQC·IPQC·OQC·Dispatch·Production·NCR), `My Work / All` footer.
- **Top bar** (navy `#0d1b6e`): title "Quality KPIs", period chips `7D / 30D / 90D`, MANAGER role chip, Admin persona pill.
- **KPI grid**: responsive metric cards. Each card = white `surface-container-lowest`, 1px `outline-variant` border, **4px top status strip** (emerald on-target / red below-target / amber warning / gray no-data / blue info), `label-caps` metric name, large mono number, unit, trend/target line.
- **Drill-down**: FPY-by-week bar chart + supplier defect table.

## Metric cards (live data source → `getLandingBundleV3Fast` / KpiConfig.js)
IQC PASS %, FIRST-PASS YIELD, DISPATCH TAT, NCR RESOLVE DAYS, SUPPLIER OTIF, TOP DEFECT, FIFO COMPLIANCE, AGED STOCK >30D, MODULE DWELL, IPQC REJECT %, CUSTOMER RETURN %, NCR QTY AFFECTED.

## Tokens (from design system)
primary `#000747`, primary-container `#0d1b6e`, secondary `#0070f3`; pass=emerald, fail=`#ba1a1a`, warn=amber, no-data=`outline`. Plus Jakarta (headings), Inter (body), Public Sans (labels), mono for numbers. Cards 0.5rem radius; status strips sharp.

## Build notes
Restyles the existing `KPI_F.html` — reuse its server bundle, swap layout/markup to this. No new server fns.
