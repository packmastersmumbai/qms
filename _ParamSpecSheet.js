// QA fill-in sheet for the measured params that still carry the 'As per spec'
// placeholder written by _ParamDataFix. Those 40 rows need real numeric limits
// that exist nowhere in this system — see the commit for why they were not
// invented. This builds the sheet QA fills, then reads it back.
//
//   ?diag=paramspecsheet              → dry run (reports what it would build)
//   ?diag=paramspecsheet&confirm=YES  → create/refresh PARAM_SPEC_TODO
//   ?diag=paramspecapply              → dry run of applying QA's filled values
//   ?diag=paramspecapply&confirm=YES  → write them into MASTERS_Parameters
//
// Round-trips through a SEPARATE sheet rather than editing MASTERS_Parameters in
// place: QA can sort/filter/paste freely without any risk to the positional
// column contract, and a half-filled sheet is never a half-broken dictionary.

var PARAM_SPEC_TODO_ = 'PARAM_SPEC_TODO';
var PARAM_SPEC_PLACEHOLDER_ = 'As per spec';
var PARAM_SPEC_HEADERS_ = [
  'param_code', 'category', 'param_name', 'unit', 'method',
  'std_value', 'tol_min', 'tol_max', 'check_brief', 'status'
];

// Which rows still need QA input: categorised, measured, still on the placeholder.
function collectPendingSpecParams_(ws) {
  var C = PARAM_COL;
  var d = ws.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < d.length; i++) {
    var r = d[i], code = String(r[C.CODE] || '').trim();
    if (!code) continue;
    var cat = String(r[C.CATEGORY] || '').trim();
    if (!cat || cat === 'ARCHIVED') continue;
    if (String(r[C.STD_VALUE] || '').trim() !== PARAM_SPEC_PLACEHOLDER_) continue;
    rows.push({
      row: i + 1, code: code, cat: cat,
      name: String(r[C.NAME] || ''), unit: String(r[C.UNIT] || ''),
      method: String(r[C.METHOD_TYPE] || ''), brief: String(r[C.CHECK_BRIEF] || '')
    });
  }
  // Group by category so QA fills one material family at a time.
  rows.sort(function (a, b) {
    return a.cat === b.cat ? a.code.localeCompare(b.code) : a.cat.localeCompare(b.cat);
  });
  return rows;
}

function buildParamSpecSheet(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Parameters');
  if (!ws) return 'MASTERS_Parameters missing.';

  var pending = collectPendingSpecParams_(ws);
  var out = ['PARAM_SPEC_TODO builder — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('');
  out.push('Params still on the "' + PARAM_SPEC_PLACEHOLDER_ + '" placeholder: ' + pending.length);

  var byCat = {};
  pending.forEach(function (p) { byCat[p.cat] = (byCat[p.cat] || 0) + 1; });
  out.push('  ' + Object.keys(byCat).sort().map(function (k) {
    return k + '(' + byCat[k] + ')';
  }).join(' '));
  out.push('');

  if (!pending.length) {
    out.push('Nothing pending — every category param has a real std_value.');
    return out.join('\n');
  }

  // Preserve anything QA has already typed, keyed by param_code, so a refresh
  // never discards work in progress.
  var existing = {}, keptN = 0;
  var todo = ss.getSheetByName(PARAM_SPEC_TODO_);
  if (todo && todo.getLastRow() > 1) {
    todo.getDataRange().getValues().slice(1).forEach(function (r) {
      var code = String(r[0] || '').trim();
      if (!code) return;
      var std = String(r[5] || '').trim(), mn = String(r[6] || '').trim(), mx = String(r[7] || '').trim();
      if (std || mn || mx) { existing[code] = { std: r[5], mn: r[6], mx: r[7] }; keptN++; }
    });
  }
  out.push('Existing QA entries preserved on refresh: ' + keptN);
  out.push('');

  pending.slice(0, 8).forEach(function (p) {
    out.push('    ' + p.cat + '  ' + p.code + '  ' + p.name +
             (p.unit ? ' (' + p.unit + ')' : '') + '  [' + p.method + ']');
  });
  if (pending.length > 8) out.push('    ... +' + (pending.length - 8) + ' more');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES to build the sheet.');
    return out.join('\n');
  }

  if (!todo) {
    todo = ss.insertSheet(PARAM_SPEC_TODO_);
  } else {
    todo.clear();
  }

  var body = pending.map(function (p) {
    var e = existing[p.code];
    return [p.code, p.cat, p.name, p.unit, p.method,
            e ? e.std : '', e ? e.mn : '', e ? e.mx : '',
            p.brief, e ? 'FILLED' : 'PENDING'];
  });

  todo.getRange(1, 1, 1, PARAM_SPEC_HEADERS_.length).setValues([PARAM_SPEC_HEADERS_]);
  todo.getRange(2, 1, body.length, PARAM_SPEC_HEADERS_.length).setValues(body);
  todo.setFrozenRows(1);

  // Make the columns QA edits obvious, and lock the ones they must not.
  todo.getRange(1, 1, 1, PARAM_SPEC_HEADERS_.length)
      .setFontWeight('bold').setBackground('#0D1B6E').setFontColor('#FFFFFF');
  todo.getRange(2, 6, body.length, 3).setBackground('#FFF9E6');  // std/min/max = fill these
  todo.getRange(2, 1, body.length, 5).setFontColor('#666666');   // identity = read-only
  todo.getRange(2, 9, body.length, 1).setFontColor('#666666').setWrap(true);
  [110, 110, 190, 70, 105, 130, 90, 90, 380, 80].forEach(function (w, i) {
    todo.setColumnWidth(i + 1, w);
  });
  todo.getRange(1, 1, body.length + 1, PARAM_SPEC_HEADERS_.length)
      .setBorder(true, true, true, true, true, true, '#D0D0D0', SpreadsheetApp.BorderStyle.SOLID);

  out.push('BUILT: ' + PARAM_SPEC_TODO_ + ' — ' + body.length + ' rows.');
  out.push('');
  out.push('QA fills the SHADED columns (std_value, tol_min, tol_max). Leave a row');
  out.push('blank to skip it; it stays on the placeholder and reappears next refresh.');
  out.push('Then run ?diag=paramspecapply to load the values back.');
  return out.join('\n');
}

// Read PARAM_SPEC_TODO back into MASTERS_Parameters. Only rows with a non-empty
// std_value are applied — a blank row is "not done yet", never a write.
function applyParamSpecSheet(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Parameters');
  if (!ws) return 'MASTERS_Parameters missing.';
  var todo = ss.getSheetByName(PARAM_SPEC_TODO_);
  if (!todo || todo.getLastRow() < 2) {
    return PARAM_SPEC_TODO_ + ' missing or empty. Run ?diag=paramspecsheet&confirm=YES first.';
  }

  var C = PARAM_COL;
  var out = ['PARAM_SPEC_TODO -> MASTERS_Parameters — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('');

  // Locate every param by code; never trust a row index from another sheet.
  var d = ws.getDataRange().getValues();
  var rowOf = {};
  for (var i = 1; i < d.length; i++) {
    var c = String(d[i][C.CODE] || '').trim();
    if (c) rowOf[c] = i + 1;
  }

  var td = todo.getDataRange().getValues();
  var writes = [], blank = 0, unknown = [], unchanged = 0;
  for (var j = 1; j < td.length; j++) {
    var code = String(td[j][0] || '').trim();
    if (!code) continue;
    var std = String(td[j][5] == null ? '' : td[j][5]).trim();
    if (!std) { blank++; continue; }
    if (!rowOf[code]) { unknown.push(code); continue; }
    var cur = String(d[rowOf[code] - 1][C.STD_VALUE] || '').trim();
    if (cur === std) { unchanged++; continue; }
    writes.push({ row: rowOf[code], todoRow: j + 1, code: code, from: cur, to: std,
                  mn: td[j][6], mx: td[j][7] });
  }

  out.push('Filled rows to apply:    ' + writes.length);
  out.push('Still blank (skipped):   ' + blank);
  out.push('Already applied:         ' + unchanged);
  out.push('Unknown param_code:      ' + unknown.length);
  unknown.slice(0, 8).forEach(function (u) { out.push('   !! ' + u + ' — not in MASTERS_Parameters'); });
  out.push('');
  writes.slice(0, 10).forEach(function (w) {
    out.push('    ' + w.code + '  "' + w.from + '" -> "' + w.to + '"' +
             ((w.mn !== '' && w.mn != null) || (w.mx !== '' && w.mx != null)
               ? '   tol[' + w.mn + ' .. ' + w.mx + ']' : ''));
  });
  if (writes.length > 10) out.push('    ... +' + (writes.length - 10) + ' more');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES to apply.');
    return out.join('\n');
  }

  writes.forEach(function (w) {
    ws.getRange(w.row, C.STD_VALUE + 1).setValue(w.to);
    if (w.mn !== '' && w.mn != null) ws.getRange(w.row, C.TOL_MIN + 1).setValue(w.mn);
    if (w.mx !== '' && w.mx != null) ws.getRange(w.row, C.TOL_MAX + 1).setValue(w.mx);
    todo.getRange(w.todoRow, 10).setValue('APPLIED');
  });

  out.push('APPLIED: ' + writes.length + ' params now carry a real std_value.');
  out.push('Remaining on placeholder: ' + blank);
  return out.join('\n');
}
