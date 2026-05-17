// _TestHelpers.js — bypass docNumber counters so smoke tests don't leave gaps
// in audit-numbered sequences. All test rows use TEST/<TYPE>/<YYYY>-<NN> docNos
// and can be moved to _TEST_ARCHIVE via archiveTestRows() after the test.

function _testNextSeq_(prefix) {
  // Walks _TEST_ARCHIVE + live NCR_LOG to find the next free TEST/<TYPE>/<YYYY>-NN.
  var ss = getSpreadsheet();
  var year = new Date().getFullYear();
  var max = 0;
  var sheets = ['NCR_LOG', 'OQC_LOG', '_TEST_ARCHIVE'];
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
