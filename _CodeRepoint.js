// Repoint transactions booked against the WRONG material code onto the correct
// existing code, then remove the duplicate master rows.
//   ?diag=repoint              → dry run: every row that would change
//   ?diag=repoint&confirm=YES  → apply
//
// THE DEFECT (found by ?diag=grniqcaudit, confirmed by the owner):
// NICHEM SOLUTIONS ships BUGSEAL and NATURE GREEN as BULK. Those deliveries were
// booked against FG / duplicate codes instead of the family's real codes, which
// already exist:
//
//   BUGSEAL family        BULKBS  "BUGSEAL 250ML BULK"     BULK/BULK/KG/RM-STORE-C
//                         BOTBS250, LBLBS250, CARBS250, PMPBS250  (components)
//                         BSBGF013 "BUGSEAL 250ML"         FG/FG/NOS/FG-STORE-C
//   NATURE GREEN family   BOTNG300 "NATURE GREEN BOTTLES"  BOTTLES/BOTTLES/NOS
//                         NGNGM05  "NATURE GREEN BOTTLES"  <- duplicate of it
//
// So:
//   BSBGF013 -> BULKBS    4 GRN rows, 11,595 units received in LTR against an
//                         FG code in NOS. It is bulk: it belongs on BULKBS (KG).
//   NGNGM05  -> BOTNG300  1 GRN row, 7,286 units. NGNGM05 is a duplicate master
//                         row created earlier today from the GRN itself; the
//                         family already had BOTNG300 for the same thing. The
//                         sibling check missed it because it searched the prefix
//                         "NGNGM", which only that row carries.
//
// WHY REPOINT RATHER THAN JUST RELABEL: stock lives in STOCK_LEDGER keyed by
// material code. Fixing only the master leaves 11,595 units of bulk sitting under
// an FG code while BULKBS reads zero — every balance, reorder and issue lookup
// for that material is wrong. Both the GRN row and its ledger rows must move
// together or the two sheets disagree.
//
// UNIT: the ledger stores quantities, not units, so repointing does not convert
// anything. The GRN's LTR is kept as-is on purpose — see the note at the write.
//
// SAFETY: dry run by default; refuses if a target code is missing; refuses to
// delete a master row that still has ledger rows after the repoint; reports every
// row it touches and re-reads to verify.

var REPOINT_MAP_ = [
  { from: 'BSBGF013', to: 'BULKBS',   why: 'NICHEM ships BUGSEAL as bulk; BSBGF013 is the FG code',
    deleteFrom: false },
  { from: 'NGNGM05',  to: 'BOTNG300', why: 'duplicate of the existing NATURE GREEN BOTTLES row',
    deleteFrom: true }
];

function repointMaterialCodes(apply) {
  var ss = getSpreadsheet();
  var mw = ss.getSheetByName('MASTERS_Materials');
  var gw = ss.getSheetByName('GRN_LOG');
  var sw = ss.getSheetByName('STOCK_LEDGER');
  if (!mw || !gw || !sw) return 'MASTERS_Materials, GRN_LOG or STOCK_LEDGER missing.';

  var out = ['MATERIAL CODE REPOINT — ' + (apply ? 'LIVE' : 'DRY RUN'), ''];

  // Header contracts.
  var gh = gw.getRange(1, 1, 1, gw.getLastColumn()).getValues()[0];
  var sh = sw.getRange(1, 1, 1, sw.getLastColumn()).getValues()[0];
  var bad = [];
  if (String(gh[6] || '').trim() !== 'Material Code')  bad.push('GRN col G != "Material Code" (got "' + gh[6] + '")');
  if (String(gh[11] || '').trim() !== 'Unit')          bad.push('GRN col L != "Unit"');
  if (String(sh[3] || '').trim() !== 'Material Code')  bad.push('STOCK_LEDGER col D != "Material Code" (got "' + sh[3] + '")');
  if (String(sh[13] || '').trim() !== 'Material Desc') bad.push('STOCK_LEDGER col N != "Material Desc" (got "' + sh[13] + '")');
  if (String(mw.getRange(1, MAT_COL.CODE + 1).getValue()).trim() !== 'Item Code') bad.push('MASTERS col A != "Item Code"');
  if (bad.length) {
    out.push('ABORT: sheet headers are not the expected contract.');
    bad.forEach(function (b) { out.push('  ' + b); });
    return out.join('\n');
  }
  out.push('header checks: OK');

  // Master lookup, and the row index of each code so a duplicate can be deleted.
  var mAll = mw.getDataRange().getValues();
  var mRowOf = {}, mUnit = {}, mDesc = {};
  for (var i = 1; i < mAll.length; i++) {
    var c = String(mAll[i][MAT_COL.CODE] || '').trim();
    if (!c) continue;
    if (mRowOf[c] === undefined) mRowOf[c] = i + 1;
    mUnit[c] = String(mAll[i][MAT_COL.UNIT] || '').trim();
    mDesc[c] = String(mAll[i][MAT_COL.DESC] || '').trim();
  }

  // A MISSING SOURCE IS NOT AN ERROR. After a successful run the duplicate source
  // row is deleted, so demanding it exist made the diag un-rerunnable — it aborted
  // instead of reporting "already done". Only a missing TARGET is fatal: pointing
  // stock at a code with no master row is the very defect this fixes.
  var missing = [];
  REPOINT_MAP_.forEach(function (m) {
    if (mRowOf[m.to] === undefined) {
      missing.push('TARGET ' + m.to + ' has no master row — refusing to point stock at a code that does not exist');
    }
    if (mRowOf[m.from] === undefined) {
      out.push('  note: source ' + m.from + ' has no master row (already repointed and removed) — ' +
               'any remaining transaction rows are still checked below');
    }
  });
  if (missing.length) {
    out.push('');
    out.push('ABORT:');
    missing.forEach(function (x) { out.push('  !! ' + x); });
    return out.join('\n');
  }

  var gAll = gw.getDataRange().getValues();
  var sAll = sw.getDataRange().getValues();
  var grnWrites = [], ledWrites = [], descWrites = [];

  REPOINT_MAP_.forEach(function (m) {
    out.push('');
    out.push('── ' + m.from + ' -> ' + m.to + ' ──');
    out.push('   reason: ' + m.why);
    out.push('   target: "' + mDesc[m.to] + '"  unit=' + mUnit[m.to]);

    var gQty = 0;
    for (var r = 1; r < gAll.length; r++) {
      if (String(gAll[r][6] || '').trim() !== m.from) continue;
      var q = Number(gAll[r][10]) || 0;
      gQty += q;
      grnWrites.push({ row: r + 1, to: m.to, desc: mDesc[m.to] });
      out.push('   GRN row' + (r + 1) + '  ' + String(gAll[r][0]).trim() +
               '  qty=' + q + ' ' + String(gAll[r][11] || '').trim() +
               '  "' + String(gAll[r][7] || '').slice(0, 24) + '"');
    }
    out.push('   GRN rows: ' + grnWrites.filter(function (w) { return w.to === m.to; }).length +
             '   total qty: ' + gQty);

    var lQty = 0, lRows = 0;
    for (var s = 1; s < sAll.length; s++) {
      if (String(sAll[s][3] || '').trim() !== m.from) continue;
      lRows++;
      lQty += (Number(sAll[s][6]) || 0) - (Number(sAll[s][7]) || 0);
      ledWrites.push({ row: s + 1, to: m.to, desc: mDesc[m.to] });
    }
    out.push('   STOCK_LEDGER rows: ' + lRows + '   net balance moving: ' + lQty);
  });

  // ── description sync ───────────────────────────────────────────────────────
  // A repointed row said BULKBS in col G but still "BUGSEAL FG" in col H — the
  // code and the text contradicting each other, which is worse than the original
  // error because it looks deliberate. MASTERS_Materials is the single source for
  // what a code means, so any GRN description that disagrees with its master is
  // overwritten from the master. Covers the whole sheet, not just repointed rows:
  // the same drift exists on rows nobody repointed ("BUGSEAL  LABELS" with a
  // double space, "Label K+S Liquid" vs "LABELS K+S LIQUID CALCIUM").
  out.push('');
  out.push('── DESCRIPTION SYNC (GRN col H <- master) ──');
  for (var d = 1; d < gAll.length; d++) {
    if (!String(gAll[d][0] || '').trim()) continue;
    // Use the code this run is setting, not the stale one on the sheet.
    var pending = null;
    for (var w = 0; w < grnWrites.length; w++) if (grnWrites[w].row === d + 1) { pending = grnWrites[w].to; break; }
    var dc = pending || String(gAll[d][6] || '').trim();
    if (!dc || mDesc[dc] === undefined) continue;
    var cur = String(gAll[d][7] || '').trim();
    var want2 = String(mDesc[dc] || '').trim();
    if (!want2 || cur === want2) continue;
    descWrites.push({ row: d + 1, code: dc, from: cur, to: want2 });
  }
  // STOCK_LEDGER col N carries the same denormalised text and drifts the same way.
  // Repointed rows are handled in ledWrites; this catches every other stale one.
  var ledDescWrites = [];
  for (var n = 1; n < sAll.length; n++) {
    var nc = String(sAll[n][3] || '').trim();
    if (!nc || mDesc[nc] === undefined) continue;
    var alreadyRepointing = false;
    for (var lw = 0; lw < ledWrites.length; lw++) if (ledWrites[lw].row === n + 1) { alreadyRepointing = true; break; }
    if (alreadyRepointing) continue;
    var curN = String(sAll[n][13] || '').trim();
    if (!curN || curN === mDesc[nc]) continue;   // blank is left alone; only DRIFT is fixed
    ledDescWrites.push({ row: n + 1, to: mDesc[nc] });
  }

  out.push('   rows to sync: ' + descWrites.length + ' GRN, ' + ledDescWrites.length + ' ledger');
  descWrites.slice(0, 20).forEach(function (x) {
    out.push('   row' + x.row + '  ' + x.code + '  "' + x.from.slice(0, 26) + '" -> "' + x.to.slice(0, 30) + '"');
  });

  out.push('');
  out.push('TOTAL: ' + grnWrites.length + ' GRN code(s), ' + ledWrites.length +
           ' ledger row(s), ' + descWrites.length + ' description(s)');

  if (!grnWrites.length && !ledWrites.length && !descWrites.length && !ledDescWrites.length) {
    out.push('Nothing to repoint.');
    return out.join('\n');
  }

  if (!apply) {
    out.push('');
    out.push('Master rows that would then be DELETED as duplicates: ' +
             REPOINT_MAP_.filter(function (m) { return m.deleteFrom; })
               .map(function (m) { return m.from + ' (row ' + mRowOf[m.from] + ')'; }).join(', ') || 'none');
    out.push('');
    out.push('DRY RUN — re-run with &confirm=YES.');
    return out.join('\n');
  }

  // ── apply ──────────────────────────────────────────────────────────────────
  // Material Code only. The GRN's recorded Unit is left ALONE: it is what the
  // supplier actually delivered against (LTR), and rewriting it to the target's
  // KG/NOS would silently reinterpret a received quantity. The disagreement stays
  // visible in ?diag=grniqcaudit, which is the correct outcome — a unit
  // CONVERSION needs a density or a pack size, not a find-and-replace.
  grnWrites.forEach(function (w) {
    gw.getRange(w.row, 7).setValue(w.to);          // col G  Material Code
  });
  descWrites.forEach(function (w) {
    gw.getRange(w.row, 8).setValue(w.to);          // col H  Material Description
  });
  ledDescWrites.forEach(function (w) {
    sw.getRange(w.row, 14).setValue(w.to);         // col N  Material Desc
  });
  ledWrites.forEach(function (w) {
    sw.getRange(w.row, 4).setValue(w.to);          // col D  Material Code
    sw.getRange(w.row, 14).setValue(w.desc);       // col N  Material Desc
  });
  SpreadsheetApp.flush();
  if (typeof prodCacheReset_ === 'function') prodCacheReset_();

  // Verify the repoint before deleting anything.
  var g2 = gw.getDataRange().getValues(), s2 = sw.getDataRange().getValues();
  var leftG = 0, leftS = 0;
  REPOINT_MAP_.forEach(function (m) {
    for (var r = 1; r < g2.length; r++) if (String(g2[r][6] || '').trim() === m.from) leftG++;
    for (var s = 1; s < s2.length; s++) if (String(s2[s][3] || '').trim() === m.from) leftS++;
  });
  var descBad = descWrites.filter(function (w) {
    return String(g2[w.row - 1][7] || '').trim() !== w.to;
  });

  out.push('');
  out.push('REPOINTED ' + grnWrites.length + ' GRN + ' + ledWrites.length + ' ledger row(s)');
  out.push('SYNCED ' + descWrites.length + ' GRN + ' + ledDescWrites.length +
           ' ledger description(s); not applied: ' + descBad.length);
  out.push('rows still on an old code: GRN ' + leftG + ', ledger ' + leftS);

  // Delete duplicate master rows ONLY when nothing references them any more.
  var deleted = [];
  if (!leftG && !leftS) {
    REPOINT_MAP_.filter(function (m) { return m.deleteFrom; }).forEach(function (m) {
      var fresh = mw.getDataRange().getValues();
      for (var i = fresh.length - 1; i >= 1; i--) {
        if (String(fresh[i][MAT_COL.CODE] || '').trim() === m.from) {
          mw.deleteRow(i + 1);
          deleted.push(m.from + ' (was row ' + (i + 1) + ')');
          break;
        }
      }
    });
    SpreadsheetApp.flush();
  } else {
    out.push('  !! skipped duplicate-row deletion — references remain');
  }
  out.push('deleted duplicate master row(s): ' + (deleted.length ? deleted.join(', ') : 'none'));

  out.push('');
  out.push((leftG || leftS || descBad.length) ? 'RESULT: FAIL' : 'RESULT: PASS');
  out.push('');
  out.push('Next: ?diag=grniqcaudit — orphans stay 0; the LTR-vs-KG/NOS unit');
  out.push('disagreements REMAIN by design (a conversion needs density/pack size).');
  return out.join('\n');
}
