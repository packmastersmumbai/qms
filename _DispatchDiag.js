// ============================================================
// _DispatchDiag.js — One-click full diagnosis of the
// OQC → FG_DISPATCH_LOTS → Gatepass dispatch chain.
//
// Menu: QMS System → 🩺 Diagnose Dispatch Pipeline
// Writes a fresh '_DISP_DIAG' sheet with every check, value,
// and verdict. No prompts. No re-runs needed.
//
// Plus traceFGDispatchForCustomerProduct(custCode, prodCode) writes
// a step-by-step probe to '_DISP_TRACE'.
// ============================================================

function runDispatchDiagnostics() {
  var ss = getSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var report = []; // [section, check, value, verdict]
  function add(section, check, value, verdict) {
    report.push([section, check, String(value == null ? '' : value), verdict || '']);
  }

  // ---------- 1. Sheets ----------
  var sheetsNeeded = ['OQC_LOG','GATEPASS_LOG','STOCK_LEDGER','LOCATIONS',
                      'MASTERS_Materials','MASTERS_Customers',
                      'FG_DISPATCH_LOTS','FG_FIFO_OVERRIDE_LOG'];
  sheetsNeeded.forEach(function(name){
    var w = ss.getSheetByName(name);
    if (!w) add('1. Sheets', name, 'MISSING', 'FAIL');
    else    add('1. Sheets', name, w.getLastRow() + ' rows', 'OK');
  });

  var oqcWs = ss.getSheetByName('OQC_LOG');
  var gpWs  = ss.getSheetByName('GATEPASS_LOG');
  var ledWs = ss.getSheetByName('STOCK_LEDGER');
  var locWs = ss.getSheetByName('LOCATIONS');
  var fglWs = ss.getSheetByName('FG_DISPATCH_LOTS');

  // ---------- 2. Masters ----------
  var fgs = (typeof getFG === 'function') ? getFG() : [];
  add('2. Masters', 'FG materials (getFG)', fgs.length, fgs.length > 0 ? 'OK' : 'FAIL');
  var custs = (typeof getCustomers === 'function') ? getCustomers() : [];
  add('2. Masters', 'Customers (getCustomers)', custs.length, custs.length > 0 ? 'OK' : 'FAIL');
  var fgWithUnit = fgs.filter(function(m){ return m.uom || m.unit; }).length;
  add('2. Masters', 'FG materials with unit', fgWithUnit + ' / ' + fgs.length,
    fgWithUnit === fgs.length ? 'OK' : 'WARN');

  // ---------- 3. Locations ----------
  var locTypes = {};
  var locActive = {};
  if (locWs && locWs.getLastRow() > 1) {
    locWs.getRange(2,1,locWs.getLastRow()-1,12).getValues().forEach(function(r){
      if (r[0]) {
        locTypes[String(r[0]).trim()] = String(r[8]||'').toUpperCase();
        locActive[String(r[0]).trim()] = String(r[11]||'Y').toUpperCase() !== 'N';
      }
    });
  }
  var fgCount = 0, fgHoldCount = 0;
  Object.keys(locTypes).forEach(function(k){
    if (locTypes[k] === 'FG' && locActive[k]) fgCount++;
    if (locTypes[k] === 'FG_HOLD' && locActive[k]) fgHoldCount++;
  });
  add('3. Locations', 'FG-type bays (active)', fgCount, fgCount > 0 ? 'OK' : 'FAIL');
  add('3. Locations', 'FG_HOLD-type bays (active)', fgHoldCount, fgHoldCount > 0 ? 'OK' : 'WARN');

  // ---------- 4. OQC completeness ----------
  var oqcStats = { total: 0, released: 0, withBatch: 0, withProductDesc: 0,
                   withFgLoc: 0, withLotId: 0 };
  var oqcRows = [];
  if (oqcWs && oqcWs.getLastRow() > 1) {
    var o = oqcWs.getDataRange().getValues();
    for (var i = 1; i < o.length; i++) {
      var r = o[i];
      oqcStats.total++;
      var dec = String(r[14]||'').toUpperCase();
      var isReleased = (dec === 'RELEASED' || dec === 'ACCEPTED' || dec === 'ACCEPTED WITH DEVIATION');
      if (isReleased) {
        oqcStats.released++;
        if (String(r[4]||'').trim()) oqcStats.withBatch++;
        if (String(r[5]||'').trim()) oqcStats.withProductDesc++;
        if (String(r[21]||'').trim()) oqcStats.withFgLoc++;
        if (String(r[22]||'').trim()) oqcStats.withLotId++;
        oqcRows.push({
          docNo: String(r[0]||'').trim(),
          date: r[1],
          custCode: String(r[2]||'').trim(),
          custName: String(r[3]||'').trim(),
          batch: String(r[4]||'').trim(),
          productDesc: String(r[5]||'').trim(),
          acceptedQty: Number(r[16])||0,
          fgLoc: String(r[21]||'').trim(),
          fgLotId: String(r[22]||'').trim()
        });
      }
    }
  }
  add('4. OQC completeness', 'Total OQC rows', oqcStats.total, 'INFO');
  add('4. OQC completeness', 'Released/Accepted', oqcStats.released, oqcStats.released > 0 ? 'OK' : 'WARN');
  add('4. OQC completeness', 'Released w/ batch', oqcStats.withBatch + ' / ' + oqcStats.released,
    oqcStats.released === 0 || oqcStats.withBatch === oqcStats.released ? 'OK' : 'WARN');
  add('4. OQC completeness', 'Released w/ product desc', oqcStats.withProductDesc + ' / ' + oqcStats.released,
    oqcStats.released === 0 || oqcStats.withProductDesc === oqcStats.released ? 'OK' : 'WARN');
  add('4. OQC completeness', 'Released w/ FG Location (col 22)', oqcStats.withFgLoc + ' / ' + oqcStats.released,
    oqcStats.released === 0 || oqcStats.withFgLoc === oqcStats.released ? 'OK' : 'WARN — backfill or capture at OQC release');
  add('4. OQC completeness', 'Released w/ FG Lot ID (col 23)', oqcStats.withLotId + ' / ' + oqcStats.released,
    oqcStats.released === 0 || oqcStats.withLotId === oqcStats.released ? 'OK' : 'WARN');

  // ---------- 5. OQC → FG_DISPATCH_LOTS coverage ----------
  var fglByOqc = {};
  var fglCount = 0, fglNeedsReview = 0, fglAvail = 0, fglPartial = 0, fglDispatched = 0;
  if (fglWs && fglWs.getLastRow() > 1) {
    var fg = fglWs.getDataRange().getValues();
    for (var k = 1; k < fg.length; k++) {
      var oref = String(fg[k][2]||'').trim();
      fglByOqc[oref] = fg[k];
      fglCount++;
      var st = String(fg[k][14]||'').toUpperCase();
      if (st === 'NEEDS_REVIEW') fglNeedsReview++;
      else if (st === 'AVAILABLE') fglAvail++;
      else if (st === 'PARTIAL') fglPartial++;
      else if (st === 'DISPATCHED') fglDispatched++;
    }
  }
  add('5. FG_DISPATCH_LOTS', 'Total rows', fglCount, 'INFO');
  add('5. FG_DISPATCH_LOTS', 'Status AVAILABLE', fglAvail, 'INFO');
  add('5. FG_DISPATCH_LOTS', 'Status PARTIAL',   fglPartial, 'INFO');
  add('5. FG_DISPATCH_LOTS', 'Status DISPATCHED',fglDispatched, 'INFO');
  add('5. FG_DISPATCH_LOTS', 'Status NEEDS_REVIEW', fglNeedsReview,
    fglNeedsReview === 0 ? 'OK' : 'WARN — backfill rows missing FG Location');

  var notMirrored = 0;
  oqcRows.forEach(function(or){ if (!fglByOqc[or.docNo]) notMirrored++; });
  add('5. FG_DISPATCH_LOTS', 'Released OQCs NOT mirrored', notMirrored,
    notMirrored === 0 ? 'OK' : 'WARN — run Backfill FG Dispatch Lots');

  // ---------- 6. FG location capture rate (released OQCs) ----------
  add('6. FG capture', 'Capture rate', oqcStats.withFgLoc + ' / ' + oqcStats.released,
    oqcStats.released === 0 ? 'INFO' : (oqcStats.withFgLoc === oqcStats.released ? 'OK' : 'WARN'));

  // ---------- 7. Integrity: FG_DISPATCH_LOTS.qtyDispatched ↔ GATEPASS_LOG ----------
  var gpQtyByOqcRef = {};
  if (gpWs && gpWs.getLastRow() > 1) {
    var g = gpWs.getDataRange().getValues();
    for (var gi = 1; gi < g.length; gi++) {
      var ref = String(g[gi][3]||'').trim();
      var qty = Number(g[gi][7])||0;
      if (ref) gpQtyByOqcRef[ref] = (gpQtyByOqcRef[ref]||0) + qty;
    }
  }
  var mismatches = 0;
  Object.keys(fglByOqc).forEach(function(ref){
    var fglQty = Number(fglByOqc[ref][11])||0;
    var gpQty  = gpQtyByOqcRef[ref] || 0;
    // Allow small rounding tolerance
    if (Math.abs(fglQty - gpQty) > 0.001) mismatches++;
  });
  add('7. Integrity', 'FG_DISPATCH_LOTS.qtyDispatched ↔ GATEPASS_LOG sum', mismatches,
    mismatches === 0 ? 'OK' : 'WARN — ' + mismatches + ' lot(s) out of sync');

  // ---------- 8. Ledger linkage (every FG_DISPATCH ledger ↔ GATEPASS) ----------
  var fgDispatchLedger = 0, fgDispatchOrphan = 0;
  if (ledWs && ledWs.getLastRow() > 1) {
    var l = ledWs.getDataRange().getValues();
    var gpDocs = {};
    if (gpWs && gpWs.getLastRow() > 1) {
      gpWs.getRange(2,1,gpWs.getLastRow()-1,1).getValues().forEach(function(r){
        if (r[0]) gpDocs[String(r[0]).trim()] = true;
      });
    }
    for (var li = 1; li < l.length; li++) {
      var t = String(l[li][2]||'').trim().toUpperCase();
      if (t === 'FG_DISPATCH') {
        fgDispatchLedger++;
        var refType = String(l[li][9]||'').trim().toUpperCase();
        var refNo = String(l[li][10]||'').trim();
        if (refType !== 'GATEPASS' || !refNo || !gpDocs[refNo]) fgDispatchOrphan++;
      }
    }
  }
  add('8. Ledger', 'FG_DISPATCH ledger rows', fgDispatchLedger, 'INFO');
  add('8. Ledger', 'FG_DISPATCH rows w/ no matching GP', fgDispatchOrphan,
    fgDispatchOrphan === 0 ? 'OK' : 'FAIL');

  // ---------- 9. Per-customer FIFO sample (top 5) ----------
  var custProdCount = {};
  oqcRows.forEach(function(or){
    var k = or.custCode + '||' + or.productDesc;
    custProdCount[k] = (custProdCount[k]||0) + 1;
  });
  var keys = Object.keys(custProdCount).sort(function(a,b){
    return custProdCount[b]-custProdCount[a];
  }).slice(0,5);
  keys.forEach(function(k){
    var parts = k.split('||');
    add('9. Per-customer', parts[0] + ' × ' + parts[1].substring(0,40),
      custProdCount[k] + ' released OQC(s)', 'INFO');
  });

  // ---------- 10. Verdict ----------
  var fails = report.filter(function(r){ return r[3] === 'FAIL'; }).length;
  var warns = report.filter(function(r){ return r[3] === 'WARN' || /^WARN/.test(r[3]); }).length;
  var usable = (fglAvail > 0 || fglPartial > 0);
  add('10. Verdict', 'FAIL count', fails, fails === 0 ? 'OK' : 'FAIL');
  add('10. Verdict', 'WARN count', warns, 'INFO');
  add('10. Verdict', 'Dispatch usable now',
    usable ? 'YES — ' + (fglAvail + fglPartial) + ' lot(s) available'
           : 'NO — no AVAILABLE/PARTIAL FG_DISPATCH_LOTS rows yet',
    usable ? 'OK' : 'WARN');

  // ---------- Write report sheet ----------
  var diagSheet = ss.getSheetByName('_DISP_DIAG');
  if (diagSheet) ss.deleteSheet(diagSheet);
  diagSheet = ss.insertSheet('_DISP_DIAG');
  diagSheet.getRange(1,1,1,4).setValues([['Section','Check','Value','Verdict']])
    .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  diagSheet.setFrozenRows(1);
  if (report.length) {
    diagSheet.getRange(2,1,report.length,4).setValues(report);
  }
  diagSheet.setColumnWidth(1, 160);
  diagSheet.setColumnWidth(2, 300);
  diagSheet.setColumnWidth(3, 360);
  diagSheet.setColumnWidth(4, 280);

  for (var rr = 0; rr < report.length; rr++) {
    var v = String(report[rr][3]||'').toUpperCase();
    var bg = '';
    if (v === 'OK') bg = '#E8F5E9';
    else if (v.indexOf('FAIL') === 0) bg = '#FFCDD2';
    else if (v.indexOf('WARN') === 0) bg = '#FFE0B2';
    if (bg) diagSheet.getRange(rr+2, 4).setBackground(bg);
  }

  ui.alert('Dispatch Pipeline Diagnosis',
    (usable ? '✅' : '⚠️') + ' ' +
    (usable ? 'Dispatch usable — ' + (fglAvail + fglPartial) + ' lot(s) available.'
            : 'Dispatch NOT usable yet (no AVAILABLE lots).') +
    '\n\nFAILs: ' + fails +
    '\nWARNs: ' + warns +
    '\n\nFull report on sheet "_DISP_DIAG" (' + report.length + ' rows).',
    ui.ButtonSet.OK);
}

// ---------- Trace one (customer, product) end-to-end ----------
function traceFGDispatchForCustomerProduct(customerCode, productCode) {
  var ss = getSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  if (!customerCode) {
    var r1 = ui.prompt('Trace FG Dispatch', 'Customer code:', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;
    customerCode = String(r1.getResponseText() || '').trim();
  }
  if (!productCode) {
    var r2 = ui.prompt('Trace FG Dispatch', 'Product code:', ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) return;
    productCode = String(r2.getResponseText() || '').trim();
  }
  if (!customerCode || !productCode) return;

  var rows = [['Step','Detail']];
  rows.push(['Input', JSON.stringify({ customerCode: customerCode, productCode: productCode })]);

  // A) OQC released rows matching customer+product
  var oqcWs = ss.getSheetByName('OQC_LOG');
  var matched = [];
  if (oqcWs && oqcWs.getLastRow() > 1) {
    var o = oqcWs.getDataRange().getValues();
    var fgs = (typeof getFG === 'function') ? getFG() : [];
    var codeByDesc = {};
    fgs.forEach(function(m){ if (m.description) codeByDesc[String(m.description).trim()] = m.code; });
    for (var i = 1; i < o.length; i++) {
      var dec = String(o[i][14]||'').toUpperCase();
      if (dec !== 'RELEASED' && dec !== 'ACCEPTED' && dec !== 'ACCEPTED WITH DEVIATION') continue;
      var cc = String(o[i][2]||'').trim();
      if (cc !== String(customerCode).trim()) continue;
      var desc = String(o[i][5]||'').trim();
      var resolvedCode = codeByDesc[desc] || '';
      if (resolvedCode && String(resolvedCode).trim() !== String(productCode).trim()) continue;
      matched.push({
        docNo: o[i][0], batch: o[i][4], desc: desc, fgLoc: o[i][21], fgLotId: o[i][22],
        acceptedQty: o[i][16]
      });
    }
  }
  rows.push(['OQC released rows matching', matched.length]);
  matched.forEach(function(m, idx){
    rows.push(['  oqc['+idx+']', JSON.stringify(m)]);
  });

  // B) FG_DISPATCH_LOTS entries
  var fglWs = ss.getSheetByName('FG_DISPATCH_LOTS');
  var fglFound = [];
  if (fglWs && fglWs.getLastRow() > 1) {
    var f = fglWs.getDataRange().getValues();
    for (var j = 1; j < f.length; j++) {
      if (String(f[j][4]||'').trim() !== String(customerCode).trim()) continue;
      if (String(f[j][6]||'').trim() !== String(productCode).trim()) continue;
      fglFound.push({
        lotId: f[j][0], oqcRef: f[j][2], batch: f[j][8], fgLoc: f[j][9],
        released: f[j][10], dispatched: f[j][11], available: f[j][12],
        status: f[j][14]
      });
    }
  }
  rows.push(['FG_DISPATCH_LOTS matching', fglFound.length]);
  fglFound.forEach(function(m, idx){
    rows.push(['  fgl['+idx+']', JSON.stringify(m)]);
  });

  // C) Server endpoint result
  if (typeof getReleasedFGLotsForCustomerProduct === 'function') {
    try {
      var server = getReleasedFGLotsForCustomerProduct(customerCode, productCode);
      rows.push(['getReleasedFGLotsForCustomerProduct count', (server||[]).length]);
      (server||[]).forEach(function(l, idx){
        rows.push(['  api['+idx+']', JSON.stringify(l)]);
      });
    } catch(eApi) {
      rows.push(['getReleasedFGLotsForCustomerProduct ERROR', eApi.message]);
    }
  } else {
    rows.push(['getReleasedFGLotsForCustomerProduct', '(not yet implemented)']);
  }

  var sh = ss.getSheetByName('_DISP_TRACE');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('_DISP_TRACE');
  sh.getRange(1,1,rows.length,2).setValues(rows);
  sh.getRange(1,1,1,2).setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  sh.setColumnWidth(1, 320); sh.setColumnWidth(2, 800);
  sh.setFrozenRows(1);

  ui.alert('Trace written to _DISP_TRACE for ' + customerCode + ' × ' + productCode +
           '\n\nOQC matches: ' + matched.length +
           '\nFG_DISPATCH_LOTS matches: ' + fglFound.length,
           ui.ButtonSet.OK);
}
