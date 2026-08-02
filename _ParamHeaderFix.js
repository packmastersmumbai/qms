// One-off, idempotent: rename MASTERS_Parameters header cols 12-14 to what the
// DATA actually is (category|ccp|sort) and append the audit columns after them.
// Row 1 only — NO data cell is touched. ?diag=paramheaderfix (dry run)
// ?diag=paramheaderfix&confirm=YES to apply.
function fixParamHeader(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Parameters');
  if (!ws) return 'MASTERS_Parameters missing.';
  var want = ['code','name','unit','std_value','tol_min','tol_max','method_type',
              'check_brief','tools','doc_ref','doc_number','category','ccp','sort',
              'LastModified','ModifiedBy'];
  var lastCol = Math.max(ws.getLastColumn(), want.length);
  var cur = ws.getRange(1, 1, 1, lastCol).getValues()[0];
  var out = ['MASTERS_Parameters header repair — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('');
  var changes = [];
  for (var i = 0; i < want.length; i++) {
    var from = String(cur[i] === undefined ? '' : cur[i]).trim();
    if (from !== want[i]) changes.push({ i: i, from: from || '(blank)', to: want[i] });
  }
  if (!changes.length) { out.push('Header already correct — nothing to do.'); return out.join('\n'); }
  changes.forEach(function(c){
    out.push('  col ' + String.fromCharCode(65 + c.i) + ' (' + c.i + '): "' + c.from + '"  ->  "' + c.to + '"');
  });
  out.push('');
  out.push('Data rows touched: 0  (header row only)');
  if (!apply) { out.push(''); out.push('Re-run with &confirm=YES to apply.'); return out.join('\n'); }
  ws.getRange(1, 1, 1, want.length).setValues([want]);
  out.push('APPLIED: ' + changes.length + ' header cells rewritten.');
  return out.join('\n');
}
