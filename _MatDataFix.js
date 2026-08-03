// Data-quality repair for MASTERS_Materials. Dry run by default, idempotent.
//   ?diag=matdatafix              → dry run
//   ?diag=matdatafix&confirm=YES  → apply
//
// FOUR fixes. The schema is already correct (?diag=dropdiag confirms the header
// matches MAT_COL exactly) — everything here is DATA.
//
//   A. Category (col D) → UPPERCASE. 120 rows are mixed-case, splitting real
//      categories by case: Bulk(19)/BULK(2), Tape(3)/TAPE(1). Verified safe:
//      every consumer already calls .toUpperCase() defensively (Masters.js:222,
//      OQC.js:8/63, Dispatch.js:866, Initialize.js:915) and the writers already
//      write uppercase (Masters.js:554/786). This aligns data to existing code.
//   B. Unit (col C) → canonical. 8 spellings for 3 real units:
//      No's/NOS/PC → NOS, KGS/KG → KG, MTR/M → MTR. Verified safe: NO code
//      compares unit strings; this is display/reporting only.
//   C. Default Location (col E) → fill the 1 blank row. Blank defaults are the
//      ghost-location root cause closed in Phase 1 (128 → 0); this is a
//      regression of exactly that.
//   D. Item Code (col A) → force to text. 51 codes are stored as NUMBERS. A
//      numeric cell and its string form are different keys in a JS map; readers
//      coerce today, so this is prophylactic, not a live bug.
//
// D is gated behind &code=YES because col A is the join key that BOM, GRN,
// STOCK_LEDGER and every dropdown reference. A and B and C apply together.

var MAT_UNIT_CANON_ = {
  "NO'S": 'NOS', 'NOS': 'NOS', 'PC': 'NOS', 'PCS': 'NOS', 'NO': 'NOS',
  'KGS': 'KG',  'KG': 'KG',
  'MTR': 'MTR', 'M': 'MTR',
  'LTR': 'LTR', 'L': 'LTR'
};

function fixMaterialData(apply, doCodes) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials missing.';
  var C = MAT_COL;
  var d = ws.getDataRange().getValues();

  var out = ['MASTERS_Materials data repair — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('rows=' + (d.length - 1) + '  cols=' + ws.getLastColumn());
  out.push('');

  // Positional guard — refuse to write into the wrong columns.
  var hdr = d[0];
  if (String(hdr[C.CODE]).trim() !== 'Item Code' ||
      String(hdr[C.UNIT]).trim() !== 'Unit' ||
      String(hdr[C.CATEGORY]).trim() !== 'Category' ||
      String(hdr[C.DEFAULT_LOCATION]).trim() !== 'Default Location') {
    return 'ABORT: header is not the expected MAT_COL contract. Run ?diag=dropdiag.';
  }

  // Location fallback per category, taken from what SIBLING materials of the
  // same category actually use — not from a hardcoded guess.
  var locByCat = {};
  for (var i = 1; i < d.length; i++) {
    var cu = String(d[i][C.CATEGORY] || '').trim().toUpperCase();
    var lu = String(d[i][C.DEFAULT_LOCATION] || '').trim();
    if (!cu || !lu) continue;
    locByCat[cu] = locByCat[cu] || {};
    locByCat[cu][lu] = (locByCat[cu][lu] || 0) + 1;
  }
  function commonestLoc(catUpper) {
    var m = locByCat[catUpper];
    if (!m) return '';
    var best = '', n = 0;
    Object.keys(m).forEach(function (k) { if (m[k] > n) { n = m[k]; best = k; } });
    return best;
  }

  var catW = [], unitW = [], locW = [], codeW = [], unitUnknown = [];

  for (var r = 1; r < d.length; r++) {
    var row = d[r], rowNo = r + 1;
    var rawCode = row[C.CODE];
    if (rawCode === '' || rawCode == null) continue;
    var code = String(rawCode).trim();

    // A — Category uppercase
    var cv = String(row[C.CATEGORY] || '').trim();
    if (cv && cv !== cv.toUpperCase()) {
      catW.push({ row: rowNo, code: code, from: cv, to: cv.toUpperCase() });
    }

    // B — Unit canonical
    var uv = String(row[C.UNIT] || '').trim();
    if (uv) {
      var key = uv.toUpperCase();
      var canon = MAT_UNIT_CANON_[key];
      if (!canon) unitUnknown.push(code + ' unit="' + uv + '"');
      else if (canon !== uv) unitW.push({ row: rowNo, code: code, from: uv, to: canon });
    }

    // C — blank Default Location
    var lv = String(row[C.DEFAULT_LOCATION] || '').trim();
    if (!lv) {
      var want = commonestLoc(cv.toUpperCase());
      locW.push({ row: rowNo, code: code, cat: cv, to: want });
    }

    // D — numeric Item Code
    if (typeof rawCode === 'number') codeW.push({ row: rowNo, code: code });
  }

  out.push('A — Category → UPPERCASE: ' + catW.length + ' rows');
  catW.slice(0, 6).forEach(function (x) { out.push('    ' + x.code + '  "' + x.from + '" -> "' + x.to + '"'); });
  if (catW.length > 6) out.push('    ... +' + (catW.length - 6) + ' more');
  out.push('');

  out.push('B — Unit → canonical: ' + unitW.length + ' rows');
  var byMap = {};
  unitW.forEach(function (x) { byMap[x.from + ' -> ' + x.to] = (byMap[x.from + ' -> ' + x.to] || 0) + 1; });
  Object.keys(byMap).forEach(function (k) { out.push('    ' + k + '   (' + byMap[k] + ' rows)'); });
  out.push('  unrecognised units (LEFT ALONE): ' + unitUnknown.length);
  unitUnknown.slice(0, 6).forEach(function (x) { out.push('     ?  ' + x); });
  out.push('');

  out.push('C — blank Default Location: ' + locW.length + ' rows');
  locW.forEach(function (x) {
    out.push('    row ' + x.row + '  ' + x.code + '  category="' + x.cat + '"  -> "' +
             (x.to || '(NO SIBLING DEFAULT — will be left blank)') + '"');
  });
  out.push('');

  out.push('D — Item Code stored as NUMBER: ' + codeW.length + ' rows  ' +
           (doCodes ? '(WILL APPLY — &code=YES given)' : '(SKIPPED — add &code=YES to include)'));
  codeW.slice(0, 5).forEach(function (x) { out.push('    row ' + x.row + '  ' + x.code); });
  if (codeW.length > 5) out.push('    ... +' + (codeW.length - 5) + ' more');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES (add &code=YES for D).');
    return out.join('\n');
  }

  catW.forEach(function (x) { ws.getRange(x.row, C.CATEGORY + 1).setValue(x.to); });
  unitW.forEach(function (x) { ws.getRange(x.row, C.UNIT + 1).setValue(x.to); });
  locW.forEach(function (x) { if (x.to) ws.getRange(x.row, C.DEFAULT_LOCATION + 1).setValue(x.to); });

  var codesDone = 0;
  if (doCodes) {
    codeW.forEach(function (x) {
      var cell = ws.getRange(x.row, C.CODE + 1);
      cell.setNumberFormat('@');        // plain text, or Sheets re-coerces on write
      cell.setValue(String(x.code));
      codesDone++;
    });
  }

  out.push('APPLIED:');
  out.push('  Category uppercased:   ' + catW.length);
  out.push('  Unit canonicalised:    ' + unitW.length);
  out.push('  Locations filled:      ' + locW.filter(function (x) { return !!x.to; }).length);
  out.push('  Item Codes → text:     ' + codesDone);
  return out.join('\n');
}
