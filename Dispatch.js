// ============================================================
// Dispatch.js — P6 Finished-Goods Dispatch (FIFO)
//
// Mirrors P3 Production on the FG side:
//   - FG_DISPATCH_LOTS  : one row per OQC release of an FG batch
//   - FG_FIFO_OVERRIDE_LOG : audit log of any non-FIFO dispatch
//
// FG_DISPATCH_LOTS schema (19 cols, FG_DISPATCH_HEADERS in Initialize.js):
//   0 Lot ID | 1 Timestamp | 2 OQC Ref | 3 OQC Date
//   4 Customer Code | 5 Customer Name
//   6 Product Code | 7 Product Desc | 8 FG Batch / PO
//   9 FG Location ID
//   10 Qty Released | 11 Qty Dispatched | 12 Qty Available | 13 Unit
//   14 Status (AVAILABLE | PARTIAL | DISPATCHED | RECALLED | NEEDS_REVIEW)
//   15 First Dispatched At | 16 Last Dispatched At
//   17 Gatepass Refs | 18 Remarks
//
// FG_FIFO_OVERRIDE_LOG schema (12 cols, FG_OVERRIDE_HEADERS):
//   0 Override ID | 1 Timestamp | 2 Customer Code | 3 Product Code | 4 Qty Requested
//   5 FIFO Plan (JSON) | 6 Chosen Plan (JSON) | 7 Skipped Lot IDs
//   8 Reason | 9 Operator | 10 Resulting Gatepass No | 11 Status (PENDING/COMMITTED/FAILED)
// ============================================================

// ---------- Sheet accessors ----------

function getFGDispatchSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('FG_DISPATCH_LOTS');
  if (!ws) {
    ws = ss.insertSheet('FG_DISPATCH_LOTS');
    ws.getRange(1, 1, 1, FG_DISPATCH_HEADERS.length).setValues([FG_DISPATCH_HEADERS])
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
    ws.setFrozenRows(1);
  }
  return ws;
}

function getFGOverrideSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('FG_FIFO_OVERRIDE_LOG');
  if (!ws) {
    ws = ss.insertSheet('FG_FIFO_OVERRIDE_LOG');
    ws.getRange(1, 1, 1, FG_OVERRIDE_HEADERS.length).setValues([FG_OVERRIDE_HEADERS])
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
    ws.setFrozenRows(1);
  }
  return ws;
}

// ---------- Helpers ----------

function _generateFGLotId_() {
  return 'FGL-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss')
       + '-' + Math.floor(Math.random() * 1000);
}

// Canonical comparator for FIFO plan vs chosen plan (architect correction #5).
// Returns a normalized array suitable for JSON.stringify equality testing.
function canonicalizePlan_(plan) {
  return (plan || []).slice().sort(function(a, b) {
    return String(a.lotId || '').localeCompare(String(b.lotId || ''));
  }).map(function(p) {
    return {
      lotId: String(p.lotId || '').trim(),
      qty: Number(Number(p.qty || p.qtyFromThisLot || 0).toFixed(3))
    };
  });
}

// Internal — append one FG_DISPATCH_LOTS row. Used by OQC release path and backfill.
// Returns the generated Lot ID, or '' on failure.
function _createFGDispatchLotRow_(d) {
  try {
    var ws = getFGDispatchSheet_();
    var lotId = _generateFGLotId_();
    var qtyReleased = Number(d.qtyReleased) || 0;
    var qtyDispatched = Number(d.qtyDispatched) || 0;
    var status = String(d.status || 'AVAILABLE').toUpperCase();
    var row = [
      lotId,
      new Date(),
      String(d.oqcRef || '').trim(),
      d.oqcDate || '',
      String(d.customerCode || '').trim(),
      String(d.customerName || '').trim(),
      String(d.productCode || '').trim(),
      String(d.productDesc || '').trim(),
      String(d.batch || '').trim(),
      String(d.fgLocation || '').trim(),
      qtyReleased,
      qtyDispatched,
      qtyReleased - qtyDispatched,
      String(d.unit || '').trim(),
      status,
      d.firstDispatchedAt || '',
      d.lastDispatchedAt || '',
      String(d.gatepassRefs || '').trim(),
      String(d.remarks || '').trim()
    ];
    ws.appendRow(row);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    if (d.oqcDate) ws.getRange(lr, 4).setNumberFormat('dd-MMM-yyyy');
    return lotId;
  } catch(e) {
    Logger.log('_createFGDispatchLotRow_ failed: ' + e.message);
    return '';
  }
}

// Recompute status from running qtys, write Qty Dispatched/Available/Status/timestamps/refs.
function _updateFGDispatchLotRow_(rowIndex, lotState) {
  var ws = getFGDispatchSheet_();
  var released = Number(lotState.qtyReleased) || 0;
  var dispatched = Number(lotState.qtyDispatched) || 0;
  var available = Math.max(0, released - dispatched);
  var status;
  if (lotState.recalled) status = 'RECALLED';
  else if (dispatched <= 0) status = 'AVAILABLE';
  else if (dispatched >= released - 0.001) status = 'DISPATCHED';
  else status = 'PARTIAL';
  ws.getRange(rowIndex, 12).setValue(dispatched);
  ws.getRange(rowIndex, 13).setValue(available);
  ws.getRange(rowIndex, 15).setValue(status);
  if (lotState.firstDispatchedAt) ws.getRange(rowIndex, 16).setValue(lotState.firstDispatchedAt);
  if (lotState.lastDispatchedAt)  ws.getRange(rowIndex, 17).setValue(lotState.lastDispatchedAt);
  if (lotState.gatepassRefs != null) ws.getRange(rowIndex, 18).setValue(lotState.gatepassRefs);
  return status;
}

// ---------- Form init ----------

function getDispatchFormInit() {
  var docNumber = peekNextDocNumber('gp');
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var customers = (typeof getCustomers === 'function') ? getCustomers() : [];
  var fgs = (typeof getFG === 'function') ? getFG() : [];
  // Normalize: ensure { code, desc, unit } shape
  var products = fgs.map(function(m) {
    return {
      code: String(m.code || '').trim(),
      desc: String(m.description || m.name || m.desc || '').trim(),
      unit: String(m.uom || m.unit || '').trim()
    };
  });
  return {
    docNumber:  docNumber,
    today:      today,
    customers:  customers,
    products:   products,
    inspectors: (typeof getInspectors === 'function') ? getInspectors() : []
  };
}

// Return AVAILABLE / PARTIAL FG dispatch lots for one (customer, product), FIFO order.
// NEEDS_REVIEW rows are filtered OUT (architect correction #2).
function getReleasedFGLotsForCustomerProduct(customerCode, productCode) {
  try {
    var custKey = String(customerCode || '').trim();
    var prodKey = String(productCode || '').trim();
    if (!custKey || !prodKey) return [];
    var ws = getFGDispatchSheet_();
    if (ws.getLastRow() < 2) return [];
    var data = ws.getDataRange().getValues();
    var lots = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var status = String(r[14] || '').toUpperCase();
      if (status !== 'AVAILABLE' && status !== 'PARTIAL') continue;
      if (String(r[4] || '').trim() !== custKey) continue;
      if (String(r[6] || '').trim() !== prodKey) continue;
      var available = Number(r[12]) || 0;
      if (available <= 0) continue;
      // JSON-safe: Dates → ISO strings
      var oqcDateIso = '';
      try { if (r[3]) oqcDateIso = new Date(r[3]).toISOString(); } catch(eD) {}
      var tsIso = '';
      try { if (r[1]) tsIso = new Date(r[1]).toISOString(); } catch(eD2) {}
      lots.push({
        rowIndex:     i + 1,                    // 1-based sheet row
        lotId:        String(r[0] || '').trim(),
        timestamp:    tsIso,
        oqcRef:       String(r[2] || '').trim(),
        oqcDate:      oqcDateIso,
        customerCode: String(r[4] || '').trim(),
        customerName: String(r[5] || '').trim(),
        productCode:  String(r[6] || '').trim(),
        productDesc:  String(r[7] || '').trim(),
        batch:        String(r[8] || '').trim(),
        fgLocation:   String(r[9] || '').trim(),
        qtyReleased:  Number(r[10]) || 0,
        qtyDispatched:Number(r[11]) || 0,
        qtyAvailable: available,
        unit:         String(r[13] || '').trim(),
        status:       status,
        gatepassRefs: String(r[17] || '').trim()
      });
    }
    // FIFO by OQC Date asc, then Lot ID for tiebreaker
    lots.sort(function(a, b) {
      var da = a.oqcDate ? new Date(a.oqcDate).getTime() : 0;
      var db = b.oqcDate ? new Date(b.oqcDate).getTime() : 0;
      if (da !== db) return da - db;
      return a.lotId < b.lotId ? -1 : 1;
    });
    return lots;
  } catch(e) {
    Logger.log('getReleasedFGLotsForCustomerProduct failed: ' + e.message);
    return [];
  }
}

// Plan FIFO allocation for (customer, product, qtyRequested).
// Returns { success, plan:[{lotId, oqcRef, batch, fgLocation, qty, qtyAvailable}], totalAllocated, lotCount }
function planFGDispatchAllocation(customerCode, productCode, qtyRequested) {
  try {
    var qty = Number(qtyRequested) || 0;
    if (!customerCode || !productCode || qty <= 0) {
      return { success: false, error: 'Customer, product and qty required.' };
    }
    var lots = getReleasedFGLotsForCustomerProduct(customerCode, productCode);
    if (!lots.length) {
      return { success: false, error: 'No released FG lots available for this customer + product.' };
    }
    var totalAvailable = 0;
    lots.forEach(function(l){ totalAvailable += Number(l.qtyAvailable) || 0; });
    if (totalAvailable < qty - 0.001) {
      return {
        success: false,
        error: 'Insufficient released FG — need ' + qty + ', have ' + totalAvailable + ' across ' + lots.length + ' lot(s).',
        totalAvailable: totalAvailable
      };
    }
    var remaining = qty;
    var plan = [];
    for (var i = 0; i < lots.length && remaining > 0.001; i++) {
      var avail = Number(lots[i].qtyAvailable) || 0;
      if (avail <= 0) continue;
      var take = Math.min(avail, remaining);
      plan.push({
        lotId:        lots[i].lotId,
        oqcRef:       lots[i].oqcRef,
        oqcDate:      lots[i].oqcDate,
        batch:        lots[i].batch,
        fgLocation:   lots[i].fgLocation,
        productCode:  lots[i].productCode,
        productDesc:  lots[i].productDesc,
        unit:         lots[i].unit,
        customerCode: lots[i].customerCode,
        customerName: lots[i].customerName,
        qtyAvailable: avail,
        qty:          take,
        qtyFromThisLot: take,
        rowIndex:     lots[i].rowIndex
      });
      remaining -= take;
    }
    return {
      success: true,
      plan: plan,
      totalAllocated: qty,
      lotCount: plan.length,
      totalAvailable: totalAvailable
    };
  } catch(e) {
    Logger.log('planFGDispatchAllocation failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ---------- Save dispatch (the main entry) ----------
//
// payload = {
//   date, customerCode, customerName,
//   productCode, productDesc, qtyRequested,
//   chosenPlan: [{ lotId, qty }],
//   overrideReason (≥5 chars if chosen ≠ FIFO),
//   vehicleNo, driverName, transporter, authorizedBy, securityGuard,
//   remarks, dispatchZone, operatorName
// }
//
// Bypasses legacy assertOQCReleasedForRef_ (single-use guard); enforces gating via
// FG_DISPATCH_LOTS.qtyAvailable + direct OQC decision re-check per lot.
function saveDispatchWithFIFO(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!payload) return { success: false, error: 'Empty payload.' };
    var custCode = String(payload.customerCode || '').trim();
    var custName = String(payload.customerName || '').trim();
    var prodCode = String(payload.productCode || '').trim();
    var prodDesc = String(payload.productDesc || '').trim();
    var qtyReq   = Number(payload.qtyRequested) || 0;
    var chosen   = Array.isArray(payload.chosenPlan) ? payload.chosenPlan : [];
    if (!custCode) return { success: false, error: 'Customer required.' };
    if (!prodCode) return { success: false, error: 'Product required.' };
    if (qtyReq <= 0) return { success: false, error: 'Qty must be > 0.' };
    if (!chosen.length) return { success: false, error: 'Chosen plan is empty.' };

    // 1. Re-plan FIFO server-side
    var fifoResult = planFGDispatchAllocation(custCode, prodCode, qtyReq);
    if (!fifoResult.success) return fifoResult;
    var fifoPlan = fifoResult.plan;

    // 2. Detect override
    var chosenCanon = canonicalizePlan_(chosen);
    var fifoCanon   = canonicalizePlan_(fifoPlan);
    var isOverride  = JSON.stringify(chosenCanon) !== JSON.stringify(fifoCanon);
    var overrideRowIndex = 0;
    var overrideId = '';
    if (isOverride) {
      var reason = String(payload.overrideReason || '').trim();
      if (reason.length < 5) {
        return { success: false, error: 'Override reason ≥ 5 chars required when chosen plan differs from FIFO.' };
      }
      var fifoLotIds = fifoCanon.map(function(p){ return p.lotId; });
      var chosenLotIds = chosenCanon.map(function(p){ return p.lotId; });
      var skipped = fifoLotIds.filter(function(id){ return chosenLotIds.indexOf(id) < 0; });
      overrideId = 'FOV-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss');
      var ovWs = getFGOverrideSheet_();
      ovWs.appendRow([
        overrideId, new Date(), custCode, prodCode, qtyReq,
        JSON.stringify(fifoCanon), JSON.stringify(chosenCanon),
        skipped.join(','), reason, payload.operatorName || '',
        '', 'PENDING'
      ]);
      overrideRowIndex = ovWs.getLastRow();
      ovWs.getRange(overrideRowIndex, 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    }

    // 3. Resolve chosen plan against current FG_DISPATCH_LOTS rows; re-verify per lot.
    var ss = getSpreadsheet();
    var fglWs = getFGDispatchSheet_();
    var fglData = fglWs.getDataRange().getValues();
    // Build lotId -> row index map (1-based) and snapshot
    var lotById = {};
    for (var i = 1; i < fglData.length; i++) {
      var lid = String(fglData[i][0] || '').trim();
      if (lid) lotById[lid] = { rowIndex: i + 1, row: fglData[i] };
    }

    var oqcWs = ss.getSheetByName('OQC_LOG');
    var oqcDecByDoc = {};
    if (oqcWs && oqcWs.getLastRow() > 1) {
      var od = oqcWs.getDataRange().getValues();
      for (var oi = 1; oi < od.length; oi++) {
        var dRef = String(od[oi][0] || '').trim();
        if (dRef) oqcDecByDoc[dRef] = String(od[oi][14] || '').toUpperCase();
      }
    }

    // Hoist LOCATIONS read out of the per-lot loop (MED-1 from code review).
    // Build locId → type map once instead of N reads while holding the lock.
    var locTypeByLocId = {};
    var locWs = ss.getSheetByName('LOCATIONS');
    if (locWs && locWs.getLastRow() > 1) {
      var ld = locWs.getRange(2, 1, locWs.getLastRow() - 1, 12).getValues();
      for (var li = 0; li < ld.length; li++) {
        var lKey = String(ld[li][0] || '').trim();
        if (lKey) locTypeByLocId[lKey] = String(ld[li][8] || '').toUpperCase();
      }
    }

    // Pre-validate every chosen lot
    var resolved = [];
    for (var ci = 0; ci < chosen.length; ci++) {
      var c = chosen[ci];
      var cLotId = String(c.lotId || '').trim();
      var cQty   = Number(c.qty || c.qtyFromThisLot || 0);
      if (!cLotId) {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'Chosen plan row missing lotId.' };
      }
      if (cQty <= 0) {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'Chosen plan qty must be > 0 for lot ' + cLotId + '.' };
      }
      var slot = lotById[cLotId];
      if (!slot) {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'FG lot ' + cLotId + ' not found.' };
      }
      var row = slot.row;
      // Gate 1: OQC decision RELEASED/ACCEPTED
      var oqcRef = String(row[2] || '').trim();
      var dec = oqcDecByDoc[oqcRef] || '';
      if (dec !== 'RELEASED' && dec !== 'ACCEPTED' && dec !== 'ACCEPTED WITH DEVIATION') {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'Lot ' + cLotId + ' references OQC ' + oqcRef + ' which is not released (decision="' + (dec || 'PENDING') + '").' };
      }
      // Gate 2: status not DISPATCHED/RECALLED/NEEDS_REVIEW
      var st = String(row[14] || '').toUpperCase();
      if (st === 'DISPATCHED' || st === 'RECALLED' || st === 'NEEDS_REVIEW') {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'Lot ' + cLotId + ' is ' + st + ' — cannot dispatch.' };
      }
      // Gate 3: qty available
      var availableNow = Number(row[10] || 0) - Number(row[11] || 0);
      if (cQty > availableNow + 0.001) {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'Lot ' + cLotId + ' has only ' + availableNow + ' available; requested ' + cQty + '.' };
      }
      // Gate 4: FG location non-empty and type FG (not FG_HOLD / QUARANTINE)
      var fgLoc = String(row[9] || '').trim();
      if (!fgLoc) {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'Lot ' + cLotId + ' has no FG location set.' };
      }
      var locType = locTypeByLocId[fgLoc] || '';
      if (locType && locType !== 'FG') {
        _markOverrideStatus_(overrideRowIndex, 'FAILED');
        return { success: false, error: 'Lot ' + cLotId + ' is at ' + fgLoc + ' (type ' + locType + '); only FG-type locations are dispatchable.' };
      }
      resolved.push({
        lotId: cLotId, qty: cQty, rowIndex: slot.rowIndex, row: row,
        oqcRef: oqcRef, batch: String(row[8] || '').trim(),
        fgLocation: fgLoc, productCode: String(row[6] || '').trim(),
        productDesc: String(row[7] || '').trim(), unit: String(row[13] || '').trim()
      });
    }

    // 4. Generate ONE Gatepass docNo
    var gpNo = getNextDocNumber('gp');
    var now  = new Date();
    var date = new Date(payload.date || new Date());
    var userEmail = '';
    try { userEmail = Session.getActiveUser().getEmail() || 'QA'; } catch(eU) { userEmail = 'QA'; }

    // 5. Append GATEPASS_LOG rows directly (one per lot, all sharing gpNo)
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (!gpWs) {
      _markOverrideStatus_(overrideRowIndex, 'FAILED');
      return { success: false, error: 'GATEPASS_LOG sheet missing.' };
    }
    var gpStartRow = gpWs.getLastRow() + 1;
    resolved.forEach(function(rs) {
      gpWs.appendRow([
        gpNo,
        date,
        'OUTBOUND',
        rs.oqcRef,                       // OQC_REF
        custName || custCode,            // PARTY
        rs.productCode,                  // MATERIAL_CODE
        rs.productDesc,                  // MATERIAL_DESC
        rs.qty,                          // QTY
        rs.unit,                         // UNIT
        payload.vehicleNo     || '',
        payload.driverName    || '',
        payload.transporter   || '',
        payload.authorizedBy  || '',
        payload.securityGuard || '',
        payload.remarks       || '',
        'ISSUED',
        userEmail,
        now,
        payload.dispatchZone  || rs.fgLocation,
        payload.operatorName  || ''
      ]);
    });
    var gpEndRow = gpWs.getLastRow();
    for (var gr = gpStartRow; gr <= gpEndRow; gr++) {
      gpWs.getRange(gr, 2).setNumberFormat('dd-MMM-yyyy');
      gpWs.getRange(gr, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
    }

    // 6. STOCK_LEDGER FG_DISPATCH OUT per lot
    resolved.forEach(function(rs) {
      try {
        if (typeof writeStockLedger_ === 'function') {
          writeStockLedger_('FG_DISPATCH', rs.productCode, rs.batch, rs.fgLocation,
            0, rs.qty,
            'GATEPASS', gpNo, payload.operatorName || userEmail,
            'Dispatch · cust=' + custCode + (isOverride ? ' · OVERRIDE (' + overrideId + ')' : ''));
        }
      } catch(eL) {
        Logger.log('writeStockLedger_ FG_DISPATCH failed: ' + eL.message);
      }
    });

    // 7. Update each FG_DISPATCH_LOTS row
    resolved.forEach(function(rs) {
      var row = rs.row;
      var releasedQty = Number(row[10]) || 0;
      var prevDispatched = Number(row[11]) || 0;
      var newDispatched  = prevDispatched + rs.qty;
      var prevFirstAt = row[15];
      var firstAt = prevFirstAt ? prevFirstAt : now;
      var prevRefs = String(row[17] || '').trim();
      var newRefs  = prevRefs ? (prevRefs + ',' + gpNo) : gpNo;
      _updateFGDispatchLotRow_(rs.rowIndex, {
        qtyReleased: releasedQty,
        qtyDispatched: newDispatched,
        firstDispatchedAt: firstAt,
        lastDispatchedAt: now,
        gatepassRefs: newRefs
      });
    });

    // 8. Write GP no into override row + mark COMMITTED
    if (overrideRowIndex) {
      var ovWs2 = getFGOverrideSheet_();
      ovWs2.getRange(overrideRowIndex, 11).setValue(gpNo);
      ovWs2.getRange(overrideRowIndex, 12).setValue('COMMITTED');
    }

    return {
      success: true,
      gpNo: gpNo,
      override: isOverride ? { overrideId: overrideId } : null,
      lots: resolved.map(function(rs) {
        return { lotId: rs.lotId, qty: rs.qty, batch: rs.batch, fgLocation: rs.fgLocation };
      })
    };
  } catch(e) {
    Logger.log('saveDispatchWithFIFO failed: ' + e.message + ' stack: ' + e.stack);
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

function _markOverrideStatus_(rowIndex, status) {
  if (!rowIndex) return;
  try {
    var ovWs = getFGOverrideSheet_();
    ovWs.getRange(rowIndex, 12).setValue(status);
  } catch(e) {
    Logger.log('_markOverrideStatus_ failed: ' + e.message);
  }
}

function _locationType_(locId) {
  if (!locId) return '';
  var ws = getSpreadsheet().getSheetByName('LOCATIONS');
  if (!ws || ws.getLastRow() < 2) return '';
  var d = ws.getRange(2, 1, ws.getLastRow() - 1, 12).getValues();
  var key = String(locId).trim();
  for (var i = 0; i < d.length; i++) {
    if (String(d[i][0]).trim() === key) {
      return String(d[i][8] || '').toUpperCase();
    }
  }
  return '';
}

// ---------- Recent dispatches (Tab 2) ----------

function getRecentDispatches(limit) {
  try {
    var ss = getSpreadsheet();
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (!gpWs || gpWs.getLastRow() < 2) return [];
    var fglWs = getFGDispatchSheet_();
    var lotsByOqcRef = {};
    if (fglWs && fglWs.getLastRow() > 1) {
      var fg = fglWs.getDataRange().getValues();
      for (var i = 1; i < fg.length; i++) {
        var ref = String(fg[i][2] || '').trim();
        if (ref) lotsByOqcRef[ref] = { lotId: fg[i][0], status: fg[i][14] };
      }
    }
    var ovWs = ss.getSheetByName('FG_FIFO_OVERRIDE_LOG');
    var overrideGps = {};
    if (ovWs && ovWs.getLastRow() > 1) {
      var ov = ovWs.getDataRange().getValues();
      for (var oi = 1; oi < ov.length; oi++) {
        var gn = String(ov[oi][10] || '').trim();
        if (gn) overrideGps[gn] = true;
      }
    }
    var data = gpWs.getDataRange().getValues();
    var byGp = {}; // gpNo → aggregate
    var orderTs = {};
    for (var j = 1; j < data.length; j++) {
      var r = data[j];
      var type = String(r[2] || '').toUpperCase();
      if (type !== 'OUTBOUND') continue;
      var gpNo = String(r[0] || '').trim();
      var oqcRef = String(r[3] || '').trim();
      if (!gpNo) continue;
      // Only include "P6 era" dispatches — those whose OQC refs are in FG_DISPATCH_LOTS
      if (!lotsByOqcRef[oqcRef]) continue;
      if (!byGp[gpNo]) {
        byGp[gpNo] = {
          gpNo: gpNo,
          date: r[1] ? new Date(r[1]).toISOString() : '',
          customer: r[4],
          totalQty: 0,
          itemCount: 0,
          lotIds: [],
          override: !!overrideGps[gpNo],
          timestamp: r[17] ? new Date(r[17]).toISOString() : ''
        };
      }
      byGp[gpNo].totalQty += Number(r[7]) || 0;
      byGp[gpNo].itemCount += 1;
      var lid = lotsByOqcRef[oqcRef] && lotsByOqcRef[oqcRef].lotId;
      if (lid && byGp[gpNo].lotIds.indexOf(lid) < 0) byGp[gpNo].lotIds.push(lid);
      orderTs[gpNo] = r[17] ? new Date(r[17]).getTime() : 0;
    }
    var list = Object.keys(byGp).map(function(k){ return byGp[k]; });
    list.sort(function(a, b){
      return (orderTs[b.gpNo] || 0) - (orderTs[a.gpNo] || 0);
    });
    return list.slice(0, limit || 20);
  } catch(e) {
    Logger.log('getRecentDispatches failed: ' + e.message);
    return [];
  }
}

// ---------- Backfill: mirror RELEASED OQCs into FG_DISPATCH_LOTS ----------

function backfillFGDispatchLotsFromOQC() {
  try {
    var ss = getSpreadsheet();
    var oqcWs = ss.getSheetByName('OQC_LOG');
    if (!oqcWs || oqcWs.getLastRow() < 2) {
      return { success: true, mirrored: 0, alreadyMirrored: 0, noOQCDecision: 0, noBatch: 0, noProductCode: 0, errors: [] };
    }
    var fglWs = getFGDispatchSheet_();

    // Existing dedup key: (OQC docNo + product + batch)
    var existing = {};
    if (fglWs.getLastRow() > 1) {
      var fg = fglWs.getDataRange().getValues();
      for (var i = 1; i < fg.length; i++) {
        var key = String(fg[i][2] || '').trim() + '|' +
                  String(fg[i][6] || '').trim() + '|' +
                  String(fg[i][8] || '').trim();
        existing[key] = i + 1;
      }
    }

    // Pre-index dispatch totals from GATEPASS_LOG by oqcRef
    var gpQtyByRef = {};
    var gpRefsByOqcRef = {};
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (gpWs && gpWs.getLastRow() > 1) {
      var g = gpWs.getDataRange().getValues();
      for (var j = 1; j < g.length; j++) {
        var ref = String(g[j][3] || '').trim();
        var qty = Number(g[j][7]) || 0;
        var docNo = String(g[j][0] || '').trim();
        if (ref) {
          gpQtyByRef[ref] = (gpQtyByRef[ref] || 0) + qty;
          if (docNo) {
            gpRefsByOqcRef[ref] = gpRefsByOqcRef[ref] || {};
            gpRefsByOqcRef[ref][docNo] = true;
          }
        }
      }
    }

    // Material desc → code (FG only) + unit lookup
    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    var codeByDesc = {}, unitByCode = {};
    mats.forEach(function(m) {
      var c = String(m.code || '').trim();
      if (String(m.category || '').toUpperCase() === 'FG' && m.desc) {
        codeByDesc[String(m.desc).trim()] = c;
      }
      if (c) unitByCode[c] = m.unit || '';
    });

    var o = oqcWs.getDataRange().getValues();
    var mirrored = 0, alreadyMirrored = 0, noOQCDecision = 0, noBatch = 0, noProductCode = 0;
    var needsReview = 0;
    var errors = [];

    for (var r = 1; r < o.length; r++) {
      var row = o[r];
      var docNo = String(row[0] || '').trim();
      var dec = String(row[14] || '').toUpperCase();
      if (!docNo) continue;
      if (dec !== 'RELEASED' && dec !== 'ACCEPTED' && dec !== 'ACCEPTED WITH DEVIATION') {
        noOQCDecision++;
        continue;
      }
      var batch = String(row[4] || '').trim();
      if (!batch) { noBatch++; continue; }
      var desc = String(row[5] || '').trim();
      var code = codeByDesc[desc] || '';
      if (!code) { noProductCode++; continue; }

      var key = docNo + '|' + code + '|' + batch;
      if (existing[key]) { alreadyMirrored++; continue; }

      try {
        var fgLoc = String(row[21] || '').trim();
        var status;
        var remarks;
        if (!fgLoc) {
          status = 'NEEDS_REVIEW';
          remarks = 'Backfilled — FG Location missing in OQC col 22; set manually before dispatch';
          needsReview++;
        } else {
          status = 'AVAILABLE';
          remarks = 'Backfilled from OQC_LOG';
        }
        var releasedQty = Number(row[16]) || 0;
        var dispatched = gpQtyByRef[docNo] || 0;
        if (dispatched > 0 && status === 'AVAILABLE') {
          if (dispatched >= releasedQty - 0.001) status = 'DISPATCHED';
          else status = 'PARTIAL';
        }
        var refsMap = gpRefsByOqcRef[docNo] || {};
        var refsStr = Object.keys(refsMap).join(',');
        var lotId = _createFGDispatchLotRow_({
          oqcRef:       docNo,
          oqcDate:      row[1],
          customerCode: row[2],
          customerName: row[3],
          productCode:  code,
          productDesc:  desc,
          batch:        batch,
          fgLocation:   fgLoc,
          qtyReleased:  releasedQty,
          qtyDispatched: dispatched,
          unit:         unitByCode[code] || '',
          status:       status,
          gatepassRefs: refsStr,
          firstDispatchedAt: dispatched > 0 ? new Date() : '',
          lastDispatchedAt:  dispatched > 0 ? new Date() : '',
          remarks:      remarks
        });
        if (lotId) {
          // Back-write Lot ID into OQC col 23 (only if currently blank)
          var existingLotId = String(row[22] || '').trim();
          if (!existingLotId) oqcWs.getRange(r + 1, 23).setValue(lotId);
          existing[key] = true;
          mirrored++;
        } else {
          errors.push('Failed to create row for ' + docNo);
        }
      } catch(eRow) {
        errors.push(docNo + ': ' + eRow.message);
      }
    }

    return {
      success: true,
      mirrored: mirrored,
      needsReview: needsReview,
      alreadyMirrored: alreadyMirrored,
      noOQCDecision: noOQCDecision,
      noBatch: noBatch,
      noProductCode: noProductCode,
      errors: errors
    };
  } catch(e) {
    Logger.log('backfillFGDispatchLotsFromOQC failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

function backfillFGDispatchLotsFromOQCUI() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert('Backfill FG_DISPATCH_LOTS',
    'Mirror every RELEASED OQC row into FG_DISPATCH_LOTS (idempotent).\n\nProceed?',
    ui.ButtonSet.OK_CANCEL);
  if (resp !== ui.Button.OK) return;
  var res = backfillFGDispatchLotsFromOQC();
  if (!res.success) { ui.alert('Failed', res.error || 'Unknown error', ui.ButtonSet.OK); return; }
  ui.alert('Backfill complete',
    'New rows mirrored: ' + res.mirrored +
    '\n  • of which NEEDS_REVIEW (blank FG location): ' + (res.needsReview || 0) +
    '\nAlready mirrored (skipped): ' + res.alreadyMirrored +
    '\nSkipped — no released decision: ' + res.noOQCDecision +
    '\nSkipped — no batch: ' + res.noBatch +
    '\nSkipped — could not resolve product code: ' + res.noProductCode +
    (res.errors.length ? '\n\nErrors:\n' + res.errors.join('\n') : ''),
    ui.ButtonSet.OK);
}
