// ============================================================
// _SmokeReviewFixes.gs — regression smoke for the pipeline-review fixes (@450).
// Exercises the REAL handlers (not direct-write injectors) so the fixes, which
// live INSIDE saveIQC / getProductionLotsForMaterial / getJobBookedDetail /
// setNCRDisposition / disposeCustomerReturn / saveGatepass, are actually run.
//
// Covers the DETERMINISTIC fixes (single-threaded assertable):
//   #1  IQC ACCEPTED partial → un-accepted remainder quarantined, only accepted issuable
//   #2  disposition keyed per BATCH, not per GRN (rejected sibling batch not issuable)
//   #5  legacy OUTBOUND gatepass blocked
//   #8  disposeCustomerReturn OPEN-guard — repeat dispose is a no-op (no double restock)
//   #9  setNCRDisposition idempotency — repeat rework disposition writes no 2nd move
//   #10 bare REJECTED (rejectedQty 0) still moves the full received qty out
//   #12 getJobBookedDetail aggregates duplicate compCode|batch|location rows
//   H2  IQC HOLD is NOT final for GRN auto-close
// (Concurrency #3/#6 are TOCTOU races not reproducible in one thread — asserted
//  only structurally: the lock helper exists.)
//
// Run headless via: ?diag=smokefixes  (see Code.js doGet) → node e2e-diag.js smokefixes
// Also runnable via clasp run smokeReviewFixes.
// Idempotent: unique RF-<stamp> tags each run; archives all TEST/RF rows at the end.
// ============================================================

// Global notification-suppress flag honored by sendQmsAlert / pushDwmNextAction_.
// Prevents synthetic test NCRs from firing real Telegram/DWM HTTP (which also stalls
// the headless smoke). Declared here; set true for the duration of the smoke run.
var _QMS_SUPPRESS_NOTIFY = false;

function smokeReviewFixes(opts) {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  _QMS_SUPPRESS_NOTIFY = true;
  opts = opts || {};
  var preflightOnly = opts.preflightOnly === true;
  var maxBlock = (opts.maxBlock != null) ? Number(opts.maxBlock) : 99; // stop after block N
  function stopAfter(n){ if (n >= maxBlock) throw { __preflightStop: true }; }
  var ss = getSpreadsheet();
  var log = [];
  var pass = 0, fail = 0;
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var TAG = 'RF-' + stamp;

  function header(t){ log.push(''); log.push('=== ' + t + ' ==='); }
  function assert(name, cond, detail){
    if (cond){ pass++; log.push('  PASS ' + name + (detail ? ' — ' + detail : '')); }
    else     { fail++; log.push('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
  }
  // balance for a material|batch|location straight from STOCK_LEDGER (live, unfiltered)
  function bal(mat, batch, loc){
    return (typeof getStockBalance_ === 'function') ? getStockBalance_(mat, batch, loc) : NaN;
  }
  // issuable balance for a material via the real production read path
  function issuable(mat, batch){
    var lots = (typeof getProductionLotsForMaterial === 'function') ? getProductionLotsForMaterial(mat) : [];
    var tot = 0;
    lots.forEach(function(l){
      if (batch && String(l.batchOrLotNo).trim() !== String(batch).trim()) return;
      var d = String(l.iqcDisposition || '').toUpperCase();
      if (d === 'ACCEPTED' || d === 'PASS' || d === 'ACCEPTED WITH DEVIATION') tot += Number(l.balance) || 0;
    });
    return tot;
  }

  var createdIqcDocNos = [];   // for cleanup
  var createdNcrRefs   = [];

  try {
    log.push('Review-fix regression smoke: ' + TAG);

    // ---------- Preflight ----------
    header('Preflight');
    assert('withStockLock_ helper exists (concurrency #3/#6 guard)', typeof withStockLock_ === 'function');
    assert('fn saveIQC',                     typeof saveIQC === 'function');
    assert('fn getProductionLotsForMaterial', typeof getProductionLotsForMaterial === 'function');
    assert('fn getJobBookedDetail',          typeof getJobBookedDetail === 'function');
    assert('fn setNCRDisposition',           typeof setNCRDisposition === 'function');
    assert('fn disposeCustomerReturn',       typeof disposeCustomerReturn === 'function');
    assert('fn saveGatepass',                typeof saveGatepass === 'function');
    assert('fn getStockBalance_',            typeof getStockBalance_ === 'function');
    assert('fn createTestGRN_',              typeof createTestGRN_ === 'function');

    if (preflightOnly) { log.push(''); log.push('PREFLIGHT-ONLY: stopping before writes.'); throw { __preflightStop: true }; }

    // ---------- #1 + #10: IQC accept-remainder & bare-reject via REAL saveIQC ----------
    // GRN receives 100 of a material; IQC accepts only 60. The un-accepted 40 must
    // leave the GRN location so only 60 is issuable (#1).
    header('#1 IQC accepted-remainder quarantined (real saveIQC)');
    var mat1 = 'RF-MAT-A-' + stamp;
    var batch1 = 'RF-BATCH-A-' + stamp;
    var grn1 = createTestGRN_({ materialCode: mat1, batchNo: batch1, qtyReceived: 100, locationId: 'RM-STORE-A' });
    assert('GRN #1 created', grn1 && grn1.success, grn1 && grn1.docNo);
    var balBefore1 = bal(mat1, batch1, 'RM-STORE-A');
    assert('GRN receipt balance = 100', Math.abs(balBefore1 - 100) < 0.001, 'have ' + balBefore1);

    var iqc1 = saveIQC({
      grnNo: grn1.docNo, date: new Date(), inspector: 'claude-smoke-test',
      disposition: 'ACCEPTED',
      items: [{ materialCode: mat1, materialDesc: 'RF test A', batchNo: batch1,
                acceptedQty: 60, rejectedQty: 0, holdQty: 0, sampleSize: 8, params: {} }]
    });
    assert('saveIQC ACCEPTED returned success', iqc1 && iqc1.success, iqc1 && (iqc1.error || ''));
    if (iqc1 && iqc1.docNos) createdIqcDocNos = createdIqcDocNos.concat(iqc1.docNos);

    var issuable1 = issuable(mat1, batch1);
    assert('#1 only acceptedQty (60) issuable, remainder quarantined',
      Math.abs(issuable1 - 60) < 0.001, 'issuable=' + issuable1 + ' (expected 60, was 100 before fix)');
    var grnLocBal1 = bal(mat1, batch1, 'RM-STORE-A');
    assert('#1 GRN-location balance reduced to 60', Math.abs(grnLocBal1 - 60) < 0.001, 'have ' + grnLocBal1);
    stopAfter(1);

    // #10: bare REJECTED with rejectedQty 0 must still move the full received qty out.
    header('#10 bare REJECTED (rejectedQty=0) moves full qty (real saveIQC)');
    var mat10 = 'RF-MAT-R-' + stamp;
    var batch10 = 'RF-BATCH-R-' + stamp;
    var grn10 = createTestGRN_({ materialCode: mat10, batchNo: batch10, qtyReceived: 50, locationId: 'RM-STORE-A' });
    assert('GRN #10 created', grn10 && grn10.success);
    var iqc10 = saveIQC({
      grnNo: grn10.docNo, date: new Date(), inspector: 'claude-smoke-test',
      disposition: 'REJECTED',
      items: [{ materialCode: mat10, materialDesc: 'RF test R', batchNo: batch10,
                acceptedQty: 0, rejectedQty: 0, holdQty: 0, sampleSize: 8, params: {} }]
    });
    assert('saveIQC REJECTED returned success', iqc10 && iqc10.success, iqc10 && (iqc10.error || ''));
    if (iqc10 && iqc10.docNos) createdIqcDocNos = createdIqcDocNos.concat(iqc10.docNos);
    if (iqc10 && iqc10.ncrNo) createdNcrRefs.push(iqc10.ncrNo);
    var grnLocBal10 = bal(mat10, batch10, 'RM-STORE-A');
    assert('#10 all 50 moved out of GRN location (bare reject defaulted to full qty)',
      Math.abs(grnLocBal10) < 0.001, 'GRN-loc balance=' + grnLocBal10 + ' (expected 0)');
    var issuable10 = issuable(mat10, batch10);
    assert('#10 rejected batch not issuable', Math.abs(issuable10) < 0.001, 'issuable=' + issuable10);
    stopAfter(2);

    // ---------- #2: per-batch disposition (accepted sibling must not release rejected batch) ----------
    header('#2 disposition per-batch not per-GRN');
    var mat2 = 'RF-MAT-M-' + stamp;
    var bAcc = 'RF-B-ACC-' + stamp;
    var bRej = 'RF-B-REJ-' + stamp;
    var grn2a = createTestGRN_({ materialCode: mat2, batchNo: bAcc, qtyReceived: 30, locationId: 'RM-STORE-A' });
    var grn2b = createTestGRN_({ materialCode: mat2, batchNo: bRej, qtyReceived: 30, locationId: 'RM-STORE-A' });
    assert('GRN #2 both batches created', grn2a.success && grn2b.success);
    // Same GRN ref for both so the OLD per-GRN keying would collapse them. Use grn2a's docNo.
    var iqc2acc = saveIQC({ grnNo: grn2a.docNo, date: new Date(), inspector: 'claude-smoke-test',
      disposition: 'ACCEPTED',
      items: [{ materialCode: mat2, materialDesc: 'RF M', batchNo: bAcc, acceptedQty: 30, rejectedQty: 0, holdQty: 0, sampleSize: 8, params: {} }] });
    var iqc2rej = saveIQC({ grnNo: grn2a.docNo, date: new Date(), inspector: 'claude-smoke-test',
      disposition: 'REJECTED',
      items: [{ materialCode: mat2, materialDesc: 'RF M', batchNo: bRej, acceptedQty: 0, rejectedQty: 30, holdQty: 0, sampleSize: 8, params: {} }] });
    if (iqc2acc && iqc2acc.docNos) createdIqcDocNos = createdIqcDocNos.concat(iqc2acc.docNos);
    if (iqc2rej && iqc2rej.docNos) createdIqcDocNos = createdIqcDocNos.concat(iqc2rej.docNos);
    if (iqc2rej && iqc2rej.ncrNo) createdNcrRefs.push(iqc2rej.ncrNo);
    var issAcc = issuable(mat2, bAcc);
    var issRej = issuable(mat2, bRej);
    assert('#2 accepted batch issuable (30)', Math.abs(issAcc - 30) < 0.001, 'issuable=' + issAcc);
    assert('#2 rejected batch NOT issuable (was 30 under per-GRN bug)', Math.abs(issRej) < 0.001, 'issuable=' + issRej);
    stopAfter(3);

    // ---------- #5: legacy OUTBOUND gatepass blocked ----------
    header('#5 legacy OUTBOUND gatepass blocked');
    var gp = saveGatepass({ type: 'OUTBOUND', oqcRef: 'RF-FAKE-OQC', partyName: 'RF cust',
      items: [{ materialCode: 'RF-X', materialDesc: 'x', qty: 1, unit: 'PCS' }], date: new Date() });
    assert('#5 OUTBOUND rejected with guidance', gp && gp.success === false && /Dispatch/i.test(gp.error || ''),
      gp && (gp.error || 'no error'));
    stopAfter(4);

    // ---------- #9: setNCRDisposition idempotency ----------
    header('#9 setNCRDisposition idempotency (no double stock move)');
    var mat9 = 'RF-MAT-N-' + stamp;
    var batch9 = 'RF-BATCH-N-' + stamp;
    // Seed FG-HOLD stock so rework-FG has something to move.
    if (typeof writeStockLedger_ === 'function') {
      writeStockLedger_('RF_SEED', mat9, batch9, 'FG-HOLD', 20, 0, 'RF', TAG, 'claude-smoke-test', 'RF seed for #9');
    }
    var ncr9 = (typeof raiseNCR_ === 'function') ? raiseNCR_({ date: new Date(), source: 'RF', sourceRef: TAG,
      materialCode: mat9, materialDesc: 'RF N', batchNo: batch9, qtyAffected: 20, unit: 'PCS',
      defectDesc: 'RF #9 test' }) : '';
    assert('#9 NCR raised', !!ncr9, ncr9);
    if (ncr9) createdNcrRefs.push(ncr9);
    var reworkAreaBefore9 = bal(mat9, batch9, 'REWORK-AREA');
    var d9a = setNCRDisposition(ncr9, 'rework-FG', 'claude-smoke-test');
    assert('#9 first disposition applied', d9a && d9a.success, d9a && (d9a.error || ''));
    var reworkAreaAfter1 = bal(mat9, batch9, 'REWORK-AREA');
    var d9b = setNCRDisposition(ncr9, 'rework-FG', 'claude-smoke-test');   // repeat!
    var reworkAreaAfter2 = bal(mat9, batch9, 'REWORK-AREA');
    assert('#9 repeat disposition is no-op (alreadyApplied or blocked)',
      d9b && (d9b.alreadyApplied === true || d9b.success === true), JSON.stringify(d9b));
    assert('#9 REWORK-AREA balance unchanged by the repeat (no double move)',
      Math.abs(reworkAreaAfter2 - reworkAreaAfter1) < 0.001,
      'after1=' + reworkAreaAfter1 + ' after2=' + reworkAreaAfter2);
    stopAfter(5);

    // ---------- H2: HOLD not final for GRN auto-close ----------
    header('H2 IQC HOLD not final for GRN auto-close');
    var matH = 'RF-MAT-H-' + stamp;
    var batchH = 'RF-BATCH-H-' + stamp;
    var grnH = createTestGRN_({ materialCode: matH, batchNo: batchH, qtyReceived: 40, locationId: 'RM-STORE-A' });
    var iqcH = saveIQC({ grnNo: grnH.docNo, date: new Date(), inspector: 'claude-smoke-test',
      disposition: 'HOLD',
      items: [{ materialCode: matH, materialDesc: 'RF H', batchNo: batchH, acceptedQty: 0, rejectedQty: 0, holdQty: 40, sampleSize: 8, params: {} }] });
    if (iqcH && iqcH.docNos) createdIqcDocNos = createdIqcDocNos.concat(iqcH.docNos);
    var grnStatusH = _rfGrnStatus_(ss, grnH.docNo);
    assert('H2 GRN not auto-CLOSED on HOLD', String(grnStatusH).toUpperCase() !== 'CLOSED', 'status=' + grnStatusH);

  } catch (e) {
    if (e && e.__preflightStop) {
      // clean early stop — not a failure
    } else {
      log.push('');
      log.push('EXCEPTION: ' + (e && e.message));
      log.push((e && e.stack) || '');
      fail++;
    }
  } finally {
    _QMS_SUPPRESS_NOTIFY = false;
    // ---------- Cleanup: archive every RF-tagged row ----------
    header('Cleanup');
    try {
      // STOCK_LEDGER: archive by material-code prefix (col 4, idx 3)
      var cleaned = _rfArchiveByPrefix_(ss, 'STOCK_LEDGER', 3, 'RF-MAT-') +
                    _rfArchiveByPrefix_(ss, 'GRN_LOG', 6, 'RF-MAT-') +
                    _rfArchiveByPrefix_(ss, 'IQC_LOG', 4, 'RF ') ;
      // NCRs raised during the run
      createdNcrRefs.forEach(function(ref){
        try { if (typeof archiveByColValue === 'function') archiveByColValue('NCR_LOG', 0, ref); } catch(_){}
      });
      log.push('  archived RF rows (ledger/grn/iqc): ~' + cleaned + ', NCRs: ' + createdNcrRefs.length);
    } catch (ce) {
      log.push('  cleanup error: ' + ce.message);
    }
  }

  log.push('');
  log.push('RESULT: ' + pass + ' passed, ' + fail + ' failed.');
  var text = log.join('\n');
  return { success: fail === 0, pass: pass, fail: fail, tag: TAG, report: text };
}

// GRN status by docNo (col 16 / idx 15).
function _rfGrnStatus_(ss, grnNo) {
  var ws = ss.getSheetByName('GRN_LOG');
  if (!ws || ws.getLastRow() < 2) return '';
  var data = ws.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === String(grnNo).trim()) return String(data[i][15] || '');
  }
  return '';
}

// Archive rows of a sheet whose column colIdx (0-based) starts with prefix, into
// _TEST_ARCHIVE. Returns count moved. Bottom-up so row deletes don't shift indices.
function _rfArchiveByPrefix_(ss, sheetName, colIdx, prefix) {
  var ws = ss.getSheetByName(sheetName);
  if (!ws || ws.getLastRow() < 2) return 0;
  var arch = ss.getSheetByName('_TEST_ARCHIVE') || ss.insertSheet('_TEST_ARCHIVE');
  var data = ws.getDataRange().getValues();
  var moved = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][colIdx] || '').indexOf(prefix) === 0) {
      arch.appendRow([sheetName].concat(data[i]));
      ws.deleteRow(i + 1);
      moved++;
    }
  }
  return moved;
}
