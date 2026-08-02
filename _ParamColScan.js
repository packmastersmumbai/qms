// READ-ONLY scan: has MastersCrud stamped a timestamp into the category/ccp columns?
// Writes nothing. Exposed via ?diag=paramcolscan.
function scanParamColumns() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Parameters');
  if (!ws) return 'MASTERS_Parameters missing.';
  var d = ws.getDataRange().getValues();
  var hdr = d[0];
  var out = [];
  out.push('cols=' + ws.getLastColumn() + '  rows=' + (d.length - 1));
  out.push('header: ' + hdr.map(function(h,i){ return i + ':' + (h || '(blank)'); }).join(' | '));
  out.push('');

  var CAT = 11, CCP = 12, SORT = 13;
  var dateInCat = [], dateInCcp = [], badSort = [], okCat = 0, blankCat = 0;
  for (var i = 1; i < d.length; i++) {
    var r = d[i], code = String(r[0] || '');
    if (!code) continue;
    var c = r[CAT];
    if (c instanceof Date) dateInCat.push(code + ' row' + (i+1) + ' = ' + c);
    else if (String(c).trim() === '') blankCat++;
    else okCat++;
    if (r[CCP] instanceof Date || /@/.test(String(r[CCP]))) dateInCcp.push(code + ' row' + (i+1) + ' = ' + r[CCP]);
    var s = r[SORT];
    if (String(s).trim() !== '' && isNaN(Number(s))) badSort.push(code + ' = ' + s);
  }
  out.push('category col(11): ' + okCat + ' populated, ' + blankCat + ' blank');
  out.push('DATE values wrongly in category col: ' + dateInCat.length);
  dateInCat.slice(0,10).forEach(function(x){ out.push('   !! ' + x); });
  out.push('email/date wrongly in ccp col: ' + dateInCcp.length);
  dateInCcp.slice(0,10).forEach(function(x){ out.push('   !! ' + x); });
  out.push('non-numeric sort values: ' + badSort.length);
  badSort.slice(0,5).forEach(function(x){ out.push('   ?  ' + x); });
  return out.join('\n');
}
