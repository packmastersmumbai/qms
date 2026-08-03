// Proves the IQC idempotency guard actually blocks a duplicate WRITE, not just
// that the client sends a key. Sending the key and honouring it are different
// claims; e2e-savepaths can only observe the first.
//
//   ?diag=iqcidem              → dry run (reports what it would do)
//   ?diag=iqcidem&confirm=YES  → save twice with ONE txn key, then archive both
//
// Uses the Phase 3A fixture GRN so it never touches real receipts, and archives
// whatever it writes so the fixture stays re-runnable.
function checkIqcIdempotency(apply) {
  if (!CONFIG._TESTING_ENABLED) return 'testing disabled (CONFIG._TESTING_ENABLED)';
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('IQC_LOG');
  if (!ws) return 'IQC_LOG missing.';

  var out = ['IQC idempotency guard — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('');

  // Find the fixture GRN; refuse to run against a real receipt.
  var grnWs = ss.getSheetByName('GRN_LOG');
  var fixGrn = '', fixRow = null;
  if (grnWs && grnWs.getLastRow() > 1) {
    var gd = grnWs.getDataRange().getValues();
    for (var i = gd.length - 1; i >= 1; i--) {
      if (String(gd[i][0] || '').indexOf(FIX_PREFIX_) === 0) { fixGrn = String(gd[i][0]); fixRow = gd[i]; break; }
    }
  }
  if (!fixGrn) return 'No fixture GRN found. Run ?diag=fixtureseed&confirm=YES first.';
  out.push('fixture GRN: ' + fixGrn);

  var txn = 'IQC-IDEMTEST-' + Date.now();
  out.push('txn key:     ' + txn);
  out.push('');
  out.push('Plan: call saveIQC(payload) TWICE with the SAME clientTxnId.');
  out.push('  expected 1st: success, fresh docNo(s), duplicate flag absent');
  out.push('  expected 2nd: success, SAME docNo(s), duplicate=true, 0 new rows');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  var before = ws.getLastRow();
  var payload = {
    grnNo: fixGrn,
    supplierName: String(fixRow[3] || ''),
    inspector: 'idem-test',
    aqlLevel: '2.5', inspLevel: 'I', severity: 'Normal',
    lotSize: 100, defectsFound: 0,
    disposition: 'ACCEPTED',
    remarks: 'idempotency self-test',
    operatorName: 'idem-test',
    clientTxnId: txn,
    // TWO items deliberately. saveIQC writes one row PER ITEM, and the whole
    // reason _iqcFindByTxn_ collects every docNo is the multi-item retry — a
    // single-item payload leaves that branch unexercised.
    items: [{
      materialCode: String(fixRow[6] || ''),
      materialDesc: String(fixRow[7] || ''),
      batchNo:      String(fixRow[8] || '') + '-A',
      qtyReceived:  60, qtyAccepted: 60, rejectedQty: 0, acceptedQty: 60
    }, {
      materialCode: String(fixRow[6] || ''),
      materialDesc: String(fixRow[7] || ''),
      batchNo:      String(fixRow[8] || '') + '-B',
      qtyReceived:  40, qtyAccepted: 40, rejectedQty: 0, acceptedQty: 40
    }]
  };

  var r1, r2, err = null;
  try {
    r1 = saveIQC(payload);
    var mid = ws.getLastRow();
    r2 = saveIQC(payload);          // same key — must NOT write again
    var after = ws.getLastRow();

    out.push('1st call: success=' + (r1 && r1.success) +
             '  docNos=' + JSON.stringify(r1 && r1.docNos) +
             '  duplicate=' + !!(r1 && r1.duplicate));
    out.push('2nd call: success=' + (r2 && r2.success) +
             '  docNos=' + JSON.stringify(r2 && r2.docNos) +
             '  duplicate=' + !!(r2 && r2.duplicate));
    out.push('');
    out.push('rows before=' + before + '  after 1st=' + mid + '  after 2nd=' + after);
    out.push('rows written by 1st: ' + (mid - before));
    out.push('rows written by 2nd: ' + (after - mid) + '   <-- MUST be 0');
    out.push('');

    var sameDocs = JSON.stringify((r1 && r1.docNos) || []) === JSON.stringify((r2 && r2.docNos) || []);
    var noNewRows = (after - mid) === 0;
    var flagged   = !!(r2 && r2.duplicate);
    var multiRow  = (mid - before) === 2;   // 2 items -> 2 rows

    // The tag must be IN the sheet (audit evidence) but OUT of anything a human
    // reads — PrintIQC_F.html:260 renders getIQCPrintData().remarks straight onto
    // the printed QA certificate.
    var rawCell = String(ws.getRange(mid, _iqcRemarksCol_() + 1).getValue() || '');
    var tagInSheet = rawCell.indexOf('[txn:') >= 0;
    var displayClean = true, shown = '';
    try {
      var pd = (typeof getIQCPrintData === 'function' && r1 && r1.docNos && r1.docNos[0])
        ? getIQCPrintData(r1.docNos[0]) : null;
      shown = pd ? String(pd.remarks || '') : '(print data unavailable)';
      displayClean = pd ? (shown.indexOf('[txn:') < 0) : false;
    } catch (eP) { displayClean = false; shown = 'THREW: ' + eP.message; }

    out.push('sheet remarks cell: "' + rawCell + '"');
    out.push('printed remarks:    "' + shown + '"');
    out.push('');
    out.push('VERDICT: ' + ((sameDocs && noNewRows && flagged && multiRow && tagInSheet && displayClean)
                            ? 'PASS — guard holds' : 'FAIL'));
    out.push('  same docNos returned:     ' + sameDocs);
    out.push('  no rows written by retry: ' + noNewRows);
    out.push('  retry flagged duplicate:  ' + flagged);
    out.push('  multi-item wrote 2 rows:  ' + multiRow);
    out.push('  tag present in sheet:     ' + tagInSheet);
    out.push('  tag ABSENT from print:    ' + displayClean);
  } catch (e) {
    err = e.message;
    out.push('THREW: ' + e.message);
  }

  // Always clean up, even on failure — a half-written self-test must not leave
  // rows that make the fixture GRN permanently un-selectable.
  try {
    var moved = 0;
    var d = ws.getDataRange().getValues();
    for (var k = d.length - 1; k >= 1; k--) {
      if (String(d[k][2] || '').indexOf(FIX_PREFIX_) === 0) { ws.deleteRow(k + 1); moved++; }
    }
    out.push('');
    out.push('cleanup: removed ' + moved + ' IQC_LOG rows referencing the fixture GRN.');
  } catch (e2) { out.push('cleanup FAILED: ' + e2.message); }

  return out.join('\n');
}
