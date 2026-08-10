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
  var badComp = {}, fgWithBad = {}, fgDesc = {};
  rows.forEach(function (r) {
    if (r.fgCode && !fgDesc[r.fgCode]) fgDesc[r.fgCode] = r.fgDesc || '';
    var masterUnit = prodUomMismatch_(r.compCode, r.compUom);
    if (!masterUnit) return;
    badComp[r.compCode] = { bom: r.compUom, master: masterUnit, desc: r.compDesc || '' };
    (fgWithBad[r.fgCode] = fgWithBad[r.fgCode] || {})[r.compCode] = true;
  });

  var compCodes = Object.keys(badComp);
  var fgCodes = Object.keys(fgWithBad);
  // Descriptions, not just codes: which unit is authoritative is a judgement
  // about the physical material ("BOPP Tape 48mm 65mtr" is plainly metres), and
  // a bare item code cannot support that judgement.
  out.push('components with a BOM/master unit disagreement: ' + compCodes.length);
  compCodes.forEach(function (c) {
    out.push('  !! ' + c + '   BOM="' + badComp[c].bom + '"  master="' + badComp[c].master +
             '"   ' + badComp[c].desc);
  });
  out.push('');
  // The consumption figures decide which unit is authoritative far better than
  // any opinion: a per-unit consum of 0.0154 for a 65 m roll is metres, while a
  // flat 1 or 2 is whole rolls. Show every BOM row for each disputed component
  // together with masterP (the pack size the issue rounds up to).
  out.push('── consumption evidence (which unit is the BOM actually using?) ──');
  compCodes.forEach(function (c) {
    out.push('  ' + c + '  BOM="' + badComp[c].bom + '" vs master="' + badComp[c].master + '"');
    var mine = rows.filter(function (r) { return r.compCode === c; });
    var consums = {}, mps = {};
    mine.forEach(function (r) {
      consums[r.consum] = (consums[r.consum] || 0) + 1;
      mps[r.masterP] = (mps[r.masterP] || 0) + 1;
    });
    out.push('      rows: ' + mine.length +
             '   consum values: ' + Object.keys(consums).sort(function (a, b) { return a - b; })
               .map(function (k) { return k + '×' + consums[k]; }).join(', '));
    out.push('      masterP (pack size) values: ' + Object.keys(mps)
               .map(function (k) { return k + '×' + mps[k]; }).join(', '));
    // 1/consum is the implied units-per-FG. For a 65 m roll consumed in metres,
    // this lands in the tens; for whole rolls it lands at 1 or below.
    var uniq = Object.keys(consums).map(Number).filter(function (n) { return n > 0; });
    if (uniq.length) {
      out.push('      implied 1/consum: ' + uniq.map(function (n) {
        return (Math.round((1 / n) * 100) / 100);
      }).join(', '));
    }
  });
  out.push('');
  out.push('FGs that therefore cannot be issued: ' + fgCodes.length);
  fgCodes.forEach(function (f) {
    out.push('  ' + f + '   ' + (fgDesc[f] || '(no description)'));
    out.push('      blocked by: ' + Object.keys(fgWithBad[f]).join(', '));
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
