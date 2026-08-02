/**
 * _MaterialsSchemaFix.js — repair MASTERS_Materials to match the MAT_COL contract.
 *
 *   ?diag=matschemafix               DRY RUN (writes nothing)
 *   ?diag=matschemafix&confirm=YES   apply
 *
 * WHY
 * MAT_COL declares 13 columns (0..12) with INSP_CATEGORY at 12, but the live sheet
 * has 12 (0..11) and its header disagrees from col 5 onward:
 *      [5] contract 'Reorder Level' vs sheet 'LastModified'
 *      [6] contract 'Each L (mm)'   vs sheet 'ModifiedBy'
 * Every read/write through MAT_COL therefore hits the wrong column, and
 * inspectionCategory has nowhere to live at all.
 *
 * OBSERVED STATE (?diag=matprobe, 180 rows)
 *      [5] LastModified   0/180 filled  — empty
 *      [6] ModifiedBy     7/180 filled  — NUMBERS (19, 19, 6.2): these are Each L
 *                                         values written through the shifted contract
 *      [7] Each W         0/180 filled  — empty
 *      [8] Each H         7/180,  [9] Each Weight 6/180,  [10] Per Pallet 2/180,
 *      [11] Fit Class     4/180
 * Cols 8-11 already align with the contract, so only col 6 needs its data moved:
 * ModifiedBy -> Each L (mm), which is what those numbers actually are.
 *
 * The audit pair is NOT dropped — MastersCrud stamps LastModified/ModifiedBy on every
 * master sheet, so they are appended after Inspection Category (13/14), matching what
 * _ParamHeaderFix did for MASTERS_Parameters.
 */

var MAT_WANT_HEADER_ = [
  'Item Code', 'Item Description', 'Unit', 'Category', 'Default Location',
  'Reorder Level', 'Each L (mm)', 'Each W (mm)', 'Each H (mm)', 'Each Weight (kg)',
  'Per Pallet (TIxHI)', 'Fit Class', 'Inspection Category',
  'LastModified', 'ModifiedBy'
];

function fixMaterialsSchema(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials missing.';

  var lr = ws.getLastRow(), lc = ws.getLastColumn();
  var hdr = ws.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var data = lr > 1 ? ws.getRange(2, 1, lr - 1, lc).getValues() : [];

  var L = ['MASTERS_Materials schema repair — ' + (apply ? 'LIVE' : 'DRY RUN')];
  L.push('current: ' + (lr - 1) + ' data rows x ' + lc + ' cols');
  L.push('target : ' + MAT_WANT_HEADER_.length + ' cols');
  L.push('');

  // Idempotence: already repaired?
  var same = hdr.length === MAT_WANT_HEADER_.length && MAT_WANT_HEADER_.every(function (w, i) {
    return String(hdr[i] || '').toLowerCase() === w.toLowerCase();
  });
  if (same) { L.push('Header already matches the contract — nothing to do.'); return L.join('\n'); }

  // ── 1. header changes ────────────────────────────────────────────
  L.push('--- header ---');
  for (var i = 0; i < MAT_WANT_HEADER_.length; i++) {
    var from = i < hdr.length ? (hdr[i] || '(blank)') : '(NEW COLUMN)';
    if (String(from).toLowerCase() !== MAT_WANT_HEADER_[i].toLowerCase()) {
      L.push('  [' + i + '] "' + from + '"  ->  "' + MAT_WANT_HEADER_[i] + '"');
    }
  }

  // ── 2. data move: col 6 (ModifiedBy) currently holds Each L numbers ──
  // Guard: only move values that are genuinely numeric. A real email/name in that
  // column would mean MastersCrud has since written proper audit data, and moving
  // it into a dimension column would be destructive.
  var OLD_MODIFIEDBY = 6, NEW_EACH_L = 6;   // same index — the HEADER is what changes
  var moves = [], blockers = [];
  data.forEach(function (r, n) {
    var v = r[OLD_MODIFIEDBY];
    if (v === '' || v == null) return;
    if (typeof v === 'number') {
      moves.push('    row ' + (n + 2) + '  ' + String(r[0]) + '  Each L = ' + v);
    } else {
      blockers.push('    row ' + (n + 2) + '  ' + String(r[0]) + '  NON-NUMERIC "' + String(v).slice(0, 40) + '"');
    }
  });

  L.push('');
  L.push('--- data ---');
  L.push('  col 6 keeps its VALUES and only changes meaning: "ModifiedBy" -> "Each L (mm)".');
  L.push('  numeric values staying in place (now correctly labelled): ' + moves.length);
  moves.slice(0, 8).forEach(function (m) { L.push(m); });
  if (moves.length > 8) L.push('    ... +' + (moves.length - 8) + ' more');

  if (blockers.length) {
    L.push('');
    L.push('  !! BLOCKED — col 6 holds ' + blockers.length + ' NON-NUMERIC value(s). These look like');
    L.push('     real audit data, not dimensions. Relabelling would corrupt them.');
    blockers.slice(0, 10).forEach(function (b) { L.push(b); });
    L.push('     Resolve these rows before applying.');
    return L.join('\n');
  }

  L.push('  no cell values are rewritten; ' + (MAT_WANT_HEADER_.length - lc) + ' new empty column(s) appended.');

  if (!apply) {
    L.push('');
    L.push('DRY RUN — nothing written. Re-run with &confirm=YES to apply.');
    return L.join('\n');
  }

  // ── 3. apply: header row only, plus widening ──────────────────────
  ws.getRange(1, 1, 1, MAT_WANT_HEADER_.length).setValues([MAT_WANT_HEADER_]);
  ws.getRange(1, 1, 1, MAT_WANT_HEADER_.length)
    .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  SpreadsheetApp.flush();

  L.push('');
  L.push('APPLIED: header rewritten to ' + MAT_WANT_HEADER_.length + ' columns. 0 data cells modified.');
  L.push('Inspection Category (col 12) now exists and is empty — run ?diag=inspcatapply next.');
  return L.join('\n');
}
