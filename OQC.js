// ============================================================
// OQC.gs — Save and read OQC records
// Based on PM/FRM/FQC-01 Final Quality Control Release
// ============================================================

function getOQCFormInit() {
  var allMats = getMaterials();
  var fgMats  = allMats.filter(function(m) { return m.category && m.category.toUpperCase() === 'FG'; });
  // Each lookup is best-effort: a missing or throwing helper must not block the
  // entire form load. The UI surfaces empty dropdowns instead of a dead screen.
  var fgLocs = [];
  try { if (typeof getFGLocations === 'function') fgLocs = getFGLocations() || []; }
  catch (eLoc) { Logger.log('getFGLocations failed: ' + eLoc.message); }
  var ipqc = [];
  try { if (typeof getClosedIPQCSessionsForOQC === 'function') ipqc = getClosedIPQCSessionsForOQC() || []; }
  catch (eIp) { Logger.log('getClosedIPQCSessionsForOQC failed: ' + eIp.message); }
  return {
    docNumber:    peekNextDocNumber('oqc'),
    customers:    getCustomers(),
    materials:    fgMats,
    inspectors:   getInspectors(),
    ipqcSessions: ipqc,
    fgLocations:  fgLocs,
    today:           Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'),
    samplingMethods: ['Normal', 'Tightened', 'Reduced', 'Skip Lot', '100% Inspection'],
    defaultSampling: 'Normal'
  };
}

// P6 — released decisions for which an FG_DISPATCH_LOTS row should be created.
function _isOQCReleasedDecision_(dec) {
  var d = String(dec || '').toUpperCase();
  return d === 'RELEASED' || d === 'ACCEPTED' || d === 'ACCEPTED WITH DEVIATION';
}

// P6 — resolve product code from FG material description (master desc → code).
function _resolveProductCodeFromDesc_(desc) {
  // P6 LOW-5 — robust match: try exact (case-insensitive), then startsWith,
  // then includes. Log when fallback fires so masters drift is visible.
  try {
    var key = String(desc || '').trim();
    if (!key) return '';
    var keyLc = key.toLowerCase();
    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    var fgMats = mats.filter(function(m) { return String(m.category || '').toUpperCase() === 'FG'; });
    // 1) Exact (case-insensitive)
    for (var i = 0; i < fgMats.length; i++) {
      var d = String(fgMats[i].desc || fgMats[i].name || '').trim().toLowerCase();
      if (d === keyLc) return String(fgMats[i].code || '').trim();
    }
    // 2) startsWith fallback
    for (var j = 0; j < fgMats.length; j++) {
      var d2 = String(fgMats[j].desc || fgMats[j].name || '').trim().toLowerCase();
      if (d2 && (d2.indexOf(keyLc) === 0 || keyLc.indexOf(d2) === 0)) {
        Logger.log('_resolveProductCodeFromDesc_ startsWith fallback: "' + key + '" -> "' + fgMats[j].desc + '" (' + fgMats[j].code + ')');
        return String(fgMats[j].code || '').trim();
      }
    }
    // 3) includes fallback
    for (var k = 0; k < fgMats.length; k++) {
      var d3 = String(fgMats[k].desc || fgMats[k].name || '').trim().toLowerCase();
      if (d3 && (d3.indexOf(keyLc) >= 0 || keyLc.indexOf(d3) >= 0)) {
        Logger.log('_resolveProductCodeFromDesc_ includes fallback: "' + key + '" -> "' + fgMats[k].desc + '" (' + fgMats[k].code + ')');
        return String(fgMats[k].code || '').trim();
      }
    }
  } catch(e) {}
  return '';
}

// Req 5 helper — returns count of CLOSED IPQC sessions for a specific product+batch
// that are AVAILABLE for OQC reference (mirrors the getClosedIPQCSessionsForOQC filters):
//   1. Status must be CLOSED
//   2. sessionId must NOT already be referenced in OQC_LOG col[19] (usedRefs)
//   3. Session date (col[6]) must be within the last 30 days
// IPQC_Sessions sheet: col[0]=sessionId, col[1]=productCode, col[3]=batch,
//                       col[6]=date, col[9]=status
function _getIPQCSessionsForProductBatch_(productCode, batch) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('IPQC_Sessions');
  if (!ws) return 0;

  // Build usedRefs from OQC_LOG col[19] (1-based col 20) — same as getClosedIPQCSessionsForOQC
  var usedRefs = {};
  var oqcWs = ss.getSheetByName('OQC_LOG');
  if (oqcWs && oqcWs.getLastRow() > 1) {
    var oqcData = oqcWs.getRange(2, 20, oqcWs.getLastRow() - 1, 1).getValues();
    oqcData.forEach(function(r) { if (r[0]) usedRefs[String(r[0]).trim()] = true; });
  }

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  var rows = ws.getDataRange().getValues();
  var count = 0;
  var pcNorm = String(productCode || '').trim();
  var batchNorm = String(batch || '').trim();
  for (var i = 1; i < rows.length; i++) {
    var sid = String(rows[i][0] || '').trim();
    if (!sid) continue;
    if (String(rows[i][9] || '').trim().toUpperCase() !== 'CLOSED') continue;
    if (usedRefs[sid]) continue;
    var d = rows[i][6];
    if (d && new Date(d) < cutoff) continue;
    var rPC = String(rows[i][1] || '').trim();
    var rBatch = String(rows[i][3] || '').trim();
    if (rPC === pcNorm && rBatch === batchNorm) count++;
  }
  return count;
}

function saveOQC(data) {
  try {
    var ss  = getSpreadsheet();
    var ws  = ss.getSheetByName('OQC_LOG');
    if (!ws) throw new Error('OQC_LOG sheet not found. Run Setup first.');

    var now    = new Date();
    var dec    = data.releaseDecision || 'PENDING';
    var docNos = [];
    var operatorId = data.operatorName || '';
    var warnings = [];

    var releasedThis = _isOQCReleasedDecision_(dec);

    // Req 5 — server-side IPQC gate: if closed sessions exist for this product+batch,
    // ipqcSessionRef must be provided.
    if (data.items && data.items.length > 0) {
      for (var gi = 0; gi < data.items.length; gi++) {
        var gItem = data.items[gi];
        var gCode = String(gItem.materialCode || '').trim() || _resolveProductCodeFromDesc_(gItem.materialDesc || '');
        var gBatch = String(gItem.batchPO || '').trim();
        if (!gCode || !gBatch) continue;
        var gCount = _getIPQCSessionsForProductBatch_(gCode, gBatch);
        if (gCount > 0 && !String(gItem.ipqcSessionRef || '').trim()) {
          return { success: false, error: 'IPQC session reference required for "' + (gItem.materialDesc || gCode) + '". Select the IPQC session before recording OQC.' };
        }
      }
    }

    // Req 6 — duplicate OQC block: reject if a non-REJECTED OQC already exists for this
    // batch+material. Checks every item (not just items[0]). Normalises whitespace on
    // materialDesc (both sides) since materialCode is not stored in OQC_LOG.
    // Wrapped in withStockLock_ so the duplicate SCAN and the row APPEND (below) are
    // atomic: without the lock two concurrent releases of the same batch both pass the
    // check before either appends, double-creating FG lots + double OQC_RELEASE ledger IN.
    var oqcLock = LockService.getScriptLock();
    var oqcLockOk = false;
    try {
      oqcLockOk = oqcLock.tryLock(15000);
      if (!oqcLockOk) return { success: false, error: 'System busy (OQC lock timeout). Please retry.' };

    if (data.items && data.items.length > 0) {
      var oqcVals = ws.getDataRange().getValues();
      for (var ii = 0; ii < data.items.length; ii++) {
        var dupItem = data.items[ii];
        var dupMaterialDesc = String(dupItem.materialDesc || '').replace(/\s+/g, ' ').trim().toLowerCase();
        var dupBatch = String(dupItem.batchPO || '').trim();
        if (!dupMaterialDesc || !dupBatch) continue;
        for (var di = 1; di < oqcVals.length; di++) {
          var rowDesc = String(oqcVals[di][5] || '').replace(/\s+/g, ' ').trim().toLowerCase();
          var rowBatch = String(oqcVals[di][4] || '').trim();
          var rowDecision = String(oqcVals[di][14] || '').trim().toUpperCase();
          if (rowDesc === dupMaterialDesc && rowBatch === dupBatch && rowDecision !== 'REJECTED') {
            return { success: false, error: 'An OQC record already exists for batch "' + dupBatch + '" / "' + dupItem.materialDesc + '". Duplicate OQC blocked.' };
          }
        }
      }
    }

    // P6 — when released, require FG Location per item (defense in depth; UI also blocks)
    if (releasedThis) {
      for (var vi = 0; vi < data.items.length; vi++) {
        var fgLocCheck = String((data.items[vi] && data.items[vi].fgLocation) || data.fgLocation || '').trim();
        if (!fgLocCheck) {
          return { success: false, error: 'FG Location is required when decision is ' + dec + '.' };
        }
      }
    }

    var firstAppendRowOQC = ws.getLastRow() + 1;
    data.items.forEach(function(item) {
      var docNo  = getNextDocNumber('oqc');
      var checks = item.checks || {};
      var fgLocation = String((item && item.fgLocation) || data.fgLocation || '').trim();
      var acceptedQty = item.acceptedQty != null ? Number(item.acceptedQty) : 0;

      var row = [
        docNo,
        new Date(data.date),
        data.customerCode  || '',
        data.customerName  || '',
        item.batchPO       || '',
        item.materialDesc  || '',
        data.ipqcReviewed  || 'Y',
        item.sampleSize != null ? item.sampleSize : 0,
        checks.fillWeight  || '',
        checks.label       || '',
        checks.seal        || '',
        checks.appearance  || '',
        checks.custSpec    || '',
        data.inspector     || '',
        dec,
        data.remarks       || '',
        acceptedQty,
        item.rejectedQty != null ? item.rejectedQty : 0,
        now,
        item.ipqcSessionRef || '',
        operatorId,
        releasedThis ? fgLocation : '',  // col 22: FG Location ID
        '',                               // col 23: FG Lot ID — back-filled below if mirrored
        '',                               // col 24: Video URL — back-stamped after upload
        data.samplingMethod || 'Normal',  // col 25: Sampling Method
        '',                               // col 26: QR base64 (back-stamped after save)
        ''                                // col 27: PDF Drive URL (back-stamped after save)
      ];

      ws.appendRow(row);

      var lastRow = ws.getLastRow();
      ws.getRange(lastRow, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(lastRow, 19).setNumberFormat('dd-MMM-yyyy HH:mm');

      var decCell = ws.getRange(lastRow, 15);
      if      (dec === 'RELEASED' || dec === 'ACCEPTED') decCell.setBackground('#E8F5E9');
      else if (dec === 'ACCEPTED WITH DEVIATION') decCell.setBackground('#FFEDD5');
      else if (dec === 'REJECTED') decCell.setBackground('#FFEBEE');
      else if (dec === 'HOLD')     decCell.setBackground('#FFF3CD');

      // P6 — mirror released OQCs into FG_DISPATCH_LOTS + write OQC_RELEASE ledger IN
      if (releasedThis && acceptedQty > 0 && fgLocation) {
        try {
          // Prefer the materialCode the UI sent (canonical, no fuzzy match).
          // Fall back to description resolution only when client predates this fix.
          var productCode = String(item.materialCode || '').trim() ||
                            _resolveProductCodeFromDesc_(item.materialDesc || '');
          var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
          var unit = '';
          for (var mi = 0; mi < mats.length; mi++) {
            if (String(mats[mi].code).trim() === productCode) { unit = mats[mi].unit || ''; break; }
          }
          var lotId = _createFGDispatchLotRow_({
            oqcRef:       docNo,
            oqcDate:      new Date(data.date),
            customerCode: data.customerCode || '',
            customerName: data.customerName || '',
            productCode:  productCode,
            productDesc:  item.materialDesc || '',
            batch:        item.batchPO || '',
            fgLocation:   fgLocation,
            qtyReleased:  acceptedQty,
            unit:         unit,
            status:       'AVAILABLE',
            remarks:      'Auto-created at OQC release'
          });
          if (lotId) {
            ws.getRange(lastRow, 23).setValue(lotId);
          }
          // Ledger IN: this is the FG side's first stock entry (no paired OUT exists since
          // IPQC does not currently write to STOCK_LEDGER).
          if (productCode && item.batchPO && typeof writeStockLedger_ === 'function') {
            writeStockLedger_('OQC_RELEASE', productCode, String(item.batchPO).trim(),
              fgLocation, acceptedQty, 0,
              'OQC', docNo, data.inspector || '',
              'FG released to ' + fgLocation);
          }
        } catch (eMirror) {
          Logger.log('FG_DISPATCH_LOTS mirror failed for ' + docNo + ': ' + eMirror.message);
          // OQC decision IS recorded — partial-commit → save-with-warning.
          warnings.push('OQC released but FG dispatch lot creation failed — the released FG may not appear in Dispatch. Contact admin.');
        }
      }

      docNos.push(docNo);
    });
    } finally {
      // Release the OQC append lock once all rows are written. Duplicate-check and
      // append are now complete; the remaining NCR/video/QR work is not part of the
      // check-then-append race and can proceed unlocked.
      if (oqcLockOk) oqcLock.releaseLock();
    }

    // Auto-raise NCR for rejected OR held OQC sessions.
    var ncrNo = '';
    var ncrError = '';
    if ((dec === 'REJECTED' || dec === 'HOLD') && docNos.length > 0) {
      var firstItem = data.items[0] || {};
      var totalRejQty = data.items.reduce(function(s, it) { return s + (Number(it.rejectedQty) || 0); }, 0);
      ncrNo = raiseNCR_({
        date:         data.date,
        source:       'OQC',
        sourceRef:    docNos.join(', '),
        materialDesc: firstItem.materialDesc || '',
        batchNo:      firstItem.batchPO || '',
        qtyAffected:  totalRejQty,
        defectDesc:   data.remarks || ('OQC ' + dec.toLowerCase() + ' — see ' + docNos.join(', '))
      });
      if (!ncrNo) {
        ncrError = 'NCR auto-raise FAILED — raise the NCR manually and update the OQC record.';
        warnings.push(ncrError);
      }

      // Stock-out rejected qty to QUARANTINE when disposition is REJECTED.
      // HOLD does not move stock — material stays in place pending disposition decision.
      if (dec === 'REJECTED' && totalRejQty > 0 && typeof writeStockLedger_ === 'function') {
        data.items.forEach(function(item, idx) {
          var rejQty = Number(item.rejectedQty) || 0;
          if (rejQty <= 0) return;
          // Prefer the canonical materialCode the UI sent; fuzzy desc-resolution
          // can match the wrong FG when descriptions overlap, quarantining the
          // wrong product (or none). Fall back only for pre-fix clients.
          var productCode = String(item.materialCode || '').trim() ||
                            _resolveProductCodeFromDesc_(item.materialDesc || '');
          if (!productCode || !item.batchPO) return;
          var fgLocForReject = String((item && item.fgLocation) || data.fgLocation || '').trim() || 'FG-HOLD';
          var qLocs = (typeof getLocations === 'function') ? getLocations('QUARANTINE') : [];
          var quarId = qLocs.length > 0 ? qLocs[0].id : 'QUARANTINE';
          try {
            writeStockLedger_('OQC_REJECT_OUT', productCode, String(item.batchPO).trim(),
              fgLocForReject, 0, rejQty,
              'OQC', docNos[idx] || docNos[0], data.inspector || '',
              'OQC reject — moving to ' + quarId);
            writeStockLedger_('OQC_REJECT_QUARANTINE', productCode, String(item.batchPO).trim(),
              quarId, rejQty, 0,
              'OQC', docNos[idx] || docNos[0], data.inspector || '',
              'OQC reject — quarantined pending NCR disposition');
          } catch(ledgerErr) {
            Logger.log('OQC reject ledger write failed for ' + (docNos[idx] || '') + ': ' + ledgerErr.message);
            warnings.push('OQC rejected but stock-ledger OUT write failed — contact admin to reconcile stock.');
          }
        });
      }
    }

    // Save defect video if provided
    if ((data.videoUrl || data.videoBase64) && docNos.length > 0) {
      try {
        var resolvedVideoUrl = data.videoUrl || '';
        if (!resolvedVideoUrl && data.videoBase64) {
          var firstItemV = data.items[0] || {};
          resolvedVideoUrl = saveOQCVideo_(
            data.videoBase64, data.videoMime || 'video/mp4', data.videoExt || 'mp4',
            docNos[0], firstItemV.materialDesc || '', dec
          );
        }
        if (resolvedVideoUrl) {
          ws.getRange(firstAppendRowOQC, 24, docNos.length, 1).setValue(resolvedVideoUrl);
        }
      } catch(videoErr) {
        Logger.log('OQC video save failed: ' + videoErr.message);
        warnings.push('Record saved but video upload failed — upload manually.');
      }
    }

    // Generate QR + PDF for the first docNo
    if (docNos.length > 0) {
      try {
        var qrBase64Oqc = generateOQCQR_(docNos[0]);
        var pdfUrlOqc   = generateOQCPdf_(docNos[0]);
        if (qrBase64Oqc) ws.getRange(firstAppendRowOQC, 26, docNos.length, 1).setValue(qrBase64Oqc);
        if (pdfUrlOqc)   ws.getRange(firstAppendRowOQC, 27, docNos.length, 1).setValue(pdfUrlOqc);
      } catch(qrPdfErr) {
        Logger.log('OQC QR/PDF generation failed: ' + qrPdfErr.message);
        warnings.push('Record saved but QR/PDF generation failed — regenerate from DocView.');
      }
    }

    // Announce to Telegram + push next-action task to DWM. Best-effort.
    try {
      if (typeof qmsAnnounce_ === 'function' && docNos.length) {
        var rec = getOQCRowForWA(firstAppendRowOQC);
        if (rec) { rec.ncrRef = ncrNo || rec.ncrRef; qmsAnnounce_(rec); }
      }
    } catch (annErr) { Logger.log('OQC announce skipped: ' + annErr.message); }

    return { success: true, docNos: docNos, ncrNo: ncrNo, ncrError: ncrError, warnings: warnings };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function generateOQCQR_(docNo) {
  var target  = getPublicUrl_() + '?doc=' + encodeURIComponent(docNo);
  var apiUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&format=png&data=' + encodeURIComponent(target);
  var resp    = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('QR API returned ' + resp.getResponseCode());
  return 'data:image/png;base64,' + Utilities.base64Encode(resp.getContent());
}

function generateOQCPdf_(docNo) {
  var data = getOQCPrintData(docNo);
  var tmpl = HtmlService.createTemplateFromFile('PrintOQC_F');
  tmpl.printData = data;
  var html = tmpl.evaluate().getContent();
  var blob = Utilities.newBlob(html, 'text/html', docNo + '.html');
  // <project>/QMS Data/OQC/yyyy-MM — see QmsDrive.js
  var folder   = getQmsMonthFolder_('OQC', new Date());
  var tempFile = DriveApp.createFile(blob);
  var pdfBlob  = tempFile.getAs('application/pdf');
  pdfBlob.setName(docNo + '.pdf');
  var pdfFile  = folder.createFile(pdfBlob);
  tempFile.setTrashed(true);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return pdfFile.getUrl();
}

function getOQCPrintData(docNo) {
  var ws = getSpreadsheet().getSheetByName('OQC_LOG');
  if (!ws) throw new Error('OQC_LOG not found');
  var vals = ws.getDataRange().getValues();
  var r = null;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(docNo).trim()) { r = vals[i]; break; }
  }
  if (!r) throw new Error('No OQC record found for: ' + docNo);
  function fmtDate(v) { try { return v ? Utilities.formatDate(new Date(v), 'Asia/Kolkata', 'dd-MMM-yyyy') : '—'; } catch(e){ return String(v||'—'); } }
  return {
    docNo:          String(r[0]  || ''),
    date:           fmtDate(r[1]),
    customerCode:   String(r[2]  || ''),
    customerName:   String(r[3]  || ''),
    batchPO:        String(r[4]  || ''),
    materialDesc:   String(r[5]  || ''),
    ipqcReviewed:   String(r[6]  || ''),
    sampleSize:     r[7]  != null ? String(r[7]) : '',
    checks: {
      fillWeight:   String(r[8]  || '—'),
      label:        String(r[9]  || '—'),
      seal:         String(r[10] || '—'),
      appearance:   String(r[11] || '—'),
      custSpec:     String(r[12] || '—')
    },
    inspector:      String(r[13] || ''),
    releaseDecision:String(r[14] || ''),
    remarks:        String(r[15] || ''),
    acceptedQty:    r[16] != null ? String(r[16]) : '',
    rejectedQty:    r[17] != null ? String(r[17]) : '',
    ipqcSessionRef: String(r[19] || ''),
    fgLocation:     String(r[21] || ''),
    samplingMethod: String(r[24] || 'Normal'),
    qrBase64:       String(r[25] || ''),
    pdfUrl:         String(r[26] || ''),
    printedAt:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm')
  };
}

function getOQCPrintHtml(docNo) {
  var data = getOQCPrintData(docNo);
  var tmpl = HtmlService.createTemplateFromFile('PrintOQC_F');
  tmpl.printData = data;
  return tmpl.evaluate().getContent();
}

function saveOQCVideo_(base64, mime, ext, docNo, materialDesc, disposition) {
  var ss = getSpreadsheet();
  // <project>/QMS Data/Media/OQC/yyyy-MM — see QmsDrive.js
  var monthFolder = getQmsMediaFolder_('OQC', new Date());
  var fileName = docNo + '_' + (disposition || 'OQC').replace(/\s+/g, '_') + '.' + ext;
  var bytes = Utilities.base64Decode(base64);
  var blob  = Utilities.newBlob(bytes, mime, fileName);
  var file  = monthFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOQCIPQCCheck_(productCode, batch) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('IPQC_Sessions');
  if (!ws) return { found: false };

  var sessionId = productCode + '_' + batch;
  var data = ws.getDataRange().getValues();
  // Row 0 is header; session_id expected in col 0
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(sessionId).trim()) {
      return {
        found:     true,
        status:    data[i][9] || '',   // col J: status OPEN|CLOSED
        sessionId: sessionId,
        rounds:    data[i][10] != null ? data[i][10] : 0  // col K: rounds count
      };
    }
  }
  return { found: false };
}

function checkIPQCForBatch(productCode, batch) {
  return getOQCIPQCCheck_(productCode, batch);
}

function getOQCRowForWA(row) {
  var ws = getSpreadsheet().getSheetByName('OQC_LOG');
  if (!ws || row < 2) return null;
  // P6 LOW-6 — read the full row width so future columns (FG Location col 22,
  // FG Lot ID col 23, etc.) are not silently truncated.
  var lastCol = Math.max(20, ws.getLastColumn());
  var r = ws.getRange(row, 1, 1, lastCol).getValues()[0];
  if (!r[0]) return null;
  return {
    type:           'OQC',
    docNo:          r[0],
    date:           r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
    customer:       r[3],
    batchPO:        r[4],
    material:       r[5],
    inspector:      r[13],
    releaseDecision:r[14],
    pdfUrl:         r[26] || ''
  };
}
