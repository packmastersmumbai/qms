# Product Requirements Document
## Pack Masters QMS — Quality Management System

**Version:** 1.1  
**Date:** 2026-06-11  
**Status:** Implemented — Live at @299  
**Owner:** Pack Masters (packmasters.mumbai@gmail.com)

---

## 1. Executive Summary

Pack Masters QMS is a mobile-first Quality Management System for a packaging manufacturer. It digitises the end-to-end quality chain — from raw material goods receipt through in-process checks, outbound quality control, and dispatch — replacing paper-based tracking with a live, cloud-backed system. Built entirely on Google Apps Script with Google Sheets as the database, it is accessed via a single URL with no installation required.

---

## 2. Problem Statement

Pack Masters operates a manufacturing facility producing packaging goods. Before this system:

- Goods receipt, IQC, IPQC, OQC, dispatch, and NCR workflows were tracked on paper or in disconnected spreadsheets.
- There was no single view of pending work across quality modules.
- Rework, customer returns, and NCR closure had no formal digital trail.
- Management had no real-time KPIs for supplier quality, production yield, or dispatch TAT.
- Traceability across a batch's lifecycle (GRN → IQC → Production → OQC → Dispatch) was manual and error-prone.

---

## 3. Goals & Success Metrics

| Goal | Metric |
|---|---|
| Digitise all quality touchpoints | All 8 modules active with real data |
| Reduce time to raise NCR | NCR created in <2 min from IQC/IPQC |
| Enable lot traceability | Trace any batch from GRN to dispatch in 1 search |
| Provide live KPI visibility | Dashboard loads KPIs in <3 seconds |
| Support mobile-first usage | Fully usable on Android/iOS without app install |

---

## 4. Users & Roles

| Role | Primary Modules | Access Pattern |
|---|---|---|
| Store / Receiving | GRN, Warehouse | Mobile, daily |
| QC Inspector | IQC, IPQC, OQC | Mobile, per-inspection |
| Production Supervisor | Production, IPQC | Mobile, per-shift |
| Dispatch Executive | Dispatch, Gatepass | Mobile, per-dispatch |
| Quality Manager | NCR, Records, Masters, KPI Dashboard | Desktop + mobile |
| Management | Dashboard, KPI | Desktop, periodic |

No authentication granularity is implemented — all roles share one URL. Access control is by convention, not enforcement.

---

## 5. System Architecture

### 5.1 Stack

| Layer | Technology |
|---|---|
| Backend / Logic | Google Apps Script (V8 runtime) |
| Data Store | Google Sheets (15+ named sheets) |
| Frontend | Vanilla HTML/CSS/JS served via GAS `HtmlService` |
| Hosting (outer shell) | GitHub Pages (`packmastersmumbai.github.io/qms`) |
| Deploy tool | `clasp` (Google Apps Script CLI) |
| Design system | Custom CSS tokens (`--pm-*`), Inter + Plus Jakarta Sans + JetBrains Mono |

### 5.2 Deployment Model

GitHub Pages hosts a single full-screen `<iframe>` wrapper that points to the live GAS deployment URL. Versioned GAS deployments allow instant rollback by updating the iframe `src`. The `<meta viewport>` tag lives in the GitHub Pages shell because the GAS outer iframe provides none.

### 5.3 Data Architecture

All data persists in a single Google Spreadsheet. Key sheets:

| Sheet | Purpose |
|---|---|
| `GRN_LOG` | Goods Receipt Notes |
| `IQC_LOG` | Incoming Quality Control inspections |
| `IPQC_LOG` | In-Process Quality Control sessions + rounds |
| `OQC_LOG` | Outgoing Quality Control results |
| `PRODUCTION_LOG` | Production jobs (issue → in-progress → completed) |
| `DISPATCH_LOG` | Dispatch orders |
| `GATEPASS_LOG` | Physical gatepass records |
| `FG_DISPATCH_LOTS` | Finished-goods lot inventory (AVAILABLE/PARTIAL/DISPATCHED/NEEDS_REVIEW/RECALLED) |
| `NCR_LOG` | Non-Conformance Reports |
| `REWORK_LOG` | Rework jobs (sourced from NCR / Customer Returns) |
| `CUSTOMER_RETURN_LOG` | Customer return records |
| `MASTERS_Items` | Item master (RM + FG) |
| `MASTERS_Customers` | Customer master |
| `MASTERS_Suppliers` | Supplier master (code, name, material, city, email, approved) |
| `MASTERS_Locations` | Warehouse location master |
| `STOCK_LEDGER` | All inventory movements (RM + FG + WIP + Quarantine + Rework) |

---

## 6. Module Specifications

### 6.1 Dashboard (Landing)

**Purpose:** Single-screen overview of pending work + KPI summary.

**Tiles:**
- Pending counts for: GRN, IQC, IPQC, OQC, Dispatch, NCR, Rework
- KPIs: IQC Pass Rate, First-Pass Yield (FPY), Dispatch TAT, NCR Resolution TAT, Supplier OTIF
- Quick-action buttons to each module

**Data source:** `getLandingBundleV3Fast` — single GAS call returning all counts + KPIs in one bundle, cached.

**UX:** Mobile-first card grid. Fixed top bar (navy, `#0D1B6E`). Fixed bottom nav. Loads in <3 seconds via cache.

---

### 6.2 GRN — Goods Receipt Note

**Purpose:** Record receipt of raw materials from suppliers.

**Key fields:** GRN No. (auto-generated `PM/GRN/YYYY-NNN`), Supplier, Item, Batch No., Qty Received, UoM, PO Reference, Received By, Date.

**Status lifecycle:** `OPEN` → `CLOSED` (auto-closes when all line items have a final IQC disposition).

**DocView integration:** GRN detail screen shows all linked IQC records as a table with disposition chips (ACCEPTED / REJECTED / HOLD).

**Print:** Printable GRN format via `PrintGRN_F.html`.

---

### 6.3 IQC — Incoming Quality Control

**Purpose:** Inspect received material against quality parameters.

**Key fields:** IQC No. (`PM/IQC/YYYY-NNN`), linked GRN No., Item, Batch, Inspector, Test parameters (dimensions, visual, lab results), Sample Size, Pass/Fail per parameter, Overall Disposition (ACCEPTED / REJECTED / HOLD).

**Disposition outcomes:**
- `ACCEPTED` → material available for production
- `REJECTED` → material quarantined; NCR auto-raised
- `HOLD` → pending further review

**GRN closure trigger:** When all GRN line items have a final IQC disposition, the GRN status sets to `CLOSED` with a `closedAt` timestamp.

**Email report (P5):** After saving an IQC result, the inspector can send a quality report to the supplier via GAS `MailApp`. Button appears in footer post-save. Requires supplier email in MASTERS_Suppliers.

**Print:** `PrintIQC_F.html`.

---

### 6.4 IPQC — In-Process Quality Control

**Purpose:** Monitor quality during production runs via multi-round inspection sessions.

**Structure:** One IPQC Session per production run → multiple Rounds. Each round records quality parameters, weight checks, and visual inspection results.

**Key fields:** Session ID, Production Job No., Product, Line, Shift, Operator, Round No., Time, Parameters (per Control Plan), Status (OPEN / CLOSED).

**Gate:** OQC form cannot be submitted until the IPQC session for the corresponding production job is CLOSED.

**Print:** `PrintIPQC_F.html`.

---

### 6.5 OQC — Outgoing Quality Control

**Purpose:** Final quality gate before finished goods are dispatched.

**Key fields:** OQC No. (`PM/OQC/YYYY-NNN`), linked Production Job, Item, Batch, Inspector, Release Decision (RELEASED / REJECTED / CONDITIONAL), Notes.

**Gate enforcement:** Blocked if the IPQC session for the production job is not closed.

**Effect on inventory:** RELEASED lots enter `FG_DISPATCH_LOTS` as `AVAILABLE`.

**Print:** `PrintOQC_F.html`.

---

### 6.6 Production

**Purpose:** Track production jobs from material issue through completion.

**Status lifecycle:**
- `PENDING` → created
- `IN_PROGRESS` → material issued from stock (`PROD_ISSUE` ledger entry)
- `COMPLETED` → production booked (`PROD_BOOK` ledger entry, FG added to WIP/FG stock)

**Key fields:** Job No., Product, Planned Qty, Actual Qty, BOM (RM consumption per FG unit), Issued Materials, Booked Output, Operator, Shift.

**Fix shipped:** `PROD_CONSUME` entries previously wrote `qtyOut=0`; fixed to write actual consumed qty.

---

### 6.7 Dispatch

**Purpose:** Create dispatch orders and gate passes for outbound finished goods.

**FIFO lot selection:** `FG_DISPATCH_LOTS` are consumed in FIFO order. Partial lots are supported (status → `PARTIAL`).

**Key fields:** Dispatch No., Customer, Items + Qty, Lot allocation, Vehicle No., Driver, Transporter.

**Gatepass:** Auto-generated alongside dispatch. Physical gatepass printable from `Gatepass_F.html`.

**Lot statuses:** `AVAILABLE` → `PARTIAL` → `DISPATCHED`. Lots can also be `NEEDS_REVIEW` or `RECALLED`.

---

### 6.8 Warehouse / Stock View

**Purpose:** Real-time inventory view across all stock categories.

**7 tabs:**
| Tab | Content |
|---|---|
| RM | Raw Material stock (received, IQC-accepted) |
| FG | Finished Goods (OQC-released, available for dispatch) |
| WIP | Work-in-Progress (issued to production, not yet booked) |
| Quarantine | Rejected / HOLD material pending disposition |
| Rework | Items in active rework jobs |
| Moves | Stock movement ledger (all transactions) |
| Locs | Warehouse locations and their contents |

**Age colouring:** Items older than threshold get visual age indicators.

**Data source:** `getStockView()` — computes all tabs from `STOCK_LEDGER`.

---

### 6.9 NCR — Non-Conformance Report

**Purpose:** Formal record of quality failures at any stage.

**Sources:** IQC (rejected material), IPQC (out-of-spec round), OQC (rejected lot), manual raise.

**Status lifecycle:** `OPEN` → `IN_PROGRESS` → `CLOSED`.

**Key fields:** NCR No., Source Module, Source Doc No., Item, Batch, Description, Root Cause, Corrective Action, Closure Date, Closed By.

**Rework trigger:** NCR can escalate to a Rework job, moving material to `REWORK-AREA` in the stock ledger.

---

### 6.10 Rework

**Purpose:** Track rework jobs for non-conforming material.

**Sources:** NCR (RM or FG) and Customer Returns (FG).

**Key fields:** Rework Job No., Source (NCR / Customer Return), Source Doc No., Item, Batch, `materialType` (FG or RM), Assigned To, Status, Outcome (REWORKED / SCRAPPED).

**materialType field:** Stored at col 19 of `REWORK_LOG`. Used by `Rework_F.html` to show FG-specific vs RM-specific rework actions. Backward-safe: existing rows with blank col 19 fall back to heuristic detection.

---

### 6.11 Customer Returns

**Purpose:** Log and triage returned goods from customers.

**Key fields:** Return No., Customer, Invoice No., Item, Batch, Qty, Return Reason, Disposition (REWORK / SCRAP / REPLACE).

**Rework trigger:** Dispositioned as REWORK → creates Rework job with `materialType='FG'`.

---

### 6.12 Records View

**Purpose:** Searchable, filterable list of all transactions across all modules.

**Tabs:** All, GRN, IQC, IPQC, OQC, Production, Dispatch, NCR, Rework, Customer Returns.

**Features:** 200-record default view, filter by module, card-based layout, tap to open detail.

---

### 6.13 Trace

**Purpose:** End-to-end lot traceability — enter any document number and trace its full lifecycle.

**Supported inputs:** GRN No., IQC No., IPQC Session, OQC No., Production Job No., Dispatch No., NCR No., Batch No.

**Output:** Chronological chain showing all related documents and status transitions.

---

### 6.14 Masters

**Purpose:** Manage reference data used across all modules.

**Sub-tabs:**
- **Items** — Item code, description, type (RM / FG / WIP), UoM, HSN
- **Suppliers** — Supplier code, name, material supplied, city, email, approved (Y/N)
- **Customers** — Customer code, name, contact, city
- **Locations** — Warehouse location codes and descriptions

---

### 6.15 KPI Dashboard

**Purpose:** Management-level quality performance view.

**KPIs displayed:**
| KPI | Formula |
|---|---|
| IQC Pass Rate | Accepted IQC / Total IQC × 100 |
| First-Pass Yield (FPY) | IPQC sessions with 0 defects / Total sessions × 100 |
| Dispatch TAT | Avg days from OQC release to Dispatch |
| NCR Resolution TAT | Avg days from NCR open to CLOSED |
| Supplier OTIF | On-time + In-full GRNs / Total GRNs × 100 |

---

## 7. Cross-Cutting Features

### 7.1 Document Numbering

All documents use the format `PM/{MODULE}/{YYYY}-{NNN}` with year-scoped sequential counters managed by `DocNumber.js`.

### 7.2 Pending Counts & Badges

`computePendingCounts_(ss)` in `Code.js` is the single source of truth for all module badge counts shown on the dashboard and bottom nav. Called once per landing load via the V3Fast bundle.

### 7.3 Print Views

Dedicated print-optimised HTML files for GRN, IQC, OQC, IPQC. Opened as popups from their respective form footers.

### 7.4 Control Plan

`ControlPlan_F.html` / `ControlPlan.js` — defines quality parameters per product, referenced during IPQC round recording.

### 7.5 Deep Links

Any document is openable directly via `?doc=PM/{MODULE}/{YYYY}-{NNN}` on the live URL. The GitHub Pages shell forwards the `?doc=` query param into the GAS iframe `src`; `DocView_F.html` derives the document type client-side from the doc number (`PM/IQC/2026-189` → `IQC`) so the deep link resolves without a server type hint. Enables QR codes and shared links to land on a specific record.

### 7.6 Stock Ledger

All inventory movements (RM receipt, IQC quarantine, production issue, production booking, OQC lot creation, dispatch, rework issue/return) write to `STOCK_LEDGER` with a standardised entry structure: `{txnType, itemCode, batchNo, locationCode, qtyIn, qtyOut, ref, date, operator}`.

---

## 8. UX & Design System

| Token | Value | Usage |
|---|---|---|
| `--pm-navy` | `#0D1B6E` | Top bar, primary buttons |
| `--pm-sky` | `#0070F3` | Links, active states |
| `--pm-bg` | `#F5F7FA` | Page background |
| `--pm-pass` | `#16A34A` | ACCEPTED / PASS chips |
| `--pm-fail` | `#DC2626` | REJECTED / FAIL chips |
| `--pm-warn` | `#F97316` | HOLD / WARNING chips |
| `--pm-prog` | `#2563EB` | IN_PROGRESS chips |

**Typography:** Plus Jakarta Sans (headings), Inter (body), JetBrains Mono (codes, numbers).

**Layout:** Mobile-first, max-width 430px. Fixed top bar (48px) + fixed bottom nav (56px). Content scrolls between them. Desktop: two-pane at ≥1024px.

**Navigation:** Bottom nav with 5 fixed slots + overflow menu. Each slot shows pending badge count.

---

## 9. Known Gaps & Open Items

| # | Item | Priority | Notes |
|---|---|---|---|
| 1 | Supplier email field in Masters UI | Medium | `saveMaster` / `getSuppliers` handles email server-side; `MastersCrud_F.html` form not yet updated with Email input |
| 2 | sendIQCReport end-to-end test | Medium | Requires at least one supplier to have email populated in MASTERS_Suppliers sheet |
| 3 | MASTERS_Suppliers backward compat | Low | Old rows (no email col) use `r[6]` for approved; new rows use `r[7]`. Double-check `r[7]==='Y' \|\| r[6]==='Y'` handles both |
| 4 | Role-based access control | Low | All users share one URL; no per-role permissions |
| 5 | Offline support | Not planned | GAS web apps require connectivity |
| 6 | PO / Purchase Order module | Not implemented | `POP_F.html` exists as a stub |
| 7 | Supplier Scorecard | Not implemented | Design exists in `stitchhtml/Supplier_Scorecard.html`; not wired to live data |
| 8 | WhatsApp notifications | Stub | `WhatsApp.js` exists; not integrated |
| 9 | Import CSV | Stub | `ImportCSV.js` / `ImportCSV_F.html` exist; not in active use |

---

## 10. Technical Constraints

- **No Node runtime in production** — all server code is GAS (V8). No npm packages available server-side.
- **Cross-origin double-iframe** — GitHub Pages → `script.googleusercontent.com`. `window.parent.document` is blocked. `@media (hover:none)` is unreliable on Android.
- **`google.script.run` is async** — no synchronous server calls. All server interactions use `.withSuccessHandler()`.
- **GAS execution limit** — 6 minutes max per call. Bulk operations (backfill, import) must be batched.
- **Sheet-as-database limits** — no transactions, no foreign key enforcement, no concurrent write protection. All consistency is maintained by application logic.
- **Cache TTL** — `CacheService` used for the V3Fast landing bundle. Cache key must be versioned when bundle shape changes.

---

## 11. Deployment & Operations

| Item | Detail |
|---|---|
| Live URL | `https://packmastersmumbai.github.io/qms` |
| GAS Script ID | `1gDN0dO6rsiE55Yu9bV9dgVFhtfoMyKmXWCy8B0-bAspjl_7o7hMRgtiQ` |
| Current live version | @299 |
| Rollback version | @222 |
| Deploy command | `clasp push && clasp deploy --deploymentId AKfycbxMFpeJOqF5_... --description "type: description"` |
| GAS owner account | `packmasters.mumbai@gmail.com` |
| Rollback procedure | Update GitHub Pages `index.html` iframe `src` to rollback deployment URL |

---

## 12. Appendix — Module → Sheet Mapping

| Module | Reads | Writes |
|---|---|---|
| GRN | MASTERS_Suppliers, MASTERS_Items | GRN_LOG, STOCK_LEDGER |
| IQC | GRN_LOG, MASTERS_Items | IQC_LOG, GRN_LOG (status), STOCK_LEDGER |
| IPQC | PRODUCTION_LOG, MASTERS_Items, ControlPlan | IPQC_LOG |
| OQC | IPQC_LOG, PRODUCTION_LOG | OQC_LOG, FG_DISPATCH_LOTS, STOCK_LEDGER |
| Production | MASTERS_Items, STOCK_LEDGER | PRODUCTION_LOG, STOCK_LEDGER |
| Dispatch | FG_DISPATCH_LOTS, MASTERS_Customers | DISPATCH_LOG, GATEPASS_LOG, FG_DISPATCH_LOTS |
| Warehouse | STOCK_LEDGER, MASTERS_Locations | — (read-only view) |
| NCR | IQC_LOG, IPQC_LOG, OQC_LOG | NCR_LOG |
| Rework | NCR_LOG, CUSTOMER_RETURN_LOG | REWORK_LOG, STOCK_LEDGER |
| Customer Returns | MASTERS_Customers, MASTERS_Items | CUSTOMER_RETURN_LOG |
| Records | All LOG sheets | — (read-only view) |
| Trace | All LOG sheets | — (read-only view) |
| Masters | All MASTERS_ sheets | All MASTERS_ sheets |
