// ============================================================
// _SmokeFullChain.js — Headless end-to-end PO→GRN→IQC→Prod→OQC→FG→Dispatch
// All upstream rows use TEST/<TYPE>/<YYYY>-NN docNos via _testNextSeq_ so the
// real PO/GRN/IQC/OQC counters are NEVER advanced. Only the final Dispatch
// step calls the real saveDispatchWithFIFO (which mints a real gp docNo);
// gp_counter is snapshotted and restored at the end.
//
// All TEST rows are archived to _TEST_ARCHIVE.
// No SpreadsheetApp.getUi() — fully clasp-run-able.
// ============================================================

// Inject a TEST production issue/consumption batch directly into PROD_ISSUE_LOG
// and write the matching STOCK_LEDGER consumption entry so downstream OQC/FG
// flows see the batch. Mirrors createTestIQCAccept / createTestOQCRelease style.
//
// payload accepts: { productionOrderNo, materialCode, materialDesc, batchNo,
//                    locationId, qtyIssued, unit, issuedBy, grnRef, remarks }
// Returns { success, docNo (production order no), batchNo }
function createTestProductionBatch(payload) {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('PROD_ISSUE_LOG');
    if (!ws) return { success: false, error: 'PROD_ISSUE_LOG sheet not found.' };
    var prodNo = payload.productionOrderNo || _testNextSeq_('TEST/PROD');
    var batch  = payload.batchNo           || 'TEST-BATCH';
    var loc    = payload.locationId        || 'RM-STORE-A';
    var qty    = Number(payload.qtyIssued) || 1;
    var now    = new Date();
    var issueId = 'TEST-ISS-' + now.getTime();
    ws.appendRow([
      issueId,                                       // 1 Issue ID
      now,                                           // 2 Timestamp
      prodNo,                                        // 3 Production Order No.
      payload.materialCode || 'TEST-MAT',            // 4 Material Code
      payload.materialDesc || 'Test material (smoke)', // 5 Material Name
      batch,                                         // 6 Batch / Lot No.
      loc,                                           // 7 Location ID
      qty,                                           // 8 Qty Issued
      payload.unit  || 'KGS',                        // 9 Unit
      payload.issuedBy || 'claude-smoke-test',       // 10 Issued By
      payload.grnRef || '',                          // 11 GRN Ref
      payload.remarks || 'TEST smoke production — safe to archive'
    ]);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy HH:mm');

    // STOCK_LEDGER consumption (RM_ISSUE OUT) so balances reconcile
    if (typeof writeStockLedger_ === 'function') {
      writeStockLedger_(
        'RM_ISSUE',
        payload.materialCode || 'TEST-MAT',
        batch,
        loc,
        0, qty,
        'PRODUCTION', prodNo,
        'claude-smoke-test',
        'TEST smoke RM_ISSUE — safe to archive'
      );
    }
    return { success: true, docNo: prodNo, batchNo: batch, issueId: issueId };
  } catch(e) {
    Logger.log('createTestProductionBatch failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Inject a TEST PO_HEADER + 1 PO_LINES row using TEST/PO/<YYYY>-NN.
// Bypasses getNextDocNumber('po') so po_counter is untouched.
// PO_HEADER = 17 cols, PO_LINES = 13 cols.
function createTestPO_(payload) {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var hdrWs = ss.getSheetByName('PO_HEADER');
    var lnWs  = ss.getSheetByName('PO_LINES');
    if (!hdrWs) return { success: false, error: 'PO_HEADER sheet not found.' };
    if (!lnWs)  return { success: false, error: 'PO_LINES sheet not found.' };
    var poNo = _testNextSeq_('TEST/PO');
    var now  = new Date();
    var qty  = Number(payload.qtyOrdered) || 10;
    var unitPrice = Number(payload.unitPrice) || 100;
    hdrWs.appendRow([
      poNo,                                          // 1 po_no
      now,                                           // 2 po_date
      payload.supplierCode || 'TEST-SUP',            // 3 supplier_code
      payload.supplierName || 'TEST supplier',       // 4 supplier_name
      now,                                           // 5 due_date
      'INR',                                         // 6 currency
      0,                                             // 7 gst_pct
      'NET 30',                                      // 8 payment_terms
      qty * unitPrice, 0, qty * unitPrice,           // 9-11 totals
      'OPEN',                                        // 12 status
      'TEST smoke PO — safe to archive',             // 13 remarks
      'claude-smoke-test',                           // 14 created_by
      now,                                           // 15 created_at
      'claude-smoke-test',                           // 16 last_modified_by
      ''                                             // 17 last_modified_at
    ]);
    var lr = hdrWs.getLastRow();
    hdrWs.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
    hdrWs.getRange(lr, 5).setNumberFormat('dd-MMM-yyyy');
    hdrWs.getRange(lr, 15).setNumberFormat('dd-MMM-yyyy HH:mm');

    lnWs.appendRow([
      poNo, 1,
      payload.materialCode || 'TEST-MAT',
      payload.materialDesc || 'Test material (smoke)',
      payload.unit || 'KGS',
      qty,                  // qty_ordered
      unitPrice,            // unit_price
      qty * unitPrice,      // line_amount
      0,                    // qty_received
      qty,                  // qty_pending
      'OPEN',               // line_status
      '',                   // last_grn_no
      now                   // promised_date
    ]);
    return { success: true, poNo: poNo };
  } catch(e) {
    Logger.log('createTestPO_ failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Inject a TEST GRN_LOG row + STOCK_LEDGER GRN_RECEIPT using TEST/GRN/<YYYY>-NN.
// Bypasses getNextDocNumber('grn'). GRN_LOG = 21 cols.
function createTestGRN_(payload) {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('GRN_LOG');
    if (!ws) return { success: false, error: 'GRN_LOG sheet not found.' };
    var docNo = _testNextSeq_('TEST/GRN');
    var now   = new Date();
    var qty   = Number(payload.qtyReceived) || 10;
    var loc   = payload.locationId || 'RM-STORE-A';
    var matCode = payload.materialCode || 'TEST-MAT';
    var batch   = payload.batchNo || 'TEST-BATCH';
    ws.appendRow([
      docNo,                                         // 1 grn_no
      now,                                           // 2 date
      payload.supplierCode || 'TEST-SUP',            // 3 supplier_code
      payload.supplierName || 'TEST supplier',       // 4 supplier_name
      payload.poRef || '',                           // 5 po_ref
      payload.invoiceNo || 'TEST-INV',               // 6 invoice_no
      matCode,                                       // 7 material_code
      payload.materialDesc || 'Test material (smoke)', // 8 material_desc
      batch,                                         // 9 batch_no
      qty,                                           // 10 qty_ordered
      qty,                                           // 11 qty_received
      payload.unit || 'KGS',                         // 12 unit
      'N/A',                                         // 13 coa_received
      '',                                            // 14 expiry_date
      'TEST smoke GRN — safe to archive',            // 15 remarks
      'PENDING',                                     // 16 status
      'claude-smoke-test',                           // 17 created_by
      now,                                           // 18 created_at
      '',                                            // 19 storage_zone
      'claude-smoke-test',                           // 20 operator_id
      loc                                            // 21 location_id
    ]);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
    ws.getRange(lr, 18).setNumberFormat('dd-MMM-yyyy HH:mm');

    // STOCK_LEDGER receipt so Production sees the material
    if (typeof writeStockLedger_ === 'function') {
      writeStockLedger_(
        'GRN_RECEIPT', matCode, batch, loc,
        qty, 0,
        'GRN', docNo,
        'claude-smoke-test',
        'TEST smoke GRN_RECEIPT — safe to archive'
      );
    }
    return { success: true, docNo: docNo, batchNo: batch, materialCode: matCode, locationId: loc, qty: qty };
  } catch(e) {
    Logger.log('createTestGRN_ failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// smokeFullChain — Full end-to-end synthetic chain.
// ============================================================
function smokeFullChain() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var result = {
    success: false,
    docNos: {},
    archived: {},
    countersBefore: {},
    countersAfter: {},
    countersRestored: {},
    errors: []
  };
  try {
    // 1. Snapshot counters
    ['po','grn','iqc','oqc','gp','prod'].forEach(function(t) {
      var c = getDocCounter(t);
      result.countersBefore[t] = c ? c.value : null;
    });

    var matCode = 'TEST-MAT';
    var matDesc = 'Test material (smoke)';
    var batchNo = 'TEST-BATCH-' + new Date().getTime();
    var loc     = 'RM-STORE-A';
    var qty     = 10;

    // 2. Create TEST PO
    var po = createTestPO_({
      materialCode: matCode, materialDesc: matDesc,
      qtyOrdered: qty, unit: 'KGS'
    });
    if (!po.success) throw new Error('PO step failed: ' + po.error);
    result.docNos.po = po.poNo;

    // 3. Create TEST GRN (writes STOCK_LEDGER receipt)
    var grn = createTestGRN_({
      poRef: po.poNo, materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, qtyReceived: qty, locationId: loc, unit: 'KGS'
    });
    if (!grn.success) throw new Error('GRN step failed: ' + grn.error);
    result.docNos.grn = grn.docNo;
    SpreadsheetApp.flush();

    // 4. TEST IQC ACCEPT
    var iqc = createTestIQCAccept({
      grnNo: grn.docNo, supplierName: 'TEST supplier',
      materialDesc: matDesc, batchNo: batchNo,
      inspector: 'claude-smoke-test', acceptedQty: qty
    });
    if (!iqc.success) throw new Error('IQC step failed: ' + iqc.error);
    result.docNos.iqc = iqc.docNo;
    SpreadsheetApp.flush();

    // 5. TEST production batch (writes STOCK_LEDGER consumption)
    var prod = createTestProductionBatch({
      materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, locationId: loc,
      qtyIssued: qty, unit: 'KGS', grnRef: grn.docNo
    });
    if (!prod.success) throw new Error('Production step failed: ' + prod.error);
    result.docNos.prod = prod.docNo;
    SpreadsheetApp.flush();

    // 6. TEST OQC RELEASED
    var oqcDocNo = _testNextSeq_('TEST/OQC');
    var oqc = createTestOQCRelease(oqcDocNo);
    if (!oqc.success) throw new Error('OQC step failed: ' + oqc.error);
    result.docNos.oqc = oqc.docNo;
    SpreadsheetApp.flush();

    // 7. TEST FG dispatch lot (AVAILABLE)
    var fg = createTestFGLot({
      oqcRef: oqc.docNo,
      customerCode: 'TEST-CUST', customerName: 'TEST customer',
      productCode: 'TEST-FG', productDesc: 'Test FG (smoke)',
      batch: batchNo, fgLocation: 'FG-STORE',
      qtyReleased: qty, unit: 'KGS'
    });
    if (!fg.success) throw new Error('FG lot step failed: ' + fg.error);
    result.docNos.fgLot = fg.lotId;
    SpreadsheetApp.flush();

    // 8. REAL saveDispatchWithFIFO — mints gp docNo
    var disp = saveDispatchWithFIFO({
      date: new Date(),
      customerCode: 'TEST-CUST', customerName: 'TEST customer',
      productCode: 'TEST-FG', productDesc: 'Test FG (smoke)',
      qtyRequested: qty,
      chosenPlan: [{ lotId: fg.lotId, qty: qty }],
      vehicleNo: 'TEST-VEH', driverName: 'TEST driver',
      transporter: 'TEST', authorizedBy: 'claude-smoke-test',
      securityGuard: 'TEST', remarks: 'TEST smoke dispatch — safe to archive',
      dispatchZone: 'FG-STORE', operatorName: 'claude-smoke-test'
    });
    if (!disp.success) throw new Error('Dispatch step failed: ' + (disp.error || JSON.stringify(disp)));
    result.docNos.gp = disp.docNo || disp.gpNo;
    SpreadsheetApp.flush();

    // 9. Archive all TEST rows
    result.archived.gatepass    = archiveTestRows('GATEPASS_LOG', result.docNos.gp, 0).moved || 0;
    result.archived.stockLedger = (function() {
      // STOCK_LEDGER refDocNo is col 11 (idx 10). Archive rows by each refDocNo we wrote.
      var moved = 0;
      [grn.docNo, prod.docNo, result.docNos.gp].forEach(function(ref) {
        if (ref) moved += (archiveByColValue('STOCK_LEDGER', 10, ref).moved || 0);
      });
      return moved;
    })();
    result.archived.fgLots = archiveByColValue('FG_DISPATCH_LOTS', 0, fg.lotId).moved || 0;
    result.archived.oqc    = archiveTestRows('OQC_LOG',          'TEST/OQC', 0).moved || 0;
    result.archived.iqc    = archiveTestRows('IQC_LOG',          'TEST/IQC', 0).moved || 0;
    result.archived.grn    = archiveTestRows('GRN_LOG',          'TEST/GRN', 0).moved || 0;
    result.archived.po     = archiveTestRows('PO_HEADER',        'TEST/PO',  0).moved || 0;
    result.archived.poLines = archiveTestRows('PO_LINES',        'TEST/PO',  0).moved || 0;
    result.archived.prod   = archiveTestRows('PROD_ISSUE_LOG',   'TEST/PROD', 2).moved || 0;

    result.success = true;
    return result;
  } catch(e) {
    Logger.log('smokeFullChain failed: ' + e.message + ' stack: ' + e.stack);
    result.errors.push(e.message);
    result.success = false;
    return result;
  } finally {
    // 10. Restore gp_counter — runs even if archive sweeps or earlier steps throw.
    // Only gp can advance (TEST counters never touched real ones).
    try {
      if (result.countersBefore.gp != null) {
        setDocCounter('gp', result.countersBefore.gp);
      }
    } catch(restoreErr) {
      Logger.log('gp_counter restore failed: ' + restoreErr.message);
      result.errors.push('gp_counter restore failed: ' + restoreErr.message);
    }

    // Verify counter state (best-effort; never throws out of finally)
    try {
      ['po','grn','iqc','oqc','gp','prod'].forEach(function(t) {
        var c = getDocCounter(t);
        result.countersAfter[t] = c ? c.value : null;
        result.countersRestored[t] = (result.countersBefore[t] === result.countersAfter[t]);
      });
    } catch(verifyErr) {
      Logger.log('counter verify failed: ' + verifyErr.message);
    }
  }
}
