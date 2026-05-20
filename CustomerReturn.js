// ============================================================
// CustomerReturn.gs — Customer return lifecycle
// Receipt → QA triage (RESTOCK / REWORK / SCRAP) → close.
// SCRAP and REWORK auto-raise an NCR; RESTOCK does not (judgement: cosmetic-only returns).
// CUSTOMER_RETURN_LOG schema (18 cols, see Initialize.CUSTOMER_RETURN_HEADERS):
//   0  Return No.        | 1  Return Date         | 2  Customer Code
//   3  Customer Name     | 4  Original Gatepass   | 5  Product Code
//   6  Product Desc      | 7  FG Batch No.        | 8  Qty Returned
//   9  Unit              | 10 Return Reason       | 11 Received By
//   12 IQC Status        | 13 Disposition         | 14 NCR Ref
//   15 Status            | 16 Remarks             | 17 Timestamp
// ============================================================

var RETURN_DISPOSITIONS = ['RESTOCK', 'REWORK', 'SCRAP'];

function getCustomerReturnFormInit() {
  var customers = [];
  try { customers = (typeof getCustomers === 'function') ? getCustomers() : []; } catch(e) {}
  var inspectors = [];
  try { inspectors = (typeof getInspectors === 'function') ? getInspectors() : []; } catch(e) {}
  return {
    docNumber:    peekNextDocNumber('rtn'),
    customers:    customers,
    inspectors:   inspectors,
    dispositions: RETURN_DISPOSITIONS.slice(),
    today:        Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

function saveCustomerReturn(data) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('CUSTOMER_RETURN_LOG');
    if (!ws) throw new Error('CUSTOMER_RETURN_LOG sheet not found. Run Setup first.');
    ensureReturnExtraColumns_(ws);

    var rtnNo = getNextDocNumber('rtn');
    var now   = new Date();
    var qty   = Number(data.qtyReturned) || 0;

    ws.appendRow([
      rtnNo,                                   // c1  Return No.
      data.returnDate ? new Date(data.returnDate) : now,  // c2  Return Date
      data.customerCode      || '',            // c3  Customer Code
      data.customerName      || '',            // c4  Customer Name
      data.originalGatepass  || '',            // c5  Original Gatepass No
      data.productCode       || '',            // c6  Product Code
      data.productDesc       || '',            // c7  Product Description
      data.fgBatchNo         || '',            // c8  FG Batch No
      qty,                                     // c9  Qty Returned
      data.unit              || '',            // c10 Unit
      data.returnReason      || '',            // c11 Return Reason
      data.receivedBy        || '',            // c12 Received By
      'PENDING',                               // c13 IQC Status (return-side QC)
      'PENDING_TRIAGE',                        // c14 Disposition
      '',                                      // c15 NCR Ref (set on disposition)
      'OPEN',                                  // c16 Status
      data.remarks           || '',            // c17 Remarks
      now                                      // c18 Timestamp
    ]);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
    ws.getRange(lr, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
    ws.getRange(lr, 14).setBackground('#FFF3CD');  // amber — pending triage

    // Dynamic extras: defect category + photos (JSON-encoded URL list)
    var hdrs = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
    var iDefect = hdrs.indexOf('Defect Category') + 1;
    var iPhotos = hdrs.indexOf('Photos') + 1;
    if (iDefect && data.defectCategory) ws.getRange(lr, iDefect).setValue(data.defectCategory);
    if (iPhotos && Array.isArray(data.photos) && data.photos.length) {
      ws.getRange(lr, iPhotos).setValue(JSON.stringify(data.photos));
    }

    // STOCK_LEDGER: returned FG enters QUARANTINE pending triage.
    // Return document is already written — ledger failure is partial-commit → save-with-warning.
    var receiveWarnings = [];
    if (typeof writeStockLedger_ === 'function' && data.productCode && data.fgBatchNo && qty > 0) {
      try {
        writeStockLedger_(
          'CUSTOMER_RETURN_IN',
          data.productCode,
          data.fgBatchNo,
          'QUARANTINE',
          qty,
          0,
          'CUSTOMER_RETURN',
          rtnNo,
          data.receivedBy || '',
          'Returned by ' + (data.customerName || data.customerCode || 'customer') + ' — pending QA triage'
        );
      } catch (ledgerErr) {
        Logger.log('CustomerReturn receiveCustomerReturn ledger failed: ' + ledgerErr.message);
        receiveWarnings.push('Document saved but stock ledger update failed — contact admin.');
      }
    }

    return { success: true, rtnNo: rtnNo, warnings: receiveWarnings };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function ensureReturnExtraColumns_(ws) {
  var headers = ws.getRange(1, 1, 1, Math.max(ws.getLastColumn(), 18)).getValues()[0];
  var wanted = ['Defect Category', 'Photos'];
  var lastCol = ws.getLastColumn();
  wanted.forEach(function(name){
    if (headers.indexOf(name) < 0) {
      lastCol++;
      ws.getRange(1, lastCol).setValue(name).setFontWeight('bold');
    }
  });
}

// Upload a base64 image and attach to a customer return row.
// data: { rtnNo, base64, filename, mimeType }
function uploadCustomerReturnPhoto(data) {
  try {
    data = data || {};
    if (!data.rtnNo || !data.base64) return { success: false, error: 'rtnNo and base64 required' };
    var bytes = Utilities.base64Decode(data.base64);
    var blob  = Utilities.newBlob(bytes, data.mimeType || 'image/jpeg', data.filename || ('rtn-' + Date.now() + '.jpg'));
    var folder = getOrCreateReturnPhotoFolder_();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();

    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('CUSTOMER_RETURN_LOG');
    if (!ws) return { success: false, error: 'CUSTOMER_RETURN_LOG sheet not found.' };
    ensureReturnExtraColumns_(ws);
    var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
    var iPhotos = headers.indexOf('Photos');
    if (iPhotos < 0) return { success: false, error: 'Photos column missing' };
    var rows = ws.getDataRange().getValues();
    var ref = String(data.rtnNo).trim();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== ref) continue;
      var arr = [];
      var existing = rows[i][iPhotos];
      if (existing) {
        try { arr = JSON.parse(existing); }
        catch(e) { arr = String(existing).split('|').filter(Boolean); }
      }
      arr.push(url);
      ws.getRange(i + 1, iPhotos + 1).setValue(JSON.stringify(arr));
      return { success: true, photos: arr };
    }
    return { success: false, error: 'Return ' + ref + ' not found.' };
  } catch(e) {
    Logger.log('uploadCustomerReturnPhoto error: ' + e.message);
    return { success: false, error: e.message };
  }
}

function getOrCreateReturnPhotoFolder_() {
  var folderName = 'PM-QMS — Customer Return Photos';
  var it = DriveApp.getFoldersByName(folderName);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(folderName);
}

// Returns OPEN returns awaiting triage.
function getOpenCustomerReturns() {
  var ws = getSpreadsheet().getSheetByName('CUSTOMER_RETURN_LOG');
  if (!ws || ws.getLastRow() < 2) return [];
  var data = ws.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (String(r[15] || '').toUpperCase() === 'OPEN') {
      out.push({
        rtnNo:           r[0],
        returnDate:      r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Kolkata', 'dd-MMM-yyyy') : String(r[1] || ''),
        customerCode:    r[2],
        customerName:    r[3],
        originalGatepass:r[4],
        productCode:     r[5],
        productDesc:     r[6],
        fgBatchNo:       r[7],
        qtyReturned:     r[8],
        unit:            r[9],
        returnReason:    r[10],
        receivedBy:      r[11],
        disposition:     r[13],
        status:          r[15]
      });
    }
  }
  return out;
}

function getCustomerReturnDispositions() { return RETURN_DISPOSITIONS.slice(); }

// data: { rtnNo, disposition, disposedBy, remarks }
function disposeCustomerReturn(data) {
  if (RETURN_DISPOSITIONS.indexOf(data.disposition) < 0) {
    return { success: false, error: 'Invalid disposition. Allowed: ' + RETURN_DISPOSITIONS.join(', ') };
  }
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('CUSTOMER_RETURN_LOG');
    if (!ws) throw new Error('CUSTOMER_RETURN_LOG sheet not found.');
    var ref = String(data.rtnNo).trim();
    var rows = ws.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== ref) continue;
      var row = i + 1;
      var productCode = rows[i][5];
      var productDesc = rows[i][6];
      var fgBatchNo   = rows[i][7];
      var qty         = Number(rows[i][8]) || 0;
      var unit        = rows[i][9];
      var customer    = rows[i][3] || rows[i][2];
      var reason      = rows[i][10];

      // Stamp disposition and close
      ws.getRange(row, 13).setValue('INSPECTED');
      ws.getRange(row, 14).setValue(data.disposition).setBackground('#E8F5E9');
      ws.getRange(row, 16).setValue('CLOSED');
      if (data.remarks) {
        var existing = String(rows[i][16] || '');
        ws.getRange(row, 17).setValue(existing ? existing + ' | ' + data.remarks : data.remarks);
      }

      var ncrNo = '';
      var ncrError = '';
      var disposeWarnings = [];

      if (data.disposition === 'RESTOCK') {
        // Pull from QUARANTINE, push back to FG-STORE.
        // Disposition is already stamped — ledger failure is partial-commit → save-with-warning.
        if (typeof writeStockLedger_ === 'function' && productCode && fgBatchNo && qty > 0) {
          try {
            writeStockLedger_('CUSTOMER_RETURN_RESTOCK_OUT', productCode, fgBatchNo, 'QUARANTINE',
              0, qty, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'Restocked after triage');
            writeStockLedger_('CUSTOMER_RETURN_RESTOCK_IN', productCode, fgBatchNo, 'FG-STORE',
              qty, 0, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'Restocked from return ' + ref);
          } catch (ledgerErr) {
            Logger.log('CustomerReturn RESTOCK ledger failed: ' + ledgerErr.message);
            disposeWarnings.push('Document saved but stock ledger update failed — contact admin.');
          }
        }
      } else if (data.disposition === 'SCRAP') {
        if (typeof recordScrap === 'function') {
          recordScrap({
            refDocType: 'CUSTOMER_RETURN', refDocNo: ref,
            materialCode: productCode, batchOrLotNo: fgBatchNo,
            qtyScrap: qty, unit: unit,
            scrapReason: data.remarks || reason || 'Customer return — scrap',
            scrapDestination: 'DISPOSAL',
            recordedBy: data.disposedBy || '',
            locationId: 'QUARANTINE'
          });
        }
        if (typeof raiseNCR_ === 'function') {
          ncrNo = raiseNCR_({
            date:         new Date(),
            source:       'CUSTOMER_RETURN',
            sourceRef:    ref,
            materialCode: productCode || '',
            materialDesc: productDesc || '',
            batchNo:      fgBatchNo || '',
            qtyAffected:  qty,
            unit:         unit || '',
            defectDesc:   'Customer return — scrap. ' + (data.remarks || reason || '')
          });
          if (!ncrNo) {
            ncrError = 'NCR auto-raise FAILED — raise the NCR manually.';
            disposeWarnings.push(ncrError);
          }
        }
      } else if (data.disposition === 'REWORK') {
        // Move out of QUARANTINE; rework area is FG_HOLD until re-released by OQC.
        // Disposition is already stamped — ledger failure is partial-commit → save-with-warning.
        if (typeof writeStockLedger_ === 'function' && productCode && fgBatchNo && qty > 0) {
          try {
            writeStockLedger_('CUSTOMER_RETURN_REWORK_OUT', productCode, fgBatchNo, 'QUARANTINE',
              0, qty, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'Sent to rework');
            writeStockLedger_('CUSTOMER_RETURN_REWORK_IN', productCode, fgBatchNo, 'FG-HOLD',
              qty, 0, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'In rework pending re-inspection');
          } catch (ledgerErr) {
            Logger.log('CustomerReturn REWORK ledger failed: ' + ledgerErr.message);
            disposeWarnings.push('Document saved but stock ledger update failed — contact admin.');
          }
        }
        if (typeof raiseNCR_ === 'function') {
          ncrNo = raiseNCR_({
            date:         new Date(),
            source:       'CUSTOMER_RETURN',
            sourceRef:    ref,
            materialCode: productCode || '',
            materialDesc: productDesc || '',
            batchNo:      fgBatchNo || '',
            qtyAffected:  qty,
            unit:         unit || '',
            defectDesc:   'Customer return — rework required. ' + (data.remarks || reason || '')
          });
          if (!ncrNo) {
            ncrError = 'NCR auto-raise FAILED — raise the NCR manually.';
            disposeWarnings.push(ncrError);
          }
        }
      }

      if (ncrNo) ws.getRange(row, 15).setValue(ncrNo);
      return { success: true, ncrNo: ncrNo, ncrError: ncrError, warnings: disposeWarnings };
    }
    return { success: false, error: 'Return ' + ref + ' not found.' };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}
