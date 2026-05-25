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
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
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
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
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
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
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
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
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
        issuedBy:          data.issuedBy,
        txnType:           data.txnType || 'RM_ISSUE'
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

// ============================================================
// FG/BOM-driven Production Planning
// ============================================================
//
// BOM sheet columns (12):
//   Client, FGIDH, Material Description, Base Quantity, UoM,
//   Component, Mat Desc Component, Quantity (STPO), Comp UoM,
//   Consum (qty per 1 FG), Type, masterP
//
// PROD_JOBS sheet columns (8):
//   Job ID, Timestamp, Client, FG Code, FG Description,
//   FG Qty Issued, UoM, Issue IDs (CSV of PROD_ISSUE_LOG ids)

var BOM_HEADERS_ = [
  'Client', 'FGIDH', 'Material Description', 'Base Quantity', 'UoM',
  'Component', 'Mat Desc Component', 'Quantity (STPO)', 'Comp UoM',
  'Consum', 'Type', 'masterP'
];

var PROD_JOBS_HEADERS_ = [
  'Job ID', 'Timestamp', 'Client', 'FG Code', 'FG Description',
  'FG Qty Issued', 'UoM', 'Issue IDs', 'Status', 'IPQC ID', 'Booking ID', 'Closed At'
];

var PROD_BOOKING_HEADERS_ = [
  'Booking ID', 'Timestamp', 'Job ID', 'IPQC ID', 'FG Code', 'FG Description',
  'FG Produced', 'FG UoM',
  'Component Code', 'Component Name', 'Batch/Lot', 'Location',
  'Booked Qty', 'Consumed', 'Returned', 'Scrap', 'Wastage', 'Loss', 'UoM',
  'Booked By', 'Remarks'
];

function ensureProdBookingSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('PROD_BOOKING_LOG');
  if (!ws) {
    ws = ss.insertSheet('PROD_BOOKING_LOG');
    ws.getRange(1, 1, 1, PROD_BOOKING_HEADERS_.length).setValues([PROD_BOOKING_HEADERS_]);
    ws.setFrozenRows(1);
    ws.getRange(1, 1, 1, PROD_BOOKING_HEADERS_.length)
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  }
  return ws;
}

function ensureBomSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('BOM');
  if (!ws) {
    ws = ss.insertSheet('BOM');
    ws.getRange(1, 1, 1, BOM_HEADERS_.length).setValues([BOM_HEADERS_]);
    ws.setFrozenRows(1);
    ws.getRange(1, 1, 1, BOM_HEADERS_.length)
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
    ws.setColumnWidths(1, BOM_HEADERS_.length, 120);
  }
  return ws;
}

function ensureProdJobsSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('PROD_JOBS');
  if (!ws) {
    ws = ss.insertSheet('PROD_JOBS');
    ws.getRange(1, 1, 1, PROD_JOBS_HEADERS_.length).setValues([PROD_JOBS_HEADERS_]);
    ws.setFrozenRows(1);
    ws.getRange(1, 1, 1, PROD_JOBS_HEADERS_.length)
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  } else {
    // Backfill new columns if sheet pre-dates v172 schema
    var lastCol = ws.getLastColumn();
    if (lastCol < PROD_JOBS_HEADERS_.length) {
      ws.getRange(1, 1, 1, PROD_JOBS_HEADERS_.length).setValues([PROD_JOBS_HEADERS_]);
      ws.getRange(1, 1, 1, PROD_JOBS_HEADERS_.length)
        .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
      // Mark existing rows as BOOKED (legacy behavior treated issue as consumed,
      // but going forward we treat issues as bookings).
      if (ws.getLastRow() > 1) {
        var n = ws.getLastRow() - 1;
        var col9 = ws.getRange(2, 9, n, 1).getValues();
        for (var i = 0; i < n; i++) if (!col9[i][0]) col9[i][0] = 'BOOKED';
        ws.getRange(2, 9, n, 1).setValues(col9);
      }
    }
  }
  return ws;
}

function getBomRows_() {
  var ws = ensureBomSheet_();
  if (ws.getLastRow() < 2) return [];
  var data = ws.getRange(2, 1, ws.getLastRow() - 1, BOM_HEADERS_.length).getValues();
  return data.filter(function(r){ return r[1] && String(r[1]).trim(); }).map(function(r){
    return {
      client:    String(r[0] || '').trim(),
      fgCode:    String(r[1] || '').trim(),
      fgDesc:    String(r[2] || '').trim(),
      baseQty:   Number(r[3]) || 0,
      fgUom:     String(r[4] || '').trim(),
      compCode:  String(r[5] || '').trim(),
      compDesc:  String(r[6] || '').trim(),
      qtyStpo:   Number(r[7]) || 0,
      compUom:   String(r[8] || '').trim(),
      consum:    Number(r[9]) || 0,
      type:      String(r[10] || '').trim(),
      masterP:   Number(r[11]) || 0
    };
  });
}

function getClientList() {
  var seen = {}, out = [];
  getBomRows_().forEach(function(r){
    if (r.client && !seen[r.client]) { seen[r.client] = true; out.push(r.client); }
  });
  return out.sort();
}

function getFGListByClient(client) {
  var key = String(client || '').trim();
  var seen = {}, out = [];
  getBomRows_().forEach(function(r){
    if (key && r.client !== key) return;
    if (!seen[r.fgCode]) {
      seen[r.fgCode] = true;
      out.push({ code: r.fgCode, desc: r.fgDesc, uom: r.fgUom, baseQty: r.baseQty });
    }
  });
  return out.sort(function(a, b){ return a.desc.localeCompare(b.desc); });
}

function getBOMForFG(fgCode) {
  var key = String(fgCode || '').trim();
  if (!key) return [];
  return getBomRows_().filter(function(r){ return r.fgCode === key; });
}

// Get current available stock per component code by summing STOCK_LEDGER
// balances across all IQC-passed lots (reuses getProductionLotsForMaterial).
function getStockForComponents_(compCodes) {
  var stock = {};
  for (var i = 0; i < compCodes.length; i++) {
    var code = compCodes[i];
    if (stock[code] !== undefined) continue;
    var lots = [];
    try { lots = getProductionLotsForMaterial(code) || []; } catch(e){ lots = []; }
    var avail = 0;
    lots.forEach(function(l){
      var d = String(l.iqcDisposition || '').toUpperCase();
      if (d === 'ACCEPTED' || d === 'PASS' || d === 'ACCEPTED WITH DEVIATION') {
        avail += Number(l.balance) || 0;
      }
    });
    stock[code] = avail;
  }
  return stock;
}

function computeProductionPlan(fgCode, fgQtyRequested) {
  var qty = Number(fgQtyRequested) || 0;
  var bom = getBOMForFG(fgCode);
  if (!bom.length) return { success: false, error: 'No BOM found for FG ' + fgCode };
  if (qty <= 0) return { success: false, error: 'FG qty must be > 0' };

  var codes = bom.map(function(b){ return b.compCode; });
  var stock = getStockForComponents_(codes);

  var lines = bom.map(function(b){
    var required   = b.consum * qty;
    var available  = stock[b.compCode] || 0;
    var possibleFG = b.consum > 0 ? Math.floor(available / b.consum) : 0;
    var mp = Number(b.masterP) || 0;
    var packsToIssue = mp > 0 ? Math.ceil(required / mp) : 0;
    var issueQtyRounded = mp > 0 ? packsToIssue * mp : required;
    return {
      compCode:    b.compCode,
      compDesc:    b.compDesc,
      type:        b.type,
      compUom:     b.compUom,
      qtyPerUnit:  b.consum,
      required:    required,
      available:   available,
      possibleFG:  possibleFG,
      shortfall:   Math.max(0, required - available),
      masterP:        mp,
      packsToIssue:   packsToIssue,
      issueQtyRounded: issueQtyRounded
    };
  });

  var maxProducible = lines.reduce(function(m, l){
    return Math.min(m, l.possibleFG);
  }, Number.MAX_SAFE_INTEGER);
  if (maxProducible === Number.MAX_SAFE_INTEGER) maxProducible = 0;

  var bottleneck = null;
  lines.forEach(function(l){
    if (l.possibleFG === maxProducible && !bottleneck) bottleneck = l;
  });

  var fgPerCarton = Number(bom[0].baseQty) || 0;
  var fgCartonsFull   = fgPerCarton > 0 ? Math.floor(qty / fgPerCarton) : 0;
  var fgLooseUnits    = fgPerCarton > 0 ? (qty - fgCartonsFull * fgPerCarton) : qty;

  return {
    success: true,
    fgCode: String(fgCode),
    fgDesc: bom[0].fgDesc,
    fgUom:  bom[0].fgUom,
    fgQtyRequested: qty,
    fgPerCarton:    fgPerCarton,
    fgCartonsFull:  fgCartonsFull,
    fgLooseUnits:   fgLooseUnits,
    maxProducible: maxProducible,
    bottleneck: bottleneck ? { code: bottleneck.compCode, desc: bottleneck.compDesc } : null,
    lines: lines
  };
}

// Issue a production job. Loops each BOM component, calls issueRMMultiLot to
// decrement stock via the existing FIFO + IQC gate. Writes one PROD_JOBS row
// with the rolled-up Issue IDs.
function issueProductionJob(data) {
  try {
    var fgCode = String(data.fgCode || '').trim();
    var fgQty  = Number(data.fgQtyToIssue) || 0;
    var issuedBy = String(data.issuedBy || '').trim();
    var poNo   = String(data.productionOrderNo || '').trim();
    if (!fgCode) return { success: false, error: 'FG code required.' };
    if (fgQty <= 0) return { success: false, error: 'Issue qty must be > 0.' };
    if (!issuedBy) return { success: false, error: 'Issued By required.' };
    if (!poNo) poNo = 'PJ-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

    var plan = computeProductionPlan(fgCode, fgQty);
    if (!plan.success) return plan;
    if (plan.maxProducible < fgQty) {
      return { success: false, error: 'Requested ' + fgQty + ' exceeds maxProducible ' + plan.maxProducible + '. Reduce qty and retry.' };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var issueIds = [];
      var perCompResults = [];
      for (var i = 0; i < plan.lines.length; i++) {
        var line = plan.lines[i];
        var qtyForThisComp = line.issueQtyRounded > 0 ? line.issueQtyRounded : line.required;
        var res = issueRMMultiLot({
          materialCode: line.compCode,
          qtyToIssue: qtyForThisComp,
          unit: line.compUom,
          productionOrderNo: poNo,
          issuedBy: issuedBy,
          txnType: 'PROD_BOOK',
          remarks: 'BOOKED for FG ' + fgCode + ' x' + fgQty +
                   (line.masterP > 0 ? ' (' + line.packsToIssue + ' pack × ' + line.masterP + ' ' + line.compUom + ')' : '')
        });
        if (!res.success) {
          // Partial-issue: prior components have ALREADY been debited inside the
          // same lock. Without a true rollback we surface the issue IDs that
          // need manual reversal. Operator should run reverseProductionIssue
          // for each id in `partial` to restore stock.
          Logger.log('issueProductionJob PARTIAL FAILURE — manual reversal required for: ' +
            perCompResults.map(function(r){ return r.issueId; }).join(', '));
          return {
            success: false,
            error: 'PARTIAL ISSUE — failed on ' + line.compCode + ': ' + res.error +
                   '. Already-debited components: ' +
                   perCompResults.map(function(r){ return r.compCode + '(' + r.issueId + ')'; }).join(', ') +
                   '. Contact admin to reverse these IDs.',
            partial: perCompResults,
            requiresReversal: true
          };
        }
        issueIds.push(res.issueId);
        perCompResults.push({ compCode: line.compCode, issueId: res.issueId, qty: qtyForThisComp, lots: res.lots });
      }

      var jobId = getNextDocNumber('prod') + '-FG';
      var ws = ensureProdJobsSheet_();
      ws.appendRow([
        jobId, new Date(),
        plan.fgDesc ? (getBOMForFG(fgCode)[0].client || '') : '',
        fgCode, plan.fgDesc,
        fgQty, plan.fgUom,
        issueIds.join(', '),
        'BOOKED', '', '', ''
      ]);
      ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');

      return {
        success: true,
        jobId: jobId,
        fgCode: fgCode,
        fgQty: fgQty,
        issueIds: issueIds,
        components: perCompResults
      };
    } finally {
      lock.releaseLock();
    }
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// One-shot: ensures both sheets exist. Callable via clasp run.
function initProductionFGSheets() {
  ensureBomSheet_();
  ensureProdJobsSheet_();
  ensureProdBookingSheet_();
  return { success: true, message: 'BOM, PROD_JOBS, PROD_BOOKING_LOG sheets ready.' };
}

// Returns a printable Issue Slip payload for a job.
// Used by frontend after successful issueProductionJob to render the print view.
function buildIssueSlip(fgCode, fgQty, jobId, issuedBy, poNo) {
  var plan = computeProductionPlan(fgCode, fgQty);
  if (!plan.success) return plan;
  return {
    success: true,
    jobId: jobId || '',
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm'),
    poNo: poNo || '',
    issuedBy: issuedBy || '',
    client: (getBOMForFG(fgCode)[0] || {}).client || '',
    fgCode: plan.fgCode,
    fgDesc: plan.fgDesc,
    fgQty:  fgQty,
    fgUom:  plan.fgUom,
    fgPerCarton: plan.fgPerCarton,
    fgCartonsFull: plan.fgCartonsFull,
    fgLooseUnits:  plan.fgLooseUnits,
    lines: plan.lines
  };
}

// ============================================================
// Production Booking — close out a job against an IPQC session
// ============================================================

// Returns jobs in BOOKED status, ready for production booking.
function getOpenProductionJobs() {
  try {
    var ws = ensureProdJobsSheet_();
    if (!ws || ws.getLastRow() < 2) return [];
    var data = ws.getRange(2, 1, ws.getLastRow() - 1, PROD_JOBS_HEADERS_.length).getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var status = String(data[i][8] || '').toUpperCase();
      if (status !== 'BOOKED') continue;
      var ts = data[i][1];
      var tsMs = (ts instanceof Date) ? ts.getTime() : (Number(new Date(ts).getTime()) || 0);
      out.push({
        jobId:    String(data[i][0] || ''),
        timestamp: tsMs,
        timestampLabel: ts ? Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm') : '',
        client:   String(data[i][2] || ''),
        fgCode:   String(data[i][3] || ''),
        fgDesc:   String(data[i][4] || ''),
        fgQty:    Number(data[i][5]) || 0,
        fgUom:    String(data[i][6] || ''),
        issueIds: String(data[i][7] || '')
      });
    }
    out.sort(function(a, b){ return (b.timestamp || 0) - (a.timestamp || 0); });
    Logger.log('getOpenProductionJobs returning ' + out.length + ' rows');
    return out;
  } catch (e) {
    Logger.log('getOpenProductionJobs error: ' + e);
    return [];
  }
}

// Returns CLOSED IPQC sessions matching a given FG code (and optional batch).
// CLOSED is the proxy for "PASSED" per IPQC.js — only closed sessions count.
function getClosedIPQCSessionsForFG(fgCode, batch) {
  try {
    var ss = getSpreadsheet();
    var ws = ss && ss.getSheetByName('IPQC_Sessions');
    if (!ws || ws.getLastRow() < 2) return [];
    var data = ws.getDataRange().getValues();
    var fg = String(fgCode == null ? '' : fgCode).trim();
    var bt = String(batch == null ? '' : batch).trim();
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var prod = String(data[i][1] == null ? '' : data[i][1]).trim();
      var batch_ = String(data[i][3] == null ? '' : data[i][3]).trim();
      var status = String(data[i][9] || '').toUpperCase().trim();
      if (status !== 'CLOSED') continue;
      if (fg && prod !== fg) continue;
      if (bt && batch_ !== bt) continue;
      var dt = data[i][6];
      var dtMs = (dt instanceof Date) ? dt.getTime() : (Number(new Date(dt).getTime()) || 0);
      out.push({
        sessionId: String(data[i][0] || ''),
        productCode: prod,
        productName: String(data[i][2] || ''),
        batch:    batch_,
        inspector: String(data[i][4] || ''),
        line:     String(data[i][5] || ''),
        date:     dtMs,
        dateLabel: dt ? Utilities.formatDate(new Date(dt), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
        rounds:   Number(data[i][10]) || 0
      });
    }
    out.sort(function(a, b){ return (b.date || 0) - (a.date || 0); });
    Logger.log('getClosedIPQCSessionsForFG(' + fg + ') returning ' + out.length + ' rows');
    return out;
  } catch (e) {
    Logger.log('getClosedIPQCSessionsForFG error: ' + e);
    return [];
  }
}

// Reads STOCK_LEDGER for PROD_BOOK rows tagged to a given Production Order No.
// Returns per-component-per-lot booked qty (sum of qtyOut where txn=PROD_BOOK
// and refDocNo === poNo).
function getJobBookedDetail(jobId) {
  var ws = ensureProdJobsSheet_();
  if (ws.getLastRow() < 2) return { success: false, error: 'No jobs.' };
  var jobsData = ws.getDataRange().getValues();
  var job = null;
  for (var i = 1; i < jobsData.length; i++) {
    if (String(jobsData[i][0]).trim() === String(jobId).trim()) {
      job = {
        jobId:   jobsData[i][0], client: jobsData[i][2], fgCode: jobsData[i][3],
        fgDesc:  jobsData[i][4], fgQty:  Number(jobsData[i][5]) || 0,
        fgUom:   jobsData[i][6], status: jobsData[i][8]
      };
      break;
    }
  }
  if (!job) return { success: false, error: 'Job not found.' };
  if (String(job.status).toUpperCase() !== 'BOOKED') {
    return { success: false, error: 'Job status is ' + job.status + '; only BOOKED jobs can be booked into production.' };
  }

  // Find PROD_ISSUE_LOG rows for this job (used as join key to ledger via PO no)
  // The PROD_ISSUE_LOG row 2 = Timestamp, row 3 = Production Order No. We can also
  // find rows by matching Material + Batch + Location.
  // Simpler: scan STOCK_LEDGER for PROD_BOOK txns where remarks contain jobId OR
  // refDocNo matches the issued PO numbers. We use the issueIds list from PROD_JOBS.
  // But cleanest: scan PROD_ISSUE_LOG rows whose Issue ID is in this job's CSV.
  var jobsIssueIds = String(jobsData[i-1] !== undefined ? jobsData[i-1][7] : '').trim();
  // Re-find the job's row index for the CSV
  for (var k = 1; k < jobsData.length; k++) {
    if (String(jobsData[k][0]).trim() === String(jobId).trim()) {
      jobsIssueIds = String(jobsData[k][7] || '');
      break;
    }
  }
  var issueIdSet = {};
  jobsIssueIds.split(',').map(function(s){ return s.trim(); }).filter(Boolean).forEach(function(s){ issueIdSet[s] = true; });

  var pilWs = getProdIssueSheet_();
  var pilData = pilWs.getDataRange().getValues();
  // Build BOM consum-lookup keyed by component code for this FG.
  var bomLines = getBOMForFG(job.fgCode) || [];
  var consumByComp = {};
  bomLines.forEach(function(b){
    if (b && b.compCode) consumByComp[String(b.compCode).trim()] = Number(b.consum) || 0;
  });
  // PROD_ISSUE_LOG: Issue ID[0], Timestamp[1], PO[2], MatCode[3], MatName[4], Batch[5], Loc[6], Qty[7], Unit[8], ...
  var lines = [];
  for (var p = 1; p < pilData.length; p++) {
    var iid = String(pilData[p][0] || '').trim();
    if (!issueIdSet[iid]) continue;
    var code = String(pilData[p][3] || '').trim();
    lines.push({
      compCode:   code,
      compName:   String(pilData[p][4] || ''),
      batchOrLot: String(pilData[p][5] || ''),
      location:   String(pilData[p][6] || ''),
      bookedQty:  Number(pilData[p][7]) || 0,
      uom:        String(pilData[p][8] || ''),
      consum:     consumByComp[code] || 0
    });
  }

  return { success: true, job: job, lines: lines };
}

// Commits a production booking. Inputs:
//   data.jobId
//   data.ipqcId
//   data.fgProduced (number)
//   data.bookedBy
//   data.remarks (optional)
//   data.lines: [{compCode, batchOrLot, location, uom, consumed, returned, scrap, wastage, loss}]
// For each line, writes the appropriate STOCK_LEDGER txns and one PROD_BOOKING_LOG row.
function submitProductionBooking(data) {
  try {
    var jobId  = String(data.jobId || '').trim();
    var ipqcId = String(data.ipqcId || '').trim();
    var fgProd = Number(data.fgProduced) || 0;
    var bookedBy = String(data.bookedBy || '').trim();
    if (!jobId)  return { success: false, error: 'Job ID required.' };
    if (!ipqcId) return { success: false, error: 'IPQC session required.' };
    if (fgProd < 0) return { success: false, error: 'FG produced must be ≥ 0.' };
    if (!bookedBy) return { success: false, error: 'Booked By required.' };
    if (!data.lines || !data.lines.length) return { success: false, error: 'No component lines.' };

    var detail = getJobBookedDetail(jobId);
    if (!detail.success) return detail;

    // Validate: each line's (consumed+returned+scrap+wastage+loss) must equal bookedQty
    // (allow tiny float drift)
    var bookedMap = {};
    detail.lines.forEach(function(L){
      bookedMap[L.compCode + '|' + L.batchOrLot + '|' + L.location] = L;
    });
    var validationErrors = [];
    for (var i = 0; i < data.lines.length; i++) {
      var ln = data.lines[i];
      var key = ln.compCode + '|' + ln.batchOrLot + '|' + ln.location;
      var src = bookedMap[key];
      if (!src) { validationErrors.push('Unknown line: ' + key); continue; }
      var sum = (Number(ln.consumed)||0) + (Number(ln.returned)||0) +
                (Number(ln.scrap)||0) + (Number(ln.wastage)||0) + (Number(ln.loss)||0);
      if (Math.abs(sum - src.bookedQty) > 0.001) {
        validationErrors.push(ln.compCode + ' ' + ln.batchOrLot + ': split sum ' + sum.toFixed(3) +
          ' ≠ booked ' + src.bookedQty.toFixed(3));
      }
    }
    if (validationErrors.length) {
      return { success: false, error: 'Split mismatch:\n' + validationErrors.join('\n') };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var bookingId = getNextDocNumber('prod') + '-BK';
      var bookWs = ensureProdBookingSheet_();
      var ledgerOps = 0;

      for (var j = 0; j < data.lines.length; j++) {
        var L = data.lines[j];
        var src2 = bookedMap[L.compCode + '|' + L.batchOrLot + '|' + L.location];
        var consumed = Number(L.consumed) || 0;
        var returned = Number(L.returned) || 0;
        var scrap    = Number(L.scrap)    || 0;
        var wastage  = Number(L.wastage)  || 0;
        var loss     = Number(L.loss)     || 0;

        // PROD_CONSUME — finalise: removes from booked, no free change
        if (consumed > 0) {
          writeStockLedger_('PROD_CONSUME', L.compCode, L.batchOrLot, L.location,
            0, 0, 'PRODUCTION', jobId, bookedBy,
            'Consumed ' + consumed + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
        }
        // PROD_RETURN — returns to free stock at original location
        if (returned > 0) {
          writeStockLedger_('PROD_RETURN', L.compCode, L.batchOrLot, L.location,
            returned, 0, 'PRODUCTION', jobId, bookedBy,
            'Returned ' + returned + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
        }
        // PROD_SCRAP / PROD_WASTAGE / PROD_LOSS — informational, no free change
        if (scrap > 0) {
          writeStockLedger_('PROD_SCRAP', L.compCode, L.batchOrLot, L.location,
            0, 0, 'PRODUCTION', jobId, bookedBy,
            'Scrap ' + scrap + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
        }
        if (wastage > 0) {
          writeStockLedger_('PROD_WASTAGE', L.compCode, L.batchOrLot, L.location,
            0, 0, 'PRODUCTION', jobId, bookedBy,
            'Wastage ' + wastage + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
        }
        if (loss > 0) {
          writeStockLedger_('PROD_LOSS', L.compCode, L.batchOrLot, L.location,
            0, 0, 'PRODUCTION', jobId, bookedBy,
            'Process loss ' + loss + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
        }

        bookWs.appendRow([
          bookingId, new Date(), jobId, ipqcId,
          detail.job.fgCode, detail.job.fgDesc, fgProd, detail.job.fgUom,
          L.compCode, src2.compName, L.batchOrLot, L.location,
          src2.bookedQty, consumed, returned, scrap, wastage, loss, src2.uom,
          bookedBy, String(data.remarks || '')
        ]);
        bookWs.getRange(bookWs.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');
      }

      // Flip job status to PRODUCED + write IPQC ID + Booking ID + Closed At
      var jobsWs = ensureProdJobsSheet_();
      var jobsData = jobsWs.getDataRange().getValues();
      for (var r = 1; r < jobsData.length; r++) {
        if (String(jobsData[r][0]).trim() === jobId) {
          jobsWs.getRange(r + 1, 9, 1, 4).setValues([['PRODUCED', ipqcId, bookingId, new Date()]]);
          jobsWs.getRange(r + 1, 12).setNumberFormat('dd-MMM-yyyy HH:mm');
          break;
        }
      }

      return {
        success: true,
        bookingId: bookingId,
        jobId: jobId,
        ipqcId: ipqcId,
        fgProduced: fgProd,
        ledgerOps: ledgerOps,
        linesBooked: data.lines.length
      };
    } finally {
      lock.releaseLock();
    }
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function getRecentProductionBookings(limit) {
  var ws = ensureProdBookingSheet_();
  if (ws.getLastRow() < 2) return [];
  var n = Math.min(limit || 15, ws.getLastRow() - 1);
  var rows = ws.getRange(ws.getLastRow() - n + 1, 1, n, PROD_BOOKING_HEADERS_.length).getValues();
  return rows.reverse().map(function(r){
    return {
      bookingId: r[0], timestamp: r[1], jobId: r[2], ipqcId: r[3],
      fgCode: r[4], fgDesc: r[5], fgProduced: r[6], fgUom: r[7],
      compCode: r[8], compName: r[9], batch: r[10], location: r[11],
      booked: r[12], consumed: r[13], returned: r[14],
      scrap: r[15], wastage: r[16], loss: r[17], uom: r[18],
      bookedBy: r[19]
    };
  });
}

function diag_openJobs() {
  _diagRequireOwner_();
  return JSON.stringify(getOpenProductionJobs(), null, 2);
}

function diag_getClosedIPQC(fgCode) {
  _diagRequireOwner_();
  return JSON.stringify(getClosedIPQCSessionsForFG(fgCode, ''), null, 2);
}

function diag_ipqcSessions(fgCode) {
  _diagRequireOwner_();
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('IPQC_Sessions');
  if (!ws) return JSON.stringify({ error: 'IPQC_Sessions sheet not found' });
  var n = ws.getLastRow();
  var hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var rows = n > 1 ? ws.getRange(2, 1, n - 1, ws.getLastColumn()).getValues() : [];
  var fg = String(fgCode || '').trim();
  var matches = rows.filter(function(r){
    return !fg || String(r[1] || '').trim() === fg;
  }).map(function(r){
    return {
      sessionId: r[0], productCode: r[1], productName: r[2], batch: r[3],
      inspector: r[4], line: r[5], date: r[6], col7: r[7], col8: r[8],
      status: r[9], rounds: r[10],
      statusType: typeof r[9],
      statusRaw: JSON.stringify(r[9])
    };
  });
  return JSON.stringify({ totalRows: n - 1, headers: hdr, filterFG: fg, matches: matches }, null, 2);
}

function diag_prodJobs() {
  _diagRequireOwner_();
  var ws = ensureProdJobsSheet_();
  var n = ws.getLastRow();
  var hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var rows = n > 1 ? ws.getRange(2, 1, n - 1, ws.getLastColumn()).getValues() : [];
  return JSON.stringify({
    totalRows: n - 1,
    headers: hdr,
    rows: rows
  }, null, 2);
}

function diag_lastGRNs(n) {
  _diagRequireOwner_();
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return { error: 'no GRN_LOG' };
  var data = ws.getDataRange().getValues();
  var limit = Math.min(Number(n) || 8, data.length - 1);
  var rows = [];
  for (var i = data.length - limit; i < data.length; i++) {
    if (i < 1) continue;
    rows.push({ row: i+1, docNo: data[i][0], matCode: data[i][6], matDesc: data[i][7], batch: data[i][8], qty: data[i][10], unit: data[i][11] });
  }
  // group by docNo
  var grouped = {};
  rows.forEach(function(r){ (grouped[r.docNo] = grouped[r.docNo] || []).push(r); });
  return { totalRows: data.length - 1, lastN: rows.length, byDoc: grouped };
}

function diag_grnRows(grnNo) {
  _diagRequireOwner_();
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return { error: 'no GRN_LOG' };
  var data = ws.getDataRange().getValues();
  var hits = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(grnNo).trim()) {
      hits.push({
        row: i+1, docNo: data[i][0], matCode: data[i][6], matDesc: data[i][7],
        batch: data[i][8], qtyRcv: data[i][10], unit: data[i][11]
      });
    }
  }
  return { grnNo: grnNo, hits: hits.length, rows: hits };
}

function diag_grnHtmlCheck() {
  _diagRequireOwner_();
  var html = getFormHtml('GRN');
  return {
    bytes: html.length,
    hasExtraSection: html.indexOf('extra-items-section') !== -1,
    hasAddBtn: html.indexOf('btnAddItem') !== -1,
    hasAddFn: html.indexOf('function addExtraItem') !== -1,
    hasCollectFn: html.indexOf('collectExtraItems') !== -1,
    snippetAtSection: (function(){
      var i = html.indexOf('extra-items-section');
      return i >= 0 ? html.substring(i - 50, i + 200) : '(not found)';
    })()
  };
}

function diag_dumpBom(limit) {
  _diagRequireOwner_();
  var ws = ensureBomSheet_();
  var n = ws.getLastRow();
  var hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var rows = [];
  if (n > 1) {
    var cap = Math.min(Number(limit) || 10, n - 1);
    rows = ws.getRange(2, 1, cap, ws.getLastColumn()).getValues();
  }
  return JSON.stringify({ totalRows: n - 1, headers: hdr, sample: rows }, null, 2);
}
