// Read-only: find OQC records and explain why one may not surface in Records /
// Dispatch / FG stock. Exposed via ?diag=oqctrace[&q=<text>].
function traceOqc(query) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('OQC_LOG');
  if (!ws || ws.getLastRow() < 2) return 'OQC_LOG empty or missing.';
  var data = ws.getDataRange().getValues();
  var q = String(query || '').trim().toLowerCase();

  var out = [];
  out.push('OQC TRACE' + (q ? '  (filter: "' + query + '")' : '  (most recent 15)'));
  out.push('OQC_LOG rows: ' + (data.length - 1));
  out.push('header: ' + data[0].map(function(h, i) { return '[' + i + ']' + h; }).join(' | '));
  out.push('');

  var hits = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (q) {
      var joined = r.join(' ').toLowerCase();
      if (joined.indexOf(q) < 0) continue;
    }
    hits.push({ row: i + 1, r: r });
  }
  if (!q) hits = hits.slice(-15);

  if (!hits.length) {
    out.push('No OQC row matches. The record was not saved to OQC_LOG.');
    return out.join('\n');
  }

  hits.forEach(function(h) {
    out.push('── sheet row ' + h.row);
    for (var c = 0; c < h.r.length; c++) {
      var v = h.r[c];
      if (v === '' || v === null || v === undefined) continue;
      var s = (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : String(v);
      out.push('   [' + c + '] ' + String(data[0][c] || '?') + ' = ' + s);
    }
    out.push('');
  });

  // Why it may not appear downstream: the release decision drives FG availability.
  out.push('DOWNSTREAM VISIBILITY NOTES');
  out.push('  - OQC_LOG col 14 (0-based) = Release Decision. Dispatch/FG only pick up');
  out.push('    lots whose decision marks them released.');
  out.push('  - FG stock appears in the Warehouse only if a STOCK_LEDGER credit exists');
  out.push('    for the lot. Booking does NOT write FG stock-in (known FG/WIP gap), so an');
  out.push('    OQC record alone does not create stock.');
  var fdl = ss.getSheetByName('FG_DISPATCH_LOTS');
  out.push('  - FG_DISPATCH_LOTS rows: ' + (fdl && fdl.getLastRow() > 1 ? (fdl.getLastRow() - 1) : 0));
  return out.join('\n');
}
