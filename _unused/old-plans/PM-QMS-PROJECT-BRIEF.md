# Pack Masters QMS — Project Brief

## Overview

**Product:** Pack Masters Quality Management System (QMS)  
**Company:** Pack Masters (packaging manufacturer, Mumbai, India)  
**Platform:** Google Apps Script V8 — bound to Google Sheets + Web App (public URL, no sign-in)  
**Primary Users:** Factory floor operators, QA inspectors, warehouse staff, production supervisors, management  
**Access:** Web app URL (desktop + mobile browser), Apps Script menu in Google Sheets  
**Timezone:** Asia/Kolkata  

---

## Purpose

A full-lifecycle quality management system for a packaging manufacturer. Covers the entire flow from raw material receipt through dispatch to the customer, with integrated NCR (non-conformance) management, KPI dashboards, and inventory ledger.

**Core problem it solves:** Replace manual spreadsheet-based QA tracking with a structured, auditable, form-driven system that enforces workflow order (no GRN before PO, no production issuance before IQC, no dispatch before OQC release), auto-raises NCRs on rejection, and gives management a single-screen KPI view.

---

## User Roles

| Role | Typical Tasks |
|------|--------------|
| **Warehouse / Store Operator** | Raise GRN, issue RM to production, record location transfers |
| **IQC Inspector** | Fill incoming quality inspection form per GRN |
| **Production Supervisor** | Start/close IPQC sessions, record in-process rounds |
| **QA Inspector** | Fill OQC form, raise NCRs, manage dispositions |
| **Dispatch Staff** | Create gatepass, select FIFO FG lots for dispatch |
| **QA Manager** | View KPI dashboard, close NCRs, review KPI drilldown |
| **Admin** | Masters CRUD (suppliers, materials, customers, inspectors, locations), PO management |

---

## Full Workflow (Data Flow)

```
Supplier
  → PO (Purchase Order — optional, but recommended)
  → GRN (Goods Receipt Note — raw material arrives)
  → IQC (Incoming Quality Check — 12-parameter inspection)
      [REJECTED] → NCR Auto-Raised → Disposition (scrap / rework / supplier-return)
      [ACCEPTED] → Stock Ledger (available for production)
  → Production RM Issuance (FIFO multi-lot allocation)
  → IPQC (In-Process QC — session-based rounds during production)
      [OOS Parameter] → NCR Auto-Raised
  → OQC (Outgoing Quality Check — final release decision)
      [REJECTED] → NCR Auto-Raised
      [RELEASED] → FG Dispatch Lots pool created
  → Gatepass / Dispatch (FIFO from FG lots; override requires reason)
  → Customer
      → Customer Return → Triage (RESTOCK / REWORK / SCRAP)
                       → SCRAP / REWORK → NCR Auto-Raised
```

---

## Modules

### 1. GRN — Goods Receipt Note
- Captures raw material receipt from suppliers
- Links to PO (validates PO status: OPEN or PARTIAL_RECEIVED only)
- Auto-fills default storage location from material master
- Writes to STOCK_LEDGER with status PENDING_IQC
- 21 data columns: GRN No., Date, Supplier, PO Ref, Invoice, Material Code/Desc, Batch, Qty Ordered/Received, Unit, COA, Expiry, Remarks, IQC Status, Storage Zone, Location

### 2. IQC — Incoming Quality Control
- Multi-item inspection form per GRN
- 12 standard parameters: Quantity, Packaging, Colour, Shape/Form, Dimensions, Net Weight, Cleanliness, Odour, Label Accuracy, MSDS/SDS, Shelf Life, COA/Test Report
- AQL-based sample size selection
- Auto-raises NCR on REJECTED disposition; back-stamps GRN IQC status
- 30-column log entry

### 3. IPQC — In-Process Quality Control
- Session-based (one session per production run / batch)
- Multiple inspection rounds per session
- Parameters loaded from CONTROL_FG (product-specific control plan with tolerance overrides)
- Weight matrix capture supported
- Session states: OPEN → CLOSED
- Auto-raises NCR on parameter out-of-spec

### 4. OQC — Outgoing Quality Check
- Final release decision for finished goods
- Linked to IPQC session (dropdown of closed IPQC sessions not yet OQC-processed)
- 5 quality checks per item
- RELEASED decision creates FG Dispatch Lots entry (available for dispatch)
- Validates FG storage location is required for RELEASED decision
- Auto-raises NCR on REJECTED

### 5. Dispatch / Gatepass
- FIFO dispatch from FG Dispatch Lots pool
- Non-FIFO override allowed but requires reason (≥5 chars); logged in FG_FIFO_OVERRIDE_LOG
- Lock-guarded to prevent concurrent dispatch race
- One gatepass row per lot (all sharing same GP doc number)
- Updates lot status (AVAILABLE → PARTIAL/DISPATCHED)

### 6. NCR — Non-Conformance Report
- Auto-raised from IQC, IPQC, OQC, Customer Return rejection paths
- Manual raise also supported
- Lifecycle: OPEN → IN_PROGRESS (disposition set) → CLOSED (effectiveness check required)
- Dispositions: rework-FG, rework-RM, scrap, use-as-is, supplier-return
- Effectiveness check: PASS | FAIL | NOT_REQUIRED
- Full audit trail in NCR_HISTORY

### 7. Purchase Orders (POP)
- PO lifecycle: DRAFT → OPEN → PARTIAL_RECEIVED → CLOSED | CANCELLED
- Multi-line POs (multiple materials per PO)
- GRN receipts auto-applied to PO lines (idempotent, lock-free)
- Header status auto-derived from line statuses
- `reconcilePOReceipts` self-heal utility available

### 8. Warehouse / Stock Ledger
- Single source of truth for all inventory movements
- FIFO by GRN receipt date
- All transactions append to STOCK_LEDGER: GRN_RECEIPT, IQC_ACCEPT, IQC_REJECT, RM_ISSUE, OQC_RELEASE, LOCATION_TRANSFER, SCRAP, SAMPLE
- Balance computed cumulatively per lot (material + batch + location)
- Location types: RM-STORE, FG-STORE, QUARANTINE, SCRAP, SAMPLE, FG-HOLD
- RM issuance gated: IQC ACCEPTED + non-quarantine location + sufficient balance

### 9. Customer Returns
- Captures returned FG (linked to gatepass)
- Auto-enters QUARANTINE on receipt with status PENDING_TRIAGE
- Triage dispositions: RESTOCK (pull from quarantine → FG-STORE) | REWORK (→ FG-HOLD + NCR) | SCRAP (log + NCR)

### 10. KPI Dashboard
- 5 metrics computed per period (THIS_MONTH default | LAST_30 | LAST_90 | THIS_FY | CUSTOM):
  - **FPY%** (First Pass Yield): IQC pass rate; HOLD = fail
  - **NCR Count**: Open NCRs by source (IQC / IPQC / OQC / Customer)
  - **Supplier Defect%**: PO-attached GRN rejection rate
  - **Customer Return Rate%**: Returns within 60 days of dispatch
  - **OTD%** (On-Time Delivery): PO lines delivered ≤ promised date
- Thresholds: FPY Green ≥95% / Amber ≥90%; Defect Amber <2% / Red ≥5%; OTD Green ≥90% / Amber ≥80%; Return Amber <1% / Red ≥3%; NCR Red ≥10 open
- Cache with stampede guard (script cache, TTL-based)
- Drill-down per metric

### 11. Masters
- CRUD for: Suppliers, Materials (RM + FG), Customers, Inspectors/Personnel, Locations
- Material master includes: category (RM/FG), default storage location
- QA Parameters library (22 standard parameters: GSM, Thickness, Print Quality, Seal Strength, etc.)
- Control Plans: per-product (FG control plan with tolerance overrides per parameter)

### 12. Document Numbering
- Thread-safe auto-increment via LockService
- Doc types: GRN, IQC, OQC, NCR, GP (Gatepass), RTN (Return), SCR (Scrap), SMP (Sample), PO, PROD
- Format: `PM/GRN/2026-001`

### 13. WhatsApp Notifications
- Pre-filled wa.me links (no API, zero cost)
- Message types: GRN receipt, IQC result, OQC result
- Status emoji mapping (ACCEPTED→✅, REJECTED→❌, HOLD→⏸️, PENDING→⏳)
- Triggered post-save from forms

### 14. Dashboard / Landing
- Landing page shows: today's GRN count, IQC count, OQC count, pending actions (GRN→IQC, OQC→Gatepass, open IPQC sessions)
- Records view: filterable by type (ALL / GRN / IQC / OQC / GP / IPQC) and date range (TODAY / WEEK / MONTH / ALL)
- Deduplicates multi-item records (shows one row per doc number)

---

## Screens / UI Forms

| Screen | Type | Purpose |
|--------|------|---------|
| Landing | Web App Page | Today's counts, pending action alerts |
| Dashboard | Modal/Sidebar | Filterable records view |
| GRN Form | Modal | Multi-item goods receipt entry |
| IQC Form | Modal | 12-param inspection matrix per GRN |
| IPQC Form | Modal | Session start, round recording, session close |
| OQC Form | Modal | Final release decision per FG batch |
| Dispatch Form | Modal | FIFO lot selection, gatepass creation |
| NCR Form | Modal | NCR list, disposition, closure |
| PO Form | Modal | Multi-line PO entry and management |
| Masters Form | Web App Page | Suppliers / Materials / Customers / Personnel / Locations CRUD |
| Records View | Web App Page | Cross-module document log with filters |
| KPI Dashboard | Web App Page | 5 KPI tiles + sparklines + drill-down |
| Customer Return Form | Modal | Return capture + triage disposition |
| Warehouse View | Web App Page | Stock ledger, location management |
| Control Plan Form | Modal | Per-product IPQC parameter setup |

---

## Key Sheets (Data Model)

| Sheet | Purpose |
|-------|---------|
| CONFIG | Doc counters, KPI thresholds, system flags |
| GRN_LOG | All goods receipts (21 cols) |
| IQC_LOG | Incoming inspections (30 cols) |
| IPQC_Sessions | Production QC sessions |
| IPQC_LOG | Per-round, per-parameter inspection entries |
| OQC_LOG | Outgoing quality check (23 cols) |
| GATEPASS_LOG | Dispatch records per FG lot |
| NCR_LOG | Non-conformance reports |
| NCR_HISTORY | NCR lifecycle audit trail |
| STOCK_LEDGER | All inventory movements (13 cols, append-only) |
| FG_DISPATCH_LOTS | Released FG lots pool (FIFO source for dispatch) |
| FG_FIFO_OVERRIDE_LOG | Non-FIFO dispatch audit |
| PO_HEADER | Purchase order headers (17 cols) |
| PO_LINES | Purchase order line items (13 cols) |
| PROD_ISSUE_LOG | RM issuance to production |
| CUSTOMER_RETURN_LOG | Customer returns (18 cols) |
| SCRAP_LOG | Scrapped material records |
| SAMPLE_LOG | Sample withdrawals |
| LOCATIONS | Location master (12 cols) |
| MASTERS_Suppliers | Supplier master |
| MASTERS_Materials | Material master (RM + FG, with default location) |
| MASTERS_Customers | Customer master |
| MASTERS_Personnel | Inspector / staff master |
| MASTERS_Parameters | QA parameter library (22 params) |
| CONTROL_FG | FG product control plans (per-parameter tolerances) |

---

## Design Constraints & Context

- **No external DB** — Google Sheets is the database; all reads/writes via Apps Script SpreadsheetApp API
- **No authentication UI** — Web app is ANYONE_ANONYMOUS; operator identity captured via dropdown (inspector / created-by fields), not login
- **Mobile-first awareness** — Factory floor users access forms on phones (Android); forms must work on small screens
- **India context** — All dates in DD/MM/YYYY, currency INR, units in kg/pcs/rolls/bags, GST-standard invoice fields
- **Offline resilience not needed** — All users on factory WiFi; no offline mode required
- **Minimal training required** — Users are not tech-savvy; UI must be icon-assisted, status-colored, and step-guided
- **Color coding is critical** — ACCEPTED=green, REJECTED=red, HOLD=yellow, PENDING=amber/orange is a hard convention users expect
- **Form modals** — Most data entry happens in HTML modal dialogs opened from the Google Sheets menu or from the web app
- **Print** — Gatepass and GRN receipt need to be printable (clean print layout)

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Google Apps Script (V8, server-side JS) |
| Database | Google Sheets (18 log/master/config sheets) |
| Frontend | HTML + CSS + vanilla JS served via HtmlService |
| Hosting | Google Apps Script Web App (script.google.com) |
| Notifications | wa.me pre-filled links (no API) |
| Auth | None (ANYONE_ANONYMOUS web app) |
| Deployment | clasp push (local → Apps Script) |
| Version control | Git → GitHub (packmastersmumbai/qms) |

---

## Validation Suite Status (as of 2026-05-17)

All 7 phases complete and production-deployed:

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | smokeFullChain — end-to-end happy path | ✅ |
| 2 | Diagnostics (POP / Ledger / KPI diag) | ✅ |
| 3 | runLedgerReconcile | ✅ |
| 4 | Reject-path smokes (IQC / OQC / IPQC OOS) | ✅ |
| 5 | Permissions audit — _TESTING_ENABLED gate on all test/admin functions | ✅ |
| 6 | KPI tie-out — 5 KPIs verified against raw sheets | ✅ |
| 7 | Restore drill — corrupt/detect/restore/verify cycle | ✅ |

`CONFIG._TESTING_ENABLED = false` — all test/admin/diagnostic functions are locked out in production.
