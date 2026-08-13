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
  var products = [];
  try {
    products = ((typeof getFG === 'function') ? getFG() : []).map(function(m) {
      return { code: m.code, desc: m.description || m.name || '', unit: m.uom || m.unit || '' };
    });
  } catch(e) {}
  return {
    docNumber:    peekNextDocNumber('rtn'),
    customers:    customers,
    inspectors:   inspectors,
    products:     products,
    dispositions: RETURN_DISPOSITIONS.slice(),
    today:        Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

// Returnable gatepasses for a customer — outbound GPs from GATEPASS_LOG whose PARTY
// matches the customer, each with its line items {materialCode, materialDesc, batch,
// qty, unit}. Drives the cascading Gatepass -> Batch dropdowns on the return form.
//   GATEPASS_LOG cols: 0 GP_NO · 1 DATE · 2 TYPE · 3 OQC_REF · 4 PARTY · 5 MATERIAL_CODE
//                      · 6 MATERIAL_DESC · 7 QTY · 8 UNIT · 15 STATUS
function getReturnableGatepasses(customerName) {
  try {
    var ss = getSpreadsheet();
    var sh = ss.getSheetByName('GATEPASS_LOG');
    if (!sh || sh.getLastRow() < 2) return { gatepasses: [] };
    var data = sh.getDataRange().getValues();
    var want = String(customerName || '').trim().toLowerCase();

    // Build OQC No. -> Batch/PO map so each GP item's OQC_REF resolves to its FG batch
    // (GATEPASS_LOG has no batch column; the batch lives in OQC_LOG "Batch / PO", col 4).
    var batchByOqc = {};
    try {
      var oqc = ss.getSheetByName('OQC_LOG');
      if (oqc && oqc.getLastRow() > 1) {
        var od = oqc.getDataRange().getValues();
        for (var oi = 1; oi < od.length; oi++) {
          var oNo = String(od[oi][0] || '').trim();
          if (oNo) batchByOqc[oNo] = String(od[oi][4] || '').trim();   // col4 = Batch / PO
        }
      }
    } catch (oqcErr) {}
    var byGp = {};   // gpNo -> { gpNo, date, party, items:[] }
    var order = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var type = String(row[2] || '').toUpperCase();
      if (type.indexOf('OUT') === -1 && type.indexOf('DISPATCH') === -1) continue;   // outbound only
      var party = String(row[4] || '').trim();
      if (want && party.toLowerCase() !== want) continue;                            // customer filter
      var gpNo = String(row[0] || '').trim();
      if (!gpNo) continue;
      if (!byGp[gpNo]) {
        byGp[gpNo] = {
          gpNo: gpNo,
          date: row[1] ? Utilities.formatDate(new Date(row[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
          party: party,
          items: []
        };
        order.push(gpNo);
      }
      var matDesc = String(row[6] || '').trim();
      // Resolve batch via the row's OQC_REF (col3) -> OQC_LOG "Batch / PO".
      var oqcRef = String(row[3] || '').trim();
      var batch = batchByOqc[oqcRef] || '';
      byGp[gpNo].items.push({
        materialCode: String(row[5] || '').trim(),
        materialDesc: matDesc,
        batch:        batch,
        oqcRef:       oqcRef,
        qty:          row[7] != null && row[7] !== '' ? Number(row[7]) : '',
        unit:         String(row[8] || '').trim()
      });
    }
    return { gatepasses: order.map(function(g){ return byGp[g]; }) };
  } catch (e) {
    return { gatepasses: [], error: String(e && e.message || e) };
  }
}

// 0-based index of 'Remarks' in CUSTOMER_RETURN_HEADERS. Lazy, for the same
// cross-file evaluation-order reason as the IQC and OQC equivalents.
function _crRemarksCol_() {
  try {
    if (typeof CUSTOMER_RETURN_HEADERS !== 'undefined') {
      var i = CUSTOMER_RETURN_HEADERS.indexOf('Remarks');
      if (i >= 0) return i;
    }
  } catch (e) {}
  return 16;
}

function _crTxnTag_(txnId) {
  return '[txn:' + String(txnId).replace(/[\[\]]/g, '') + ']';
}

function _crFindByTxn_(ws, txnId) {
  try {
    if (!ws || ws.getLastRow() < 2 || !txnId) return '';
    var tag = _crTxnTag_(txnId);
    var n = ws.getLastRow() - 1;
    var rc = _crRemarksCol_();
    var vals = ws.getRange(2, 1, n, rc + 1).getValues();
    for (var i = 0; i < n; i++) {
      if (String(vals[i][rc] || '').indexOf(tag) >= 0) return String(vals[i][0] || '');
    }
  } catch (e) { Logger.log('_crFindByTxn_: ' + e.message); }
  return '';
}

function _crStampTxn_(remarks, txnId) {
  var base = String(remarks || '');
  if (!txnId) return base;
  return base + (base ? ' ' : '') + _crTxnTag_(txnId);
}

function saveCustomerReturn(data) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('CUSTOMER_RETURN_LOG');
    if (!ws) throw new Error('CUSTOMER_RETURN_LOG sheet not found. Run Setup first.');
    ensureReturnExtraColumns_(ws);

    // Idempotency guard. This appends with a freshly minted return number and has
    // no natural guard (unlike Rework, whose COMPLETED status blocks a repeat),
    // so a retry after a dropped response books the SAME physical return twice —
    // two return numbers, double the returned quantity against the customer.
    var crTxnId = String(data.clientTxnId || '').trim();
    if (crTxnId) {
      var priorCr = _crFindByTxn_(ws, crTxnId);
      if (priorCr) {
        return { success: true, rtnNo: priorCr, duplicate: true,
                 warnings: ['This return was already saved as ' + priorCr + '.'] };
      }
    }

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
      _crStampTxn_(data.remarks, crTxnId),     // c17 Remarks (+ [txn:...] tag)
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

// Multi-item return — one Return No. shared across N line items (each from a checked
// gatepass item). data: { returnDate, customerCode, customerName, originalGatepass,
//   receivedBy, returnReason, remarks, defectCategory, items:[{productCode, productDesc,
//   fgBatchNo, qtyReturned, unit}] }
function saveCustomerReturnMulti(data) {
  try {
    var items = (data && data.items) || [];
    if (!items.length) return { success: false, error: 'No items to return.' };

    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('CUSTOMER_RETURN_LOG');
    if (!ws) throw new Error('CUSTOMER_RETURN_LOG sheet not found. Run Setup first.');
    ensureReturnExtraColumns_(ws);

    // This is the function the form actually calls (CustomerReturn_F.html:595),
    // so the guard matters more here than on the single-item variant. All items
    // share ONE return number, so finding the tag means the whole return landed.
    var crmTxnId = String(data.clientTxnId || '').trim();
    if (crmTxnId) {
      var priorCrm = _crFindByTxn_(ws, crmTxnId);
      if (priorCrm) {
        // rtnNo is the field the form reads (CustomerReturn_F.html:553) — a
        // duplicate reply missing it would render "Return undefined saved".
        return { success: true, rtnNo: priorCrm, itemCount: items.length, duplicate: true,
                 warnings: ['This return was already saved as ' + priorCrm + '.'] };
      }
    }

    var rtnNo = getNextDocNumber('rtn');
    var now   = new Date();
    var hdrs  = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
    var iDefect = hdrs.indexOf('Defect Category') + 1;
    var iPhotos = hdrs.indexOf('Photos') + 1;
    var warnings = [];

    items.forEach(function(it){
      var qty = Number(it.qtyReturned) || 0;
      ws.appendRow([
        rtnNo,
        data.returnDate ? new Date(data.returnDate) : now,
        data.customerCode     || '',
        data.customerName     || '',
        data.originalGatepass || '',
        it.productCode        || '',
        it.productDesc        || '',
        it.fgBatchNo          || '',
        qty,
        it.unit               || '',
        data.returnReason     || '',
        data.receivedBy       || '',
        'PENDING',
        'PENDING_TRIAGE',
        '',
        'OPEN',
        _crStampTxn_(data.remarks, crmTxnId),   // + [txn:...] idempotency tag
        now
      ]);
      var lr = ws.getLastRow();
      ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(lr, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
      ws.getRange(lr, 14).setBackground('#FFF3CD');
      if (iDefect && data.defectCategory) ws.getRange(lr, iDefect).setValue(data.defectCategory);
      if (iPhotos && Array.isArray(data.photos) && data.photos.length) {
        ws.getRange(lr, iPhotos).setValue(JSON.stringify(data.photos));
      }
      // Returned FG enters QUARANTINE pending triage.
      if (typeof writeStockLedger_ === 'function' && it.productCode && it.fgBatchNo && qty > 0) {
        try {
          writeStockLedger_('CUSTOMER_RETURN_IN', it.productCode, it.fgBatchNo, 'QUARANTINE',
            qty, 0, 'CUSTOMER_RETURN', rtnNo, data.receivedBy || '',
            'Returned by ' + (data.customerName || data.customerCode || 'customer') + ' — pending QA triage');
        } catch (ledgerErr) {
          warnings.push('Item ' + (it.fgBatchNo || it.productCode) + ': stock ledger update failed.');
        }
      }
    });

    return { success: true, rtnNo: rtnNo, itemCount: items.length, warnings: warnings };
  } catch (e) {
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
var UPLOAD_CR_PHOTO_MIME_ALLOWLIST_ = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
function uploadCustomerReturnPhoto(data) {
  try {
    data = data || {};
    if (!data.rtnNo || !data.base64) return { success: false, error: 'rtnNo and base64 required' };
    var mime = String(data.mimeType || '').toLowerCase();
    if (!mime || UPLOAD_CR_PHOTO_MIME_ALLOWLIST_.indexOf(mime) < 0) {
      return { success: false, error: 'Invalid mimeType. Allowed: ' + UPLOAD_CR_PHOTO_MIME_ALLOWLIST_.join(', ') };
    }
    var bytes = Utilities.base64Decode(data.base64);
    var blob  = Utilities.newBlob(bytes, mime, data.filename || ('rtn-' + Date.now() + '.jpg'));
    // Drive REST — DriveApp is refused under drive.file. See DriveRest.js.
    var url = drvStoreModuleImage('CustomerReturn',
                data.filename || ('rtn-' + Date.now() + '.jpg'), blob);

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

// getOrCreateReturnPhotoFolder_ removed 2026-08-13: orphaned by the Drive REST migration and
// unreachable anyway — getQmsSubFolder_ routes through DriveApp, which
// the drive.file scope refuses. Photos now go via drvStoreModuleImage.

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
    // Atomic: read return state + OPEN-guard + disposition writes under one lock,
    // so two concurrent disposals can't both pass the OPEN check and double-restock.
    return withStockLock_(function(){
    var rows = ws.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== ref) continue;
      var row = i + 1;
      // Idempotency guard: only an un-triaged (not yet INSPECTED/CLOSED) return may
      // be dispositioned. A repeat call is a no-op success — never a second restock.
      var curStatus = String(rows[i][12] || '').trim().toUpperCase();
      if (curStatus === 'INSPECTED' || curStatus === 'CLOSED') {
        return { success: true, alreadyDisposed: true };
      }
      var productCode = rows[i][5];
      var productDesc = rows[i][6];
      var fgBatchNo   = rows[i][7];
      var qty         = Number(rows[i][8]) || 0;
      var unit        = rows[i][9];
      var customer    = rows[i][3] || rows[i][2];
      var reason      = rows[i][10];

      // Stamp disposition (not CLOSED yet) and remarks.
      ws.getRange(row, 13).setValue('INSPECTED');
      ws.getRange(row, 14).setValue(data.disposition).setBackground('#E8F5E9');
      if (data.remarks) {
        var existing = String(rows[i][16] || '');
        ws.getRange(row, 17).setValue(existing ? existing + ' | ' + data.remarks : data.remarks);
      }

      var ncrNo = '';
      var ncrError = '';
      var disposeWarnings = [];
      var ledgerFailed = false;

      if (data.disposition === 'RESTOCK') {
        // Pull from QUARANTINE, push back to FG-STORE.
        // Keep status OPEN if ledger fails so the return stays visible for retry.
        if (typeof writeStockLedger_ === 'function' && productCode && fgBatchNo && qty > 0) {
          try {
            writeStockLedger_('CUSTOMER_RETURN_RESTOCK_OUT', productCode, fgBatchNo, 'QUARANTINE',
              0, qty, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'Restocked after triage');
            writeStockLedger_('CUSTOMER_RETURN_RESTOCK_IN', productCode, fgBatchNo, 'FG-STORE',
              qty, 0, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'Restocked from return ' + ref);
          } catch (ledgerErr) {
            Logger.log('CustomerReturn RESTOCK ledger failed: ' + ledgerErr.message);
            disposeWarnings.push('Stock ledger failed — return left OPEN for retry. Admin: ' + ledgerErr.message);
            ledgerFailed = true;
          }
        }
      } else if (data.disposition === 'SCRAP') {
        // Guard the scrap ledger move like RESTOCK/REWORK: if recordScrap throws,
        // keep the row OPEN (PENDING_RETRY) instead of committing it CLOSED with
        // stock still sitting in QUARANTINE (which re-triage would scrap again).
        if (typeof recordScrap === 'function') {
          try {
            recordScrap({
              refDocType: 'CUSTOMER_RETURN', refDocNo: ref,
              materialCode: productCode, batchOrLotNo: fgBatchNo,
              qtyScrap: qty, unit: unit,
              scrapReason: data.remarks || reason || 'Customer return — scrap',
              scrapDestination: 'DISPOSAL',
              recordedBy: data.disposedBy || '',
              locationId: 'QUARANTINE'
            });
          } catch (scrapErr) {
            Logger.log('CustomerReturn SCRAP ledger failed: ' + scrapErr.message);
            disposeWarnings.push('Scrap move failed — return left OPEN for retry. Admin: ' + scrapErr.message);
            ledgerFailed = true;
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
            defectDesc:   'Customer return — scrap. ' + (data.remarks || reason || '')
          });
          if (!ncrNo) {
            ncrError = 'NCR auto-raise FAILED — raise the NCR manually.';
            disposeWarnings.push(ncrError);
          }
        }
      } else if (data.disposition === 'REWORK') {
        // Move out of QUARANTINE; rework area is FG_HOLD until re-released by OQC.
        // Keep status OPEN if ledger fails so retry stays possible.
        if (typeof writeStockLedger_ === 'function' && productCode && fgBatchNo && qty > 0) {
          try {
            writeStockLedger_('CUSTOMER_RETURN_REWORK_OUT', productCode, fgBatchNo, 'QUARANTINE',
              0, qty, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'Sent to REWORK-AREA');
            writeStockLedger_('CUSTOMER_RETURN_REWORK_IN', productCode, fgBatchNo, 'REWORK-AREA',
              qty, 0, 'CUSTOMER_RETURN', ref, data.disposedBy || '', 'In rework pending re-inspection');
            _createReworkLogEntry_(ref, 'CUSTOMER_RETURN', 'CUSTOMER_RETURN', ref,
              productCode || '', productDesc || '', fgBatchNo || '', qty, unit || '', data.disposedBy || '', 'FG');
          } catch (ledgerErr) {
            Logger.log('CustomerReturn REWORK ledger failed: ' + ledgerErr.message);
            disposeWarnings.push('Stock ledger failed — return left OPEN for retry. Admin: ' + ledgerErr.message);
            ledgerFailed = true;
          }
        }
        if (typeof raiseNCR_ === 'function') {
          // Stock has ALREADY been moved to REWORK-AREA above, so raise the NCR
          // already dispositioned (rework-FG / IN_PROGRESS). This blocks a manager
          // from later calling setNCRDisposition('rework-FG') and moving the SAME
          // stock a second time (setNCRDisposition's OPEN-guard rejects it).
          ncrNo = raiseNCR_({
            date:           new Date(),
            source:         'CUSTOMER_RETURN',
            sourceRef:      ref,
            materialCode:   productCode || '',
            materialDesc:   productDesc || '',
            batchNo:        fgBatchNo || '',
            qtyAffected:    qty,
            unit:           unit || '',
            defectDesc:     'Customer return — rework required. ' + (data.remarks || reason || ''),
            preDisposition: 'rework-FG',
            preStatus:      'IN_PROGRESS',
            disposedBy:     data.disposedBy || ''
          });
          if (!ncrNo) {
            ncrError = 'NCR auto-raise FAILED — raise the NCR manually.';
            disposeWarnings.push(ncrError);
          }
        }
      }

      if (ncrNo) ws.getRange(row, 15).setValue(ncrNo);
      // Flip to CLOSED only when stock movement actually succeeded; otherwise
      // keep the row OPEN so operators can retry. SCRAP path delegates to
      // recordScrap which manages its own ledger, so we treat it as success.
      if (!ledgerFailed) {
        ws.getRange(row, 16).setValue('CLOSED');
      } else {
        // Drop the INSPECTED stamp back so the triage UI keeps showing this row.
        ws.getRange(row, 13).setValue('PENDING_RETRY');
      }
      return { success: true, ncrNo: ncrNo, ncrError: ncrError, warnings: disposeWarnings, ledgerFailed: ledgerFailed };
    }
    return { success: false, error: 'Return ' + ref + ' not found.' };
    });
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}
