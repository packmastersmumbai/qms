// _TestHelpers.js — bypass docNumber counters so smoke tests don't leave gaps
// in audit-numbered sequences. All test rows use TEST/<TYPE>/<YYYY>-<NN> docNos
// and can be moved to _TEST_ARCHIVE via archiveTestRows() after the test.

function _testNextSeq_(prefix) {
  // Walks _TEST_ARCHIVE + live NCR_LOG to find the next free TEST/<TYPE>/<YYYY>-NN.
  var ss = getSpreadsheet();
  var year = new Date().getFullYear();
  var max = 0;
  var sheets = ['NCR_LOG', 'OQC_LOG', 'IQC_LOG', 'GRN_LOG', 'PO_HEADER', 'PROD_ISSUE_LOG', 'GATEPASS_LOG', '_TEST_ARCHIVE'];
  sheets.forEach(function(name) {
    var ws = ss.getSheetByName(name);
    if (!ws || ws.getLastRow() < 2) return;
    var vals = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var s = String(vals[i][0] || '');
      var m = s.match(new RegExp('^' + prefix + '/' + year + '-(\\d+)$'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  });
  return prefix + '/' + year + '-' + String(max + 1).padStart(3, '0');
}

// Create a TEST NCR with a TEST/NCR/<YYYY>-NN docNo. Does NOT increment the
// real NCR sequence counter. Returns the docNo so the UI smoke can target it.
function raiseTestNCR(payload) {
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('NCR_LOG');
    if (!ws) throw new Error('NCR_LOG sheet not found.');
    var docNo = _testNextSeq_('TEST/NCR');
    var now = new Date();
    ws.appendRow([
      docNo,
      payload.date ? new Date(payload.date) : now,
      payload.source || 'TEST',
      payload.sourceRef || '',
      payload.materialCode || 'TEST-MAT',
      payload.materialDesc || 'Test material (smoke)',
      payload.batchNo || 'TEST-BATCH',
      payload.qtyAffected != null ? payload.qtyAffected : 1,
      payload.unit || 'NOS',
      payload.defectDesc || 'Smoke-test defect — safe to archive',
      'PENDING_DISPOSITION',
      '', '', '',
      'OPEN',
      'claude-smoke-test',
      now
    ]);
    var lastRow = ws.getLastRow();
    ws.getRange(lastRow, 2).setNumberFormat('dd-MMM-yyyy');
    ws.getRange(lastRow, 17).setNumberFormat('dd-MMM-yyyy HH:mm');
    return { success: true, docNo: docNo };
  } catch(e) {
    Logger.log('raiseTestNCR failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Move any rows whose col-1 docNo starts with docNoPrefix from sourceSheet
// into _TEST_ARCHIVE (created on demand). Preserves all columns + a leading
// "_ArchivedFrom" + "_ArchivedAt" pair so the audit trail stays intact.
function archiveTestRows(sourceSheet, docNoPrefix, docNoColIndex) {
  try {
    var col = (docNoColIndex == null) ? 0 : docNoColIndex; // 0-based; default col 1
    var ss = getSpreadsheet();
    var src = ss.getSheetByName(sourceSheet);
    if (!src || src.getLastRow() < 2) return { success: true, moved: 0 };
    var archive = ss.getSheetByName('_TEST_ARCHIVE');
    if (!archive) {
      archive = ss.insertSheet('_TEST_ARCHIVE');
      archive.getRange(1, 1, 1, 3).setValues([['_ArchivedFrom', '_ArchivedAt', '_OriginalRow…']]).setFontWeight('bold');
    }
    var data = src.getDataRange().getValues();
    var moved = 0;
    var now = new Date();
    var toDelete = []; // collect rows to delete (descending so indices stay stable)
    for (var i = 1; i < data.length; i++) {
      var docNo = String(data[i][col] || '');
      if (docNo.indexOf(docNoPrefix) === 0) {
        archive.appendRow([sourceSheet, now].concat(data[i]));
        toDelete.push(i + 1);
        moved++;
      }
    }
    for (var j = toDelete.length - 1; j >= 0; j--) {
      src.deleteRow(toDelete[j]);
    }
    return { success: true, moved: moved, from: sourceSheet };
  } catch(e) {
    Logger.log('archiveTestRows failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Read/write the CONFIG counter for a given doc type (so smoke tests can
// reset the counter after archiving the rows they created — keeps the
// audit-numbered sequence gap-free).
function getDocCounter(type) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('CONFIG');
  if (!ws) return null;
  var data = ws.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === type + '_counter') {
      return { row: i + 1, value: parseInt(data[i][1], 10) || 1 };
    }
  }
  return null;
}

function setDocCounter(type, value) {
  var info = getDocCounter(type);
  if (!info) return { success: false, error: type + '_counter not found' };
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('CONFIG');
  ws.getRange(info.row, 2).setValue(value);
  return { success: true, previous: info.value, current: value };
}

// Inject a minimal TEST OQC row marked RELEASED so saveDispatchWithFIFO's
// decision gate passes. Returns the docNo so the FG lot can reference it.
function createTestOQCRelease(docNo) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('OQC_LOG');
    if (!ws) return { success: false, error: 'OQC_LOG sheet not found.' };
    var ref = docNo || 'TEST/OQC/2026-001';
    var ncols = Math.max(15, ws.getLastColumn());
    var row = new Array(ncols).fill('');
    row[0]  = ref;             // OQC No
    row[1]  = new Date();      // Date
    row[14] = 'RELEASED';      // Decision
    ws.appendRow(row);
    return { success: true, docNo: ref };
  } catch(e) {
    Logger.log('createTestOQCRelease failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Inject a minimal TEST OQC row marked REJECTED. Mirrors createTestOQCRelease;
// disposition cell tinted red (#FFEBEE) to match the real OQC reject UI.
// Does NOT fire any STOCK_LEDGER moves (real saveOQC also writes none on reject)
// and does NOT auto-raise a real NCR (real saveOQC would bump the ncr counter).
// Caller (smokeRejectOQC) raises a TEST NCR via raiseTestNCR for counter-purity.
function createTestOQCReject(docNo, payload) {
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('OQC_LOG');
    if (!ws) return { success: false, error: 'OQC_LOG sheet not found.' };
    var ref = docNo || _testNextSeq_('TEST/OQC');
    var ncols = Math.max(23, ws.getLastColumn());
    var row = new Array(ncols).fill('');
    var now = new Date();
    row[0]  = ref;                                 // OQC No
    row[1]  = now;                                 // Date
    row[2]  = payload.customerCode || 'TEST-CUST';
    row[3]  = payload.customerName || 'TEST customer';
    row[4]  = payload.batchPO      || 'TEST-BATCH';
    row[5]  = payload.materialDesc || 'Test FG (smoke)';
    row[13] = payload.inspector    || 'claude-smoke-test';
    row[14] = 'REJECTED';                          // Decision
    row[15] = payload.remarks || 'TEST smoke OQC reject — safe to archive';
    row[16] = 0;                                   // accepted qty
    row[17] = Number(payload.rejectedQty) || 1;    // rejected qty
    row[18] = now;                                 // created_at
    row[20] = 'claude-smoke-test';                 // operator
    ws.appendRow(row);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
    ws.getRange(lr, 19).setNumberFormat('dd-MMM-yyyy HH:mm');
    ws.getRange(lr, 15).setBackground('#FFEBEE');
    return { success: true, docNo: ref };
  } catch(e) {
    Logger.log('createTestOQCReject failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Inject a TEST AVAILABLE FG dispatch lot directly into FG_DISPATCH_LOTS so the
// dispatch UI smoke can run end-to-end. Returns the generated FGL- lotId.
function createTestFGLot(payload) {
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('FG_DISPATCH_LOTS');
    if (!ws) return { success: false, error: 'FG_DISPATCH_LOTS sheet not found.' };
    var lotId = 'TEST-FGL-' + new Date().getTime();
    var qtyReleased = Number(payload.qtyReleased) || 1;
    ws.appendRow([
      lotId,
      new Date(),
      payload.oqcRef || 'TEST/OQC/2026-001',
      payload.oqcDate ? new Date(payload.oqcDate) : new Date(),
      payload.customerCode || 'HENK',
      payload.customerName || 'Henkel Adhesives',
      payload.productCode || '2967583',
      payload.productDesc || 'LOCTITE BONDACE AP TRUEGRIP 500ML',
      payload.batch || 'TEST-BATCH',
      payload.fgLocation || 'FG-STORE',
      qtyReleased,
      0,
      qtyReleased,
      payload.unit || 'KGS',
      'AVAILABLE',
      '', '', '', 'TEST smoke lot — safe to archive'
    ]);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    ws.getRange(lr, 4).setNumberFormat('dd-MMM-yyyy');
    return { success: true, lotId: lotId };
  } catch(e) {
    Logger.log('createTestFGLot failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Archive all rows from a sheet that match a column value.
function archiveByColValue(sourceSheet, colIndex, value) {
  try {
    var ss = getSpreadsheet();
    var src = ss.getSheetByName(sourceSheet);
    if (!src || src.getLastRow() < 2) return { success: true, moved: 0 };
    var archive = ss.getSheetByName('_TEST_ARCHIVE');
    if (!archive) {
      archive = ss.insertSheet('_TEST_ARCHIVE');
      archive.getRange(1, 1, 1, 3).setValues([['_ArchivedFrom', '_ArchivedAt', '_OriginalRow…']]).setFontWeight('bold');
    }
    var data = src.getDataRange().getValues();
    var moved = 0;
    var now = new Date();
    var toDelete = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colIndex] || '').trim() === String(value).trim()) {
        archive.appendRow([sourceSheet, now].concat(data[i]));
        toDelete.push(i + 1);
        moved++;
      }
    }
    for (var j = toDelete.length - 1; j >= 0; j--) {
      src.deleteRow(toDelete[j]);
    }
    return { success: true, moved: moved, from: sourceSheet };
  } catch(e) {
    Logger.log('archiveByColValue failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Inject a minimal TEST IQC row marked ACCEPTED so downstream consumers (e.g.,
// Production smoke) see the material as IQC-passed. Mirrors createTestOQCRelease.
// IQC_LOG has 30 cols; disposition is col 23 (0-idx 22).
function createTestIQCAccept(payload) {
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('IQC_LOG');
    if (!ws) return { success: false, error: 'IQC_LOG sheet not found.' };
    var docNo = payload.docNo || _testNextSeq_('TEST/IQC');
    var ncols = Math.max(30, ws.getLastColumn());
    var row = new Array(ncols).fill('');
    var now = new Date();
    row[0]  = docNo;                              // IQC No
    row[1]  = now;                                // Date
    row[2]  = payload.grnNo         || 'TEST-GRN';
    row[3]  = payload.supplierName  || 'TEST supplier';
    row[4]  = payload.materialDesc  || 'Test material (smoke)';
    row[5]  = payload.batchNo       || 'TEST-BATCH';
    row[6]  = payload.inspector     || 'claude-smoke-test';
    row[7]  = 'AQL 2.5';
    row[22] = 'ACCEPTED';                         // disposition
    row[26] = Number(payload.acceptedQty) || 1;   // accepted qty
    row[27] = 0;                                  // rejected qty
    row[28] = now;                                // created_at
    row[29] = 'claude-smoke-test';                // operator_id
    ws.appendRow(row);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
    ws.getRange(lr, 29).setNumberFormat('dd-MMM-yyyy HH:mm');
    ws.getRange(lr, 23).setBackground('#E8F5E9');
    return { success: true, docNo: docNo };
  } catch(e) {
    Logger.log('createTestIQCAccept failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Inject a minimal TEST IQC row marked REJECTED. Mirrors createTestIQCAccept;
// disposition cell tinted red (#FFEBEE) to match the real IQC reject UI.
// Does NOT fire the STOCK_LEDGER reject moves or auto-raise NCR — caller (e.g.
// smokeRejectIQC) handles those explicitly so the test stays counter-clean
// (real saveIQC would mint a real NCR docNo and bump the ncr counter).
function createTestIQCReject(payload) {
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('IQC_LOG');
    if (!ws) return { success: false, error: 'IQC_LOG sheet not found.' };
    var docNo = payload.docNo || _testNextSeq_('TEST/IQC');
    var ncols = Math.max(30, ws.getLastColumn());
    var row = new Array(ncols).fill('');
    var now = new Date();
    row[0]  = docNo;                                // IQC No
    row[1]  = now;                                  // Date
    row[2]  = payload.grnNo         || 'TEST-GRN';
    row[3]  = payload.supplierName  || 'TEST supplier';
    row[4]  = payload.materialDesc  || 'Test material (smoke)';
    row[5]  = payload.batchNo       || 'TEST-BATCH';
    row[6]  = payload.inspector     || 'claude-smoke-test';
    row[7]  = 'AQL 2.5';
    row[22] = 'REJECTED';                           // disposition
    row[23] = payload.ncrRef || '';                 // NCR ref (back-stamped later)
    row[25] = payload.remarks || 'TEST smoke IQC reject — safe to archive';
    row[26] = 0;                                    // accepted qty
    row[27] = Number(payload.rejectedQty) || 1;     // rejected qty
    row[28] = now;                                  // created_at
    row[29] = 'claude-smoke-test';                  // operator_id
    ws.appendRow(row);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
    ws.getRange(lr, 29).setNumberFormat('dd-MMM-yyyy HH:mm');
    ws.getRange(lr, 23).setBackground('#FFEBEE');
    return { success: true, docNo: docNo };
  } catch(e) {
    Logger.log('createTestIQCReject failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Inject a TEST IPQC session + 2 IPQC_LOG rows (1 PASS, 1 FAIL) mirroring the
// real multi-sheet write of startSession + saveRound. Direct-write — does NOT
// call real saveIPQC/startSession/saveRound. IPQC has no counter (sessionId is
// composite productCode_batch_inspector), so nothing to bump/restore.
//
// IPQC_Sessions (note Title Case): session_id[0], product_code[1], product_name[2],
//   batch[3], inspector[4], line[5], date[6], start_time[7], end_time[8],
//   status[9], rounds[10]  -> 11 cols
// IPQC_LOG: session_id[0], product_code[1], batch[2], round_no[3], timestamp[4],
//   param_code[5], param_name[6], std_value[7], unit[8], actual_value[9],
//   result[10], remark[11], elapsed_hms[12], period_start[13], period_end[14],
//   avg_weight[15]  -> 16 cols
//
// "Out of spec" disposition = IPQC_LOG.result === 'FAIL' (per IPQC.js — no
// OOS/REJECT enum; the result field is free-text, with 'PASS'/'FAIL'/'NOTE'
// being the observed values). raiseIPQCNCR is what fires the NCR cascade.
function createTestIPQCOutOfSpec(payload) {
  try {
    payload = payload || {};
    var ss = getSpreadsheet();
    var sessWs = ss.getSheetByName('IPQC_Sessions');
    if (!sessWs) {
      sessWs = ss.insertSheet('IPQC_Sessions');
      sessWs.appendRow(['session_id', 'product_code', 'product_name', 'batch', 'inspector', 'line', 'date', 'start_time', 'end_time', 'status', 'rounds']);
    }
    var logWs = ss.getSheetByName('IPQC_LOG');
    if (!logWs) {
      logWs = ss.insertSheet('IPQC_LOG');
      logWs.appendRow(['session_id', 'product_code', 'batch', 'round_no', 'timestamp', 'param_code', 'param_name', 'std_value', 'unit', 'actual_value', 'result', 'remark', 'elapsed_hms', 'period_start', 'period_end', 'avg_weight']);
    }
    var productCode = payload.productCode || 'TEST-FG';
    var productName = payload.productName || 'Test FG (smoke)';
    var batch       = payload.batchNo     || 'TEST-BATCH';
    var inspector   = payload.inspector   || 'claude-smoke-test';
    var line        = payload.line        || 'TEST-LINE';
    var sessionId   = payload.sessionId   || (productCode + '_' + batch + '_' + inspector);
    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    var timeStr = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');

    sessWs.appendRow([
      sessionId, productCode, productName, batch, inspector, line,
      dateStr, timeStr, '', 'OPEN', 1
    ]);

    var tsStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    // Round 1, param 1 — PASS
    logWs.appendRow([
      sessionId, productCode, batch, 1, tsStr,
      'W01', 'Avg Weight', 500, 'g', 498, 'PASS',
      'TEST smoke IPQC pass — safe to archive',
      '00:05:00', timeStr, timeStr, 498
    ]);
    // Round 1, param 2 — FAIL (out-of-spec)
    logWs.appendRow([
      sessionId, productCode, batch, 1, tsStr,
      payload.oosParamCode || 'P01',
      payload.oosParamName || 'Seal Strength',
      payload.oosStdValue  || 'min 10 N',
      payload.oosUnit      || 'N',
      payload.oosActual    || 5,
      'FAIL',
      payload.oosRemark    || 'TEST smoke IPQC out-of-spec — safe to archive',
      '00:05:00', timeStr, timeStr, ''
    ]);
    var lr = logWs.getLastRow();
    logWs.getRange(lr, 11).setBackground('#FFEBEE'); // tint FAIL cell red
    return {
      success: true,
      sessionId: sessionId,
      docNo: sessionId,           // alias for parity with other helpers
      paramCode: payload.oosParamCode || 'P01',
      roundNo: 1,
      sessionsRows: 1,
      logRows: 2
    };
  } catch(e) {
    Logger.log('createTestIPQCOutOfSpec failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Sweep _TEST_ARCHIVE: delete rows older than N days (by _ArchivedAt in col 2).
// Default 30 days. Call without args to clean up old smoke residue safely.
// Returns { success, removed, kept }. Header row is never touched.
function clearTestArchive(olderThanDays) {
  try {
    var days = (olderThanDays == null) ? 30 : Number(olderThanDays);
    if (!isFinite(days) || days < 0) return { success: false, error: 'olderThanDays must be a non-negative number' };
    var ss = getSpreadsheet();
    var archive = ss.getSheetByName('_TEST_ARCHIVE');
    if (!archive || archive.getLastRow() < 2) return { success: true, removed: 0, kept: 0 };
    var cutoff = new Date().getTime() - days * 86400000;
    var data = archive.getDataRange().getValues();
    var toDelete = [];
    var kept = 0;
    for (var i = 1; i < data.length; i++) {
      var archivedAt = data[i][1];
      var t = (archivedAt instanceof Date) ? archivedAt.getTime() : new Date(archivedAt).getTime();
      if (isFinite(t) && t < cutoff) toDelete.push(i + 1);
      else kept++;
    }
    for (var j = toDelete.length - 1; j >= 0; j--) archive.deleteRow(toDelete[j]);
    return { success: true, removed: toDelete.length, kept: kept };
  } catch(e) {
    Logger.log('clearTestArchive failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Archive a TEST NCR + its NCR_HISTORY trail in one call.
function archiveTestNCR(docNo) {
  var logResult = archiveTestRows('NCR_LOG', String(docNo), 0);
  // NCR_HISTORY: Timestamp=col1, NCR No=col2 (0-based: 1)
  var histResult = archiveTestRows('NCR_HISTORY', String(docNo), 1);
  return {
    success: logResult.success && histResult.success,
    log: logResult,
    history: histResult
  };
}

// Quick diagnostic readout: return all rows from a diag sheet matching a severity.
// Use after running runPOPDiag_core / others that write to _XXX_DIAG sheets.
function getDiagRows(sheetName, severity) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName(sheetName);
  if (!ws || ws.getLastRow() < 2) return { success: true, rows: [] };
  var data = ws.getDataRange().getValues();
  var sev = (severity || '').toUpperCase();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!sev || String(data[i][3] || '').toUpperCase() === sev) {
      rows.push({ section: data[i][0], check: data[i][1], value: data[i][2], severity: data[i][3] });
    }
  }
  return { success: true, rows: rows };
}
