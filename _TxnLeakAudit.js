// READ-ONLY: is any "[txn:...]" idempotency tag reaching a human-facing surface?
// Writes nothing. ?diag=txnleak
//
// The tag is deliberate audit evidence in the sheet, but the same Remarks cell is
// rendered onto printed documents (PrintGRN_F.html:271, PrintIQC_F.html:260). The
// first version of the IQC guard shipped that leak, so this exists to catch the
// next one rather than rely on someone remembering.
//
// Checks the READERS, not just the sheets: a tag in the sheet is correct; a tag
// coming back out of a *PrintData accessor is the defect.
function auditTxnTagLeak() {
  var ss = getSpreadsheet();
  var out = ['[txn:] TAG LEAK AUDIT — read-only'];
  out.push('');

  var TAG = /\[txn:[^\]]*\]/;
  var findings = [], checked = 0;

  // ── 1. Which sheets carry tags at all (expected — this is the audit trail) ──
  var SHEETS = [
    { name: 'GRN_LOG',      col: 14, label: 'Remarks' },
    { name: 'IQC_LOG',      col: 25, label: 'Remarks' },
    { name: 'GATEPASS_LOG', col: 14, label: 'REMARKS' }
  ];
  out.push('── tags stored in sheets (EXPECTED) ──');
  SHEETS.forEach(function (s) {
    var ws = ss.getSheetByName(s.name);
    if (!ws || ws.getLastRow() < 2) { out.push('  ' + s.name + ': absent/empty'); return; }
    var n = ws.getLastRow() - 1;
    var vals = ws.getRange(2, s.col + 1, n, 1).getValues();
    var tagged = 0, sample = '';
    for (var i = 0; i < n; i++) {
      if (TAG.test(String(vals[i][0] || ''))) {
        tagged++;
        if (!sample) sample = String(vals[i][0]).slice(0, 60);
      }
    }
    out.push('  ' + s.name + '.' + s.label + ': ' + tagged + '/' + n + ' rows tagged' +
             (sample ? '   eg "' + sample + '"' : ''));
  });
  out.push('');

  // ── 2. Do the DISPLAY readers strip it? This is the actual test. ────────────
  out.push('── display readers (tag here IS the defect) ──');

  function probe(label, fn) {
    checked++;
    try {
      var v = fn();
      if (v === null) { out.push('  ' + label + ': no record to test'); return; }
      var leaked = TAG.test(String(v));
      out.push('  ' + (leaked ? '!! LEAK  ' : 'OK       ') + label + ': "' + String(v).slice(0, 70) + '"');
      if (leaked) findings.push(label);
    } catch (e) {
      out.push('  ??       ' + label + ': THREW ' + e.message);
    }
  }

  // Newest row carrying a tag is the strongest test case available.
  function newestTagged(sheetName, docCol, remCol) {
    var ws = ss.getSheetByName(sheetName);
    if (!ws || ws.getLastRow() < 2) return '';
    var n = ws.getLastRow() - 1;
    var d = ws.getRange(2, 1, n, Math.max(docCol, remCol) + 1).getValues();
    for (var i = n - 1; i >= 0; i--) {
      if (TAG.test(String(d[i][remCol] || ''))) return String(d[i][docCol] || '');
    }
    return '';
  }

  var grnDoc = newestTagged('GRN_LOG', 0, 14);
  probe('getGRNPrintData(' + (grnDoc || 'none') + ').remarks', function () {
    if (!grnDoc || typeof getGRNPrintData !== 'function') return null;
    var d = getGRNPrintData(grnDoc);
    return d ? d.remarks : null;
  });

  var iqcDoc = newestTagged('IQC_LOG', 0, 25);
  probe('getIQCPrintData(' + (iqcDoc || 'none') + ').remarks', function () {
    if (!iqcDoc || typeof getIQCPrintData !== 'function') return null;
    var d = getIQCPrintData(iqcDoc);
    return d ? d.remarks : null;
  });

  // The shared helper itself, including the mid-string case that a
  // suffix-anchored strip would miss (IQC HOLD-close appends after the tag).
  out.push('');
  out.push('── stripTxnTag_ unit checks ──');
  if (typeof stripTxnTag_ !== 'function') {
    out.push('  !! stripTxnTag_ NOT DEFINED');
    findings.push('stripTxnTag_ missing');
  } else {
    var cases = [
      ['suffix',      'Short delivery [txn:GRN-123]',                    'Short delivery'],
      ['mid-string',  'Note [txn:IQC-9] | HOLD CLOSED: released',        'Note | HOLD CLOSED: released'],
      ['only tag',    '[txn:GP-7]',                                      ''],
      ['no tag',      'Plain remark',                                    'Plain remark'],
      ['empty',       '',                                                '']
    ];
    cases.forEach(function (c) {
      var got = stripTxnTag_(c[1]);
      var ok = got === c[2];
      if (!ok) findings.push('stripTxnTag_ ' + c[0]);
      out.push('  ' + (ok ? 'OK   ' : '!! FAIL ') + c[0] + ': "' + got + '"' +
               (ok ? '' : '   expected "' + c[2] + '"'));
    });
  }

  out.push('');
  out.push('VERDICT: ' + (findings.length ? 'FAIL — ' + findings.length + ' leak(s): ' + findings.join(', ')
                                          : 'PASS — no tag reaches a display surface'));
  return out.join('\n');
}
