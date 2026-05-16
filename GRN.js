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

    // Resolve a default RM intake location if caller didn't supply one
    var defaultLocation = data.locationId || '';
    if (!defaultLocation) {
      try {
        var rmLocs = (typeof getLocations === 'function') ? getLocations('RM') : [];
        if (rmLocs.length > 0) defaultLocation = rmLocs[0].id;
      } catch(e) {}
    }

    items.forEach(function(item) {
      var itemLocation = item.locationId || defaultLocation;
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

    return { success: true, docNo: docNo };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
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
