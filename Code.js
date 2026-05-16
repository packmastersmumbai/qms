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
    .addItem('🚚  New Gatepass', 'openGatpassForm')
    .addItem('📋  NCR Triage',   'openNCRForm')
    .addItem('📦  Customer Returns', 'openCustomerReturnForm')
    .addSeparator()
    .addItem('📊  Open Dashboard', 'openDashboard')
    .addItem('📋  Records', 'openRecords')
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

function openGatpassForm() {
  var html = HtmlService.createTemplateFromFile('Gatepass_F').evaluate()
    .setTitle('New Gatepass')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
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

function openRecords() {
  var html = HtmlService.createTemplateFromFile('Records_F').evaluate()
    .setWidth(900)
    .setHeight(620);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Records — Pack Masters QMS');
}

// ── Web App — page router ─────────────────────────────────────

function doGet(e) {
  // Auto-store spreadsheet ID on first web app hit (bound script context)
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('SPREADSHEET_ID')) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) props.setProperty('SPREADSHEET_ID', ss.getId());
    }
  } catch(ex) {}

  var page = e && e.parameter && e.parameter.page ? e.parameter.page : '';
  var template;
  if (page === 'masters') {
    template = HtmlService.createTemplateFromFile('Masters_F').evaluate()
      .setTitle('Masters — Pack Masters QMS');
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
  var pageMap = { GRN:'GRN_F', IQC:'IQC_F', OQC:'OQC_F', IPQC:'IPQC_F', Dashboard:'Dashboard_F', ImportCSV:'ImportCSV_F', Records:'Records_F', Gatepass:'Gatepass_F', Masters:'Masters_F', ControlPlan:'ControlPlan_F', CustomerReturn:'CustomerReturn_F', Production:'Production_F', Dispatch:'Dispatch_F', PO:'POP_F', Landing:'Landing' };
  var page = pageMap[type] || 'Landing';
  var tpl = HtmlService.createTemplateFromFile(page);
  tpl.scriptUrl = ScriptApp.getService().getUrl();
  return tpl.evaluate().getContent();
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


function getQmsLandingState() {
  var ss = getSpreadsheet();
  var today = new Date().toDateString();
  var counts = { GRN: 0, IQC: 0, IPQC: 0, OQC: 0, Gatepass: 0 };
  var schemaFallback = {
    GRN_LOG:      { tsIdx: 17, docIdx: 0, dedup: true  },
    IQC_LOG:      { tsIdx: 28, docIdx: 0, dedup: false },
    OQC_LOG:      { tsIdx: 18, docIdx: 0, dedup: false },
    GATEPASS_LOG: { tsIdx: 17, docIdx: 0, dedup: true  }
  };
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

  return { name: 'Team', role: 'user', todayCounts: counts, pendingActions: pendingActions };
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
