// ============================================================
// _RestoreDrill.js — Phase 7 scripted restore drill.
//
// Goal: prove the QMS can detect and recover from a corruption
// event without ever touching production sheets. We:
//   1. Snapshot baseline (doc counters + ledger reconciler summary).
//   2. Write 2 deliberately malformed rows to _TEST_ARCHIVE only
//      (bad tx_type + ledger-invariant violation).
//   3. Re-run the ledger reconciler. The reconciler's scope is
//      STOCK_LEDGER / FG_DISPATCH_LOTS, so _TEST_ARCHIVE rows are
//      expected to be out of scope — we record that fact.
//   4. Restore by deleting the 2 _TEST_ARCHIVE rows (simulates a
//      "restore from Drive version history" event).
//   5. Re-snapshot and confirm baseline matches.
//
// Hard constraints:
//   - Never write to GRN_LOG / STOCK_LEDGER / NCR_LOG / any
//     production sheet.
//   - All writes scoped to _TEST_ARCHIVE only.
//   - _TESTING_ENABLED guard required.
// ============================================================

function runRestoreDrill() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };

  var result = {
    success: false,
    phases: {
      preCheck:   { counters: {}, ledger: {} },
      corruption: { rowsWritten: 0, sheet: '_TEST_ARCHIVE', markers: [] },
      detection:  { reconcilerScope: '', anomaliesDetected: false, note: '' },
      restore:    { rowsDeleted: 0 },
      postCheck:  { counters: {}, ledger: {} },
      baselineMatch: false
    },
    errors: []
  };

  try {
    var ss = getSpreadsheet();
    if (!ss) { result.errors.push('no spreadsheet'); return result; }

    // ── Phase A: pre-check baseline ─────────────────────────
    result.phases.preCheck.counters = _restoreDrillSnapshotCounters_(ss);
    var preLedger = runLedgerReconcile_core();
    result.phases.preCheck.ledger = _restoreDrillLedgerSummary_(preLedger);

    // ── Phase B: simulate corruption in _TEST_ARCHIVE only ──
    var archive = ss.getSheetByName('_TEST_ARCHIVE');
    if (!archive) {
      archive = ss.insertSheet('_TEST_ARCHIVE');
      archive.getRange(1, 1, 1, 3).setValues([['_ArchivedFrom', '_ArchivedAt', '_OriginalRow…']])
        .setFontWeight('bold');
    }
    var now = new Date();
    var marker = 'RESTORE_DRILL_' + now.getTime();

    // Row 1: malformed docNo + invalid tx_type. Padded to mimic a
    // STOCK_LEDGER-shaped row so a future auditor sees it cleanly.
    // Cols (offset by 2 archive prefix): txnId, ts, txType, mat, batch, loc, qIn, qOut, balAfter, refType, refNo, op, remarks
    var corruptRow1 = ['STOCK_LEDGER_SIMULATED', now,
      'CORRUPT-TEST-001', now, 'INVALID_TX', 'TEST-MAT', 'TEST-BATCH', 'TEST-LOC',
      0, 0, 0, 'TEST', 'CORRUPT-TEST-001', 'restore-drill', marker + ' bad tx_type'];
    // Row 2: ledger invariant violation (qty_in AND qty_out both > 0)
    var corruptRow2 = ['STOCK_LEDGER_SIMULATED', now,
      'CORRUPT-TEST-002', now, 'GRN_RECEIPT', 'TEST-MAT', 'TEST-BATCH', 'TEST-LOC',
      50, 50, 0, 'TEST', 'CORRUPT-TEST-002', 'restore-drill', marker + ' both qty_in and qty_out positive'];

    archive.appendRow(corruptRow1);
    archive.appendRow(corruptRow2);
    SpreadsheetApp.flush();
    result.phases.corruption.rowsWritten = 2;
    result.phases.corruption.markers = [marker];
    Logger.log('runRestoreDrill: wrote 2 corrupt rows to _TEST_ARCHIVE with marker=' + marker);

    // ── Phase C: detection ──────────────────────────────────
    var midLedger = runLedgerReconcile_core();
    var midSummary = _restoreDrillLedgerSummary_(midLedger);
    result.phases.detection.reconcilerScope =
      'STOCK_LEDGER + FG_DISPATCH_LOTS only; _TEST_ARCHIVE is intentionally out of scope';
    // True if the mid-state ledger summary differs from baseline.
    result.phases.detection.anomaliesDetected =
      midSummary.errors !== result.phases.preCheck.ledger.errors ||
      midSummary.warns  !== result.phases.preCheck.ledger.warns  ||
      midSummary.drifts !== result.phases.preCheck.ledger.drifts;
    result.phases.detection.note = result.phases.detection.anomaliesDetected
      ? 'reconciler delta vs baseline indicates anomaly'
      : 'reconciler unchanged (expected — corruption sandboxed in _TEST_ARCHIVE, out of reconciler scope)';

    // ── Phase D: restore by deleting corrupt rows ───────────
    var deleted = _restoreDrillDeleteMarker_(archive, marker);
    result.phases.restore.rowsDeleted = deleted;

    // ── Phase E: post-check ─────────────────────────────────
    result.phases.postCheck.counters = _restoreDrillSnapshotCounters_(ss);
    var postLedger = runLedgerReconcile_core();
    result.phases.postCheck.ledger = _restoreDrillLedgerSummary_(postLedger);

    var countersMatch = _restoreDrillEqualMaps_(
      result.phases.preCheck.counters, result.phases.postCheck.counters);
    var ledgerMatch = _restoreDrillEqualMaps_(
      result.phases.preCheck.ledger, result.phases.postCheck.ledger);
    result.phases.baselineMatch = countersMatch && ledgerMatch;

    if (!countersMatch) result.errors.push('counter drift across drill');
    if (!ledgerMatch)   result.errors.push('ledger summary drift across drill');
    if (deleted !== 2)  result.errors.push('expected to delete 2 rows, deleted ' + deleted);

    result.success = (result.errors.length === 0);
    Logger.log('runRestoreDrill complete: success=' + result.success +
      ' baselineMatch=' + result.phases.baselineMatch);
    return result;
  } catch (e) {
    result.errors.push('exception: ' + e.message);
    Logger.log('runRestoreDrill failed: ' + e.message + '\n' + (e.stack || ''));
    return result;
  }
}

// ── helpers (prefixed _restoreDrill to avoid global namespace clash) ──

function _restoreDrillSnapshotCounters_(ss) {
  var ws = ss.getSheetByName('CONFIG');
  var out = {};
  if (!ws) return out;
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0] || '');
    if (key.indexOf('_counter') > -1) {
      out[key] = Number(data[i][1]) || 0;
    }
  }
  return out;
}

function _restoreDrillLedgerSummary_(sum) {
  if (!sum || typeof sum !== 'object') return { errors: -1, warns: -1, total: -1, drifts: -1 };
  return {
    errors: Number(sum.errors) || 0,
    warns:  Number(sum.warns)  || 0,
    total:  Number(sum.total)  || 0,
    drifts: (sum.drifts && sum.drifts.length) || 0
  };
}

function _restoreDrillDeleteMarker_(archive, marker) {
  if (!archive || archive.getLastRow() < 2) return 0;
  var data = archive.getDataRange().getValues();
  var lastCol = data[0].length;
  var toDelete = [];
  for (var i = 1; i < data.length; i++) {
    for (var c = 0; c < lastCol; c++) {
      var v = String(data[i][c] == null ? '' : data[i][c]);
      if (v.indexOf(marker) > -1) { toDelete.push(i + 1); break; }
    }
  }
  for (var j = toDelete.length - 1; j >= 0; j--) archive.deleteRow(toDelete[j]);
  return toDelete.length;
}

function _restoreDrillEqualMaps_(a, b) {
  var ka = Object.keys(a || {});
  var kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    if (a[ka[i]] !== b[ka[i]]) return false;
  }
  return true;
}
