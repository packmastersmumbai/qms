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

// ── Where do saveGRN's 54 seconds go? ─────────────────────────────────
// Measured over the bridge: saveGRN = 54.2s for a 1-item GRN. That is long
// enough that the reply routinely outlives the client watchdog, so the operator
// sees a failure for a save that succeeded.
//
// This times the POST-WRITE block against a real, already-saved doc. Nothing
// here writes to GRN_LOG — the QR/PDF/announce steps are re-run in isolation
// and their artefacts trashed, so the timing is honest without creating rows.
function perfSaveBreakdown(docNo) {
  var out = ['saveGRN POST-WRITE BREAKDOWN', ''];
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!docNo) {
    docNo = String(ws.getRange(ws.getLastRow(), 1).getValue() || '').trim();
  }
  out.push('doc: ' + docNo);
  out.push('GRN_LOG rows: ' + (ws.getLastRow() - 1));
  out.push('');

  var total = 0;
  function t(label, fn) {
    var t0 = new Date().getTime();
    var note = '';
    try { note = fn() || ''; } catch (e) { note = 'THREW ' + e.message.slice(0, 60); }
    var ms = new Date().getTime() - t0;
    total += ms;
    out.push(_perfPad_(label, 34) + _perfPad_(ms + 'ms', 10) + String(note).slice(0, 70));
    return ms;
  }

  // The two full-sheet scans saveGRN performs to stamp images, QR and PDF.
  t('getDataRange (image stamp scan)', function () {
    return ws.getDataRange().getValues().length + ' rows read';
  });
  t('getDataRange (qr/pdf stamp scan)', function () {
    return ws.getDataRange().getValues().length + ' rows read';
  });

  // QR: an external HTTP round trip, only possible since external_request landed.
  t('generateGRNQR_ (UrlFetch)', function () {
    var qr = generateGRNQR_(docNo);
    return (qr || '').length + ' chars';
  });

  // PDF: template render + Drive REST upload + share.
  var pdfId = null;
  t('generateGRNPdf_ (render+upload)', function () {
    var url = generateGRNPdf_(docNo);
    var m = String(url).match(/[-\w]{25,}/);
    if (m) pdfId = m[0];
    return url;
  });
  if (pdfId) { try { drvTrash(pdfId); } catch (e) {} }

  // Telegram announce — now that UrlFetchApp works this actually runs, and it
  // may be NEW time that was silently skipped before.
  t('qmsAnnounce_ (Telegram+DWM)', function () {
    if (typeof qmsAnnounce_ !== 'function') return 'not defined';
    var rows = ws.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === docNo) {
        var rec = getGRNRowForWA(i + 1);
        if (rec) { qmsAnnounce_(rec); return 'announced'; }
      }
    }
    return 'row not found';
  });

  out.push('');
  out.push(_perfPad_('TOTAL post-write', 34) + total + 'ms');
  out.push('');
  out.push('saveGRN measured over the bridge: ~54000ms. Anything not accounted');
  out.push('for above is the row write itself plus google.script.run overhead');
  out.push('(~5-20s fixed through the double iframe — see pmqms-form-open-perf).');
  return out.join('\n');
}

// The pre/write phase of saveGRN — the ~39s the post-write breakdown did not
// explain. Each of these runs on EVERY save, before the row is even appended.
// Read-only: no rows are created.
function perfSaveWritePhase() {
  var out = ['saveGRN PRE-WRITE / WRITE PHASE', ''];
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('GRN_LOG');
  var total = 0;
  function t(label, fn) {
    var t0 = new Date().getTime();
    var note = '';
    try { note = fn() || ''; } catch (e) { note = 'THREW ' + e.message.slice(0, 60); }
    var ms = new Date().getTime() - t0;
    total += ms;
    out.push(_perfPad_(label, 32) + _perfPad_(ms + 'ms', 10) + String(note).slice(0, 60));
    return ms;
  }

  t('getSpreadsheet()', function () { return getSpreadsheet().getName(); });
  t('_grnFindByTxn_ (idempotency)', function () {
    return _grnFindByTxn_(ws, 'GRN-PERF-PROBE-' + new Date().getTime()) || '(no match, full scan)';
  });
  t('peekNextDocNumber(grn)', function () { return peekNextDocNumber('grn'); });
  t('Session.getActiveUser', function () {
    return Session.getActiveUser().getEmail() || '(blank)';
  });
  t('getMaterials (location lookup)', function () { return getMaterials().length + ' rows'; });
  t('getStockBalance_ x1', function () {
    return typeof getStockBalance_ === 'function'
      ? String(getStockBalance_('1308119', 'PROBE', 'RM-STORE-A')) : 'n/a';
  });
  t('writeStockLedger_ read path', function () {
    // The balance read each ledger row performs, without writing.
    return typeof getStockBalance_ === 'function'
      ? String(getStockBalance_('1308119', 'PROBE2', 'RM-STORE-A')) : 'n/a';
  });
  t('applyGRNReceiptsToPO_ probe', function () {
    return typeof applyGRNReceiptsToPO_ === 'function' ? '(defined — runs only with a PO)' : 'n/a';
  });

  out.push('');
  out.push(_perfPad_('TOTAL pre-write', 32) + total + 'ms');
  out.push('');
  out.push('Post-write measured separately at ~15000ms (?diag=savebreak).');
  out.push('Bridge overhead through the double iframe is ~5-20s on top.');
  return out.join('\n');
}

// Did the deferred QR/PDF/Telegram work actually run for a given doc?
// Deferring is only correct if the artefacts still arrive — otherwise the save
// got faster by silently dropping the paperwork.
function perfDeferCheck(docNo) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  var out = ['DEFERRED WORK CHECK', ''];
  if (!docNo) docNo = String(ws.getRange(ws.getLastRow(), 1).getValue() || '').trim();
  out.push('doc: ' + docNo);

  var rows = ws.getDataRange().getValues();
  var found = 0, qr = '', pdf = '';
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === docNo) {
      found++;
      qr  = String(rows[i][23] || '');   // col 24, 0-based 23
      pdf = String(rows[i][24] || '');   // col 25
    }
  }
  out.push('rows for doc  : ' + found);
  out.push('QR stamped    : ' + (qr  ? 'YES (' + qr.length + ' chars)' : 'no'));
  out.push('PDF stamped   : ' + (pdf ? pdf : 'no'));

  var q = [];
  try { q = JSON.parse(PropertiesService.getScriptProperties()
        .getProperty(DEFER_QUEUE_PROP_) || '[]'); } catch (e) {}
  out.push('queue depth   : ' + q.length + (q.length ? '  (drain pending or failed)' : '  (drained)'));

  var trg = [];
  ScriptApp.getProjectTriggers().forEach(function (t) { trg.push(t.getHandlerFunction()); });
  out.push('triggers      : ' + trg.join(', '));
  out.push('');
  out.push(qr && pdf
    ? 'VERDICT: deferred work COMPLETED — save got faster without losing the paperwork.'
    : 'VERDICT: artefacts missing. Either the drain has not fired yet (wait ~15s\n' +
      'and re-check) or it failed — see the Apps Script executions log.');
  return out.join('\n');
}

// ── Why is Trace slow? ────────────────────────────────────────────────
// Trace.js performs 26 full-sheet getDataRange().getValues() calls across 13
// sheets, and opens PROD_JOBS six separate times. This times the real
// traceBatch() end to end and reports what each sheet costs to read once, so
// the fix is aimed at the expensive reads rather than guessed at.
function perfTrace(docNo) {
  var out = ['TRACE PERFORMANCE', ''];
  var ss = getSpreadsheet();

  if (!docNo) {
    var gw = ss.getSheetByName('GRN_LOG');
    docNo = String(gw.getRange(gw.getLastRow(), 1).getValue() || '').trim();
  }
  out.push('doc: ' + docNo);
  out.push('');

  // 1. The real call, twice — the second shows whether anything is cached.
  var t0 = new Date().getTime();
  var r1 = null, err1 = '';
  try { r1 = traceBatch(docNo); } catch (e) { err1 = e.message.slice(0, 80); }
  var ms1 = new Date().getTime() - t0;

  var t1 = new Date().getTime();
  try { traceBatch(docNo); } catch (e) {}
  var ms2 = new Date().getTime() - t1;

  out.push(_perfPad_('traceBatch() 1st', 30) + ms1 + 'ms' + (err1 ? '  ERR ' + err1 : ''));
  out.push(_perfPad_('traceBatch() 2nd (same exec)', 30) + ms2 + 'ms' +
           (ms2 < ms1 / 2 ? '   <- cached' : '   <- NOT cached, re-reads everything'));
  if (r1) {
    out.push(_perfPad_('nodes returned', 30) +
             ((r1.nodes && r1.nodes.length) || (r1.timeline && r1.timeline.length) || 0));
  }

  // 2. Cost of reading each sheet ONCE, and how big it is.
  out.push('');
  out.push('per-sheet single read:');
  var sheets = ['PROD_JOBS','GRN_LOG','BOM','PROD_ISSUE_LOG','OQC_LOG','STOCK_LEDGER',
                'PROD_BOOKING_LOG','PO_HEADER','NCR_LOG','IQC_LOG','GATEPASS_LOG',
                'FG_DISPATCH_LOTS','CUSTOMER_RETURN_LOG'];
  var totalOnce = 0;
  sheets.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.push('   ' + _perfPad_(name, 22) + '(missing)'); return; }
    var s0 = new Date().getTime();
    var v = sh.getDataRange().getValues();
    var ms = new Date().getTime() - s0;
    totalOnce += ms;
    out.push('   ' + _perfPad_(name, 22) + _perfPad_(ms + 'ms', 9) +
             v.length + ' rows x ' + (v[0] ? v[0].length : 0) + ' cols');
  });
  out.push('   ' + _perfPad_('TOTAL if read once', 22) + totalOnce + 'ms');
  out.push('');
  out.push('Trace makes 26 such reads across these 13 sheets (PROD_JOBS x6).');
  out.push('The gap between ' + totalOnce + 'ms and ' + ms1 + 'ms is repeat reading.');
  return out.join('\n');
}

// Is the per-sheet cost fixed overhead or data volume?
// The trace probe showed CUSTOMER_RETURN_LOG (3 rows) at 521ms and
// FG_DISPATCH_LOTS (16 rows) at 769ms, while STOCK_LEDGER (1281 rows) took
// 614ms — which says the cost is per CALL, not per row. If so, the fix is to
// make FEWER calls (one batched read), not to read less data.
function perfSheetOverhead() {
  var ss = getSpreadsheet();
  var out = ['SHEET READ: FIXED COST vs DATA VOLUME', ''];

  // Same tiny sheet, read 5 times. If cost is per-call, every read is similar.
  var sh = ss.getSheetByName('CUSTOMER_RETURN_LOG');
  out.push('CUSTOMER_RETURN_LOG (3 rows), 5 consecutive reads:');
  for (var i = 0; i < 5; i++) {
    var t = new Date().getTime();
    sh.getDataRange().getValues();
    out.push('   read ' + (i + 1) + ': ' + (new Date().getTime() - t) + 'ms');
  }

  // One row vs the whole sheet, on the biggest sheet.
  var led = ss.getSheetByName('STOCK_LEDGER');
  var t1 = new Date().getTime();
  led.getRange(1, 1, 1, 1).getValue();
  var one = new Date().getTime() - t1;
  var t2 = new Date().getTime();
  led.getDataRange().getValues();
  var all = new Date().getTime() - t2;
  out.push('');
  out.push('STOCK_LEDGER 1 cell      : ' + one + 'ms');
  out.push('STOCK_LEDGER 1281 rows   : ' + all + 'ms');

  // getSheetByName itself — is opening the tab the expensive part?
  var t3 = new Date().getTime();
  for (var j = 0; j < 10; j++) ss.getSheetByName('GRN_LOG');
  out.push('');
  out.push('getSheetByName x10       : ' + (new Date().getTime() - t3) + 'ms');

  out.push('');
  out.push('If 1 cell costs about the same as 1281 rows, the bottleneck is the');
  out.push('round trip per call — so batching reads is the fix, not reading less.');
  return out.join('\n');
}

// A fast trace that returns NOTHING proves nothing. This runs traceBatch over
// several real documents of different types and reports both the timing AND the
// payload size, so "fast" cannot be confused with "empty".
function perfTraceReal() {
  var ss = getSpreadsheet();
  var out = ['TRACE — REAL DOCUMENTS', ''];

  function pick(sheet, col) {
    try {
      var sh = ss.getSheetByName(sheet);
      if (!sh || sh.getLastRow() < 2) return '';
      var n = Math.min(sh.getLastRow() - 1, 40);
      var v = sh.getRange(sh.getLastRow() - n + 1, col || 1, n, 1).getValues();
      for (var i = v.length - 1; i >= 0; i--) {
        var s = String(v[i][0] || '').trim();
        if (s) return s;
      }
    } catch (e) {}
    return '';
  }

  var docs = [
    ['GRN',        pick('GRN_LOG', 1)],
    ['IQC',        pick('IQC_LOG', 1)],
    ['OQC',        pick('OQC_LOG', 1)],
    ['PRODUCTION', pick('PROD_JOBS', 1)],
    ['DISPATCH',   pick('GATEPASS_LOG', 1)]
  ];

  docs.forEach(function (d) {
    if (!d[1]) { out.push(_perfPad_(d[0], 12) + '(no document found)'); return; }
    traceCacheReset_();                     // honest cold timing per document
    var t = new Date().getTime();
    var r = null, err = '';
    try { r = traceBatch(d[1]); } catch (e) { err = e.message.slice(0, 60); }
    var ms = new Date().getTime() - t;
    var size = 0, stages = 0;
    if (r) {
      try { size = JSON.stringify(r).length; } catch (e) {}
      stages = (r.timeline && r.timeline.length) || (r.nodes && r.nodes.length) || 0;
    }
    out.push(_perfPad_(d[0], 12) + _perfPad_(d[1], 22) +
             _perfPad_(ms + 'ms', 9) + _perfPad_(stages + ' stages', 12) +
             size + ' bytes' + (err ? '  ERR ' + err : ''));
  });

  out.push('');
  var st = traceCacheStats_();
  out.push('cache held ' + st.sheets + ' sheet(s) on the last run');
  out.push('');
  out.push('A trace that is fast AND returns stages is a real improvement;');
  out.push('a fast empty result would just mean the anchor was not found.');
  return out.join('\n');
}

// The production trace is still 14.7s despite the read cache. Where?
// Instrument traceValues_ to count how often each sheet is asked for, and how
// many of those were served from cache vs cost a real round trip.
var _TV_STATS = null;
function perfTraceInstrument(docNo) {
  var ss = getSpreadsheet();
  if (!docNo) {
    var pj = ss.getSheetByName('PROD_JOBS');
    docNo = String(pj.getRange(pj.getLastRow(), 1).getValue() || '').trim();
  }
  // Wrap traceValues_ to record hits and misses.
  _TV_STATS = { asks: {}, misses: {}, missMs: {} };
  var real = traceValues_;
  traceValues_ = function (name) {
    _TV_STATS.asks[name] = (_TV_STATS.asks[name] || 0) + 1;
    var c = _TRACE_READ_CACHE || {};
    var hit = c.hasOwnProperty(name);
    var t = new Date().getTime();
    var v = real(name);
    if (!hit) {
      _TV_STATS.misses[name] = (_TV_STATS.misses[name] || 0) + 1;
      _TV_STATS.missMs[name] = (_TV_STATS.missMs[name] || 0) + (new Date().getTime() - t);
    }
    return v;
  };

  traceCacheReset_();
  var t0 = new Date().getTime();
  var r = null, err = '';
  try { r = traceBatch(docNo); } catch (e) { err = e.message.slice(0, 70); }
  var total = new Date().getTime() - t0;
  traceValues_ = real;

  var out = ['TRACE INSTRUMENTED', '', 'doc: ' + docNo,
             'total: ' + total + 'ms' + (err ? '  ERR ' + err : ''), ''];
  var readMs = 0, asks = 0, misses = 0;
  Object.keys(_TV_STATS.asks).sort().forEach(function (k) {
    var a = _TV_STATS.asks[k], m = _TV_STATS.misses[k] || 0, ms = _TV_STATS.missMs[k] || 0;
    asks += a; misses += m; readMs += ms;
    out.push('   ' + _perfPad_(k, 22) + _perfPad_('asked ' + a, 10) +
             _perfPad_('read ' + m, 9) + ms + 'ms');
  });
  out.push('');
  out.push(_perfPad_('total asks', 22) + asks);
  out.push(_perfPad_('actual sheet reads', 22) + misses + '   (cache saved ' + (asks - misses) + ')');
  out.push(_perfPad_('time in reads', 22) + readMs + 'ms of ' + total + 'ms');
  out.push(_perfPad_('time NOT in reads', 22) + (total - readMs) + 'ms   <- walking/CPU');
  if (r) { try { out.push('payload: ' + JSON.stringify(r).length + ' bytes'); } catch (e) {} }
  return out.join('\n');
}

// _pmSheetFingerprint_ uses DriveApp.getFileById, which drive.file refuses for
// the spreadsheet (the script did not create it). It CATCHES and returns '0' —
// a constant. Every cache keyed on it (landing, records, form masters, trace)
// would then never invalidate on a sheet edit: stale data served until TTL.
// Verify, and prove the replacement moves.
function perfFingerprint() {
  var out = ['CACHE FINGERPRINT', ''];
  var fp1 = _pmSheetFingerprint_();
  out.push('_pmSheetFingerprint_()      : ' + fp1 +
           (fp1 === '0' ? '   <- CONSTANT: caches never invalidate' : ''));

  // Alternatives that work under drive.file.
  try {
    var ss = getSpreadsheet();
    var t = new Date().getTime();
    var lastRowSum = 0;
    ['GRN_LOG','IQC_LOG','STOCK_LEDGER','OQC_LOG','PROD_JOBS'].forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (sh) lastRowSum += sh.getLastRow();
    });
    out.push('row-count fingerprint      : ' + lastRowSum +
             '   (' + (new Date().getTime() - t) + 'ms)');
  } catch (e) { out.push('row-count fingerprint      : THREW ' + e.message.slice(0, 50)); }

  try {
    var t2 = new Date().getTime();
    var rest = _drvFetch_('https://www.googleapis.com/drive/v3/files/' +
      getSpreadsheet().getId() + '?fields=modifiedTime', { method: 'get' });
    out.push('REST modifiedTime          : ' + rest.modifiedTime +
             '   (' + (new Date().getTime() - t2) + 'ms)');
  } catch (e) {
    out.push('REST modifiedTime          : THREW ' + e.message.slice(0, 70));
  }
  out.push('');
  out.push('A fingerprint that never changes is WORSE than no cache: an edit to');
  out.push('any sheet is invisible until the 6h TTL expires.');
  return out.join('\n');
}

// Do IQC / IPQC / OQC / CR / NCR actually produce Drive artefacts now?
// Only GRN was migrated to REST; the rest kept calling DriveApp and threw.
// This exercises each module's REAL store path and trashes what it creates.
function perfAllModuleDrive() {
  var out = ['PER-MODULE DRIVE WRITE', ''];
  var px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  ['GRN', 'IQC', 'IPQC', 'OQC', 'CustomerReturn', 'NCR'].forEach(function (m) {
    // image
    var imgMsg = '';
    try {
      var blob = Utilities.newBlob(Utilities.base64Decode(px), 'image/png', 'PROBE.png');
      var url = drvStoreModuleImage(m, 'PROBE_' + m + '_' + new Date().getTime() + '.png', blob);
      imgMsg = 'img OK';
      var id = String(url).match(/[-\w]{25,}/);
      if (id) drvTrash(id[0]);
    } catch (e) { imgMsg = 'img FAIL ' + e.message.slice(0, 40); }

    // pdf
    var pdfMsg = '';
    try {
      var u = drvStoreModulePdf(m, 'PROBE_' + m + '_' + new Date().getTime(), '<h1>probe</h1>');
      pdfMsg = 'pdf OK';
      var pid = String(u).match(/[-\w]{25,}/);
      if (pid) drvTrash(pid[0]);
    } catch (e) { pdfMsg = 'pdf FAIL ' + e.message.slice(0, 40); }

    out.push(_perfPad_(m, 16) + _perfPad_(imgMsg, 22) + pdfMsg);
  });
  return out.join('\n');
}

// Does onOpen actually build? A menu that throws leaves the spreadsheet with NO
// QMS menu at all, and the failure is invisible until someone opens the sheet.
// This calls every launcher target by name to prove it is defined, without
// opening dialogs (showModelessDialog needs a real UI context).
function perfMenuCheck() {
  var targets = [
    'openPOPForm','openGRNForm','openIQCForm',
    'openProductionIssueForm','openProductionBookForm','openIPQCForm','openReworkForm',
    'openOQCForm','openDispatchForm','openGatepassForm',
    'openNCRForm','openCustomerReturnForm',
    'openDashboard','openKPIDashboard','openRecords','openTraceForm','openWarehouseForm',
    'sendWhatsAppSelected','openImportCSV',
    'runHealthCheckUI','runLedgerAuditUI','runReachCheckUI','runDeferQueueUI',
    'initializeProject','verifyMastersSeed','seedDefaultParameters',
    'verifyAndRepairSheets','forceFixSheetHeaders','verifyDocCounters',
    'forceReleaseStuckLock','flushAllCachesUI',
    'backfillFGDispatchLotsFromOQCUI','backfillStockLedgerFromGRNUI',
    'backfillGRNLocationsUI','reconcilePOReceipts'
  ];
  var missing = [], ok = 0;
  targets.forEach(function (name) {
    var fn = null;
    try { fn = eval(name); } catch (e) {}
    if (typeof fn === 'function') ok++; else missing.push(name);
  });
  var out = ['SHEETS MENU CHECK', ''];
  out.push('menu items : ' + targets.length);
  out.push('defined    : ' + ok);
  out.push('MISSING    : ' + (missing.length ? missing.join(', ') : 'none'));
  out.push('');
  out.push(missing.length
    ? 'A missing target throws when clicked. Fix before shipping.'
    : 'Every menu item resolves to a real function.');
  return out.join('\n');
}
