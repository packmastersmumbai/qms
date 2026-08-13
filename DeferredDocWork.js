// ============================================================
// DeferredDocWork.js — QR + PDF + Telegram, off the save path.
//
// WHY (measured 2026-08-12 on GRN, ?diag=savebreak):
//   QR (UrlFetch)         0.2s
//   PDF render + upload   4.0s
//   Telegram + DWM        8.0s
//   full-sheet stamp scan 2.9s
// ~12s the operator waited for paperwork that does not affect the record —
// the row and its stock ledger entries are already committed before it runs.
// At 54s total the reply outlived the client watchdog, so a SUCCESSFUL save was
// reported to the operator as a failure. Deferring GRN alone took 54s -> 29s.
//
// This is the shared engine for every writer. One queue, one trigger, one drain
// — not three copies of GRN's version, because the next change would then have
// to be made in three places and the third would be missed.
//
// The queue lives in Script Properties, not a sheet: enqueue costs milliseconds
// and cannot contend with the row write that just happened.
// A time-driven trigger runs as the project OWNER, so this keeps working
// regardless of the restricted token the anonymous web app executes under.
// ============================================================

var DEFER_QUEUE_PROP_ = 'pm.defer.queue';
var DEFER_HANDLER_    = 'drainDeferredDocWork';
var DEFER_DELAY_MS_   = 10 * 1000;
var DEFER_MAX_        = 50;   // 9KB per-property cap; a backlog means the drain is broken

/**
 * Queue the post-save paperwork for one record.
 * @param {string} module  'GRN' | 'IQC' | 'OQC'
 * @param {string} docNo   primary document number
 * @param {number} row     first appended sheet row (1-based)
 * @param {Object=} extra  module-specific payload (e.g. {ncrNo, sampling, count})
 */
function deferDocWork_(module, docNo, row, extra) {
  // Every GRN/IQC/OQC save reaches here, so it is a reliable place to mark
  // cached reads stale — the writers themselves never called
  // invalidatePmCache_, which is why landing counts could lag a save.
  try { if (typeof bumpPmFingerprint_ === 'function') bumpPmFingerprint_(); } catch (e) {}
  try {
    var props = PropertiesService.getScriptProperties();
    var q = [];
    try { q = JSON.parse(props.getProperty(DEFER_QUEUE_PROP_) || '[]'); } catch (e) { q = []; }
    q.push({ m: module, doc: docNo, row: row, x: extra || {}, at: new Date().getTime() });
    if (q.length > DEFER_MAX_) q = q.slice(-DEFER_MAX_);
    props.setProperty(DEFER_QUEUE_PROP_, JSON.stringify(q));

    // Reuse one pending trigger for a burst of saves — the drain takes the
    // whole queue, so installing one per save would just waste trigger quota
    // (Apps Script caps a project at 20).
    var hasPending = false;
    var trg = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trg.length; i++) {
      if (trg[i].getHandlerFunction() === DEFER_HANDLER_) { hasPending = true; break; }
    }
    if (!hasPending) {
      ScriptApp.newTrigger(DEFER_HANDLER_).timeBased().after(DEFER_DELAY_MS_).create();
    }
  } catch (e) {
    // Deferral itself failed — do the work inline. A slow save beats a record
    // with no PDF and no notification.
    Logger.log('deferDocWork_ failed, running inline: ' + e.message);
    try { runDocWork_(module, docNo, row, extra || {}); }
    catch (e2) { Logger.log('inline doc work also failed: ' + e2.message); }
  }
}

/** Trigger entry point. Must be top-level — GAS cannot target object methods. */
function drainDeferredDocWork() {
  var props = PropertiesService.getScriptProperties();
  var q = [];
  try { q = JSON.parse(props.getProperty(DEFER_QUEUE_PROP_) || '[]'); } catch (e) { q = []; }

  // Clear the pending one-shot trigger so the next save installs a fresh one.
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === DEFER_HANDLER_) ScriptApp.deleteTrigger(t);
    });
  } catch (e) {}

  if (!q.length) return;
  // Claim the queue up front: a mid-run failure must not leave items to be
  // reprocessed forever. Each item is idempotent anyway — it overwrites the
  // same two cells and re-posts one notification.
  props.setProperty(DEFER_QUEUE_PROP_, '[]');

  q.forEach(function (item) {
    try { runDocWork_(item.m, item.doc, item.row, item.x || {}); }
    catch (e) { Logger.log('drain ' + item.m + ' ' + item.doc + ': ' + e.message); }
  });
}

/** Do the actual work for one record. Shared by the deferred and inline paths. */
function runDocWork_(module, docNo, row, extra) {
  if (module === 'GRN') return _docWorkGRN_(docNo, row);
  if (module === 'IQC') return _docWorkIQC_(docNo, row, extra);
  if (module === 'OQC') return _docWorkOQC_(docNo, row, extra);
  Logger.log('runDocWork_: unknown module ' + module);
}

function _docWorkGRN_(docNo, row) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return;
  try {
    var qr = generateGRNQR_(docNo);

    // The QR must be STORED before the PDF is generated. generateGRNPdf_ calls
    // getGRNPrintData, which reads the QR back out of column 24 — so with the
    // write happening afterwards it always read an empty cell and every printed
    // slip carried the "QR" placeholder box instead of a scannable code.
    // Confirmed by rendering the live PDF: the masthead showed a broken-image
    // icon, not a QR. Write it first, flush, then render.
    var rows = ws.getDataRange().getValues();
    var hits = [];
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(docNo).trim()) hits.push(i + 1);
    }
    hits.forEach(function (r) { ws.getRange(r, 24).setValue(qr); });
    SpreadsheetApp.flush();

    var pdf = generateGRNPdf_(docNo);
    hits.forEach(function (r) { ws.getRange(r, 25).setValue(pdf); });
  } catch (e) { Logger.log('GRN QR/PDF failed: ' + e.message); }

  try {
    if (typeof qmsAnnounce_ === 'function') {
      var rec = getGRNRowForWA(row);
      if (rec) qmsAnnounce_(rec);
    }
  } catch (e) { Logger.log('GRN announce skipped: ' + e.message); }
}

function _docWorkIQC_(docNo, row, extra) {
  var ws = getSpreadsheet().getSheetByName('IQC_LOG');
  if (!ws) return;
  var n = Number(extra.count) || 1;
  try {
    var qr  = generateIQCQR_(docNo);
    var pdf = generateIQCPdf_(docNo, extra.sampling || '');
    if (qr)  ws.getRange(row, 39, n, 1).setValue(qr);
    if (pdf) ws.getRange(row, 40, n, 1).setValue(pdf);
  } catch (e) { Logger.log('IQC QR/PDF failed: ' + e.message); }

  try {
    if (typeof qmsAnnounce_ === 'function') {
      var rec = getIQCRowForWA(row);
      if (rec) { rec.ncrRef = extra.ncrNo || rec.ncrRef; qmsAnnounce_(rec); }
    }
  } catch (e) { Logger.log('IQC announce skipped: ' + e.message); }
}

function _docWorkOQC_(docNo, row, extra) {
  var ws = getSpreadsheet().getSheetByName('OQC_LOG');
  if (!ws) return;
  var n = Number(extra.count) || 1;
  try {
    var qr  = generateOQCQR_(docNo);
    var pdf = generateOQCPdf_(docNo);
    if (qr)  ws.getRange(row, 26, n, 1).setValue(qr);
    if (pdf) ws.getRange(row, 27, n, 1).setValue(pdf);
  } catch (e) { Logger.log('OQC QR/PDF failed: ' + e.message); }

  try {
    if (typeof qmsAnnounce_ === 'function') {
      var rec = getOQCRowForWA(row);
      if (rec) { rec.ncrRef = extra.ncrNo || rec.ncrRef; qmsAnnounce_(rec); }
    }
  } catch (e) { Logger.log('OQC announce skipped: ' + e.message); }
}

/** Queue state, for ?diag=deferqueue. */
function deferQueueStatus() {
  var q = [];
  try { q = JSON.parse(PropertiesService.getScriptProperties()
      .getProperty(DEFER_QUEUE_PROP_) || '[]'); } catch (e) {}
  var trg = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { trg.push(t.getHandlerFunction()); });
  } catch (e) { trg.push('(unreadable)'); }
  var out = ['DEFERRED WORK QUEUE', '', 'depth: ' + q.length];
  q.slice(0, 10).forEach(function (i) {
    out.push('   ' + i.m + '  ' + i.doc + '  row=' + i.row);
  });
  out.push('');
  out.push('triggers: ' + trg.join(', '));
  out.push(q.length ? 'Pending — the drain fires ~10s after the last save.'
                    : 'Empty — everything drained.');
  return out.join('\n');
}

// The GRN-only queue this replaced used its own property and its own trigger
// handler. Left behind they would fire a handler that no longer exists (a
// scheduled error every 10s after any old queued item) and strand any entries
// written just before the deploy. Run once from the editor, or via
// ?diag=defermigrate.
function migrateOldGrnDeferQueue() {
  var props = PropertiesService.getScriptProperties();
  var out = [];
  var OLD_PROP = 'pm.grn.deferQueue', OLD_HANDLER = 'grnDrainDeferred';

  var old = [];
  try { old = JSON.parse(props.getProperty(OLD_PROP) || '[]'); } catch (e) {}
  if (old.length) {
    var q = [];
    try { q = JSON.parse(props.getProperty(DEFER_QUEUE_PROP_) || '[]'); } catch (e) {}
    old.forEach(function (i) { q.push({ m: 'GRN', doc: i.docNo, row: i.row, x: {}, at: i.at }); });
    props.setProperty(DEFER_QUEUE_PROP_, JSON.stringify(q.slice(-DEFER_MAX_)));
    out.push('migrated ' + old.length + ' queued GRN item(s)');
  } else {
    out.push('old queue empty');
  }
  props.deleteProperty(OLD_PROP);

  var killed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === OLD_HANDLER) { ScriptApp.deleteTrigger(t); killed++; }
  });
  out.push('removed ' + killed + ' stale ' + OLD_HANDLER + ' trigger(s)');
  return out.join('\n');
}
