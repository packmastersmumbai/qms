// ============================================================
// GRN.gs — Save and read GRN records
// ============================================================

function getGRNFormInit() {
  var locations = [];
  try { locations = (typeof getOpenRMLocations === 'function') ? getOpenRMLocations() : []; } catch(e) {}
  return {
    docNumber:  peekNextDocNumber('grn'),
    suppliers:  getSuppliers(),
    materials:  getMaterials(),
    inspectors: getInspectors(),
    locations:  locations,
    today:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

function saveGRN(data) {
  // MUST-FIX #1: Lock acquired FIRST, before getNextDocNumber, so the counter
  // is only advanced while we hold the lock. getNextDocNumber('grn') internally
  // acquires LockService.getScriptLock() — same script lock, re-entry safe in V8
  // (Apps Script V8 allows same-execution re-entry on the same lock handle).
  // writeStockLedger_ is lock-free. applyGRNReceiptsToPO_ self-checks via tryLock(0).
  var lock = LockService.getScriptLock();
  if (!lock.waitLock(10000)) return { success: false, error: 'Could not acquire lock (timeout 10s).' };
  try {
    var ss  = getSpreadsheet();
    var ws  = ss.getSheetByName('GRN_LOG');
    if (!ws) throw new Error('GRN_LOG sheet not found. Run Setup first.');

    var docNo = getNextDocNumber('grn');
    var now   = new Date();
    var user  = Session.getActiveUser().getEmail() || 'QA';
    var date  = new Date(data.date);
    var operatorId = data.operatorName || '';

    // Support multi-item array or fallback to single-item (backward compat)
    var items = (data.items && data.items.length > 0) ? data.items : [{
      materialCode: data.materialCode || '',
      materialDesc: data.materialDesc || '',
      unit:         data.unit         || '',
      qtyOrdered:   data.qtyOrdered   || '',
      qtyReceived:  data.qtyReceived  || '',
      batchNo:      data.batchNo      || '',
      expiryDate:   data.expiryDate   || ''
    }];

    // Build material-default-location map from MASTERS_Materials (col E)
    var matLocByCode = {};
    try {
      var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
      mats.forEach(function(m){
        if (m.code && m.defaultLocation) matLocByCode[m.code] = m.defaultLocation;
      });
    } catch(e) {}

    // Fallback chain: explicit data.locationId → first RM location
    var fallbackLocation = data.locationId || '';
    if (!fallbackLocation) {
      try {
        var rmLocs = (typeof getLocations === 'function') ? getLocations('RM') : [];
        if (rmLocs.length > 0) fallbackLocation = rmLocs[0].id;
      } catch(e) {}
    }

    // PO validation (backward compat: data.poNo empty → skip)
    var poNo = String(data.poNo || data.poRef || '').trim();
    var warnings = [];
    if (poNo && (typeof isPOAttached_ === 'function') && isPOAttached_(poNo)) {
      // Validate PO status
      try {
        var poHdrWs = ss.getSheetByName('PO_HEADER');
        if (poHdrWs && poHdrWs.getLastRow() > 1) {
          var poHdrData = poHdrWs.getDataRange().getValues();
          var poFound = false;
          for (var ph = 1; ph < poHdrData.length; ph++) {
            if (String(poHdrData[ph][0] || '').trim() !== poNo) continue;
            poFound = true;
            var poStatus = String(poHdrData[ph][11] || '').trim();
            if (poStatus !== 'OPEN' && poStatus !== 'PARTIAL_RECEIVED') {
              return { success: false, error: 'PO ' + poNo + ' is not open (status: ' + poStatus + ').' };
            }
            // Supplier match (warn only)
            var poSupp = String(poHdrData[ph][2] || '').trim();
            var grnSupp = String(data.supplierCode || '').trim();
            if (poSupp && grnSupp && poSupp !== grnSupp) {
              warnings.push('Supplier mismatch: PO has ' + poSupp + ', GRN has ' + grnSupp);
            }
            break;
          }
          if (!poFound) warnings.push('PO ' + poNo + ' not found in PO_HEADER (GRN will still save).');
        }
      } catch(poValErr) { Logger.log('PO validation: ' + poValErr.message); }
    } else {
      poNo = ''; // treat as unattached if not PO-format
    }

    items.forEach(function(item) {
      // Per-item location: explicit item.locationId → material's defaultLocation → fallback
      var itemLocation = item.locationId
        || matLocByCode[item.materialCode]
        || fallbackLocation;
      ws.appendRow([
        docNo,
        date,
        data.supplierCode  || '',
        data.supplierName  || '',
        data.poRef         || '',
        data.invoiceNo     || '',
        item.materialCode  || '',
        item.materialDesc  || '',
        item.batchNo       || '',
        item.qtyOrdered    || '',
        item.qtyReceived   || '',
        item.unit          || '',
        data.coaReceived   || 'N/A',
        item.expiryDate    ? new Date(item.expiryDate) : '',
        data.remarks       || '',
        'PENDING',
        user,
        now,
        data.storageZone   || '',
        operatorId,           // col 20: operator_id
        itemLocation         // col 21: location_id — feeds STOCK_LEDGER
      ]);

      // Mirror receipt into STOCK_LEDGER. Status PENDING IQC = not yet issuable.
      if (typeof writeStockLedger_ === 'function' && item.materialCode && item.batchNo && itemLocation) {
        writeStockLedger_(
          'GRN_RECEIPT',
          item.materialCode,
          item.batchNo,
          itemLocation,
          Number(item.qtyReceived) || 0,
          0,
          'GRN',
          docNo,
          operatorId || user,
          'GRN receipt — pending IQC'
        );
      }
    });

    // Format date columns on all new rows
    var lastRow  = ws.getLastRow();
    var startRow = lastRow - items.length + 1;
    for (var r = startRow; r <= lastRow; r++) {
      ws.getRange(r, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(r, 14).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(r, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
    }

    // PO writeback: only if all appendRow + writeStockLedger_ succeeded
    // MUST-FIX #2: partial-failure strategy = self-heal via reconcilePOReceipts().
    // We do NOT rollback appendRow (fragile with concurrent writers). If applyGRNReceiptsToPO_
    // fails here, ops runs reconcilePOReceipts() from menu to re-sync PO_LINES.
    if (poNo && typeof applyGRNReceiptsToPO_ === 'function') {
      try {
        var receipts = items.map(function(item) {
          return {
            materialCode: String(item.materialCode || '').trim(),
            qtyReceived:  Number(item.qtyReceived) || 0,
            poLineNo:     item.poLineNo ? Number(item.poLineNo) : null
          };
        });
        var poResult = applyGRNReceiptsToPO_(poNo, receipts, docNo);
        if (poResult.overReceiptWarnings && poResult.overReceiptWarnings.length) {
          warnings = warnings.concat(poResult.overReceiptWarnings);
        }
      } catch(poWriteErr) {
        Logger.log('applyGRNReceiptsToPO_ failed: ' + poWriteErr.message + '. Run reconcilePOReceipts() to self-heal.');
        warnings.push('PO update pending — run Reconcile PO Receipts from menu if PO status looks wrong.');
      }
    }

    return { success: true, docNo: docNo, warnings: warnings };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

function updateGRNIQCStatus(grnNo, status) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return;
  var data = ws.getDataRange().getValues();
  var color = status === 'ACCEPTED' ? '#E8F5E9' :
              status === 'REJECTED' ? '#FFEBEE' :
              status === 'HOLD'     ? '#FFF3CD' : '#FFFFFF';
  // Update ALL rows with this docNo (multi-item GRNs have multiple rows)
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(grnNo).trim()) {
      ws.getRange(i + 1, 16).setValue(status).setBackground(color);
    }
  }
}

function getGRNRowForWA(row) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws || row < 2) return null;
  var r = ws.getRange(row, 1, 1, 19).getValues()[0];
  if (!r[0]) return null;
  return {
    type:       'GRN',
    docNo:      r[0],
    date:       r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
    supplier:   r[3],
    material:   r[7],
    batch:      r[8],
    qtyOrdered: r[9],
    qtyReceived:r[10],
    status:     r[15] || 'PENDING',
    inspector:  r[16]
  };
}
