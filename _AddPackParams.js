// ============================================================
// _AddPackParams.js — one-off: add the packing-line inspection parameters to
// MASTERS_Parameters so they can be enabled per product in Control Plan config.
//
// Idempotent: a code that already exists is skipped, so re-running is safe.
// Dry run unless confirm=YES. Exposed via ?diag=addpackparams (Code.js).
//
// MASTERS_Parameters live header (14 cols):
//   [0] code | [1] name | [2] unit | [3] std_value | [4] tol_min | [5] tol_max
//   [6] method_type | [7] check_brief | [8] tools | [9] doc_ref | [10] doc_number
//   [11] category | [12] ccp | [13] sort
// ============================================================

// code, name, method, check_brief, tools, ccp, sort
// All are attribute (pass/fail) checks on the packing line, so unit and
// std/tol are left blank and std_value carries the Pass/Fail convention
// already used by QP003/QP015/QP017/QP018.
var _APP_ROWS_ = [
  ['QP023', 'Check Color',              'Visual', 'Compare product/pack colour against the approved standard under D65 light.', 'Colour standard / light box', 'N', 23],
  ['QP024', 'Ensure No Dust',           'Visual', 'Inspect pack and product surface for dust, fibre or foreign particles.', 'Visual / lint-free cloth', 'Y', 24],
  ['QP025', 'Check Label',              'Visual', 'Verify correct label applied, right orientation, no tear, wrinkle or lift.', 'Approved label sample', 'Y', 25],
  ['QP026', 'LD Side Check',            'Visual', 'Inspect the LD (long/leading) side seam and edge for defects.', 'Visual', 'N', 26],
  ['QP027', 'V Notch Check',            'Visual', 'Confirm the V notch is present, correctly positioned and cleanly formed.', 'Visual / gauge', 'N', 27],
  ['QP028', 'Check MRP Batch No MFD',   'Visual', 'Verify MRP, batch number and MFD are printed, legible and correct.', 'Approved artwork / batch sheet', 'Y', 28],
  ['QP029', 'Carton Printing',          'Visual', 'Check carton print for registration, smudge, missing or wrong text vs proof.', 'Approved proof / loupe', 'N', 29],
  ['QP030', 'Cap Color',                'Visual', 'Confirm cap colour matches the approved standard for this SKU.', 'Colour standard', 'N', 30],
  ['QP031', 'Cap Fitment',              'Visual', 'Check cap seats fully and squarely; no cross-thread, cock-cap or gap.', 'Visual / torque tester', 'Y', 31],
  ['QP032', 'Induction Cap Sealing',    'Test',   'Verify induction seal is complete and bonded; no partial or missing seal.', 'Seal tester / visual', 'Y', 32],
  ['QP033', 'Check Taping',             'Visual', 'Confirm tape applied straight, correct length, flaps fully secured.', 'Visual', 'N', 33],
  ['QP034', 'Check Strapping',          'Visual', 'Verify strap count, tension and position; no slack or cut strap.', 'Visual / tension gauge', 'N', 34],
  ['QP035', 'Check Stacking',           'Visual', 'Confirm stack pattern, layer count and alignment per pallet spec.', 'Pallet pattern sheet', 'N', 35]
];

// Already in MASTERS_Parameters under a different name — reused, not duplicated,
// so a plan never shows the same check twice.
var _APP_EXISTING_ = [
  ['Print Quality',  'QP003', 'Print Quality — Colour Match'],
  ['Check Counter',  'QP020', 'Quantity / Count']
];

function addPackingLineParams(doWrite) {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Parameters');
  if (!ws) return 'MASTERS_Parameters not found.';

  var data = ws.getDataRange().getValues();
  var width = Math.max(ws.getLastColumn(), 14);
  var existing = {};
  var existingNames = {};
  for (var i = 1; i < data.length; i++) {
    var c = String(data[i][0] || '').trim();
    if (c) existing[c.toUpperCase()] = i + 1;
    var n = String(data[i][1] || '').trim().toLowerCase();
    if (n) existingNames[n] = c;
  }

  var toAdd = [], skipped = [];
  _APP_ROWS_.forEach(function(r) {
    if (existing[r[0]]) { skipped.push(r[0] + ' (code already at row ' + existing[r[0]] + ')'); return; }
    var nameHit = existingNames[String(r[1]).toLowerCase()];
    if (nameHit) { skipped.push(r[0] + ' "' + r[1] + '" (same name already exists as ' + nameHit + ')'); return; }
    toAdd.push(r);
  });

  var out = [];
  out.push('ADD PACKING-LINE PARAMETERS  (' + (doWrite ? 'LIVE WRITE' : 'DRY RUN') + ')');
  out.push('MASTERS_Parameters rows before: ' + (data.length - 1) + ', cols: ' + width);
  out.push('');
  out.push('ALREADY COVERED — reuse these, no duplicate created:');
  _APP_EXISTING_.forEach(function(e) {
    out.push('  "' + e[0] + '"  ->  ' + e[1] + '  "' + e[2] + '"');
  });
  out.push('');
  out.push('TO ADD (' + toAdd.length + '):');
  toAdd.forEach(function(r) {
    out.push('  ' + r[0] + '  ' + _appPad_(r[1], 26) + 'method=' + _appPad_(r[2], 10) +
             (r[5] === 'Y' ? 'CCP' : ''));
  });
  if (skipped.length) {
    out.push('');
    out.push('SKIPPED (' + skipped.length + '):');
    skipped.forEach(function(s) { out.push('  ' + s); });
  }

  out.push('');
  out.push('Category is left BLANK, matching the existing QP001-QP022 block: these are');
  out.push('enabled per product through CONTROL_FG, not auto-applied by category.');
  out.push('std_value = "Pass/Fail" (the convention QP003/QP015/QP017/QP018 already use);');
  out.push('tol_min/tol_max blank — these are attribute checks, not measurements.');

  if (!doWrite) {
    out.push('');
    out.push('Dry run — nothing written. Re-run with &confirm=YES to apply.');
    return out.join('\n');
  }
  if (!toAdd.length) {
    out.push('');
    out.push('Nothing to add — all already present.');
    return out.join('\n');
  }

  var rows = toAdd.map(function(r) {
    var row = new Array(width);
    for (var k = 0; k < width; k++) row[k] = '';
    row[0]  = r[0];          // code
    row[1]  = r[1];          // name
    row[2]  = '';            // unit — attribute check
    row[3]  = 'Pass/Fail';   // std_value
    row[4]  = '';            // tol_min
    row[5]  = '';            // tol_max
    row[6]  = r[2];          // method_type
    row[7]  = r[3];          // check_brief
    row[8]  = r[4];          // tools
    row[9]  = 'PM/FRM/IPQC-01';
    if (width > 11) row[11] = '';     // category — blank, like QP001-QP022
    if (width > 12) row[12] = r[5];   // ccp
    if (width > 13) row[13] = r[6];   // sort
    return row;
  });

  ws.getRange(ws.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  SpreadsheetApp.flush();

  var after = (typeof getParameters === 'function') ? getParameters().length : -1;
  out.push('');
  out.push('WROTE ' + rows.length + ' rows. getParameters() now returns: ' + after);
  return out.join('\n');
}

function _appPad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
