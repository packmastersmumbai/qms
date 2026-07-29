// Read-only: call the REAL getStockView() and report bucket counts, so the
// PM/unclassified fix is verified against the actual function the UI calls
// rather than a diagnostic's re-implementation. Exposed via ?diag=stockview.
function checkStockViewBuckets() {
  var v = getStockView();
  var keys = ['rm', 'pm', 'fg', 'wip', 'quarantine', 'unclassified', 'rework'];
  var out = [];
  out.push('getStockView() BUCKET COUNTS  (the function Warehouse_F actually calls)');
  out.push('');
  var total = 0;
  keys.forEach(function(k) {
    var n = (v[k] || []).length;
    total += n;
    out.push('  ' + k + new Array(Math.max(1, 15 - k.length)).join(' ') + n);
  });
  out.push('');
  out.push('  total rows: ' + total);

  if ((v.unclassified || []).length) {
    out.push('');
    out.push('UNCLASSIFIED detail (these need a LOCATIONS Type set):');
    v.unclassified.forEach(function(r) {
      out.push('  ' + r.materialCode + '  lot=' + r.batchNo + '  loc=' + r.location +
               '  type=' + r.locType + '  qty=' + r.qty);
    });
  }
  if ((v.pm || []).length) {
    out.push('');
    out.push('PM sample (first 5):');
    v.pm.slice(0, 5).forEach(function(r) {
      out.push('  ' + r.materialCode + '  lot=' + r.batchNo + '  loc=' + r.location +
               '  qty=' + r.qty + ' ' + r.unit + '  iqc=' + r.iqcStatus);
    });
  }
  return out.join('\n');
}
