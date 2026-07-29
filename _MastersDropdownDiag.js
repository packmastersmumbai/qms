// ============================================================
// _MastersDropdownDiag.js — read-only: why a master row is / isn't in a dropdown.
// Compares raw sheet rows against what getSuppliers()/getMaterials()/BOM return.
// WRITES NOTHING. Exposed via ?diag=dropdiag (Code.js).
// ============================================================

function diagMastersDropdowns() {
  var out = [];
  out.push('MASTERS → DROPDOWN VISIBILITY DIAG');
  out.push('==================================');
  out.push('');
  out.push(_ddSuppliers_());
  out.push('');
  out.push(_ddMaterials_());
  out.push('');
  out.push(_ddMaterialsContract_());
  out.push('');
  out.push(_ddBom_());
  return out.join('\n');
}

function _ddSuppliers_() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Suppliers');
  if (!ws) return 'SUPPLIERS: sheet MASTERS_Suppliers NOT FOUND.';
  var data = ws.getDataRange().getValues();
  var visible = getSuppliers();
  var visCodes = {};
  visible.forEach(function(s) { visCodes[String(s.code).trim()] = true; });

  var o = [];
  o.push('SUPPLIERS  (sheet rows: ' + (data.length - 1) + ', in dropdown: ' + visible.length + ')');
  o.push('  header: ' + data[0].join(' | '));
  o.push('  RULE: row shows only if col A non-empty AND (col H === "Y" OR col G === "Y")  [strict string]');
  var hidden = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (visCodes[String(r[0]).trim()]) continue;
    hidden.push('    row ' + (i + 1) + '  ' + String(r[0]).trim() + ' / ' + String(r[1] || '') +
                '   colG=' + _ddShow_(r[6]) + '  colH=' + _ddShow_(r[7]));
  }
  if (!hidden.length) { o.push('  ✔ every non-empty supplier row is visible.'); }
  else {
    o.push('  ✘ HIDDEN rows (' + hidden.length + ') — approval cell not exactly "Y":');
    hidden.forEach(function(h) { o.push(h); });
  }
  return o.join('\n');
}

// Compare the LIVE MASTERS_Materials header against the MAT_COL contract the
// code reads by. This is the check that caught the supplier shift: a header
// that has drifted means every reader is silently addressing the wrong cell.
function _ddMaterialsContract_() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return 'MATERIALS CONTRACT: sheet not found.';
  var header = ws.getRange(1, 1, 1, Math.max(ws.getLastColumn(), MAT_WIDTH)).getValues()[0];

  // Expected header text per MAT_COL index. Cols G→L come from MAT_GEOMETRY_COLS
  // so the expectation stays in one place.
  var expect = {};
  expect[MAT_COL.CODE] = 'Item Code';
  expect[MAT_COL.DESC] = 'Item Description';
  expect[MAT_COL.UNIT] = 'Unit';
  expect[MAT_COL.CATEGORY] = 'Category';
  expect[MAT_COL.DEFAULT_LOCATION] = 'Default Location';
  expect[MAT_COL.REORDER_LEVEL] = 'Reorder Level';
  MAT_GEOMETRY_COLS.forEach(function(g) { expect[g.col] = g.header; });
  expect[MAT_COL.INSP_CATEGORY] = 'Inspection Category';

  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var o = [];
  o.push('MATERIALS COLUMN CONTRACT  (MAT_WIDTH=' + MAT_WIDTH + ', sheet cols=' + ws.getLastColumn() + ')');
  var drift = 0;
  Object.keys(expect).map(Number).sort(function(a, b) { return a - b; }).forEach(function(idx) {
    var want = expect[idx];
    var got  = String(header[idx] == null ? '' : header[idx]).trim();
    var ok   = got.toLowerCase() === want.toLowerCase();
    if (!ok) drift++;
    o.push('  ' + letters.charAt(idx) + ' [' + idx + ']  ' + (ok ? 'OK  ' : 'DRIFT ') +
           'want="' + want + '"  got="' + got + '"');
  });

  o.push('');
  if (!drift) {
    o.push('  ✔ header matches the MAT_COL contract exactly.');
    return o.join('\n');
  }

  o.push('  ✘ ' + drift + ' column(s) drifted. Consequences of the mismatched ones:');
  var rl = String(header[MAT_COL.REORDER_LEVEL] == null ? '' : header[MAT_COL.REORDER_LEVEL]).trim();
  if (rl.toLowerCase() !== 'reorder level') {
    o.push('    - reorderLevel reads col F ("' + rl + '") → low-stock alerts use the wrong value.');
  }
  MAT_GEOMETRY_COLS.forEach(function(g) {
    var got = String(header[g.col] == null ? '' : header[g.col]).trim();
    if (got.toLowerCase() !== g.header.toLowerCase()) {
      o.push('    - ' + g.key + ' reads col ' + letters.charAt(g.col) + ' ("' + got + '") → floorplan fit engine misreads it.');
    }
  });
  return o.join('\n');
}

function _ddMaterials_() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return 'MATERIALS: sheet MASTERS_Materials NOT FOUND.';
  var data = ws.getDataRange().getValues();
  var visible = getMaterials();
  var visCodes = {};
  visible.forEach(function(m) { visCodes[String(m.code).trim()] = true; });

  var o = [];
  o.push('MATERIALS  (sheet rows: ' + (data.length - 1) + ', in dropdown: ' + visible.length + ')');
  o.push('  header: ' + data[0].join(' | '));
  o.push('  RULE: row shows if col A (Item Code) is non-empty. No approval flag.');
  var hidden = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (visCodes[String(r[0] || '').trim()]) continue;
    hidden.push('    row ' + (i + 1) + '  code=' + _ddShow_(r[0]) + '  desc=' + _ddShow_(r[1]));
  }
  if (!hidden.length) o.push('  ✔ every material row with a code is visible.');
  else {
    o.push('  ✘ HIDDEN rows (' + hidden.length + ') — blank/whitespace Item Code:');
    hidden.forEach(function(h) { o.push(h); });
  }
  return o.join('\n');
}

// BOM lives in its own sheet; report shape + whether components resolve to real materials.
function _ddBom_() {
  var ss = getSpreadsheet();
  var names = ['MASTERS_BOM', 'BOM', 'MASTERS_Bom'];
  var ws = null, used = '';
  for (var i = 0; i < names.length; i++) {
    ws = ss.getSheetByName(names[i]);
    if (ws) { used = names[i]; break; }
  }
  if (!ws) {
    var all = ss.getSheets().map(function(s) { return s.getName(); });
    return 'BOM: none of ' + names.join('/') + ' found.\n  sheets present: ' + all.join(', ');
  }
  var data = ws.getDataRange().getValues();
  var mats = {};
  getMaterials().forEach(function(m) { mats[String(m.code).trim()] = true; });

  // Real BOM shape (matches Production.getBomRows_):
  //   A Client | B FGIDH (fgCode) | C Material Description | D Base Quantity
  //   E UoM | F Component (compCode) | G Mat Desc Component | H Quantity (STPO) | ...
  // An earlier version of this diag assumed A=parent/B=component and reported
  // hundreds of false "unresolved" rows. Column indices below follow the reader.
  var BOM_FG = 1, BOM_COMP = 5;

  var o = [];
  o.push('BOM  (sheet "' + used + '", rows: ' + (data.length - 1) + ')');
  o.push('  header: ' + data[0].join(' | '));
  o.push('  RULE: fgCode = col B, compCode = col F (per Production.getBomRows_).');

  var missFg = {}, missComp = {}, okRows = 0;
  for (var j = 1; j < data.length; j++) {
    var r = data[j];
    var fg   = String(r[BOM_FG] || '').trim();
    var comp = String(r[BOM_COMP] || '').trim();
    if (!fg && !comp) continue;
    if (fg   && !mats[fg])   missFg[fg]     = (missFg[fg] || 0) + 1;
    if (comp && !mats[comp]) missComp[comp] = (missComp[comp] || 0) + 1;
    if ((!fg || mats[fg]) && (!comp || mats[comp])) okRows++;
  }

  o.push('  rows fully resolving to MASTERS_Materials: ' + okRows);
  var fgKeys = Object.keys(missFg), compKeys = Object.keys(missComp);
  if (!fgKeys.length && !compKeys.length) {
    o.push('  ✔ every FG and component code resolves.');
    return o.join('\n');
  }
  if (fgKeys.length) {
    o.push('  ✘ FG codes not in MASTERS_Materials (' + fgKeys.length + ' distinct):');
    fgKeys.slice(0, 25).forEach(function(k) { o.push('    "' + k + '"  ×' + missFg[k] + ' rows'); });
    if (fgKeys.length > 25) o.push('    … +' + (fgKeys.length - 25) + ' more');
  }
  if (compKeys.length) {
    o.push('  ✘ COMPONENT codes not in MASTERS_Materials (' + compKeys.length + ' distinct)');
    o.push('     — these are the ones that matter: production cannot locate stock for them.');
    compKeys.slice(0, 25).forEach(function(k) { o.push('    "' + k + '"  ×' + missComp[k] + ' rows'); });
    if (compKeys.length > 25) o.push('    … +' + (compKeys.length - 25) + ' more');
  }
  return o.join('\n');
}

// Render a cell so invisible problems (whitespace, wrong type, bool) are obvious.
function _ddShow_(v) {
  if (v === '' || v === null || v === undefined) return '(blank)';
  if (v === true) return 'TRUE(boolean)';
  if (v === false) return 'FALSE(boolean)';
  var s = String(v);
  if (s !== s.trim()) return '"' + s + '"(has whitespace)';
  return '"' + s + '"';
}
