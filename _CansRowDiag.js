// Which MASTERS_Materials rows have Category=CANS but InspCategory=BOTTLES?
// ?diag=cansrows  — read-only.
//
// This is the last ?diag=vocabaudit failure: 3 of 7 CANS rows carry the BOTTLES
// inspection category, so they draw the bottle parameter set instead of the can
// one. The audit counts them; it does not name them, and a count cannot be acted
// on. Read-only by design — which side is correct is the owner's decision.
// ?diag=cansfix / ?diag=cansfix&confirm=YES sets InspCategory=CANS on the rows
// below. The codes are listed EXPLICITLY rather than "every CANS row whose insp
// disagrees" — the owner approved these three specific materials by description
// (a jerry can, a tin-plate can from the same family as rows already tagged
// CANS, and an EVOH 5L can). A blanket rule would silently sweep up any future
// mis-tagged row nobody has looked at.
var CANS_FIX_CODES_ = ['1712442', '3040321', '201134-000000'];

function diagCansRows(apply, doFix) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials missing.';

  if (String(ws.getRange(1, MAT_COL.INSP_CATEGORY + 1).getValue()).trim() !== 'Inspection Category') {
    return 'ABORT: col ' + (MAT_COL.INSP_CATEGORY + 1) + ' is not "Inspection Category".';
  }

  var d = ws.getDataRange().getValues();
  var out = [(doFix ? 'CANS InspCategory fix — ' + (apply ? 'LIVE' : 'DRY RUN')
                    : 'Category=CANS rows (code | desc | unit | insp | location)'), ''];

  var want = {}, seen = {};
  CANS_FIX_CODES_.forEach(function (c) { want[c] = true; });

  var writes = [];
  for (var i = 1; i < d.length; i++) {
    var cat = String(d[i][MAT_COL.CATEGORY] || '').trim().toUpperCase();
    if (cat !== 'CANS') continue;
    var code = String(d[i][MAT_COL.CODE]).trim();
    var insp = String(d[i][MAT_COL.INSP_CATEGORY] || '').trim() || '(blank)';
    out.push((insp === 'CANS' ? '  ok  ' : '  !!  ') +
             'row' + (i + 1) +
             '  ' + code +
             '  | ' + String(d[i][MAT_COL.DESC] || '') +
             '  | ' + String(d[i][MAT_COL.UNIT] || '') +
             '  | insp=' + insp +
             '  | ' + String(d[i][MAT_COL.DEFAULT_LOCATION] || '(blank)'));
    if (doFix && want[code]) {
      seen[code] = true;
      if (insp !== 'CANS') writes.push({ row: i + 1, code: code, from: insp });
    }
  }

  if (!doFix) return out.join('\n');

  // Every approved code must be found, or the sheet is not what was approved.
  var notFound = CANS_FIX_CODES_.filter(function (c) { return !seen[c]; });
  if (notFound.length) {
    out.push('');
    out.push('ABORT: these approved codes are not present as Category=CANS rows:');
    notFound.forEach(function (c) { out.push('  ' + c); });
    return out.join('\n');
  }

  out.push('');
  if (!writes.length) { out.push('Nothing to change — all three already CANS.'); return out.join('\n'); }
  writes.forEach(function (w) {
    out.push('  SET row' + w.row + '  ' + w.code + '   insp: ' + w.from + ' -> CANS');
  });

  if (!apply) {
    out.push('');
    out.push('DRY RUN — re-run with &confirm=YES to write ' + writes.length + ' cells.');
    return out.join('\n');
  }

  writes.forEach(function (w) {
    ws.getRange(w.row, MAT_COL.INSP_CATEGORY + 1).setValue('CANS');
  });
  SpreadsheetApp.flush();

  var after = ws.getDataRange().getValues();
  var bad = writes.filter(function (w) {
    return String(after[w.row - 1][MAT_COL.INSP_CATEGORY]).trim() !== 'CANS';
  });
  out.push('');
  out.push('WROTE ' + writes.length + ' cells; verify failures: ' + bad.length);
  out.push(bad.length ? 'RESULT: FAIL' : 'RESULT: PASS');
  return out.join('\n');
}
