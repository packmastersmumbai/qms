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

var GRN_HEADERS = [
  'GRN No.', 'Date', 'Supplier Code', 'Supplier Name', 'PO Reference',
  'Invoice No.', 'Material Code', 'Material Description', 'Batch / Lot No.',
  'Qty Ordered', 'Qty Received', 'Unit', 'COA Received', 'Expiry Date',
  'Remarks', 'IQC Status', 'Created By', 'Timestamp'
];

var IQC_HEADERS = [
  'IQC No.', 'Date', 'GRN No.', 'Supplier Name', 'Material Description',
  'Batch No.', 'Inspector', 'AQL Level', 'Sample Size', 'Sample ID',
  '1-Quantity', '2-Packaging', '3-Colour', '4-Shape/Form', '5-Dimensions',
  '6-Net Weight', '7-Cleanliness', '8-Odour', '9-Label Accuracy',
  '10-MSDS/SDS', '11-Shelf Life', '12-COA/Test Report',
  'Disposition', 'NCR Ref', 'Deviation Ref', 'Remarks',
  'Accepted Qty', 'Rejected Qty', 'Timestamp'
];

var OQC_HEADERS = [
  'OQC No.', 'Date', 'Customer Code', 'Customer Name', 'Batch / PO',
  'Material Description', 'IPQC Reviewed', 'AQL Sample Size',
  'Fill Weight', 'Label Accuracy', 'Seal Integrity', 'Appearance', 'Customer Spec',
  'Inspector', 'Release Decision', 'Remarks',
  'Accepted Qty', 'Rejected Qty', 'Timestamp'
];

var GATEPASS_HEADERS = [
  'GP_NO', 'DATE', 'TYPE', 'OQC_REF', 'PARTY',
  'MATERIAL_CODE', 'MATERIAL_DESC', 'QTY', 'UNIT',
  'VEHICLE_NO', 'DRIVER', 'TRANSPORTER',
  'AUTHORIZED_BY', 'SECURITY_GUARD', 'REMARKS',
  'STATUS', 'CREATED_BY', 'CREATED_AT'
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
    createMasterSheet_(ss, 'MASTERS_Suppliers',  ['Supplier Code','Supplier Name','Contact Person','Phone / WhatsApp','Material Supplied','City / Location','Approved (Y/N)'], SUPPLIERS);
    createMasterSheet_(ss, 'MASTERS_Materials',  ['Item Code','Item Description','Unit','Category'], MATERIALS);
    createMasterSheet_(ss, 'MASTERS_Customers',  ['Customer Code','Customer Name','Contact Person','Phone / WhatsApp','Email','Products Supplied','City'], CUSTOMERS);
    createMasterSheet_(ss, 'MASTERS_Personnel',  ['Name','Role / Designation','Department','WhatsApp No.','Send Notifications (Y/N)'], PERSONNEL);
    createLogSheet_(ss, 'GRN_LOG',  GRN_HEADERS);
    createLogSheet_(ss, 'IQC_LOG',  IQC_HEADERS);
    createLogSheet_(ss, 'OQC_LOG',  OQC_HEADERS);
    createLogSheet_(ss, 'GATEPASS_LOG', GATEPASS_HEADERS);
    createLogSheet_(ss, 'REVISIONS_LOG', ['TYPE', 'DOC_NO', 'TIMESTAMP', 'REVISED_BY', 'FIELD', 'OLD_VALUE', 'NEW_VALUE']);
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
    ['grn_counter',     1],
    ['iqc_counter',     1],
    ['oqc_counter',     1],
    ['ncr_counter',     1],
    ['gp_counter',      1],
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
      ['ncr_counter', 1]
    ];
    required.forEach(function(pair) {
      if (!existing[pair[0]]) ws.appendRow(pair);
    });
  } catch(e) {
    Logger.log('ensureConfigKeys_: ' + e.message);
  }
}
