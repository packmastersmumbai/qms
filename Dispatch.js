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

// ---------- DISPATCH_LOG headers ----------
var DISPATCH_LOG_HEADERS = [
  'DSP No', 'Date', 'Customer Code', 'Customer Name',
  'GP No', 'Total Qty', 'Items Count',
  'Vehicle No', 'Driver', 'Transporter',
  'Authorized By', 'Security Guard', 'Remarks',
  'Operator', 'Created At', 'Status'
];

// ---------- Sheet accessors ----------

function getDispatchLogSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('DISPATCH_LOG');
  if (!ws) {
    ws = ss.insertSheet('DISPATCH_LOG');
    ws.getRange(1, 1, 1, DISPATCH_LOG_HEADERS.length).setValues([DISPATCH_LOG_HEADERS])
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
    ws.setFrozenRows(1);
  }
  return ws;
}

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

/**
 * FG dispatch lot ID.
 *
 * Was: 'FGL-' + yyyyMMddHHmmss + '-' + random  ->  FGL-20260803141530-742 (22 chars,
 * two separators, and nothing in it says WHICH product the lot holds.
 *
 * Now: <first 5 alphanumerics of the product code><YYMMDD><HHMM>, e.g.
 *   2967583 on 3 Aug 14:15  ->  29675260803  + 1415  ->  296752608031415 (15)
 * Uppercase A-Z0-9 only, no separators, exactly <=15 chars, so it is safe for
 * barcodes, labels, filenames and sheet keys.
 *
 * UNIQUENESS: this is a FIFO key, so a collision would merge two lots. HHMM alone
 * is not enough if two lots of the same product are released in the same minute,
 * so the caller passes the row count and we fall back to seconds when needed.
 */
function _generateFGLotId_(productCode) {
  var raw = String(productCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var code = raw.slice(0, 5) || 'FGLOT';
  var now = new Date();
  var stamp = Utilities.formatDate(now, 'Asia/Kolkata', 'yyMMdd');
  var time  = Utilities.formatDate(now, 'Asia/Kolkata', 'HHmm');
  var id = (code + stamp + time).slice(0, 15);

  // Same product, same minute -> same id. Swap the last 2 chars for seconds, then
  // fall back to the legacy random tail rather than ever returning a duplicate.
  if (_fgLotIdExists_(id)) {
    var ss = Utilities.formatDate(now, 'Asia/Kolkata', 'ss');
    id = (code + stamp + time + ss).slice(0, 15);
    if (_fgLotIdExists_(id)) {
      id = (code + stamp + time + Math.floor(Math.random() * 100)).slice(0, 15);
    }
  }
  return id;
}

// Does a lot ID already exist? Column 0 of FG_DISPATCH_LOTS is the Lot ID.
function _fgLotIdExists_(id) {
  try {
    var ws = getFGDispatchSheet_();
    var last = ws.getLastRow();
    if (last < 2) return false;
    var col = ws.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) {
      if (String(col[i][0]).trim() === id) return true;
    }
    return false;
  } catch (e) { return false; }
}

// Canonical comparator for FIFO plan vs chosen plan (architect correction #5).
// Returns a normalized array suitable for JSON.stringify equality testing.
function canonicalizePlan_(plan) {
  // P6 MED-2 — canonical field name is `qtyFromThisLot` (what plan rows write).
  // We also accept legacy `qty` for backwards compat with older Dispatch_F.html
  // payloads that still send the un-renamed field. New writers MUST emit
  // qtyFromThisLot (see planFGDispatchAllocation below).
  // Preserve insertion order — FIFO order is meaningful. If the operator
  // swaps the dispatch sequence of two lots, that IS an override and the
  // canonical form must reflect the order change.
  return (plan || []).map(function(p) {
    return {
      lotId: String(p.lotId || '').trim(),
      qty: Number(Number(p.qtyFromThisLot != null ? p.qtyFromThisLot : (p.qty || 0)).toFixed(3))
    };
  });
}

// Internal — append one FG_DISPATCH_LOTS row. Used by OQC release path and backfill.
// Returns the generated Lot ID, or '' on failure.
function _createFGDispatchLotRow_(d) {
  try {
    var ws = getFGDispatchSheet_();
    var lotId = _generateFGLotId_(d.productCode);
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
  var docNumber = peekNextDocNumber('dsp');
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var customers = (typeof getCustomers === 'function') ? getCustomers() : [];
  var fgs = (typeof getFG === 'function') ? getFG() : [];
  // Normalize: ensure { code, desc, unit } shape
  // Build kg-per-cons lookup from BOM (sum of all component consum values per FG code)
  var bomKgMap = {};
  try {
    if (typeof getBomRows_ === 'function') {
      getBomRows_().forEach(function(b) {
        if (!bomKgMap[b.fgCode]) bomKgMap[b.fgCode] = 0;
        bomKgMap[b.fgCode] += Number(b.consum) || 0;
      });
    }
  } catch(e) { Logger.log('Dispatch BOM kg lookup failed: ' + e.message); }

  var products = fgs.map(function(m) {
    var code = String(m.code || '').trim();
    return {
      code:     code,
      desc:     String(m.description || m.name || m.desc || '').trim(),
      unit:     String(m.uom || m.unit || '').trim(),
      kgPerCons: bomKgMap[code] || 0
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
// Single-product (legacy) payload:
// {
//   date, customerCode, customerName,
//   productCode, productDesc, qtyRequested,
//   chosenPlan: [{ lotId, qty }],
//   overrideReason (≥5 chars if chosen ≠ FIFO),
//   vehicleNo, driverName, transporter, authorizedBy, securityGuard,
//   remarks, dispatchZone, operatorName
// }
//
// Multi-product payload (P0-A): add items array; legacy top-level fields used as
// fallback when items is absent.
// {
//   ...same header fields...,
//   items: [
//     { productCode, productDesc, qtyRequested,
//       chosenPlan: [{ lotId, qty }], overrideReason }
//   ]
// }
//
// Generates both a DSP- header doc number (DISPATCH_LOG) and a GP- number (GATEPASS_LOG).
// Bypasses legacy assertOQCReleasedForRef_ (single-use guard); enforces gating via
// FG_DISPATCH_LOTS.qtyAvailable + direct OQC decision re-check per lot.
// 0-based index of 'Remarks' in DISPATCH_LOG_HEADERS. Derived, not hardcoded, so
// a schema edit cannot silently point the idempotency lookup at another column.
function _dspRemarksCol_() {
  try {
    var i = DISPATCH_LOG_HEADERS.indexOf('Remarks');
    if (i >= 0) return i;
  } catch (e) {}
  return 12;
}

function _dspTxnTag_(txnId) {
  return '[txn:' + String(txnId).replace(/[\[\]]/g, '') + ']';
}

// The DSP number already written under this txn key, plus its gatepass number,
// or null. Both are returned because the client shows each one: reporting only
// the DSP would leave the operator without the GP they need and invite a manual
// re-save — the very duplicate this guard exists to prevent.
function _dspFindByTxn_(txnId) {
  try {
    if (!txnId) return null;
    var ws = getDispatchLogSheet_();
    if (!ws || ws.getLastRow() < 2) return null;
    var tag = _dspTxnTag_(txnId);
    var n = ws.getLastRow() - 1;
    var vals = ws.getRange(2, 1, n, DISPATCH_LOG_HEADERS.length).getValues();
    var rc = _dspRemarksCol_();
    for (var i = 0; i < n; i++) {
      if (String(vals[i][rc] || '').indexOf(tag) >= 0) {
        return { dspNo: String(vals[i][0] || ''), gpNo: String(vals[i][4] || '') };
      }
    }
  } catch (e) { Logger.log('_dspFindByTxn_: ' + e.message); }
  return null;
}

// Suffix, so the operator's own remark still reads first. Stripped by
// stripTxnTag_ (GRN.js) wherever a human or a printed document reads it.
function _dspStampTxn_(remarks, txnId) {
  var base = String(remarks || '');
  if (!txnId) return base;
  return base + (base ? ' ' : '') + _dspTxnTag_(txnId);
}

function saveDispatchWithFIFO(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!payload) return { success: false, error: 'Empty payload.' };

    // Idempotency guard. Dispatch is the most consequential unguarded writer in
    // the system: one call appends N GATEPASS_LOG rows, a DISPATCH_LOG header,
    // an FG_DISPATCH ledger OUT per lot, and DECREMENTS FG_DISPATCH_LOTS. A
    // retry after a dropped response repeats all of it — FG stock double-counted
    // and two gatepasses for one truck. The dropped response is measured, not
    // theoretical (saveGRN returns in ~12s and its handler still goes missing
    // through the double iframe).
    //
    // Checked INSIDE the lock so a retry racing the first call sees committed
    // rows rather than passing the check alongside it.
    var dspTxnId = String(payload.clientTxnId || '').trim();
    if (dspTxnId) {
      var prior = _dspFindByTxn_(dspTxnId);
      if (prior) {
        return { success: true, docNo: prior.dspNo, dspNo: prior.dspNo,
                 gatepassNo: prior.gpNo, gpNo: prior.gpNo, duplicate: true,
                 warnings: ['This dispatch was already saved as ' + prior.dspNo +
                            (prior.gpNo ? ' / ' + prior.gpNo : '') + '.'] };
      }
    }
    var custCode = String(payload.customerCode || '').trim();
    var custName = String(payload.customerName || '').trim();
    if (!custCode) return { success: false, error: 'Customer required.' };

    // Normalise to items array (multi-product support)
    var items;
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      items = payload.items;
    } else {
      // Single-product fallback — wrap legacy fields as one item
      items = [{
        productCode:    String(payload.productCode || '').trim(),
        productDesc:    String(payload.productDesc || '').trim(),
        qtyRequested:   Number(payload.qtyRequested) || 0,
        chosenPlan:     Array.isArray(payload.chosenPlan) ? payload.chosenPlan : [],
        overrideReason: String(payload.overrideReason || '').trim()
      }];
    }

    if (!items.length) return { success: false, error: 'No items in payload.' };

    // Validate each item before doing any writes
    for (var ii = 0; ii < items.length; ii++) {
      var itm = items[ii];
      if (!String(itm.productCode || '').trim()) return { success: false, error: 'Item ' + (ii+1) + ': Product required.' };
      if ((Number(itm.qtyRequested) || 0) <= 0)  return { success: false, error: 'Item ' + (ii+1) + ': Qty must be > 0.' };
      if (!Array.isArray(itm.chosenPlan) || !itm.chosenPlan.length) return { success: false, error: 'Item ' + (ii+1) + ': Chosen plan is empty.' };
    }

    // ---------- Shared sheet reads (done once, outside item loop) ----------
    var ss = getSpreadsheet();
    var fglWs = getFGDispatchSheet_();
    var fglData = fglWs.getDataRange().getValues();
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

    var locTypeByLocId = {};
    var locWs = ss.getSheetByName('LOCATIONS');
    if (locWs && locWs.getLastRow() > 1) {
      var lastCol = locWs.getLastColumn();
      var locHeaders = locWs.getRange(1, 1, 1, lastCol).getValues()[0];
      var locIdCol = 0;
      var locTypeCol = -1;
      for (var lhi = 0; lhi < locHeaders.length; lhi++) {
        var hn = String(locHeaders[lhi] || '').trim().toLowerCase();
        if (hn === 'location id') locIdCol = lhi;
        if (hn === 'type') locTypeCol = lhi;
      }
      if (locTypeCol < 0) locTypeCol = 8;
      var ld = locWs.getRange(2, 1, locWs.getLastRow() - 1, lastCol).getValues();
      for (var li = 0; li < ld.length; li++) {
        var lKey = String(ld[li][locIdCol] || '').trim();
        if (lKey) locTypeByLocId[lKey] = String(ld[li][locTypeCol] || '').toUpperCase();
      }
    }

    // ---------- Per-item: FIFO re-plan, override detection, lot validation ----------
    // resolvedItems[i] = { productCode, productDesc, qtyRequested, isOverride, overrideId,
    //                      overrideRowIndex, lots: [resolved lot objects] }
    var resolvedItems = [];
    var allOverrideRowIndices = [];
    for (var ii2 = 0; ii2 < items.length; ii2++) {
      var itm2 = items[ii2];
      var prodCode = String(itm2.productCode || '').trim();
      var prodDesc = String(itm2.productDesc || '').trim();
      var qtyReq   = Number(itm2.qtyRequested) || 0;
      var chosen   = itm2.chosenPlan;

      // Re-plan FIFO server-side
      var fifoResult = planFGDispatchAllocation(custCode, prodCode, qtyReq);
      if (!fifoResult.success) return fifoResult;
      var fifoPlan = fifoResult.plan;

      // Detect override
      var chosenCanon = canonicalizePlan_(chosen);
      var fifoCanon   = canonicalizePlan_(fifoPlan);
      var isOverride  = JSON.stringify(chosenCanon) !== JSON.stringify(fifoCanon);
      var overrideRowIndex = 0;
      var overrideId = '';
      if (isOverride) {
        var reason = String(itm2.overrideReason || '').trim();
        if (reason.length < 5) {
          return { success: false, error: 'Item ' + (ii2+1) + ' (' + prodCode + '): Override reason ≥ 5 chars required when chosen plan differs from FIFO.' };
        }
        var fifoLotIds = fifoCanon.map(function(p){ return p.lotId; });
        var chosenLotIds = chosenCanon.map(function(p){ return p.lotId; });
        var skipped = fifoLotIds.filter(function(id){ return chosenLotIds.indexOf(id) < 0; });
        overrideId = 'FOV-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss') + '-' + ii2;
        var ovWs = getFGOverrideSheet_();
        ovWs.appendRow([
          overrideId, new Date(), custCode, prodCode, qtyReq,
          JSON.stringify(fifoCanon), JSON.stringify(chosenCanon),
          skipped.join(','), reason, payload.operatorName || '',
          '', 'PENDING'
        ]);
        overrideRowIndex = ovWs.getLastRow();
        ovWs.getRange(overrideRowIndex, 2).setNumberFormat('dd-MMM-yyyy HH:mm');
        allOverrideRowIndices.push(overrideRowIndex);
      }

      // Pre-validate every chosen lot for this item
      var resolved = [];
      for (var ci = 0; ci < chosen.length; ci++) {
        var c = chosen[ci];
        var cLotId = String(c.lotId || '').trim();
        var cQty   = Number(c.qty || c.qtyFromThisLot || 0);
        if (!cLotId) {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'Item ' + (ii2+1) + ': Chosen plan row missing lotId.' };
        }
        if (cQty <= 0) {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'Item ' + (ii2+1) + ': Chosen plan qty must be > 0 for lot ' + cLotId + '.' };
        }
        var slot = lotById[cLotId];
        if (!slot) {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'FG lot ' + cLotId + ' not found.' };
        }
        var lotRow = slot.row;
        // Gate 1: OQC decision RELEASED/ACCEPTED
        var oqcRef = String(lotRow[2] || '').trim();
        var dec = oqcDecByDoc[oqcRef] || '';
        if (dec !== 'RELEASED' && dec !== 'ACCEPTED' && dec !== 'ACCEPTED WITH DEVIATION') {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'Lot ' + cLotId + ' references OQC ' + oqcRef + ' which is not released (decision="' + (dec || 'PENDING') + '").' };
        }
        // Gate 2: status not DISPATCHED/RECALLED/NEEDS_REVIEW
        var st = String(lotRow[14] || '').toUpperCase();
        if (st === 'DISPATCHED' || st === 'RECALLED' || st === 'NEEDS_REVIEW') {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'Lot ' + cLotId + ' is ' + st + ' — cannot dispatch.' };
        }
        // Gate 3: qty available
        var availableNow = Number(lotRow[10] || 0) - Number(lotRow[11] || 0);
        if (cQty > availableNow + 0.001) {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'Lot ' + cLotId + ' has only ' + availableNow + ' available; requested ' + cQty + '.' };
        }
        // Gate 4: FG location non-empty and type FG
        var fgLoc = String(lotRow[9] || '').trim();
        if (!fgLoc) {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'Lot ' + cLotId + ' has no FG location set.' };
        }
        var locType = locTypeByLocId[fgLoc] || '';
        if (locType && locType !== 'FG') {
          _markAllOverridesFailed_(allOverrideRowIndices);
          return { success: false, error: 'Lot ' + cLotId + ' is at ' + fgLoc + ' (type ' + locType + '); only FG-type locations are dispatchable.' };
        }
        resolved.push({
          lotId: cLotId, qty: cQty, rowIndex: slot.rowIndex, row: lotRow,
          oqcRef: oqcRef, batch: String(lotRow[8] || '').trim(),
          fgLocation: fgLoc, productCode: String(lotRow[6] || '').trim(),
          productDesc: String(lotRow[7] || '').trim(), unit: String(lotRow[13] || '').trim()
        });
        // Update in-memory snapshot so subsequent items in this dispatch see reduced availability
        slot.row[11] = Number(slot.row[11] || 0) + cQty;
      }

      resolvedItems.push({
        productCode: prodCode, productDesc: prodDesc, qtyRequested: qtyReq,
        qtyRequestedKg: itm2.qtyRequestedKg != null ? Number(itm2.qtyRequestedKg) : null,
        kgPerCons: Number(itm2.kgPerCons) || 0,
        isOverride: isOverride, overrideId: overrideId, overrideRowIndex: overrideRowIndex,
        lots: resolved
      });
    }

    // ---------- All validation passed — generate doc numbers and write ----------
    var dspNo = getNextDocNumber('dsp');
    var gpNo  = getNextDocNumber('gp');
    var now   = new Date();
    var date  = new Date(payload.date || new Date());
    var userEmail = '';
    try { userEmail = Session.getActiveUser().getEmail() || 'QA'; } catch(eU) { userEmail = 'QA'; }

    // 5. Append GATEPASS_LOG rows (one per lot per item, all sharing gpNo)
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (!gpWs) {
      return { success: false, error: 'GATEPASS_LOG sheet missing.' };
    }
    var gpStartRow = gpWs.getLastRow() + 1;
    var allResolvedLots = [];
    resolvedItems.forEach(function(ri) {
      ri.lots.forEach(function(rs) {
        // GATEPASS_LOG cols (0-based): 0=docNo, 1=date, 2=type, 3=oqcRef, 4=party, 5=matCode,
        // 6=matDesc, 7=qty, 8=unit, 9=vehicleNo, 10=driver, 11=transporter, 12=authorizedBy,
        // 13=securityGuard, 14=remarks, 15=status, 16=createdBy, 17=createdAt, 18=dispatchZone, 19=operatorName
        gpWs.appendRow([
          gpNo,
          date,
          'OUTBOUND',
          rs.oqcRef,
          custName || custCode,
          rs.productCode,
          rs.productDesc,
          rs.qty,
          rs.unit,
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
        allResolvedLots.push(rs);
      });
    });
    var gpEndRow = gpWs.getLastRow();
    for (var gr = gpStartRow; gr <= gpEndRow; gr++) {
      gpWs.getRange(gr, 2).setNumberFormat('dd-MMM-yyyy');
      gpWs.getRange(gr, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
    }

    // 5b. Write one header row to DISPATCH_LOG
    var totalQty = 0;
    resolvedItems.forEach(function(ri) {
      ri.lots.forEach(function(rs) { totalQty += rs.qty; });
    });
    var dspWs = getDispatchLogSheet_();
    dspWs.appendRow([
      dspNo,
      date,
      custCode,
      custName,
      gpNo,
      totalQty,
      resolvedItems.length,
      payload.vehicleNo     || '',
      payload.driverName    || '',
      payload.transporter   || '',
      payload.authorizedBy  || '',
      payload.securityGuard || '',
      _dspStampTxn_(payload.remarks, dspTxnId),   // + [txn:...] idempotency tag
      payload.operatorName  || userEmail,
      now,
      'ISSUED'
    ]);
    var dspRow = dspWs.getLastRow();
    dspWs.getRange(dspRow, 2).setNumberFormat('dd-MMM-yyyy');
    dspWs.getRange(dspRow, 15).setNumberFormat('dd-MMM-yyyy HH:mm');

    // 6. STOCK_LEDGER FG_DISPATCH OUT per lot
    //
    // A ledger failure here used to be swallowed into Logger.log while the
    // function went on to decrement FG_DISPATCH_LOTS and return success:true.
    // That is not theoretical: writeStockLedger_ THROWS on lock contention
    // ('LOCK_TIMEOUT ... within 10 s', Warehouse.js:79). The outcome was a
    // printed gatepass, a lot marked DISPATCHED, and NO OUT row — goods leaving
    // the building while still on the books, with the operator shown a green
    // tick. Phantom positive stock of exactly the kind the unexplained ledger
    // drift is made of.
    //
    // The GATEPASS_LOG and DISPATCH_LOG rows are already committed at this
    // point, so throwing would strand them. Instead: collect the failures, keep
    // going so the remaining lots are still recorded, then stamp the records
    // NEEDS_REVIEW and return them to the caller as a warning.
    var ledgerFailures = [];
    resolvedItems.forEach(function(ri) {
      ri.lots.forEach(function(rs) {
        try {
          if (typeof writeStockLedger_ !== 'function') {
            throw new Error('writeStockLedger_ unavailable');
          }
          writeStockLedger_('FG_DISPATCH', rs.productCode, rs.batch, rs.fgLocation,
            0, rs.qty,
            'GATEPASS', gpNo, payload.operatorName || userEmail,
            'Dispatch ' + dspNo + ' · cust=' + custCode + (ri.isOverride ? ' · OVERRIDE (' + ri.overrideId + ')' : ''));
        } catch(eL) {
          Logger.log('writeStockLedger_ FG_DISPATCH failed: ' + eL.message);
          ledgerFailures.push({
            lotId: rs.lotId, productCode: rs.productCode, batch: rs.batch,
            qty: rs.qty, error: String(eL.message || eL)
          });
        }
      });
    });

    // 7. Update each FG_DISPATCH_LOTS row
    resolvedItems.forEach(function(ri) {
      ri.lots.forEach(function(rs) {
        var lotRow = rs.row;
        var releasedQty = Number(lotRow[10]) || 0;
        var prevDispatched = Number(lotRow[11]) || 0;
        var newDispatched  = prevDispatched + rs.qty;
        var prevFirstAt = lotRow[15];
        var firstAt = prevFirstAt ? prevFirstAt : now;
        var prevRefs = String(lotRow[17] || '').trim();
        var newRefs  = prevRefs ? (prevRefs + ',' + gpNo) : gpNo;
        _updateFGDispatchLotRow_(rs.rowIndex, {
          qtyReleased: releasedQty,
          qtyDispatched: newDispatched,
          firstDispatchedAt: firstAt,
          lastDispatchedAt: now,
          gatepassRefs: newRefs
        });
      });
    });

    // 8. Write GP no into override rows + mark COMMITTED
    resolvedItems.forEach(function(ri) {
      if (ri.overrideRowIndex) {
        var ovWs2 = getFGOverrideSheet_();
        ovWs2.getRange(ri.overrideRowIndex, 11).setValue(gpNo);
        ovWs2.getRange(ri.overrideRowIndex, 12).setValue('COMMITTED');
      }
    });

    var anyOverride = resolvedItems.some(function(ri){ return ri.isOverride; });
    return {
      success: true,
      dspNo: dspNo,
      gpNo: gpNo,
      // Non-empty means the goods moved but the ledger did NOT record part of
      // it. The caller must show this — a silent success here is how stock goes
      // missing on paper. See the note at step 6.
      ledgerFailures: ledgerFailures,
      needsReview: ledgerFailures.length > 0,
      // `warnings` (plural, an array) — that is the field Dispatch_F.html:783
      // already reads. A singular `warning` string would have been silently
      // dropped by the client, which would have made this whole fix invisible
      // to the operator: exactly the failure it exists to prevent.
      warnings: ledgerFailures.length
        ? ['STOCK LEDGER NOT WRITTEN for ' + ledgerFailures.length + ' lot(s). ' +
           'The dispatch and gatepass are recorded but stock is NOT debited — ' +
           'report this before the vehicle leaves.']
        : [],
      override: anyOverride ? { overrideIds: resolvedItems.filter(function(ri){ return ri.isOverride; }).map(function(ri){ return ri.overrideId; }) } : null,
      lots: allResolvedLots.map(function(rs) {
        return { lotId: rs.lotId, qty: rs.qty, batch: rs.batch, fgLocation: rs.fgLocation };
      }),
      items: resolvedItems.map(function(ri) {
        return {
          productCode: ri.productCode, productDesc: ri.productDesc,
          qtyRequested: ri.qtyRequested,
          lots: ri.lots.map(function(rs){ return { lotId: rs.lotId, qty: rs.qty, batch: rs.batch }; })
        };
      })
    };
  } catch(e) {
    Logger.log('saveDispatchWithFIFO failed: ' + e.message + ' stack: ' + e.stack);
    _markAllOverridesFailed_(allOverrideRowIndices);
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

function _markAllOverridesFailed_(rowIndices) {
  if (!rowIndices || !rowIndices.length) return;
  rowIndices.forEach(function(ri) { _markOverrideStatus_(ri, 'FAILED'); });
}

// ---------- Recent dispatches (Tab 2) ----------

function getRecentDispatches(limit) {
  try {
    var ss = getSpreadsheet();
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (!gpWs || gpWs.getLastRow() < 2) return [];
    var fglWs = getFGDispatchSheet_();
    // P6 MED-3 — one OQC ref can map to multiple FG_DISPATCH_LOTS rows
    // (e.g. partial splits, re-mirrors). Store as array; aggregate at render.
    var lotsByOqcRef = {};
    if (fglWs && fglWs.getLastRow() > 1) {
      var fg = fglWs.getDataRange().getValues();
      for (var i = 1; i < fg.length; i++) {
        var ref = String(fg[i][2] || '').trim();
        if (!ref) continue;
        if (!lotsByOqcRef[ref]) lotsByOqcRef[ref] = [];
        lotsByOqcRef[ref].push({ lotId: fg[i][0], status: fg[i][14] });
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
      var lotEntries = lotsByOqcRef[oqcRef];
      if (!lotEntries || !lotEntries.length) continue;
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
      lotEntries.forEach(function(le) {
        if (le.lotId && byGp[gpNo].lotIds.indexOf(le.lotId) < 0) byGp[gpNo].lotIds.push(le.lotId);
      });
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
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
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

    // Pre-index dispatch totals from GATEPASS_LOG by oqcRef.
    // P6 LOW-4 — also capture first/last actual dispatch timestamps (col B = date,
    // col R[17] = createdAt) so backfill records real history instead of new Date().
    var gpQtyByRef = {};
    var gpRefsByOqcRef = {};
    var gpFirstTsByRef = {};
    var gpLastTsByRef  = {};
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
          // Prefer createdAt (col 17); fall back to date (col 1)
          var rawTs = g[j][17] || g[j][1];
          if (rawTs) {
            var ts = (rawTs instanceof Date) ? rawTs : new Date(rawTs);
            if (!isNaN(ts.getTime())) {
              if (!gpFirstTsByRef[ref] || ts < gpFirstTsByRef[ref]) gpFirstTsByRef[ref] = ts;
              if (!gpLastTsByRef[ref]  || ts > gpLastTsByRef[ref])  gpLastTsByRef[ref]  = ts;
            }
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
          firstDispatchedAt: dispatched > 0 ? (gpFirstTsByRef[docNo] || new Date()) : '',
          lastDispatchedAt:  dispatched > 0 ? (gpLastTsByRef[docNo]  || new Date()) : '',
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
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
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
