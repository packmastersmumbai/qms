// ============================================================
// GRN.gs — Save and read GRN records
// ============================================================

// Measured (?diag=perfinit): the five master reads cost ~1.7s of the ~1.8s this
// call takes, and NONE of them was cached — every form open re-scanned
// MASTERS_Materials (274 rows), MASTERS_Suppliers, LOCATIONS and the inspector
// list, none of which change between two receipts.
//
// _pmCacheGet_ keys on the spreadsheet's Drive last-modified time, so an edit to
// any master invalidates this immediately; unchanged sheets serve from
// CacheService. The doc number is deliberately OUTSIDE the cache: peekNextDocNumber
// must reflect the live counter or two operators receive the same GRN number.
function getGRNFormInit() {
  var masters = _grnFormMasters_();
  return {
    docNumber:  peekNextDocNumber('grn'),
    suppliers:  masters.suppliers,
    materials:  masters.materials,
    inspectors: masters.inspectors,
    locations:  masters.locations,
    today:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

// The cacheable half of the form-init payload — everything that is a master,
// not a transaction. Shared so IQC and the other write forms can reuse the one
// cached copy instead of each paying for its own scan.
function _grnFormMasters_() {
  var cached = _pmCacheGet_('pmqms_form_masters_v1');
  if (cached) return cached;

  var locations = [];
  try { locations = (typeof getOpenRMLocations === 'function') ? getOpenRMLocations() : []; } catch(e) {}
  var out = {
    suppliers:  getSuppliers(),
    materials:  getMaterials(),
    inspectors: getInspectors(),
    locations:  locations
  };
  _pmCachePut_('pmqms_form_masters_v1', out);
  return out;
}

// Find a prior save of the SAME attempt by its client txn id. Newest-first: a
// retry is recent, so this exits after a few rows in the common case.
// Remarks is col 15 (1-based) per GRN_HEADERS; GRN No. is col 1.
function _grnTxnTag_(txnId) {
  return '[txn:' + String(txnId).replace(/[\[\]]/g, '') + ']';
}

// SHARED: remove the idempotency tag from any value a human will read.
//
// GRN, IQC and Gatepass all stamp "[txn:...]" into their Remarks column — that
// is deliberate audit evidence of which save attempt produced the row, and it
// must STAY in the sheet. But the same cell is rendered onto printed documents
// (PrintGRN_F.html:271, PrintIQC_F.html:260), so an operator remark would reach
// a customer or auditor as "Short delivery [txn:GRN-1785786271180]".
//
// Global, not suffix-anchored: text can be appended AFTER the tag (IQC's
// HOLD-close does exactly this at IQC.js:983), leaving it mid-string.
//
// Lives here rather than in three modules so a future writer inherits one
// definition instead of copying a fourth near-identical regex.
function stripTxnTag_(value) {
  return String(value || '').replace(/\s*\[txn:[^\]]*\]\s*/g, ' ').trim();
}
function _grnFindByTxn_(ws, txnId) {
  try {
    if (!ws || ws.getLastRow() < 2) return '';
    var tag = _grnTxnTag_(txnId);
    var n = ws.getLastRow() - 1;
    var gp = ws.getRange(2, 1, n, 1).getValues();
    var rm = ws.getRange(2, 15, n, 1).getValues();
    for (var i = n - 1; i >= 0; i--) {
      if (String(rm[i][0] || '').indexOf(tag) >= 0) return String(gp[i][0] || '');
    }
  } catch (e) { Logger.log('_grnFindByTxn_: ' + e.message); }
  return '';
}

// Did the save attempt carrying this txn key land? Called by the form's watchdog
// when the reply is lost in transit (measured: saveGRN takes ~12s and returns,
// but the double-iframe can drop the response). Read-only — it answers a
// question the operator would otherwise have to answer by hunting through
// Records, and turns a "may or may not have saved" warning into a fact.
function findGRNByTxn(txnId) {
  try {
    var t = String(txnId || '').trim();
    if (!t) return { docNo: '' };
    var ws = getSpreadsheet().getSheetByName('GRN_LOG');
    if (!ws) return { docNo: '' };
    return { docNo: _grnFindByTxn_(ws, t) || '' };
  } catch (e) {
    Logger.log('findGRNByTxn: ' + e.message);
    return { docNo: '', error: e.message };
  }
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

    // Idempotency guard (Phase 2D). The client's in-flight latch stops a
    // double-tap, but not a retry after a DROPPED RESPONSE — the row may already
    // be written and the reply lost, so pressing Save again duplicates the GRN
    // and its stock ledger rows. clientTxnId is stable across retries of one
    // attempt and new for a genuinely new GRN.
    //
    // Stored as a "[txn:...]" suffix in Remarks rather than a new column:
    // GRN_HEADERS is 22 wide and positional readers map schema[i] to cell[i], so
    // widening it is the exact shape of the MASTERS_Materials break.
    var grnTxnId = String(data.clientTxnId || '').trim();
    if (grnTxnId) {
      var priorGrn = _grnFindByTxn_(ws, grnTxnId);
      if (priorGrn) {
        return { success: true, docNo: priorGrn, duplicate: true,
                 warnings: ['This GRN was already saved as ' + priorGrn + '.'] };
      }
    }

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

    // Known location IDs, for the WARN-ONLY undefined-location check below.
    // Built once outside the item loop — a per-item sheet read would be N scans.
    var knownLocIds = {};
    try {
      var allLocs = (typeof getLocations === 'function') ? getLocations() : [];
      allLocs.forEach(function (l) {
        if (l && l.id) knownLocIds[String(l.id).trim().toUpperCase()] = true;
      });
    } catch (e) {}
    var undefinedLocs = {};

    items.forEach(function(item) {
      // Per-item location: explicit item.locationId → material's defaultLocation → fallback
      var itemLocation = item.locationId
        || matLocByCode[item.materialCode]
        || fallbackLocation;

      // WARN, DO NOT REJECT. STOCK_LEDGER accepts any string as a location and
      // nothing validated it, so 128 of 180 materials point at a Default Location
      // that does not exist in LOCATIONS — every receipt of those silently created
      // a "ghost" location (?diag=ghostloc found 8 holding stock, incl. RM-STORE-E
      // on 78 materials).
      //
      // A hard reject here would HALT PHYSICAL RECEIVING for all of them, which is
      // far worse than the data problem it fixes. So the receipt proceeds and the
      // caller gets a warning. Promote to a hard reject only once ?diag=ghostloc
      // has read 0 for a full week of receiving — see REMEDIATION-PLAN.md Phase 1B.
      var locKey = String(itemLocation || '').trim().toUpperCase();
      if (locKey && Object.keys(knownLocIds).length && !knownLocIds[locKey]) {
        undefinedLocs[String(itemLocation).trim()] = true;
      }
      // GRN records receipt only — no disposition at the door. Everything received is
      // PENDING until IQC inspects and decides. (A HOLD/REJECT from a stale cached client
      // is still honoured defensively, but the current form never sends one.)
      var disp = String(item.disposition || data.disposition || '').toUpperCase();
      var iqcStatus = /HOLD/.test(disp) ? 'HOLD'
                    : /REJECT/.test(disp) ? 'REJECTED'
                    : 'PENDING';
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
        // Txn tag appended so _grnFindByTxn_ can recognise a retry. Appended, not
        // substituted, so operator remarks survive.
        ((data.remarks || '') + (grnTxnId ? ' ' + _grnTxnTag_(grnTxnId) : '')).trim(),
        iqcStatus,
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
      } else if (typeof writeStockLedger_ === 'function') {
        // Guard was false: a missing materialCode / batchNo / location means the receipt
        // was NOT mirrored to STOCK_LEDGER, so this stock has 0 balance and can never be
        // issued — but the GRN row exists. Surface it instead of skipping silently (#11).
        var missing = [];
        if (!item.materialCode) missing.push('material code');
        if (!item.batchNo)      missing.push('batch/lot no');
        if (!itemLocation)      missing.push('location');
        warnings.push('Stock NOT added to inventory for ' + (item.materialDesc || item.materialCode || 'an item') +
          ' — missing ' + missing.join(', ') + '. The GRN is saved but this stock is not issuable until corrected.');
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

    // Announce to Telegram + push next-action task to DWM. Best-effort.
    try {
      if (typeof qmsAnnounce_ === 'function') {
        var rec = getGRNRowForWA(startRow);
        if (rec) qmsAnnounce_(rec);
      }
    } catch (annErr) { Logger.log('GRN announce skipped: ' + annErr.message); }

    // Undefined-location warning (see the WARN-ONLY note in the item loop). Raised
    // once per distinct location rather than per item, so a 10-line GRN into one
    // undefined location produces one warning, not ten.
    var undefKeys = Object.keys(undefinedLocs);
    if (undefKeys.length) {
      warnings.push('Received into ' + (undefKeys.length === 1 ? 'a location' : 'locations') +
        ' not defined in LOCATIONS: ' + undefKeys.join(', ') +
        '. Stock is recorded and correct, but this location will not appear on the ' +
        'warehouse map until an admin defines it.');
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
    // <project>/QMS Data/Media/GRN/yyyy-MM — see QmsDrive.js
    var monthFolder = getQmsMediaFolder_('GRN', new Date());

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
    // A missing Drive scope is not the same failure as a full disk or a bad
    // blob, and the operator can do nothing about it — but the OWNER can, by
    // re-authorizing. Naming it here is the difference between "images are
    // broken" and a one-line fix. Measured 2026-08-12: every DriveApp call
    // threw "You do not have permission to call DriveApp.getRootFolder"
    // while Sheets kept working, i.e. a stale grant, not a code fault.
    var msg = String(e.message || e);
    var isAuth = /do not have permission to call DriveApp|Required permissions/i.test(msg);
    return {
      success: false,
      error: msg,
      authError: isAuth,
      hint: isAuth
        ? 'The script has lost Drive authorization. The account that deployed ' +
          'the web app must open the Apps Script editor, Run any function once, ' +
          'and accept the Drive permission prompt. Receiving still works — ' +
          'only image and PDF storage is affected.'
        : '',
      docUrls: [], productUrls: []
    };
  }
}

// ── QR & PDF ──────────────────────────────────────────────────────────────────
function generateGRNQR_(docNo) {
  var target  = getPublicUrl_() + '?doc=' + encodeURIComponent(docNo);
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

  // <project>/QMS Data/GRN/yyyy-MM — see QmsDrive.js
  var folder = getQmsMonthFolder_('GRN', new Date());

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
    // Tag stripped for DISPLAY only — it stays in the sheet. PrintGRN_F.html:271
    // renders this straight onto the printed GRN document.
    remarks:      stripTxnTag_(r[14]),
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
    inspector:  r[16],
    pdfUrl:     r[24] || ''
  };
}
