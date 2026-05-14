// ============================================================
// GRN.gs — Save and read GRN records
// ============================================================

function getGRNFormInit() {
  return {
    docNumber:  peekNextDocNumber('grn'),
    suppliers:  getSuppliers(),
    materials:  getMaterials(),
    today:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

function saveGRN(data, sessionId) {
  try {
    var ss  = getSpreadsheet();
    var ws  = ss.getSheetByName('GRN_LOG');
    if (!ws) throw new Error('GRN_LOG sheet not found. Run Setup first.');

    var docNo = getNextDocNumber('grn');
    var now   = new Date();
    var user  = Session.getActiveUser().getEmail() || 'QA';
    var date  = new Date(data.date);
    var operatorId = '';
    if (sessionId) {
      var sess = validateSessionFast_(sessionId);
      if (sess) operatorId = sess.userId;
    }

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

    items.forEach(function(item) {
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
        operatorId           // last col: operator_id — add this header manually in the sheet
      ]);
    });

    // Format date columns on all new rows
    var lastRow  = ws.getLastRow();
    var startRow = lastRow - items.length + 1;
    for (var r = startRow; r <= lastRow; r++) {
      ws.getRange(r, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(r, 14).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(r, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
    }

    if (sessionId) {
      var firstItemCode = items[0] ? (items[0].materialCode || '') : '';
      autoQmsTask_(sessionId, 'GRN', 'GRN — ' + (data.supplierName || '') + ' / ' + firstItemCode, docNo);
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
