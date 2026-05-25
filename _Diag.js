// ─────────────────────────────────────────────────────────────────────────
// One-shot diagnostics, runnable from the Apps Script editor.
// Open Editor → pick a function → Run, then check Executions log.
// ─────────────────────────────────────────────────────────────────────────

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
  if (!ws) { Logger.log('FG_DISPATCH_LOTS missing'); return; }
  var lr = ws.getLastRow();
  if (lr < 2) { Logger.log('FG_DISPATCH_LOTS has no data rows. Dispatch will always return "no FIFO plan".'); return; }
  var data = ws.getRange(1, 1, Math.min(lr, 11), ws.getLastColumn()).getValues();
  var lines = data.map(function(r) { return r.slice(0, 14).join(' | '); });
  Logger.log('First ' + (lines.length - 1) + ' FG_DISPATCH_LOTS rows:\n' + lines.join('\n'));
}

function diagLocations() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('LOCATIONS');
  if (!ws) { Logger.log('LOCATIONS missing'); return; }
  var data = ws.getDataRange().getValues();
  var hdr = data[0] || [];
  var typeCol = -1;
  for (var i = 0; i < hdr.length; i++) {
    if (String(hdr[i] || '').trim().toLowerCase() === 'type') { typeCol = i; break; }
  }
  Logger.log('Type column resolved at index ' + typeCol + ' (expected 8)');
  var fgCount = 0;
  for (var r = 1; r < data.length; r++) {
    if (typeCol >= 0 && String(data[r][typeCol] || '').toUpperCase() === 'FG') fgCount++;
  }
  Logger.log('FG locations: ' + fgCount + ' / ' + (data.length - 1) + ' total');
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
