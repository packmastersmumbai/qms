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
    today:        Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
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

    // P6 — when released, require FG Location per item (defense in depth; UI also blocks)
    if (releasedThis) {
      for (var vi = 0; vi < data.items.length; vi++) {
        var fgLocCheck = String((data.items[vi] && data.items[vi].fgLocation) || data.fgLocation || '').trim();
        if (!fgLocCheck) {
          return { success: false, error: 'FG Location is required when decision is ' + dec + '.' };
        }
      }
    }

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
        ''                                // col 23: FG Lot ID — back-filled below if mirrored
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
          var productCode = _resolveProductCodeFromDesc_(item.materialDesc || '');
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

    return { success: true, docNos: docNos, ncrNo: ncrNo, ncrError: ncrError, warnings: warnings };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
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
    releaseDecision:r[14]
  };
}
