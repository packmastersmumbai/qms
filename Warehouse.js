// ============================================================
// Warehouse.gs — Stock ledger, balance, location, FIFO, scrap, sample
// Single source of truth for material movement.
// STOCK_LEDGER schema (13 cols, see Initialize.STOCK_LEDGER_HEADERS):
//   0 Txn ID | 1 Timestamp | 2 Txn Type | 3 Material Code | 4 Batch | 5 Location ID
//   6 Qty In | 7 Qty Out  | 8 Balance After | 9 Ref Doc Type | 10 Ref Doc No.
//   11 Operator | 12 Remarks
// ============================================================

// ---------- Ledger primitives ----------

function writeStockLedger_(txnType, materialCode, batchOrLotNo, locationId,
                            qtyIn, qtyOut, refDocType, refDocNo, operator, remarks) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('STOCK_LEDGER');
  if (!ws) return '';
  var txnId = 'TXN-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss')
              + '-' + Math.floor(Math.random() * 1000);
  var qIn  = Number(qtyIn)  || 0;
  var qOut = Number(qtyOut) || 0;
  var op   = operator || (function(){ try { return Session.getActiveUser().getEmail() || ''; } catch(e){ return ''; } })();

  // SCOPED LOCK: balance-read + appendRow must be atomic to prevent two concurrent
  // calls reading the same stale balance and writing duplicate "Balance After" values.
  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(10000);
    if (!lockAcquired) {
      throw new Error('LOCK_TIMEOUT: writeStockLedger_ could not acquire script lock within 10 s');
    }
    var balance = getStockBalance_(materialCode, batchOrLotNo, locationId) + qIn - qOut;
    ws.appendRow([
      txnId,
      new Date(),
      txnType || '',
      materialCode || '',
      batchOrLotNo || '',
      locationId || '',
      qIn,
      qOut,
      balance,
      refDocType || '',
      refDocNo || '',
      op,
      remarks || ''
    ]);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy HH:mm');
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
  return txnId;
}

// Recent stock movements for the Movements tab (Warehouse_F.html).
// Returns most-recent N (default 100) ledger rows newest-first.
function getStockMovements(limit) {
  try {
    var n = Number(limit) || 100;
    var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
    if (!ws || ws.getLastRow() < 2) return [];
    var rows = ws.getDataRange().getValues();
    var TZ = 'Asia/Kolkata';
    var out = [];
    // Iterate from newest row back
    for (var i = rows.length - 1; i >= 1 && out.length < n; i--) {
      var r = rows[i];
      if (!r[0]) continue;
      out.push({
        txnId:        r[0],
        timestamp:    r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'dd-MMM HH:mm') : String(r[1] || ''),
        txnType:      r[2] || '',
        materialCode: r[3] || '',
        batchOrLotNo: r[4] || '',
        locationId:   r[5] || '',
        qtyIn:        Number(r[6]) || 0,
        qtyOut:       Number(r[7]) || 0,
        balance:      Number(r[8]) || 0,
        refDocType:   r[9] || '',
        refDocNo:     r[10] || '',
        operator:     r[11] || '',
        remarks:      r[12] || ''
      });
    }
    return out;
  } catch(e) {
    Logger.log('getStockMovements error: ' + e.message);
    return [];
  }
}

function getStockBalance_(materialCode, batchOrLotNo, locationId) {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return 0;
  var data = ws.getDataRange().getValues();
  var balance = 0;
  var mc = String(materialCode || '').trim();
  var bn = String(batchOrLotNo || '').trim();
  var lc = String(locationId || '').trim();
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (String(r[3]).trim() === mc &&
        String(r[4]).trim() === bn &&
        String(r[5]).trim() === lc) {
      balance += (Number(r[6]) || 0) - (Number(r[7]) || 0);
    }
  }
  return balance;
}

// ---------- Reads ----------

function getStockSummary() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return [];
  var data = ws.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var mat = String(r[3] == null ? '' : r[3]).trim();
    var btc = String(r[4] == null ? '' : r[4]).trim();
    var loc = String(r[5] == null ? '' : r[5]).trim();
    var key = mat + '|' + btc + '|' + loc;
    if (!map[key]) map[key] = { materialCode: mat, batchOrLotNo: btc, locationId: loc, qtyIn: 0, qtyOut: 0 };
    map[key].qtyIn  += Number(r[6]) || 0;
    map[key].qtyOut += Number(r[7]) || 0;
  }
  return Object.keys(map).map(function(k){
    var m = map[k];
    return { materialCode: m.materialCode, batchOrLotNo: m.batchOrLotNo,
             locationId: m.locationId, balance: m.qtyIn - m.qtyOut };
  }).filter(function(r){ return r.balance > 0; });
}

function getStockByMaterial() {
  var summary = getStockSummary();
  var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
  var matMap = {};
  mats.forEach(function(m){ matMap[m.code || m.itemCode] = m; });
  var grouped = {};
  summary.forEach(function(s){
    var k = s.materialCode;
    if (!grouped[k]) grouped[k] = {
      materialCode: k,
      name: (matMap[k] || {}).name || (matMap[k] || {}).itemDescription || k,
      unit: (matMap[k] || {}).unit || '',
      lots: []
    };
    grouped[k].lots.push(s);
  });
  return Object.keys(grouped).map(function(k){ return grouped[k]; });
}

// Returns lots for a material across AVAILABLE locations (i.e., not quarantine),
// ordered by GRN receipt date (FIFO). Lots in QUARANTINE / SCRAP / SAMPLE are excluded.
function getFIFOLots(materialCode) {
  var quarantineTypes = { 'QUARANTINE': 1, 'SCRAP': 1, 'SAMPLE': 1 };
  var locTypeById = {};
  var locWs = getSpreadsheet().getSheetByName('LOCATIONS');
  if (locWs && locWs.getLastRow() > 1) {
    locWs.getRange(2, 1, locWs.getLastRow() - 1, 12).getValues().forEach(function(r){
      if (r[0]) locTypeById[String(r[0]).trim()] = String(r[8] || '').toUpperCase();
    });
  }

  var matKey = String(materialCode == null ? '' : materialCode).trim();
  var summary = getStockSummary().filter(function(s){
    if (String(s.materialCode).trim() !== matKey) return false;
    if (s.balance <= 0) return false;
    var t = locTypeById[String(s.locationId).trim()] || '';
    return !quarantineTypes[t];
  });

  // GRN dates by batch/lot
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  var grnDates = {};
  if (ws && ws.getLastRow() > 1) {
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var lotNo = String(data[i][8] || '').trim();
      if (lotNo && !grnDates[lotNo]) grnDates[lotNo] = data[i][1];
    }
  }
  summary.forEach(function(s){ s.grnDate = grnDates[s.batchOrLotNo] || new Date(0); });
  summary.sort(function(a, b){
    var da = new Date(a.grnDate), db = new Date(b.grnDate);
    if (da - db !== 0) return da - db;
    return a.batchOrLotNo < b.batchOrLotNo ? -1 : 1;
  });
  return summary;
}

// ---------- LOCATIONS access ----------

function getLocations(typeFilter) {
  var ws = getSpreadsheet().getSheetByName('LOCATIONS');
  if (!ws || ws.getLastRow() < 2) return [];
  var rows = ws.getRange(2, 1, ws.getLastRow() - 1, 12).getValues()
    .filter(function(r){ return r[0] && r[11] !== 'N'; });
  if (typeFilter) {
    var t = String(typeFilter).toUpperCase();
    rows = rows.filter(function(r){ return String(r[8] || '').toUpperCase() === t; });
  }
  return rows.map(function(r){
    return {
      id: r[0], floor: r[1], section: r[2], aisle: r[3], rack: r[4],
      shelf: r[5], bin: r[6], label: r[7] || r[0], type: r[8],
      capacityQty: r[9], capacityUnit: r[10], active: r[11]
    };
  });
}

function getOpenRMLocations() {
  return getLocations('RM').concat(getLocations('QUARANTINE'));
}

function getFGLocations() {
  return getLocations('FG').concat(getLocations('FG_HOLD'));
}

function saveLocation(d) {
  var ws = getSpreadsheet().getSheetByName('LOCATIONS');
  if (!ws) return { success: false, error: 'LOCATIONS sheet missing.' };
  var id = String(d.id || '').trim();
  if (!id) return { success: false, error: 'Location ID required.' };
  // Update if row exists, else append
  if (ws.getLastRow() > 1) {
    var ids = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id) {
        ws.getRange(i + 2, 1, 1, 12).setValues([[
          id, d.floor || '', d.section || '', d.aisle || '', d.rack || '',
          d.shelf || '', d.bin || '',
          d.label || id,
          d.type || 'RM', d.capacityQty || '', d.capacityUnit || '', d.active || 'Y'
        ]]);
        return { success: true, updated: true };
      }
    }
  }
  ws.appendRow([
    id, d.floor || '', d.section || '', d.aisle || '', d.rack || '',
    d.shelf || '', d.bin || '',
    d.label || id,
    d.type || 'RM', d.capacityQty || '', d.capacityUnit || '', d.active || 'Y'
  ]);
  return { success: true };
}

// Hard-delete if no STOCK_LEDGER rows reference this location; otherwise soft-delete (Active='N').
// Keeps historical traceability intact for ISO 9001 audits.
function deleteLocation(id) {
  try {
    var locId = String(id || '').trim();
    if (!locId) return { success: false, error: 'Location ID required.' };
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('LOCATIONS');
    if (!ws || ws.getLastRow() < 2) return { success: false, error: 'LOCATIONS sheet empty.' };

    var ledger = ss.getSheetByName('STOCK_LEDGER');
    var referenced = false;
    if (ledger && ledger.getLastRow() > 1) {
      var locCol = ledger.getRange(2, 6, ledger.getLastRow() - 1, 1).getValues();
      for (var k = 0; k < locCol.length; k++) {
        if (String(locCol[k][0]).trim() === locId) { referenced = true; break; }
      }
    }

    var ids = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === locId) {
        if (referenced) {
          ws.getRange(i + 2, 12).setValue('N');
          return { success: true, soft: true, message: 'Location had stock history — marked inactive.' };
        }
        ws.deleteRow(i + 2);
        return { success: true, soft: false };
      }
    }
    return { success: false, error: 'Location ' + locId + ' not found.' };
  } catch(e) {
    Logger.log('deleteLocation failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ---------- Movements ----------

function recordLocationTransfer(data) {
  // data: { materialCode, batchOrLotNo, fromLocationId, toLocationId, qty, reason, transferredBy }
  try {
    var qty = Number(data.qty) || 0;
    if (qty <= 0) return { success: false, error: 'Transfer qty must be > 0.' };
    var bal = getStockBalance_(data.materialCode, data.batchOrLotNo, data.fromLocationId);
    if (bal < qty) return { success: false, error: 'Insufficient stock at source (' + bal + ').' };

    var id = 'TRF-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
    writeStockLedger_('LOCATION_TRANSFER', data.materialCode, data.batchOrLotNo,
      data.fromLocationId, 0, qty, 'TRANSFER', id, data.transferredBy, 'OUT → ' + data.toLocationId);
    writeStockLedger_('LOCATION_TRANSFER', data.materialCode, data.batchOrLotNo,
      data.toLocationId, qty, 0, 'TRANSFER', id, data.transferredBy, 'IN ← ' + data.fromLocationId);
    return { success: true, transferId: id };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function recordScrap(data) {
  // data: { refDocType, refDocNo, materialCode, batchOrLotNo, qtyScrap, unit, scrapReason, scrapDestination, recordedBy, locationId }
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('SCRAP_LOG');
    if (!ws) return { success: false, error: 'SCRAP_LOG sheet missing.' };
    var id = getNextDocNumber('scr');
    ws.appendRow([
      id, new Date(),
      data.refDocType || '', data.refDocNo || '',
      data.materialCode || '', data.batchOrLotNo || '',
      Number(data.qtyScrap) || 0, data.unit || '',
      data.scrapReason || '', data.scrapDestination || '',
      data.recordedBy || ''
    ]);
    ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    writeStockLedger_('SCRAP', data.materialCode, data.batchOrLotNo,
      data.locationId || 'SCRAP-AREA',
      0, Number(data.qtyScrap) || 0,
      data.refDocType || '', data.refDocNo || '',
      data.recordedBy || '', data.scrapReason || '');
    return { success: true, scrapId: id };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function recordSample(data) {
  // data: { refDocType, refDocNo, materialCode, batchOrLotNo, qtySample, unit, samplePurpose, takenBy, locationStored, locationId }
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('SAMPLE_LOG');
    if (!ws) return { success: false, error: 'SAMPLE_LOG sheet missing.' };
    var id = getNextDocNumber('smp');
    ws.appendRow([
      id, new Date(),
      data.refDocType || '', data.refDocNo || '',
      data.materialCode || '', data.batchOrLotNo || '',
      Number(data.qtySample) || 0, data.unit || '',
      data.samplePurpose || '', data.takenBy || '',
      data.locationStored || 'SAMPLE-CABINET'
    ]);
    ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    writeStockLedger_('SAMPLE', data.materialCode, data.batchOrLotNo,
      data.locationId || 'SAMPLE-CABINET',
      0, Number(data.qtySample) || 0,
      data.refDocType || '', data.refDocNo || '',
      data.takenBy || '', data.samplePurpose || '');
    return { success: true, sampleId: id };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// ---------- RM-issuance gate ----------
// Issues RM to production, but only if the linked GRN's IQC status is PASS/ACCEPTED
// AND the lot is at a non-quarantine location.
// data: { materialCode, batchOrLotNo, locationId, qtyToIssue, productionOrderNo, issuedBy }
function issueRMForProduction(data) {
  try {
    var qty = Number(data.qtyToIssue) || 0;
    if (qty <= 0) return { success: false, error: 'Issue qty must be > 0.' };
    var mat   = String(data.materialCode || '').trim();
    var batch = String(data.batchOrLotNo || '').trim();
    var loc   = String(data.locationId || '').trim();
    if (!mat || !batch || !loc) return { success: false, error: 'materialCode, batch and locationId required.' };

    // Gate: lookup IQC status for this GRN batch
    var grnWs = getSpreadsheet().getSheetByName('GRN_LOG');
    var iqcWs = getSpreadsheet().getSheetByName('IQC_LOG');
    var grnNoForBatch = '';
    if (grnWs && grnWs.getLastRow() > 1) {
      var g = grnWs.getDataRange().getValues();
      for (var i = 1; i < g.length; i++) {
        if (String(g[i][6]).trim() === mat && String(g[i][8]).trim() === batch) {
          grnNoForBatch = String(g[i][0]).trim();
          break;
        }
      }
    }
    if (!grnNoForBatch) {
      return { success: false, error: 'No GRN found for ' + mat + ' / ' + batch + '.' };
    }
    // Resolve IQC disposition for that GRN — use latest row (last in IQC_LOG)
    var iqcDisp = '';
    if (iqcWs && iqcWs.getLastRow() > 1) {
      var iq = iqcWs.getDataRange().getValues();
      for (var j = iq.length - 1; j >= 1; j--) {
        if (String(iq[j][2]).trim() === grnNoForBatch) {
          iqcDisp = String(iq[j][22] || '').toUpperCase();
          break;
        }
      }
    }
    if (iqcDisp !== 'ACCEPTED' && iqcDisp !== 'PASS' && iqcDisp !== 'ACCEPTED WITH DEVIATION') {
      return {
        success: false,
        error: 'RM blocked — GRN ' + grnNoForBatch + ' has IQC disposition "' + (iqcDisp || 'PENDING') + '". Only ACCEPTED / ACCEPTED WITH DEVIATION can be issued.'
      };
    }

    // Gate: location must not be quarantine
    var locTypeById = {};
    var locWs = getSpreadsheet().getSheetByName('LOCATIONS');
    if (locWs && locWs.getLastRow() > 1) {
      locWs.getRange(2, 1, locWs.getLastRow() - 1, 12).getValues().forEach(function(r){
        if (r[0]) locTypeById[String(r[0]).trim()] = String(r[8] || '').toUpperCase();
      });
    }
    var locType = locTypeById[loc] || '';
    if (locType === 'QUARANTINE' || locType === 'SCRAP' || locType === 'SAMPLE') {
      return { success: false, error: 'Cannot issue from location type ' + locType + '.' };
    }

    // Gate: stock must be available at this location
    var bal = getStockBalance_(mat, batch, loc);
    if (bal < qty) {
      return { success: false, error: 'Insufficient stock at ' + loc + ' (have ' + bal + ', need ' + qty + ').' };
    }

    // Pass — write ledger entry
    var txnType = (data.txnType === 'PROD_BOOK') ? 'PROD_BOOK' : 'RM_ISSUE';
    var refNo = data.productionOrderNo || ('PROD-' + Date.now());
    writeStockLedger_(txnType, mat, batch, loc,
      0, qty,
      'PRODUCTION', refNo,
      data.issuedBy || '',
      txnType === 'PROD_BOOK' ? 'Booked for FG production — pending consumption' : 'RM issued — IQC pass verified');
    return { success: true, balance: bal - qty, grnNo: grnNoForBatch, iqcDisposition: iqcDisp };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}
