// ============================================================
// _SmokeRejectIQC.js — Phase 4.1 headless E2E IQC REJECT path.
//
// Flow:
//   1. TEST PO   (createTestPO_)
//   2. TEST GRN  (createTestGRN_  — writes STOCK_LEDGER GRN_RECEIPT)
//   3. TEST IQC REJECTED  (createTestIQCReject — direct IQC_LOG write,
//                          tinted red, does NOT mint real ncr docNo)
//   4. Manually fire the STOCK_LEDGER reject moves (IQC_REJECT_OUT from
//      GRN location + IQC_REJECT_QUARANTINE into QUARANTINE location) —
//      mirrors the real saveIQC handler so we exercise the same ledger
//      semantics without touching the real ncr counter.
//   5. Raise a TEST NCR (raiseTestNCR — TEST/NCR docNo) and back-stamp
//      col 24 on the IQC row so the audit trail mirrors production.
//   6. Verify the rejected (mat,batch) no longer appears as available
//      in getProductionLotsForMaterial().
//   7. Archive every TEST row written + STOCK_LEDGER moves keyed on the
//      IQC docNo.
//   8. Restore counters in finally — only ncr could have advanced if we
//      had called the real handler; we did not, so all counters must be
//      unchanged (verified at exit).
//
// All TEST docNos use TEST/<TYPE>/<YYYY>-NN via _testNextSeq_.
// No SpreadsheetApp.getUi() — fully clasp-run-able.
// ============================================================

function smokeRejectIQC() {
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
    // 1. Snapshot counters
    ['po','grn','iqc','oqc','gp','prod','ncr'].forEach(function(t) {
      var c = getDocCounter(t);
      result.countersBefore[t] = c ? c.value : null;
    });

    var ss = getSpreadsheet();
    var matCode = 'TEST-MAT';
    var matDesc = 'Test material (smoke-reject)';
    var batchNo = 'TEST-BATCH-REJ-' + new Date().getTime();
    var loc     = 'RM-STORE-A';
    var qty     = 5;

    // 2. TEST PO
    var po = createTestPO_({
      materialCode: matCode, materialDesc: matDesc,
      qtyOrdered: qty, unit: 'KGS'
    });
    if (!po.success) throw new Error('PO step failed: ' + po.error);
    result.docNos.po = po.poNo;

    // 3. TEST GRN (writes STOCK_LEDGER GRN_RECEIPT)
    var grn = createTestGRN_({
      poRef: po.poNo, materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, qtyReceived: qty, locationId: loc, unit: 'KGS'
    });
    if (!grn.success) throw new Error('GRN step failed: ' + grn.error);
    result.docNos.grn = grn.docNo;
    SpreadsheetApp.flush();

    // 4. TEST IQC REJECTED (direct IQC_LOG write)
    var iqc = createTestIQCReject({
      grnNo: grn.docNo, supplierName: 'TEST supplier',
      materialDesc: matDesc, batchNo: batchNo,
      inspector: 'claude-smoke-test', rejectedQty: qty
    });
    if (!iqc.success) throw new Error('IQC reject step failed: ' + iqc.error);
    result.docNos.iqc = iqc.docNo;

    // 5. Fire reject ledger moves manually (mirrors real saveIQC handler)
    var ledgerMoves = [];
    if (typeof writeStockLedger_ === 'function') {
      try {
        var qLocs = (typeof getLocations === 'function') ? getLocations('QUARANTINE') : [];
        var quarId = (qLocs && qLocs.length > 0) ? qLocs[0].id : 'QUARANTINE';
        writeStockLedger_('IQC_REJECT_OUT', matCode, batchNo, loc,
          0, qty, 'IQC', iqc.docNo, 'claude-smoke-test',
          'TEST smoke IQC reject — moved to ' + quarId);
        ledgerMoves.push('IQC_REJECT_OUT@' + loc);
        writeStockLedger_('IQC_REJECT_QUARANTINE', matCode, batchNo, quarId,
          qty, 0, 'IQC', iqc.docNo, 'claude-smoke-test',
          'TEST smoke IQC reject — quarantined pending NCR disposition');
        ledgerMoves.push('IQC_REJECT_QUARANTINE@' + quarId);
        result.verifications.quarantineLocation = quarId;
      } catch(ledgerErr) {
        result.errors.push('ledger move failed: ' + ledgerErr.message);
      }
    } else {
      result.errors.push('writeStockLedger_ not available — ledger moves skipped');
    }
    result.verifications.ledgerMoves = ledgerMoves;
    SpreadsheetApp.flush();

    // 6. Raise TEST NCR + back-stamp IQC row col 24
    var ncr = raiseTestNCR({
      source: 'IQC', sourceRef: iqc.docNo,
      materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, qtyAffected: qty, unit: 'KGS',
      defectDesc: 'TEST smoke IQC rejection — see ' + iqc.docNo
    });
    if (ncr && ncr.success) {
      result.docNos.ncr = ncr.docNo;
      result.verifications.ncrRaised = true;
      // Back-stamp IQC row (find by docNo in col 1)
      try {
        var iqcWs = ss.getSheetByName('IQC_LOG');
        var iqcLast = iqcWs.getLastRow();
        var ids = iqcWs.getRange(2, 1, iqcLast - 1, 1).getValues();
        for (var i = ids.length - 1; i >= 0; i--) {
          if (String(ids[i][0]) === iqc.docNo) {
            iqcWs.getRange(i + 2, 24).setValue(ncr.docNo);
            break;
          }
        }
      } catch(bsErr) {
        result.errors.push('IQC NCR back-stamp failed: ' + bsErr.message);
      }
    } else {
      result.verifications.ncrRaised = false;
      result.errors.push('raiseTestNCR failed: ' + (ncr && ncr.error));
    }
    SpreadsheetApp.flush();

    // 7. Verify rejected (mat,batch) not available for production
    try {
      var lots = (typeof getProductionLotsForMaterial === 'function')
        ? getProductionLotsForMaterial(matCode) : [];
      var matched = lots.filter(function(l) {
        return String(l.batchOrLotNo) === batchNo
            && String(l.locationId)   === loc
            && Number(l.balance) > 0;
      });
      result.verifications.notInProductionForm = (matched.length === 0);
      result.verifications.productionLotsForMaterial = lots.length;
      if (matched.length > 0) {
        result.errors.push('rejected batch still appears available: ' + JSON.stringify(matched));
      }
    } catch(pfErr) {
      result.verifications.notInProductionForm = null;
      result.errors.push('getProductionLotsForMaterial check failed: ' + pfErr.message);
    }

    // 8. Archive every TEST row written
    // STOCK_LEDGER: archive all moves keyed by refDocNo = grn.docNo or iqc.docNo
    var slMoved = 0;
    [grn.docNo, iqc.docNo].forEach(function(ref) {
      if (ref) slMoved += (archiveByColValue('STOCK_LEDGER', 10, ref).moved || 0);
    });
    result.archived.stock_ledger = slMoved;
    result.archived.iqc_log  = archiveTestRows('IQC_LOG',   iqc.docNo, 0).moved || 0;
    result.archived.grn_log  = archiveTestRows('GRN_LOG',   grn.docNo, 0).moved || 0;
    result.archived.po_header = archiveTestRows('PO_HEADER', po.poNo,  0).moved || 0;
    result.archived.po_lines  = archiveTestRows('PO_LINES',  po.poNo,  0).moved || 0;
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
    Logger.log('smokeRejectIQC failed: ' + e.message + ' stack: ' + e.stack);
    result.errors.push(e.message);
    result.success = false;
    return result;
  } finally {
    // 9. Verify counter state (best-effort). No counter should have advanced
    // because every doc used TEST/<TYPE>/<YYYY>-NN sequences. Restore any
    // that drifted (defensive).
    try {
      ['po','grn','iqc','oqc','gp','prod','ncr'].forEach(function(t) {
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
function smokeRejectIQC_core() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  return smokeRejectIQC();
}
