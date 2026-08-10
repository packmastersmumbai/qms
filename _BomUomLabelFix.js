// Correct the BOM Comp UoM label on the three components whose unit was decided
// from consumption evidence (?diag=uomguard).
//   ?diag=bomuomfix              → dry run
//   ?diag=bomuomfix&confirm=YES  → apply
//
// This changes a LABEL ONLY. Not one consum, quantity or masterP value is
// touched: the numbers were always expressed in the master's unit, the BOM's
// unit cell simply named them wrongly. That is why this is safe and why it is
// NOT a conversion — converting the numbers would break every quantity that is
// already correct.
//
// The evidence, from the consumption figures rather than from the descriptions:
//
//   1706619  BOPP tape 48mm 65mtr   NOS -> MTR
//       consum 0.002-0.0234 per unit, and masterP = 60 on 4 of 9 rows. A pack
//       size of 60 is a roll's usable metres; a count of rolls could not be
//       fractional. Unblocks 9 of the 11 stuck FGs on its own.
//
//   1308119  LOCTITE BONDACE 007 POWDER 16KG   NOS -> KG
//       consum 0.016, masterP 0.32. A 0.32 pack can only be kilograms — nobody
//       issues a third of a bag.
//
//   200158-000000  Elastic Band (5 sachet unitization)   KG -> NOS
//       consum 0.00004, masterP 5000. A 5000-piece bag; 0.00004 kg is one
//       band's weight, so the quantities are counts.
//
// DELIBERATELY EXCLUDED — 3092039 (LOCTITE BONDACE 007 PSFG). consum is exactly
// 1.01 (reads as one unit + 1% wastage, arguing the BOM's NOS is right and the
// MASTER is wrong — the opposite direction to the three above), but masterP is
// 170 on two rows and 0.32 on a third, which is internally inconsistent. Two
// plausible answers pointing opposite ways is not something to resolve by
// guessing, so FG 1774271 stays blocked until its owner decides.

var BOM_UOM_LABEL_FIXES_ = {
  '1706619':        { from: 'NOS', to: 'MTR' },
  '1308119':        { from: 'NOS', to: 'KG'  },
  '200158-000000':  { from: 'KG',  to: 'NOS' }
};

function fixBomUomLabels(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('BOM');
  if (!ws) return 'BOM sheet missing.';

  var out = ['BOM Comp UoM label fix — ' + (apply ? 'LIVE' : 'DRY RUN'), ''];

  // Assert the sheet, not the constant: COMP is col F (5), COMP_UOM is col I (8).
  var hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var hComp = String(hdr[5] || '').trim();
  var hUom  = String(hdr[8] || '').trim();
  if (!/comp/i.test(hComp) || !/uom|unit/i.test(hUom)) {
    out.push('ABORT: unexpected BOM header.');
    out.push('  col F expected a component code column, got "' + hComp + '"');
    out.push('  col I expected a comp UoM column, got "' + hUom + '"');
    return out.join('\n');
  }
  out.push('header check: col F="' + hComp + '"  col I="' + hUom + '"');
  out.push('');

  var d = ws.getDataRange().getValues();
  var writes = [], skipped = [];

  for (var i = 1; i < d.length; i++) {
    var code = String(d[i][5] || '').trim();
    var fix = BOM_UOM_LABEL_FIXES_[code];
    if (!fix) continue;
    var cur = String(d[i][8] || '').trim();
    if (cur.toUpperCase() === fix.to.toUpperCase()) continue;      // already right
    // Only rewrite the value we predicted. A third unit means the sheet moved
    // under us and the evidence above no longer describes this row.
    if (cur.toUpperCase() !== fix.from.toUpperCase()) {
      skipped.push('row' + (i + 1) + '  ' + code + '  expected "' + fix.from +
                   '" found "' + cur + '" — left alone');
      continue;
    }
    writes.push({ row: i + 1, code: code, from: cur, to: fix.to });
  }

  if (skipped.length) {
    out.push('SKIPPED (unexpected current value):');
    skipped.forEach(function (s) { out.push('  ?  ' + s); });
    out.push('');
  }

  out.push('rows to relabel: ' + writes.length);
  writes.forEach(function (w) {
    out.push('  SET row' + w.row + '  ' + w.code + '   ' + w.from + ' -> ' + w.to);
  });

  if (!writes.length) { out.push(''); out.push('Nothing to do.'); return out.join('\n'); }

  if (!apply) {
    out.push('');
    out.push('DRY RUN — re-run with &confirm=YES to write ' + writes.length + ' cells.');
    return out.join('\n');
  }

  writes.forEach(function (w) { ws.getRange(w.row, 9).setValue(w.to); });
  SpreadsheetApp.flush();
  // The production read cache memoises BOM and master reads per request; drop it
  // so any later read in this same execution sees the relabelled rows.
  if (typeof prodCacheReset_ === 'function') prodCacheReset_();

  var after = ws.getDataRange().getValues();
  var bad = writes.filter(function (w) {
    return String(after[w.row - 1][8]).trim().toUpperCase() !== w.to.toUpperCase();
  });

  out.push('');
  out.push('WROTE ' + writes.length + ' cells; verify failures: ' + bad.length);
  out.push(bad.length ? 'RESULT: FAIL' : 'RESULT: PASS');
  out.push('');
  out.push('Next: ?diag=uomguard should now report 1 component (3092039) and 1 FG (1774271).');
  return out.join('\n');
}
