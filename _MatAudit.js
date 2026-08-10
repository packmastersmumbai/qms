// READ-ONLY audit of MASTERS_Materials data quality. Writes nothing.
// ?diag=mataudit
//
// The column CONTRACT is already checked by ?diag=dropdiag and the header is
// clean; this looks at the DATA: vocabularies, duplicates, type mismatches on
// the join key, and the geometry gap that blocks capacity-aware putaway.
function auditMaterials() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials missing.';
  var C = MAT_COL;
  var d = ws.getDataRange().getValues();
  var out = ['MASTERS_Materials DATA AUDIT  (' + (d.length - 1) + ' rows)'];
  out.push('');

  var cat = {}, insp = {}, unit = {}, loc = {};
  var codeSeen = {}, dupes = [], numericCodes = [], blankInsp = [], caseIssues = [];
  var noGeom = 0, noPallet = 0, noWeight = 0;

  for (var i = 1; i < d.length; i++) {
    var r = d[i];
    var rawCode = r[C.CODE];
    if (rawCode === '' || rawCode == null) continue;
    var code = String(rawCode).trim();

    // Item Code is the join key for BOM, GRN, STOCK_LEDGER and every dropdown.
    // A numeric cell and its string form are DIFFERENT keys in a JS object map,
    // and 51 of these are stored as numbers — a leading zero or a trailing
    // space anywhere upstream silently fails to match.
    if (typeof rawCode === 'number') numericCodes.push(code);

    if (codeSeen[code]) {
      // Show the fields too. "Same code twice" and "same code, different data"
      // are different problems: the first is a stray copy, the second means one
      // variant is unreachable behind first-match-wins.
      dupes.push(code + ' (rows ' + codeSeen[code] + ' & ' + (i + 1) + ')' +
                 '  desc="' + String(r[C.DESC] || '').slice(0, 30) + '"' +
                 ' cat=' + (String(r[C.CATEGORY] || '').trim() || '-') +
                 ' insp=' + (String(r[C.INSP_CATEGORY] || '').trim() || '-') +
                 ' unit=' + (String(r[C.UNIT] || '').trim() || '-'));
    } else codeSeen[code] = i + 1;

    var cv = String(r[C.CATEGORY] || '').trim();
    cat[cv || '(blank)'] = (cat[cv || '(blank)'] || 0) + 1;
    if (cv && cv !== cv.toUpperCase()) caseIssues.push(code + ' Category="' + cv + '"');

    var iv = String(r[C.INSP_CATEGORY] || '').trim();
    if (!iv) blankInsp.push(code + '  ' + String(r[C.DESC] || '').slice(0, 34));
    else insp[iv] = (insp[iv] || 0) + 1;

    var uv = String(r[C.UNIT] || '').trim();
    unit[uv || '(blank)'] = (unit[uv || '(blank)'] || 0) + 1;

    var lv = String(r[C.DEFAULT_LOCATION] || '').trim();
    loc[lv || '(blank)'] = (loc[lv || '(blank)'] || 0) + 1;

    var hasL = r[C.EACH_L] !== '' && r[C.EACH_L] != null;
    var hasW = r[C.EACH_W] !== '' && r[C.EACH_W] != null;
    var hasH = r[C.EACH_H] !== '' && r[C.EACH_H] != null;
    if (!(hasL && hasW && hasH)) noGeom++;
    if (r[C.PER_PALLET] === '' || r[C.PER_PALLET] == null) noPallet++;
    if (r[C.EACH_WEIGHT] === '' || r[C.EACH_WEIGHT] == null) noWeight++;
  }

  function tally(o) {
    return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; })
      .map(function (k) { return k + '(' + o[k] + ')'; }).join('  ');
  }

  out.push('── Item Code (join key) ──');
  out.push('  stored as NUMBER: ' + numericCodes.length + ' / ' + (d.length - 1) +
           (numericCodes.length ? '   eg ' + numericCodes.slice(0, 4).join(', ') : ''));
  out.push('  duplicate codes:  ' + dupes.length);
  dupes.forEach(function (x) { out.push('     !! ' + x); });
  out.push('');

  out.push('── Category (col D) — free text, no controlled list ──');
  out.push('  ' + tally(cat));
  out.push('  non-uppercase values: ' + caseIssues.length);
  caseIssues.slice(0, 8).forEach(function (x) { out.push('     ?  ' + x); });
  out.push('');

  out.push('── Inspection Category (col M) — drives IQC/IPQC params ──');
  out.push('  ' + tally(insp));
  out.push('  BLANK: ' + blankInsp.length + (blankInsp.length ? '  <-- fall back to generic params' : ''));
  blankInsp.forEach(function (x) { out.push('     !! ' + x); });
  out.push('');

  out.push('── Unit ──');
  out.push('  ' + tally(unit));
  out.push('');

  out.push('── Default Location ──');
  out.push('  ' + tally(loc));
  out.push('');

  out.push('── Geometry (blocks capacity-aware putaway) ──');
  out.push('  incomplete L/W/H:   ' + noGeom + ' / ' + (d.length - 1));
  out.push('  no Per Pallet:      ' + noPallet + ' / ' + (d.length - 1));
  out.push('  no Each Weight:     ' + noWeight + ' / ' + (d.length - 1));
  return out.join('\n');
}
