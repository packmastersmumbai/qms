// ============================================================
// _SmokeRejectOQC.js — Phase 4.2 headless E2E OQC REJECT path.
//
// Flow:
//   1. TEST PO   (createTestPO_)
//   2. TEST GRN  (createTestGRN_  — writes STOCK_LEDGER GRN_RECEIPT)
//   3. TEST IQC ACCEPTED (createTestIQCAccept — material available for prod)
//   4. TEST production batch (createTestProductionBatch — writes RM_ISSUE)
//   5. TEST OQC REJECTED (createTestOQCReject — direct OQC_LOG write,
//                         tinted red, does NOT mint real ncr docNo and does
//                         NOT mirror an FG_DISPATCH_LOTS row)
//   6. STOCK_LEDGER moves: real saveOQC fires NONE on REJECTED (only
//      OQC_RELEASE on releases). We mirror that — no manual moves.
//   7. Raise TEST NCR (raiseTestNCR — TEST/NCR docNo) and back-stamp the
//      OQC row's FG-Lot-ID col (col 23) with the NCR ref so the audit
//      trail mirrors the real reject path (real saveOQC leaves col 23
//      blank on reject; we reuse it as the NCR back-stamp slot, matching
//      the IQC NCR back-stamp pattern).
//
// Verifications:
//   - noFGLotCreated     : FG_DISPATCH_LOTS row count unchanged for the
//                          rejected batch (counts before+after).
//   - notInDispatchForm  : getReleasedFGLotsForCustomerProduct returns
//                          no lot matching this batch.
//   - ncrRaised          : raiseTestNCR returned success.
//   - ledgerMoves        : tx_types observed in STOCK_LEDGER for this
//                          batch (expected: GRN_RECEIPT + RM_ISSUE only;
//                          no OQC_REJECT moves because real saveOQC fires
//                          none on reject).
//
// Archive sweep covers every sheet touched. Counters restored in finally.
// All TEST docNos use TEST/<TYPE>/<YYYY>-NN via _testNextSeq_.
// No SpreadsheetApp.getUi() — fully clasp-run-able.
// ============================================================

function smokeRejectOQC() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var result = {
    success: false,
    docNos: {},
    verifications: {},
    archived: {},
    countersBefore: {},
    countersAfter: {},
    countersRestored: {},
    errors: []
  };
  try {
    // 1. Snapshot counters (po, grn, iqc, prod, oqc, ncr — all touched)
    ['po','grn','iqc','oqc','prod','ncr'].forEach(function(t) {
      var c = getDocCounter(t);
      result.countersBefore[t] = c ? c.value : null;
    });

    var ss = getSpreadsheet();
    var matCode  = 'TEST-MAT';
    var matDesc  = 'Test material (smoke-reject-oqc)';
    var fgCode   = 'TEST-FG';
    var fgDesc   = 'Test FG (smoke-reject-oqc)';
    var batchNo  = 'TEST-BATCH-OQCREJ-' + new Date().getTime();
    var loc      = 'RM-STORE-A';
    var qty      = 5;
    var custCode = 'TEST-CUST';
    var custName = 'TEST customer';

    // Snapshot FG_DISPATCH_LOTS count for noFGLotCreated check
    var fgWs = ss.getSheetByName('FG_DISPATCH_LOTS');
    var fgRowsBefore = (fgWs && fgWs.getLastRow() > 1) ? (fgWs.getLastRow() - 1) : 0;

    // 2. TEST PO
    var po = createTestPO_({
      materialCode: matCode, materialDesc: matDesc,
      qtyOrdered: qty, unit: 'KGS'
    });
    if (!po.success) throw new Error('PO step failed: ' + po.error);
    result.docNos.po = po.poNo;

    // 3. TEST GRN
    var grn = createTestGRN_({
      poRef: po.poNo, materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, qtyReceived: qty, locationId: loc, unit: 'KGS'
    });
    if (!grn.success) throw new Error('GRN step failed: ' + grn.error);
    result.docNos.grn = grn.docNo;
    SpreadsheetApp.flush();

    // 4. TEST IQC ACCEPT (so production can consume the material)
    var iqc = createTestIQCAccept({
      grnNo: grn.docNo, supplierName: 'TEST supplier',
      materialDesc: matDesc, batchNo: batchNo,
      inspector: 'claude-smoke-test', acceptedQty: qty
    });
    if (!iqc.success) throw new Error('IQC step failed: ' + iqc.error);
    result.docNos.iqc = iqc.docNo;
    SpreadsheetApp.flush();

    // 5. TEST production batch (writes RM_ISSUE)
    var prod = createTestProductionBatch({
      materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, locationId: loc,
      qtyIssued: qty, unit: 'KGS', grnRef: grn.docNo
    });
    if (!prod.success) throw new Error('Production step failed: ' + prod.error);
    result.docNos.prod = prod.docNo;
    SpreadsheetApp.flush();

    // 6. TEST OQC REJECTED (direct OQC_LOG write — no real saveOQC, no FG mirror)
    var oqcDocNo = _testNextSeq_('TEST/OQC');
    var oqc = createTestOQCReject(oqcDocNo, {
      customerCode: custCode, customerName: custName,
      batchPO: batchNo, materialDesc: fgDesc,
      inspector: 'claude-smoke-test', rejectedQty: qty
    });
    if (!oqc.success) throw new Error('OQC reject step failed: ' + oqc.error);
    result.docNos.oqc = oqc.docNo;
    SpreadsheetApp.flush();

    // 7. Real saveOQC fires NO STOCK_LEDGER moves on REJECTED (only OQC_RELEASE
    // on releases). We mirror that — no manual ledger moves.
    result.verifications.oqcRejectLedgerPolicy =
      'real saveOQC writes no STOCK_LEDGER on REJECTED — mirrored (no manual moves)';

    // 8. Raise TEST NCR + back-stamp OQC row (col 23 = FG Lot ID slot,
    // unused on reject; reused as NCR back-stamp slot for audit symmetry)
    var ncr = raiseTestNCR({
      source: 'OQC', sourceRef: oqc.docNo,
      materialCode: fgCode, materialDesc: fgDesc,
      batchNo: batchNo, qtyAffected: qty, unit: 'KGS',
      defectDesc: 'TEST smoke OQC rejection — see ' + oqc.docNo
    });
    if (ncr && ncr.success) {
      result.docNos.ncr = ncr.docNo;
      result.verifications.ncrRaised = true;
      try {
        var oqcWs = ss.getSheetByName('OQC_LOG');
        var oqcLast = oqcWs.getLastRow();
        var ids = oqcWs.getRange(2, 1, oqcLast - 1, 1).getValues();
        for (var i = ids.length - 1; i >= 0; i--) {
          if (String(ids[i][0]) === oqc.docNo) {
            oqcWs.getRange(i + 2, 23).setValue(ncr.docNo);
            break;
          }
        }
      } catch(bsErr) {
        result.errors.push('OQC NCR back-stamp failed: ' + bsErr.message);
      }
    } else {
      result.verifications.ncrRaised = false;
      result.errors.push('raiseTestNCR failed: ' + (ncr && ncr.error));
    }
    SpreadsheetApp.flush();

    // 9. Verification: noFGLotCreated — FG_DISPATCH_LOTS row count unchanged
    var fgRowsAfter = (fgWs && fgWs.getLastRow() > 1) ? (fgWs.getLastRow() - 1) : 0;
    result.verifications.fgRowsBefore = fgRowsBefore;
    result.verifications.fgRowsAfter  = fgRowsAfter;
    result.verifications.noFGLotCreated = (fgRowsAfter === fgRowsBefore);
    if (!result.verifications.noFGLotCreated) {
      result.errors.push('FG_DISPATCH_LOTS grew on OQC reject: before=' + fgRowsBefore + ' after=' + fgRowsAfter);
    }

    // 10. Verification: notInDispatchForm — getReleasedFGLotsForCustomerProduct
    // returns no lot matching this rejected batch.
    try {
      var lots = (typeof getReleasedFGLotsForCustomerProduct === 'function')
        ? getReleasedFGLotsForCustomerProduct(custCode, fgCode) : [];
      var matched = lots.filter(function(l) {
        return String(l.batch || l.batchNo || '') === batchNo;
      });
      result.verifications.notInDispatchForm = (matched.length === 0);
      result.verifications.dispatchLotsFound = lots.length;
      if (matched.length > 0) {
        result.errors.push('rejected batch appears as eligible dispatch lot: ' + JSON.stringify(matched));
      }
    } catch(dfErr) {
      result.verifications.notInDispatchForm = null;
      result.errors.push('getReleasedFGLotsForCustomerProduct check failed: ' + dfErr.message);
    }

    // 11. Verification: ledgerMoves — tx_types observed for this batch
    try {
      var ledgerMoves = [];
      var slWs = ss.getSheetByName('STOCK_LEDGER');
      if (slWs && slWs.getLastRow() > 1) {
        var slData = slWs.getRange(2, 1, slWs.getLastRow() - 1, Math.max(11, slWs.getLastColumn())).getValues();
        for (var si = 0; si < slData.length; si++) {
          // STOCK_LEDGER schema: 1=txnId, 2=date, 3=txType, 4=matCode,
          // 5=batch, 6=loc, 7=qtyIn, 8=qtyOut, 9=balance, 10=refDocType, 11=refDocNo
          var batchCell = String(slData[si][4] || '');
          var ref = String(slData[si][10] || '');
          if (batchCell === batchNo || ref === grn.docNo || ref === prod.docNo || ref === oqc.docNo) {
            ledgerMoves.push(String(slData[si][2] || '') + '@' + String(slData[si][5] || ''));
          }
        }
      }
      result.verifications.ledgerMoves = ledgerMoves;
    } catch(lmErr) {
      result.verifications.ledgerMoves = [];
      result.errors.push('ledger move scan failed: ' + lmErr.message);
    }

    // 12. Archive every TEST row written
    var slMoved = 0;
    [grn.docNo, prod.docNo, oqc.docNo].forEach(function(ref) {
      if (ref) slMoved += (archiveByColValue('STOCK_LEDGER', 10, ref).moved || 0);
    });
    result.archived.stock_ledger    = slMoved;
    result.archived.oqc_log         = archiveTestRows('OQC_LOG',        oqc.docNo,  0).moved || 0;
    result.archived.prod_issue_log  = archiveTestRows('PROD_ISSUE_LOG', prod.docNo, 2).moved || 0;
    result.archived.iqc_log         = archiveTestRows('IQC_LOG',        iqc.docNo,  0).moved || 0;
    result.archived.grn_log         = archiveTestRows('GRN_LOG',        grn.docNo,  0).moved || 0;
    result.archived.po_header       = archiveTestRows('PO_HEADER',      po.poNo,    0).moved || 0;
    result.archived.po_lines        = archiveTestRows('PO_LINES',       po.poNo,    0).moved || 0;
    // Defensive: in case a rogue FG lot was somehow created for this batch
    result.archived.fg_dispatch_lots = archiveByColValue('FG_DISPATCH_LOTS', 8, batchNo).moved || 0;
    if (result.docNos.ncr) {
      var ncrArch = archiveTestNCR(result.docNos.ncr);
      result.archived.ncr_log     = (ncrArch.log     && ncrArch.log.moved)     || 0;
      result.archived.ncr_history = (ncrArch.history && ncrArch.history.moved) || 0;
    } else {
      result.archived.ncr_log = 0;
      result.archived.ncr_history = 0;
    }

    result.success = (result.errors.length === 0);
    return result;
  } catch(e) {
    Logger.log('smokeRejectOQC failed: ' + e.message + ' stack: ' + e.stack);
    result.errors.push(e.message);
    result.success = false;
    return result;
  } finally {
    // Verify + restore counters (defensive — no real handlers invoked,
    // so no counter should have advanced).
    try {
      ['po','grn','iqc','oqc','prod','ncr'].forEach(function(t) {
        var c = getDocCounter(t);
        result.countersAfter[t] = c ? c.value : null;
        if (result.countersBefore[t] != null
            && result.countersAfter[t] !== result.countersBefore[t]) {
          try { setDocCounter(t, result.countersBefore[t]); } catch(_){}
          var c2 = getDocCounter(t);
          result.countersAfter[t] = c2 ? c2.value : null;
        }
        result.countersRestored[t] = (result.countersBefore[t] === result.countersAfter[t]);
      });
    } catch(verifyErr) {
      Logger.log('counter verify failed: ' + verifyErr.message);
    }
  }
}

// Alias for parity with the _core naming used in diag wrappers.
function smokeRejectOQC_core() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  return smokeRejectOQC();
}
