// Self-test for the issue-plan UoM coherence guard.  ?diag=uomguard — READ-ONLY.
//
// The guard refuses to issue a production job when a component's BOM Comp UoM
// disagrees with its MASTERS_Materials Unit, because `required = consum × qty`
// is then in the BOM's unit while the STOCK_LEDGER balance it is compared
// against is in the master's — the subtraction is meaningless and the debit
// would move a number nobody computed correctly.
//
// A guard nobody has seen fire is a guard nobody should trust, so this walks
// every FG in the BOM, reports which ones carry a mismatched component, and
// then actually calls issueProductionJob on one to prove it is REFUSED. The
// call is expected to fail — that is the pass condition. It never reaches a
// write: the guard returns before LockService is acquired.
function checkUomGuard() {
  var out = ['ISSUE-PLAN UoM GUARD SELF-TEST (read-only)', ''];

  if (typeof prodUomMismatch_ !== 'function') {
    return 'FAIL: prodUomMismatch_ missing (is ProductionReadCache.js pushed?)';
  }

  var rows;
  try { rows = getBomRows_(); } catch (e) { return 'FAIL: getBomRows_: ' + e.message; }
  if (!rows || !rows.length) return 'FAIL: BOM read returned no rows.';

  // Which components disagree, and which FGs are therefore unissuable?
  var badComp = {}, fgWithBad = {};
  rows.forEach(function (r) {
    var masterUnit = prodUomMismatch_(r.compCode, r.compUom);
    if (!masterUnit) return;
    badComp[r.compCode] = { bom: r.compUom, master: masterUnit };
    (fgWithBad[r.fgCode] = fgWithBad[r.fgCode] || {})[r.compCode] = true;
  });

  var compCodes = Object.keys(badComp);
  var fgCodes = Object.keys(fgWithBad);
  out.push('components with a BOM/master unit disagreement: ' + compCodes.length);
  compCodes.forEach(function (c) {
    out.push('  !! ' + c + '   BOM="' + badComp[c].bom + '"  master="' + badComp[c].master + '"');
  });
  out.push('');
  out.push('FGs that therefore cannot be issued: ' + fgCodes.length);
  fgCodes.forEach(function (f) {
    out.push('  ' + f + '   via ' + Object.keys(fgWithBad[f]).join(', '));
  });
  out.push('');

  // Does computeProductionPlan flag it per line?
  if (fgCodes.length) {
    var plan = computeProductionPlan(fgCodes[0], 1);
    var flagged = [];
    if (!plan.success) {
      out.push('plan for ' + fgCodes[0] + ': could not compute (' + plan.error + ')');
    } else {
      flagged = (plan.lines || []).filter(function (l) { return l.uomMismatch; });
      out.push('plan for ' + fgCodes[0] + ': ' + flagged.length +
               ' of ' + plan.lines.length + ' lines flagged uomMismatch');
      if (!flagged.length) out.push('  !! EXPECTED at least one flagged line');
    }

    // The real assertion: the write path must REFUSE.
    //
    // SAFETY: only call this when the plan actually carries a mismatch. If it
    // does, the guard returns before LockService is acquired and nothing is
    // written. Calling it on a CLEAN plan would perform a real stock issue —
    // so refuse to run rather than risk debiting live stock for a test.
    if (!flagged || !flagged.length) {
      out.push('');
      out.push('SKIPPED the write-path assertion: no flagged line on this FG, so ' +
               'calling issueProductionJob would attempt a REAL issue.');
      out.push('VERDICT: INCONCLUSIVE — guard not exercised.');
      return out.join('\n');
    }
    var res = issueProductionJob({
      fgCode: fgCodes[0],
      fgQtyToIssue: 1,
      issuedBy: 'UOM-GUARD-SELFTEST',
      productionOrderNo: 'UOMGUARD-SELFTEST-DRYRUN'
    });
    var refused = res && res.success === false &&
                  String(res.error || '').indexOf('Unit mismatch') >= 0;
    out.push('');
    out.push('issueProductionJob(' + fgCodes[0] + ', 1) -> success=' + (res && res.success));
    out.push('  error: ' + String((res && res.error) || '').split('\n')[0]);
    out.push('');
    // A refusal for a DIFFERENT reason (e.g. insufficient stock) does not prove
    // the guard; say so rather than claiming a pass.
    if (refused) {
      out.push('VERDICT: PASS — the guard blocked the issue before any write.');
    } else if (res && res.success === false) {
      out.push('VERDICT: INCONCLUSIVE — refused, but not by the UoM guard. ' +
               'Stock may be short on this FG; the guard runs after the ' +
               'maxProducible check, so a stock shortfall masks it.');
    } else {
      out.push('VERDICT: FAIL — the issue was ACCEPTED despite a unit mismatch.');
    }
  } else {
    out.push('VERDICT: PASS (vacuous) — no mismatches exist, so the guard cannot fire.');
  }

  return out.join('\n');
}
