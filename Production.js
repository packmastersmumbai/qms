// ============================================================
// Production.js — RM issuance to production (UI consumer of the
// Warehouse.issueRMForProduction gate)
// ============================================================
//
// PROD_ISSUE_LOG schema (12 cols):
//   Issue ID, Timestamp, Production Order No., Material Code,
//   Material Name, Batch / Lot No., Location ID, Qty Issued, Unit,
//   Issued By, GRN Ref, Remarks

var PROD_ISSUE_HEADERS_ = [
  'Issue ID', 'Timestamp', 'Production Order No.', 'Material Code',
  'Material Name', 'Batch / Lot No.', 'Location ID', 'Qty Issued', 'Unit',
  'Issued By', 'GRN Ref', 'Remarks'
];

function getProdIssueSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('PROD_ISSUE_LOG');
  if (!ws) {
    ws = ss.insertSheet('PROD_ISSUE_LOG');
    ws.getRange(1, 1, 1, PROD_ISSUE_HEADERS_.length).setValues([PROD_ISSUE_HEADERS_]);
    ws.setFrozenRows(1);
    ws.getRange(1, 1, 1, PROD_ISSUE_HEADERS_.length)
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  }
  return ws;
}

// ---------- Form init ----------

function getProductionFormInit() {
  var docNumber = (typeof peekNextDocNumber === 'function') ? peekNextDocNumber('prod') : '';
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var inspectors = (typeof getInspectors === 'function') ? getInspectors() : [];
  var materials  = (typeof getMaterials === 'function') ? getMaterials() : [];
  return {
    docNumber: docNumber,
    today: today,
    inspectors: inspectors,
    materials: materials
  };
}

// Returns FIFO-ordered, IQC-accepted, non-quarantine lots for one material
// suitable to issue to production. Each lot includes its IQC disposition.
function getProductionLotsForMaterial(materialCode) {
  try {
  if (!materialCode) return [];
  var matKey = String(materialCode).trim();
  var lots = (typeof getFIFOLots === 'function') ? getFIFOLots(matKey) : [];
  if (!lots.length) return [];

  // Resolve IQC disposition per batch (latest IQC row per GRN)
  var grnByBatch = {};
  var grnWs = getSpreadsheet().getSheetByName('GRN_LOG');
  if (grnWs && grnWs.getLastRow() > 1) {
    var g = grnWs.getDataRange().getValues();
    for (var i = 1; i < g.length; i++) {
      var mat = String(g[i][6] || '').trim();
      var batch = String(g[i][8] || '').trim();
      if (mat === matKey && batch && !grnByBatch[batch]) {
        grnByBatch[batch] = String(g[i][0] || '').trim();
      }
    }
  }
  var dispByGRN = {};
  var iqcWs = getSpreadsheet().getSheetByName('IQC_LOG');
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iq = iqcWs.getDataRange().getValues();
    for (var j = iq.length - 1; j >= 1; j--) {
      var ref = String(iq[j][2] || '').trim();
      if (ref && !dispByGRN[ref]) {
        dispByGRN[ref] = String(iq[j][22] || '').toUpperCase();
      }
    }
  }

  return lots.map(function(l){
    var grnNo = grnByBatch[l.batchOrLotNo] || '';
    var disp  = dispByGRN[grnNo] || 'PENDING';
    var dateOut = '';
    try { if (l.grnDate) dateOut = new Date(l.grnDate).toISOString(); } catch(e){}
    return {
      materialCode:  String(l.materialCode || ''),
      batchOrLotNo:  String(l.batchOrLotNo || ''),
      locationId:    String(l.locationId || ''),
      balance:       Number(l.balance) || 0,
      grnNo:         String(grnNo || ''),
      iqcDisposition: String(disp || ''),
      grnDate:       dateOut
    };
  });
  } catch(err) {
    Logger.log('getProductionLotsForMaterial failed: ' + err.message + ' stack: ' + err.stack);
    throw new Error('Server error in getProductionLotsForMaterial: ' + err.message);
  }
}

// ---------- Diagnostic: explain why a material returns 0 lots ----------

function diagnoseProductionLots(materialCode) {
  var report = { materialCode: materialCode, steps: [] };
  if (!materialCode) { report.steps.push('No materialCode given.'); return report; }

  // Step 1: raw stock summary for this material
  var summary = (typeof getStockSummary === 'function') ? getStockSummary() : [];
  var matRows = summary.filter(function(s){ return s.materialCode === materialCode; });
  report.steps.push('STOCK_LEDGER rows (positive balance) for material: ' + matRows.length);
  matRows.forEach(function(s){
    report.steps.push('  batch=' + s.batchOrLotNo + '  loc=' + s.locationId + '  bal=' + s.balance);
  });

  // Step 2: locations table
  var locTypes = {};
  var locWs = getSpreadsheet().getSheetByName('LOCATIONS');
  if (locWs && locWs.getLastRow() > 1) {
    locWs.getRange(2, 1, locWs.getLastRow() - 1, 12).getValues().forEach(function(r){
      if (r[0]) locTypes[String(r[0]).trim()] = String(r[8] || '').toUpperCase();
    });
  }
  report.steps.push('LOCATIONS table entries: ' + Object.keys(locTypes).length);

  // Step 3: per-lot classification
  matRows.forEach(function(s){
    var t = locTypes[String(s.locationId).trim()] || '(location not in LOCATIONS table)';
    var excluded = (t === 'QUARANTINE' || t === 'SCRAP' || t === 'SAMPLE');
    report.steps.push('  → loc=' + s.locationId + ' type=' + t + (excluded ? '  EXCLUDED by FIFO filter' : '  PASSES filter'));
  });

  // Step 4: what getFIFOLots actually returns
  var lots = (typeof getFIFOLots === 'function') ? getFIFOLots(materialCode) : [];
  report.steps.push('getFIFOLots returns: ' + lots.length + ' lot(s)');

  return report;
}

// ---------- One-time backfill: replay GRN_LOG into STOCK_LEDGER ----------
// Idempotent — skips any GRN whose docNo already appears as a Ref Doc No in
// STOCK_LEDGER. Safe to re-run.

function backfillStockLedgerFromGRN() {
  var ss = getSpreadsheet();
  var grnWs = ss.getSheetByName('GRN_LOG');
  var ledWs = ss.getSheetByName('STOCK_LEDGER');
  if (!grnWs || grnWs.getLastRow() < 2) return { success: false, error: 'No GRN_LOG data.' };
  if (!ledWs) return { success: false, error: 'STOCK_LEDGER not found.' };

  // Build set of (GRN docNo | material | batch) tuples already mirrored.
  // Per-item dedup so multi-item GRNs aren't lost after the first row.
  var mirrored = {};
  if (ledWs.getLastRow() > 1) {
    var led = ledWs.getDataRange().getValues();
    for (var i = 1; i < led.length; i++) {
      var refType = String(led[i][9] || '').trim().toUpperCase();
      var refNo   = String(led[i][10] || '').trim();
      var txnType = String(led[i][2] || '').trim().toUpperCase();
      if (refType === 'GRN' && refNo && txnType === 'GRN_RECEIPT') {
        var mat   = String(led[i][3] || '').trim();
        var btch  = String(led[i][4] || '').trim();
        mirrored[refNo + '|' + mat + '|' + btch] = true;
      }
    }
  }

  var g = grnWs.getDataRange().getValues();
  var receiptsWritten = 0, acceptsWritten = 0, skipped = 0, errors = [];
  var skipReasons = { noDocNo: 0, noMat: 0, noBatch: 0, noLoc: 0, noQty: 0, alreadyMirrored: 0 };

  // First pass: GRN receipts
  for (var r = 1; r < g.length; r++) {
    var docNo   = String(g[r][0] || '').trim();
    var matCode = String(g[r][6] || '').trim();
    var batch   = String(g[r][8] || '').trim();
    var qtyRcvd = Number(g[r][10]) || 0;
    var loc     = String(g[r][20] || '').trim();
    if (!docNo)   { skipped++; skipReasons.noDocNo++; continue; }
    if (!matCode) { skipped++; skipReasons.noMat++;   continue; }
    if (!batch)   { skipped++; skipReasons.noBatch++; continue; }
    if (!loc)     { skipped++; skipReasons.noLoc++;   continue; }
    if (qtyRcvd <= 0) { skipped++; skipReasons.noQty++; continue; }
    var dedupKey = docNo + '|' + matCode + '|' + batch;
    if (mirrored[dedupKey]) { skipped++; skipReasons.alreadyMirrored++; continue; }
    try {
      writeStockLedger_('GRN_RECEIPT', matCode, batch, loc, qtyRcvd, 0,
        'GRN', docNo, String(g[r][16] || ''), 'Backfilled from GRN_LOG');
      receiptsWritten++;
      mirrored[dedupKey] = true;
    } catch(e) {
      errors.push(docNo + ': ' + e.message);
    }
  }

  // Second pass: replay IQC ACCEPT/REJECT markers (idempotent on IQC docNo)
  var ledAfter = ledWs.getDataRange().getValues();
  var iqcMirrored = {};
  for (var k = 1; k < ledAfter.length; k++) {
    var t = String(ledAfter[k][2] || '').trim().toUpperCase();
    var rn = String(ledAfter[k][10] || '').trim();
    if ((t === 'IQC_ACCEPT' || t === 'IQC_REJECT_OUT' || t === 'IQC_REJECT_QUARANTINE') && rn) {
      iqcMirrored[rn] = true;
    }
  }
  var iqcWs = ss.getSheetByName('IQC_LOG');
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iq = iqcWs.getDataRange().getValues();

    // GRN lookup index: docNo -> {loc, batch by material}
    var grnLoc = {};
    for (var gi = 1; gi < g.length; gi++) {
      var gd = String(g[gi][0] || '').trim();
      var gm = String(g[gi][6] || '').trim();
      var gb = String(g[gi][8] || '').trim();
      var gl = String(g[gi][20] || '').trim();
      if (gd && gb) grnLoc[gd + '|' + gb] = { mat: gm, loc: gl };
    }

    for (var j = 1; j < iq.length; j++) {
      var iqcNo  = String(iq[j][0] || '').trim();
      var grnRef = String(iq[j][2] || '').trim();
      var batch2 = String(iq[j][5] || '').trim();
      var disp   = String(iq[j][22] || '').toUpperCase();
      var inspr  = String(iq[j][6] || '');
      if (!iqcNo || !grnRef || !batch2) continue;
      if (iqcMirrored[iqcNo]) continue;
      var ref = grnLoc[grnRef + '|' + batch2];
      if (!ref || !ref.loc || !ref.mat) continue;
      try {
        if (disp === 'ACCEPTED' || disp === 'ACCEPTED WITH DEVIATION' || disp === 'PASS') {
          writeStockLedger_('IQC_ACCEPT', ref.mat, batch2, ref.loc, 0, 0,
            'IQC', iqcNo, inspr, 'Backfilled — IQC pass marker');
          acceptsWritten++;
        }
        // REJECT cases skipped in backfill — accepted qty unknown without manual review
      } catch(e) {
        errors.push(iqcNo + ': ' + e.message);
      }
    }
  }

  return {
    success: true,
    receiptsWritten: receiptsWritten,
    acceptsWritten: acceptsWritten,
    skipped: skipped,
    skipReasons: skipReasons,
    errors: errors
  };
}

function backfillStockLedgerFromGRNUI() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Backfill STOCK_LEDGER',
    'Replay every GRN_LOG row into STOCK_LEDGER (idempotent). Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var res = backfillStockLedgerFromGRN();
  if (!res.success) { ui.alert('Failed', res.error, ui.ButtonSet.OK); return; }
  var sr = res.skipReasons || {};
  var msg = 'GRN receipts written: ' + res.receiptsWritten +
            '\nIQC accept markers: ' + res.acceptsWritten +
            '\nSkipped total: ' + res.skipped +
            '\n  • Already mirrored: ' + (sr.alreadyMirrored || 0) +
            '\n  • Missing doc no: '   + (sr.noDocNo || 0) +
            '\n  • Missing material: ' + (sr.noMat || 0) +
            '\n  • Missing batch: '    + (sr.noBatch || 0) +
            '\n  • Missing location: ' + (sr.noLoc || 0) +
            '\n  • Qty ≤ 0: '          + (sr.noQty || 0) +
            (res.errors.length ? '\n\nErrors:\n' + res.errors.join('\n') : '');
  ui.alert('Backfill complete', msg, ui.ButtonSet.OK);
}

function diagnoseProductionLotsUI() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Diagnose Production Lots', 'Enter material code:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var code = String(resp.getResponseText() || '').trim();
  if (!code) return;
  var report = diagnoseProductionLots(code);
  ui.alert('Diagnosis: ' + code, report.steps.join('\n'), ui.ButtonSet.OK);
}

// ---------- Recent issues ----------

function getRecentProductionIssues(limit) {
  var ws = getProdIssueSheet_();
  if (ws.getLastRow() < 2) return [];
  var n = Math.min(limit || 10, ws.getLastRow() - 1);
  var rows = ws.getRange(ws.getLastRow() - n + 1, 1, n, PROD_ISSUE_HEADERS_.length).getValues();
  return rows.reverse().map(function(r){
    return {
      issueId:     r[0],
      timestamp:   r[1],
      prodOrderNo: r[2],
      materialCode: r[3],
      materialName: r[4],
      batchOrLotNo: r[5],
      locationId:  r[6],
      qtyIssued:   r[7],
      unit:        r[8],
      issuedBy:    r[9],
      grnRef:      r[10],
      remarks:     r[11]
    };
  });
}

// ---------- Multi-lot FIFO allocation ----------
// Given a material and a total qty, returns an allocation plan:
// list of { batch, location, grnNo, iqcDisposition, qtyFromThisLot }
// honoring FIFO order. Skips lots whose IQC is not ACCEPTED (or ACCEPTED W/ DEV).
// If total available < requested, returns shortfall info.
function planFIFOAllocation(materialCode, qtyRequested) {
  var qty = Number(qtyRequested) || 0;
  if (!materialCode || qty <= 0) {
    return { success: false, error: 'Material and qty required.' };
  }
  var lots = getProductionLotsForMaterial(materialCode);
  // Only IQC-pass lots are issuable
  var issuable = lots.filter(function(l){
    var d = String(l.iqcDisposition || '').toUpperCase();
    return d === 'ACCEPTED' || d === 'PASS' || d === 'ACCEPTED WITH DEVIATION';
  });
  if (!issuable.length) {
    return { success: false, error: 'No IQC-passed lots available for this material.' };
  }

  var totalAvailable = 0;
  issuable.forEach(function(l){ totalAvailable += Number(l.balance) || 0; });
  if (totalAvailable < qty) {
    return {
      success: false,
      error: 'Insufficient stock — need ' + qty + ', have ' + totalAvailable + ' across ' + issuable.length + ' lot(s).',
      totalAvailable: totalAvailable
    };
  }

  var remaining = qty;
  var plan = [];
  for (var i = 0; i < issuable.length && remaining > 0; i++) {
    var avail = Number(issuable[i].balance) || 0;
    if (avail <= 0) continue;
    var take = Math.min(avail, remaining);
    plan.push({
      batchOrLotNo: issuable[i].batchOrLotNo,
      locationId:   issuable[i].locationId,
      grnNo:        issuable[i].grnNo,
      iqcDisposition: issuable[i].iqcDisposition,
      qtyFromThisLot: take,
      lotBalance: avail
    });
    remaining -= take;
  }
  return { success: true, plan: plan, totalAllocated: qty, lotCount: plan.length };
}

// ---------- Issue RM multi-lot (executes a plan) ----------
function issueRMMultiLot(data) {
  try {
    var mat   = String(data.materialCode || '').trim();
    var totalQty = Number(data.qtyToIssue) || 0;
    if (!mat || totalQty <= 0) return { success: false, error: 'Material and qty required.' };
    if (!data.productionOrderNo) return { success: false, error: 'Production Order No. required.' };
    if (!data.issuedBy) return { success: false, error: 'Issued By required.' };

    var planResult = planFIFOAllocation(mat, totalQty);
    if (!planResult.success) return planResult;

    var issueId  = getNextDocNumber('prod');
    var mats     = (typeof getMaterials === 'function') ? getMaterials() : [];
    var matName = '', unit = data.unit || '';
    for (var i = 0; i < mats.length; i++) {
      var c = mats[i].code || mats[i].itemCode;
      if (c === mat) {
        matName = mats[i].desc || mats[i].name || '';
        if (!unit) unit = mats[i].unit || '';
        break;
      }
    }

    var ws = getProdIssueSheet_();
    var issuedLots = [];
    for (var j = 0; j < planResult.plan.length; j++) {
      var p = planResult.plan[j];
      // Run the warehouse gate per lot (re-verifies IQC + location + balance)
      var gateResult = issueRMForProduction({
        materialCode:      mat,
        batchOrLotNo:      p.batchOrLotNo,
        locationId:        p.locationId,
        qtyToIssue:        p.qtyFromThisLot,
        productionOrderNo: data.productionOrderNo,
        issuedBy:          data.issuedBy
      });
      if (!gateResult || !gateResult.success) {
        return {
          success: false,
          error: 'Gate failed on lot ' + p.batchOrLotNo + ': ' + (gateResult && gateResult.error || 'unknown'),
          issuedBefore: issuedLots
        };
      }
      // One PROD_ISSUE_LOG row per lot, all sharing the same issueId
      ws.appendRow([
        issueId, new Date(),
        data.productionOrderNo || '',
        mat, matName,
        p.batchOrLotNo, p.locationId,
        p.qtyFromThisLot, unit,
        data.issuedBy || '',
        gateResult.grnNo || p.grnNo || '',
        data.remarks || ('FIFO multi-lot ' + (j+1) + '/' + planResult.plan.length + ' — IQC ' + (gateResult.iqcDisposition || p.iqcDisposition))
      ]);
      ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');
      issuedLots.push({
        batch: p.batchOrLotNo, qty: p.qtyFromThisLot,
        location: p.locationId, balanceAfter: gateResult.balance
      });
    }
    return {
      success: true,
      issueId: issueId,
      totalQty: totalQty,
      lotCount: issuedLots.length,
      lots: issuedLots
    };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// ---------- Issue RM (wraps Warehouse gate + writes PROD_ISSUE_LOG) ----------

function issueRMToProduction(data) {
  try {
    if (typeof issueRMForProduction !== 'function') {
      return { success: false, error: 'Warehouse.issueRMForProduction not loaded.' };
    }
    var gateResult = issueRMForProduction({
      materialCode:      data.materialCode,
      batchOrLotNo:      data.batchOrLotNo,
      locationId:        data.locationId,
      qtyToIssue:        data.qtyToIssue,
      productionOrderNo: data.productionOrderNo,
      issuedBy:          data.issuedBy
    });
    if (!gateResult || !gateResult.success) {
      return gateResult || { success: false, error: 'Issue gate failed.' };
    }

    // Gate passed and STOCK_LEDGER row was written by Warehouse.
    // Now write PROD_ISSUE_LOG for traceable production-side history.
    var issueId  = getNextDocNumber('prod');
    var mats     = (typeof getMaterials === 'function') ? getMaterials() : [];
    var mat = null;
    for (var i = 0; i < mats.length; i++) {
      var c = mats[i].code || mats[i].itemCode;
      if (c === data.materialCode) { mat = mats[i]; break; }
    }
    var matName = mat ? (mat.desc || mat.name || mat.itemDescription || '') : '';
    var unit    = data.unit || (mat ? (mat.unit || '') : '');

    var ws = getProdIssueSheet_();
    ws.appendRow([
      issueId, new Date(),
      data.productionOrderNo || '',
      data.materialCode, matName,
      data.batchOrLotNo, data.locationId,
      Number(data.qtyToIssue) || 0, unit,
      data.issuedBy || '',
      gateResult.grnNo || '',
      data.remarks || ('IQC disp: ' + (gateResult.iqcDisposition || ''))
    ]);
    ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');

    return {
      success: true,
      issueId: issueId,
      balance: gateResult.balance,
      grnNo: gateResult.grnNo,
      iqcDisposition: gateResult.iqcDisposition
    };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}
