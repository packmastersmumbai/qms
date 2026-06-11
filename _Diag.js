// ─────────────────────────────────────────────────────────────────────────
// One-shot diagnostics, runnable from the Apps Script editor.
// Open Editor → pick a function → Run, then check Executions log.
// ─────────────────────────────────────────────────────────────────────────

// Trace smoke-test: pick one ID from each module sheet, trace it, summarize.
function diagTraceSmoke() {
  var ss = getSpreadsheet();
  var picks = [];
  var modules = [
    { sheet: 'PROD_JOBS',           type: 'PRODUCTION' },
    { sheet: 'GRN_LOG',             type: 'GRN' },
    { sheet: 'IQC_LOG',             type: 'IQC' },
    { sheet: 'IPQC_Sessions',       type: 'IPQC' },
    { sheet: 'OQC_LOG',             type: 'OQC' },
    { sheet: 'GATEPASS_LOG',        type: 'GATEPASS' },
    { sheet: 'FG_DISPATCH_LOTS',    type: 'DISPATCH' },
    { sheet: 'NCR_LOG',             type: 'NCR' },
    { sheet: 'PO_HEADER',           type: 'PO' }
  ];
  modules.forEach(function(m){
    var ws = ss.getSheetByName(m.sheet);
    if (!ws || ws.getLastRow() < 2) { picks.push(m.type + ': (empty)'); return; }
    var id = ws.getRange(2, 1).getValue();
    picks.push({ type: m.type, id: String(id) });
  });
  var out = ['=== Trace smoke test ===', 'Picked anchor IDs:'];
  picks.forEach(function(p){ out.push('  ' + (p.type ? p.type + ' → ' + p.id : p)); });
  out.push('');
  picks.forEach(function(p){
    if (!p.type) return;
    out.push('--- ' + p.type + ' (' + p.id + ') ---');
    var t;
    try { t = traceBatch(p.id); } catch(e) { out.push('  FATAL: ' + e); return; }
    if (!t || !t.anchor) { out.push('  no anchor resolved (msg: ' + (t && t.message) + ')'); return; }
    out.push('  anchor: ' + t.anchor.type + ' ' + t.anchor.docNo + ' [' + t.anchor.status + ']');
    out.push('  upstream.components: ' + (t.upstream.components.length));
    out.push('  thisBatch.ipqc: ' + (t.thisBatch.ipqc.length) + (t.thisBatch.focus ? ' · focus=' + t.thisBatch.focus.type : ''));
    out.push('  downstream: oqc=' + t.downstream.oqc.length + ' gp=' + t.downstream.gatepass.length + ' dsp=' + t.downstream.dispatch.length + ' fgJobs=' + t.downstream.fgJobs.length);
    out.push('  issues: ncr=' + t.issues.ncr.length + ' cr=' + t.issues.customerReturn.length + ' orphans=' + t.issues.orphans.length);
    out.push('  meta: dateFloor=' + t.meta.dateFloor + ' dateFiltered=' + (t.meta.dateFiltered||0) + ' truncated=' + JSON.stringify(t.meta.truncated));
  });
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

// Inspect first 5 rows of OQC_LOG cols 0..6 + PROD_JOBS cols 0..6
// Trace a specific ID, return verbose breakdown
function diagTraceOne(id) {
  CacheService.getScriptCache().remove('pmqms_trace_v1_' + id);
  var t = traceBatch(id);
  if (!t || !t.anchor) return 'No anchor for ' + id + ' (msg: ' + (t && t.message) + ')';
  var out = [];
  out.push('=== ' + id + ' ===');
  out.push('anchor: ' + JSON.stringify(t.anchor));
  out.push('upstream.components count: ' + t.upstream.components.length);
  t.upstream.components.slice(0, 3).forEach(function(c, i){ out.push('  comp['+i+']: ' + JSON.stringify(c).slice(0,250)); });
  out.push('thisBatch.focus: ' + JSON.stringify(t.thisBatch.focus));
  out.push('thisBatch.ipqc (' + t.thisBatch.ipqc.length + '):');
  t.thisBatch.ipqc.slice(0, 5).forEach(function(s){ out.push('  ' + JSON.stringify(s)); });
  out.push('downstream.oqc (' + t.downstream.oqc.length + '): ' + JSON.stringify(t.downstream.oqc).slice(0,400));
  out.push('downstream.gatepass (' + t.downstream.gatepass.length + '): ' + JSON.stringify(t.downstream.gatepass).slice(0,400));
  out.push('downstream.dispatch (' + t.downstream.dispatch.length + '): ' + JSON.stringify(t.downstream.dispatch).slice(0,400));
  out.push('issues.ncr: ' + JSON.stringify(t.issues.ncr));
  out.push('meta: ' + JSON.stringify(t.meta));
  return out.join('\n');
}

function diagOQCvsProd() {
  var ss = getSpreadsheet();
  var out = [];
  var oqc = ss.getSheetByName('OQC_LOG');
  if (oqc) {
    var oD = oqc.getRange(1, 1, Math.min(oqc.getLastRow(), 8), 7).getValues();
    out.push('=== OQC_LOG (rows 1-7, cols A-G) ===');
    oD.forEach(function(r,i){ out.push('  R'+i+': '+JSON.stringify(r)); });
  }
  var pj = ss.getSheetByName('PROD_JOBS');
  if (pj) {
    var pD = pj.getRange(1, 1, Math.min(pj.getLastRow(), 8), 7).getValues();
    out.push('\n=== PROD_JOBS (rows 1-7, cols A-G) ===');
    pD.forEach(function(r,i){ out.push('  R'+i+': '+JSON.stringify(r)); });
  }
  // Quick: list all jobIds + all OQC col 4 values
  out.push('\n=== ALL PROD_JOBS jobIds ===');
  if (pj) {
    var allP = pj.getRange(2,1,pj.getLastRow()-1,1).getValues();
    out.push('  ' + allP.map(function(r){return r[0];}).filter(Boolean).join(' | '));
  }
  out.push('\n=== ALL OQC_LOG col4 (linkedFGBatch) + col5 (matDesc) ===');
  if (oqc && oqc.getLastRow()>1) {
    var allO = oqc.getRange(2,1,oqc.getLastRow()-1,6).getValues();
    allO.forEach(function(r,i){ out.push('  '+r[0]+' | col4="'+r[4]+'" | col5="'+r[5]+'"'); });
  }
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

function diagSheets() {
  var ss = getSpreadsheet();
  var report = [];
  ['FG_DISPATCH_LOTS', 'LOCATIONS', 'OQC_LOG', 'GATEPASS_LOG', 'MATERIALS'].forEach(function(name) {
    var ws = ss.getSheetByName(name);
    if (!ws) { report.push(name + ': MISSING'); return; }
    var lr = ws.getLastRow(), lc = ws.getLastColumn();
    var hdr = lr >= 1 ? ws.getRange(1, 1, 1, lc).getValues()[0].join(' | ') : '(no header row)';
    report.push(name + ': rows=' + lr + ', cols=' + lc + '\n   headers: ' + hdr);
  });
  Logger.log(report.join('\n\n'));
  return report.join('\n\n');
}

function diagDispatchPlan() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('FG_DISPATCH_LOTS');
  if (!ws) { var m = 'FG_DISPATCH_LOTS missing'; Logger.log(m); return m; }
  var lr = ws.getLastRow();
  if (lr < 2) { var m2 = 'FG_DISPATCH_LOTS has no data rows. Dispatch will always return "no FIFO plan".'; Logger.log(m2); return m2; }
  var data = ws.getRange(1, 1, Math.min(lr, 11), ws.getLastColumn()).getValues();
  var lines = data.map(function(r) { return r.slice(0, 14).join(' | '); });
  var out = 'First ' + (lines.length - 1) + ' FG_DISPATCH_LOTS rows (of ' + (lr - 1) + ' total):\n' + lines.join('\n');
  Logger.log(out);
  return out;
}

function diagLocations() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('LOCATIONS');
  if (!ws) { var m = 'LOCATIONS missing'; Logger.log(m); return m; }
  var data = ws.getDataRange().getValues();
  var hdr = data[0] || [];
  var typeCol = -1;
  for (var i = 0; i < hdr.length; i++) {
    if (String(hdr[i] || '').trim().toLowerCase() === 'type') { typeCol = i; break; }
  }
  var fgRows = [];
  for (var r = 1; r < data.length; r++) {
    if (typeCol >= 0 && String(data[r][typeCol] || '').toUpperCase() === 'FG') {
      fgRows.push(String(data[r][0] || '') + ' (' + String(data[r][7] || '') + ')');
    }
  }
  var out = 'Type column resolved at index ' + typeCol + ' (expected 8)\n'
          + 'FG locations: ' + fgRows.length + ' / ' + (data.length - 1) + ' total\n'
          + 'FG list: ' + (fgRows.join(', ') || '(none)');
  Logger.log(out);
  return out;
}

// Re-mirror existing OQC PASS records into FG_DISPATCH_LOTS.
// Useful when the auto-mirror was added after OQC records already existed.
function diagBackfillFGFromOQC() {
  if (typeof backfillFGDispatchLotsFromOQC !== 'function') {
    Logger.log('backfillFGDispatchLotsFromOQC not found in this project.');
    return;
  }
  var res = backfillFGDispatchLotsFromOQC();
  Logger.log('Backfill result: ' + JSON.stringify(res));
}
