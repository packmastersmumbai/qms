// ============================================================
// _ProductionDiag.js — One-click full diagnosis of the
// GRN → IQC → Stock → Production lots chain.
//
// Menu: QMS System → 🩻 Diagnose Production Pipeline
// Writes a fresh '_PROD_DIAG' sheet with every check, value,
// and verdict. No prompts. No re-runs needed.
// ============================================================

function runProductionDiagnostics() {
  var ss = getSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var report = []; // each entry: [section, check, value, verdict]

  function add(section, check, value, verdict) {
    report.push([section, check, String(value == null ? '' : value), verdict || '']);
  }

  // ---------- 1. Sheet existence ----------
  var sheetsNeeded = ['GRN_LOG','IQC_LOG','STOCK_LEDGER','LOCATIONS','MASTERS_Materials','PROD_ISSUE_LOG'];
  sheetsNeeded.forEach(function(name){
    var w = ss.getSheetByName(name);
    if (!w) add('1. Sheets', name, 'MISSING', 'FAIL');
    else    add('1. Sheets', name, w.getLastRow() + ' rows', 'OK');
  });

  var grnWs = ss.getSheetByName('GRN_LOG');
  var iqcWs = ss.getSheetByName('IQC_LOG');
  var ledWs = ss.getSheetByName('STOCK_LEDGER');
  var locWs = ss.getSheetByName('LOCATIONS');
  var matWs = ss.getSheetByName('MASTERS_Materials');

  // ---------- 2. Master data sanity ----------
  if (matWs) {
    var matHdrs = matWs.getRange(1,1,1,Math.max(5,matWs.getLastColumn())).getValues()[0];
    add('2. Masters', 'MASTERS_Materials col E header', matHdrs[4] || '(blank)',
      String(matHdrs[4]||'').toLowerCase().indexOf('location') >= 0 ? 'OK' : 'WARN — expected "Default Location"');

    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    add('2. Masters', 'Total materials in master', mats.length, mats.length > 0 ? 'OK' : 'FAIL');
    var withLoc = mats.filter(function(m){ return m.defaultLocation; }).length;
    add('2. Masters', 'Materials with Default Location set', withLoc + ' / ' + mats.length,
      withLoc === mats.length ? 'OK' : 'WARN — ' + (mats.length - withLoc) + ' missing');
  }

  // ---------- 3. LOCATIONS sanity ----------
  var locTypes = {};
  if (locWs && locWs.getLastRow() > 1) {
    locWs.getRange(2,1,locWs.getLastRow()-1,12).getValues().forEach(function(r){
      if (r[0]) locTypes[String(r[0]).trim()] = String(r[8]||'').toUpperCase();
    });
    var rmCount = 0, qCount = 0;
    Object.keys(locTypes).forEach(function(k){
      if (locTypes[k] === 'RM') rmCount++;
      if (locTypes[k] === 'QUARANTINE') qCount++;
    });
    add('3. Locations', 'RM-type bays', rmCount, rmCount > 0 ? 'OK' : 'FAIL');
    add('3. Locations', 'QUARANTINE-type bays', qCount, qCount > 0 ? 'OK' : 'FAIL');
  }

  // ---------- 4. GRN_LOG completeness ----------
  var grnStats = { total: 0, noBatch: 0, noLoc: 0, noMat: 0, noQty: 0, byMaterial: {} };
  if (grnWs && grnWs.getLastRow() > 1) {
    var g = grnWs.getDataRange().getValues();
    for (var i = 1; i < g.length; i++) {
      grnStats.total++;
      var mat = String(g[i][6]||'').trim();
      var btch = String(g[i][8]||'').trim();
      var qty = Number(g[i][10])||0;
      var loc = String(g[i][20]||'').trim();
      if (!mat)  grnStats.noMat++;
      if (!btch) grnStats.noBatch++;
      if (!loc)  grnStats.noLoc++;
      if (qty <= 0) grnStats.noQty++;
      if (mat) grnStats.byMaterial[mat] = (grnStats.byMaterial[mat]||0) + 1;
    }
  }
  add('4. GRN_LOG', 'Total rows', grnStats.total, 'INFO');
  add('4. GRN_LOG', 'Rows missing Material Code (col G)', grnStats.noMat, grnStats.noMat === 0 ? 'OK' : 'FAIL');
  add('4. GRN_LOG', 'Rows missing Batch (col I)',         grnStats.noBatch, grnStats.noBatch === 0 ? 'OK' : 'WARN');
  add('4. GRN_LOG', 'Rows missing Location (col U)',      grnStats.noLoc, grnStats.noLoc === 0 ? 'OK' : 'WARN');
  add('4. GRN_LOG', 'Rows with Qty Received ≤ 0',         grnStats.noQty, grnStats.noQty === 0 ? 'OK' : 'WARN');
  var distinctMats = Object.keys(grnStats.byMaterial).length;
  add('4. GRN_LOG', 'Distinct materials in GRN_LOG', distinctMats, 'INFO');

  // ---------- 5. STOCK_LEDGER completeness ----------
  var ledStats = { total: 0, byType: {}, byMaterial: {} };
  if (ledWs && ledWs.getLastRow() > 1) {
    var l = ledWs.getDataRange().getValues();
    for (var j = 1; j < l.length; j++) {
      ledStats.total++;
      var t = String(l[j][2]||'').trim().toUpperCase();
      ledStats.byType[t] = (ledStats.byType[t]||0) + 1;
      var lm = String(l[j][3]||'').trim();
      if (lm) ledStats.byMaterial[lm] = (ledStats.byMaterial[lm]||0) + 1;
    }
  }
  add('5. STOCK_LEDGER', 'Total rows', ledStats.total, 'INFO');
  Object.keys(ledStats.byType).forEach(function(t){
    add('5. STOCK_LEDGER', 'Txn type: ' + t, ledStats.byType[t], 'INFO');
  });
  var ledMatCount = Object.keys(ledStats.byMaterial).length;
  add('5. STOCK_LEDGER', 'Distinct materials in ledger', ledMatCount, 'INFO');
  add('5. STOCK_LEDGER', 'GRN→Ledger coverage', ledMatCount + ' of ' + distinctMats + ' GRN materials',
    ledMatCount >= distinctMats ? 'OK' : 'WARN — ' + (distinctMats - ledMatCount) + ' materials in GRN missing from ledger');

  // List materials in GRN but not in ledger
  var missingFromLedger = Object.keys(grnStats.byMaterial).filter(function(m){
    return !ledStats.byMaterial[m];
  });
  add('5. STOCK_LEDGER', 'Materials in GRN but NOT ledger',
    missingFromLedger.length > 0 ? missingFromLedger.slice(0, 10).join(', ') + (missingFromLedger.length > 10 ? ' …+' + (missingFromLedger.length-10) : '') : '(none)',
    missingFromLedger.length === 0 ? 'OK' : 'WARN');

  // ---------- 6. Per-material lot availability ----------
  // For each material in ledger with positive balance, check if getFIFOLots returns it.
  var summary = (typeof getStockSummary === 'function') ? getStockSummary() : [];
  var posBalByMat = {};
  summary.forEach(function(s){
    if (s.balance > 0) posBalByMat[s.materialCode] = (posBalByMat[s.materialCode]||0) + 1;
  });
  var matsWithPositive = Object.keys(posBalByMat);
  add('6. Lot Availability', 'Materials with positive ledger balance', matsWithPositive.length, matsWithPositive.length > 0 ? 'OK' : 'FAIL');

  var matsProducible = 0, matsBlockedQuarantine = 0;
  matsWithPositive.forEach(function(mat){
    var lots = (typeof getFIFOLots === 'function') ? getFIFOLots(mat) : [];
    if (lots.length > 0) matsProducible++;
    else matsBlockedQuarantine++;
  });
  add('6. Lot Availability', 'Materials FIFO-issuable (passes filter)', matsProducible,
    matsProducible > 0 ? 'OK' : 'FAIL — every lot blocked by location filter');
  add('6. Lot Availability', 'Materials blocked (only in QUARANTINE/SCRAP/SAMPLE)', matsBlockedQuarantine,
    matsBlockedQuarantine === 0 ? 'OK' : 'WARN — needs IQC accept or move to RM');

  // ---------- 7. Detailed per-material breakdown (top 20) ----------
  matsWithPositive.slice(0, 20).forEach(function(mat){
    var lots = summary.filter(function(s){ return s.materialCode === mat && s.balance > 0; });
    var locDetail = lots.map(function(s){
      var t = locTypes[String(s.locationId).trim()] || '(unknown)';
      var blocked = (t === 'QUARANTINE' || t === 'SCRAP' || t === 'SAMPLE');
      return s.locationId + '(' + t + ',' + s.balance + (blocked ? ',BLOCKED' : ',OK') + ')';
    }).join(' | ');
    var producible = (typeof getFIFOLots === 'function') ? getFIFOLots(mat).length : 0;
    add('7. Per-material', mat, locDetail, producible > 0 ? 'OK — ' + producible + ' lot(s) issuable' : 'BLOCKED');
  });

  // ---------- 8. IQC linkage check ----------
  var iqcStats = { total: 0, accepted: 0, rejected: 0, pending: 0, byGRN: {} };
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iq = iqcWs.getDataRange().getValues();
    for (var k = 1; k < iq.length; k++) {
      iqcStats.total++;
      var disp = String(iq[k][22]||'').toUpperCase();
      if (disp === 'ACCEPTED' || disp === 'ACCEPTED WITH DEVIATION' || disp === 'PASS') iqcStats.accepted++;
      else if (disp === 'REJECTED') iqcStats.rejected++;
      else iqcStats.pending++;
      var grnRef = String(iq[k][2]||'').trim();
      if (grnRef) iqcStats.byGRN[grnRef] = (iqcStats.byGRN[grnRef]||0) + 1;
    }
  }
  add('8. IQC linkage', 'Total IQC rows', iqcStats.total, 'INFO');
  add('8. IQC linkage', 'IQC accepted', iqcStats.accepted, iqcStats.accepted > 0 ? 'OK' : 'WARN');
  add('8. IQC linkage', 'IQC rejected', iqcStats.rejected, 'INFO');
  add('8. IQC linkage', 'IQC pending/other', iqcStats.pending, 'INFO');

  // Production gate requires IQC ACCEPTED for the batch. Count materials with at least one accepted IQC.
  var acceptedMats = {};
  if (iqcWs && iqcWs.getLastRow() > 1 && grnWs && grnWs.getLastRow() > 1) {
    var iq2 = iqcWs.getDataRange().getValues();
    var grnIdx = {};
    var g2 = grnWs.getDataRange().getValues();
    for (var gi = 1; gi < g2.length; gi++) {
      var d = String(g2[gi][0]||'').trim();
      var m = String(g2[gi][6]||'').trim();
      if (d && m && !grnIdx[d]) grnIdx[d] = m;
    }
    for (var ii = 1; ii < iq2.length; ii++) {
      var ref = String(iq2[ii][2]||'').trim();
      var dsp = String(iq2[ii][22]||'').toUpperCase();
      if ((dsp === 'ACCEPTED' || dsp === 'ACCEPTED WITH DEVIATION' || dsp === 'PASS') && grnIdx[ref]) {
        acceptedMats[grnIdx[ref]] = true;
      }
    }
  }
  add('8. IQC linkage', 'Distinct materials with at least one IQC ACCEPT',
    Object.keys(acceptedMats).length,
    Object.keys(acceptedMats).length > 0 ? 'OK' : 'FAIL — Production gate cannot release any material');

  // ---------- 9. Production gate live test ----------
  // For each material with accepted IQC AND positive ledger balance, confirm
  // issueRMForProduction would pass (we don't actually issue — just simulate gate logic).
  var gateReady = 0, gateBlocked = [];
  Object.keys(acceptedMats).forEach(function(mat){
    var lots = (typeof getFIFOLots === 'function') ? getFIFOLots(mat) : [];
    if (lots.length > 0) gateReady++;
    else gateBlocked.push(mat);
  });
  add('9. Gate readiness', 'Materials ready to issue (IQC OK + lot available)', gateReady,
    gateReady > 0 ? 'OK' : 'FAIL');
  add('9. Gate readiness', 'Materials IQC-accepted but no FIFO lot',
    gateBlocked.length === 0 ? '(none)' : gateBlocked.slice(0,10).join(', '),
    gateBlocked.length === 0 ? 'OK' : 'WARN — accepted but stock not in RM bay');

  // ---------- 10. Final verdict ----------
  var fails = report.filter(function(r){ return r[3] === 'FAIL'; }).length;
  var warns = report.filter(function(r){ return r[3] === 'WARN'; }).length;
  add('10. Verdict', 'FAIL count', fails, fails === 0 ? 'OK' : 'FAIL');
  add('10. Verdict', 'WARN count', warns, 'INFO');
  add('10. Verdict', 'Production module usable now',
    gateReady > 0 ? 'YES — ' + gateReady + ' material(s) ready' : 'NO — no issuable material',
    gateReady > 0 ? 'OK' : 'FAIL');

  // ---------- Write report sheet ----------
  var diagSheet = ss.getSheetByName('_PROD_DIAG');
  if (diagSheet) ss.deleteSheet(diagSheet);
  diagSheet = ss.insertSheet('_PROD_DIAG');
  diagSheet.getRange(1,1,1,4).setValues([['Section','Check','Value','Verdict']])
    .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  diagSheet.setFrozenRows(1);
  if (report.length) {
    diagSheet.getRange(2,1,report.length,4).setValues(report);
  }
  diagSheet.setColumnWidth(1, 140);
  diagSheet.setColumnWidth(2, 280);
  diagSheet.setColumnWidth(3, 360);
  diagSheet.setColumnWidth(4, 280);

  // Color verdicts
  for (var rr = 0; rr < report.length; rr++) {
    var v = String(report[rr][3]||'').toUpperCase();
    var bg = '';
    if (v === 'OK') bg = '#E8F5E9';
    else if (v.indexOf('FAIL') === 0) bg = '#FFCDD2';
    else if (v.indexOf('WARN') === 0) bg = '#FFE0B2';
    if (bg) diagSheet.getRange(rr+2, 4).setBackground(bg);
  }
  diagSheet.autoResizeColumn(4);

  // ---------- Final alert ----------
  var verdict = gateReady > 0
    ? '✅ Production usable — ' + gateReady + ' material(s) ready to issue.'
    : '❌ Production NOT usable. See _PROD_DIAG sheet for full breakdown.';
  ui.alert('Production Pipeline Diagnosis',
    verdict +
    '\n\nFAILs: ' + fails +
    '\nWARNs: ' + warns +
    '\n\nFull report: _PROD_DIAG sheet (' + report.length + ' rows).',
    ui.ButtonSet.OK);
}
