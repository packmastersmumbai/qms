// Create the MASTERS_Materials rows for the 25 KETO finished goods that the BOM
// references but the masters do not carry.
//   ?diag=ketofgmat              → dry run
//   ?diag=ketofgmat&confirm=YES  → apply
//
// WHY these are needed at all: getFG() (Masters.js) filters MASTERS_Materials for
// Category === 'FG', and Dispatch, IPQC, CustomerReturn, ControlPlan and Masters
// all read that list. An FG present only in the BOM can be produced but cannot be
// dispatched, IPQC'd, returned, or given a control plan — it appears in no
// dropdown. ?diag=vocabaudit fails on exactly this: 25 unresolved FG codes.
//
// EVERY value is sourced, not invented:
//   Item Code      <- BOM col B (FGIDH)
//   Description    <- BOM col C (Material Description), verbatim
//   Unit           <- 'NOS'. The owner's answer for FG UoM; already applied
//                     across BOM/PROD_JOBS/PROD_BOOKING_LOG by ?diag=fguomfix,
//                     and BOM col E is NOS(343) with no other value.
//   Category       <- 'FG'. This is the column getFG() filters on.
//   InspCategory   <- 'FG'. 1:1 with Category FG in the live sheet (FG->FG(33)).
//   DefaultLocation<- 'FG-STORE-C', per the owner this session.
//
// Geometry, Reorder Level and Fit Class are left EMPTY — the same state as the
// other 250+ rows. Inventing a dimension would feed the capacity-aware putaway
// engine a number nobody measured.

var KETO_FG_UNIT_ = 'NOS';
var KETO_FG_CATEGORY_ = 'FG';
var KETO_FG_INSP_ = 'FG';
var KETO_FG_LOCATION_ = 'FG-STORE-C';

function addKetoFgMaterials(apply) {
  var ss = getSpreadsheet();
  var bw = ss.getSheetByName('BOM');
  var mw = ss.getSheetByName('MASTERS_Materials');
  if (!bw || !mw) return 'BOM or MASTERS_Materials missing.';

  var out = ['KETO FG materials — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('');

  // Assert the SHEET, not the constant. MAT_COL is a positional contract and a
  // reordered sheet would silently write Unit into Description.
  var hdr = mw.getRange(1, 1, 1, Math.max(mw.getLastColumn(), MAT_WIDTH)).getValues()[0];
  var expect = {};
  expect[MAT_COL.CODE] = 'Item Code';
  expect[MAT_COL.DESC] = 'Item Description';
  expect[MAT_COL.UNIT] = 'Unit';
  expect[MAT_COL.CATEGORY] = 'Category';
  expect[MAT_COL.DEFAULT_LOCATION] = 'Default Location';
  expect[MAT_COL.INSP_CATEGORY] = 'Inspection Category';
  var badHdr = [];
  Object.keys(expect).forEach(function (idx) {
    var got = String(hdr[idx] || '').trim();
    if (got !== expect[idx]) badHdr.push('col ' + (Number(idx) + 1) + ' expected "' +
                                         expect[idx] + '" got "' + got + '"');
  });
  if (badHdr.length) {
    out.push('ABORT: MASTERS_Materials header is not the expected contract.');
    badHdr.forEach(function (b) { out.push('  ' + b); });
    return out.join('\n');
  }

  // Existing codes, so a re-run is a no-op rather than a duplicate-maker.
  var existing = {};
  mw.getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[MAT_COL.CODE] || '').trim();
    if (c) existing[c] = true;
  });

  // Collect the FG codes the BOM references, first description wins.
  var d = bw.getDataRange().getValues();
  var fgDesc = {}, order = [];
  for (var i = 1; i < d.length; i++) {
    var code = String(d[i][1] || '').trim();          // col B  FGIDH
    if (!code) continue;
    var desc = String(d[i][2] || '').trim();          // col C  Material Description
    if (fgDesc[code] === undefined) { fgDesc[code] = desc; order.push(code); }
  }

  var toCreate = order.filter(function (c) { return !existing[c]; });
  var already = order.length - toCreate.length;

  out.push('BOM FG codes: ' + order.length + '   already in masters: ' + already +
           '   to create: ' + toCreate.length);
  out.push('');

  // A code with no description would print blank on a dispatch note. Refuse
  // rather than create a nameless finished good.
  var noDesc = toCreate.filter(function (c) { return !fgDesc[c]; });
  if (noDesc.length) {
    out.push('ABORT: ' + noDesc.length + ' FG code(s) have no description in the BOM:');
    noDesc.forEach(function (c) { out.push('  ' + c); });
    return out.join('\n');
  }

  toCreate.forEach(function (c) {
    out.push('  + ' + c + '   ' + fgDesc[c] + '   [' + KETO_FG_CATEGORY_ + '/' +
             KETO_FG_INSP_ + '/' + KETO_FG_UNIT_ + '/' + KETO_FG_LOCATION_ + ']');
  });

  if (!toCreate.length) {
    out.push('Nothing to do.');
    return out.join('\n');
  }

  if (!apply) {
    out.push('');
    out.push('DRY RUN — re-run with &confirm=YES to write ' + toCreate.length + ' rows.');
    return out.join('\n');
  }

  var rows = toCreate.map(function (c) {
    var row = new Array(MAT_WIDTH).fill('');
    row[MAT_COL.CODE] = c;
    row[MAT_COL.DESC] = fgDesc[c];
    row[MAT_COL.UNIT] = KETO_FG_UNIT_;
    row[MAT_COL.CATEGORY] = KETO_FG_CATEGORY_;
    row[MAT_COL.DEFAULT_LOCATION] = KETO_FG_LOCATION_;
    row[MAT_COL.INSP_CATEGORY] = KETO_FG_INSP_;
    return row;
  });

  var startRow = mw.getLastRow() + 1;
  mw.getRange(startRow, 1, rows.length, MAT_WIDTH).setValues(rows);
  SpreadsheetApp.flush();

  // Verify by re-reading, not by trusting the write.
  var after = {};
  mw.getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[MAT_COL.CODE] || '').trim();
    if (c) after[c] = r;
  });
  var missing = toCreate.filter(function (c) { return !after[c]; });
  var wrong = toCreate.filter(function (c) {
    var r = after[c];
    return r && (String(r[MAT_COL.CATEGORY]).trim() !== KETO_FG_CATEGORY_ ||
                 String(r[MAT_COL.DEFAULT_LOCATION]).trim() !== KETO_FG_LOCATION_);
  });

  out.push('');
  out.push('WROTE ' + rows.length + ' rows at ' + startRow + '..' + (startRow + rows.length - 1));
  out.push('verify: missing after write ' + missing.length + ', wrong fields ' + wrong.length);
  out.push(missing.length || wrong.length ? 'RESULT: FAIL' : 'RESULT: PASS');
  return out.join('\n');
}
