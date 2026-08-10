// Create the MASTERS_Materials rows the revised KETO BOM references, and repair
// the last few self-referencing BULK rows it still carries.
//   ?diag=ketomat              → dry run
//   ?diag=ketomat&confirm=YES  → apply
//
// The revised BOM now names real component codes (2233-BULK, BOTAPPLAUD1000,
// BOPPTAPECMN…), so the master rows can be built FROM the BOM itself — code,
// description, UoM and type are all present per row. Nothing is invented.
//
// TWO STEPS, in order:
//
//   1. REPAIR 11 leftover self-references. These rows still have component =
//      the FG's own code with description "BULK":
//        row232  fg=2236-0031  comp=2236-BULK   14.5 KG   <- correct
//        row237  fg=2236-0032  comp=2236-0032   14.5 KG   <- self-reference
//      The sibling row proves the intent: same product family, same quantity,
//      same UoM. Repointing to <family>-BULK is a derivation, not a guess.
//      Doing this FIRST means step 2 never creates a material for a code that
//      should not exist.
//
//   2. CREATE the remaining missing materials, FG and component, from the BOM.
//      Category comes from the BOM's Type column mapped to the master's
//      vocabulary; Inspection Category is then DERIVED from Category, which is
//      1:1 since ?diag=catsplit.
//
// Default location is left BLANK deliberately — see the note at the write site.

// BOM Type -> MASTERS_Materials Category. Uses the post-catsplit vocabulary so
// the new rows land 1:1 with an Inspection Category from day one.
var KETO_TYPE_TO_CAT_ = {
  'BULK': 'BULK',
  'BOTTLES': 'BOTTLES',
  'LABELS': 'LABELS-BOTTLE',   // every KETO label is a bottle label
  'CARTON': 'CARTONS',
  'CARTONS': 'CARTONS',
  'TAPE': 'TAPE-CARTON'        // BOPP tape sealing a carton
};

function fixKetoMaterials(apply) {
  var ss = getSpreadsheet();
  var bw = ss.getSheetByName('BOM');
  var mw = ss.getSheetByName('MASTERS_Materials');
  if (!bw || !mw) return 'BOM or MASTERS_Materials missing.';

  var out = ['KETO materials — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('');

  if (String(mw.getRange(1, MAT_COL.CODE + 1).getValue()).trim() !== 'Item Code') {
    return 'ABORT: MASTERS_Materials header is not the expected contract.';
  }

  var d = bw.getDataRange().getValues();

  // ── Step 1: repair self-referencing BULK rows ────────────────────────────
  // Build family -> canonical bulk code from the rows that are already right.
  var bulkByFamily = {};
  for (var i = 1; i < d.length; i++) {
    var c = String(d[i][5] || '').trim();
    var m = c.match(/^(\d{4})-BULK$/);
    if (m) bulkByFamily[m[1]] = c;
  }
  var selfFix = [], selfUnfixable = [];
  for (var j = 1; j < d.length; j++) {
    // KETO rows only. The same self-reference defect exists on NATURE GREEN
    // rows (client NS) — NGFG011/NGMFG012 with descriptions like "NATURE GREEN
    // LABEL" — but those are a different product family with no -BULK sibling
    // to derive from, and were not part of this revision. Sweeping them in
    // would create materials nobody asked for from descriptions nobody checked.
    if (String(d[j][0] || '').trim().toUpperCase() !== 'KETO') continue;
    var fg = String(d[j][1] || '').trim();
    var comp = String(d[j][5] || '').trim();
    if (!comp || comp !== fg) continue;
    var fam = (fg.match(/^(\d{4})-/) || [])[1];
    var want = fam ? bulkByFamily[fam] : null;
    if (want) selfFix.push({ row: j + 1, fg: fg, from: comp, to: want });
    else selfUnfixable.push('row ' + (j + 1) + '  ' + fg + '  desc="' + String(d[j][6] || '') + '"');
  }
  out.push('1 — self-referencing rows repointed to <family>-BULK: ' + selfFix.length);
  selfFix.slice(0, 6).forEach(function (s) { out.push('    row ' + s.row + '  ' + s.from + ' -> ' + s.to); });
  if (selfFix.length > 6) out.push('    ... +' + (selfFix.length - 6) + ' more');
  out.push('  no sibling -BULK to derive from (LEFT ALONE): ' + selfUnfixable.length);
  selfUnfixable.slice(0, 5).forEach(function (s) { out.push('     !! ' + s); });
  out.push('');

  // ── Step 2: collect materials still missing AFTER the repair ─────────────
  var have = {};
  mw.getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[MAT_COL.CODE] || '').trim();
    if (c) have[c] = 1;
  });
  var repointed = {};
  selfFix.forEach(function (s) { repointed[s.row] = s.to; });

  var need = {}, unmappedType = {};
  for (var k = 1; k < d.length; k++) {
    if (String(d[k][0] || '').trim().toUpperCase() !== 'KETO') continue;   // KETO scope
    var rowNo = k + 1;
    var fgc = String(d[k][1] || '').trim();
    if (fgc && !have[fgc] && !need[fgc]) {
      // FG unit is NOS by the owner's decision (?diag=fguomfix normalised the
      // existing rows). BOM col E still shows the container FORMAT for these
      // new rows ("Bottles"), which is a pack description, not a unit — writing
      // it into the master would reintroduce the vocabulary that fix removed.
      need[fgc] = { code: fgc, desc: String(d[k][2] || '').trim(),
                    uom: 'NOS', cat: 'FG', isFg: true };
    }
    var cc = repointed[rowNo] || String(d[k][5] || '').trim();
    if (!cc || have[cc] || need[cc]) continue;
    var t = String(d[k][10] || '').trim().toUpperCase();
    var cat = KETO_TYPE_TO_CAT_[t];
    if (!cat) { unmappedType[t || '(blank)'] = (unmappedType[t || '(blank)'] || 0) + 1; continue; }
    need[cc] = { code: cc, desc: String(d[k][6] || '').trim(),
                 uom: String(d[k][8] || '').trim(), cat: cat, isFg: false };
  }

  var list = Object.keys(need).map(function (k2) { return need[k2]; });
  var fgs = list.filter(function (x) { return x.isFg; });
  var comps = list.filter(function (x) { return !x.isFg; });

  out.push('2 — materials to CREATE: ' + list.length + '  (' + fgs.length + ' FG, ' + comps.length + ' components)');
  var byCat = {};
  list.forEach(function (x) { byCat[x.cat] = (byCat[x.cat] || 0) + 1; });
  Object.keys(byCat).sort().forEach(function (c2) { out.push('    ' + c2 + ': ' + byCat[c2]); });
  out.push('');
  list.slice(0, 8).forEach(function (x) {
    out.push('    ' + x.code.padEnd(16) + x.uom.padEnd(6) + x.cat.padEnd(15) + x.desc.slice(0, 34));
  });
  if (list.length > 8) out.push('    ... +' + (list.length - 8) + ' more');
  out.push('');
  var ut = Object.keys(unmappedType);
  out.push('  BOM Type values with no Category mapping (SKIPPED): ' + ut.length);
  ut.forEach(function (t2) { out.push('     ?  "' + t2 + '" (' + unmappedType[t2] + ' rows)'); });
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  selfFix.forEach(function (s) { bw.getRange(s.row, 6).setValue(s.to); });

  var rows = list.map(function (x) {
    var row = new Array(MAT_WIDTH).fill('');
    row[MAT_COL.CODE] = x.code;
    row[MAT_COL.DESC] = x.desc;
    row[MAT_COL.UNIT] = x.uom;
    row[MAT_COL.CATEGORY] = x.cat;
    // Default Location intentionally BLANK. A wrong default is the ghost-location
    // root cause Phase 1 closed (128 -> 0); guessing a store for a new customer's
    // materials would reintroduce it. Receiving prompts for a location, and
    // ?diag=ghostdefaults will list these until someone sets them.
    row[MAT_COL.INSP_CATEGORY] = (typeof inspCategoryForCategory === 'function')
      ? (inspCategoryForCategory(x.cat) || '') : '';
    return row;
  });
  if (rows.length) {
    mw.getRange(mw.getLastRow() + 1, 1, rows.length, MAT_WIDTH).setValues(rows);
  }

  out.push('APPLIED:');
  out.push('  BOM rows repointed: ' + selfFix.length);
  out.push('  materials created:  ' + rows.length);
  out.push('  Default Location left blank on all new rows — set before receiving.');
  return out.join('\n');
}
