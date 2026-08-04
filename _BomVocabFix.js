// BOM vocabulary repair. Dry run by default, idempotent.
//   ?diag=bomvocabfix              → dry run
//   ?diag=bomvocabfix&confirm=YES  → apply
//
// ITEM 1 of VOCAB-NORMALIZATION.scope.md — normalise BOM component UoM to the
// same 4 values MASTERS_Materials already uses.
//
// WHY: ?diag=vocabaudit found 143 of 195 BOM rows disagreeing with the material
// master on unit (BOM "PC" vs master "NOS", BOM "M" vs master "MTR"). This is
// partly self-inflicted — an earlier commit normalised MASTERS_Materials to 4
// values and left BOM untouched, so two sheets that were equally messy now
// actively disagree.
//
// SAFE because compUom is DISPLAY-ONLY: getBomRows_ (Production.js:611) reads
// it, Production.js:686/891 pass it through, Production_F.html:777-785 prints
// it. No logic branches on it (verified by grep before writing this).
//
// ITEM 3 (customer code column) is NOT here — it changes the sheet's shape and
// a live filter, so it ships separately with its own gate run.

// Same canonical map _MatDataFix used on MASTERS_Materials, so the two sheets
// converge on one vocabulary rather than two tidy-but-different ones.
var BOM_UOM_CANON_ = {
  "NO'S": 'NOS', 'NOS': 'NOS', 'PC': 'NOS', 'PCS': 'NOS', 'NO': 'NOS',
  'CON': 'NOS', 'CONS': 'NOS',
  'KGS': 'KG', 'KG': 'KG',
  'MTR': 'MTR', 'M': 'MTR',
  'LTR': 'LTR', 'L': 'LTR'
};

var BOM_COL_ = { CLIENT: 0, FG: 1, FG_DESC: 2, BASE_QTY: 3, FG_UOM: 4,
                 COMP: 5, COMP_DESC: 6, QTY_STPO: 7, COMP_UOM: 8,
                 CONSUM: 9, TYPE: 10, MASTER_P: 11 };

function fixBomVocabulary(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('BOM');
  if (!ws) return 'BOM sheet missing.';
  var d = ws.getDataRange().getValues();
  if (d.length < 2) return 'BOM is empty.';

  var out = ['BOM vocabulary repair — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('rows=' + (d.length - 1) + '  cols=' + ws.getLastColumn());
  out.push('');

  // Positional guard — refuse to write if the header is not what we expect.
  var hdr = d[0];
  if (String(hdr[BOM_COL_.COMP_UOM]).trim().toLowerCase().indexOf('comp') !== 0 ||
      String(hdr[BOM_COL_.COMP]).trim().toLowerCase().indexOf('component') !== 0) {
    return 'ABORT: BOM header is not the expected shape. col F should be ' +
           '"Component", col I "Comp UoM". Got F="' + hdr[BOM_COL_.COMP] +
           '" I="' + hdr[BOM_COL_.COMP_UOM] + '".';
  }

  // Material master unit per code — the target vocabulary.
  var unitByCode = {};
  var mw = ss.getSheetByName('MASTERS_Materials');
  if (mw && mw.getLastRow() > 1) {
    mw.getDataRange().getValues().slice(1).forEach(function (r) {
      var c = String(r[MAT_COL.CODE] || '').trim();
      if (c) unitByCode[c] = String(r[MAT_COL.UNIT] || '').trim();
    });
  }

  var writes = [], unknown = [], stillDiff = [], byMap = {};
  for (var i = 1; i < d.length; i++) {
    var r = d[i];
    if (!String(r[BOM_COL_.FG] || '').trim()) continue;
    var raw = String(r[BOM_COL_.COMP_UOM] || '').trim();
    if (!raw) continue;
    var canon = BOM_UOM_CANON_[raw.toUpperCase()];
    if (!canon) { unknown.push('row ' + (i + 1) + ' "' + raw + '"'); continue; }
    if (canon !== raw) {
      writes.push({ row: i + 1, from: raw, to: canon });
      byMap[raw + ' -> ' + canon] = (byMap[raw + ' -> ' + canon] || 0) + 1;
    }
    // After canonicalising, does it now agree with the material master?
    var comp = String(r[BOM_COL_.COMP] || '').trim();
    var mu = unitByCode[comp];
    if (mu && mu.toUpperCase() !== canon) {
      stillDiff.push(comp + '  BOM->' + canon + '  master=' + mu);
    }
  }

  out.push('Comp UoM (col I) rewrites: ' + writes.length);
  Object.keys(byMap).sort().forEach(function (k) { out.push('    ' + k + '   (' + byMap[k] + ' rows)'); });
  out.push('  unrecognised (LEFT ALONE): ' + unknown.length);
  unknown.slice(0, 8).forEach(function (u) { out.push('     ?  ' + u); });
  out.push('');

  // The point of the exercise: does BOM agree with the master AFTER the fix?
  out.push('Rows STILL disagreeing with MASTERS_Materials after canonicalising: ' + stillDiff.length);
  stillDiff.slice(0, 10).forEach(function (s) { out.push('     !! ' + s); });
  if (stillDiff.length) {
    out.push('  (these are genuine data disagreements, not spelling — a component');
    out.push('   whose BOM unit really differs from its master unit. Needs a human.)');
  }
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  writes.forEach(function (w) { ws.getRange(w.row, BOM_COL_.COMP_UOM + 1).setValue(w.to); });

  out.push('APPLIED: ' + writes.length + ' Comp UoM cells rewritten.');
  out.push('Remaining genuine disagreements: ' + stillDiff.length);
  return out.join('\n');
}
