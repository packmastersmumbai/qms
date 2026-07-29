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

  var o = [];
  o.push('BOM  (sheet "' + used + '", rows: ' + (data.length - 1) + ')');
  o.push('  header: ' + data[0].join(' | '));
  var bad = [];
  for (var j = 1; j < data.length; j++) {
    var r = data[j];
    if (!r[0] && !r[1]) continue;
    var parent = String(r[0] || '').trim();
    var comp   = String(r[1] || '').trim();
    if (parent && !mats[parent]) bad.push('    row ' + (j + 1) + '  PARENT "' + parent + '" not in MASTERS_Materials');
    if (comp   && !mats[comp])   bad.push('    row ' + (j + 1) + '  COMPONENT "' + comp + '" not in MASTERS_Materials');
  }
  if (!bad.length) o.push('  ✔ all BOM parent/component codes resolve to materials.');
  else {
    o.push('  ✘ UNRESOLVED codes (' + bad.length + ') — BOM references a code the material master lacks:');
    bad.forEach(function(b) { o.push(b); });
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
