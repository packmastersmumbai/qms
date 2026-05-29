// ============================================================
// IQC.gs — Save and read IQC records
// 12 inspection parameters from PM/FRM/IQC-02
// ============================================================

var IQC_PARAMS = [
  { id: 'qty',    label: 'Quantity',             spec: 'As per PO',                     ccp: true,  hint: 'Verify count / weight matches PO exactly' },
  { id: 'pkg',    label: 'Packaging Condition',  spec: 'Intact / Undamaged',            ccp: false, hint: 'Check for tears, dents, wet damage' },
  { id: 'colour', label: 'Colour',               spec: 'Per approved sample',           ccp: true,  hint: 'Compare against approved colour swatch' },
  { id: 'shape',  label: 'Shape / Form',         spec: 'Per specification',             ccp: false, hint: 'Check for deformation, correct geometry' },
  { id: 'dims',   label: 'Size / Dimensions',    spec: 'Per spec sheet',                ccp: true,  hint: 'Measure at least 3 samples with vernier' },
  { id: 'weight', label: 'Net Weight',           spec: 'Per spec (calibrated balance)', ccp: true,  hint: 'Use calibrated balance; deduct tare' },
  { id: 'clean',  label: 'Cleanliness',          spec: 'No contamination',              ccp: true,  hint: 'Visual + tactile; check for foreign matter' },
  { id: 'odour',  label: 'Odour',                spec: 'Normal / None',                 ccp: false, hint: 'Unusual odour may indicate contamination' },
  { id: 'label',  label: 'Label Accuracy',       spec: 'Matches PO / Spec',             ccp: false, hint: 'Verify item code, batch, MFD/EXP dates' },
  { id: 'msds',   label: 'MSDS / SDS Available', spec: 'Received',                      ccp: false, hint: 'Confirm MSDS on file for this material' },
  { id: 'shelf',  label: 'Shelf Life / Expiry',  spec: 'Min 75% remaining',             ccp: true,  hint: 'Remaining life must be ≥75% at receipt' },
  { id: 'coa',    label: 'COA / Test Report',    spec: 'Received & Verified',           ccp: true,  hint: 'COA values must match spec; verify lot no.' }
];

var IQC_SAMPLING_METHODS = ['Normal', 'Tightened', 'Reduced', 'Skip Lot', '100% Inspection'];

function getIQCFormInit() {
  return {
    docNumber:  peekNextDocNumber('iqc'),
    recentGRNs: getUnInspectedGRNs(),
    inspectors: getInspectors(),
    params:          IQC_PARAMS,
    aqlLevels:       ['AQL 0.65', 'AQL 1.0', 'AQL 2.5', 'AQL 4.0', 'AQL 6.5'],
    defaultAql:      'AQL 2.5',
    samplingMethods: IQC_SAMPLING_METHODS,
    defaultSampling: 'Normal',
    today:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

// Returns only GRNs that do NOT already have an IQC record linked to them
function getUnInspectedGRNs() {
  var ss = getSpreadsheet();

  // Collect GRN numbers that already have an IQC record (IQC_LOG col 3 = GRN No.)
  var inspectedSet = {};
  var iqcWs = ss.getSheetByName('IQC_LOG');
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iqcVals = iqcWs.getRange(2, 3, iqcWs.getLastRow() - 1, 1).getValues();
    iqcVals.forEach(function(r) {
      if (r[0]) inspectedSet[String(r[0]).trim()] = true;
    });
  }

  // Get all GRNs and filter out those already inspected
  var allGRNs = getRecentGRNs();
  return allGRNs.filter(function(g) {
    return !inspectedSet[String(g.grnNo).trim()];
  });
}

function saveIQC(data) {
  try {
    var ss  = getSpreadsheet();
    var ws  = ss.getSheetByName('IQC_LOG');
    if (!ws) throw new Error('IQC_LOG sheet not found. Run Setup first.');

    var now  = new Date();
    var disp = data.disposition || '';
    var operatorId = data.operatorName || '';

    // NCR is raised once for the whole rejected session (after rows are written),
    // and back-stamped into col 24 of every row in this batch. ncrRef can be
    // pre-supplied by caller to override; otherwise auto-raised on REJECTED.
    var ncrNo = data.ncrRef || '';

    var docNos = [];
    var ledgerWarning = '';

    // Capture the first data row we will write BEFORE the append loop.
    // This prevents the back-stamp (NCR ref in col 24) from landing on the
    // wrong rows when a concurrent insert happens between appendRow and
    // the post-loop getLastRow() recompute (Race 3 fix).
    var firstAppendRow = ws.getLastRow() + 1;

    data.items.forEach(function(item) {
      var docNo  = getNextDocNumber('iqc');
      var params = item.params || {};

      var row = [
        docNo,                          // col 1
        new Date(data.date),            // col 2
        data.grnNo,                     // col 3
        data.supplierName  || '',       // col 4
        item.materialDesc  || '',       // col 5
        item.batchNo       || '',       // col 6
        data.inspector     || '',       // col 7
        data.aqlLevel      || 'AQL 2.5', // col 8
        item.sampleSize != null ? item.sampleSize : 0,  // col 9
        data.sampleId      || '',       // col 10
        params.qty    || '',            // col 11
        params.pkg    || '',            // col 12
        params.colour || '',            // col 13
        params.shape  || '',            // col 14
        params.dims   || '',            // col 15
        params.weight || '',            // col 16
        params.clean  || '',            // col 17
        params.odour  || '',            // col 18
        params.label  || '',            // col 19
        params.msds   || '',            // col 20
        params.shelf  || '',            // col 21
        params.coa    || '',            // col 22
        disp,                           // col 23
        ncrNo,                          // col 24
        data.deviationRef  || '',       // col 25
        data.remarks       || '',       // col 26
        item.acceptedQty != null ? item.acceptedQty : 0,  // col 27
        item.rejectedQty != null ? item.rejectedQty : 0,  // col 28
        now,                            // col 29
        operatorId,                     // col 30
        '',                             // col 31: video URL (back-stamped after save)
        item.holdQty != null ? item.holdQty : 0, // col 32: qty on hold
        data.poRef         || '',       // col 33: PO Reference
        data.invoiceNo     || '',       // col 34: Invoice No.
        data.storeInCharge   || '',       // col 35: Store In-Charge
        data.qaManager       || '',       // col 36: QA Manager
        '',                              // col 37: Image URLs (back-stamped after upload)
        data.samplingMethod  || 'Normal', // col 38: Sampling Method
        '',                              // col 39: QR base64 (back-stamped after save)
        ''                               // col 40: PDF Drive URL (back-stamped after save)
      ];

      ws.appendRow(row);

      var lastRow = ws.getLastRow();
      ws.getRange(lastRow, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(lastRow, 29).setNumberFormat('dd-MMM-yyyy HH:mm');

      // Colour-code disposition cell (col 23)
      var dispCell = ws.getRange(lastRow, 23);
      if      (disp === 'ACCEPTED')               dispCell.setBackground('#E8F5E9');
      else if (disp === 'REJECTED')               dispCell.setBackground('#FFEBEE');
      else if (disp === 'HOLD')                   dispCell.setBackground('#FFF3CD');
      else if (disp === 'PARTIAL')                dispCell.setBackground('#FFF3CD');
      else if (disp === 'ACCEPTED WITH DEVIATION') dispCell.setBackground('#FFE0B2');

      // Stock ledger movements per qty split
      if (typeof writeStockLedger_ === 'function') {
        try {
          var grnLoc = '';
          var grnWs2 = ss.getSheetByName('GRN_LOG');
          if (grnWs2 && grnWs2.getLastRow() > 1 && data.grnNo) {
            var grnData = grnWs2.getDataRange().getValues();
            for (var gi = 1; gi < grnData.length; gi++) {
              if (String(grnData[gi][0]).trim() === String(data.grnNo).trim() &&
                  String(grnData[gi][8]).trim() === String(item.batchNo || '').trim()) {
                grnLoc = String(grnData[gi][20] || '').trim();
                break;
              }
            }
          }
          var matCode = item.materialCode || '';
          var accQty  = Number(item.acceptedQty) || 0;
          var rejQty  = Number(item.rejectedQty) || 0;
          var hldQty  = Number(item.holdQty)     || 0;

          if (!matCode || !item.batchNo || !grnLoc) throw new Error('Missing matCode/batch/location for ledger');

          // Accepted portion — status marker only (stock stays in GRN location)
          if (accQty > 0 || disp === 'ACCEPTED' || disp === 'ACCEPTED WITH DEVIATION') {
            writeStockLedger_('IQC_ACCEPT', matCode, item.batchNo, grnLoc,
              0, 0, 'IQC', docNo, data.inspector || '',
              'IQC accept (' + accQty + ') — stock available for issuance');
          }

          // Rejected portion → QUARANTINE
          if (rejQty > 0) {
            var qLocs = (typeof getLocations === 'function') ? getLocations('QUARANTINE') : [];
            var quarId = qLocs.length > 0 ? qLocs[0].id : 'QUARANTINE';
            writeStockLedger_('IQC_REJECT_OUT', matCode, item.batchNo, grnLoc,
              0, rejQty, 'IQC', docNo, data.inspector || '',
              'IQC reject — moved to ' + quarId);
            writeStockLedger_('IQC_REJECT_QUARANTINE', matCode, item.batchNo, quarId,
              rejQty, 0, 'IQC', docNo, data.inspector || '',
              'IQC reject — quarantined pending NCR disposition');
          }

          // Hold portion → HOLD location
          if (hldQty > 0) {
            var hLocs = (typeof getLocations === 'function') ? getLocations('HOLD') : [];
            var holdId = hLocs.length > 0 ? hLocs[0].id : 'HOLD';
            writeStockLedger_('IQC_HOLD_OUT', matCode, item.batchNo, grnLoc,
              0, hldQty, 'IQC', docNo, data.inspector || '',
              'IQC hold — moved to ' + holdId + ' pending decision');
            writeStockLedger_('IQC_HOLD_IN', matCode, item.batchNo, holdId,
              hldQty, 0, 'IQC', docNo, data.inspector || '',
              'IQC hold — awaiting final disposition');
          }
        } catch(ledgerErr) {
          Logger.log('IQC ledger mirror failed: ' + ledgerErr.message);
          if (!ledgerWarning) {
            ledgerWarning = 'Document saved but stock ledger update failed — contact admin.';
          }
        }
      }

      // Record physical sample deduction
      var sampQty = Number(item.sampleSize) || 0;
      if (sampQty > 0 && item.materialCode && item.batchNo) {
        try {
          recordSample({
            refDocType:    'IQC',
            refDocNo:      docNo,
            materialCode:  item.materialCode,
            batchOrLotNo:  item.batchNo,
            qtySample:     sampQty,
            unit:          item.unit || '',
            samplePurpose: 'IQC inspection',
            takenBy:       data.inspector || operatorId,
            locationStored: 'SAMPLE-CABINET',
            locationId:    'SAMPLE-CABINET'
          });
        } catch(sampErr) {
          Logger.log('IQC recordSample failed: ' + sampErr.message);
        }
      }

      docNos.push(docNo);
    });

    var warnings = [];
    if (ledgerWarning) warnings.push(ledgerWarning);

    // Update GRN status; close GRN when all items have a final IQC disposition
    if (data.grnNo) {
      updateGRNIQCStatus(data.grnNo, disp || 'PENDING');
      var finalDisps = ['ACCEPTED', 'REJECTED', 'HOLD', 'PARTIAL', 'ACCEPTED WITH DEVIATION'];
      if (finalDisps.indexOf(disp) !== -1) {
        try {
          var grnWs3 = ss.getSheetByName('GRN_LOG');
          var iqcWs2 = ss.getSheetByName('IQC_LOG');
          if (grnWs3 && iqcWs2) {
            var grnRows = grnWs3.getDataRange().getValues();
            // Collect all batches on this GRN
            var grnBatches = [];
            for (var gi2 = 1; gi2 < grnRows.length; gi2++) {
              if (String(grnRows[gi2][0]).trim() === String(data.grnNo).trim()) {
                grnBatches.push(String(grnRows[gi2][8]).trim()); // col 9 = Batch
              }
            }
            // Check each batch has a final IQC entry
            var iqcRows = iqcWs2.getDataRange().getValues();
            var allFinal = grnBatches.length > 0 && grnBatches.every(function(batch) {
              for (var ii = 1; ii < iqcRows.length; ii++) {
                if (String(iqcRows[ii][2]).trim() === String(data.grnNo).trim() &&
                    String(iqcRows[ii][5]).trim() === batch) {
                  var d2 = String(iqcRows[ii][22] || '').trim();
                  if (finalDisps.indexOf(d2) !== -1) return true;
                }
              }
              return false;
            });
            if (allFinal) updateGRNIQCStatus(data.grnNo, 'CLOSED');
          }
        } catch(closeErr) {
          Logger.log('GRN auto-close failed: ' + closeErr.message);
        }
      }
    }

    // Auto-raise NCR for rejected OR held sessions, then back-stamp col 24 (NCR Ref) on every row of this batch.
    var ncrError = '';
    if ((disp === 'REJECTED' || disp === 'HOLD' || disp === 'PARTIAL') && !ncrNo && docNos.length > 0) {
      var firstItem = data.items[0] || {};
      // NCR qty = rejected + hold portions (the non-accepted qty needing investigation)
      var ncrQty = data.items.reduce(function(s, it) {
        return s + (Number(it.rejectedQty) || 0) + (Number(it.holdQty) || 0);
      }, 0);
      ncrNo = raiseNCR_({
        date:         data.date,
        source:       'IQC',
        sourceRef:    docNos.join(', '),
        materialCode: firstItem.materialCode || '',
        materialDesc: firstItem.materialDesc || '',
        batchNo:      firstItem.batchNo || '',
        qtyAffected:  ncrQty,
        unit:         firstItem.unit || '',
        defectDesc:   data.remarks || ('IQC ' + disp.toLowerCase() + ' — see ' + docNos.join(', '))
      });
      if (ncrNo) {
        // Use the pre-loop captured index — not a post-loop getLastRow() recompute —
        // so a concurrent insert cannot cause the back-stamp to hit the wrong rows.
        ws.getRange(firstAppendRow, 24, docNos.length, 1).setValue(ncrNo);
      } else {
        ncrError = 'NCR auto-raise FAILED — raise the NCR manually and update the IQC record.';
        warnings.push(ncrError);
      }
    }

    // Save defect video if provided
    if ((data.videoUrl || data.videoBase64) && docNos.length > 0) {
      try {
        var resolvedVideoUrl = data.videoUrl || '';
        if (!resolvedVideoUrl && data.videoBase64) {
          var firstItem = data.items[0] || {};
          resolvedVideoUrl = saveIQCVideo_(
            data.videoBase64,
            data.videoMime  || 'video/mp4',
            data.videoExt   || 'mp4',
            docNos[0],
            data.grnNo      || '',
            firstItem.materialDesc || '',
            data.disposition || ''
          );
        }
        if (resolvedVideoUrl) {
          // Back-stamp video URL into col 31 of every row in this batch
          ws.getRange(firstAppendRow, 31, docNos.length, 1).setValue(resolvedVideoUrl);
        }
      } catch(videoErr) {
        Logger.log('IQC video save failed: ' + videoErr.message);
        warnings.push('Record saved but video upload failed — upload manually.');
      }
    }

    // Upload defect images if provided (back-stamp URLs into col 37)
    if (data.images && data.images.length > 0 && docNos.length > 0) {
      try {
        var imageUrls = uploadIQCImages_(data.images, docNos[0], data.grnNo || '');
        if (imageUrls.length > 0) {
          ws.getRange(firstAppendRow, 37, docNos.length, 1).setValue(imageUrls.join(','));
        }
      } catch(imgErr) {
        Logger.log('IQC image upload failed: ' + imgErr.message);
        warnings.push('Record saved but image upload failed — upload manually.');
      }
    }

    // Generate QR + PDF for the first docNo (one per submission batch)
    if (docNos.length > 0) {
      try {
        var primaryDoc = docNos[0];
        var qrBase64 = generateIQCQR_(primaryDoc);
        var pdfUrl   = generateIQCPdf_(primaryDoc, data.samplingMethod || 'Normal');
        if (qrBase64) ws.getRange(firstAppendRow, 39, docNos.length, 1).setValue(qrBase64);
        if (pdfUrl)   ws.getRange(firstAppendRow, 40, docNos.length, 1).setValue(pdfUrl);
      } catch(qrPdfErr) {
        Logger.log('IQC QR/PDF generation failed: ' + qrPdfErr.message);
        warnings.push('Record saved but QR/PDF generation failed — regenerate from DocView.');
      }
    }

    return { success: true, docNos: docNos, ncrNo: ncrNo, ncrError: ncrError, warnings: warnings };

  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function saveIQCVideo_(base64, mime, ext, docNo, grnNo, materialDesc, disposition) {
  var ss = getSpreadsheet();
  var ssFile = DriveApp.getFileById(ss.getId());
  var parents = ssFile.getParents();
  if (!parents.hasNext()) throw new Error('Cannot find parent folder of spreadsheet.');
  var projectFolder = parents.next();

  // Media/IQC/YYYY-MM/
  var mediaFolder = getOrCreateFolder_(projectFolder, 'Media');
  var iqcFolder   = getOrCreateFolder_(mediaFolder, 'IQC');
  var monthKey    = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var monthFolder = getOrCreateFolder_(iqcFolder, monthKey);

  // Sanitise components for filename
  function clean(s) { return String(s||'').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 30); }
  var filename = [
    'IQC',
    clean(docNo),
    clean(grnNo),
    clean(materialDesc),
    clean(disposition)
  ].join('_') + '.' + ext;

  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, filename);
  var file = monthFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function uploadIQCImages_(images, docNo, grnNo) {
  var ss = getSpreadsheet();
  var ssFile = DriveApp.getFileById(ss.getId());
  var parents = ssFile.getParents();
  if (!parents.hasNext()) throw new Error('Cannot find parent folder of spreadsheet.');
  var projectFolder = parents.next();
  var mediaFolder = getOrCreateFolder_(projectFolder, 'Media');
  var iqcFolder   = getOrCreateFolder_(mediaFolder, 'IQC');
  var monthKey    = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var monthFolder = getOrCreateFolder_(iqcFolder, monthKey);

  function clean(s) { return String(s||'').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 20); }
  var urls = [];
  images.slice(0, 5).forEach(function(img, idx) {
    var ext = img.mime === 'image/jpeg' ? 'jpg' : 'png';
    var filename = ['IQC', clean(docNo), clean(grnNo), (idx+1)].join('_') + '.' + ext;
    var blob = Utilities.newBlob(Utilities.base64Decode(img.base64), img.mime, filename);
    var file = monthFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urls.push(file.getUrl());
  });
  return urls;
}

function getIQCPrintData(docNo) {
  var ws = getSpreadsheet().getSheetByName('IQC_LOG');
  if (!ws) throw new Error('IQC_LOG not found');
  var vals = ws.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(docNo).trim()) rows.push(vals[i]);
  }
  if (!rows.length) throw new Error('No IQC record found for: ' + docNo);
  var r = rows[0];

  function fmtDate(v) { try { return v ? Utilities.formatDate(new Date(v), 'Asia/Kolkata', 'dd-MMM-yyyy') : '—'; } catch(e){ return String(v||'—'); } }

  var paramResults = {};
  var paramIds = ['qty','pkg','colour','shape','dims','weight','clean','odour','label','msds','shelf','coa'];
  paramIds.forEach(function(id, idx) { paramResults[id] = String(r[10 + idx] || '—'); });

  var imageUrls = String(r[36] || '').split(',').map(function(u){ return u.trim(); }).filter(Boolean);

  return {
    docNo:         String(r[0]  || ''),
    date:          fmtDate(r[1]),
    grnNo:         String(r[2]  || ''),
    supplierName:  String(r[3]  || ''),
    materialCode:  (function() {
      // IQC_LOG does not store materialCode; look it up from GRN_LOG by grnNo + materialDesc
      try {
        var grnWs = getSpreadsheet().getSheetByName('GRN_LOG');
        if (!grnWs || grnWs.getLastRow() < 2) return '';
        var gd = grnWs.getDataRange().getValues();
        var grnNo_ = String(r[2] || '').trim();
        var desc_  = String(r[4] || '').trim();
        for (var gi = 1; gi < gd.length; gi++) {
          if (String(gd[gi][0]).trim() === grnNo_ && String(gd[gi][7]).trim() === desc_) {
            return String(gd[gi][6] || '');
          }
        }
      } catch(e) {}
      return '';
    })(),
    materialDesc:  String(r[4]  || ''),
    batchNo:       String(r[5]  || ''),
    inspector:     String(r[6]  || ''),
    aqlLevel:      String(r[7]  || ''),
    sampleSize:    r[8]  != null ? String(r[8])  : '',
    sampleId:      String(r[9]  || ''),
    params:        paramResults,
    paramDefs:     IQC_PARAMS,
    disposition:   String(r[22] || ''),
    ncrRef:        String(r[23] || ''),
    deviationRef:  String(r[24] || ''),
    remarks:       String(r[25] || ''),
    acceptedQty:   r[26] != null ? String(r[26]) : '',
    rejectedQty:   r[27] != null ? String(r[27]) : '',
    holdQty:       r[31] != null ? String(r[31]) : '',
    poRef:         String(r[32] || ''),
    invoiceNo:     String(r[33] || ''),
    storeInCharge: String(r[34] || ''),
    qaManager:     String(r[35] || ''),
    imageUrls:     imageUrls,
    samplingMethod: String(r[37] || 'Normal'),
    qrBase64:      String(r[38] || ''),
    pdfUrl:        String(r[39] || ''),
    printedAt:     Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm')
  };
}

function generateIQCQR_(docNo) {
  var GAS_URL = ScriptApp.getService().getUrl();
  var target  = GAS_URL + '?doc=' + encodeURIComponent(docNo);
  var apiUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&format=png&data=' + encodeURIComponent(target);
  var resp    = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('QR API returned ' + resp.getResponseCode());
  return 'data:image/png;base64,' + Utilities.base64Encode(resp.getContent());
}

function generateIQCPdf_(docNo, samplingMethod) {
  var data = getIQCPrintData(docNo);
  var tmpl = HtmlService.createTemplateFromFile('PrintIQC_F');
  tmpl.printData = data;
  tmpl.paramDefs = IQC_PARAMS;
  var html = tmpl.evaluate().getContent();
  var blob = Utilities.newBlob(html, 'text/html', docNo + '.html');

  var ss       = getSpreadsheet();
  var date     = new Date();
  var yearMon  = Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM');
  var rootName = 'QMS/IQC/' + yearMon;
  var folders  = DriveApp.getFoldersByName(rootName);
  var folder   = folders.hasNext() ? folders.next() : DriveApp.createFolder(rootName);

  // Convert HTML blob to PDF via Drive
  var tempFile = DriveApp.createFile(blob);
  var pdfBlob  = tempFile.getAs('application/pdf');
  pdfBlob.setName(docNo + '.pdf');
  var pdfFile  = folder.createFile(pdfBlob);
  tempFile.setTrashed(true);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return pdfFile.getUrl();
}

function getIQCPrintHtml(docNo) {
  var data = getIQCPrintData(docNo);
  var tmpl = HtmlService.createTemplateFromFile('PrintIQC_F');
  tmpl.printData = data;
  tmpl.paramDefs = IQC_PARAMS;
  return tmpl.evaluate().getContent();
}

function getIQCRowForWA(row) {
  var ws = getSpreadsheet().getSheetByName('IQC_LOG');
  if (!ws || row < 2) return null;
  var r = ws.getRange(row, 1, 1, 29).getValues()[0];
  if (!r[0]) return null;
  return {
    type:       'IQC',
    docNo:      r[0],
    date:       r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
    grnNo:      r[2],
    supplier:   r[3],
    material:   r[4],
    batch:      r[5],
    inspector:  r[6],
    disposition:r[22],
    ncrRef:     r[23]
  };
}

// Closes a HOLD or PARTIAL IQC record with a final disposition for the held qty.
// data: { docNo, finalDisp ('ACCEPTED'|'REJECTED'), acceptedQty, rejectedQty, remarks, inspector }
function closeHoldIQC(data) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('IQC_LOG');
    if (!ws) throw new Error('IQC_LOG not found');

    // Find the row by docNo
    var vals = ws.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === String(data.docNo).trim()) { rowIdx = i; break; }
    }
    if (rowIdx < 0) throw new Error('IQC record not found: ' + data.docNo);

    var r         = vals[rowIdx];
    var curDisp   = String(r[22] || '').trim();
    var holdQty   = Number(r[31]) || 0;  // col 32
    var matCode   = String(r[4]  || '').trim();  // materialCode — stored in col 5 in WA fn but col 5 = materialDesc; use col 7 via GRN lookup
    var batchNo   = String(r[5]  || '').trim();
    var grnNo     = String(r[2]  || '').trim();
    var inspector = data.inspector || String(r[6] || '').trim();

    if (curDisp !== 'HOLD' && curDisp !== 'PARTIAL') {
      throw new Error('Record ' + data.docNo + ' is not in HOLD/PARTIAL state (current: ' + curDisp + ')');
    }
    if (holdQty <= 0) throw new Error('No hold qty recorded on this IQC row');

    var newAccepted = Number(data.acceptedQty) || 0;
    var newRejected = Number(data.rejectedQty) || 0;
    if (Math.abs(newAccepted + newRejected - holdQty) > 0.001) {
      throw new Error('Accepted + Rejected must equal hold qty (' + holdQty + ')');
    }

    // Recompute overall disposition based on original qtys + resolved hold
    var origAccepted = Number(r[26]) || 0;  // col 27
    var origRejected = Number(r[27]) || 0;  // col 28
    var totalAccepted = origAccepted + newAccepted;
    var totalRejected = origRejected + newRejected;
    var newDisp = totalRejected === 0 ? 'ACCEPTED' : totalAccepted === 0 ? 'REJECTED' : 'PARTIAL_CLOSED';

    var sheetRow = rowIdx + 1;
    ws.getRange(sheetRow, 23).setValue(newDisp);      // col 23 disposition
    ws.getRange(sheetRow, 27).setValue(totalAccepted); // col 27 acceptedQty
    ws.getRange(sheetRow, 28).setValue(totalRejected); // col 28 rejectedQty
    ws.getRange(sheetRow, 32).setValue(0);             // col 32 holdQty cleared
    if (data.remarks) {
      var existing = String(r[25] || '');
      ws.getRange(sheetRow, 26).setValue(existing + (existing ? ' | ' : '') + 'HOLD CLOSED: ' + data.remarks);
    }

    // Colour code
    var dispCell = ws.getRange(sheetRow, 23);
    if (newDisp === 'ACCEPTED')        dispCell.setBackground('#E8F5E9');
    else if (newDisp === 'REJECTED')   dispCell.setBackground('#FFEBEE');
    else                               dispCell.setBackground('#FFE0B2');

    // Stock movements: move hold qty out of HOLD location
    if (typeof writeStockLedger_ === 'function' && holdQty > 0) {
      var hLocs = (typeof getLocations === 'function') ? getLocations('HOLD') : [];
      var holdId = hLocs.length > 0 ? hLocs[0].id : 'HOLD';

      // Resolve GRN location for re-accept
      var grnLoc = '';
      var grnWs = ss.getSheetByName('GRN_LOG');
      if (grnWs && grnNo) {
        var grnVals = grnWs.getDataRange().getValues();
        for (var g = 1; g < grnVals.length; g++) {
          if (String(grnVals[g][0]).trim() === grnNo && String(grnVals[g][8]).trim() === batchNo) {
            grnLoc = String(grnVals[g][20] || '').trim(); break;
          }
        }
      }

      // Get materialCode from GRN (IQC_LOG col5 = materialDesc, not materialCode)
      var mCode = '';
      if (grnWs) {
        var gv = grnWs.getDataRange().getValues();
        for (var g2 = 1; g2 < gv.length; g2++) {
          if (String(gv[g2][0]).trim() === grnNo && String(gv[g2][8]).trim() === batchNo) {
            mCode = String(gv[g2][6] || '').trim(); break;
          }
        }
      }

      if (newAccepted > 0 && grnLoc && mCode) {
        writeStockLedger_('IQC_HOLD_ACCEPT', mCode, batchNo, holdId,
          0, newAccepted, 'IQC', data.docNo, inspector, 'Hold resolved — accepted ' + newAccepted);
        writeStockLedger_('IQC_HOLD_ACCEPT', mCode, batchNo, grnLoc,
          newAccepted, 0, 'IQC', data.docNo, inspector, 'Hold resolved — returned to stock');
      }
      if (newRejected > 0 && mCode) {
        var qLocs = (typeof getLocations === 'function') ? getLocations('QUARANTINE') : [];
        var quarId = qLocs.length > 0 ? qLocs[0].id : 'QUARANTINE';
        writeStockLedger_('IQC_HOLD_REJECT', mCode, batchNo, holdId,
          0, newRejected, 'IQC', data.docNo, inspector, 'Hold resolved — rejected ' + newRejected);
        writeStockLedger_('IQC_HOLD_REJECT', mCode, batchNo, quarId,
          newRejected, 0, 'IQC', data.docNo, inspector, 'Hold resolved — quarantined');
      }
    }

    return { success: true, newDisp: newDisp };
  } catch(e) {
    Logger.log('closeHoldIQC: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Returns all GRN_LOG line items for a given GRN doc number
// Used by IQC_F.html to build matrix columns after GRN selection
function getGRNItems(grnNo) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(grnNo).trim()) {
      items.push({
        materialCode: String(data[i][6] || ''),   // col 7
        materialDesc: String(data[i][7] || ''),   // col 8
        batchNo:      String(data[i][8] || ''),   // col 9
        qtyOrdered:   Number(data[i][9])  || 0,   // col 10
        qtyReceived:  Number(data[i][10]) || 0,   // col 11
        unit:         String(data[i][11] || '')   // col 12
      });
    }
  }
  return items;
}
