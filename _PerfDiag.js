// ============================================================
// _PerfDiag.js — where does form-open time actually go?
//
// Driven by `node e2e-diag.js perfinit`. Read-only.
//
// The complaint is "forms load slow". Measured from the browser, GRN's shell
// appears at ~3.7s but its supplier dropdown is not usable until ~12.1s — so
// most of the wait is the boot RPC, not the HTML. This times each read that
// getGRNFormInit performs so the expensive one is a number, not a guess.
// ============================================================

function _perfTime_(label, fn) {
  var t0 = new Date().getTime();
  var n = -1, err = '';
  try {
    var out = fn();
    n = (out && out.length != null) ? out.length : (out ? 1 : 0);
  } catch (e) { err = ' ERR:' + e.message; }
  return { label: label, ms: new Date().getTime() - t0, n: n, err: err };
}

function perfFormInit() {
  var L = [];

  // Each read exactly as getGRNFormInit / getIQCFormInit call it.
  L.push(_perfTime_('peekNextDocNumber(grn)', function () { return peekNextDocNumber('grn'); }));
  L.push(_perfTime_('getSuppliers',   function () { return getSuppliers(); }));
  L.push(_perfTime_('getMaterials',   function () { return getMaterials(); }));
  L.push(_perfTime_('getInspectors',  function () { return getInspectors(); }));
  L.push(_perfTime_('getOpenRMLocations', function () {
    return (typeof getOpenRMLocations === 'function') ? getOpenRMLocations() : [];
  }));

  // Whole-call baseline: catches anything the parts miss (spreadsheet open,
  // serialization) and is the number the browser actually waits on.
  var whole = _perfTime_('== getGRNFormInit (whole)', function () { return getGRNFormInit(); });

  // Second call in the SAME execution — shows how much a per-request memo
  // would save. If this is ~0, the reads are already cached per request.
  var again = _perfTime_('== getGRNFormInit (2nd, same exec)', function () { return getGRNFormInit(); });

  var out = ['PERF — getGRNFormInit breakdown', ''];
  var sum = 0;
  L.forEach(function (r) {
    sum += r.ms;
    out.push(_perfPad_(r.label, 34) + _perfPad_(String(r.ms) + 'ms', 9) +
             'n=' + r.n + r.err);
  });
  out.push('');
  out.push(_perfPad_('sum of parts', 34) + sum + 'ms');
  out.push(_perfPad_(whole.label, 34) + whole.ms + 'ms' + whole.err);
  out.push(_perfPad_(again.label, 34) + again.ms + 'ms' + again.err);
  out.push('');

  // IQC measured 90s to shell / 180s to usable — by far the worst. Time its
  // boot read too, if the form exposes one.
  if (typeof getIQCFormInit === 'function') {
    var iqc = _perfTime_('== getIQCFormInit (whole)', function () { return getIQCFormInit(); });
    out.push(_perfPad_(iqc.label, 34) + iqc.ms + 'ms' + iqc.err);
  }
  if (typeof getPendingGRNsForIQC === 'function') {
    var pg = _perfTime_('getPendingGRNsForIQC', function () { return getPendingGRNsForIQC(); });
    out.push(_perfPad_(pg.label, 34) + pg.ms + 'ms  n=' + pg.n + pg.err);
  }

  return out.join('\n');
}

function _perfPad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

// Sheet sizes — a read is slow because of how many rows it touches.
function perfSheets() {
  var ss = getSpreadsheet();
  var want = ['MASTERS_Materials', 'MASTERS_Suppliers', 'MASTERS_Parameters',
              'LOCATIONS', 'GRN_LOG', 'IQC_LOG', 'STOCK_LEDGER', 'DOC_COUNTERS'];
  var out = ['SHEET SIZES', ''];
  want.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.push(_perfPad_(name, 24) + '(missing)'); return; }
    out.push(_perfPad_(name, 24) +
      _perfPad_(sh.getLastRow() + ' rows', 12) + sh.getLastColumn() + ' cols');
  });
  return out.join('\n');
}

// Is the form-masters payload small enough for CacheService?
// _pmCachePut_ silently SKIPS anything >= 100KB, which would leave the cache
// permanently cold while looking correct in the source.
function perfCacheSize() {
  var m = _grnFormMasters_();
  var out = ['FORM-MASTERS PAYLOAD SIZE', ''];
  var total = 0;
  ['suppliers', 'materials', 'inspectors', 'locations'].forEach(function (k) {
    var s = JSON.stringify(m[k] || []).length;
    total += s;
    out.push(_perfPad_(k, 14) + _perfPad_(String((m[k] || []).length) + ' rows', 12) +
             s + ' bytes');
  });
  var wrapped = JSON.stringify({ fp: '1755000000000', data: m }).length;
  out.push('');
  out.push(_perfPad_('sum', 14) + total + ' bytes');
  out.push(_perfPad_('with wrapper', 14) + wrapped + ' bytes');
  out.push(_perfPad_('cache limit', 14) + '100000 bytes');
  out.push('');
  out.push(wrapped < 100000
    ? 'VERDICT: FITS — cache will store it.'
    : 'VERDICT: TOO BIG — _pmCachePut_ will silently skip; cache stays cold.');
  return out.join('\n');
}

// ── Image upload probe ────────────────────────────────────────────────
// uploadGRNImages() catches every failure and returns {success:false} with the
// message only in Logger, so the operator sees "unable to upload images" and we
// see nothing. This runs the SAME path with a 1x1 PNG and returns the real
// error, including which step threw.
function perfImgUpload() {
  var out = ['GRN IMAGE UPLOAD PROBE', ''];

  function step(label, fn) {
    try {
      var v = fn();
      out.push(_perfPad_(label, 30) + 'OK  ' + (v == null ? '' : String(v).slice(0, 90)));
      return v;
    } catch (e) {
      out.push(_perfPad_(label, 30) + 'THREW: ' + e.message);
      return null;
    }
  }

  // Probe the REST paths the product now uses, not the retired DriveApp ones.
  var parent = step('qmsRootFolderId_()', function () { return qmsRootFolderId_(); });
  var media  = step('qmsMediaFolderId_(GRN)', function () {
    return qmsMediaFolderId_('GRN', new Date());
  });

  // 1x1 transparent PNG — smallest valid payload the real path would carry.
  var px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  step('Utilities.base64Decode', function () {
    return Utilities.base64Decode(px).length + ' bytes';
  });

  var created = step('drvUploadBlob', function () {
    var blob = Utilities.newBlob(Utilities.base64Decode(px), 'image/png',
                                 'PROBE_' + Date.now() + '.png');
    return drvUploadBlob(blob, 'PROBE_' + Date.now() + '.png',
                         qmsMediaFolderId_('GRN', new Date())).id;
  });

  step('drvShareAnyone', function () {
    if (!created) throw new Error('skipped — upload failed');
    return drvShareAnyone(created);
  });

  step('PDF generation (drvHtmlToPdf)', function () {
    var r = drvHtmlToPdf('<h1>probe</h1>', 'PROBE_PDF_' + new Date().getTime(),
                         qmsMonthFolderId_('GRN', new Date()));
    drvTrash(r.id);
    return r.url;
  });

  // The real function, end to end.
  var res = step('uploadGRNImages() itself', function () {
    var r = uploadGRNImages([{ base64: px, mime: 'image/png', kind: 'doc' }]);
    return 'success=' + r.success + (r.error ? '  error=' + r.error : '') +
           '  docUrls=' + (r.docUrls || []).length;
  });

  // Clean up both probe files so the folder does not fill with 1x1 pngs.
  step('cleanup probe files', function () {
    var n = 0;
    if (created) { try { drvTrash(created); n++; } catch (e) {} }
    return n + ' trashed';
  });

  out.push('');
  // Drive quota needs drive.readonly — deliberately not requested. Skipped.
  return out.join('\n');
}

// ── Who is executing, and what can they reach? ────────────────────────
// "Why is it not permanent" needs the EXECUTING identity, not the manifest.
// A web app deployed USER_DEPLOYING runs as whoever created the deployment;
// if that grant predates the current scope list, DriveApp fails forever until
// that same account re-consents. ANYONE_ANONYMOUS means getActiveUser() is
// usually blank, so getEffectiveUser() is the one that matters.
function perfWhoAmI() {
  var out = ['EXECUTION IDENTITY & SCOPE REACH', ''];
  function probe(label, fn) {
    try { out.push(_perfPad_(label, 30) + 'OK   ' + String(fn())); }
    catch (e) { out.push(_perfPad_(label, 30) + 'FAIL ' + e.message.slice(0, 100)); }
  }
  probe('Session.getEffectiveUser', function () { return Session.getEffectiveUser().getEmail() || '(blank)'; });
  probe('Session.getActiveUser',    function () { return Session.getActiveUser().getEmail()   || '(blank)'; });
  probe('SpreadsheetApp (sheets)',  function () { return getSpreadsheet().getName(); });
  probe('DriveApp.getRootFolder',   function () { return DriveApp.getRootFolder().getName(); });
  probe('DriveApp.getFileById(ss)', function () {
    return DriveApp.getFileById(getSpreadsheet().getId()).getName();
  });
  probe('ScriptApp.getOAuthToken',  function () {
    var t = ScriptApp.getOAuthToken();
    return t ? ('token len=' + t.length) : '(none)';
  });
  // The authoritative answer: ask Google which scopes THIS token actually holds.
  probe('tokeninfo -> granted scopes', function () {
    var r = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' +
      encodeURIComponent(ScriptApp.getOAuthToken()), { muteHttpExceptions: true });
    var j = JSON.parse(r.getContentText());
    var sc = String(j.scope || '').split(/\s+/).filter(Boolean).map(function (s) {
      return s.replace('https://www.googleapis.com/auth/', '');
    });
    return '\n    ' + sc.sort().join('\n    ');
  });
  return out.join('\n');
}

// ── Blast radius of the restricted anonymous token ────────────────────
// Which user-facing features actually break? Each probe calls the same API the
// feature calls, so the answer is measured rather than inferred from grep.
function perfBlastRadius() {
  var out = ['FEATURE REACH UNDER THE WEB-APP TOKEN', ''];
  function probe(feature, api, fn) {
    var r;
    try { fn(); r = 'WORKS'; }
    catch (e) {
      r = /do not have permission|Required permissions/i.test(e.message)
        ? 'BLOCKED (scope)' : 'ERROR: ' + e.message.slice(0, 60);
    }
    out.push(_perfPad_(feature, 26) + _perfPad_(api, 22) + r);
  }

  probe('Save GRN/IQC/OQC rows', 'SpreadsheetApp', function () { getSpreadsheet().getName(); });
  // These used to test getRootFolder / getFileById(spreadsheet) — BOTH of which
  // drive.file legitimately forbids, because neither object was created by this
  // script. Under drive.file the honest test is: can the script create and reuse
  // its OWN folder and file? That is all the image and PDF paths actually do.
  probe('Image upload',          'DriveApp',       function () {
    var f = DriveApp.createFolder('PM_QMS_PROBE_' + new Date().getTime());
    f.createFile(Utilities.newBlob('x', 'text/plain', 'p.txt'));
    f.setTrashed(true);
  });
  probe('PDF generation',        'DriveApp',       function () {
    var f = DriveApp.createFolder('PM_QMS_PDFPROBE_' + new Date().getTime());
    var fl = f.createFile(Utilities.newBlob('<b>x</b>', 'text/html', 'p.html'));
    fl.getAs('application/pdf');
    f.setTrashed(true);
  });
  probe('QR code on documents',  'UrlFetchApp',    function () {
    UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  });
  probe('Telegram / WhatsApp',   'UrlFetchApp',    function () {
    UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  });
  probe('Email notifications',   'MailApp',        function () { MailApp.getRemainingDailyQuota(); });
  probe('Who is signed in',      'Session',        function () { Session.getEffectiveUser().getEmail(); });
  probe('Scheduled triggers',    'ScriptApp',      function () { ScriptApp.getProjectTriggers().length; });

  out.push('');
  out.push('Legend: BLOCKED (scope) = declared in appsscript.json but NOT in the');
  out.push('token this execution received. Re-consent does not change it while');
  out.push('the web app is deployed ANYONE_ANONYMOUS.');
  return out.join('\n');
}

// ── Print/PDF render probe ────────────────────────────────────────────
// "All saved PDFs have blank data." Renders the real template with real data and
// reports whether the embedded JSON is valid JavaScript. <?= ?> HTML-escapes it
// (" -> &quot;), so `d` never parses and every field renders empty — invisible
// unless you look at the produced HTML.
function perfPrintRender(docNo) {
  var out = ['PRINT TEMPLATE RENDER PROBE', ''];
  try {
    if (!docNo) {
      var ws = getSpreadsheet().getSheetByName('GRN_LOG');
      var v = ws.getRange(ws.getLastRow(), 1).getValue();
      docNo = String(v || '').trim();
    }
    out.push('docNo: ' + docNo);

    var data = getGRNPrintData(docNo);
    out.push('getGRNPrintData: OK  keys=' + Object.keys(data).length +
             '  supplier=' + (data.supplierName || '(none)') +
             '  items=' + ((data.items || []).length));

    var tmpl = HtmlService.createTemplateFromFile('PrintGRN_F');
    tmpl.printData = data;
    var html = tmpl.evaluate().getContent();
    out.push('rendered HTML: ' + html.length + ' bytes');

    // Pull the `var d = ...;` line back out and see if it is parseable JSON.
    // Anchored to end-of-LINE, not the first ';' — a ';' inside a remark or a
    // supplier name would otherwise truncate the capture and the probe would
    // report a parse failure the product does not have.
    var m = html.match(/var d = (.*);[ \t]*$/m);
    if (!m) { out.push('VERDICT: could not find the `var d =` assignment'); return out.join('\n'); }
    var snippet = m[1];
    out.push('embedded JSON head: ' + snippet.slice(0, 70));
    var escaped = snippet.indexOf('&quot;') >= 0 || snippet.indexOf('&#') >= 0;
    out.push('HTML-escaped?     : ' + (escaped ? 'YES — this is the blank-PDF bug' : 'no'));
    try {
      JSON.parse(snippet);
      out.push('JSON.parse        : OK');
    } catch (e) {
      out.push('JSON.parse        : FAILED — ' + e.message.slice(0, 70));
    }
    out.push('');
    out.push(escaped ? 'VERDICT: BLANK — template uses the escaping operator.'
                     : 'VERDICT: RENDERS — data reaches the page.');
  } catch (e) {
    out.push('THREW: ' + e.message);
  }
  return out.join('\n');
}

// ── Telegram probe ────────────────────────────────────────────────────
// notifyStage_ swallows every failure into Logger.log, so "notifications are
// not firing" gives no signal at all. This separates the three possible causes:
// not configured / blocked by scope / rejected by Telegram.
function perfTelegram() {
  var out = ['TELEGRAM NOTIFICATION PROBE', ''];
  function line(l, v) { out.push(_perfPad_(l, 26) + v); }

  var token = '', chat = '';
  try {
    var props = PropertiesService.getScriptProperties();
    token = props.getProperty('TelegramBotToken') || props.getProperty('TELEGRAM_BOT_TOKEN') || '';
    chat  = props.getProperty('TelegramChatID')   || props.getProperty('TELEGRAM_CHAT_ID')   || '';
  } catch (e) {}
  if (!token && typeof getConfigValue === 'function') {
    try { token = String(getConfigValue('TelegramBotToken') || ''); } catch (e) {}
    try { chat  = String(getConfigValue('TelegramChatID')   || ''); } catch (e) {}
  }
  line('bot token', token ? 'SET (len ' + token.length + ')' : 'MISSING');
  line('chat id',   chat  ? 'SET (' + chat + ')'             : 'MISSING');
  line('TelegramLib present', (typeof TelegramLib !== 'undefined') ? 'yes' : 'NO — file not pushed');

  // Can we reach the network at all? This is the scope question.
  try {
    UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
    line('UrlFetchApp', 'WORKS');
  } catch (e) {
    line('UrlFetchApp', 'BLOCKED — ' + e.message.slice(0, 60));
    out.push('');
    out.push('VERDICT: Telegram cannot fire. UrlFetchApp is unavailable to this');
    out.push('execution, so no outbound call of any kind can be made. Config is');
    out.push('irrelevant until that is resolved.');
    return out.join('\n');
  }

  // Network is fine — ask Telegram whether the bot itself is valid.
  if (!token) {
    out.push('');
    out.push('VERDICT: network OK but no bot token configured.');
    return out.join('\n');
  }
  try {
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe',
                              { muteHttpExceptions: true });
    var j = JSON.parse(r.getContentText());
    line('getMe', j.ok ? ('OK — @' + (j.result && j.result.username))
                       : ('REJECTED — ' + (j.description || r.getResponseCode())));
  } catch (e) {
    line('getMe', 'THREW — ' + e.message.slice(0, 60));
  }
  return out.join('\n');
}

// Did ShareKit actually make it into the served form HTML?
// The browser probe said window.PMShare was undefined; this checks the SOURCE
// the server produces, which separates "include broken" from "cache stale"
// from "client script threw".
function perfShareKit(form) {
  var out = ['SHAREKIT DELIVERY CHECK', ''];
  form = form || 'GRN';
  try {
    var html = getFormHtml(form);
    out.push('form            : ' + form);
    out.push('served bytes    : ' + html.length);
    out.push('has PMShare     : ' + (html.indexOf('window.PMShare') >= 0 ? 'YES' : 'NO'));
    out.push('has pm-share-btn: ' + (html.indexOf('pm-share-btn')   >= 0 ? 'YES' : 'NO'));
    out.push('has shareSlot   : ' + (html.indexOf('shareSlot')      >= 0 ? 'YES' : 'NO'));
    out.push('has PMShare.mount call: ' + (html.indexOf('PMShare.mount') >= 0 ? 'YES' : 'NO'));
    out.push('');
    out.push(html.indexOf('window.PMShare') >= 0
      ? 'VERDICT: ShareKit IS in the served HTML. If the browser says undefined,\n' +
        'the page is serving from a stale sessionStorage/CacheService copy, or a\n' +
        'script above it threw before PMShare was assigned.'
      : 'VERDICT: ShareKit is NOT in the served HTML — the include did not resolve.');
  } catch (e) {
    out.push('THREW: ' + e.message);
  }
  return out.join('\n');
}

// Does the WhatsApp message now carry the PDF, for every record type?
// Before this work, buildMessage_ never emitted pdfUrl in any branch.
function perfShareMsg() {
  var types = ['GRN','IQC','OQC','IPQC','Dispatch','Gatepass','CustomerReturn','PO','Rework'];
  var out = ['WHATSAPP MESSAGE — PDF + DEEP LINK PER TYPE', ''];
  types.forEach(function (t) {
    var msg = '';
    try {
      msg = buildWhatsAppURL({
        type: t, docNo: 'PM/' + t + '/2026-001', date: '12-Aug-2026',
        supplier: 'Test Supplier', customer: 'Test Customer',
        material: 'Test Material', batch: 'B-1', qty: 10,
        status: 'ACCEPTED', disposition: 'ACCEPTED', releaseDecision: 'RELEASED',
        pdfUrl: 'https://drive.google.com/file/d/TESTPDFID/view',
        recordUrl: 'https://example.com/?doc=X'
      });
      msg = decodeURIComponent(msg.replace('https://wa.me/?text=', ''));
    } catch (e) { msg = 'THREW ' + e.message; }
    var hasPdf  = msg.indexOf('TESTPDFID') >= 0;
    var hasLink = msg.indexOf('Open record') >= 0;
    var body    = msg.length;
    out.push(_perfPad_(t, 16) + _perfPad_('pdf=' + (hasPdf ? 'YES' : 'no'), 10) +
             _perfPad_('link=' + (hasLink ? 'YES' : 'no'), 11) + body + ' chars');
  });
  out.push('');
  out.push('sample (GRN):');
  try {
    var s = decodeURIComponent(buildWhatsAppURL({
      type: 'GRN', docNo: 'PM/GRN/2026-125', date: '12-Aug-2026',
      supplier: 'Sunraj Corrugators', material: 'Test', batch: 'B-1',
      qtyReceived: 100, status: 'PENDING',
      pdfUrl: 'https://drive.google.com/file/d/ABC/view'
    }).replace('https://wa.me/?text=', ''));
    s.split('\n').forEach(function (l) { out.push('   ' + l); });
  } catch (e) { out.push('   THREW ' + e.message); }
  return out.join('\n');
}
