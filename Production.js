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

  // Resolve IQC disposition per batch — request-scoped cached GRN/IQC snapshots
  // (ProductionReadCache.js), with direct-read fallback if that module is absent.
  var grnByBatch = {}, dispByGRN;
  if (typeof prodGrnByBatch_ === 'function' && typeof prodDispByGRN_ === 'function') {
    var noByMatBatch = prodGrnByBatch_().grnByBatch.noByMatBatch;
    lots.forEach(function(l){
      var b = String(l.batchOrLotNo || '').trim();
      if (b) grnByBatch[b] = noByMatBatch[matKey + '|' + b] || '';
    });
    dispByGRN = prodDispByGRN_();
  } else {
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
    dispByGRN = {};
    var iqcWs = getSpreadsheet().getSheetByName('IQC_LOG');
    if (iqcWs && iqcWs.getLastRow() > 1) {
      var iq = iqcWs.getDataRange().getValues();
      for (var j = iq.length - 1; j >= 1; j--) {
        var ref   = String(iq[j][2] || '').trim();
        var bch   = String(iq[j][5] || '').trim();
        if (!ref) continue;
        var k = ref + '|' + bch;
        if (dispByGRN[k] === undefined) dispByGRN[k] = String(iq[j][22] || '').toUpperCase();
      }
    }
  }

  return lots.map(function(l){
    var batch = String(l.batchOrLotNo || '').trim();
    var grnNo = grnByBatch[batch] || '';
    // Disposition is per-batch (GRN|batch), never per-GRN — see prodDispByGRN_.
    var disp  = dispByGRN[grnNo + '|' + batch] || 'PENDING';
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
  // Serialize Date cells to ISO strings — google.script.run cannot structured-clone
  // an array containing raw Date objects; it silently returns {} and the client
  // success handler sees an empty/non-array value (the "No production issues yet" bug).
  return rows.reverse().map(function(r){
    return {
      issueId:     r[0],
      timestamp:   (r[1] instanceof Date) ? r[1].toISOString() : r[1],
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
      // Resolved from MASTERS_Customers by name, so callers can filter by the
      // stable CODE instead of a display name. Deliberately NOT a new BOM column:
      // adding one would change the sheet's shape for a value that is already
      // derivable, and this codebase's worst breaks came from widening sheets
      // that positional readers index into.
      clientCode: _bomClientCodeFor_(String(r[0] || '').trim()),
      fgCode:    String(r[1] || '').trim(),
      fgDesc:    String(r[2] || '').trim(),
      baseQty:   Number(r[3]) || 0,
      fgUom:     String(r[4] || '').trim(),
      compCode:  String(r[5] || '').trim(),
      compDesc:  String(r[6] || '').trim(),
      qtyStpo:   Number(r[7]) || 0,
      compUom:   String(r[8] || '').trim(),
      consum:    Number(r[9]) || 0,
      // DERIVED, not read from BOM col K. That column held 23 spellings for the
      // ~20 values MASTERS_Materials.Category already carries, case-split three
      // ways (LABEL/Labels/label, Bulk/BULK, Tape/TAPE). Every BOM component
      // resolves to a material (?diag=vocabaudit: 0 unresolved), so the master
      // is the single source and col K was a duplicate that could only drift.
      // Falls back to the stored value if a code somehow does not resolve, so
      // this can never show LESS than before.
      type:      _bomTypeFor_(String(r[5] || '').trim()) || String(r[10] || '').trim(),
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
  var keyU = key.toUpperCase();
  var seen = {}, out = [];
  getBomRows_().forEach(function(r){
    // Match on CODE or NAME, case-insensitively. BOM.Client stores a display
    // NAME and MASTERS_Customers is keyed by CODE, so the old exact-equality
    // check (r.client !== key) silently returned an EMPTY FG list the moment a
    // client name differed in case or was edited — no error, just no products.
    // The master already says "DORF KETAL" where BOM says "Dorf Ketal", so this
    // only worked because the caller happened to pass BOM's spelling back.
    // CustomerReturn.js:48 already lowercases for the same reason; that was one
    // site patched, not the cause.
    if (key) {
      var matches = (String(r.client || '').trim().toUpperCase() === keyU) ||
                    (String(r.clientCode || '').trim().toUpperCase() === keyU);
      if (!matches) return;
    }
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

/**
 * reverseProductionIssue — restore stock for components already debited when a
 * multi-component job fails partway. Writes an offsetting PROD_BOOK_REVERSE credit for
 * each lot that was consumed. `components` is the perCompResults array built by
 * issueProductionJob: [{ compCode, issueId, qty, lots:[{batch,qty,location}] }].
 * Returns { success, reversedLots, credited }.
 */
function reverseProductionIssue(components, jobRef, operator) {
  var reversedLots = 0, credited = 0, errors = [];
  (components || []).forEach(function (comp) {
    (comp.lots || []).forEach(function (lot) {
      var q = Number(lot.qty) || 0;
      if (q <= 0) return;
      try {
        writeStockLedger_('PROD_BOOK_REVERSE', comp.compCode, lot.batch, lot.location,
          q, 0, 'PRODUCTION', jobRef || comp.issueId, operator || '',
          'Auto-reversal of partial issue ' + comp.issueId + ' (' + comp.compCode + ')');
        reversedLots++; credited += q;
      } catch (e) {
        errors.push(comp.compCode + '/' + lot.batch + ': ' + e.message);
      }
    });
  });
  return { success: errors.length === 0, reversedLots: reversedLots, credited: credited, errors: errors };
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
          // Partial-issue: prior components were debited inside this lock. Roll them
          // back automatically so stock is never left wrongly decremented, then fail.
          // CRITICAL (#4): also reverse the lots the FAILING component itself already
          // issued before it hit the bad lot — issueRMMultiLot returns them in
          // res.issuedBefore. Omitting them orphans those PROD_BOOK debits (silent
          // stock loss), since perCompResults only holds fully-successful components.
          var reverseList = perCompResults.slice();
          if (res.issuedBefore && res.issuedBefore.length) {
            reverseList.push({ compCode: line.compCode, issueId: (res.issueId || ''), qty: 0, lots: res.issuedBefore });
          }
          var rev = reverseProductionIssue(reverseList, poNo, issuedBy);
          Logger.log('issueProductionJob PARTIAL FAILURE on ' + line.compCode +
            ' — auto-reversed ' + rev.reversedLots + ' lot(s), credited ' + rev.credited +
            (rev.errors.length ? ' [reversal errors: ' + rev.errors.join('; ') + ']' : ''));
          return {
            success: false,
            error: 'Could not issue ' + line.compCode + ': ' + res.error +
                   '. The ' + perCompResults.length + ' component(s) issued before it were ' +
                   (rev.success ? 'automatically returned to stock — no job was created. Please retry.'
                                : 'partially reversed; some lots need manual review: ' + rev.errors.join('; ')),
            partial: perCompResults,
            reversal: rev,
            requiresReversal: !rev.success
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
        'IN_PROGRESS', '', '', ''
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

// ------------------------------------------------------------
// PICK-LIST PREVIEW — per-component FIFO lots with locations.
// Read-only. Used by Production_F to show operators which racks/lots to pull
// BEFORE they commit issueProductionJob. Each component returns its rounded
// issue qty (computeProductionPlan) split across lots in FIFO order.
// Returns: { success, fgCode, fgDesc, fgQty, components: [
//   { compCode, compDesc, type, compUom, required, issueQty, shortfall,
//     lots: [ { batch, location, grnNo, qty, iqcDisposition } ] } ] }
// ------------------------------------------------------------
function previewProductionPickList(fgCode, fgQty) {
  try {
    var plan = computeProductionPlan(fgCode, fgQty);
    if (!plan.success) return plan;

    var out = {
      success: true,
      timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm'),
      fgCode: plan.fgCode,
      fgDesc: plan.fgDesc,
      fgUom:  plan.fgUom,
      fgQty:  Number(fgQty) || 0,
      fgPerCarton:   plan.fgPerCarton,
      fgCartonsFull: plan.fgCartonsFull,
      fgLooseUnits:  plan.fgLooseUnits,
      components: []
    };

    plan.lines.forEach(function(line){
      var qtyForThis = line.issueQtyRounded > 0 ? line.issueQtyRounded : line.required;
      var compEntry = {
        compCode: line.compCode,
        compDesc: line.compDesc,
        type:     line.type,
        compUom:  line.compUom,
        required: line.required,
        issueQty: qtyForThis,
        masterP:  line.masterP,
        packsToIssue: line.packsToIssue,
        shortfall: line.shortfall,
        lots:     [],
        error:    null
      };
      if (qtyForThis <= 0) { out.components.push(compEntry); return; }
      var alloc = planFIFOAllocation(line.compCode, qtyForThis);
      if (!alloc.success) {
        compEntry.error = alloc.error;
      } else {
        compEntry.lots = (alloc.plan || []).map(function(p){
          return {
            batch:           p.batchOrLotNo,
            location:        p.locationId,
            grnNo:           p.grnNo || '',
            iqcDisposition:  p.iqcDisposition || '',
            qty:             p.qtyFromThisLot
          };
        });
      }
      out.components.push(compEntry);
    });
    return out;
  } catch(e) {
    Logger.log('previewProductionPickList error: ' + e);
    return { success: false, error: e.message };
  }
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

// Returns jobs in IN_PROGRESS status, ready for production booking.
function getOpenProductionJobs() {
  try {
    var ws = ensureProdJobsSheet_();
    if (!ws || ws.getLastRow() < 2) return [];
    var data = ws.getRange(2, 1, ws.getLastRow() - 1, PROD_JOBS_HEADERS_.length).getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var status = String(data[i][8] || '').toUpperCase();
      if (status !== 'IN_PROGRESS' && status !== 'BOOKED') continue; // BOOKED kept for legacy rows
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
  var jobStatusUp = String(job.status).toUpperCase();
  if (jobStatusUp !== 'IN_PROGRESS' && jobStatusUp !== 'BOOKED') {
    return { success: false, error: 'Job status is ' + job.status + '; only IN_PROGRESS jobs can be booked into production.' };
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
  // AGGREGATE by compCode|batch|location (#12): a component can be issued across
  // multiple FIFO passes that draw from the SAME batch+location, producing two rows.
  // submitProductionBooking keys bookedMap by that same tuple, so un-merged rows would
  // collapse and its reversal would credit only the LAST row's qty, under-reversing the
  // rest. Summing bookedQty here makes one line per tuple with the true total.
  var lineMap = {};
  var lineOrder = [];
  for (var p = 1; p < pilData.length; p++) {
    var iid = String(pilData[p][0] || '').trim();
    if (!issueIdSet[iid]) continue;
    var code = String(pilData[p][3] || '').trim();
    var batch = String(pilData[p][5] || '');
    var loc   = String(pilData[p][6] || '');
    var key   = code + '|' + batch + '|' + loc;
    if (!lineMap[key]) {
      lineMap[key] = {
        compCode:   code,
        compName:   String(pilData[p][4] || ''),
        batchOrLot: batch,
        location:   loc,
        bookedQty:  0,
        uom:        String(pilData[p][8] || ''),
        consum:     consumByComp[code] || 0
      };
      lineOrder.push(key);
    }
    lineMap[key].bookedQty += Number(pilData[p][7]) || 0;
  }
  var lines = lineOrder.map(function(k){ return lineMap[k]; });

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
      // Re-check job status INSIDE the lock to block a double-submit: the status read in
      // getJobBookedDetail() above happens before the lock, so two rapid submits could both
      // pass it. Re-reading here ensures the second caller sees the first's COMPLETED flip.
      var reDetail = getJobBookedDetail(jobId);
      if (!reDetail.success) return reDetail;

      // Bound fgProduced: it cannot exceed the job's planned FG quantity (guards fat-finger
      // over-booking). detail.job.fgQty is the ordered/planned FG count.
      var plannedFg = Number(reDetail.job && reDetail.job.fgQty) || Number(detail.job && detail.job.fgQty) || 0;
      if (plannedFg > 0 && fgProd > plannedFg + 0.001) {
        return { success: false, error: 'FG produced (' + fgProd + ') exceeds the planned ' +
                 plannedFg + ' for this job. Re-check the quantity.' };
      }

      var bookingId = getNextDocNumber('prod') + '-BK';
      var bookWs = ensureProdBookingSheet_();
      var ledgerOps = 0;

      // Lines whose ledger rows are already written this pass. If a later line throws
      // mid-loop we credit these back — otherwise the operator's natural retry replays
      // them (bookedQty is derived from PROD_ISSUE_LOG, so earlier writes are invisible
      // to the recomputation) and balances diverge. Same compensating-reversal pattern
      // issueProductionJob already uses; reuses reverseProductionIssue.
      var bookedUndo = [];
      try {

      for (var j = 0; j < data.lines.length; j++) {
        var L = data.lines[j];
        var src2 = bookedMap[L.compCode + '|' + L.batchOrLot + '|' + L.location];
        var consumed = Number(L.consumed) || 0;
        var returned = Number(L.returned) || 0;
        var scrap    = Number(L.scrap)    || 0;
        var wastage  = Number(L.wastage)  || 0;
        var loss     = Number(L.loss)     || 0;

        // ── Reverse the original PROD_BOOK reservation in full (credit it back), then
        // debit only what actually left stock (consume/scrap/wastage/loss). Returned qty
        // needs NO separate credit — it is already restored by reversing the full booking.
        // Net effect on the ledger = -(consumed+scrap+wastage+loss), which is correct.
        // (Previously the BOOK debit was never reversed, so consumed was debited twice.)
        // Record EACH write into bookedUndo the instant it commits, BEFORE the next write.
        // A throw mid-line (e.g. LOCK_TIMEOUT between the reverse-credit and the consume-
        // debit) must still leave the reverse-credit in the undo list — pushing one entry
        // per line at the end stranded the failing line's already-committed rows.
        var bookedQty2 = Number(src2.bookedQty) || 0;
        if (bookedQty2 > 0) {
          writeStockLedger_('PROD_BOOK_REVERSE', L.compCode, L.batchOrLot, L.location,
            bookedQty2, 0, 'PRODUCTION', jobId, bookedBy,
            'Reversed booking of ' + bookedQty2 + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
          // credit written → undo by debiting it back
          bookedUndo.push({ compCode: L.compCode, batch: L.batchOrLot, location: L.location, undoIn: 0, undoOut: bookedQty2 });
        }
        if (consumed > 0) {
          writeStockLedger_('PROD_CONSUME', L.compCode, L.batchOrLot, L.location,
            0, consumed, 'PRODUCTION', jobId, bookedBy,
            'Consumed ' + consumed + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
          bookedUndo.push({ compCode: L.compCode, batch: L.batchOrLot, location: L.location, undoIn: consumed, undoOut: 0 });
        }
        // Returned qty needs no ledger row — reversing the full booking already put it back.
        if (scrap > 0) {
          writeStockLedger_('PROD_SCRAP', L.compCode, L.batchOrLot, L.location,
            0, scrap, 'PRODUCTION', jobId, bookedBy,
            'Scrap ' + scrap + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
          bookedUndo.push({ compCode: L.compCode, batch: L.batchOrLot, location: L.location, undoIn: scrap, undoOut: 0 });
        }
        if (wastage > 0) {
          writeStockLedger_('PROD_WASTAGE', L.compCode, L.batchOrLot, L.location,
            0, wastage, 'PRODUCTION', jobId, bookedBy,
            'Wastage ' + wastage + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
          bookedUndo.push({ compCode: L.compCode, batch: L.batchOrLot, location: L.location, undoIn: wastage, undoOut: 0 });
        }
        if (loss > 0) {
          writeStockLedger_('PROD_LOSS', L.compCode, L.batchOrLot, L.location,
            0, loss, 'PRODUCTION', jobId, bookedBy,
            'Process loss ' + loss + ' ' + (src2.uom || '') + ' (booking ' + bookingId + ')');
          ledgerOps++;
          bookedUndo.push({ compCode: L.compCode, batch: L.batchOrLot, location: L.location, undoIn: loss, undoOut: 0 });
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

      } catch (loopErr) {
        // Mid-loop failure: undo BOTH sides of every line already written so a retry
        // starts from the pre-booking state. Written directly (not via
        // reverseProductionIssue, which only credits) because each line needs a debit
        // AND a credit to cancel out exactly.
        // Each bookedUndo entry is ONE committed write; its exact inverse cancels it
        // (undoIn/undoOut are already the mirror of the original qtyIn/qtyOut).
        var undo = { reversedLots: 0, credited: 0, errors: [] };
        bookedUndo.forEach(function(u){
          try {
            writeStockLedger_('PROD_BOOK_ROLLBACK', u.compCode, u.batch, u.location,
              u.undoIn, u.undoOut, 'PRODUCTION', jobId, bookedBy,
              'Rollback of failed booking ' + bookingId);
            undo.credited += (Number(u.undoIn) || 0);
            undo.reversedLots++;
          } catch (ue) { undo.errors.push(u.compCode + '/' + u.batch + ': ' + ue.message); }
        });
        undo.success = undo.errors.length === 0;
        // PROD_BOOKING_LOG rows for this aborted bookingId are orphans — stamp them VOID
        // so reports don't count them. ponytail: stamp-in-place, no delete (audit trail).
        try {
          var bkData = bookWs.getDataRange().getValues();
          for (var vb = bkData.length - 1; vb >= 1; vb--) {
            if (String(bkData[vb][0]).trim() === bookingId) {
              bookWs.getRange(vb + 1, 21).setValue('VOID (booking failed, rolled back)');
            }
          }
        } catch (ve) { Logger.log('void-stamp failed: ' + ve.message); }
        Logger.log('submitProductionBooking PARTIAL FAILURE on job ' + jobId + ': ' + loopErr.message +
          ' — reversed ' + undo.reversedLots + ' lot(s), credited ' + undo.credited +
          (undo.errors.length ? ' [reversal errors: ' + undo.errors.join('; ') + ']' : ''));
        return {
          success: false,
          error: 'Booking failed on ' + loopErr.message + '. ' +
                 (undo.success ? 'Partial writes were rolled back — the job is unchanged, please retry.'
                               : 'Partial writes could NOT be fully rolled back; contact admin before retrying: ' + undo.errors.join('; ')),
          requiresReview: !undo.success,
          reversal: undo
        };
      }

      // Flip job status to PRODUCED + write IPQC ID + Booking ID + Closed At
      var jobsWs = ensureProdJobsSheet_();
      var jobsData = jobsWs.getDataRange().getValues();
      for (var r = 1; r < jobsData.length; r++) {
        if (String(jobsData[r][0]).trim() === jobId) {
          jobsWs.getRange(r + 1, 9, 1, 4).setValues([['COMPLETED', ipqcId, bookingId, new Date()]]);
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

/**
 * cancelProductionJob — un-issue an IN_PROGRESS job: credit every booked lot back to
 * stock and mark the job CANCELLED. Without this a job whose FG has no CLOSED IPQC
 * session can never be booked and its PROD_BOOK debit is stranded forever, making every
 * later plan show false shortfalls.
 * ponytail: reuses reverseProductionIssue (the same compensating-credit loop the issue
 * path already uses) — no new ledger logic.
 * Returns { success, jobId, reversedLots, credited } or { success:false, error }.
 */
function cancelProductionJob(jobId, cancelledBy, reason) {
  try {
    var id = String(jobId || '').trim();
    if (!id) return { success: false, error: 'Job ID required.' };
    var who = String(cancelledBy || '').trim();
    if (!who) return { success: false, error: 'Cancelled By required.' };

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var detail = getJobBookedDetail(id);
      if (!detail.success) return detail;   // covers not-found and already-closed status

      // owed = what this job issued (bookedQty, from PROD_ISSUE_LOG) MINUS what this job has
      // already credited back to stock via its own PROD_BOOK_REVERSE / PROD_BOOK_ROLLBACK
      // rows (a prior failed booking attempt). We only net the job's OWN return-credits —
      // the original PROD_BOOK debit is tagged with the poNo, not the jobId, so trying to
      // net it in here is what previously zeroed everything out. bookedQty already IS that
      // debit amount, so: owed = bookedQty − alreadyReturned.
      var returned = _jobReturnedByLot_(id);
      var comps = (detail.lines || []).map(function(L){
        var k = L.compCode + '|' + L.batchOrLot + '|' + L.location;
        var issued = Number(L.bookedQty) || 0;
        var owed = issued - (returned[k] || 0);
        if (owed < 0) owed = 0;
        return { compCode: L.compCode, issueId: id, qty: owed,
          lots: [{ batch: L.batchOrLot, qty: owed, location: L.location }] };
      }).filter(function(c){ return c.qty > 0; });   // nothing owed → nothing to credit
      var rev = reverseProductionIssue(comps, id, who);

      // Do NOT close the job if we could not credit everything back — closing it would
      // strand the un-credited debits with no way to retry. Leave it IN_PROGRESS so the
      // operator can cancel again once the cause is cleared.
      if (!rev.success) {
        return { success: false, jobId: id, reversedLots: rev.reversedLots, credited: rev.credited,
          error: 'Could not return all stock — job left OPEN so you can retry: ' + rev.errors.join('; '),
          requiresReview: true };
      }

      // Flip status to CANCELLED (col 9) + stamp Closed At (col 12) + reason in Booking ID col.
      var jobsWs = ensureProdJobsSheet_();
      var jd = jobsWs.getDataRange().getValues();
      for (var r = 1; r < jd.length; r++) {
        if (String(jd[r][0]).trim() === id) {
          jobsWs.getRange(r + 1, 9).setValue('CANCELLED');
          jobsWs.getRange(r + 1, 11).setValue('CANCELLED: ' + (reason || 'no reason given'));
          jobsWs.getRange(r + 1, 12).setValue(new Date());
          jobsWs.getRange(r + 1, 12).setNumberFormat('dd-MMM-yyyy HH:mm');
          break;
        }
      }
      return { success: rev.success, jobId: id, reversedLots: rev.reversedLots,
        credited: rev.credited,
        error: rev.success ? '' : 'Job cancelled but some lots failed to credit back: ' + rev.errors.join('; '),
        requiresReview: !rev.success };
    } finally {
      lock.releaseLock();
    }
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

/**
 * _jobReturnedByLot_ — how much this job has ALREADY credited back to stock, per
 * compCode|batch|location, via its own PROD_BOOK_REVERSE / PROD_BOOK_ROLLBACK rows (a
 * prior failed booking attempt). These are the only rows tagged with the jobId; the
 * original PROD_BOOK debit is tagged with the poNo. Cancel credits (issued − returned).
 * Returns {} when the job has no such rows (nothing returned yet → cancel credits full issued).
 * ponytail: one ledger scan, uses the request-scoped read the balance memo already warms.
 */
function _jobReturnedByLot_(jobId) {
  var out = {};
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return out;
  var id = String(jobId || '').trim();
  var d = ws.getDataRange().getValues();
  // cols: txnType[2], material[3], batch[4], location[5], qtyIn[6], qtyOut[7], refDocNo[10]
  // Sum ONLY this job's return-to-stock credits: PROD_BOOK_REVERSE (qtyIn) and
  // PROD_BOOK_ROLLBACK (net qtyIn − qtyOut, since rollback can go either way). These are
  // the only rows tagged with the jobId. PROD_CONSUME/SCRAP/etc are real consumption and
  // must NOT count as returned. Returned per lot = credits already put back.
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][10] || '').trim() !== id) continue;
    var t = String(d[i][2] || '').toUpperCase();
    if (t !== 'PROD_BOOK_REVERSE' && t !== 'PROD_BOOK_ROLLBACK') continue;
    var k = String(d[i][3]).trim() + '|' + String(d[i][4]).trim() + '|' + String(d[i][5]).trim();
    out[k] = (out[k] || 0) + (Number(d[i][6]) || 0) - (Number(d[i][7]) || 0);
  }
  Object.keys(out).forEach(function(k){ if (out[k] < 0) out[k] = 0; });
  return out;
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

/**
 * auditProductionLedgerDamage_ — READ-ONLY. Quantifies the PROD_BOOK double-debit.
 *
 * For each booked job (Ref Doc No on PROD_BOOK rows), a correct ledger nets to:
 *   consumed + scrap + wastage + loss   (returned is credited back)
 * i.e. the BOOK debit should have been reversed at submit and replaced by the actual
 * outcome debits. Because it is NOT reversed, the ledger over-debits by exactly the
 * BOOK amount for every job that has been submitted (has CONSUME/SCRAP/… rows).
 *
 * Returns per-job over-debit and a grand total, plus lots driven negative.
 */
function auditProductionLedgerDamage_() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return { rows: 0, jobs: [], totalOverDebit: 0 };
  var data = ws.getDataRange().getValues();

  // Per job (ref doc no): sum booked vs finalised-outcome debits.
  var byJob = {};        // jobId -> { booked, consumed, scrap, wastage, loss, returned, hasSubmit }
  // Per lot key: running net balance, to flag negatives.
  var lotNet = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var txn = String(r[2] || '').trim().toUpperCase();
    var job = String(r[10] || '').trim();
    var qIn = Number(r[6]) || 0, qOut = Number(r[7]) || 0;
    var lotKey = String(r[3]).trim() + '|' + String(r[4]).trim() + '|' + String(r[5]).trim();
    lotNet[lotKey] = (lotNet[lotKey] || 0) + qIn - qOut;

    if (!job) continue;
    if (!byJob[job]) byJob[job] = { booked: 0, consumed: 0, scrap: 0, wastage: 0, loss: 0, returned: 0, hasSubmit: false };
    var b = byJob[job];
    if (txn === 'PROD_BOOK')      b.booked   += qOut;
    else if (txn === 'PROD_CONSUME') { b.consumed += qOut; b.hasSubmit = true; }
    else if (txn === 'PROD_SCRAP')   { b.scrap    += qOut; b.hasSubmit = true; }
    else if (txn === 'PROD_WASTAGE') { b.wastage  += qOut; b.hasSubmit = true; }
    else if (txn === 'PROD_LOSS')    { b.loss     += qOut; b.hasSubmit = true; }
    else if (txn === 'PROD_RETURN')  { b.returned += qIn;  b.hasSubmit = true; }
  }

  var jobs = [], total = 0;
  Object.keys(byJob).forEach(function (jid) {
    var b = byJob[jid];
    if (b.booked <= 0 || !b.hasSubmit) return; // only submitted booked jobs are double-debited
    // Over-debit = the un-reversed BOOK amount (the whole booked qty was double-counted).
    var over = b.booked;
    total += over;
    jobs.push({ jobId: jid, booked: b.booked, consumed: b.consumed, scrap: b.scrap,
                wastage: b.wastage, loss: b.loss, returned: b.returned, overDebit: over });
  });
  jobs.sort(function (a, c) { return c.overDebit - a.overDebit; });

  var negativeLots = Object.keys(lotNet).filter(function (k) { return lotNet[k] < -0.0001; })
    .map(function (k) { return { lot: k, balance: Math.round(lotNet[k] * 1000) / 1000 }; });

  return {
    ledgerRows: data.length - 1,
    submittedBookedJobs: jobs.length,
    totalOverDebit: Math.round(total * 1000) / 1000,
    jobs: jobs.slice(0, 40),
    negativeLotCount: negativeLots.length,
    negativeLots: negativeLots.slice(0, 40)
  };
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
