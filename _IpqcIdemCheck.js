// Proves the IPQC saveRound idempotency guard blocks a retry.
//   ?diag=ipqcidem              → dry run (reports what it WOULD do)
//   ?diag=ipqcidem&confirm=YES  → really runs, then cleans up after itself
//
// Modelled on ?diag=iqcidem. Necessary because e2e-savepaths CANNOT see this
// key: it inspects only the FIRST argument of the write call
// (e2e-savepaths.js:862, `Object.keys(payload)`), and saveRound's signature is
// saveRound(sessionId, roundData) — the key lives in the second. The suite will
// keep reporting "IPQC txn-key NO" even when the guard is present and working,
// so this diag is the only evidence either way.
//
// What it does: opens a throwaway session, calls saveRound TWICE with the same
// clientTxnId, and asserts the second call is deduped — same round number, no
// new IPQC_LOG rows, duplicate:true. Then deletes every row it created.
function checkIpqcIdempotency(apply) {
  var out = ['IPQC IDEMPOTENCY SELF-TEST — ' + (apply ? 'LIVE' : 'DRY RUN'), ''];

  if (typeof saveRound !== 'function') return 'FAIL: saveRound missing.';
  if (typeof startSession !== 'function') return 'FAIL: startSession missing.';

  var ss = getSpreadsheet();
  var logWs  = ss.getSheetByName('IPQC_LOG');
  var sessWs = ss.getSheetByName('IPQC_Sessions');
  if (!logWs || !sessWs) return 'FAIL: IPQC_LOG or IPQC_Sessions missing.';

  // A unique batch per run: startSession rejects a repeat product+batch
  // (IPQC.js), which is exactly what made a fixed batch pass once and skip
  // forever in the e2e driver.
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var batch = 'IDEM-' + stamp;
  var txn   = 'IPQC-SELFTEST-' + stamp;

  out.push('product: IDEM-SELFTEST   batch: ' + batch);
  out.push('txn key: ' + txn);
  out.push('');

  if (!apply) {
    out.push('Would: startSession, saveRound(txn) twice, assert dedupe, delete all rows.');
    out.push('DRY RUN — re-run with &confirm=YES.');
    return out.join('\n');
  }

  var rowsBefore = logWs.getLastRow();
  var sessBefore = sessWs.getLastRow();
  var sessionId = '';

  try {
    var st = startSession({
      productCode: 'IDEM-SELFTEST', productName: 'Idempotency self-test',
      batch: batch, inspector: 'SELFTEST', line: 'SELFTEST'
    });
    sessionId = String((st && (st.sessionId || st.session_id)) || '').trim();
    if (!sessionId) {
      out.push('FAIL: startSession returned no sessionId: ' + JSON.stringify(st));
      return out.join('\n');
    }
    out.push('session: ' + sessionId);

    var round = {
      clientTxnId: txn,
      productCode: 'IDEM-SELFTEST',
      batch: batch,
      params: [
        { paramCode: 'SELFTEST-1', paramName: 'Self test param', stdValue: '1',
          unit: 'NOS', actualValue: '1', result: 'PASS', remark: 'idempotency probe' }
      ],
      elapsedHms: '00:00'
    };

    var r1 = saveRound(sessionId, round);
    var afterFirst = logWs.getLastRow();
    var r2 = saveRound(sessionId, round);          // same txn — must be deduped
    var afterSecond = logWs.getLastRow();

    out.push('');
    out.push('call 1: ok=' + (r1 && r1.ok) + '  roundNo=' + (r1 && r1.roundNo) +
             '  duplicate=' + !!(r1 && r1.duplicate));
    out.push('call 2: ok=' + (r2 && r2.ok) + '  roundNo=' + (r2 && r2.roundNo) +
             '  duplicate=' + !!(r2 && r2.duplicate));
    out.push('IPQC_LOG rows: before=' + rowsBefore + '  after 1st=' + afterFirst +
             '  after 2nd=' + afterSecond);
    out.push('');

    var wroteOnce   = (afterFirst - rowsBefore) === round.params.length;
    var wroteTwice  = (afterSecond - afterFirst) > 0;
    var sameRound   = r1 && r2 && Number(r1.roundNo) === Number(r2.roundNo);
    var flagged     = !!(r2 && r2.duplicate);

    if (!wroteOnce)      out.push('  !! first call did not write ' + round.params.length + ' row(s)');
    if (wroteTwice)      out.push('  !! SECOND CALL WROTE ' + (afterSecond - afterFirst) + ' MORE ROW(S) — guard failed');
    if (!sameRound)      out.push('  !! round numbers differ: ' + (r1 && r1.roundNo) + ' vs ' + (r2 && r2.roundNo));
    if (!flagged)        out.push('  !! second call did not report duplicate:true');

    out.push('');
    out.push((wroteOnce && !wroteTwice && sameRound && flagged)
      ? 'VERDICT: PASS — the retry was deduped; no extra round, no extra rows.'
      : 'VERDICT: FAIL');

  } catch (e) {
    out.push('ERROR: ' + e.message);
  } finally {
    // Clean up unconditionally — a self-test must not leave inspection records
    // behind. Deletes bottom-up so earlier indices stay valid.
    try {
      var lv = logWs.getDataRange().getValues();
      for (var i = lv.length - 1; i >= 1; i--) {
        if (String(lv[i][0]).trim() === sessionId) logWs.deleteRow(i + 1);
      }
      var sv = sessWs.getDataRange().getValues();
      for (var j = sv.length - 1; j >= 1; j--) {
        if (String(sv[j][0]).trim() === sessionId) sessWs.deleteRow(j + 1);
      }
      out.push('');
      out.push('cleanup: IPQC_LOG ' + logWs.getLastRow() + ' rows (was ' + rowsBefore +
               '), IPQC_Sessions ' + sessWs.getLastRow() + ' (was ' + sessBefore + ')');
      if (logWs.getLastRow() !== rowsBefore || sessWs.getLastRow() !== sessBefore) {
        out.push('  !! CLEANUP INCOMPLETE — remove session ' + sessionId + ' by hand.');
      }
    } catch (ec) { out.push('cleanup ERROR: ' + ec.message + ' — session ' + sessionId); }
  }

  return out.join('\n');
}
