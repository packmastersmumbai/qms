// ============================================================
// Code.gs — Menu, Triggers, Form Launchers
// Pack Masters QMS | Google Apps Script
// ============================================================

// ── Spreadsheet accessor (works in both bound and web app context) ──
var _SS_CACHE = null;


function getSpreadsheet() {
  if (_SS_CACHE) return _SS_CACHE;

  // 1. Bound context (spreadsheet menu / sidebar / dialog)
  try { _SS_CACHE = SpreadsheetApp.getActiveSpreadsheet(); } catch(e) {}

  // 2. Script Properties (set by initializeProject or onOpen)
  if (!_SS_CACHE) {
    try {
      var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
      if (id) _SS_CACHE = SpreadsheetApp.openById(id);
    } catch(e) {}
  }

  // 3. Auto-discover via DriveApp (works for bound scripts in web app context)
  if (!_SS_CACHE) {
    try {
      var parents = DriveApp.getFileById(ScriptApp.getScriptId()).getParents();
      while (parents.hasNext()) {
        var p = parents.next();
        if (p.getMimeType() === MimeType.GOOGLE_SHEETS) {
          _SS_CACHE = SpreadsheetApp.openById(p.getId());
          break;
        }
      }
    } catch(e) {}
  }

  // Persist ID once found so future calls skip DriveApp
  if (_SS_CACHE) {
    try {
      PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', _SS_CACHE.getId());
    } catch(e) {}
  }

  return _SS_CACHE;
}

function onOpen() {
  // Auto-persist spreadsheet ID so web app context (Dashboard, etc.) can find the sheet
  try {
    PropertiesService.getScriptProperties()
      .setProperty('SPREADSHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  } catch(e) {}
  // Ensure all required CONFIG keys exist (adds missing ones without touching existing)
  ensureConfigKeys_();
  // Ensure MASTERS_Materials has the Default Location column (idempotent)
  try { ensureMaterialsLocationColumn_(); } catch(e) {}
  SpreadsheetApp.getUi()
    .createMenu('QMS System')
    .addItem('⚙️  Setup / Initialize Project', 'initializeProject')
    .addItem('🩺  Verify & Repair Sheets', 'verifyAndRepairSheets')
    .addItem('🔧  Force Release Stuck Lock','forceReleaseStuckLock')
    .addItem('🔬  Inspect Sheet Data',     'inspectSheetData')
    .addItem('🔨  Force-Fix Sheet Headers','forceFixSheetHeaders')
    .addItem('🔢  Verify Doc Counters',    'verifyDocCounters')
    .addItem('🌱  Verify Masters Seed',    'verifyMastersSeed')
    .addItem('🧪  Smoke Test Batch Flow',  'smokeTestBatchFlow')
    .addItem('🧫  Run Integration Smoke',  'runIntegrationSmoke')
    .addItem('🩻  Diagnose Production Pipeline','runProductionDiagnostics')
    .addItem('🛰️  Trace Lots for One Material','traceFormPathForMaterial')
    .addItem('🩺  Diagnose Dispatch Pipeline','runDispatchDiagnostics')
    .addItem('🛰️  Trace FG Lots for Customer+Product','traceFGDispatchForCustomerProduct')
    .addItem('♻️  Backfill FG Dispatch Lots','backfillFGDispatchLotsFromOQCUI')
    .addItem('📋  New Purchase Order', 'openPOPForm')
    .addItem('📊  Run POP Diagnostics', 'runPOPDiag')
    .addItem('🛰️  Trace PO by docNo', 'tracePOByDocNoUI')
    .addItem('♻️  Reconcile PO Receipts (Self-Heal)', 'reconcilePOReceipts')
    .addItem('🚚  New Dispatch (FIFO)','openDispatchForm')
    .addItem('🔍  Diagnose Production Lots','diagnoseProductionLotsUI')
    .addItem('♻️  Backfill Stock Ledger from GRN','backfillStockLedgerFromGRNUI')
    .addItem('📍  Backfill GRN Locations (from Master)','backfillGRNLocationsUI')
    .addItem('🧨  Raise Test NCR',         'testRaiseNCR')
    .addItem('🔎  Diagnose OQC→Gatepass',  'diagnoseOQCDropdown')
    .addSeparator()
    .addItem('📥  New GRN', 'openGRNForm')
    .addItem('🔍  New IQC', 'openIQCForm')
    .addItem('🏭  New IPQC Check', 'openIPQCForm')
    .addItem('📤  New OQC', 'openOQCForm')
    .addItem('📋  NCR Triage',   'openNCRForm')
    .addItem('📦  Customer Returns', 'openCustomerReturnForm')
    .addSeparator()
    .addItem('📊  Open Dashboard', 'openDashboard')
    .addItem('📋  Records', 'openRecords')
    .addItem('📊  Open KPI Dashboard', 'openKPIDashboard')
    .addItem('📊  Run KPI Diagnostics', 'runKPIDiag')
    .addItem('♻️  Flush KPI Cache', 'kpiCacheFlush')
    .addItem('📲  Send WhatsApp (selected row)', 'sendWhatsAppSelected')
    .addSeparator()
    .addItem('📂  Import Past Data (CSV)', 'openImportCSV')
    .addSeparator()
    .addItem('🔬  Seed Default Quality Parameters', 'seedDefaultParameters')
    .addToUi();
}

// ── Form launchers ────────────────────────────────────────────

function openGRNForm() {
  var html = HtmlService.createTemplateFromFile('GRN_F').evaluate()
    .setTitle('New GRN')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

function openIQCForm() {
  var html = HtmlService.createTemplateFromFile('IQC_F').evaluate()
    .setWidth(640)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'New IQC — Incoming Inspection');
}

function openOQCForm() {
  var html = HtmlService.createTemplateFromFile('OQC_F').evaluate()
    .setWidth(640)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'New OQC — Outgoing Quality Check');
}

function openDashboard() {
  var html = HtmlService.createTemplateFromFile('Dashboard_F').evaluate()
    .setWidth(900)
    .setHeight(620);
  SpreadsheetApp.getUi().showModelessDialog(html, 'QMS Dashboard — Pack Masters');
}

function openImportCSV() {
  var html = HtmlService.createTemplateFromFile('ImportCSV_F').evaluate()
    .setWidth(500)
    .setHeight(320);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Import Past Data (CSV)');
}

function openNCRForm() {
  var html = HtmlService.createTemplateFromFile('NCR_F').evaluate()
    .setWidth(740)
    .setTitle('NCR Triage');
  SpreadsheetApp.getUi().showModalDialog(html, 'NCR Triage');
}

function openCustomerReturnForm() {
  var html = HtmlService.createTemplateFromFile('CustomerReturn_F').evaluate()
    .setWidth(740)
    .setTitle('Customer Returns');
  SpreadsheetApp.getUi().showModalDialog(html, 'Customer Returns');
}

function openReworkForm() {
  var html = HtmlService.createTemplateFromFile('Rework_F').evaluate()
    .setWidth(480)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Rework');
}

function openIPQCForm() {
  var html = HtmlService.createTemplateFromFile('IPQC_F').evaluate()
    .setWidth(640)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'IPQC — In-Process Quality Check');
}

function openPOPForm() {
  var html = HtmlService.createTemplateFromFile('POP_F').evaluate()
    .setWidth(900)
    .setHeight(620);
  SpreadsheetApp.getUi().showModelessDialog(html, 'New Purchase Order — Pack Masters QMS');
}

function tracePOByDocNoUI() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Trace PO by docNo', 'Enter PO number (e.g. PM/PO/2026-001):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var poNo = resp.getResponseText().trim();
  if (!poNo) { ui.alert('No PO number entered.'); return; }
  tracePOById(poNo);
}

function openDispatchForm() {
  var html = HtmlService.createTemplateFromFile('Dispatch_F').evaluate()
    .setWidth(900)
    .setHeight(620);
  SpreadsheetApp.getUi().showModelessDialog(html, 'New Dispatch (FIFO) — Pack Masters QMS');
}

function openKPIDashboard() {
  var html = HtmlService.createTemplateFromFile('KPI_F').evaluate()
    .setWidth(1000)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'KPI Dashboard — Pack Masters QMS');
}

function openRecords() {
  var html = HtmlService.createTemplateFromFile('Records_F').evaluate()
    .setWidth(900)
    .setHeight(620);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Records — Pack Masters QMS');
}

// ── Web App — page router ─────────────────────────────────────

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'saveIQCVideo') {
      var url = saveIQCVideo_(body.base64, body.mime, body.ext,
                              body.docNo, body.grnNo, body.materialDesc, body.disposition);
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, url: url }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(ex) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: ex.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Auto-store spreadsheet ID on first web app hit (bound script context)
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('SPREADSHEET_ID')) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) props.setProperty('SPREADSHEET_ID', ss.getId());
    }
  } catch(ex) {}

  // Diagnostic JSON endpoint — bypasses HTML rendering for headless smoke tests
  var diag = e && e.parameter && e.parameter.diag ? String(e.parameter.diag) : '';
  if (diag === 'trace') {
    var out;
    try { out = (typeof diagTraceSmoke === 'function') ? diagTraceSmoke() : 'diagTraceSmoke missing'; }
    catch (er) { out = 'ERROR: ' + er.message + '\n' + (er.stack||''); }
    return ContentService.createTextOutput(String(out)).setMimeType(ContentService.MimeType.TEXT);
  }

  // QR code deep-link: ?doc=PM/IQC/2026-189 → route to DocView
  var docParam = e && e.parameter && e.parameter.doc ? String(e.parameter.doc).trim() : '';
  if (docParam) {
    var dvTpl = HtmlService.createTemplateFromFile('DocView_F');
    dvTpl.scriptUrl = ScriptApp.getService().getUrl();
    dvTpl.docNo = docParam;
    dvTpl.type = '';
    return dvTpl.evaluate()
      .setTitle('Document — Pack Masters QMS')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var page = e && e.parameter && e.parameter.page ? String(e.parameter.page).toLowerCase() : '';
  var template;
  // Canonical lowercase keys → { file, title }
  // Pages that require owner mode (pm.ui.ownerMode = 'true' in Script Properties).
  // Anonymous/non-owner callers get redirected to the landing page.
  var ADMIN_PAGES_ = { settings: true, masterscrud: true };

  var pageMap = {
    masters:        { file: 'Masters_F',        title: 'Masters' },
    records:        { file: 'Records_F',        title: 'Records' },
    ncr:            { file: 'NCR_F',            title: 'NCR' },
    customerreturn: { file: 'CustomerReturn_F', title: 'Customer Return' },
    warehouse:      { file: 'Warehouse_F',      title: 'Warehouse' },
    settings:       { file: 'Settings_F',       title: 'Settings' },
    masterscrud:    { file: 'MastersCrud_F',    title: 'Masters CRUD' },
    scan:           { file: 'Scan_F',           title: 'Scan' },
    recorder:       { file: 'Recorder_F',       title: 'Record Defect Video' },
    rework:         { file: 'Rework_F',         title: 'Rework' }
  };
  if (pageMap[page]) {
    // Guard admin pages — same owner check used by _mastersRequireOwner_()
    if (ADMIN_PAGES_[page]) {
      var ownerOn = String(PropertiesService.getScriptProperties().getProperty('pm.ui.ownerMode') || 'false') === 'true';
      if (!ownerOn) {
        page = ''; // fall through to landing
      }
    }
  }
  if (pageMap[page]) {
    var pgTpl = HtmlService.createTemplateFromFile(pageMap[page].file);
    pgTpl.scriptUrl = ScriptApp.getService().getUrl();
    template = pgTpl.evaluate().setTitle(pageMap[page].title + ' — Pack Masters QMS');
  } else {
    var landingTpl = HtmlService.createTemplateFromFile('Landing');
    landingTpl.scriptUrl = ScriptApp.getService().getUrl();
    template = landingTpl.evaluate().setTitle('Pack Masters QMS');
  }
  return template.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Called by client to inject sub-pages ─────────────────────

function getFormHtml(type) {
  // Guard admin forms — Settings and MastersCrud must not be served to non-owners
  // even via google.script.run (which bypasses the doGet URL-level guard).
  var ADMIN_FORMS_ = { Settings: true, MastersCrud: true };
  if (ADMIN_FORMS_[type]) {
    var ownerOn = String(PropertiesService.getScriptProperties().getProperty('pm.ui.ownerMode') || 'false') === 'true';
    if (!ownerOn) throw new Error('Owner mode required');
  }
  // Server-side HTML cache: forms are templates, only change on deploy.
  // Cache for 6 hours (CacheService max). On every new deploy users hard-reload anyway.
  var cacheKey = 'pmqms_formhtml_v15_' + String(type || 'Landing');
  try {
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return hit;
  } catch (e) {}
  var pageMap = { GRN:'GRN_F', IQC:'IQC_F', OQC:'OQC_F', IPQC:'IPQC_F', Dashboard:'Dashboard_F', ImportCSV:'ImportCSV_F', Records:'Records_F', Gatepass:'Gatepass_F', Masters:'Masters_F', ControlPlan:'ControlPlan_F', CustomerReturn:'CustomerReturn_F', Production:'Production_F', Dispatch:'Dispatch_F', PO:'POP_F', KPI:'KPI_F', Warehouse:'Warehouse_F', NCR:'NCR_F', Settings:'Settings_F', MastersCrud:'MastersCrud_F', Trace:'Trace_F', Landing:'Landing', Recorder:'Recorder_F', Rework:'Rework_F', Scan:'Scan_F', QMSV2:'QMSV2_F' };
  var page = pageMap[type] || 'Landing';
  var tpl = HtmlService.createTemplateFromFile(page);
  tpl.scriptUrl = ScriptApp.getService().getUrl();
  var html = tpl.evaluate().getContent();
  try {
    // Chunk if needed — CacheService per-key cap is 100KB; many forms exceed
    if (html.length < 100000) {
      CacheService.getScriptCache().put(cacheKey, html, 21600); // 6 hours
    }
  } catch (e) {}
  return html;
}

function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

function getLandingHtml() {
  return HtmlService.createTemplateFromFile('Landing').evaluate().getContent();
}

// ── WhatsApp from selected row ────────────────────────────────

function sendWhatsAppSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var row = sheet.getActiveRange().getRow();
  var sheetName = sheet.getName();

  if (row < 3) {
    SpreadsheetApp.getUi().alert('Please select a data row first.');
    return;
  }

  var record = null;
  if (sheetName === 'GRN_LOG')      record = getGRNRowForWA(row);
  else if (sheetName === 'IQC_LOG') record = getIQCRowForWA(row);
  else if (sheetName === 'OQC_LOG') record = getOQCRowForWA(row);
  else {
    SpreadsheetApp.getUi().alert('Please select a row in GRN_LOG, IQC_LOG, or OQC_LOG.');
    return;
  }

  if (!record) {
    SpreadsheetApp.getUi().alert('No data found in selected row.');
    return;
  }

  var url = buildWhatsAppURL(record);
  var html = HtmlService.createHtmlOutput(
    '<p style="font-family:Arial;font-size:13px;color:#333;">Click below to open WhatsApp with the pre-filled message:</p>' +
    '<a href="' + url + '" target="_blank" style="display:block;background:#0D1B6E;color:#fff;padding:12px 20px;' +
    'text-decoration:none;border-radius:6px;text-align:center;font-family:Arial;font-weight:bold;margin-top:8px;">' +
    '📲 Open WhatsApp</a>' +
    '<script>window.onload=function(){window.open("' + url + '","_blank");}</script>'
  ).setWidth(320).setHeight(140);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Send WhatsApp Update');
}


// Returns true PENDING counts per module (not today-only).
// Each module defines its own "pending" semantic:
//   PO            = PO_LOG rows with status OPEN / PARTIAL (not CLOSED/CANCELLED)
//   GRN           = GRN_LOG rows whose disposition not finalized (PENDING_INSPECTION)
//                   AND no IQC session yet matched
//   IQC           = IQC sessions OPEN (not COMPLETE/CLOSED) or GRNs awaiting IQC
//   IPQC          = IPQC_Sessions with status OPEN
//   Production    = PROD_JOBS with Status = BOOKED (not yet PRODUCED)
//   OQC           = OQC_LOG rows with disposition pending (not RELEASED/REJECTED)
//   Gatepass      = GATEPASS_LOG rows status OPEN / IN_TRANSIT (not RETURNED)
//   Dispatch     = DISPATCH_LOG rows not delivered (status anything except DELIVERED)
//   NCR          = NCR_LOG rows with status OPEN / IN_PROGRESS (not CLOSED)
//   CustomerReturn = CR_LOG rows with status OPEN / IN_PROGRESS (not CLOSED)
function computePendingCounts_(ss) {
  var c = { PO:0, GRN:0, IQC:0, IPQC:0, Production:0, OQC:0, Gatepass:0, Dispatch:0, NCR:0, CustomerReturn:0 };
  // Side-channel: breakdown per module — { GRN: {PENDING:5, HOLD:3}, ... }
  var brk = {};

  function countWhere(modKey, sheetName, statusCol, isPendingFn) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) { brk[modKey] = {}; return 0; }
    var data = sh.getDataRange().getValues();
    var hdr = data[0];
    var idx = (typeof statusCol === 'number') ? statusCol :
      hdr.findIndex(function(h){ return String(h).toLowerCase().trim() === String(statusCol).toLowerCase().trim(); });
    if (idx < 0) { brk[modKey] = {}; return 0; }
    var seen = {};
    var n = 0;
    var dist = {};
    for (var r = 1; r < data.length; r++) {
      var st = String(data[r][idx] || '').toUpperCase().trim();
      if (!isPendingFn(st)) continue;
      var docNo = data[r][0];
      if (seen[docNo]) continue;
      seen[docNo] = true;
      n++;
      var label = st || 'PENDING';
      dist[label] = (dist[label] || 0) + 1;
    }
    brk[modKey] = dist;
    return n;
  }
  // expose breakdowns on c (consumed by caller)
  c.__breakdowns = brk;

  // PO_HEADER status column index 11 (after PO_NO, Date, Supplier, etc.) — we use header lookup instead
  try {
    c.PO = countWhere('PO', 'PO_HEADER', 'status', function(s){
      return s === 'OPEN' || s === 'PARTIAL' || s === 'PARTIAL_RECEIVED' || s === 'SUBMITTED' || s === 'DRAFT';
    });
  } catch(e) { Logger.log('PO count: ' + e); }

  // GRN: rows where IQC Status is still PENDING (header = "IQC Status")
  try {
    c.GRN = countWhere('GRN', 'GRN_LOG', 'IQC Status', function(s){
      return s === '' || s === 'PENDING' || s === 'PENDING_INSPECTION' || s === 'AWAITING_IQC';
    });
  } catch(e) { Logger.log('GRN count: ' + e); }

  // IQC: rows where Disposition is still pending (not ACCEPTED/REJECTED)
  try {
    c.IQC = countWhere('IQC', 'IQC_LOG', 'Disposition', function(s){
      return s === '' || s === 'PENDING' || s === 'PENDING_DISPOSITION' || s === 'IN_PROGRESS' || s === 'HOLD' || s === 'ON_HOLD';
    });
  } catch(e) { Logger.log('IQC count: ' + e); }

  // IPQC: sessions where status is OPEN
  try {
    c.IPQC = countWhere('IPQC', 'IPQC_Sessions', 'status', function(s){
      return s === 'OPEN' || s === 'IN_PROGRESS';
    });
  } catch(e) { Logger.log('IPQC count: ' + e); }

  // Production: PROD_JOBS where Status = BOOKED
  try {
    c.Production = countWhere('Production', 'PROD_JOBS', 'Status', function(s){ return s === 'BOOKED'; });
  } catch(e) { Logger.log('Production count: ' + e); }

  // OQC: rows where Release Decision is still pending
  try {
    c.OQC = countWhere('OQC', 'OQC_LOG', 'Release Decision', function(s){
      return s === '' || s === 'PENDING' || s === 'PENDING_DISPOSITION' || s === 'OPEN' || s === 'HOLD';
    });
  } catch(e) { Logger.log('OQC count: ' + e); }

  // Gatepass: STATUS = OPEN / IN_TRANSIT / ISSUED (not RETURNED / CLOSED / CANCELLED)
  try {
    c.Gatepass = countWhere('Gatepass', 'GATEPASS_LOG', 'STATUS', function(s){
      return s === 'OPEN' || s === 'IN_TRANSIT' || s === 'ISSUED' || s === '';
    });
  } catch(e) { Logger.log('Gatepass count: ' + e); }

  // Dispatch: FG_DISPATCH_LOTS — only actionable lots (not yet fully dispatched)
  try {
    c.Dispatch = countWhere('Dispatch', 'FG_DISPATCH_LOTS', 14, function(s){
      return s === 'AVAILABLE' || s === 'PARTIAL' || s === 'NEEDS_REVIEW' || s === '';
    });
  } catch(e) { Logger.log('Dispatch count: ' + e); }

  try {
    c.NCR = countWhere('NCR', 'NCR_LOG', 'Status', function(s){
      return s === 'OPEN' || s === 'IN_PROGRESS' || s === 'PENDING' || s === '';
    });
  } catch(e) { Logger.log('NCR count: ' + e); }

  try {
    c.CustomerReturn = countWhere('CustomerReturn', 'CUSTOMER_RETURN_LOG', 'Status', function(s){
      return s === 'OPEN' || s === 'IN_PROGRESS' || s === 'PENDING' || s === '';
    });
  } catch(e) { Logger.log('CR count: ' + e); }

  return c;
}

// Guard for diagnostic functions. Passes when:
//   (a) the caller is authenticated — Session.getActiveUser().getEmail() returns a non-empty
//       string (reliable for clasp run and signed-in owner browser sessions); OR
//   (b) pm.ui.ownerMode Script Property is 'true' (fallback for edge cases).
// Throws for anonymous google.script.run callers (email is '' for unauthenticated sessions).
function _diagRequireOwner_() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch(e) {}
  if (email) return; // authenticated (clasp run as owner, or signed-in owner session)
  var on = String(PropertiesService.getScriptProperties().getProperty('pm.ui.ownerMode') || 'false') === 'true';
  if (!on) throw new Error('Owner mode required for diagnostic functions.');
}

function diag_pendingCounts() {
  _diagRequireOwner_();
  return JSON.stringify(computePendingCounts_(getSpreadsheet()), null, 2);
}

// Public callable: returns the pending counts object (without breakdowns)
// for frontends that need just the numbers.
function getPendingCountsJSON() {
  var c = computePendingCounts_(getSpreadsheet());
  delete c.__breakdowns;
  return c;
}

function diag_statusValues() {
  _diagRequireOwner_();
  var ss = getSpreadsheet();
  var probes = [
    ['PO_HEADER', 'status'],
    ['IQC_LOG', 'Disposition'],
    ['OQC_LOG', 'Release Decision'],
    ['CUSTOMER_RETURN_LOG', 'Status']
  ];
  var out = {};
  probes.forEach(function(p){
    var sh = ss.getSheetByName(p[0]);
    if (!sh) { out[p[0]] = '(missing)'; return; }
    var data = sh.getDataRange().getValues();
    var hdr = data[0];
    var idx = hdr.findIndex(function(h){ return String(h).toLowerCase().trim() === p[1].toLowerCase().trim(); });
    if (idx < 0) { out[p[0]] = 'col "' + p[1] + '" not found; headers=' + hdr.join('|'); return; }
    var values = {};
    for (var r = 1; r < data.length; r++) {
      var v = String(data[r][idx] || '(empty)').trim();
      values[v] = (values[v] || 0) + 1;
    }
    out[p[0]] = { col: p[1], idx: idx, distribution: values };
  });
  return JSON.stringify(out, null, 2);
}

function diag_sheetHeaders() {
  _diagRequireOwner_();
  var ss = getSpreadsheet();
  var names = ['PO_LOG','GRN_LOG','IQC_LOG','IQC_Sessions','IPQC_Sessions','PROD_JOBS','OQC_LOG','GATEPASS_LOG','DISPATCH_LOG','NCR_LOG','CR_LOG','CUSTOMER_RETURN_LOG'];
  var out = {};
  names.forEach(function(n){
    var sh = ss.getSheetByName(n);
    if (!sh) { out[n] = '(missing)'; return; }
    if (sh.getLastRow() < 1) { out[n] = '(empty)'; return; }
    out[n] = {
      rows: sh.getLastRow() - 1,
      headers: sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]
    };
  });
  return JSON.stringify(out, null, 2);
}

// ─── Shared cache helpers ──────────────────────────────────────────
// CacheService is per-script, 6 hours max. We use 60s TTL for hot reads;
// writes call invalidatePmCache_() to clear stale entries.
var PMQMS_CACHE_TTL_S_ = 60;

// Auto-invalidating cache: stores cache entries with a sheet-mtime fingerprint.
// On read, compares current sheet mtime to cached fingerprint; cache miss if sheet has been edited.
// Avoids manual invalidation in every write path.
function _pmSheetFingerprint_() {
  try {
    var ss = getSpreadsheet();
    // Use the file's last-modified ms as fingerprint. Cheap.
    return String(DriveApp.getFileById(ss.getId()).getLastUpdated().getTime());
  } catch (e) { return '0'; }
}
function _pmCacheGet_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    // Fingerprint mismatch => sheet changed; cache stale
    if (obj.fp !== _pmSheetFingerprint_()) return null;
    return obj.data;
  } catch (e) { return null; }
}
function _pmCachePut_(key, val) {
  try {
    var obj = { fp: _pmSheetFingerprint_(), data: val };
    var s = JSON.stringify(obj);
    if (s.length < 100000) {
      CacheService.getScriptCache().put(key, s, PMQMS_CACHE_TTL_S_);
    }
  } catch (e) {}
}
function invalidatePmCache_() {
  try {
    CacheService.getScriptCache().removeAll([
      'pmqms_landing_v1', 'pmqms_records_counts_v1', 'pmqms_pending_v1',
      'pmqms_records_list_GRN', 'pmqms_records_list_IQC', 'pmqms_records_list_OQC',
      'pmqms_records_list_IPQC', 'pmqms_records_list_Gatepass', 'pmqms_records_list_ALL'
    ]);
  } catch (e) {}
}

function getQmsLandingState() {
  var cached = _pmCacheGet_('pmqms_landing_v1');
  if (cached) return cached;
  var result = _computeQmsLandingState_();
  _pmCachePut_('pmqms_landing_v1', result);
  return result;
}

function _computeQmsLandingState_(ss, counts) {
  if (!ss) ss = getSpreadsheet();
  var today = new Date().toDateString();
  // Start with TRUE pending counts per module
  if (!counts) counts = computePendingCounts_(ss);
  var schemaFallback = {
    GRN_LOG:      { tsIdx: 17, docIdx: 0, dedup: true  },
    IQC_LOG:      { tsIdx: 28, docIdx: 0, dedup: false },
    OQC_LOG:      { tsIdx: 18, docIdx: 0, dedup: false },
    GATEPASS_LOG: { tsIdx: 17, docIdx: 0, dedup: true  }
  };
  // NOTE: counts is now driven by computePendingCounts_(ss) above (true pending).
  // The legacy today-only adders below have been DISABLED — they were inflating
  // the pending counts with date-filtered numbers, producing wrong totals.
  // If today-only counts are needed elsewhere, expose them via a separate field.
  /* DISABLED — legacy today-only counters
  var sheetMap = { GRN: 'GRN_LOG', IQC: 'IQC_LOG', OQC: 'OQC_LOG', Gatepass: 'GATEPASS_LOG' };
  Object.keys(sheetMap).forEach(function(type) {
    var shName = sheetMap[type];
    var fb = schemaFallback[shName];
    var sh = ss.getSheetByName(shName);
    if (!sh || sh.getLastRow() < 2) return;
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var tsIdx = headers.indexOf('timestamp') >= 0 ? headers.indexOf('timestamp') : fb.tsIdx;
    var seen = {};
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var ts = row[tsIdx];
      if (!ts) continue;
      if (new Date(ts).toDateString() !== today) continue;
      if (fb.dedup) {
        var docNo = row[fb.docIdx];
        if (seen[docNo]) continue;
        seen[docNo] = true;
      }
      counts[type]++;
    }
  });
  (function() {
    var sh = ss.getSheetByName('IPQC_Sessions');
    if (!sh || sh.getLastRow() < 2) return;
    var data = sh.getDataRange().getValues();
    var todayYmd = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    for (var r = 1; r < data.length; r++) {
      var rowDate = data[r][6] instanceof Date
        ? Utilities.formatDate(data[r][6], 'Asia/Kolkata', 'yyyy-MM-dd')
        : String(data[r][6]).trim();
      if (rowDate === todayYmd) counts.IPQC++;
    }
  })();
  END DISABLED */

  // ── Real pending actions ──────────────────────────────────────────
  var pendingActions = [];
  var cutoff7 = new Date();
  cutoff7.setDate(cutoff7.getDate() - 7);

  // Rule 1: GRNs with status PENDING that have no IQC record
  try {
    var grnWs = ss.getSheetByName('GRN_LOG');
    var iqcWs = ss.getSheetByName('IQC_LOG');
    if (grnWs && grnWs.getLastRow() > 1) {
      // Build set of GRN numbers already in IQC_LOG (col 2, 0-indexed)
      var inspectedGrns = {};
      if (iqcWs && iqcWs.getLastRow() > 1) {
        var iqcVals = iqcWs.getRange(2, 3, iqcWs.getLastRow() - 1, 1).getValues();
        iqcVals.forEach(function(r) { if (r[0]) inspectedGrns[String(r[0]).trim()] = true; });
      }
      var grnData = grnWs.getDataRange().getValues();
      var seenGrn = {};
      for (var r = 1; r < grnData.length; r++) {
        var row = grnData[r];
        var gNo   = String(row[0] || '').trim();
        var gDate = row[1];
        var gMat  = String(row[7] || '').trim();
        var gStat = String(row[15] || '').trim().toUpperCase();
        if (!gNo || seenGrn[gNo]) continue;
        seenGrn[gNo] = true;
        if (gDate && new Date(gDate) < cutoff7) continue;
        if (gStat !== 'PENDING' && gStat !== '') continue;
        if (inspectedGrns[gNo]) continue;
        pendingActions.push({
          module: 'IQC',
          detail: 'IQC needed · ' + gNo + (gMat ? ' · ' + gMat : ''),
          grnNo:  gNo
        });
        if (pendingActions.length >= 10) break;
      }
    }
  } catch(e) { Logger.log('pendingActions Rule1: ' + e); }

  // Rule 2: OQC RELEASED with no matching Gatepass oqcRef
  try {
    if (pendingActions.length < 10) {
      var oqcWs = ss.getSheetByName('OQC_LOG');
      var gpWs  = ss.getSheetByName('GATEPASS_LOG');
      if (oqcWs && oqcWs.getLastRow() > 1) {
        var usedOqcRefs = {};
        if (gpWs && gpWs.getLastRow() > 1) {
          var gpVals = gpWs.getRange(2, 4, gpWs.getLastRow() - 1, 1).getValues();
          gpVals.forEach(function(r) { if (r[0]) usedOqcRefs[String(r[0]).trim()] = true; });
        }
        var oqcData = oqcWs.getDataRange().getValues();
        var seenOqc = {};
        for (var r = 1; r < oqcData.length; r++) {
          var row     = oqcData[r];
          var oNo     = String(row[0] || '').trim();
          var oDate   = row[1];
          var oBatch  = String(row[4] || '').trim();
          var oDecision = String(row[14] || '').trim().toUpperCase();
          if (!oNo || seenOqc[oNo]) continue;
          seenOqc[oNo] = true;
          if (oDate && new Date(oDate) < cutoff7) continue;
          if (oDecision !== 'RELEASED' && oDecision !== 'ACCEPTED') continue;
          if (usedOqcRefs[oNo]) continue;
          pendingActions.push({
            module: 'Gatepass',
            detail: 'Dispatch pending · ' + oNo + (oBatch ? ' · ' + oBatch : ''),
            oqcNo:  oNo
          });
          if (pendingActions.length >= 10) break;
        }
      }
    }
  } catch(e) { Logger.log('pendingActions Rule2: ' + e); }

  // Rule 3: IPQC sessions OPEN from before today
  try {
    if (pendingActions.length < 10) {
      var ipqcWs  = ss.getSheetByName('IPQC_Sessions');
      var todayYmd2 = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
      if (ipqcWs && ipqcWs.getLastRow() > 1) {
        var ipqcData = ipqcWs.getDataRange().getValues();
        for (var r = 1; r < ipqcData.length; r++) {
          var row      = ipqcData[r];
          var sId      = String(row[0] || '').trim();
          var sStatus  = String(row[9] || '').trim().toUpperCase();
          var sDateRaw = row[6];
          var sDateStr = sDateRaw instanceof Date
            ? Utilities.formatDate(sDateRaw, 'Asia/Kolkata', 'yyyy-MM-dd')
            : String(sDateRaw || '').trim();
          if (!sId || sStatus !== 'OPEN') continue;
          if (sDateStr >= todayYmd2) continue; // today's open sessions are normal
          pendingActions.push({
            module:    'IPQC',
            detail:    'Open session · ' + sId,
            sessionId: sId
          });
          if (pendingActions.length >= 10) break;
        }
      }
    }
  } catch(e) { Logger.log('pendingActions Rule3: ' + e); }

  // PO: count PARTIAL_RECEIVED (actionable — chase remaining qty)
  try {
    var poHdrWs = ss.getSheetByName('PO_HEADER');
    var poPartial = 0;
    if (poHdrWs && poHdrWs.getLastRow() > 1) {
      poHdrWs.getRange(2, 12, poHdrWs.getLastRow() - 1, 1).getValues().forEach(function(r) {
        if (String(r[0] || '').trim() === 'PARTIAL_RECEIVED') poPartial++;
      });
    }
    counts.PO = poPartial;
  } catch(e) { Logger.log('getQmsLandingState PO count: ' + e); }

  // ── Recent activity ───────────────────────────────────────────────
  // Pulls last few rows from each top-level log, merges, sorts newest-first.
  var recentActivity = [];
  try {
    var TZ = 'Asia/Kolkata';
    function fmtDate(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'dd MMM · HH:mm') : String(v || ''); }
    var logs = [
      { name: 'GRN_LOG',      type: 'GRN',      tsIdx: 17, docIdx: 0, statusIdx: 15 },
      { name: 'IQC_LOG',      type: 'IQC',      tsIdx: 28, docIdx: 0, statusIdx: 17 },
      { name: 'IPQC_Rounds',  type: 'IPQC',     tsIdx: 11, docIdx: 0, statusIdx: -1 },
      { name: 'OQC_LOG',      type: 'OQC',      tsIdx: 18, docIdx: 0, statusIdx: 14 },
      { name: 'GATEPASS_LOG', type: 'Gatepass', tsIdx: 17, docIdx: 0, statusIdx: 14 },
      { name: 'NCR_LOG',      type: 'NCR',      tsIdx: 16, docIdx: 0, statusIdx: 14 }
    ];
    logs.forEach(function(L) {
      try {
        var sh = ss.getSheetByName(L.name);
        if (!sh || sh.getLastRow() < 2) return;
        var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        // Resolve common header names if present
        var tsIdx = hdr.indexOf('timestamp') >= 0 ? hdr.indexOf('timestamp') : L.tsIdx;
        var statusIdx = hdr.indexOf('Status') >= 0 ? hdr.indexOf('Status') : L.statusIdx;
        // Read only the last ~30 rows to keep this cheap
        var lastRow = sh.getLastRow();
        var start = Math.max(2, lastRow - 30 + 1);
        var rng = sh.getRange(start, 1, lastRow - start + 1, sh.getLastColumn()).getValues();
        rng.forEach(function(row) {
          var docNo = row[L.docIdx];
          if (!docNo) return;
          var ts = tsIdx >= 0 ? row[tsIdx] : null;
          var st = statusIdx >= 0 ? row[statusIdx] : '';
          recentActivity.push({
            docNo:  String(docNo),
            type:   L.type,
            status: String(st || ''),
            date:   fmtDate(ts),
            _ts:    ts instanceof Date ? ts.getTime() : 0
          });
        });
      } catch(e) { Logger.log('recentActivity ' + L.name + ': ' + e); }
    });
    recentActivity.sort(function(a, b) { return b._ts - a._ts; });
    recentActivity = recentActivity.slice(0, 8).map(function(r) {
      delete r._ts; return r;
    });
  } catch(e) { Logger.log('recentActivity: ' + e); }

  var breakdowns = counts.__breakdowns || {};
  delete counts.__breakdowns;
  return { name: 'Team', role: 'user', todayCounts: counts, pendingBreakdowns: breakdowns, pendingActions: pendingActions, recentActivity: recentActivity };
}

// ============================================================
// Force-release a stuck script lock.
// Use after a hung save / timeout error to clear residual state.
// ============================================================
function forceReleaseStuckLock() {
  var ui = SpreadsheetApp.getUi();
  var report = [];

  // Test all three lock scopes — find which one is actually stuck.
  ['ScriptLock', 'DocumentLock', 'UserLock'].forEach(function(kind) {
    try {
      var lock = LockService['get' + kind]();
      var got = lock.tryLock(500);   // 500ms — long enough to actually try, short enough to not hang the menu
      if (got) {
        lock.releaseLock();
        report.push(kind + ': FREE');
      } else {
        report.push(kind + ': HELD (another execution holds it)');
      }
    } catch (e) {
      report.push(kind + ': ERROR — ' + e.message);
    }
  });

  ui.alert('Lock state report:\n\n' + report.join('\n') + '\n\nApps Script auto-releases held locks at the end of the holding execution (max 6 min). If the report shows HELD for ScriptLock and you see no Running executions, the holder is likely a stuck/abandoned tab — wait 6 minutes and retry.');
}
