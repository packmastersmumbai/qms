// READ-ONLY audit of GRN_LOG and IQC_LOG against MASTERS_Materials.
//   ?diag=grniqcaudit
//
// Why this exists: ?diag=vocabaudit covers BOM <-> masters, and ?diag=mataudit
// covers the master sheet itself, but nothing checked the two TRANSACTION logs
// that feed stock. GRN is where material first enters the system, so a code or
// unit that disagrees with the master there propagates into STOCK_LEDGER, IQC,
// production issue and dispatch.
//
// Checks, per sheet:
//   1. Does every Material Code resolve to a MASTERS_Materials Item Code?
//   2. Does the recorded Unit match the master's Unit? (a GRN in NOS against a
//      master in KG makes every downstream balance meaningless — the same class
//      of defect the issue-plan UoM guard now blocks)
//   3. Does the recorded Description match the master's? (drift means printed
//      documents and the master disagree)
//   4. IQC has NO Material Code column - it joins by DESCRIPTION. Measure how
//      many IQC rows can actually be resolved to a material that way.
function auditGrnIqc() {
  var ss = getSpreadsheet();
  var out = ['GRN_LOG / IQC_LOG vs MASTERS_Materials — read-only'];
  out.push('');

  // ── masters ────────────────────────────────────────────────────────────────
  var mw = ss.getSheetByName('MASTERS_Materials');
  if (!mw || mw.getLastRow() < 2) return 'MASTERS_Materials missing/empty.';
  var unitByCode = {}, descByCode = {}, codeByDesc = {}, dupDesc = {};
  mw.getDataRange().getValues().slice(1).forEach(function (r) {
    var code = String(r[MAT_COL.CODE] || '').trim();
    if (!code) return;
    var desc = String(r[MAT_COL.DESC] || '').trim();
    unitByCode[code] = String(r[MAT_COL.UNIT] || '').trim();
    descByCode[code] = desc;
    var key = desc.toUpperCase().replace(/\s+/g, ' ');
    if (key) {
      if (codeByDesc[key] && codeByDesc[key] !== code) dupDesc[key] = true;
      codeByDesc[key] = code;
    }
  });
  out.push('masters: ' + Object.keys(unitByCode).length + ' codes, ' +
           Object.keys(codeByDesc).length + ' distinct descriptions' +
           (Object.keys(dupDesc).length ? '   !! ' + Object.keys(dupDesc).length +
            ' description(s) map to MORE THAN ONE code' : ''));
  Object.keys(dupDesc).slice(0, 5).forEach(function (d) {
    out.push('      !! ambiguous desc: "' + d.slice(0, 50) + '"');
  });
  out.push('');

  var findings = 0;

  // ── GRN_LOG ────────────────────────────────────────────────────────────────
  // cols: 6=Material Code, 7=Material Description, 10=Qty Received, 11=Unit
  var gw = ss.getSheetByName('GRN_LOG');
  out.push('── GRN_LOG ──');
  if (!gw || gw.getLastRow() < 2) {
    out.push('  absent/empty');
  } else {
    var g = gw.getDataRange().getValues();
    var gTotal = 0, badCode = [], badUnit = [], badDesc = [], blankCode = 0, blankUnit = 0;
    for (var i = 1; i < g.length; i++) {
      var code = String(g[i][6] || '').trim();
      if (!code && !String(g[i][0] || '').trim()) continue;   // truly empty row
      gTotal++;
      if (!code) { blankCode++; continue; }
      if (unitByCode[code] === undefined) {
        badCode.push('row' + (i + 1) + '  ' + code + '  "' + String(g[i][7] || '').slice(0, 30) + '"');
        continue;
      }
      var u = String(g[i][11] || '').trim();
      if (!u) blankUnit++;
      else if (u.toUpperCase() !== String(unitByCode[code]).toUpperCase()) {
        badUnit.push('row' + (i + 1) + '  ' + code + '  GRN="' + u + '"  master="' + unitByCode[code] + '"');
      }
      var d = String(g[i][7] || '').trim();
      if (d && descByCode[code] && d !== descByCode[code]) {
        badDesc.push('row' + (i + 1) + '  ' + code + '  GRN="' + d.slice(0, 28) +
                     '"  master="' + descByCode[code].slice(0, 28) + '"');
      }
    }
    out.push('  rows: ' + gTotal);
    out.push('  blank Material Code:      ' + blankCode);
    out.push('  codes NOT in masters:     ' + badCode.length);
    badCode.slice(0, 12).forEach(function (x) { out.push('     !! ' + x); });
    out.push('  UNIT disagrees w/ master: ' + badUnit.length);
    // Summarise by PAIR, not a truncated sample. A sample of 12 hid that these
    // 115 rows are not all one problem, and a fix sized from the sample would
    // have silently left the remainder.
    var pairTally = {};
    badUnit.forEach(function (x) {
      var m = x.match(/GRN="([^"]*)"\s+master="([^"]*)"/);
      if (m) pairTally[m[1].toUpperCase() + ' -> ' + m[2].toUpperCase()] =
        (pairTally[m[1].toUpperCase() + ' -> ' + m[2].toUpperCase()] || 0) + 1;
    });
    Object.keys(pairTally).sort(function (a, b) { return pairTally[b] - pairTally[a]; })
      .forEach(function (k) { out.push('     !! ' + k + '   ' + pairTally[k] + ' row(s)'); });
    out.push('  blank Unit:               ' + blankUnit);
    out.push('  DESC differs from master: ' + badDesc.length + '   (cosmetic unless printed)');
    badDesc.slice(0, 6).forEach(function (x) { out.push('     ?  ' + x); });
    findings += badCode.length + badUnit.length + blankCode;
  }
  out.push('');

  // ── IQC_LOG ────────────────────────────────────────────────────────────────
  // cols: 2=GRN No., 4=Material Description, 5=Batch No.
  // There is NO Material Code column, so the only join is by description.
  var iw = ss.getSheetByName('IQC_LOG');
  out.push('── IQC_LOG ──');
  out.push('  NOTE: IQC_HEADERS has no Material Code column — the only material');
  out.push('  join available is Material Description (col 5) or via GRN No.');
  if (!iw || iw.getLastRow() < 2) {
    out.push('  absent/empty');
  } else {
    // GRN No. -> material code, so IQC can be resolved the reliable way.
    var codeByGrn = {};
    if (gw && gw.getLastRow() > 1) {
      gw.getDataRange().getValues().slice(1).forEach(function (r) {
        var dn = String(r[0] || '').trim();
        if (dn) codeByGrn[dn] = String(r[6] || '').trim();
      });
    }
    var iq = iw.getDataRange().getValues();
    var iTotal = 0, viaGrn = 0, viaDesc = 0, unresolved = [], grnMissing = [];
    for (var j = 1; j < iq.length; j++) {
      if (!String(iq[j][0] || '').trim()) continue;
      iTotal++;
      var grnNo = String(iq[j][2] || '').trim();
      var desc = String(iq[j][4] || '').trim();
      var key = desc.toUpperCase().replace(/\s+/g, ' ');
      if (grnNo && codeByGrn[grnNo]) { viaGrn++; continue; }
      if (grnNo && !codeByGrn[grnNo]) grnMissing.push('row' + (j + 1) + '  IQC=' +
        String(iq[j][0]).trim() + '  GRN="' + grnNo + '" not in GRN_LOG');
      if (key && codeByDesc[key]) { viaDesc++; continue; }
      unresolved.push('row' + (j + 1) + '  ' + String(iq[j][0]).trim() +
                      '  desc="' + desc.slice(0, 34) + '"');
    }
    out.push('  rows: ' + iTotal);
    out.push('  resolved via GRN No.:     ' + viaGrn + '   (reliable — code comes from GRN_LOG)');
    out.push('  resolved via DESCRIPTION: ' + viaDesc + '   (fragile — text match)');
    out.push('  UNRESOLVED to any material: ' + unresolved.length);
    unresolved.slice(0, 12).forEach(function (x) { out.push('     !! ' + x); });
    out.push('  GRN No. not found in GRN_LOG: ' + grnMissing.length);
    grnMissing.slice(0, 8).forEach(function (x) { out.push('     !! ' + x); });
    findings += unresolved.length;
  }

  // ── orphan-code detail ─────────────────────────────────────────────────────
  // A code with no master row cannot be unit-checked, reordered or looked up.
  // Whether to mint a master row depends on whether it is live stock or dead
  // history, so report dates, quantity and current ledger balance per code
  // rather than guessing.
  out.push('');
  out.push('── ORPHAN GRN CODES — evidence for a decision ──');
  if (gw && gw.getLastRow() > 1) {
    var gAll = gw.getDataRange().getValues();
    var orphan = {};
    for (var k = 1; k < gAll.length; k++) {
      var oc = String(gAll[k][6] || '').trim();
      if (!oc || unitByCode[oc] !== undefined) continue;
      var o = orphan[oc] = orphan[oc] || { rows: 0, qty: 0, unit: '', desc: '', first: null, last: null };
      o.rows++;
      o.qty += Number(gAll[k][10]) || 0;
      o.unit = o.unit || String(gAll[k][11] || '').trim();
      o.desc = o.desc || String(gAll[k][7] || '').trim();
      var dt = gAll[k][1];
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        if (!o.first || dt < o.first) o.first = dt;
        if (!o.last  || dt > o.last)  o.last  = dt;
      }
    }
    // Live ledger balance per orphan code — is any of this stock still on hand?
    var ledgerBal = {};
    try {
      var sw = ss.getSheetByName('STOCK_LEDGER');
      if (sw && sw.getLastRow() > 1) {
        sw.getDataRange().getValues().slice(1).forEach(function (r) {
          var mc = String(r[3] || '').trim();
          if (orphan[mc] === undefined) return;
          ledgerBal[mc] = (ledgerBal[mc] || 0) + (Number(r[6]) || 0) - (Number(r[7]) || 0);
        });
      }
    } catch (e) { out.push('  (STOCK_LEDGER read failed: ' + e.message + ')'); }

    var fmt = function (d) {
      return d ? Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MMM-yyyy') : '?';
    };
    Object.keys(orphan).sort().forEach(function (c) {
      var o = orphan[c];
      var bal = ledgerBal[c];
      out.push('  ' + c + '   "' + o.desc + '"');
      out.push('      GRN rows: ' + o.rows + '   qty received: ' + o.qty + ' ' + (o.unit || '?') +
               '   dates: ' + fmt(o.first) + ' .. ' + fmt(o.last));
      out.push('      STOCK_LEDGER balance now: ' +
               (bal === undefined ? 'no ledger rows' : bal) +
               (bal ? '   <-- LIVE STOCK, needs a master row' : '   <-- nothing on hand'));
    });
    if (!Object.keys(orphan).length) out.push('  none');
  }

  // ── family siblings ────────────────────────────────────────────────────────
  // Category and InspCategory are NOT in the GRN, so a new master row needs them
  // from somewhere. Deriving from a SIBLING in the same product family is a
  // derivation; reading them off the description is a guess. Show both so the
  // difference is visible. (This is the same reasoning that stopped the KETO
  // InspCategory from being derived before ?diag=catsplit made it 1:1.)
  // ── full rows for the remaining unit conflicts ──────────────────────────────
  // Every field on the GRN row, so the unit question can be judged against the
  // supplier, PO, invoice, batch and dates rather than the code alone.
  out.push('');
  out.push('── UNIT-CONFLICT ROWS IN FULL ──');
  if (gw && gw.getLastRow() > 1) {
    var gFull = gw.getDataRange().getValues();
    var hdrs = gFull[0];
    var shown = 0;
    for (var q = 1; q < gFull.length; q++) {
      var qc = String(gFull[q][6] || '').trim();
      if (!qc || unitByCode[qc] === undefined) continue;
      var qu = String(gFull[q][11] || '').trim();
      if (!qu || qu.toUpperCase() === String(unitByCode[qc]).toUpperCase()) continue;
      shown++;
      out.push('');
      out.push('  ROW ' + (q + 1) + '   master unit = ' + unitByCode[qc] +
               '   master desc = "' + (descByCode[qc] || '') + '"');
      for (var c2 = 0; c2 < hdrs.length; c2++) {
        var hv = String(hdrs[c2] || '').trim();
        if (!hv) continue;
        var cell = gFull[q][c2];
        if (cell instanceof Date && !isNaN(cell.getTime())) {
          cell = Utilities.formatDate(cell, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm');
        }
        var sv = String(cell == null ? '' : cell).trim();
        if (sv === '') continue;
        out.push('      ' + hv + ': ' + sv.slice(0, 70));
      }
    }
    if (!shown) out.push('  none');
  }

  // ── product-family dump ────────────────────────────────────────────────────
  // Every master row whose CODE or DESCRIPTION mentions a family named in
  // ?diag=grniqcaudit&fam=BUGSEAL,NATURE (default below). Shows the real
  // structure — which codes are bulk, which are components, which are FG — so a
  // unit or category decision is made against the family, not one row.
  out.push('');
  out.push('── PRODUCT FAMILY DUMP ──');
  ['BUGSEAL', 'BS', 'NATURE GREEN', 'NG'].forEach(function (fam) {
    var hits = mw.getDataRange().getValues().slice(1).filter(function (r) {
      var c = String(r[MAT_COL.CODE] || '').trim().toUpperCase();
      var d = String(r[MAT_COL.DESC] || '').trim().toUpperCase();
      if (!c) return false;
      var f = fam.toUpperCase();
      // Code prefix match, or the description contains the family name.
      return c.indexOf(f) === 0 || d.indexOf(f) >= 0;
    });
    out.push('  family "' + fam + '": ' + hits.length + ' row(s)');
    hits.slice(0, 14).forEach(function (r) {
      out.push('      ' + String(r[MAT_COL.CODE]).trim().padEnd(16) +
               '"' + String(r[MAT_COL.DESC] || '').slice(0, 32) + '"' +
               '  cat=' + (String(r[MAT_COL.CATEGORY] || '').trim() || '-') +
               '  insp=' + (String(r[MAT_COL.INSP_CATEGORY] || '').trim() || '-') +
               '  unit=' + (String(r[MAT_COL.UNIT] || '').trim() || '-') +
               '  loc=' + (String(r[MAT_COL.DEFAULT_LOCATION] || '').trim() || '-'));
    });
  });

  out.push('');
  out.push('── FAMILY SIBLINGS for the orphan codes ──');
  var mrows = mw.getDataRange().getValues().slice(1);
  ['A001', 'A002', 'BSB09', 'BSB010', 'NGNGM05', 'NG01'].forEach(function (oc) {
    // Sibling = shares a leading alpha prefix of >=2 chars with the orphan code.
    var pref = (String(oc).match(/^[A-Za-z]+/) || [''])[0];
    if (pref.length < 2) pref = String(oc).slice(0, 3);
    var sibs = mrows.filter(function (r) {
      var c = String(r[MAT_COL.CODE] || '').trim();
      return c && c !== oc && c.toUpperCase().indexOf(pref.toUpperCase()) === 0;
    }).slice(0, 6);
    out.push('  ' + oc + '   (prefix "' + pref + '")');
    if (!sibs.length) { out.push('      no sibling shares this prefix — no derivation available'); return; }
    sibs.forEach(function (r) {
      out.push('      ' + String(r[MAT_COL.CODE]).trim() +
               '  "' + String(r[MAT_COL.DESC] || '').slice(0, 34) + '"' +
               '  cat=' + (String(r[MAT_COL.CATEGORY] || '').trim() || '-') +
               '  insp=' + (String(r[MAT_COL.INSP_CATEGORY] || '').trim() || '-') +
               '  unit=' + (String(r[MAT_COL.UNIT] || '').trim() || '-') +
               '  loc=' + (String(r[MAT_COL.DEFAULT_LOCATION] || '').trim() || '-'));
    });
  });

  out.push('');
  out.push('── VERDICT ──');
  out.push(findings === 0
    ? '  GRN/IQC DATA: PASS — every row resolves and no unit disagrees.'
    : '  GRN/IQC DATA: ' + findings + ' finding(s) needing attention.');
  return out.join('\n');
}
