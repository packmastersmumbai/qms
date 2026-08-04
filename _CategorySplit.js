// Make Category (col D) 1:1 with Inspection Category (col M), so col M becomes
// derivable and can be retired.
//   ?diag=catsplit              → dry run
//   ?diag=catsplit&confirm=YES  → apply
//
// THE PROBLEM
// Three Category values map to two inspection categories each, so col M is NOT
// derivable from col D today (?diag=vocabaudit). Inspected row by row
// (?diag=amblist), the ambiguity is GENUINE — the same purchase category really
// does get inspected two different ways:
//
//   LABELS -> HDPE_BOTTLE   "Label Bottle Petrol 40ml"      stuck to a bottle
//   LABELS -> LABEL         "Label for Corrugated Box"      flat
//   FG     -> CARTON        "Milex Petrol Box 60X 110ML"    a box sold as FG
//   FG     -> FG            "Milex Diesel (120N X50ML)"     filled product
//   TAPE   -> CARTON        "Self Adhesive tape for Mono carton"
//   TAPE   -> LABEL         "BOPP Tape for corrugated box"
//
// A bottle label is tested for fit/curvature/adhesion on HDPE; a carton label is
// tested flat. A corrugated box is tested for burst and ECT; filled product for
// fill weight, leak and cap. Deriving col M from col D as it stands would send
// 19 materials to the WRONG inspection.
//
// THE FIX
// Split the three ambiguous Category values so the distinction lives in col D:
//   LABELS -> LABELS-BOTTLE | LABELS-FLAT
//   FG     -> FG-CARTON     | FG            (FG keeps its name; only boxes move)
//   TAPE   -> TAPE-CARTON   | TAPE-FLAT
// After this, Category -> InspCategory is a function and col M is redundant.
//
// Assignment is driven by the row's EXISTING InspCategory — that column is the
// QA team's own judgement, already applied per material. This reads it rather
// than re-deciding from the description, so no inspection assignment changes.

var CAT_SPLIT_MAP_ = {
  'LABELS': { 'HDPE_BOTTLE': 'LABELS-BOTTLE', 'LABEL': 'LABELS-FLAT' },
  'FG':     { 'CARTON': 'FG-CARTON',          'FG': 'FG' },
  'TAPE':   { 'CARTON': 'TAPE-CARTON',        'LABEL': 'TAPE-FLAT' }
};

function splitAmbiguousCategories(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials missing.';
  var C = MAT_COL;
  var d = ws.getDataRange().getValues();

  var out = ['Category split — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('rows=' + (d.length - 1));
  out.push('');

  var hdr = d[0];
  if (String(hdr[C.CATEGORY]).trim() !== 'Category' ||
      String(hdr[C.INSP_CATEGORY]).trim() !== 'Inspection Category') {
    return 'ABORT: header is not the expected MAT_COL contract.';
  }

  var writes = [], blanks = [], byMove = {};
  for (var i = 1; i < d.length; i++) {
    var r = d[i];
    if (!String(r[C.CODE] || '').trim()) continue;
    var cat  = String(r[C.CATEGORY] || '').trim().toUpperCase();
    var insp = String(r[C.INSP_CATEGORY] || '').trim().toUpperCase();
    var m = CAT_SPLIT_MAP_[cat];
    if (!m) continue;

    if (!insp) {
      // Cannot split what QA never classified. Reported, never guessed.
      blanks.push('row ' + (i + 1) + '  ' + String(r[C.CODE]) + '  ' +
                  String(r[C.DESC] || '').slice(0, 40) + '  (blank InspCategory)');
      continue;
    }
    var want = m[insp];
    if (!want) {
      blanks.push('row ' + (i + 1) + '  ' + String(r[C.CODE]) +
                  '  UNMAPPED ' + cat + '/' + insp);
      continue;
    }
    if (want !== String(r[C.CATEGORY] || '').trim()) {
      writes.push({ row: i + 1, code: String(r[C.CODE]), from: cat, to: want });
      byMove[cat + ' + ' + insp + ' -> ' + want] = (byMove[cat + ' + ' + insp + ' -> ' + want] || 0) + 1;
    }
  }

  out.push('Category rewrites: ' + writes.length);
  Object.keys(byMove).sort().forEach(function (k) { out.push('    ' + k + '   (' + byMove[k] + ' rows)'); });
  out.push('');
  out.push('NOT split (need a human): ' + blanks.length);
  blanks.forEach(function (b) { out.push('    !! ' + b); });
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  writes.forEach(function (w) { ws.getRange(w.row, C.CATEGORY + 1).setValue(w.to); });

  // Prove the goal was reached: is the mapping now 1:1?
  var d2 = ws.getDataRange().getValues(), pairs = {}, amb = 0;
  for (var j = 1; j < d2.length; j++) {
    if (!String(d2[j][C.CODE] || '').trim()) continue;
    var cd = String(d2[j][C.CATEGORY] || '').trim() || '(blank)';
    var cm = String(d2[j][C.INSP_CATEGORY] || '').trim() || '(blank)';
    pairs[cd] = pairs[cd] || {};
    pairs[cd][cm] = (pairs[cd][cm] || 0) + 1;
  }
  Object.keys(pairs).forEach(function (k) { if (Object.keys(pairs[k]).length > 1) amb++; });

  out.push('APPLIED: ' + writes.length + ' Category cells rewritten.');
  out.push('Category values still mapping to >1 InspCategory: ' + amb);
  out.push(amb === 0
    ? 'Category -> InspCategory is now a FUNCTION. Col M is derivable and can be retired.'
    : 'STILL AMBIGUOUS — do not retire col M yet.');
  return out.join('\n');
}

// The derivation col M becomes once the split is applied: Category -> the
// inspection category to use. Built FROM the sheet, not hardcoded, so it cannot
// drift from the data it describes.
function inspCategoryForCategory(category) {
  var cat = String(category || '').trim().toUpperCase();
  if (!cat) return '';
  var c = (typeof prodCache_ === 'function') ? prodCache_() : {};
  if (!c.inspByCat) {
    var map = {};
    var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
    if (ws && ws.getLastRow() > 1) {
      ws.getDataRange().getValues().slice(1).forEach(function (r) {
        var k = String(r[MAT_COL.CATEGORY] || '').trim().toUpperCase();
        var v = String(r[MAT_COL.INSP_CATEGORY] || '').trim();
        if (k && v && !map[k]) map[k] = v;
      });
    }
    c.inspByCat = map;
  }
  return c.inspByCat[cat] || '';
}
