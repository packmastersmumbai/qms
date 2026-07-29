// Read-only: does a code exist as a material, and does a batch have ledger rows?
// ?diag=lotlookup&q=<code or batch>
function lookupCodeOrLot(q) {
  var term = String(q || '').trim();
  if (!term) return 'pass ?q=<material code or batch>';
  var ss = getSpreadsheet();
  var out = [];
  out.push('LOOKUP: "' + term + '"');
  out.push('');

  // 1. material master
  var mw = ss.getSheetByName('MASTERS_Materials');
  var md = mw ? mw.getDataRange().getValues() : [];
  var matHit = null;
  for (var i = 1; i < md.length; i++) {
    if (String(md[i][0] || '').trim() === term) { matHit = { row: i + 1, r: md[i] }; break; }
  }
  out.push('MASTERS_Materials: ' + (matHit ? 'FOUND at row ' + matHit.row : 'NOT FOUND'));
  if (matHit) {
    out.push('   code="' + matHit.r[0] + '"  desc="' + matHit.r[1] + '"  unit="' +
             matHit.r[2] + '"  category="' + matHit.r[3] + '"');
    out.push('   grade via categoryToGrade_: "' +
             (typeof categoryToGrade_ === 'function' ? categoryToGrade_(matHit.r[3]) : '?') + '"');
  } else {
    // near matches so a typo/prefix mismatch is obvious
    var near = [];
    for (var j = 1; j < md.length && near.length < 8; j++) {
      var c = String(md[j][0] || '');
      if (c && (c.indexOf(term.slice(0, 6)) === 0 || term.indexOf(c.slice(0, 6)) === 0)) {
        near.push('      row ' + (j + 1) + '  "' + c + '"  ' + String(md[j][1] || ''));
      }
    }
    if (near.length) { out.push('   nearest codes by prefix:'); near.forEach(function(n) { out.push(n); }); }
  }
  out.push('');

  // 2. stock ledger
  var lw = ss.getSheetByName('STOCK_LEDGER');
  var ld = lw ? lw.getDataRange().getValues() : [];
  var rows = [];
  for (var k = 1; k < ld.length; k++) {
    var r = ld[k];
    if (String(r[3] || '').trim() === term || String(r[4] || '').trim() === term) {
      rows.push({ row: k + 1, r: r });
    }
  }
  out.push('STOCK_LEDGER rows matching (as material OR batch): ' + rows.length);
  var bal = 0;
  rows.forEach(function(h) {
    var qi = Number(h.r[6]) || 0, qo = Number(h.r[7]) || 0;
    bal += qi - qo;
    out.push('   row ' + h.row + '  ' + String(h.r[2] || '') + '  mat=' + String(h.r[3] || '') +
             '  batch=' + String(h.r[4] || '') + '  loc=' + String(h.r[5] || '') +
             '  in=' + qi + ' out=' + qo + '  ref=' + String(h.r[9] || '') + ' ' + String(h.r[10] || ''));
  });
  if (rows.length) out.push('   net balance: ' + (Math.round(bal * 1000) / 1000));
  out.push('');

  // 3. FG dispatch lots
  var fw = ss.getSheetByName('FG_DISPATCH_LOTS');
  if (fw && fw.getLastRow() > 1) {
    var fd = fw.getDataRange().getValues();
    var fhits = [];
    for (var m = 1; m < fd.length; m++) {
      if (fd[m].join(' ').indexOf(term) >= 0) fhits.push(m + 1);
    }
    out.push('FG_DISPATCH_LOTS rows mentioning it: ' + fhits.length +
             (fhits.length ? '  (rows ' + fhits.join(', ') + ')' : ''));
  }
  return out.join('\n');
}
