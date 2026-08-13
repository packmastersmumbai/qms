// ============================================================
// Rework.gs — Rework flow: list open items, complete with qty split
// Sources: NCR (rework-FG/rework-RM) + CustomerReturn (REWORK)
// Completion triggers re-OQC (FG) or re-IQC (RM) before stock release.
// ============================================================

// Shared helper — called by NCR.js and CustomerReturn.js to create a REWORK_LOG entry.
function _createReworkLogEntry_(sourceRef, source, originalSource, originalRef,
                                 matCode, matDesc, batchNo, qty, unit, createdBy, materialType) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('REWORK_LOG');
    if (!ws) {
      ws = ss.insertSheet('REWORK_LOG');
      ws.getRange(1, 1, 1, 19).setValues([[
        'Rework ID', 'Date', 'Source', 'Source Ref', 'Material Code', 'Material Desc',
        'Batch No.', 'Qty', 'Unit', 'Location', 'Status',
        'Completed By', 'Completed At', 'Qty Reworked', 'Qty Scrapped',
        'Re-OQC Ref', 'Re-IQC Ref', 'Remarks', 'Material Type'
      ]]);
      ws.setFrozenRows(1);
    }
    var reworkId = getNextDocNumber('rwk');
    ws.appendRow([
      reworkId, new Date(), source, sourceRef,
      matCode, matDesc, batchNo, qty, unit,
      'REWORK-AREA', 'OPEN',
      '', '', 0, 0, '', '', '', materialType || ''
    ]);
    ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    return reworkId;
  } catch(e) {
    Logger.log('_createReworkLogEntry_ failed: ' + e.message);
    return '';
  }
}

// Returns all open rework items (Status = OPEN or IN_PROGRESS).
function getReworkItems() {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('REWORK_LOG');
    if (!ws || ws.getLastRow() < 2) return [];
    var rows = ws.getDataRange().getValues();
    var TZ = 'Asia/Kolkata';
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var st = String(r[10] || '').toUpperCase();
      if (st !== 'OPEN' && st !== 'IN_PROGRESS') continue;
      out.push({
        reworkId:    String(r[0]  || ''),
        date:        r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'dd-MMM-yyyy') : String(r[1] || ''),
        source:      String(r[2]  || ''),
        sourceRef:   String(r[3]  || ''),
        materialCode:String(r[4]  || ''),
        materialDesc:String(r[5]  || ''),
        batchNo:     String(r[6]  || ''),
        qty:         Number(r[7]) || 0,
        unit:        String(r[8]  || ''),
        location:    String(r[9]  || ''),
        status:      st,
        materialType:String(r[18] || ''),
        rowIndex:    i + 1
      });
    }
    return out;
  } catch(e) {
    Logger.log(e);
    return [];
  }
}

// Submit rework completion.
// data: { reworkId, qtyReworked, qtyScrapped, reOQCRef, reIQCRef, completedBy, remarks }
// Rules:
//   qtyReworked + qtyScrapped must equal original qty
//   FG rework: reOQCRef required before stock released to FG-STORE
//   RM rework: reIQCRef required before stock released back to RM-STORE-A
// 0-based index of 'Remarks' in REWORK_LOG_HEADERS. Derived from the header
// constant, not hardcoded, so a schema edit cannot silently point the
// idempotency lookup at another column — the positional-column class of bug
// that has already caused four data-corruption incidents in this repo.
function _rwkRemarksCol_() {
  try {
    var i = REWORK_LOG_HEADERS.indexOf('Remarks');
    if (i >= 0) return i;
  } catch (e) {}
  return 17;
}

function _rwkTxnTag_(txnId) {
  return '[txn:' + String(txnId).replace(/[\[\]]/g, '') + ']';
}

// Has this exact completion attempt already been written? Returns the completed
// row's summary or null.
//
// The pre-existing "already completed" status check is NOT idempotency: on a
// retry after a dropped response it returns an ERROR, so the operator sees a
// failure for a completion that actually succeeded — and the natural next move
// is to re-enter it by hand. This guard makes the retry return the original
// success instead.
function _rwkFindByTxn_(ws, txnId) {
  try {
    if (!txnId) return null;
    if (!ws || ws.getLastRow() < 2) return null;
    var tag = _rwkTxnTag_(txnId);
    var n = ws.getLastRow() - 1;
    var vals = ws.getRange(2, 1, n, ws.getLastColumn()).getValues();
    var rc = _rwkRemarksCol_();
    for (var i = 0; i < n; i++) {
      if (String(vals[i][rc] || '').indexOf(tag) >= 0) {
        return {
          reworkId:    String(vals[i][0] || ''),
          qtyReworked: Number(vals[i][13]) || 0,
          qtyScrapped: Number(vals[i][14]) || 0
        };
      }
    }
  } catch (e) { Logger.log('_rwkFindByTxn_: ' + e.message); }
  return null;
}

function submitReworkCompletion(data) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('REWORK_LOG');
    if (!ws) throw new Error('REWORK_LOG sheet not found. Run Setup first.');

    // Idempotency. Rework moves stock through FOUR ledger writes, so a duplicate
    // does not merely add a row — it double-debits REWORK-AREA and double-credits
    // FG-STORE/SCRAP-AREA. Checked before any validation so a retry short-circuits.
    var rwkTxnId = String(data.clientTxnId || '').trim();
    if (rwkTxnId) {
      var prior = _rwkFindByTxn_(ws, rwkTxnId);
      if (prior) {
        return {
          success: true, duplicate: true,
          reworkId: prior.reworkId,
          qtyReworked: prior.qtyReworked,
          qtyScrapped: prior.qtyScrapped,
          warnings: ['This rework completion was already saved.']
        };
      }
    }

    var reworkId   = String(data.reworkId   || '').trim();
    var qtyReworked= Number(data.qtyReworked)  || 0;
    var qtyScrapped= Number(data.qtyScrapped)  || 0;
    var reOQCRef   = String(data.reOQCRef   || '').trim();
    var reIQCRef   = String(data.reIQCRef   || '').trim();
    var completedBy= String(data.completedBy|| '').trim();
    var remarks    = String(data.remarks    || '').trim();

    if (!reworkId)    return { success: false, error: 'Rework ID required.' };
    if (!completedBy) return { success: false, error: 'Completed By required.' };

    // Find the rework row
    var rows = ws.getDataRange().getValues();
    var rRow = -1, rData = null;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === reworkId) { rRow = i + 1; rData = rows[i]; break; }
    }
    if (rRow < 0) return { success: false, error: 'Rework ID ' + reworkId + ' not found.' };

    var st = String(rData[10] || '').toUpperCase();
    if (st === 'COMPLETED') return { success: false, error: 'Rework ' + reworkId + ' already completed.' };

    var origQty    = Number(rData[7]) || 0;
    var matCode    = String(rData[4] || '').trim();
    var matDesc    = String(rData[5] || '').trim();
    var batchNo    = String(rData[6] || '').trim();
    var source     = String(rData[2] || '').trim();

    // Validate split
    if (Math.abs((qtyReworked + qtyScrapped) - origQty) > 0.001) {
      return { success: false, error: 'qty split ' + (qtyReworked + qtyScrapped) +
        ' ≠ original ' + origQty + '. qtyReworked + qtyScrapped must equal original qty.' };
    }

    // Determine material type from the AUTHORITATIVE materialType stored at REWORK_LOG
    // creation (col 18), NOT from whether an OQC ref happens to be present (#14).
    // Keying off reOQCRef !== '' let an RM item with a mistakenly-populated reOQCRef be
    // released to FG-STORE, skipping the required re-IQC gate and mislocating the stock.
    var storedType = String(rData[18] || '').toUpperCase();
    var isFG;
    if (storedType === 'FG' || storedType === 'RM') {
      isFG = (storedType === 'FG');
    } else {
      // Fallback for legacy rows written before materialType was captured.
      isFG = (source === 'CUSTOMER_RETURN') ||
             (source === 'NCR' && String(rData[3] || '').indexOf('rework-FG') >= 0);
    }

    // Re-inspection gate
    if (isFG && !reOQCRef) {
      return { success: false, error: 'Re-OQC reference is required before FG rework can be completed.' };
    }
    if (!isFG && !reIQCRef) {
      return { success: false, error: 'Re-IQC reference is required before RM rework can be completed.' };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var destLoc = isFG ? 'FG-STORE' : 'RM-STORE-A';

      // Move reworked qty from REWORK-AREA to destination
      if (qtyReworked > 0) {
        writeStockLedger_('REWORK_COMPLETE_OUT', matCode, batchNo, 'REWORK-AREA',
          0, qtyReworked, 'REWORK', reworkId, completedBy, 'Rework complete — releasing to ' + destLoc, matDesc);
        writeStockLedger_('REWORK_COMPLETE_IN', matCode, batchNo, destLoc,
          qtyReworked, 0, 'REWORK', reworkId, completedBy, 'Reworked material released', matDesc);
      }

      // Scrap reworked-but-failed qty
      if (qtyScrapped > 0) {
        writeStockLedger_('REWORK_SCRAP', matCode, batchNo, 'REWORK-AREA',
          0, qtyScrapped, 'REWORK', reworkId, completedBy, 'Rework scrapped — failed re-inspection', matDesc);
        writeStockLedger_('REWORK_SCRAP_IN', matCode, batchNo, 'SCRAP-AREA',
          qtyScrapped, 0, 'REWORK', reworkId, completedBy, 'Scrapped from rework', matDesc);
      }

      // Update REWORK_LOG row
      ws.getRange(rRow, 11).setValue('COMPLETED');
      ws.getRange(rRow, 12).setValue(completedBy);
      ws.getRange(rRow, 13).setValue(new Date()).setNumberFormat('dd-MMM-yyyy HH:mm');
      ws.getRange(rRow, 14).setValue(qtyReworked);
      ws.getRange(rRow, 15).setValue(qtyScrapped);
      if (reOQCRef) ws.getRange(rRow, 16).setValue(reOQCRef);
      if (reIQCRef) ws.getRange(rRow, 17).setValue(reIQCRef);

      // The txn tag is a SUFFIX so the operator's own remark still reads first,
      // and it is written even when there is no remark — the guard depends on it
      // being present. stripTxnTag_ removes it for display and print.
      var remarkCell = remarks;
      if (rwkTxnId) remarkCell = (remarks ? remarks + ' ' : '') + _rwkTxnTag_(rwkTxnId);
      if (remarkCell) ws.getRange(rRow, _rwkRemarksCol_() + 1).setValue(remarkCell);

      return {
        success: true,
        reworkId: reworkId,
        qtyReworked: qtyReworked,
        qtyScrapped: qtyScrapped,
        destination: destLoc
      };
    } finally {
      lock.releaseLock();
    }
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}
