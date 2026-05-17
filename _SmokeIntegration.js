// ============================================================
// _SmokeIntegration.gs — End-to-end synthetic write smoke test
// Writes a synthetic GRN → IQC(REJECT) → Customer Return → SCRAP
// through the real save* functions, then asserts row-count deltas
// in STOCK_LEDGER / NCR_LOG / SCRAP_LOG / GRN_LOG / IQC_LOG / CUSTOMER_RETURN_LOG.
// Output: PASS/FAIL log in sheet "_SMOKE_INT" + UI alert summary.
// Safe to re-run: every run uses a unique synthetic batch tag.
// ============================================================

function runIntegrationSmoke() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  var ss = getSpreadsheet();
  if (!ss) { if (ui) ui.alert('No spreadsheet bound.'); return; }

  var log = [];
  var pass = 0, fail = 0;
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var TAG = 'SMOKE-' + stamp;
  var matCode = 'SMOKE-MAT-' + stamp;
  var batchNo = 'SMOKE-BATCH-' + stamp;
  var fgBatch = 'SMOKE-FG-' + stamp;
  var qty = 10;
  var fgQty = 3;

  function header(t) { log.push(''); log.push('=== ' + t + ' ==='); }
  function assert(name, cond, detail) {
    if (cond) { pass++; log.push('  ✅ ' + name + (detail ? ' — ' + detail : '')); }
    else      { fail++; log.push('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
  }
  function rowCount(sheet) {
    var ws = ss.getSheetByName(sheet);
    return ws ? Math.max(0, ws.getLastRow() - 1) : -1;
  }
  function snapshot() {
    return {
      grn: rowCount('GRN_LOG'),
      iqc: rowCount('IQC_LOG'),
      ledger: rowCount('STOCK_LEDGER'),
      ncr: rowCount('NCR_LOG'),
      rtn: rowCount('CUSTOMER_RETURN_LOG'),
      scrap: rowCount('SCRAP_LOG')
    };
  }

  log.push('Integration smoke run: ' + TAG);
  log.push('Synthetic material=' + matCode + '  batch=' + batchNo + '  fgBatch=' + fgBatch);

  // ---------- Preflight ----------
  header('Preflight — sheets exist');
  ['GRN_LOG','IQC_LOG','STOCK_LEDGER','NCR_LOG','CUSTOMER_RETURN_LOG','SCRAP_LOG','LOCATIONS'].forEach(function(s){
    assert('sheet ' + s, !!ss.getSheetByName(s));
  });
  assert('writeStockLedger_ defined', typeof writeStockLedger_ === 'function');
  assert('saveGRN defined',           typeof saveGRN === 'function');
  assert('saveIQC defined',           typeof saveIQC === 'function');
  assert('saveCustomerReturn defined',     typeof saveCustomerReturn === 'function');
  assert('disposeCustomerReturn defined',  typeof disposeCustomerReturn === 'function');
  assert('raiseNCR_ defined',         typeof raiseNCR_ === 'function');

  // Resolve a default RM location
  var rmLoc = 'RM-STORE-A';
  try {
    if (typeof getLocations === 'function') {
      var locs = getLocations('RM');
      if (locs.length > 0) rmLoc = locs[0].id;
    }
  } catch(e) {}
  log.push('  ↪ using RM location: ' + rmLoc);

  var t0 = snapshot();
  log.push('  ↪ baseline rows: ' + JSON.stringify(t0));

  // ---------- 1. GRN (REJECT-bound) ----------
  header('Step 1 — saveGRN (1 item)');
  var grnRes;
  try {
    grnRes = saveGRN({
      date: new Date(),
      supplierCode: 'SMOKE-SUP',
      supplierName: 'Smoke Test Supplier',
      poRef: 'SMOKE-PO-' + stamp,
      invoiceNo: 'SMOKE-INV',
      coaReceived: 'N/A',
      remarks: 'INTEGRATION SMOKE ' + TAG + ' — safe to delete',
      operatorName: 'smoke-bot',
      locationId: rmLoc,
      items: [{
        materialCode: matCode,
        materialDesc: 'Smoke synthetic material',
        unit: 'kg',
        qtyOrdered: qty,
        qtyReceived: qty,
        batchNo: batchNo,
        expiryDate: ''
      }]
    });
  } catch(e) { grnRes = { success:false, error: e.message }; }
  assert('saveGRN returned success', grnRes && grnRes.success, grnRes && (grnRes.docNo || grnRes.error));
  var grnNo = grnRes && grnRes.docNo;

  var t1 = snapshot();
  assert('GRN_LOG +1', t1.grn - t0.grn === 1, 'delta=' + (t1.grn - t0.grn));
  assert('STOCK_LEDGER +1 (GRN_RECEIPT)', t1.ledger - t0.ledger === 1, 'delta=' + (t1.ledger - t0.ledger));

  // ---------- 2. IQC REJECT against that GRN ----------
  header('Step 2 — saveIQC (REJECTED) → expect ledger +2, NCR +1');
  var iqcRes;
  try {
    iqcRes = saveIQC({
      date: new Date(),
      grnNo: grnNo,
      supplierName: 'Smoke Test Supplier',
      inspector: 'smoke-bot',
      aqlLevel: 'AQL 2.5',
      sampleId: 'SMOKE-SAMPLE',
      disposition: 'REJECTED',
      remarks: 'INTEGRATION SMOKE ' + TAG + ' — synthetic reject',
      operatorName: 'smoke-bot',
      items: [{
        materialCode: matCode,
        materialDesc: 'Smoke synthetic material',
        batchNo: batchNo,
        unit: 'kg',
        sampleSize: 3,
        acceptedQty: 0,
        rejectedQty: qty,
        params: { qty:'Fail', pkg:'Fail', colour:'Fail', shape:'Fail', dims:'Fail',
                  weight:'Fail', clean:'Fail', odour:'Fail', label:'Fail', msds:'Fail',
                  shelf:'Fail', coa:'Fail' }
      }]
    });
  } catch(e) { iqcRes = { success:false, error: e.message }; }
  assert('saveIQC returned success', iqcRes && iqcRes.success, iqcRes && (iqcRes.error || (iqcRes.docNos||[]).join(',')));
  assert('IQC auto-raised NCR', iqcRes && !!iqcRes.ncrNo, iqcRes && iqcRes.ncrNo);

  var t2 = snapshot();
  assert('IQC_LOG +1', t2.iqc - t1.iqc === 1, 'delta=' + (t2.iqc - t1.iqc));
  assert('STOCK_LEDGER +2 (REJECT_OUT, QUARANTINE)', t2.ledger - t1.ledger === 2, 'delta=' + (t2.ledger - t1.ledger));
  assert('NCR_LOG +1',  t2.ncr - t1.ncr === 1, 'delta=' + (t2.ncr - t1.ncr));

  // ---------- 3. Customer Return ----------
  header('Step 3 — saveCustomerReturn → expect rtn +1, ledger +1');
  var rtnRes;
  try {
    rtnRes = saveCustomerReturn({
      returnDate: new Date(),
      customerCode: 'SMOKE-CUST',
      customerName: 'Smoke Customer',
      originalGatepass: 'SMOKE-GP',
      productCode: matCode,
      productDesc: 'Smoke FG',
      fgBatchNo: fgBatch,
      qtyReturned: fgQty,
      unit: 'pcs',
      returnReason: 'INTEGRATION SMOKE — synthetic return',
      receivedBy: 'smoke-bot',
      remarks: TAG
    });
  } catch(e) { rtnRes = { success:false, error: e.message }; }
  assert('saveCustomerReturn success', rtnRes && rtnRes.success, rtnRes && (rtnRes.rtnNo || rtnRes.error));
  var rtnNo = rtnRes && rtnRes.rtnNo;
  var t3 = snapshot();
  assert('CUSTOMER_RETURN_LOG +1', t3.rtn - t2.rtn === 1, 'delta=' + (t3.rtn - t2.rtn));
  assert('STOCK_LEDGER +1 (QUARANTINE in)', t3.ledger - t2.ledger === 1, 'delta=' + (t3.ledger - t2.ledger));

  // ---------- 4. Triage as SCRAP ----------
  header('Step 4 — disposeCustomerReturn SCRAP → expect scrap +1, NCR +1');
  var dispRes;
  try {
    dispRes = disposeCustomerReturn({
      rtnNo: rtnNo,
      disposition: 'SCRAP',
      disposedBy: 'smoke-bot',
      remarks: 'INTEGRATION SMOKE ' + TAG
    });
  } catch(e) { dispRes = { success:false, error: e.message }; }
  assert('disposeCustomerReturn success', dispRes && dispRes.success, dispRes && (dispRes.ncrNo || dispRes.error));
  assert('dispose returned NCR', dispRes && !!dispRes.ncrNo, dispRes && dispRes.ncrNo);

  var t4 = snapshot();
  assert('SCRAP_LOG +1', t4.scrap - t3.scrap === 1, 'delta=' + (t4.scrap - t3.scrap));
  assert('NCR_LOG +1 (customer return)', t4.ncr - t3.ncr === 1, 'delta=' + (t4.ncr - t3.ncr));

  // ---------- Summary ----------
  header('Summary');
  log.push('  passed: ' + pass);
  log.push('  failed: ' + fail);
  log.push('  final row counts: ' + JSON.stringify(t4));
  log.push('  deltas vs baseline: ' +
    JSON.stringify({
      grn: t4.grn - t0.grn, iqc: t4.iqc - t0.iqc, ledger: t4.ledger - t0.ledger,
      ncr: t4.ncr - t0.ncr, rtn: t4.rtn - t0.rtn, scrap: t4.scrap - t0.scrap
    }));
  log.push('');
  log.push('Synthetic refs created (delete by hand if you want a clean live sheet):');
  log.push('  GRN: '   + (grnNo || '∅'));
  log.push('  IQC: '   + (iqcRes && iqcRes.docNos ? iqcRes.docNos.join(',') : '∅'));
  log.push('  NCR(s): ' + ((iqcRes && iqcRes.ncrNo) || '∅') + ' / ' + ((dispRes && dispRes.ncrNo) || '∅'));
  log.push('  RTN: '   + (rtnNo || '∅'));
  log.push('  Tag:  ' + TAG);

  var out = log.join('\n');
  Logger.log(out);
  var dump = ss.getSheetByName('_SMOKE_INT') || ss.insertSheet('_SMOKE_INT');
  dump.clear();
  dump.getRange(1, 1).setValue(out);
  dump.setColumnWidth(1, 900);

  if (ui) {
    ui.alert(
      (fail === 0 ? '✅ Integration Smoke — ALL PASSED' : '❌ Integration Smoke — ' + fail + ' FAILED'),
      'Passed: ' + pass + '\nFailed: ' + fail + '\n\nFull report on sheet "_SMOKE_INT".',
      ui.ButtonSet.OK
    );
  }
  return { pass: pass, fail: fail, tag: TAG };
}
