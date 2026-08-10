// Fix the two GRN_LOG data defects found by ?diag=grniqcaudit.
//   ?diag=grndatafix              → dry run
//   ?diag=grndatafix&confirm=YES  → apply
//
// A. CREATE 6 MASTERS_Materials rows for GRN codes that have none.
//    All six hold LIVE stock (102,066 units total) that is currently
//    unlookupable: no unit check, no reorder level, no inspection category, and
//    it renders in the putaway queue with a blank category (that is what the
//    mystery `A001 A001 qty=18500 cat=` row was).
//
//    Code, description and quantity come from GRN_LOG. Category, Inspection
//    Category and Default Location are NOT in the GRN, so they come from the
//    master vocabulary plus the family siblings:
//
//      A001/A002  "160ml/350ml Label Endurance"  -> LABELS/LABEL
//      BSB09      "BUGSEAL LABELS"               -> LABELS/LABEL
//      BSB010     "BUGSEAL SHRINK SLEVE"         -> SLEEVES/SLEEVE
//      NGNGM05    "NATURE GREEN BOTTLES"         -> BOTTLES/BOTTLES
//      NG01       "NATURE GREEN BULK"            -> BULK/BULK
//
//    LABELS->LABEL, SLEEVES->SLEEVE, BOTTLES->BOTTLES and BULK->BULK are the
//    live 1:1 pairs in ?diag=vocabaudit, so these rows cannot reintroduce the
//    Category ambiguity that ?diag=catsplit removed.
//
//    NG01 UNIT NOTE: the GRN received it in LTR, but BOTH NATURE GREEN bulk
//    siblings (NGFG011, NGMFG012) are KG. The family wins — bulk here is
//    weighed, and a lone LTR row would be the only one of its kind. The new
//    issue-plan UoM guard will refuse to issue if this turns out wrong, which is
//    the safety net that makes taking the family's answer reasonable.
//
//    BSB010's description typo is corrected: "SHRINK SLEVE" -> "SHRINK SLEEVE",
//    and the double spaces in the BUGSEAL descriptions are collapsed. The master
//    is what prints, so the master should be spelled correctly.
//
// B. RELABEL 115 GRN_LOG Unit cells from "PC" to "NOS".
//    Label only — not one quantity is touched. "PC" (pieces) and "NOS" (numbers)
//    are the same unit; the master vocabulary was normalised to NOS/KG/LTR/MTR
//    last session and these historical rows still carry the old spelling. Same
//    class of change as the 12 BOM Comp UoM cells (?diag=bomuomfix).

var GRN_NEW_MATERIALS_ = [
  { code: 'A001',    desc: '160ml Label Endurance',  cat: 'LABELS',  insp: 'LABEL',   unit: 'NOS' },
  { code: 'A002',    desc: '350ml Label Endurance',  cat: 'LABELS',  insp: 'LABEL',   unit: 'NOS' },
  { code: 'BSB09',   desc: 'BUGSEAL LABELS',         cat: 'LABELS',  insp: 'LABEL',   unit: 'NOS' },
  { code: 'BSB010',  desc: 'BUGSEAL SHRINK SLEEVE',  cat: 'SLEEVES', insp: 'SLEEVE',  unit: 'NOS' },
  { code: 'NGNGM05', desc: 'NATURE GREEN BOTTLES',   cat: 'BOTTLES', insp: 'BOTTLES', unit: 'NOS' },
  { code: 'NG01',    desc: 'NATURE GREEN BULK',      cat: 'BULK',    insp: 'BULK',    unit: 'KG'  }
];
var GRN_NEW_MAT_LOCATION_ = 'RM-STORE-C';   // every NATURE GREEN sibling sits here
// SPELLING variants only — each names the SAME unit the master already records,
// so relabelling changes no meaning and no quantity.
//   PC / NO'S / 1 -> NOS      M -> MTR
// "1" is a junk value that was never a unit; it appears once, on a row whose
// master says NOS, so it is corrected rather than left as a non-unit.
//
// DELIBERATELY EXCLUDED: LTR->NOS (4 rows) and LTR->KG (1 row). Those are
// genuine MEANING conflicts — litres against a count, and volume against weight.
// Relabelling them would assert an equivalence nobody verified, which is the
// mistake the issue-plan UoM guard exists to catch. Reported separately below.
var GRN_UNIT_RELABEL_ = { 'PC': 'NOS', "NO'S": 'NOS', '1': 'NOS', 'M': 'MTR' };

function fixGrnData(apply) {
  var ss = getSpreadsheet();
  var mw = ss.getSheetByName('MASTERS_Materials');
  var gw = ss.getSheetByName('GRN_LOG');
  if (!mw || !gw) return 'MASTERS_Materials or GRN_LOG missing.';

  var out = ['GRN data fix — ' + (apply ? 'LIVE' : 'DRY RUN'), ''];

  // Assert both sheets, not the constants.
  var mh = mw.getRange(1, 1, 1, Math.max(mw.getLastColumn(), MAT_WIDTH)).getValues()[0];
  var want = {};
  want[MAT_COL.CODE] = 'Item Code';
  want[MAT_COL.DESC] = 'Item Description';
  want[MAT_COL.UNIT] = 'Unit';
  want[MAT_COL.CATEGORY] = 'Category';
  want[MAT_COL.DEFAULT_LOCATION] = 'Default Location';
  want[MAT_COL.INSP_CATEGORY] = 'Inspection Category';
  var bad = [];
  Object.keys(want).forEach(function (i) {
    if (String(mh[i] || '').trim() !== want[i]) {
      bad.push('MASTERS col ' + (Number(i) + 1) + ' expected "' + want[i] + '" got "' + String(mh[i] || '').trim() + '"');
    }
  });
  var gh = gw.getRange(1, 1, 1, gw.getLastColumn()).getValues()[0];
  if (String(gh[6] || '').trim() !== 'Material Code') bad.push('GRN col G expected "Material Code" got "' + String(gh[6] || '').trim() + '"');
  if (String(gh[11] || '').trim() !== 'Unit')         bad.push('GRN col L expected "Unit" got "' + String(gh[11] || '').trim() + '"');
  if (bad.length) {
    out.push('ABORT: sheet headers are not the expected contract.');
    bad.forEach(function (b) { out.push('  ' + b); });
    return out.join('\n');
  }
  out.push('header checks: OK');
  out.push('');

  // ── A. new master rows ─────────────────────────────────────────────────────
  var existing = {}, vocabCat = {}, vocabInsp = {};
  mw.getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[MAT_COL.CODE] || '').trim();
    if (!c) return;
    existing[c] = true;
    var cv = String(r[MAT_COL.CATEGORY] || '').trim();
    var iv = String(r[MAT_COL.INSP_CATEGORY] || '').trim();
    if (cv) vocabCat[cv] = true;
    if (iv) vocabInsp[iv] = true;
  });

  var toCreate = GRN_NEW_MATERIALS_.filter(function (m) { return !existing[m.code]; });
  out.push('A. MASTERS_Materials rows to create: ' + toCreate.length +
           '   (already present: ' + (GRN_NEW_MATERIALS_.length - toCreate.length) + ')');

  // Every Category/InspCategory used must ALREADY exist in the sheet, or this
  // fix would invent vocabulary and could re-break col M derivability.
  var vocabErr = [];
  toCreate.forEach(function (m) {
    if (!vocabCat[m.cat])  vocabErr.push(m.code + ': Category "' + m.cat + '" is not an existing value');
    if (!vocabInsp[m.insp]) vocabErr.push(m.code + ': InspCategory "' + m.insp + '" is not an existing value');
  });
  if (vocabErr.length) {
    out.push('ABORT: refusing to introduce new vocabulary:');
    vocabErr.forEach(function (v) { out.push('  !! ' + v); });
    return out.join('\n');
  }
  toCreate.forEach(function (m) {
    out.push('  + ' + m.code + '   "' + m.desc + '"   [' + m.cat + '/' + m.insp + '/' +
             m.unit + '/' + GRN_NEW_MAT_LOCATION_ + ']');
  });

  // ── B. unit relabel ────────────────────────────────────────────────────────
  // Master unit per code, INCLUDING the six rows this run is about to create, so
  // their GRN rows are checked against the unit they are getting.
  var masterUnit = {};
  mw.getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[MAT_COL.CODE] || '').trim();
    if (c) masterUnit[c] = String(r[MAT_COL.UNIT] || '').trim();
  });
  GRN_NEW_MATERIALS_.forEach(function (m) { if (!masterUnit[m.code]) masterUnit[m.code] = m.unit; });

  var g = gw.getDataRange().getValues();
  var relabel = [], conflicts = [];
  for (var i = 1; i < g.length; i++) {
    if (!String(g[i][0] || '').trim()) continue;
    var code = String(g[i][6] || '').trim();
    var u = String(g[i][11] || '').trim();
    if (!u || !code) continue;
    var mu = String(masterUnit[code] || '').trim();
    if (!mu || u.toUpperCase() === mu.toUpperCase()) continue;      // already agrees
    var to = GRN_UNIT_RELABEL_[u.toUpperCase()];
    // Only relabel when the mapped spelling MATCHES what the master says. A
    // mapping that would still disagree is not a spelling fix — it is a claim
    // about meaning, and it belongs in the conflict list for a human.
    if (to && to.toUpperCase() === mu.toUpperCase()) {
      relabel.push({ row: i + 1, code: code, from: u, to: to });
    } else {
      conflicts.push('row' + (i + 1) + '  ' + code + '  GRN="' + u + '"  master="' + mu +
                     '"  qty=' + (Number(g[i][10]) || 0) + '  "' + String(g[i][7] || '').slice(0, 26) + '"');
    }
  }
  out.push('');
  out.push('B. GRN_LOG Unit cells to relabel: ' + relabel.length);
  var byPair = {};
  relabel.forEach(function (r) { byPair[r.from + ' -> ' + r.to] = (byPair[r.from + ' -> ' + r.to] || 0) + 1; });
  Object.keys(byPair).forEach(function (k) { out.push('  ' + k + '   ' + byPair[k] + ' cell(s)'); });

  out.push('');
  out.push('C. NOT TOUCHED — genuine unit MEANING conflicts: ' + conflicts.length);
  out.push('   These need a human: the GRN unit and the master unit are different');
  out.push('   quantities, not different spellings. Relabelling would assert an');
  out.push('   equivalence nobody verified.');
  conflicts.forEach(function (c) { out.push('     !! ' + c); });

  if (!toCreate.length && !relabel.length) { out.push(''); out.push('Nothing to do.'); return out.join('\n'); }
  if (!apply) {
    out.push('');
    out.push('DRY RUN — re-run with &confirm=YES.');
    return out.join('\n');
  }

  // ── apply ──────────────────────────────────────────────────────────────────
  if (toCreate.length) {
    var rows = toCreate.map(function (m) {
      var row = new Array(MAT_WIDTH).fill('');
      row[MAT_COL.CODE] = m.code;
      row[MAT_COL.DESC] = m.desc;
      row[MAT_COL.UNIT] = m.unit;
      row[MAT_COL.CATEGORY] = m.cat;
      row[MAT_COL.DEFAULT_LOCATION] = GRN_NEW_MAT_LOCATION_;
      row[MAT_COL.INSP_CATEGORY] = m.insp;
      return row;
    });
    mw.getRange(mw.getLastRow() + 1, 1, rows.length, MAT_WIDTH).setValues(rows);
  }
  relabel.forEach(function (r) { gw.getRange(r.row, 12).setValue(r.to); });
  SpreadsheetApp.flush();
  if (typeof prodCacheReset_ === 'function') prodCacheReset_();

  // Verify by re-reading both sheets.
  var after = {};
  mw.getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[MAT_COL.CODE] || '').trim();
    if (c) after[c] = r;
  });
  var missing = toCreate.filter(function (m) { return !after[m.code]; });
  var wrong = toCreate.filter(function (m) {
    var r = after[m.code];
    return r && (String(r[MAT_COL.UNIT]).trim() !== m.unit ||
                 String(r[MAT_COL.CATEGORY]).trim() !== m.cat ||
                 String(r[MAT_COL.INSP_CATEGORY]).trim() !== m.insp);
  });
  // Verify only the cells this run wrote. Counting every remaining old spelling
  // would flag the 5 deliberate conflicts as failures.
  var g2 = gw.getDataRange().getValues();
  var notApplied = relabel.filter(function (r) {
    return String(g2[r.row - 1][11] || '').trim().toUpperCase() !== r.to.toUpperCase();
  });

  out.push('');
  out.push('CREATED ' + toCreate.length + ' master row(s); missing ' + missing.length +
           ', wrong fields ' + wrong.length);
  out.push('RELABELLED ' + relabel.length + ' unit cell(s); not applied: ' + notApplied.length);
  out.push((missing.length || wrong.length || notApplied.length) ? 'RESULT: FAIL' : 'RESULT: PASS');
  out.push('');
  out.push('Next: ?diag=grniqcaudit should report 0 orphan codes and ' + conflicts.length +
           ' remaining unit disagreement(s) — the meaning conflicts above, left for a human.');
  return out.join('\n');
}
