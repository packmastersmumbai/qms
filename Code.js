// ============================================================
// Code.gs — Menu, Triggers, Form Launchers
// Pack Masters QMS | Google Apps Script
// ============================================================

// ── Spreadsheet accessor (works in both bound and web app context) ──
var _SS_CACHE = null;

const QMS_DWM_MAP = {
  GRN:      { project: 'Quality',    category: 'Inspection', priority: 'high' },
  IQC:      { project: 'Quality',    category: 'Inspection', priority: 'high' },
  OQC:      { project: 'Quality',    category: 'Inspection', priority: 'high' },
  IPQC:     { project: 'Production', category: 'Operations', priority: 'medium' },
  Gatepass: { project: 'Production', category: 'Operations', priority: 'medium' },
};
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
  SpreadsheetApp.getUi()
    .createMenu('QMS System')
    .addItem('⚙️  Setup / Initialize Project', 'initializeProject')
    .addSeparator()
    .addItem('📥  New GRN', 'openGRNForm')
    .addItem('🔍  New IQC', 'openIQCForm')
    .addItem('🏭  New IPQC Check', 'openIPQCForm')
    .addItem('📤  New OQC', 'openOQCForm')
    .addItem('🚚  New Gatepass', 'openGatpassForm')
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

function openIPQCForm() {
  var html = HtmlService.createTemplateFromFile('IPQC_F').evaluate()
    .setWidth(640)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'IPQC — In-Process Quality Check');
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

  var app = e && e.parameter && e.parameter.app ? String(e.parameter.app).toLowerCase() : '';
  if (app === 'dwm') return dwmDoGet_(e);

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

function dwmDoGet_(e) {
  var page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page).toLowerCase() : 'login';
  var validPages = { login:'Login_Dwm', dashboard:'Dashboard_Dwm', taskform:'TaskForm_Dwm', report:'Report_Dwm', admin:'Admin_Dwm', changepin:'Login_Dwm' };
  var tplName = validPages[page] || 'Login_Dwm';
  var tpl = HtmlService.createTemplateFromFile(tplName);
  tpl.scriptUrl = ScriptApp.getService().getUrl();
  return tpl.evaluate()
    .setTitle('Daily Work Manager')
    .addMetaTag('viewport','width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Called by client to inject sub-pages ─────────────────────

function getFormHtml(type) {
  var pageMap = { GRN: 'GRN_F', IQC: 'IQC_F', OQC: 'OQC_F', IPQC: 'IPQC_F', Dashboard: 'Dashboard_F', ImportCSV: 'ImportCSV_F', Records: 'Records_F', Gatepass: 'Gatepass_F', Masters: 'Masters_F', ControlPlan: 'ControlPlan_F', Landing: 'Landing', DwmLogin: 'Login_Dwm' };
  var page = pageMap[type] || 'Landing';
  return HtmlService.createTemplateFromFile(page).evaluate().getContent();
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

function autoQmsTask_(sessionId, type, title, linkedRecord) {
  try {
    if (!sessionId) return null;
    const map = QMS_DWM_MAP[type];
    if (!map) return null;
    return createTask(sessionId, {
      title: title,
      projectId: map.project,
      categoryId: map.category,
      priority: map.priority,
      linkedRecord: linkedRecord || ''
    });
  } catch (e) {
    console.error('autoQmsTask_ failed: ' + e.message);
    return null;
  }
}

function getQmsLandingState(sessionId) {
  const session = validateSessionFast_(sessionId);
  if (!session) return { authenticated: false };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = new Date();
  const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const counts = {};
  ['GRN_LOG', 'IQC_LOG', 'OQC_LOG'].forEach(sheetName => {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) { counts[sheetName] = 0; return; }
    const data = sh.getDataRange().getValues();
    counts[sheetName] = data.slice(1).filter(row => {
      const d = row[0];
      return d && Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd') === todayStr;
    }).length;
  });

  return {
    authenticated: true,
    operatorName: session.name || session.userId,
    todayCounts: counts
  };
}
