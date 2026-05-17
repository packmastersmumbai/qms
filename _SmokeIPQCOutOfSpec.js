// ============================================================
// _SmokeIPQCOutOfSpec.js — Phase 4.3 headless E2E IPQC OOS path.
//
// Flow:
//   1. TEST PO   (createTestPO_)
//   2. TEST GRN  (createTestGRN_  — writes STOCK_LEDGER GRN_RECEIPT)
//   3. TEST IQC ACCEPT (createTestIQCAccept — material cleared to production)
//   4. TEST Production batch (createTestProductionBatch — RM_ISSUE on ledger,
//      batch is in-process; this is the batch IPQC inspects)
//   5. TEST IPQC OOS (createTestIPQCOutOfSpec — direct-write to IPQC_Sessions +
//      IPQC_LOG with one PASS row and one FAIL row, mirroring saveRound's
//      multi-param write semantics. NO real saveIPQC/startSession/saveRound
//      call — preserves counter purity. IPQC has no counter to bump anyway.)
//   6. Raise TEST NCR (raiseTestNCR — TEST/NCR docNo). Back-stamp the FAIL
//      IPQC_LOG row's remark column (col 12) as 'NCR:<docNo> — ...' exactly
//      the way real raiseIPQCNCR does it (IPQC.js line 488).
//
// IPQC does NOT touch STOCK_LEDGER (in-process inspection — batch is still
// being made; no quarantine move at OOS-detection time, only later if NCR
// disposition rejects). IPQC does NOT change PROD_ISSUE_LOG batch status
// either — that sheet has no status column (12 cols: issueId, ts, prodNo,
// matCode, matDesc, batch, loc, qty, unit, issuedBy, grnRef, remarks).
// We report observed batch state as-is, not assumed.
//
// All TEST docNos use TEST/<TYPE>/<YYYY>-NN via _testNextSeq_.
// IPQC has no counter (sessionId is composite productCode_batch_inspector).
// No SpreadsheetApp.getUi() — fully clasp-run-able.
// ============================================================

function smokeIPQCOutOfSpec() {
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
  // IPQC has no counter — sessionId is composite, not sequential.
  var COUNTERS = ['po','grn','iqc','oqc','gp','prod','ncr'];
  try {
    COUNTERS.forEach(function(t) {
      var c = getDocCounter(t);
      result.countersBefore[t] = c ? c.value : null;
    });

    var ss = getSpreadsheet();
    var matCode = 'TEST-MAT';
    var matDesc = 'Test material (smoke-ipqc-oos)';
    var batchNo = 'TEST-BATCH-IPQC-' + new Date().getTime();
    var loc     = 'RM-STORE-A';
    var qty     = 5;

    // 1-2. PO + GRN
    var po = createTestPO_({
      materialCode: matCode, materialDesc: matDesc,
      qtyOrdered: qty, unit: 'KGS'
    });
    if (!po.success) throw new Error('PO step failed: ' + po.error);
    result.docNos.po = po.poNo;

    var grn = createTestGRN_({
      poRef: po.poNo, materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, qtyReceived: qty, locationId: loc, unit: 'KGS'
    });
    if (!grn.success) throw new Error('GRN step failed: ' + grn.error);
    result.docNos.grn = grn.docNo;
    SpreadsheetApp.flush();

    // 3. IQC ACCEPT
    var iqc = createTestIQCAccept({
      grnNo: grn.docNo, supplierName: 'TEST supplier',
      materialDesc: matDesc, batchNo: batchNo,
      inspector: 'claude-smoke-test', acceptedQty: qty
    });
    if (!iqc.success) throw new Error('IQC step failed: ' + iqc.error);
    result.docNos.iqc = iqc.docNo;
    SpreadsheetApp.flush();

    // 4. Production batch in-process
    var prod = createTestProductionBatch({
      materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, locationId: loc,
      qtyIssued: qty, unit: 'KGS', grnRef: grn.docNo
    });
    if (!prod.success) throw new Error('Production step failed: ' + prod.error);
    result.docNos.prod = prod.docNo;
    SpreadsheetApp.flush();

    // 5. IPQC OOS — direct-write session + log rows (1 PASS, 1 FAIL)
    var ipqc = createTestIPQCOutOfSpec({
      productCode: matCode, productName: matDesc,
      batchNo: batchNo, inspector: 'claude-smoke-test',
      line: 'TEST-LINE',
      oosParamCode: 'P01', oosParamName: 'Seal Strength',
      oosStdValue: 'min 10 N', oosUnit: 'N', oosActual: 5,
      oosRemark: 'TEST smoke IPQC out-of-spec — safe to archive'
    });
    if (!ipqc.success) throw new Error('IPQC OOS step failed: ' + ipqc.error);
    result.docNos.ipqc = ipqc.sessionId;
    result.verifications.ipqcRowsWritten = {
      sessions: ipqc.sessionsRows,
      log:      ipqc.logRows
    };
    SpreadsheetApp.flush();

    // 6. Raise TEST NCR + back-stamp the FAIL IPQC_LOG row's remark (col 12)
    var ncr = raiseTestNCR({
      source: 'IPQC',
      sourceRef: ipqc.sessionId + ' / round ' + ipqc.roundNo + ' / ' + ipqc.paramCode,
      materialCode: matCode, materialDesc: matDesc,
      batchNo: batchNo, qtyAffected: qty, unit: 'KGS',
      defectDesc: 'TEST smoke IPQC OOS — Seal Strength below spec'
    });
    if (ncr && ncr.success) {
      result.docNos.ncr = ncr.docNo;
      result.verifications.ncrRaised = true;
      // Back-stamp remark col 12 on the FAIL row (mirrors IPQC.js:488)
      try {
        var logWs = ss.getSheetByName('IPQC_LOG');
        var lastRow = logWs.getLastRow();
        var data = logWs.getRange(2, 1, lastRow - 1, 12).getValues();
        for (var i = data.length - 1; i >= 0; i--) {
          if (String(data[i][0]) === ipqc.sessionId
              && String(data[i][5]) === ipqc.paramCode
              && String(data[i][10]) === 'FAIL') {
            var existing = data[i][11] || '';
            var newRemark = 'NCR:' + ncr.docNo + ' — TEST smoke IPQC OOS';
            if (existing) newRemark = newRemark + ' | ' + existing;
            logWs.getRange(i + 2, 12).setValue(newRemark);
            result.verifications.ipqcRemarkBackstamped = true;
            break;
          }
        }
      } catch(bsErr) {
        result.errors.push('IPQC NCR back-stamp failed: ' + bsErr.message);
      }
    } else {
      result.verifications.ncrRaised = false;
      result.errors.push('raiseTestNCR failed: ' + (ncr && ncr.error));
    }
    SpreadsheetApp.flush();

    // 7. Verifications — read observed state, do NOT assume
    // (a) Batch status after OOS: PROD_ISSUE_LOG has no status column. Report
    //     observed shape (existence of the production row keyed on prodNo).
    try {
      var prodWs = ss.getSheetByName('PROD_ISSUE_LOG');
      if (prodWs && prodWs.getLastRow() > 1) {
        var pvals = prodWs.getRange(2, 1, prodWs.getLastRow() - 1, prodWs.getLastColumn()).getValues();
        var found = pvals.some(function(r) { return String(r[2]) === prod.docNo; });
        result.verifications.batchStatusAfter = found
          ? 'IN_PROCESS (PROD_ISSUE_LOG has no status column — IPQC OOS does not flip batch state at detection time)'
          : 'NOT_FOUND';
      } else {
        result.verifications.batchStatusAfter = 'PROD_ISSUE_LOG empty';
      }
    } catch(bsCheckErr) {
      result.verifications.batchStatusAfter = 'check failed: ' + bsCheckErr.message;
    }
    // (b) Ledger moves for this batch — should be exactly GRN_RECEIPT + RM_ISSUE.
    //     IPQC writes none.
    try {
      var slWs = ss.getSheetByName('STOCK_LEDGER');
      var moves = [];
      if (slWs && slWs.getLastRow() > 1) {
        var slvals = slWs.getRange(2, 1, slWs.getLastRow() - 1, slWs.getLastColumn()).getValues();
        // STOCK_LEDGER cols (Warehouse.js:4): txnId[0], ts[1], txnType[2],
        // matCode[3], batch[4], locId[5], qtyIn[6], qtyOut[7], balance[8],
        // refDocType[9], refDocNo[10], operator[11], remarks[12]
        slvals.forEach(function(r) {
          if (String(r[4]) === batchNo) {
            moves.push(String(r[2]) + '@' + String(r[5]) + ' ref=' + String(r[10]));
          }
        });
      }
      result.verifications.ledgerMoves = moves;
      result.verifications.ledgerMoveCount = moves.length;
    } catch(slErr) {
      result.verifications.ledgerMoves = 'check failed: ' + slErr.message;
    }

    // 8. Archive every TEST row written
    var slMoved = 0;
    [grn.docNo, prod.docNo].forEach(function(ref) {
      if (ref) slMoved += (archiveByColValue('STOCK_LEDGER', 10, ref).moved || 0);
    });
    result.archived.stock_ledger  = slMoved;
    result.archived.ipqc_log      = archiveByColValue('IPQC_LOG',      0, ipqc.sessionId).moved || 0;
    result.archived.ipqc_sessions = archiveByColValue('IPQC_Sessions', 0, ipqc.sessionId).moved || 0;
    result.archived.prod_issue_log = archiveTestRows('PROD_ISSUE_LOG', 'TEST/PROD', 2).moved || 0;
    result.archived.iqc_log    = archiveTestRows('IQC_LOG',   iqc.docNo, 0).moved || 0;
    result.archived.grn_log    = archiveTestRows('GRN_LOG',   grn.docNo, 0).moved || 0;
    result.archived.po_header  = archiveTestRows('PO_HEADER', po.poNo,   0).moved || 0;
    result.archived.po_lines   = archiveTestRows('PO_LINES',  po.poNo,   0).moved || 0;
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
    Logger.log('smokeIPQCOutOfSpec failed: ' + e.message + ' stack: ' + e.stack);
    result.errors.push(e.message);
    result.success = false;
    return result;
  } finally {
    // Counter verify + defensive restore. Nothing should have advanced (every
    // doc used TEST/<TYPE>/<YYYY>-NN; IPQC has no counter).
    try {
      COUNTERS.forEach(function(t) {
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
function smokeIPQCOutOfSpec_core() { return smokeIPQCOutOfSpec(); }
