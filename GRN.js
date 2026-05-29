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
  // Lock-free: getNextDocNumber('grn') is itself lock-guarded; appendRow is atomic;
  // applyGRNReceiptsToPO_ tolerates concurrent callers (idempotent recompute).
  // LockService removed because Apps Script web app sessions were holding the
  // script lock across background google.script.run calls (Records/Landing/PO
  // tabs polling), causing waitLock(10000) to time out on save.
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
      // GRN row is already written — a ledger failure is a partial-commit → save-with-warning.
      if (typeof writeStockLedger_ === 'function' && item.materialCode && item.batchNo && itemLocation) {
        try {
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
        } catch (ledgerErr) {
          Logger.log('GRN stock-ledger write failed for ' + item.materialCode + ': ' + ledgerErr.message);
          warnings.push('Stock ledger update failed for ' + (item.materialCode || 'item') +
            ' — GRN document saved but ledger is out of sync. Contact admin.');
        }
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

    // Back-stamp image URLs into all rows for this docNo (cols 22 & 23)
    var docImages     = (data.docImageUrls     || []).join(',');
    var productImages = (data.productImageUrls || []).join(',');
    if (docImages || productImages) {
      var allRows = ws.getDataRange().getValues();
      for (var ri = 1; ri < allRows.length; ri++) {
        if (String(allRows[ri][0]).trim() === String(docNo).trim()) {
          if (docImages)     ws.getRange(ri + 1, 22).setValue(docImages);
          if (productImages) ws.getRange(ri + 1, 23).setValue(productImages);
        }
      }
    }

    // QR + PDF (fire-and-forget; non-fatal)
    try {
      var qrBase64 = generateGRNQR_(docNo);
      var pdfUrl   = generateGRNPdf_(docNo);
      var allRows2 = ws.getDataRange().getValues();
      for (var ri2 = 1; ri2 < allRows2.length; ri2++) {
        if (String(allRows2[ri2][0]).trim() === String(docNo).trim()) {
          ws.getRange(ri2 + 1, 24).setValue(qrBase64);
          ws.getRange(ri2 + 1, 25).setValue(pdfUrl);
        }
      }
    } catch(qrErr) {
      Logger.log('GRN QR/PDF generation failed: ' + qrErr.message);
    }

    return { success: true, docNo: docNo, warnings: warnings };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// ── Image upload ──────────────────────────────────────────────────────────────
function uploadGRNImages(images) {
  // Called from client before save; returns { docUrls: [], productUrls: [] }
  // images = [{ base64, mime, kind }]  kind = 'doc' | 'product'
  try {
    var ss = getSpreadsheet();
    var ssFile = DriveApp.getFileById(ss.getId());
    var parents = ssFile.getParents();
    if (!parents.hasNext()) throw new Error('Cannot find parent folder of spreadsheet.');
    var projectFolder = parents.next();
    var mediaFolder = getOrCreateFolder_(projectFolder, 'Media');
    var grnFolder   = getOrCreateFolder_(mediaFolder, 'GRN');
    var monthKey    = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');
    var monthFolder = getOrCreateFolder_(grnFolder, monthKey);

    var docUrls     = [];
    var productUrls = [];
    var docIdx = 1, prodIdx = 1;

    (images || []).slice(0, 10).forEach(function(img) {
      var ext      = img.mime === 'image/jpeg' ? 'jpg' : 'png';
      var kind     = img.kind === 'product' ? 'PRD' : 'DOC';
      var idx      = img.kind === 'product' ? prodIdx++ : docIdx++;
      var filename = 'GRN_' + kind + '_' + idx + '_' + Date.now() + '.' + ext;
      var blob     = Utilities.newBlob(Utilities.base64Decode(img.base64), img.mime, filename);
      var file     = monthFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      if (img.kind === 'product') productUrls.push(file.getUrl());
      else                        docUrls.push(file.getUrl());
    });

    return { success: true, docUrls: docUrls, productUrls: productUrls };
  } catch(e) {
    Logger.log('uploadGRNImages: ' + e.message);
    return { success: false, error: e.message, docUrls: [], productUrls: [] };
  }
}

// ── QR & PDF ──────────────────────────────────────────────────────────────────
function generateGRNQR_(docNo) {
  var GAS_URL = ScriptApp.getService().getUrl();
  var target  = GAS_URL + '?doc=' + encodeURIComponent(docNo);
  var apiUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&format=png&data=' + encodeURIComponent(target);
  var resp    = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('QR API returned ' + resp.getResponseCode());
  return 'data:image/png;base64,' + Utilities.base64Encode(resp.getContent());
}

function generateGRNPdf_(docNo) {
  var data = getGRNPrintData(docNo);
  var tmpl = HtmlService.createTemplateFromFile('PrintGRN_F');
  tmpl.printData = data;
  var html = tmpl.evaluate().getContent();
  var blob = Utilities.newBlob(html, 'text/html', docNo + '.html');

  var date    = new Date();
  var yearMon = Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM');
  var folders = DriveApp.getFoldersByName('QMS/GRN/' + yearMon);
  var folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder('QMS/GRN/' + yearMon);

  var tempFile = DriveApp.createFile(blob);
  var pdfBlob  = tempFile.getAs('application/pdf');
  pdfBlob.setName(docNo + '.pdf');
  var pdfFile  = folder.createFile(pdfBlob);
  tempFile.setTrashed(true);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return pdfFile.getUrl();
}

// ── Print data ────────────────────────────────────────────────────────────────
function getGRNPrintData(docNo) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) throw new Error('GRN_LOG not found');
  var vals = ws.getDataRange().getValues();
  // Collect all rows for this docNo (multi-item GRN)
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(docNo).trim()) rows.push(vals[i]);
  }
  if (!rows.length) throw new Error('No GRN record found for: ' + docNo);
  var r = rows[0];

  function fmtDate(v) {
    try { return v ? Utilities.formatDate(new Date(v), 'Asia/Kolkata', 'dd-MMM-yyyy') : '—'; }
    catch(e) { return String(v || '—'); }
  }

  var docImages     = String(r[21] || '').split(',').map(function(u){ return u.trim(); }).filter(Boolean);
  var productImages = String(r[22] || '').split(',').map(function(u){ return u.trim(); }).filter(Boolean);
  var allImages     = docImages.concat(productImages);

  var items = rows.map(function(row) {
    return {
      materialCode: String(row[6]  || ''),
      materialDesc: String(row[7]  || ''),
      batchNo:      String(row[8]  || ''),
      qtyOrdered:   row[9]  != null ? String(row[9])  : '',
      qtyReceived:  row[10] != null ? String(row[10]) : '',
      unit:         String(row[11] || ''),
      expiryDate:   fmtDate(row[13])
    };
  });

  return {
    docNo:        String(r[0]  || ''),
    date:         fmtDate(r[1]),
    supplierCode: String(r[2]  || ''),
    supplierName: String(r[3]  || ''),
    poRef:        String(r[4]  || ''),
    invoiceNo:    String(r[5]  || ''),
    coaReceived:  String(r[12] || ''),
    remarks:      String(r[14] || ''),
    status:       String(r[15] || ''),
    inspector:    String(r[16] || ''),
    storageZone:  String(r[18] || ''),
    items:        items,
    docImages:    docImages,
    productImages:productImages,
    allImages:    allImages,
    qrBase64:     String(r[23] || ''),
    pdfUrl:       String(r[24] || ''),
    printedAt:    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm')
  };
}

function getGRNPrintHtml(docNo) {
  var data = getGRNPrintData(docNo);
  var tmpl = HtmlService.createTemplateFromFile('PrintGRN_F');
  tmpl.printData = data;
  return tmpl.evaluate().getContent();
}

function updateGRNIQCStatus(grnNo, status) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return;
  var data = ws.getDataRange().getValues();
  var color = status === 'ACCEPTED' ? '#E8F5E9' :
              status === 'REJECTED' ? '#FFEBEE' :
              status === 'HOLD'     ? '#FFF3CD' :
              status === 'CLOSED'   ? '#E3F2FD' : '#FFFFFF';
  var closedAt = status === 'CLOSED' ? new Date() : null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(grnNo).trim()) {
      ws.getRange(i + 1, 16).setValue(status).setBackground(color);
      if (closedAt) {
        ws.getRange(i + 1, 22).setValue(closedAt).setNumberFormat('dd-MMM-yyyy HH:mm');
      }
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
