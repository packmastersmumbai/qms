// ============================================================
// _ApproveSuppliers.js — one-off: set Approved (Y/N) = 'Y' on supplier rows
// whose approval cell is blank, so they appear in GRN dropdowns.
//
// Idempotent: only touches cells that are currently blank; an explicit 'N'
// is left alone (that is a deliberate decision, not a gap).
// Column G = 'Approved (Y/N)' per the live sheet header. Gated on confirm=YES.
// Exposed via ?diag=approvesuppliers (Code.js).
// ============================================================

var _AS_APPROVED_COL = 7;   // 1-based col G

// Does this cell value look like an approval flag (rather than stray data such as
// a city that a shifted write dumped into the Approved column)?
function _asIsApprovalToken_(v) {
  if (v === true || v === false) return true;
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'Y' || s === 'N' || s === 'YES' || s === 'NO' || s === 'TRUE' || s === 'FALSE';
}

function approveBlankSuppliers(doWrite) {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Suppliers');
  if (!ws) return 'MASTERS_Suppliers not found.';
  var data = ws.getDataRange().getValues();

  var header = String(data[0][_AS_APPROVED_COL - 1] || '');
  if (header.toLowerCase().indexOf('approved') < 0) {
    return 'ABORT: col G header is "' + header + '", expected "Approved (Y/N)". ' +
           'Sheet shape changed — re-check before writing.';
  }

  var targets = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;                                  // no supplier code
    var cell = String(r[_AS_APPROVED_COL - 1] || '').trim();
    if (cell !== '') continue;                            // already Y or explicit N
    targets.push({ row: i + 1, code: String(r[0]).trim(), name: String(r[1] || '') });
  }

  // Rows written by the pre-fix saveMaster are shifted one column right: a CITY
  // sits in G (Approved) and the real 'Y' landed in H (State Code). Detect that
  // exact signature and unshift, rather than blindly stamping 'Y' over a city.
  var shifted = [];
  for (var j = 1; j < data.length; j++) {
    var q = data[j];
    if (!q[0]) continue;
    var g = String(q[_AS_APPROVED_COL - 1] || '').trim();
    var h = String(q[_AS_APPROVED_COL] || '').trim().toUpperCase();
    if (g === '' || _asIsApprovalToken_(g)) continue;      // G already an approval value
    if (h !== 'Y' && h !== 'YES') continue;                // only the shifted signature
    shifted.push({ row: j + 1, code: String(q[0]).trim(), name: String(q[1] || ''), city: g });
  }

  var out = [];
  out.push('APPROVE BLANK SUPPLIERS  (' + (doWrite ? 'LIVE WRITE' : 'DRY RUN') + ')');
  out.push('col G header: "' + header + '"');
  out.push('');
  out.push('A. blank approval → Y   (' + targets.length + ' rows)');
  targets.forEach(function(t) {
    out.push('  row ' + t.row + '  ' + t.code + ' / ' + t.name + (doWrite ? '  → Y' : ''));
  });
  out.push('');
  out.push('B. shifted rows (city in G, Y in H) → unshift   (' + shifted.length + ' rows)');
  shifted.forEach(function(s) {
    out.push('  row ' + s.row + '  ' + s.code + ' / ' + s.name +
             '   G="' + s.city + '" → City,  G → "Y"' + (doWrite ? '  [applied]' : ''));
  });

  if (!doWrite) {
    out.push('');
    out.push('Dry run — nothing written. Re-run with &confirm=YES to apply.');
    return out.join('\n');
  }

  targets.forEach(function(t) { ws.getRange(t.row, _AS_APPROVED_COL).setValue('Y'); });
  // Unshift: move the city back into F (City / Location) and set G='Y'. H (State
  // Code) held the stray 'Y' and is cleared, since the real state code was lost
  // when the shifted write overwrote it.
  shifted.forEach(function(s) {
    ws.getRange(s.row, _AS_APPROVED_COL - 1).setValue(s.city);  // F City / Location
    ws.getRange(s.row, _AS_APPROVED_COL).setValue('Y');         // G Approved
    ws.getRange(s.row, _AS_APPROVED_COL + 1).setValue('');      // H State Code
  });
  SpreadsheetApp.flush();

  var after = (typeof getSuppliers === 'function') ? getSuppliers().length : -1;
  out.push('');
  out.push('WROTE ' + targets.length + ' cells. getSuppliers() now returns: ' + after);
  return out.join('\n');
}
