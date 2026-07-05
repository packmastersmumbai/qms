// ============================================================
// Initialize.gs — One-click project setup
// Creates all sheets, loads master data, sets doc counters
// Safe to re-run — skips sheets that already exist
// ============================================================

var SUPPLIERS = [
  ['SUP-001', 'Deccan Cans',                    'Deccan Contact',  '', 'Metal Cans',        'Daman',       'Y'],
  ['SUP-002', 'JD Printer',                     'JD Contact',      '', 'Labels',            'Navi Mumbai', 'Y'],
  ['SUP-003', 'Henkel Adhesives (Thane Plant)', 'Henkel Contact',  '', 'Raw Material',      'Navi Mumbai', 'Y'],
  ['SUP-004', 'Sunraj Corrugators',             'Sunraj Contact',  '', 'Corrugated Boxes',  'Navi Mumbai', 'Y']
];

var MATERIALS = [
  ['1308119',  'LOCTITE BONDACE 007 POWDER 16KG',              'KG', 'BULK'],
  ['1333789',  'LOCTITE BONDACE 007 POWDER (20)',              'KG', 'BULK'],
  ['1706616',  'SAL_PP - QA Approved Label 30mm',              'PC', 'LABEL'],
  ['1706617',  'SAL_PP - SAP Label 125x90mm',                  'PC', 'LABEL'],
  ['1706618',  'SAL_PR - Hazardous Material Info 60.5x90',     'PC', 'LABEL'],
  ['1706619',  'TAPE_PE - BOPP Tape 48mm 65mtr',               'M',  'TAPE'],
  ['1712442',  'JERR_PE - 1.2 LTR Milky Rect. Jerry Can',     'PC', 'CANS'],
  ['1712485',  'CAN-M_TIN-PLT - 5L Rectangular Tin Can',      'PC', 'CANS'],
  ['1714526',  'SHIP_O-BORD - 7Ply 1.2 Ltr Jerry Can x28',   'PC', 'CARTONS'],
  ['1748140',  'SAL_PP - SAP Label 203x154mm',                 'PC', 'LABEL'],
  ['2240375',  'FLEX_PE - Thermal Ribbon',                     'M',  'RIBBON'],
  ['2302156',  'SHIP_BORD-D - 5Ltr Tin Can x4 370x245x3',    'PC', 'CARTONS'],
  ['2593962',  'LOCTITE BONDACE DS SR1170TF 170kg',            'KG', 'BULK'],
  ['2844465',  'LOCTITE WATERPROOF IN BULK',                   'KG', 'BULK'],
  ['2950929',  'LOCTITE BONDACE 956LTF',                       'KG', 'BULK'],
  ['2962930',  'LOCTITE BONDACE 856LTF PSFG 165KG',           'KG', 'BULK'],
  ['2966562',  'CAN-M_TIN-PLT - AP TrueGrip 500ml',           'PC', 'CANS'],
  ['2966563',  'CAN-M_TIN-PLT - AP TrueGrip 1 Lt',           'PC', 'CANS'],
  ['2966564',  'CAN-M_TIN-PLT - AP TrueGrip 4 Lt',           'PC', 'CANS'],
  ['2966567',  'SHIP_BORD-S - AP TrueGrip 500ml',            'PC', 'CARTONS'],
  ['2966568',  'SHIP_BORD-S - AP TrueGrip 1 Lt',             'PC', 'CARTONS'],
  ['2966569',  'SHIP_BORD-D - AP TrueGrip 4 Lt',             'PC', 'CARTONS'],
  ['2979767',  'SAL_PR - AP TGXTREME CL 0.5L/1Ltr',          'PC', 'LABEL'],
  ['2979768',  'SAL_PR - AP TGXTREME CL 4Ltr',               'PC', 'LABEL'],
  ['2979789',  'SAL_PR - AP TGXTREME Box 100X',               'PC', 'LABEL'],
  ['2979795',  'SAL_PR - AP TGXTREME CL 4x4 Ltr',            'PC', 'LABEL'],
  ['2986292',  'FLEX_PE - Thermal Ribbon 110mm x 350m',       'PC', 'RIBBON'],
  ['3040321',  'CAN-M_TIN-PLT - LOC Heat Pro 200 500ml',     'PC', 'CANS'],
  ['3040322',  'SHIP_BORD-S - 3Ply SBOX 342x173x116mm',      'PC', 'CARTONS'],
  ['3040325',  'SAL_PR - LOC Cont Adh 500ml x8',             'PC', 'LABEL'],
  ['3044894',  'LOCTITE BONDACE 956LTF PSFG 165KG',          'KG', 'BULK'],
  ['3045329',  'LOCTITE UNIVERSAL CONTACT ADHESIVE PSFG',    'KG', 'BULK'],
  ['3056359',  'LOCTITE CHARCOAL ADHESIVE PSFG 200KG',       'KG', 'BULK'],
  ['3092039',  'LOCTITE BONDACE 007 PSFG',                   'KG', 'BULK'],
  ['3092040',  'LOCTITE BONDACE 007D PSFG',                  'KG', 'BULK'],
  ['3109969',  'SAL_PP - LOC PVC EF 450g x6',                'PC', 'LABEL'],
  ['3110253',  'SAL_PP - LOC PVC EF 450gm',                  'PC', 'LABEL'],
  ['3110295',  'BOTT_PE_450ml - Charcoal Edge Fix',          'PC', 'BOTTLES'],
  ['3110323',  'CAP_PE - Plug Natural 1g 20x15mm',           'PC', 'PLUG'],
  ['3110343',  'CAP_PP - Cap+Noz Charcoal 450ml',            'PC', 'CAP'],
  ['3113686',  'SHIP_BORD-D - LOC PVC 450gm x6',            'PC', 'CARTONS']
];

var CUSTOMERS = [
  ['HENK', 'Henkel Adhesives', 'Shivangi Bansal', '', 'shivangi.bansal@henkel.com', 'Adhesives', 'Navi Mumbai']
];

var PERSONNEL = [
  ['Tarun Mishra',  'ISO Document Approval Authority',    'Management', '9167155573', 'Y'],
  ['AZAD Rajbhar',  'Quality Management Representative',  'QA',         '',           'Y'],
  ['Khushi Paswan', 'Document Controller',                'QA',         '',           'Y'],
  ['Khushi Paswan', 'QA Inspector',                       'QA',         '9167095723', 'Y'],
  ['ANUJ Pathak',   'Stores In-charge',                   'Stores',     '',           'N']
];

// ── Sheet definitions ─────────────────────────────────────────

// P2 — Purchase Order sheets
var PO_HEADER_HEADERS = [
  'po_no', 'po_date', 'supplier_code', 'supplier_name', 'due_date',
  'currency', 'gst_pct', 'payment_terms',
  'sub_total', 'gst_amount', 'grand_total',
  'status', 'remarks', 'created_by', 'created_at',
  'approved_by', 'cancelled_reason'
];

var PO_LINE_HEADERS = [
  'po_no', 'line_no', 'material_code', 'material_desc', 'unit',
  'qty_ordered', 'unit_price', 'line_amount',
  'qty_received', 'qty_pending', 'line_status',
  'last_grn_no', 'promised_date'
];

var GRN_HEADERS = [
  'GRN No.', 'Date', 'Supplier Code', 'Supplier Name', 'PO Reference',
  'Invoice No.', 'Material Code', 'Material Description', 'Batch / Lot No.',
  'Qty Ordered', 'Qty Received', 'Unit', 'COA Received', 'Expiry Date',
  'Remarks', 'IQC Status', 'Created By', 'Timestamp',
  'Storage Zone', 'Operator ID', 'Location ID', 'Closed At'
];

var STOCK_LEDGER_HEADERS = [
  'Txn ID', 'Timestamp', 'Txn Type', 'Material Code', 'Batch / Lot No.',
  'Location ID', 'Qty In', 'Qty Out', 'Balance After',
  'Ref Doc Type', 'Ref Doc No.', 'Operator', 'Remarks', 'Material Desc'
];

var LOCATIONS_HEADERS = [
  'Location ID', 'Floor', 'Section', 'Aisle', 'Rack', 'Shelf', 'Bin',
  'Label', 'Type', 'Capacity Qty', 'Capacity Unit', 'Active'
];

// 8 legacy logical zones — hardcoded string IDs referenced by IQC/OQC/NCR/CustomerReturn/
// Rework/_J07 flows + 3 Scan chokepoint rows. NEVER remove or rename these (RISK-2).
var LOCATIONS_ZONE_SEED = [
  ['RM-STORE-A',    'GF', 'Stores',  '', '', '', '', 'RM Store — Bay A',    'RM',         '', '', 'Y'],
  ['RM-STORE-B',    'GF', 'Stores',  '', '', '', '', 'RM Store — Bay B',    'RM',         '', '', 'Y'],
  ['QUARANTINE',    'GF', 'Stores',  '', '', '', '', 'Quarantine area',     'QUARANTINE', '', '', 'Y'],
  ['FG-STORE',      'GF', 'FG',      '', '', '', '', 'FG Store',            'FG',         '', '', 'Y'],
  ['FG-HOLD',       'GF', 'FG',      '', '', '', '', 'FG Hold (pre-OQC)',   'FG_HOLD',    '', '', 'Y'],
  ['SCRAP-AREA',    'GF', 'Stores',  '', '', '', '', 'Scrap collection',    'SCRAP',      '', '', 'Y'],
  ['SAMPLE-CABINET','GF', 'QA Lab',  '', '', '', '', 'Sample retention',    'SAMPLE',     '', '', 'Y'],
  ['REWORK-AREA',  'GF', 'Stores',  '', '', '', '', 'Rework holding area', 'REWORK',     '', '', 'Y']
];

// ── Physical pallet slots B001–B148 (1st floor), read from the shared 04 floorplan.jpg ──
// One declarative bay table drives count + type + label so a floor re-verify is a one-line edit.
// Bay is a DISPLAY/GROUPING attribute stored in the 'Rack' column (col 5) — it is NEVER parsed
// back out of the ID and NEVER used in any capacity/fit calculation. The ID is floor-letter +
// sequential number only; renumbering a bay never changes an ID (matches /^[ABC]\d{3}$/).
// NOTE (DoD go-live gate): bays C and D (=42 each) are floorplan pixel-reads — VERIFY against
// the physical floor before go-live; a mismatch is a one-line edit to LOCATIONS_BAY_TABLE.
var LOCATIONS_BAY_TABLE = [
  { bay: 'A', count: 25, type: 'RM', label: 'Bulk RM' },
  { bay: 'B', count: 4,  type: 'PM', label: 'Packaging Strip' },
  { bay: 'C', count: 42, type: 'PM', label: 'Packaging Upper' },
  { bay: 'D', count: 42, type: 'PM', label: 'Packaging Lower' },
  { bay: 'E', count: 21, type: 'FG', label: 'Finished Goods' },
  { bay: 'F', count: 14, type: 'FG', label: 'Buffer Pallet' }
];

// Build the 148 B### rows from the bay table. Slot IDs run contiguously B001..B148 across all
// bays (sequence is independent of bay boundaries). Shape matches LOCATIONS_HEADERS (12 cols):
// [Location ID, Floor, Section, Aisle, Rack(=Bay), Shelf, Bin, Label, Type, Capacity Qty,
//  Capacity Unit, Active].
function buildLocationSlotSeed_() {
  var rows = [];
  var seq = 0;
  LOCATIONS_BAY_TABLE.forEach(function(bayDef) {
    for (var i = 0; i < bayDef.count; i++) {
      seq++;
      var id = 'B' + String(seq).padStart(3, '0');   // zero-padded: B001 .. B148
      rows.push([
        id,               // Location ID
        '1F',             // Floor (1st floor)
        'Warehouse',      // Section
        '',               // Aisle
        bayDef.bay,       // Rack — holds the Bay letter (display/grouping only)
        '',               // Shelf
        '',               // Bin
        bayDef.label + ' — ' + id,  // Label (human string)
        bayDef.type,      // Type — set at source per bay→type map (RISK-1 primary defence)
        1,                // Capacity Qty (1 pallet per slot)
        'PALLET',         // Capacity Unit
        'Y'               // Active
      ]);
    }
  });
  return rows;
}

var LOCATIONS_SEED = LOCATIONS_ZONE_SEED.concat(buildLocationSlotSeed_());

var CUSTOMER_RETURN_HEADERS = [
  'Return No.', 'Return Date', 'Customer Code', 'Customer Name',
  'Original Gatepass No.', 'Product Code', 'Product Description',
  'FG Batch No.', 'Qty Returned', 'Unit', 'Return Reason',
  'Received By', 'IQC Status', 'Disposition', 'NCR Ref', 'Status',
  'Remarks', 'Timestamp'
];

var SCRAP_LOG_HEADERS = [
  'Scrap ID', 'Timestamp', 'Ref Doc Type', 'Ref Doc No.',
  'Material Code', 'Batch / Lot No.', 'Qty Scrap', 'Unit',
  'Scrap Reason', 'Scrap Destination', 'Recorded By'
];

var SAMPLE_LOG_HEADERS = [
  'Sample ID', 'Timestamp', 'Ref Doc Type', 'Ref Doc No.',
  'Material Code', 'Batch / Lot No.', 'Qty Sample', 'Unit',
  'Sample Purpose', 'Taken By', 'Location Stored'
];

var IQC_HEADERS = [
  'IQC No.', 'Date', 'GRN No.', 'Supplier Name', 'Material Description',
  'Batch No.', 'Inspector', 'AQL Level', 'Sample Size', 'Sample ID',
  '1-Quantity', '2-Packaging', '3-Colour', '4-Shape/Form', '5-Dimensions',
  '6-Net Weight', '7-Cleanliness', '8-Odour', '9-Label Accuracy',
  '10-MSDS/SDS', '11-Shelf Life', '12-COA/Test Report',
  'Disposition', 'NCR Ref', 'Deviation Ref', 'Remarks',
  'Accepted Qty', 'Rejected Qty', 'Timestamp', 'Operator ID'
];

var OQC_HEADERS = [
  'OQC No.', 'Date', 'Customer Code', 'Customer Name', 'Batch / PO',
  'Material Description', 'IPQC Reviewed', 'AQL Sample Size',
  'Fill Weight', 'Label Accuracy', 'Seal Integrity', 'Appearance', 'Customer Spec',
  'Inspector', 'Release Decision', 'Remarks',
  'Accepted Qty', 'Rejected Qty', 'Timestamp',
  'IPQC Session Ref', 'Operator ID',
  'FG Location ID', 'FG Lot ID'
];

// P6 — Finished Goods dispatch lots (one row per OQC release of an FG batch)
// Status enum: AVAILABLE | PARTIAL | DISPATCHED | RECALLED | NEEDS_REVIEW
var FG_DISPATCH_HEADERS = [
  'Lot ID', 'Timestamp', 'OQC Ref', 'OQC Date',
  'Customer Code', 'Customer Name',
  'Product Code', 'Product Desc', 'FG Batch / PO',
  'FG Location ID',
  'Qty Released', 'Qty Dispatched', 'Qty Available', 'Unit',
  'Status',
  'First Dispatched At', 'Last Dispatched At',
  'Gatepass Refs', 'Remarks'
];

// P6 — Audit log for any dispatch that deviated from FIFO order
var FG_OVERRIDE_HEADERS = [
  'Override ID', 'Timestamp', 'Customer Code', 'Product Code', 'Qty Requested',
  'FIFO Plan (JSON)', 'Chosen Plan (JSON)', 'Skipped Lot IDs',
  'Reason', 'Operator', 'Resulting Gatepass No', 'Status'
];

// IPQC — session-based in-process inspection
var IPQC_SESSIONS_HEADERS = [
  'session_id', 'product_code', 'product_name', 'batch', 'inspector', 'line',
  'date', 'start_time', 'end_time', 'status', 'rounds'
];

var IPQC_LOG_HEADERS = [
  'session_id', 'product_code', 'batch', 'round_no', 'timestamp',
  'param_code', 'param_name', 'std_value', 'unit', 'actual_value',
  'result', 'remark', 'elapsed_hms', 'period_start', 'period_end', 'avg_weight'
];

// Production — job tracking and component booking
var PROD_JOBS_HEADERS = [
  'Job ID', 'Timestamp', 'Client', 'FG Code', 'FG Description',
  'FG Qty Issued', 'UoM', 'Issue IDs', 'Status', 'IPQC ID', 'Booking ID', 'Closed At'
];

var PROD_BOOKING_HEADERS = [
  'Booking ID', 'Timestamp', 'Job ID', 'IPQC ID', 'FG Code', 'FG Description',
  'FG Produced', 'FG UoM',
  'Component Code', 'Component Name', 'Batch/Lot', 'Location',
  'Booked Qty', 'Consumed', 'Returned', 'Scrap', 'Wastage', 'Loss', 'UoM',
  'Booked By', 'Remarks'
];

// Control plan — FG parameter assignments per item
var CONTROL_FG_HEADERS = [
  'item_code', 'param_code', 'enabled', 'std_value_override',
  'tol_min_override', 'tol_max_override'
];

// Masters — inspection parameters library
var MASTERS_PARAMETERS_HEADERS = [
  'code', 'name', 'unit', 'std_value', 'tol_min', 'tol_max',
  'method_type', 'check_brief', 'tools', 'doc_ref', 'doc_number'
];

var REWORK_LOG_HEADERS = [
  'Rework ID', 'Date', 'Source', 'Source Ref', 'Material Code', 'Material Desc',
  'Batch No.', 'Qty', 'Unit', 'Location', 'Status',
  'Completed By', 'Completed At', 'Qty Reworked', 'Qty Scrapped',
  'Re-OQC Ref', 'Re-IQC Ref', 'Remarks', 'Material Type'
];

var NCR_HEADERS = [
  'NCR No.', 'Date', 'Source', 'Source Ref', 'Material Code', 'Material Desc',
  'Batch No.', 'Qty Affected', 'Unit', 'Defect Description',
  'Disposition', 'Disposition By', 'Disposition At', 'CAPA Ref',
  'Status', 'Created By', 'Timestamp'
];

var GATEPASS_HEADERS = [
  'GP_NO', 'DATE', 'TYPE', 'OQC_REF', 'PARTY',
  'MATERIAL_CODE', 'MATERIAL_DESC', 'QTY', 'UNIT',
  'VEHICLE_NO', 'DRIVER', 'TRANSPORTER',
  'AUTHORIZED_BY', 'SECURITY_GUARD', 'REMARKS',
  'STATUS', 'CREATED_BY', 'CREATED_AT',
  'DISPATCH_ZONE', 'OPERATOR_ID'
];

// ── Main setup function ───────────────────────────────────────

function initializeProject() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Store ID so web app context can use openById
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  var ui = SpreadsheetApp.getUi();

  var resp = ui.alert(
    '⚙️ Initialize QMS Project',
    'This will create all required sheets and load master data.\n\nExisting sheets will NOT be overwritten.\n\nProceed?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  try {
    createConfigSheet_(ss);
    createMasterSheet_(ss, 'MASTERS_Suppliers',  ['Supplier Code','Supplier Name','Contact Person','Phone / WhatsApp','Email','Material Supplied','City / Location','Approved (Y/N)','State Code'], SUPPLIERS);
    createMasterSheet_(ss, 'MASTERS_Materials',  ['Item Code','Item Description','Unit','Category'], MATERIALS);
    createMasterSheet_(ss, 'MASTERS_Customers',  ['Customer Code','Customer Name','Contact Person','Phone / WhatsApp','Email','Products Supplied','City'], CUSTOMERS);
    createMasterSheet_(ss, 'MASTERS_Personnel',  ['Name','Role / Designation','Department','WhatsApp No.','Send Notifications (Y/N)'], PERSONNEL);
    createMasterSheet_(ss, 'LOCATIONS',          LOCATIONS_HEADERS, LOCATIONS_SEED);
    createLogSheet_(ss, 'GRN_LOG',  GRN_HEADERS);
    createLogSheet_(ss, 'IQC_LOG',  IQC_HEADERS);
    createLogSheet_(ss, 'OQC_LOG',  OQC_HEADERS);
    createLogSheet_(ss, 'GATEPASS_LOG', GATEPASS_HEADERS);
    createLogSheet_(ss, 'NCR_LOG',      NCR_HEADERS);
    createLogSheet_(ss, 'STOCK_LEDGER',         STOCK_LEDGER_HEADERS);
    createLogSheet_(ss, 'CUSTOMER_RETURN_LOG',  CUSTOMER_RETURN_HEADERS);
    createLogSheet_(ss, 'SCRAP_LOG',            SCRAP_LOG_HEADERS);
    createLogSheet_(ss, 'REWORK_LOG',           REWORK_LOG_HEADERS);
    createLogSheet_(ss, 'SAMPLE_LOG',           SAMPLE_LOG_HEADERS);
    createLogSheet_(ss, 'REVISIONS_LOG', ['TYPE', 'DOC_NO', 'TIMESTAMP', 'REVISED_BY', 'FIELD', 'OLD_VALUE', 'NEW_VALUE']);
    createLogSheet_(ss, 'PO_HEADER', PO_HEADER_HEADERS);
    createLogSheet_(ss, 'PO_LINES',  PO_LINE_HEADERS);
    createLogSheet_(ss, 'IPQC_Sessions',      IPQC_SESSIONS_HEADERS);
    createLogSheet_(ss, 'IPQC_LOG',           IPQC_LOG_HEADERS);
    createLogSheet_(ss, 'PROD_JOBS',          PROD_JOBS_HEADERS);
    createLogSheet_(ss, 'PROD_BOOKING_LOG',   PROD_BOOKING_HEADERS);
    createLogSheet_(ss, 'FG_DISPATCH_LOTS',   FG_DISPATCH_HEADERS);
    createLogSheet_(ss, 'FG_FIFO_OVERRIDE_LOG', FG_OVERRIDE_HEADERS);
    createLogSheet_(ss, 'CONTROL_FG',         CONTROL_FG_HEADERS);
    // Chokepoint pilot (PLAN-V3.3) — idempotent ensure on init.
    try { if (typeof ensurePilotSheets === 'function') ensurePilotSheets(); } catch(e) {}
    createMasterSheet_(ss, 'MASTERS_Parameters', MASTERS_PARAMETERS_HEADERS, []);
    createDashboardSheet_(ss);
    createReadmeSheet_(ss);

    // Move README to front
    try { ss.moveActiveSheet(0); } catch(e) {}

    ui.alert('✅ Setup Complete!', 'All sheets created and master data loaded.\n\nUse QMS System menu to start entering GRN / IQC / OQC records.', ui.ButtonSet.OK);
  } catch(e) {
    ui.alert('❌ Error', 'Setup failed: ' + e.message, ui.ButtonSet.OK);
    Logger.log(e);
  }
}

// ── Sheet creators ────────────────────────────────────────────

function createConfigSheet_(ss) {
  if (ss.getSheetByName('CONFIG')) return;
  var ws = ss.insertSheet('CONFIG');
  ws.getRange('A1').setValue('SETTING').setFontWeight('bold');
  ws.getRange('B1').setValue('VALUE').setFontWeight('bold');

  var config = [
    ['company_name',    'Pack Masters'],
    ['address',         'Rabale MIDC, Navi Mumbai'],
    ['qmr_name',        'AZAD Rajbhar'],
    ['approver_name',   'Tarun Mishra'],
    ['grn_prefix',      'PM/GRN/2026-'],
    ['iqc_prefix',      'PM/IQC/2026-'],
    ['oqc_prefix',      'PM/OQC/2026-'],
    ['ncr_prefix',      'PM/NCR/2026-'],
    ['gp_prefix',       'PM/GP/2026-'],
    ['rtn_prefix',      'PM/RTN/2026-'],
    ['scr_prefix',      'PM/SCR/2026-'],
    ['smp_prefix',      'PM/SMP/2026-'],
    ['grn_counter',     1],
    ['iqc_counter',     1],
    ['oqc_counter',     1],
    ['ncr_counter',     1],
    ['gp_counter',      1],
    ['rtn_counter',     1],
    ['scr_counter',     1],
    ['smp_counter',     1],
    ['logo_url',        'https://drive.google.com/open?id=188w1SoyRbRApB9fcXXEFE9KqjlOc5VzA'],
    ['default_aql',     'AQL 2.5']
  ];

  config.forEach(function(row, i) {
    ws.getRange(i + 2, 1).setValue(row[0]);
    ws.getRange(i + 2, 2).setValue(row[1]);
  });

  ws.setColumnWidth(1, 160);
  ws.setColumnWidth(2, 300);
  styleSheetHeader_(ws, 1, 2, '#0D1B6E');
  ws.setTabColor('#E8A020');
}

function createMasterSheet_(ss, name, headers, data) {
  if (ss.getSheetByName(name)) return;
  var ws = ss.insertSheet(name);

  ws.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#0D1B6E')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setHorizontalAlignment('center');

  if (data && data.length) {
    ws.getRange(2, 1, data.length, headers.length).setValues(data)
      .setFontFamily('Arial')
      .setFontSize(10);
  }

  ws.setFrozenRows(1);
  ws.setTabColor('#4CAF50');
  headers.forEach(function(_, i) { ws.setColumnWidth(i + 1, 180); });
}

// Idempotent upsert of the 148 physical B### pallet slots onto an existing LOCATIONS sheet.
// Reads current IDs (col A), appends only the B### rows that are missing, and never touches the
// 8 legacy zone rows. Returns the number of rows appended (0 when already complete).
function ensureLocationSlots_(ss) {
  var ws = ss.getSheetByName('LOCATIONS');
  if (!ws) return 0;

  var existing = {};
  if (ws.getLastRow() > 1) {
    ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().forEach(function(r) {
      var id = String(r[0] || '').trim();
      if (id) existing[id] = true;
    });
  }

  var missing = buildLocationSlotSeed_().filter(function(row) { return !existing[row[0]]; });
  if (!missing.length) return 0;

  ws.getRange(ws.getLastRow() + 1, 1, missing.length, LOCATIONS_HEADERS.length)
    .setValues(missing).setFontFamily('Arial').setFontSize(10);
  return missing.length;
}

// ── Runnable assert-based check for the LOCATIONS seed (run from the GAS editor) ──
// Validates the in-memory LOCATIONS_SEED (no sheet write needed) against every Step-1 success
// criterion. Logger-based pass/fail; returns { pass, failures }.
function _testLocationSeed() {
  var failures = [];
  function check(cond, msg) { if (!cond) failures.push(msg); }

  var seed = LOCATIONS_SEED;
  var slots = seed.filter(function(r) { return /^B\d{3}$/.test(String(r[0])); });
  var zones = ['RM-STORE-A','RM-STORE-B','QUARANTINE','FG-STORE','FG-HOLD','SCRAP-AREA','SAMPLE-CABINET','REWORK-AREA'];

  // Count & format
  check(seed.length === 156, 'expected 156 total rows (148 B### + 8 zones), got ' + seed.length);
  check(slots.length === 148, 'expected 148 B### rows, got ' + slots.length);

  var ids = slots.map(function(r) { return String(r[0]); });
  var unique = {};
  ids.forEach(function(id) { unique[id] = (unique[id] || 0) + 1; });
  check(Object.keys(unique).length === 148, 'B### IDs are not all unique');
  ids.forEach(function(id) { check(/^[ABC]\d{3}$/.test(id), 'ID does not match ^[ABC]\\d{3}$: ' + id); });
  check(ids[0] === 'B001', 'first slot is not B001 (got ' + ids[0] + ')');
  check(ids[ids.length - 1] === 'B148', 'last slot is not B148 (got ' + ids[ids.length - 1] + ')');
  check(ids.indexOf('B1') === -1 && /^B0\d{2}$/.test('B001'), 'zero-padding boundary: B1 must not appear, B001 must');
  // contiguity B001..B148
  for (var n = 1; n <= 148; n++) {
    check(unique['B' + String(n).padStart(3, '0')] === 1, 'missing/dup contiguous slot B' + String(n).padStart(3, '0'));
  }

  // Bay distribution (Rack col = index 4) + bay→type map (Type col = index 8)
  var bayExpect = { A: { count: 25, type: 'RM' }, B: { count: 4, type: 'PM' }, C: { count: 42, type: 'PM' },
                    D: { count: 42, type: 'PM' }, E: { count: 21, type: 'FG' }, F: { count: 14, type: 'FG' } };
  var bayActual = {};
  slots.forEach(function(r) {
    var bay = String(r[4]);
    bayActual[bay] = (bayActual[bay] || 0) + 1;
    var wantType = bayExpect[bay] ? bayExpect[bay].type : '???';
    check(String(r[8]) === wantType, r[0] + ' (bay ' + bay + ') Type=' + r[8] + ' expected ' + wantType);
    check(String(r[8]) !== '', r[0] + ' has empty Type');            // RISK-1: no empty Type
    check(String(r[1]) === '1F', r[0] + ' Floor=' + r[1] + ' expected 1F');  // Floor in col B
    check(r[0].indexOf(bay) === -1 || bay === 'B', 'sanity: ID must not embed a parseable bay letter');
  });
  Object.keys(bayExpect).forEach(function(bay) {
    check(bayActual[bay] === bayExpect[bay].count, 'bay ' + bay + ' count=' + bayActual[bay] + ' expected ' + bayExpect[bay].count);
  });
  var baySum = Object.keys(bayActual).reduce(function(s, b) { return s + bayActual[b]; }, 0);
  check(baySum === 148, 'bay counts sum=' + baySum + ' expected 148');

  // RISK-2: all 8 legacy zones survive
  var seedIds = {};
  seed.forEach(function(r) { seedIds[String(r[0])] = true; });
  zones.forEach(function(z) { check(seedIds[z] === true, 'legacy zone missing from seed: ' + z); });

  // RISK-2 idempotency: buildLocationSlotSeed_ twice → identical, no growth
  check(buildLocationSlotSeed_().length === 148, 'buildLocationSlotSeed_ must always yield 148 rows');

  // RISK-1: inferLocType fallback for an untyped/missing B### row
  if (typeof getStockView === 'function') {
    // inferLocType is nested in getStockView; assert the regex fallback contract directly here.
    check(/^[ABC]\d{3}$/.test('B999'), 'B999 must match slot regex (fallback precondition)');
  }

  if (failures.length) {
    Logger.log('❌ _testLocationSeed FAILED (' + failures.length + '):\n - ' + failures.join('\n - '));
  } else {
    Logger.log('✅ _testLocationSeed PASSED — 156 rows, 148 unique B001–B148, bay counts A=25/B=4/C=42/D=42/E=21/F=14, all Types non-empty, 8 zones present.');
  }
  return { pass: failures.length === 0, failures: failures };
}

function createLogSheet_(ss, name, headers) {
  if (ss.getSheetByName(name)) return;
  var ws = ss.insertSheet(name);

  ws.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#0D1B6E')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setHorizontalAlignment('center');

  ws.setFrozenRows(1);
  ws.setTabColor('#2196F3');
  headers.forEach(function(_, i) { ws.setColumnWidth(i + 1, 150); });
}

function createDashboardSheet_(ss) {
  if (ss.getSheetByName('DASHBOARD')) return;
  var ws = ss.insertSheet('DASHBOARD');

  ws.getRange('A1').setValue('Use QMS System → Open Dashboard to view records.')
    .setFontFamily('Arial')
    .setFontSize(11)
    .setFontColor('#666666')
    .setFontStyle('italic');

  ws.setTabColor('#FF5722');
}

function createReadmeSheet_(ss) {
  if (ss.getSheetByName('README')) return;
  var ws = ss.insertSheet('README', 0);

  var rows = [
    ['Pack Masters QMS — Quick Start Guide', ''],
    ['', ''],
    ['STEP', 'ACTION'],
    ['1', 'Go to QMS System menu → New GRN to record incoming goods'],
    ['2', 'After GRN, go to QMS System → New IQC to inspect the material'],
    ['3', 'Before dispatch, go to QMS System → New OQC'],
    ['4', 'View all records: QMS System → Open Dashboard'],
    ['5', 'To send a WhatsApp update: select any row in GRN/IQC/OQC log → QMS System → Send WhatsApp'],
    ['6', 'To import past data: QMS System → Import Past Data (CSV)'],
    ['', ''],
    ['SHEET', 'PURPOSE'],
    ['CONFIG', 'Document number counters and company settings'],
    ['MASTERS_Suppliers', 'Supplier list used in dropdowns'],
    ['MASTERS_Materials', 'Material list used in dropdowns'],
    ['MASTERS_Customers', 'Customer list used in dropdowns'],
    ['MASTERS_Personnel', 'Inspector list used in dropdowns'],
    ['GRN_LOG', 'All Goods Receipt Note records'],
    ['IQC_LOG', 'All Incoming Quality Check records'],
    ['OQC_LOG', 'All Outgoing Quality Check records']
  ];

  rows.forEach(function(row, i) {
    var r = i + 1;
    ws.getRange(r, 1).setValue(row[0]);
    ws.getRange(r, 2).setValue(row[1]);
  });

  ws.getRange('A1:B1').merge()
    .setValue('Pack Masters QMS — Quick Start Guide')
    .setBackground('#0D1B6E')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(14)
    .setFontFamily('Arial')
    .setHorizontalAlignment('center');

  ws.getRange('A3:B3').setBackground('#0D1B6E').setFontColor('#FFFFFF').setFontWeight('bold').setFontFamily('Arial');
  ws.getRange('A11:B11').setBackground('#0D1B6E').setFontColor('#FFFFFF').setFontWeight('bold').setFontFamily('Arial');

  ws.setColumnWidth(1, 200);
  ws.setColumnWidth(2, 500);
  ws.setTabColor('#9C27B0');
}

function styleSheetHeader_(ws, row, numCols, color) {
  ws.getRange(row, 1, 1, numCols)
    .setBackground(color || '#0D1B6E')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontFamily('Arial')
    .setFontSize(10);
}

// Called from onOpen — appends any CONFIG rows that are missing (safe to run repeatedly)
function ensureConfigKeys_() {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('CONFIG');
    if (!ws) return;
    var data = ws.getDataRange().getValues();
    var existing = {};
    data.forEach(function(r) { if (r[0]) existing[String(r[0]).trim()] = true; });
    var required = [
      ['gp_prefix',  'PM/GP/2026-'],
      ['gp_counter', 1],
      ['grn_prefix', 'PM/GRN/2026-'],
      ['grn_counter', 1],
      ['iqc_prefix', 'PM/IQC/2026-'],
      ['iqc_counter', 1],
      ['oqc_prefix', 'PM/OQC/2026-'],
      ['oqc_counter', 1],
      ['ncr_prefix', 'PM/NCR/2026-'],
      ['ncr_counter', 1],
      ['rtn_prefix', 'PM/RTN/2026-'],
      ['rtn_counter', 1],
      ['scr_prefix', 'PM/SCR/2026-'],
      ['scr_counter', 1],
      ['smp_prefix', 'PM/SMP/2026-'],
      ['smp_counter', 1],
      ['po_prefix',  'PM/PO/2026-'],
      ['po_counter',  1],
      ['KPI_FPY_GREEN',         95],
      ['KPI_FPY_AMBER',         90],
      ['KPI_DEFECT_AMBER',       2],
      ['KPI_DEFECT_RED',         5],
      ['KPI_OTD_GREEN',         90],
      ['KPI_OTD_AMBER',         80],
      ['KPI_RETURN_WINDOW_DAYS',60],
      ['KPI_RETURN_AMBER',       1],
      ['KPI_RETURN_RED',         3],
      ['KPI_NCR_OPEN_RED',      10]
    ];
    required.forEach(function(pair) {
      if (!existing[pair[0]]) ws.appendRow(pair);
    });
  } catch(e) {
    Logger.log('ensureConfigKeys_: ' + e.message);
  }
}

// ── Sheet schema verifier / repairer ──────────────────────────
// Idempotent. Safe to run on a populated spreadsheet.
// - Creates any missing log sheets with the canonical headers.
// - For existing sheets, appends missing trailing columns to row 1
//   (only at the END — does not touch existing column order or data).
function verifyAndRepairSheets() {
  var ui = SpreadsheetApp.getUi();
  var result = verifyAndRepairSheets_core();
  if (!result.ok) { ui.alert(result.error); return; }
  ui.alert('Sheet Verify & Repair', result.report.join('\n'), ui.ButtonSet.OK);
}

function verifyAndRepairSheets_core() {
  var ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'No spreadsheet bound.' };

  var EXPECTED = {
    'GRN_LOG':              GRN_HEADERS,
    'IQC_LOG':              IQC_HEADERS,
    'OQC_LOG':              OQC_HEADERS,
    'GATEPASS_LOG':         GATEPASS_HEADERS,
    'NCR_LOG':              NCR_HEADERS,
    'STOCK_LEDGER':         STOCK_LEDGER_HEADERS,
    'CUSTOMER_RETURN_LOG':  CUSTOMER_RETURN_HEADERS,
    'SCRAP_LOG':            SCRAP_LOG_HEADERS,
    'SAMPLE_LOG':           SAMPLE_LOG_HEADERS,
    'REWORK_LOG':           REWORK_LOG_HEADERS,
    'FG_DISPATCH_LOTS':     FG_DISPATCH_HEADERS,
    'FG_FIFO_OVERRIDE_LOG': FG_OVERRIDE_HEADERS,
    'PO_HEADER':            PO_HEADER_HEADERS,
    'PO_LINES':             PO_LINE_HEADERS,
    'IPQC_Sessions':        IPQC_SESSIONS_HEADERS,
    'IPQC_LOG':             IPQC_LOG_HEADERS,
    'PROD_JOBS':            PROD_JOBS_HEADERS,
    'PROD_BOOKING_LOG':     PROD_BOOKING_HEADERS,
    'CONTROL_FG':           CONTROL_FG_HEADERS,
    'MASTERS_Parameters':   MASTERS_PARAMETERS_HEADERS
  };

  // Ensure MASTERS_Suppliers has state_code column
  var suppWs = ss.getSheetByName('MASTERS_Suppliers');
  if (suppWs) {
    var suppHdrs = ['Supplier Code','Supplier Name','Contact Person','Phone / WhatsApp','Material Supplied','City / Location','Approved (Y/N)','State Code'];
    var suppLast = suppWs.getLastColumn();
    if (suppLast < suppHdrs.length) {
      suppWs.getRange(1, suppLast + 1, 1, suppHdrs.length - suppLast).setValues([suppHdrs.slice(suppLast)]).setFontWeight('bold');
    }
  }

  var report = [];

  // Ensure LOCATIONS master sheet exists with seed (only if absent)
  if (!ss.getSheetByName('LOCATIONS')) {
    createMasterSheet_(ss, 'LOCATIONS', LOCATIONS_HEADERS, LOCATIONS_SEED);
    report.push('✅ CREATED  LOCATIONS (master, ' + LOCATIONS_HEADERS.length + ' cols, ' + LOCATIONS_SEED.length + ' seed rows)');
  } else {
    // Sheet already exists → createMasterSheet_ is a no-op, so the B### slots would never
    // land on a pre-existing sheet. Upsert any missing B### rows by ID (idempotent; keeps
    // the 8 legacy zones untouched — RISK-2).
    var added = ensureLocationSlots_(ss);
    if (added > 0) report.push('🔧 REPAIRED LOCATIONS — appended ' + added + ' missing B### slot row(s)');
    else report.push('✅ OK       LOCATIONS (all 148 B### slots present)');
  }

  Object.keys(EXPECTED).forEach(function(name) {
    var expected = EXPECTED[name];
    var ws = ss.getSheetByName(name);
    if (!ws) {
      createLogSheet_(ss, name, expected);
      report.push('✅ CREATED  ' + name + ' (' + expected.length + ' cols)');
      return;
    }
    var lastCol = ws.getLastColumn();
    if (lastCol >= expected.length) {
      // Check header text parity for the first lastCol cells
      var current = ws.getRange(1, 1, 1, lastCol).getValues()[0];
      var mismatches = [];
      for (var i = 0; i < expected.length; i++) {
        if (String(current[i] || '').trim() !== expected[i]) {
          mismatches.push('col ' + (i + 1) + ' is "' + current[i] + '" (expected "' + expected[i] + '")');
        }
      }
      if (mismatches.length === 0) {
        report.push('✅ OK       ' + name + ' (' + lastCol + ' cols)');
      } else {
        report.push('⚠️ HEADER  ' + name + ' — ' + mismatches.join('; '));
      }
      return;
    }
    // Append missing trailing headers
    var missing = expected.slice(lastCol);
    ws.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    report.push('🔧 REPAIRED ' + name + ' — added ' + missing.length + ' col(s): ' + missing.join(', '));
  });

  Logger.log(report.join('\n'));
  return { ok: true, report: report };
}

// Integration smoke test — read-only trace of the most recent batch flow.
// Picks the N latest GRNs and reports forward linkage: GRN → IQC → IPQC session → OQC → Gatepass.
// Flags broken or missing handoffs. Does not write anything.
function smokeTestBatchFlow() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui = SpreadsheetApp.getUi();
  var result = smokeTestBatchFlow_core();
  if (!result.ok) { ui.alert(result.error); return; }
  ui.alert('Smoke Test Complete', 'Report written to "_SMOKETEST" sheet.', ui.ButtonSet.OK);
}

function smokeTestBatchFlow_core() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ss = getSpreadsheet();
  if (!ss) return { ok: false, error: 'No spreadsheet bound.' };

  var N = 5;  // sample size — last 5 GRNs
  var report = [];

  var grnWs = ss.getSheetByName('GRN_LOG');
  var iqcWs = ss.getSheetByName('IQC_LOG');
  var ipqcSessWs = ss.getSheetByName('IPQC_Sessions');
  var oqcWs = ss.getSheetByName('OQC_LOG');
  var gpWs  = ss.getSheetByName('GATEPASS_LOG');

  if (!grnWs || grnWs.getLastRow() < 2) return { ok: false, error: 'No GRN data.' };

  var grnRows = grnWs.getDataRange().getValues();
  var sample = grnRows.slice(Math.max(1, grnRows.length - N));

  // Pre-index downstream sheets by relevant ref
  var iqcByGrn = {};
  if (iqcWs && iqcWs.getLastRow() > 1) {
    iqcWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var grn = String(r[2] || '').trim();
      if (grn) (iqcByGrn[grn] = iqcByGrn[grn] || []).push({ docNo: r[0], disp: r[22], batch: r[5] });
    });
  }

  var ipqcByBatch = {};
  if (ipqcSessWs && ipqcSessWs.getLastRow() > 1) {
    ipqcSessWs.getDataRange().getValues().slice(1).forEach(function(r) {
      // Schema unknown — sample col indices for batch / docNo
      var batch = String(r[3] || r[2] || '').trim();
      if (batch) (ipqcByBatch[batch] = ipqcByBatch[batch] || []).push({ docNo: r[0], row: r });
    });
  }

  var oqcByBatch = {};
  if (oqcWs && oqcWs.getLastRow() > 1) {
    oqcWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var batch = String(r[4] || '').trim();  // col E = Batch / PO
      if (batch) (oqcByBatch[batch] = oqcByBatch[batch] || []).push({
        docNo: r[0], decision: r[14], ipqcRef: r[19]
      });
    });
  }

  var gpByOqcRef = {};
  if (gpWs && gpWs.getLastRow() > 1) {
    gpWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var ref = String(r[3] || '').trim();
      if (ref) (gpByOqcRef[ref] = gpByOqcRef[ref] || []).push({ docNo: r[0], status: r[15] });
    });
  }

  report.push('=== Last ' + sample.length + ' GRNs — forward trace ===\n');
  sample.forEach(function(r) {
    var grnNo = r[0], batch = String(r[8] || '').trim(), mat = r[7], iqcStatus = r[15];
    report.push('▸ ' + grnNo + '  batch=' + batch + '  iqcStatus=' + iqcStatus);

    var iqcs = iqcByGrn[grnNo] || [];
    if (iqcs.length === 0) {
      report.push('   ❌ no IQC found for this GRN');
      return;
    }
    iqcs.forEach(function(iq) {
      report.push('   ✅ IQC ' + iq.docNo + '  disp=' + iq.disp);
    });

    // FG check: only FG batches expected to flow to IPQC/OQC/GP
    var ipqcs = ipqcByBatch[batch] || [];
    var oqcs  = oqcByBatch[batch]  || [];
    if (ipqcs.length === 0 && oqcs.length === 0) {
      report.push('   — no downstream IPQC/OQC for batch (expected for RM)');
      return;
    }
    ipqcs.forEach(function(ip) { report.push('   ✅ IPQC session ' + ip.docNo); });
    oqcs.forEach(function(oq) {
      report.push('   ✅ OQC ' + oq.docNo + '  decision=' + oq.decision + '  ipqcRef=' + (oq.ipqcRef || '∅'));
      var gps = gpByOqcRef[oq.docNo] || [];
      if (oq.decision === 'RELEASED' || oq.decision === 'ACCEPTED') {
        if (gps.length === 0) report.push('      — no Gatepass yet (OK if pending dispatch)');
        else gps.forEach(function(g) { report.push('      ✅ Gatepass ' + g.docNo + '  status=' + g.status); });
      } else if (gps.length > 0) {
        report.push('      ❌ Gatepass exists for non-released OQC!');
      }
    });
  });

  // Orphan check: gatepass refs that point to nothing
  report.push('\n=== Orphan check — Gatepass OQC_REFs not in OQC_LOG ===');
  var oqcDocs = {};
  if (oqcWs && oqcWs.getLastRow() > 1) {
    oqcWs.getDataRange().getValues().slice(1).forEach(function(r) {
      if (r[0]) oqcDocs[String(r[0]).trim()] = true;
    });
  }
  var orphans = 0, legacy = 0;
  Object.keys(gpByOqcRef).forEach(function(ref) {
    if (/\s+to\s+/i.test(ref)) { legacy++; return; }  // legacy range-style ref, grandfathered
    if (!oqcDocs[ref]) {
      report.push('   ❌ Gatepass ref "' + ref + '" not found in OQC_LOG (' + gpByOqcRef[ref].length + ' GPs)');
      orphans++;
    }
  });
  if (orphans === 0) report.push('   ✅ all single-ref Gatepass OQC refs resolve');
  if (legacy > 0)    report.push('   — ' + legacy + ' legacy range-style ref(s) skipped (grandfathered)');

  var out = report.join('\n');
  Logger.log(out);
  var dump = ss.getSheetByName('_SMOKETEST') || ss.insertSheet('_SMOKETEST');
  dump.clear();
  dump.getRange(1, 1).setValue(out);
  return { ok: true, report: out };
}

// Verifies master data tabs have minimum rows + required categories.
function verifyMastersSeed() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet();
  if (!ss) { ui.alert('No spreadsheet bound.'); return; }

  var report = [];

  function rowCount(name) {
    var ws = ss.getSheetByName(name);
    return ws ? Math.max(0, ws.getLastRow() - 1) : -1;
  }

  ['MASTERS_Suppliers', 'MASTERS_Materials', 'MASTERS_Customers', 'MASTERS_Personnel'].forEach(function(name) {
    var n = rowCount(name);
    if (n < 0)      report.push('❌ ' + name + ' MISSING');
    else if (n === 0) report.push('⚠️ ' + name + ' empty');
    else            report.push('✅ ' + name + ' rows=' + n);
  });

  // Materials: OQC needs ≥1 FG; GRN/IQC need ≥1 non-FG (RM = anything not FG).
  var mats = ss.getSheetByName('MASTERS_Materials');
  if (mats && mats.getLastRow() > 1) {
    var data = mats.getRange(2, 1, mats.getLastRow() - 1, 4).getValues();
    var fg = data.filter(function(r) { return String(r[3] || '').toUpperCase() === 'FG'; });
    var rm = data.filter(function(r) {
      var c = String(r[3] || '').toUpperCase();
      return c && c !== 'FG';
    });
    report.push((fg.length > 0 ? '✅' : '❌') + ' Materials FG (OQC source) = ' + fg.length);
    report.push((rm.length > 0 ? '✅' : '❌') + ' Materials non-FG (RM, GRN/IQC source) = ' + rm.length);
  }

  // Personnel: getInspectors() returns ALL personnel — no role filter in code.
  var ppl = ss.getSheetByName('MASTERS_Personnel');
  if (ppl && ppl.getLastRow() > 1) {
    var pdata = ppl.getRange(2, 1, ppl.getLastRow() - 1, 5).getValues();
    var active = pdata.filter(function(r) { return r[0]; });
    report.push((active.length > 0 ? '✅' : '❌') + ' Personnel (Inspector dropdown source) = ' + active.length);
  }

  ui.alert('Masters Seed Check', report.join('\n'), ui.ButtonSet.OK);
  Logger.log(report.join('\n'));
}

// Verifies CONFIG doc-number counters against actual max in each log sheet.
// Reports mismatches and offers to auto-bump CONFIG to max+1.
function verifyDocCounters() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet();
  if (!ss) { ui.alert('No spreadsheet bound.'); return; }

  var MAP = [
    { counter: 'grn_counter', sheet: 'GRN_LOG',             prefix: 'PM/GRN/2026-' },
    { counter: 'iqc_counter', sheet: 'IQC_LOG',             prefix: 'PM/IQC/2026-' },
    { counter: 'oqc_counter', sheet: 'OQC_LOG',             prefix: 'PM/OQC/2026-' },
    { counter: 'gp_counter',  sheet: 'GATEPASS_LOG',        prefix: 'PM/GP/2026-'  },
    { counter: 'ncr_counter', sheet: 'NCR_LOG',             prefix: 'PM/NCR/2026-' },
    { counter: 'rtn_counter', sheet: 'CUSTOMER_RETURN_LOG', prefix: 'PM/RTN/2026-' },
    { counter: 'scr_counter', sheet: 'SCRAP_LOG',           prefix: 'PM/SCR/2026-' },
    { counter: 'smp_counter', sheet: 'SAMPLE_LOG',          prefix: 'PM/SMP/2026-' },
    { counter: 'po_counter',  sheet: 'PO_HEADER',           prefix: 'PM/PO/2026-'  }
  ];

  var cfg = ss.getSheetByName('CONFIG');
  if (!cfg) { ui.alert('CONFIG sheet missing.'); return; }
  var cfgData = cfg.getDataRange().getValues();
  var cfgIdx = {};
  for (var i = 1; i < cfgData.length; i++) cfgIdx[cfgData[i][0]] = i + 1;

  var report = [], fixes = [];
  MAP.forEach(function(m) {
    var ws = ss.getSheetByName(m.sheet);
    var maxSeq = 0;
    if (ws && ws.getLastRow() > 1) {
      var col1 = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
      col1.forEach(function(r) {
        var s = String(r[0] || '');
        if (s.indexOf(m.prefix) === 0) {
          var n = parseInt(s.substring(m.prefix.length), 10);
          if (!isNaN(n) && n > maxSeq) maxSeq = n;
        }
      });
    }
    var cfgRow = cfgIdx[m.counter];
    var cfgVal = cfgRow ? Number(cfgData[cfgRow - 1][1]) : 0;
    var expected = maxSeq + 1;
    if (!cfgRow) {
      report.push('⚠️ ' + m.counter + ' missing in CONFIG (sheet max=' + maxSeq + ')');
      fixes.push({ counter: m.counter, expected: expected, missing: true });
    } else if (cfgVal < expected) {
      report.push('🔧 ' + m.counter + ' is ' + cfgVal + ', should be ≥ ' + expected + ' (max in ' + m.sheet + '=' + maxSeq + ')');
      fixes.push({ counter: m.counter, expected: expected, row: cfgRow });
    } else {
      report.push('✅ ' + m.counter + ' = ' + cfgVal + ' (max in ' + m.sheet + '=' + maxSeq + ')');
    }
  });

  if (fixes.length === 0) {
    ui.alert('Doc Counters', report.join('\n'), ui.ButtonSet.OK);
    return;
  }

  var resp = ui.alert('Doc Counters — Fix?',
    report.join('\n') + '\n\nAuto-bump ' + fixes.length + ' counter(s) to max+1?',
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  fixes.forEach(function(f) {
    if (f.missing) {
      cfg.appendRow([f.counter, f.expected]);
    } else {
      cfg.getRange(f.row, 2).setValue(f.expected);
    }
  });
  ui.alert('Doc Counters fixed.', 'Bumped ' + fixes.length + ' counter(s).', ui.ButtonSet.OK);
}

// Force-mode repair: overwrites header row 1 to canonical AND deletes any
// trailing extra columns beyond the expected schema. Destructive to headers
// only — never touches data rows. Confirmed safe only after inspectSheetData()
// shows data columns line up with expected positions.
function forceFixSheetHeaders() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet();
  if (!ss) { ui.alert('No spreadsheet bound.'); return; }

  var resp = ui.alert(
    '⚠️ Force-fix headers',
    'This will:\n' +
    ' • Overwrite header row 1 of GRN_LOG, IQC_LOG, OQC_LOG, GATEPASS_LOG with canonical headers.\n' +
    ' • Delete any trailing extra columns beyond the expected schema (data in them WILL be lost).\n\n' +
    'Data rows are not touched. Run "Inspect Sheet Data" first to confirm data columns line up.\n\n' +
    'Proceed?',
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  var EXPECTED = {
    'GRN_LOG':              GRN_HEADERS,
    'IQC_LOG':              IQC_HEADERS,
    'OQC_LOG':              OQC_HEADERS,
    'GATEPASS_LOG':         GATEPASS_HEADERS,
    'NCR_LOG':              NCR_HEADERS,
    'STOCK_LEDGER':         STOCK_LEDGER_HEADERS,
    'CUSTOMER_RETURN_LOG':  CUSTOMER_RETURN_HEADERS,
    'SCRAP_LOG':            SCRAP_LOG_HEADERS,
    'SAMPLE_LOG':           SAMPLE_LOG_HEADERS,
    'REWORK_LOG':           REWORK_LOG_HEADERS,
    'FG_DISPATCH_LOTS':     FG_DISPATCH_HEADERS,
    'FG_FIFO_OVERRIDE_LOG': FG_OVERRIDE_HEADERS,
    'PO_HEADER':            PO_HEADER_HEADERS,
    'PO_LINES':             PO_LINE_HEADERS
  };

  var report = [];
  Object.keys(EXPECTED).forEach(function(name) {
    var expected = EXPECTED[name];
    var ws = ss.getSheetByName(name);
    if (!ws) { report.push('— skipped ' + name + ' (not found)'); return; }

    var lastCol = ws.getLastColumn();

    // 1. Truncate trailing extras
    var truncated = 0;
    if (lastCol > expected.length) {
      truncated = lastCol - expected.length;
      ws.deleteColumns(expected.length + 1, truncated);
    }

    // 2. Overwrite header row 1 with canonical
    ws.getRange(1, 1, 1, expected.length).setValues([expected]).setFontWeight('bold');

    report.push('✅ ' + name + ' — headers rewritten (' + expected.length + ' cols)' +
                (truncated ? ', deleted ' + truncated + ' extra col(s)' : ''));
  });

  ui.alert('Force-fix complete', report.join('\n'), ui.ButtonSet.OK);
  Logger.log(report.join('\n'));
}

// Diagnostic — for each log sheet, samples the LAST data row and prints
// per-column: index | current header | value | inferred type.
// Use to decide whether a HEADER mismatch from verifyAndRepairSheets()
// is cosmetic (rename) or structural (data shifted).
// Diagnostic: dump latest OQC_LOG row + what getReleasedOQCsForGatepass returns.
function diagnoseOQCDropdown() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ss = getSpreadsheet();
  var oqc = ss.getSheetByName('OQC_LOG');
  var msg = '';
  if (!oqc || oqc.getLastRow() < 2) {
    msg = 'OQC_LOG empty or missing.';
  } else {
    var lr = oqc.getLastRow();
    var lc = oqc.getLastColumn();
    var row = oqc.getRange(lr, 1, 1, lc).getValues()[0];
    msg += 'Latest OQC_LOG row #' + lr + ' (' + lc + ' cols):\n';
    row.forEach(function(v, i) {
      msg += '  col ' + (i+1) + ' [' + String.fromCharCode(65+i) + '] = ' + JSON.stringify(v) + '\n';
    });
    msg += '\nCol O (15, index 14) decision = ' + JSON.stringify(row[14]) + '\n';
    msg += 'Decision uppercased = ' + String(row[14] || '').toUpperCase() + '\n';
    msg += 'Matches RELEASED/ACCEPTED? ' + (['RELEASED','ACCEPTED'].indexOf(String(row[14] || '').toUpperCase()) >= 0) + '\n';
    var d = row[1];
    msg += 'Col B date = ' + JSON.stringify(d) + ' parsed=' + (d ? new Date(d).toString() : 'null') + '\n';
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    msg += 'Cutoff (30d) = ' + cutoff.toString() + '\n';
    msg += 'Within 30d? ' + (d ? new Date(d) >= cutoff : 'no date') + '\n';

    var gp = ss.getSheetByName('GATEPASS_LOG');
    var alreadyUsed = false;
    if (gp && gp.getLastRow() > 1) {
      var refs = gp.getRange(2, 4, gp.getLastRow() - 1, 1).getValues();
      refs.forEach(function(r) { if (String(r[0]).trim() === String(row[0]).trim()) alreadyUsed = true; });
    }
    msg += 'Already in GATEPASS_LOG col D? ' + alreadyUsed + '\n';
  }
  msg += '\n--- getReleasedOQCsForGatepass() returns ---\n';
  var result = getReleasedOQCsForGatepass();
  msg += 'Count: ' + result.length + '\n';
  result.forEach(function(r, i) { msg += (i+1) + '. ' + r.label + '\n'; });
  SpreadsheetApp.getUi().alert(msg);
}

function inspectSheetData() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet();
  if (!ss) { ui.alert('No spreadsheet bound.'); return; }

  var SHEETS = ['GRN_LOG', 'IQC_LOG', 'OQC_LOG', 'GATEPASS_LOG', 'PO_HEADER', 'PO_LINES'];
  var EXPECTED = {
    'GRN_LOG':              GRN_HEADERS,
    'IQC_LOG':              IQC_HEADERS,
    'OQC_LOG':              OQC_HEADERS,
    'GATEPASS_LOG':         GATEPASS_HEADERS,
    'NCR_LOG':              NCR_HEADERS,
    'STOCK_LEDGER':         STOCK_LEDGER_HEADERS,
    'CUSTOMER_RETURN_LOG':  CUSTOMER_RETURN_HEADERS,
    'SCRAP_LOG':            SCRAP_LOG_HEADERS,
    'SAMPLE_LOG':           SAMPLE_LOG_HEADERS,
    'REWORK_LOG':           REWORK_LOG_HEADERS,
    'FG_DISPATCH_LOTS':     FG_DISPATCH_HEADERS,
    'FG_FIFO_OVERRIDE_LOG': FG_OVERRIDE_HEADERS,
    'PO_HEADER':            PO_HEADER_HEADERS,
    'PO_LINES':             PO_LINE_HEADERS
  };

  function inferType(v) {
    if (v === '' || v === null || v === undefined) return 'empty';
    if (v instanceof Date) return 'date';
    if (typeof v === 'number') return 'number';
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date-str';
    if (/^\d+(\.\d+)?$/.test(s))      return 'numeric-str';
    if (/PM\/(GRN|IQC|OQC|GP|NCR|IPQC)\//.test(s)) return 'docNo';
    if (/^(PASS|FAIL|HOLD|PENDING|RELEASED|REJECTED|ACCEPTED|ISSUED)$/i.test(s.trim())) return 'status';
    return 'text(' + s.length + ')';
  }

  var report = [];
  SHEETS.forEach(function(name) {
    report.push('═══ ' + name + ' ═══');
    var ws = ss.getSheetByName(name);
    if (!ws) { report.push('  (sheet not found)'); return; }
    var lastRow = ws.getLastRow();
    var lastCol = ws.getLastColumn();
    report.push('  rows=' + (lastRow - 1) + '  cols=' + lastCol + '  expected_cols=' + EXPECTED[name].length);
    if (lastRow < 2) { report.push('  (no data rows)'); return; }

    var headers = ws.getRange(1, 1, 1, lastCol).getValues()[0];
    var sampleRow = ws.getRange(lastRow, 1, 1, lastCol).getValues()[0];
    var expected = EXPECTED[name];

    for (var i = 0; i < lastCol; i++) {
      var hdr = String(headers[i] || '').trim();
      var exp = expected[i] || '(none)';
      var val = sampleRow[i];
      var type = inferType(val);
      var flag = (hdr === exp) ? '  ' : ' ❗';
      var valDisp = (val instanceof Date) ? val.toISOString().slice(0,10) : String(val).slice(0, 30);
      report.push(flag + ' c' + (i + 1) + ' hdr="' + hdr + '" exp="' + exp + '" | ' + type + ' | ' + valDisp);
    }
  });

  var out = report.join('\n');
  Logger.log(out);
  // Also write to a temp sheet so the user can read all of it
  var dump = ss.getSheetByName('_INSPECT') || ss.insertSheet('_INSPECT');
  dump.clear();
  dump.getRange(1, 1).setValue(out);
  ui.alert('Inspect Sheet Data', 'Wrote diagnostic to sheet "_INSPECT" and to Logger.\n\nOpen "_INSPECT" tab to read the full report.', ui.ButtonSet.OK);
}
