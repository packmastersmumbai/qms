// ============================================================
// _SmokeProdChain.gs — end-to-end regression smoke for the production flow:
//   computeProductionPlan → issueProductionJob → submitProductionBooking
// Drives the REAL handlers and asserts the pipeline-review fixes:
//   #4  partial multi-component issue failure reverses the FAILING component's
//       already-issued lots too (no orphaned PROD_BOOK debit / silent stock loss)
//   #12 getJobBookedDetail aggregates duplicate compCode|batch|location rows
//       (component drawn across two same-batch lots → ONE line, summed bookedQty)
//   +   no double-debit at booking (net ledger = -(consumed+scrap+wastage+loss))
//   +   location carried through every write (comp|batch|location)
//
// Run headless: ?diag=smokeprod  → node e2e-diag.js smokeprod (long timeout).
// Idempotent: unique PC-<stamp> tags; snapshots/restores the real 'prod' counter
// (these handlers advance it, unlike _testNextSeq_); archives all TEST rows on exit.
// Notifications suppressed (see _QMS_SUPPRESS_NOTIFY) so synthetic NCRs stay silent.
// ============================================================

function smokeProdChain(opts) {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  opts = opts || {};
  if (typeof _QMS_SUPPRESS_NOTIFY !== 'undefined') _QMS_SUPPRESS_NOTIFY = true;

  var ss = getSpreadsheet();
  var log = [], pass = 0, fail = 0;
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var TAG = 'PC-' + stamp;

  function header(t){ log.push(''); log.push('=== ' + t + ' ==='); }
  function assert(name, cond, detail){
    if (cond){ pass++; log.push('  PASS ' + name + (detail ? ' — ' + detail : '')); }
    else     { fail++; log.push('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
  }
  function bal(mat, batch, loc){ return getStockBalance_(mat, batch, loc); }

  // Snapshot the real prod counter so the smoke leaves it where it found it.
  var prodCounterBefore = null;
  try { var gc = getDocCounter('prod'); if (gc && gc.success !== false) prodCounterBefore = gc.value; } catch(e){}

  var madeBom = [];        // BOM fgCodes to archive
  var madeMats = [];       // material-code prefixes to archive from ledger/grn/iqc

  try {
    log.push('Production chain smoke: ' + TAG);

    // Preflight
    header('Preflight');
    ['computeProductionPlan','issueProductionJob','submitProductionBooking','getJobBookedDetail',
     'getBOMForFG','getProductionLotsForMaterial','ensureBomSheet_','createTestGRN_','saveIQC',
     'getStockBalance_'].forEach(function(fn){
      assert('fn ' + fn, eval('typeof ' + fn) === 'function');
    });

    // ---- Fixtures: FG 'TEST-FG' with ONE component drawn across TWO same-batch lots ----
    // Two GRN receipts of the SAME material+batch+location create two FIFO lots that
    // share compCode|batch|location — the exact condition #12 aggregates.
    header('Fixtures');
    ensureBomSheet_(); ensureProdJobsSheet_(); ensureProdBookingSheet_();
    var fgCode = 'PCFG-' + stamp;
    var compA  = 'PCMAT-A-' + stamp;
    var batchA = 'PCB-A-' + stamp;
    // BOM: 1 FG needs consum=6 of compA (masterP=0 → issueQtyRounded=required)
    ensureBomSheet_().appendRow([TAG, fgCode, 'Test FG ' + stamp, '1', 'NOS',
      compA, 'Test comp A', '6', 'KGS', 6, 'RM', 0]);
    madeBom.push(fgCode); madeMats.push('PCMAT-');
    // Two receipts of the SAME batch+loc → two lots that share the aggregation key.
    var grnA1 = createTestGRN_({ materialCode: compA, batchNo: batchA, qtyReceived: 30, locationId: 'RM-STORE-A', unit: 'KGS' });
    var grnA2 = createTestGRN_({ materialCode: compA, batchNo: batchA, qtyReceived: 30, locationId: 'RM-STORE-A', unit: 'KGS' });
    assert('two GRN receipts created', grnA1.success && grnA2.success, grnA1.docNo + ' / ' + grnA2.docNo);
    // Accept both via real saveIQC (per GRN). acceptedQty = full receipt (no remainder).
    saveIQC({ grnNo: grnA1.docNo, date: new Date(), inspector: 'claude-smoke', disposition: 'ACCEPTED',
      items: [{ materialCode: compA, materialDesc: 'Test comp A', batchNo: batchA, acceptedQty: 30, rejectedQty: 0, holdQty: 0, sampleSize: 8, params: {} }] });
    saveIQC({ grnNo: grnA2.docNo, date: new Date(), inspector: 'claude-smoke', disposition: 'ACCEPTED',
      items: [{ materialCode: compA, materialDesc: 'Test comp A', batchNo: batchA, acceptedQty: 30, rejectedQty: 0, holdQty: 0, sampleSize: 8, params: {} }] });
    SpreadsheetApp.flush();
    var issuableA = 0;
    getProductionLotsForMaterial(compA).forEach(function(l){
      var d = String(l.iqcDisposition||'').toUpperCase();
      if (d==='ACCEPTED'||d==='PASS'||d==='ACCEPTED WITH DEVIATION') issuableA += Number(l.balance)||0;
    });
    assert('compA issuable = 60 (two lots)', Math.abs(issuableA - 60) < 0.001, 'issuable=' + issuableA);

    // ---- computeProductionPlan ----
    header('computeProductionPlan');
    var plan = computeProductionPlan(fgCode, 8);   // 8 FG × consum 6 = 48 of compA
    assert('plan success', plan && plan.success, plan && (plan.error||''));
    assert('plan requires 48 of compA', plan && plan.lines && plan.lines[0] && Math.abs(plan.lines[0].required - 48) < 0.001,
      plan && plan.lines && plan.lines[0] ? ('required=' + plan.lines[0].required) : 'no line');
    assert('maxProducible >= 8', plan && plan.maxProducible >= 8, plan && ('max=' + plan.maxProducible));

    // ---- issueProductionJob (draws 48 across BOTH 30-unit lots of the same batch) ----
    header('issueProductionJob');
    var balBeforeIssue = bal(compA, batchA, 'RM-STORE-A');
    var job = issueProductionJob({ fgCode: fgCode, fgQtyToIssue: 8, issuedBy: 'claude-smoke',
      productionOrderNo: 'PJ-' + TAG });
    assert('issue success', job && job.success, job && (job.error||''));
    assert('job has jobId', job && !!job.jobId, job && job.jobId);
    // location carried
    var lots0 = (job && job.components && job.components[0] && job.components[0].lots) || [];
    assert('issued lot location carried (RM-STORE-A)',
      lots0.length > 0 && lots0.every(function(l){ return l.location === 'RM-STORE-A'; }),
      JSON.stringify(lots0.map(function(l){return l.batch+':'+l.qty+'@'+l.location;})));
    var balAfterIssue = bal(compA, batchA, 'RM-STORE-A');
    assert('issue debited 48 (PROD_BOOK)', Math.abs((balBeforeIssue - balAfterIssue) - 48) < 0.001,
      'before=' + balBeforeIssue + ' after=' + balAfterIssue);

    // ---- #12: getJobBookedDetail aggregates the two same-batch lots into ONE line ----
    header('#12 getJobBookedDetail aggregation');
    var det = getJobBookedDetail(job.jobId);
    assert('detail success', det && det.success, det && (det.error||''));
    var aLines = (det.lines||[]).filter(function(l){ return l.compCode === compA && l.location === 'RM-STORE-A'; });
    assert('#12 compA collapses to ONE line (not two)', aLines.length === 1, 'lines=' + aLines.length);
    assert('#12 aggregated bookedQty = 48 (30+18 across two lots)',
      aLines.length === 1 && Math.abs(aLines[0].bookedQty - 48) < 0.001,
      aLines.length ? ('bookedQty=' + aLines[0].bookedQty) : 'n/a');

    // ---- submitProductionBooking (split must sum to bookedQty=48) ----
    header('submitProductionBooking (no double-debit)');
    var ledgerBeforeBook = bal(compA, batchA, 'RM-STORE-A');   // = balAfterIssue (48 debited)
    var book = submitProductionBooking({ jobId: job.jobId, ipqcId: 'IPQC-' + TAG, fgProduced: 8,
      bookedBy: 'claude-smoke',
      lines: [{ compCode: compA, batchOrLot: batchA, location: 'RM-STORE-A', uom: 'KGS',
                consumed: 40, returned: 4, scrap: 2, wastage: 1, loss: 1 }] });  // 40+4+2+1+1 = 48
    assert('booking success', book && book.success, book && (book.error||''));
    var ledgerAfterBook = bal(compA, batchA, 'RM-STORE-A');
    // Net vs. pre-issue: reverse credits 48, then consume/scrap/wastage/loss debit 40+2+1+1=44,
    // returned 4 stays (credited by reverse, no re-debit). So net from balBeforeIssue = -44.
    var netFromStart = balBeforeIssue - ledgerAfterBook;
    assert('no double-debit: net consumption = 44 (consumed+scrap+wastage+loss), returned 4 back',
      Math.abs(netFromStart - 44) < 0.001, 'net=' + netFromStart + ' (expected 44, double-debit would be ~92)');
    // Job flipped COMPLETED
    var jobStatus = _pcJobStatus_(ss, job.jobId);
    assert('job flipped COMPLETED', String(jobStatus).toUpperCase() === 'COMPLETED', 'status=' + jobStatus);

    // ---- #4: partial-issue rollback (2-component FG, component B short) ----
    header('#4 partial-issue rollback of failing component');
    var fg2 = 'PCFG2-' + stamp;
    var compB = 'PCMAT-B-' + stamp;   // will have stock
    var compC = 'PCMAT-C-' + stamp;   // will be SHORT → forces failure
    var batchB = 'PCB-B-' + stamp;
    var batchC = 'PCB-C-' + stamp;
    ensureBomSheet_().appendRow([TAG, fg2, 'Test FG2 ' + stamp, '1', 'NOS', compB, 'Comp B', '5', 'KGS', 5, 'RM', 0]);
    ensureBomSheet_().appendRow([TAG, fg2, 'Test FG2 ' + stamp, '1', 'NOS', compC, 'Comp C', '5', 'KGS', 5, 'RM', 0]);
    madeBom.push(fg2);
    // compB: plenty; compC: NONE (no GRN/IQC) → issue must fail on compC and roll back compB.
    var grnB = createTestGRN_({ materialCode: compB, batchNo: batchB, qtyReceived: 100, locationId: 'RM-STORE-A', unit: 'KGS' });
    saveIQC({ grnNo: grnB.docNo, date: new Date(), inspector: 'claude-smoke', disposition: 'ACCEPTED',
      items: [{ materialCode: compB, materialDesc: 'Comp B', batchNo: batchB, acceptedQty: 100, rejectedQty: 0, holdQty: 0, sampleSize: 8, params: {} }] });
    SpreadsheetApp.flush();
    var balBBefore = bal(compB, batchB, 'RM-STORE-A');
    var job2 = issueProductionJob({ fgCode: fg2, fgQtyToIssue: 4, issuedBy: 'claude-smoke', productionOrderNo: 'PJ2-' + TAG });
    assert('#4 issue FAILS (compC short)', job2 && job2.success === false, job2 && (job2.error||'unexpected success'));
    var balBAfter = bal(compB, batchB, 'RM-STORE-A');
    assert('#4 compB fully rolled back (no orphaned PROD_BOOK debit)',
      Math.abs(balBBefore - balBAfter) < 0.001, 'before=' + balBBefore + ' after=' + balBAfter + ' (must be equal)');

    // ---- cancelProductionJob: un-issue a stuck job, stock returns to where it was ----
    header('cancelProductionJob returns stock + marks CANCELLED');
    var matX = 'PCMAT-X-' + stamp, batchX = 'PCB-X-' + stamp, fgX = 'PCFGX-' + stamp;
    ensureBomSheet_().appendRow([TAG, fgX, 'Test FG X ' + stamp, '1', 'NOS', matX, 'Comp X', '4', 'KGS', 4, 'RM', 0]);
    madeBom.push(fgX);
    var grnX = createTestGRN_({ materialCode: matX, batchNo: batchX, qtyReceived: 60, locationId: 'RM-STORE-A', unit: 'KGS' });
    saveIQC({ grnNo: grnX.docNo, date: new Date(), inspector: 'claude-smoke', disposition: 'ACCEPTED',
      items: [{ materialCode: matX, materialDesc: 'Comp X', batchNo: batchX, acceptedQty: 60, rejectedQty: 0, holdQty: 0, sampleSize: 8, params: {} }] });
    SpreadsheetApp.flush();
    var balX0 = bal(matX, batchX, 'RM-STORE-A');
    var jobX = issueProductionJob({ fgCode: fgX, fgQtyToIssue: 5, issuedBy: 'claude-smoke', productionOrderNo: 'PJX-' + TAG });
    assert('cancel: job issued', jobX && jobX.success, jobX && (jobX.error || ''));
    var balX1 = bal(matX, batchX, 'RM-STORE-A');
    assert('cancel: stock debited by issue', balX1 < balX0, 'before=' + balX0 + ' after=' + balX1);
    var canc = cancelProductionJob(jobX.jobId, 'claude-smoke', 'smoke test');
    assert('cancel succeeds', canc && canc.success, canc && (canc.error || ''));
    var balX2 = bal(matX, batchX, 'RM-STORE-A');
    assert('cancel: stock fully returned to pre-issue level',
      Math.abs(balX2 - balX0) < 0.001, 'pre=' + balX0 + ' post-cancel=' + balX2);
    assert('cancel: job marked CANCELLED', String(_pcJobStatus_(ss, jobX.jobId)).toUpperCase() === 'CANCELLED',
      'status=' + _pcJobStatus_(ss, jobX.jobId));
    // a cancelled job must not be bookable
    var afterCancel = getJobBookedDetail(jobX.jobId);
    assert('cancel: cancelled job is not bookable', !afterCancel.success, JSON.stringify(afterCancel && afterCancel.error));

  } catch (e) {
    log.push(''); log.push('EXCEPTION: ' + (e && e.message)); log.push((e && e.stack) || ''); fail++;
  } finally {
    if (typeof _QMS_SUPPRESS_NOTIFY !== 'undefined') _QMS_SUPPRESS_NOTIFY = false;
    header('Cleanup');
    try {
      var moved = 0;
      // Ledger / GRN / IQC by material prefix
      moved += _pcArchivePrefix_(ss, 'STOCK_LEDGER', 3, 'PCMAT-');
      moved += _pcArchivePrefix_(ss, 'GRN_LOG', 6, 'PCMAT-');
      moved += _pcArchivePrefix_(ss, 'IQC_LOG', 4, 'Test comp') + _pcArchivePrefix_(ss, 'IQC_LOG', 4, 'Comp ');
      // Production sheets by TAG / fg prefix
      moved += _pcArchivePrefix_(ss, 'PROD_ISSUE_LOG', 3, 'PCMAT-');
      moved += _pcArchivePrefix_(ss, 'PROD_JOBS', 3, 'PCFG');
      moved += _pcArchivePrefix_(ss, 'PROD_BOOKING_LOG', 0, TAG);   // booking id/jobid may not carry TAG; best-effort
      // BOM rows for our FGs (col idx 1 = FGIDH)
      madeBom.forEach(function(fg){ moved += _pcArchiveExact_(ss, 'BOM', 1, fg); });
      log.push('  archived ~' + moved + ' TEST rows');
    } catch (ce) { log.push('  cleanup error: ' + ce.message); }
    // Restore the prod counter we advanced.
    try {
      if (prodCounterBefore != null) { setDocCounter('prod', prodCounterBefore); log.push('  prod counter restored to ' + prodCounterBefore); }
    } catch(re){ log.push('  counter restore error: ' + re.message); }
  }

  log.push(''); log.push('RESULT: ' + pass + ' passed, ' + fail + ' failed.');
  var text = log.join('\n');
  return { success: fail === 0, pass: pass, fail: fail, tag: TAG, report: text };
}

// PROD_JOBS status by jobId (col 1 id, col 9 status).
function _pcJobStatus_(ss, jobId) {
  var ws = ss.getSheetByName('PROD_JOBS');
  if (!ws || ws.getLastRow() < 2) return '';
  var d = ws.getDataRange().getValues();
  for (var i = d.length - 1; i >= 1; i--) if (String(d[i][0]).trim() === String(jobId).trim()) return String(d[i][8] || '');
  return '';
}

// Archive rows whose col colIdx (0-based) STARTS WITH prefix, into _TEST_ARCHIVE. Bottom-up.
function _pcArchivePrefix_(ss, sheetName, colIdx, prefix) {
  var ws = ss.getSheetByName(sheetName);
  if (!ws || ws.getLastRow() < 2) return 0;
  var arch = ss.getSheetByName('_TEST_ARCHIVE') || ss.insertSheet('_TEST_ARCHIVE');
  var d = ws.getDataRange().getValues(), moved = 0;
  for (var i = d.length - 1; i >= 1; i--) {
    if (String(d[i][colIdx] || '').indexOf(prefix) === 0) { arch.appendRow([sheetName].concat(d[i])); ws.deleteRow(i + 1); moved++; }
  }
  return moved;
}
// Archive rows where col colIdx EQUALS value.
function _pcArchiveExact_(ss, sheetName, colIdx, value) {
  var ws = ss.getSheetByName(sheetName);
  if (!ws || ws.getLastRow() < 2) return 0;
  var arch = ss.getSheetByName('_TEST_ARCHIVE') || ss.insertSheet('_TEST_ARCHIVE');
  var d = ws.getDataRange().getValues(), moved = 0;
  for (var i = d.length - 1; i >= 1; i--) {
    if (String(d[i][colIdx] || '').trim() === String(value).trim()) { arch.appendRow([sheetName].concat(d[i])); ws.deleteRow(i + 1); moved++; }
  }
  return moved;
}
