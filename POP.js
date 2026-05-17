// ============================================================
// POP.js — Purchase Order server endpoints
// P2 — Pack Masters QMS
// ============================================================

// ── Helpers ──────────────────────────────────────────────────

/**
 * Returns true iff poRef matches the canonical PM/PO/YYYY-NNN pattern.
 * Single source of truth — used by Diag §8 and future P7 engine.
 */
function isPOAttached_(poRef) {
  return /^PM\/PO\/\d{4}-\d{3,}$/.test(String(poRef || '').trim());
}

function getPOSpreadsheet_() {
  return getSpreadsheet();
}

function fmtDate_(d) {
  if (!d) return '';
  if (d instanceof Date && !isNaN(d)) {
    return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  return String(d);
}

function fmtDateTime_(d) {
  if (!d) return '';
  if (d instanceof Date && !isNaN(d)) {
    return Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm');
  }
  return String(d);
}

// ── Form init ────────────────────────────────────────────────

function getPOFormInit() {
  return {
    docNumber:     peekNextDocNumber('po'),
    suppliers:     getSuppliers(),
    materials:     getMaterials(),
    today:         Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'),
    currencies:    ['INR'],
    defaultGstPct: 18
  };
}

// ── Canonicalize ─────────────────────────────────────────────

/**
 * Validates and cleans a PO payload.
 * @param {object} data — raw form data
 * @returns {{ok:boolean, errors:string[], lines:object[], totals:object}}
 */
function canonicalizePO_(data) {
  var errors = [];
  var ss = getPOSpreadsheet_();

  // Validate supplier
  var supplierCode = String(data.supplierCode || '').trim();
  if (!supplierCode) {
    errors.push('Supplier is required.');
  } else {
    var suppWs = ss.getSheetByName('MASTERS_Suppliers');
    var suppFound = false;
    if (suppWs && suppWs.getLastRow() > 1) {
      var suppData = suppWs.getRange(2, 1, suppWs.getLastRow() - 1, 1).getValues();
      suppFound = suppData.some(function(r) { return String(r[0] || '').trim() === supplierCode; });
    }
    if (!suppFound) errors.push('Supplier code "' + supplierCode + '" not found in MASTERS_Suppliers.');
  }

  // Build material index
  var matMap = {};
  var matWs = ss.getSheetByName('MASTERS_Materials');
  if (matWs && matWs.getLastRow() > 1) {
    matWs.getRange(2, 1, matWs.getLastRow() - 1, 3).getValues().forEach(function(r) {
      var code = String(r[0] || '').trim();
      if (code) matMap[code] = { desc: String(r[1] || ''), unit: String(r[2] || '') };
    });
  }

  // Validate lines
  var rawLines = (data.lines && data.lines.length) ? data.lines : [];
  var cleanLines = [];
  var subTotal = 0;

  rawLines.forEach(function(line, idx) {
    var matCode = String(line.materialCode || '').trim();
    var qty = Number(line.qtyOrdered) || 0;
    var price = Number(line.unitPrice);
    if (isNaN(price)) price = 0;
    var promisedDate = String(line.promisedDate || '').trim();

    // Skip blank rows
    if (!matCode && qty === 0 && price === 0) return;

    if (!matCode) {
      errors.push('Line ' + (idx + 1) + ': material code is required.');
      return;
    }
    if (!matMap[matCode]) {
      errors.push('Line ' + (idx + 1) + ': material "' + matCode + '" not found in MASTERS_Materials.');
    }
    if (qty <= 0) {
      errors.push('Line ' + (idx + 1) + ': qty must be > 0.');
      return;
    }
    if (price < 0) {
      errors.push('Line ' + (idx + 1) + ': unit price cannot be negative.');
      return;
    }

    var lineAmount = qty * price;
    subTotal += lineAmount;

    cleanLines.push({
      line_no:        cleanLines.length + 1,
      material_code:  matCode,
      material_desc:  (matMap[matCode] ? matMap[matCode].desc : String(line.materialDesc || '')),
      unit:           (matMap[matCode] ? matMap[matCode].unit : String(line.unit || '')),
      qty_ordered:    qty,
      unit_price:     price,
      line_amount:    lineAmount,
      promised_date:  promisedDate
    });
  });

  if (cleanLines.length === 0 && errors.length === 0) {
    errors.push('At least one material line is required.');
  }

  var gstPct = Number(data.gstPct) || 0;
  var gstAmount = subTotal * gstPct / 100;
  var grandTotal = subTotal + gstAmount;

  return {
    ok:     errors.length === 0,
    errors: errors,
    lines:  cleanLines,
    totals: { subTotal: subTotal, gstAmount: gstAmount, grandTotal: grandTotal }
  };
}

// ── Preview ───────────────────────────────────────────────────

function previewPO(data) {
  var result = canonicalizePO_(data);
  if (!result.ok) return { ok: false, errors: result.errors };

  var warnings = [];
  // Warn if due_date is in the past
  if (data.dueDate) {
    var due = new Date(data.dueDate);
    if (!isNaN(due) && due < new Date()) {
      warnings.push('Due date ' + data.dueDate + ' is in the past.');
    }
  }
  // Duplicate material warn (allowed, but surfaced)
  var matCount = {};
  result.lines.forEach(function(l) { matCount[l.material_code] = (matCount[l.material_code] || 0) + 1; });
  Object.keys(matCount).forEach(function(c) {
    if (matCount[c] > 1) warnings.push('Material ' + c + ' appears on ' + matCount[c] + ' lines (allowed).');
  });

  return {
    ok: true,
    preview: {
      poNo:       peekNextDocNumber('po'),
      supplier:   String(data.supplierName || data.supplierCode || ''),
      lines:      result.lines,
      totals:     result.totals,
      warnings:   warnings
    }
  };
}

// ── Save PO ───────────────────────────────────────────────────

// Lock-free: getNextDocNumber('po') is itself lock-guarded; PO_HEADER and
// PO_LINES writes use appendRow which is atomic per call. Dedupe key is
// (po_no, line_no), so a partial line failure can be safely re-saved.
// LockService was removed because Apps Script web app sessions were holding
// it across background google.script.run calls, blocking submit.
function savePO(data) {
  try {
    var result = canonicalizePO_(data);
    if (!result.ok) return { success: false, error: result.errors.join('; ') };

    var ss = getPOSpreadsheet_();
    var hdrWs = ss.getSheetByName('PO_HEADER');
    var lnWs  = ss.getSheetByName('PO_LINES');
    if (!hdrWs) throw new Error('PO_HEADER sheet not found. Run Verify & Repair Sheets first.');
    if (!lnWs)  throw new Error('PO_LINES sheet not found. Run Verify & Repair Sheets first.');

    var submit = !!data.submit;
    var status = submit ? 'OPEN' : 'DRAFT';
    var poNo   = getNextDocNumber('po');
    var now    = new Date();
    var user   = Session.getActiveUser().getEmail() || 'QA';
    var poDate = data.poDate ? new Date(data.poDate) : now;
    var dueDate = data.dueDate ? new Date(data.dueDate) : '';

    hdrWs.appendRow([
      poNo,
      poDate,
      String(data.supplierCode || '').trim(),
      String(data.supplierName || '').trim(),
      dueDate,
      'INR',
      Number(data.gstPct) || 0,
      String(data.paymentTerms || ''),
      result.totals.subTotal,
      result.totals.gstAmount,
      result.totals.grandTotal,
      status,
      String(data.remarks || ''),
      user,
      now,
      user,
      ''
    ]);

    // Format date columns
    var lastHdrRow = hdrWs.getLastRow();
    hdrWs.getRange(lastHdrRow, 2).setNumberFormat('dd-MMM-yyyy');
    hdrWs.getRange(lastHdrRow, 5).setNumberFormat('dd-MMM-yyyy');
    hdrWs.getRange(lastHdrRow, 15).setNumberFormat('dd-MMM-yyyy HH:mm');

    // Write lines
    var headerDueDate = dueDate;
    result.lines.forEach(function(line) {
      var linePromised = (line.promised_date ? new Date(line.promised_date) : '') || headerDueDate || '';
      lnWs.appendRow([
        poNo,
        line.line_no,
        line.material_code,
        line.material_desc,
        line.unit,
        line.qty_ordered,
        line.unit_price,
        line.line_amount,
        0,                 // qty_received
        line.qty_ordered,  // qty_pending = qty_ordered initially
        'OPEN',            // line_status
        '',                // last_grn_no
        linePromised       // promised_date
      ]);
      var lastLnRow = lnWs.getLastRow();
      if (linePromised) lnWs.getRange(lastLnRow, 13).setNumberFormat('dd-MMM-yyyy');
    });

    return { success: true, poNo: poNo };
  } catch(e) {
    Logger.log('savePO: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── Submit PO (DRAFT → OPEN) ──────────────────────────────────
// Lock-free: single-cell status update is atomic.

function submitPO(poNo) {
  try {
    var ss = getPOSpreadsheet_();
    var ws = ss.getSheetByName('PO_HEADER');
    if (!ws) throw new Error('PO_HEADER not found.');
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== String(poNo).trim()) continue;
      var status = String(data[i][11]).trim();
      if (status !== 'DRAFT') return { success: false, error: 'PO ' + poNo + ' is not in DRAFT status (current: ' + status + ').' };
      ws.getRange(i + 1, 12).setValue('OPEN');
      return { success: true };
    }
    return { success: false, error: 'PO not found: ' + poNo };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ── Cancel PO ────────────────────────────────────────────────
// Lock-free: header + line writes are tolerant of partial completion (idempotent).

function cancelPO(poNo, reason) {
  try {
    var ss = getPOSpreadsheet_();
    var hdrWs = ss.getSheetByName('PO_HEADER');
    if (!hdrWs) throw new Error('PO_HEADER not found.');
    var data = hdrWs.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(poNo).trim()) { rowIdx = i; break; }
    }
    if (rowIdx === -1) return { success: false, error: 'PO not found: ' + poNo };
    var status = String(data[rowIdx][11]).trim();
    // Collect blocking GRNs up-front so PARTIAL_RECEIVED error names them (P2 LOW-6).
    var blockingGrns = [];
    var grnWs = ss.getSheetByName('GRN_LOG');
    if (grnWs && grnWs.getLastRow() > 1) {
      var grnData = grnWs.getDataRange().getValues();
      for (var g = 1; g < grnData.length; g++) {
        if (String(grnData[g][4]).trim() === String(poNo).trim()) {
          blockingGrns.push(String(grnData[g][0]).trim());
        }
      }
    }
    if (status !== 'DRAFT' && status !== 'OPEN') {
      var msg = 'Cannot cancel PO with status "' + status + '".';
      if (status === 'PARTIAL_RECEIVED' && blockingGrns.length) {
        msg += ' Blocking GRN(s): ' + blockingGrns.join(', ') +
               '. Reverse or void these GRNs first, then retry cancel.';
      }
      return { success: false, error: msg };
    }
    // Guard: check for any GRN receipts (OPEN/DRAFT path)
    if (blockingGrns.length) {
      return { success: false, error: 'Cannot cancel: GRN ' + blockingGrns[0] + ' references this PO.' };
    }
    hdrWs.getRange(rowIdx + 1, 12).setValue('CANCELLED');
    hdrWs.getRange(rowIdx + 1, 17).setValue(String(reason || ''));
    // Also mark all lines CANCELLED
    var lnWs = ss.getSheetByName('PO_LINES');
    if (lnWs && lnWs.getLastRow() > 1) {
      var lnData = lnWs.getDataRange().getValues();
      for (var l = 1; l < lnData.length; l++) {
        if (String(lnData[l][0]).trim() === String(poNo).trim()) {
          lnWs.getRange(l + 1, 11).setValue('CANCELLED');
        }
      }
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ── Get open POs for GRN form dropdown ───────────────────────

function getOpenPOsForSupplier(supplierCode) {
  var ss = getPOSpreadsheet_();
  var hdrWs = ss.getSheetByName('PO_HEADER');
  var lnWs  = ss.getSheetByName('PO_LINES');
  if (!hdrWs || !lnWs) return [];

  // Index lines by po_no
  var linesMap = {};
  if (lnWs.getLastRow() > 1) {
    lnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var pn = String(r[0] || '').trim();
      if (!pn) return;
      if (!linesMap[pn]) linesMap[pn] = [];
      linesMap[pn].push({
        lineNo:       Number(r[1]) || 0,
        materialCode: String(r[2] || '').trim(),
        materialDesc: String(r[3] || '').trim(),
        unit:         String(r[4] || '').trim(),
        qtyOrdered:   Number(r[5]) || 0,
        qtyPending:   Number(r[9]) || 0,
        lineStatus:   String(r[10] || '').trim(),
        promisedDate: fmtDate_(r[12])
      });
    });
  }

  var results = [];
  if (hdrWs.getLastRow() < 2) return results;
  hdrWs.getDataRange().getValues().slice(1).forEach(function(r) {
    var status = String(r[11] || '').trim();
    if (status !== 'OPEN' && status !== 'PARTIAL_RECEIVED') return;
    var suppCode = String(r[2] || '').trim();
    if (supplierCode && supplierCode !== suppCode) return;
    var pn = String(r[0] || '').trim();
    results.push({
      poNo:         pn,
      supplierCode: suppCode,
      supplierName: String(r[3] || '').trim(),
      dueDate:      fmtDate_(r[4]),
      status:       status,
      lines:        linesMap[pn] || []
    });
  });
  return results;
}

// ── Get PO by docNo ───────────────────────────────────────────

function getPOById(poNo) {
  var ss = getPOSpreadsheet_();
  var hdrWs = ss.getSheetByName('PO_HEADER');
  var lnWs  = ss.getSheetByName('PO_LINES');
  if (!hdrWs || !lnWs) return null;

  var header = null;
  if (hdrWs.getLastRow() > 1) {
    hdrWs.getDataRange().getValues().slice(1).some(function(r) {
      if (String(r[0] || '').trim() !== String(poNo).trim()) return false;
      header = {
        poNo:           String(r[0]).trim(),
        poDate:         fmtDate_(r[1]),
        supplierCode:   String(r[2] || '').trim(),
        supplierName:   String(r[3] || '').trim(),
        dueDate:        fmtDate_(r[4]),
        currency:       String(r[5] || 'INR'),
        gstPct:         Number(r[6]) || 0,
        paymentTerms:   String(r[7] || ''),
        subTotal:       Number(r[8]) || 0,
        gstAmount:      Number(r[9]) || 0,
        grandTotal:     Number(r[10]) || 0,
        status:         String(r[11] || '').trim(),
        remarks:        String(r[12] || ''),
        createdBy:      String(r[13] || ''),
        createdAt:      fmtDateTime_(r[14]),
        approvedBy:     String(r[15] || ''),
        cancelledReason:String(r[16] || '')
      };
      return true;
    });
  }
  if (!header) return null;

  var lines = [];
  if (lnWs.getLastRow() > 1) {
    lnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      if (String(r[0] || '').trim() !== String(poNo).trim()) return;
      lines.push({
        lineNo:       Number(r[1]) || 0,
        materialCode: String(r[2] || '').trim(),
        materialDesc: String(r[3] || '').trim(),
        unit:         String(r[4] || '').trim(),
        qtyOrdered:   Number(r[5]) || 0,
        unitPrice:    Number(r[6]) || 0,
        lineAmount:   Number(r[7]) || 0,
        qtyReceived:  Number(r[8]) || 0,
        qtyPending:   Number(r[9]) || 0,
        lineStatus:   String(r[10] || '').trim(),
        lastGrnNo:    String(r[11] || ''),
        promisedDate: fmtDate_(r[12])
      });
    });
  }

  // Linked GRNs for this PO
  var linkedGrns = [];
  var grnWs = ss.getSheetByName('GRN_LOG');
  if (grnWs && grnWs.getLastRow() > 1) {
    var grnSeen = {};
    grnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var poRef = String(r[4] || '').trim();
      if (poRef !== String(poNo).trim()) return;
      var grnNo = String(r[0] || '').trim();
      if (!grnSeen[grnNo]) {
        grnSeen[grnNo] = true;
        linkedGrns.push({
          grnNo: grnNo,
          date:  fmtDate_(r[1]),
          matCode: String(r[6] || '').trim(),
          qtyReceived: Number(r[10]) || 0
        });
      }
    });
  }

  return { header: header, lines: lines, linkedGrns: linkedGrns };
}

// ── List DRAFT POs (for Load DRAFT picker) ──────────────────

function listDraftPOs() {
  var ss = getPOSpreadsheet_();
  var hdrWs = ss.getSheetByName('PO_HEADER');
  if (!hdrWs || hdrWs.getLastRow() < 2) return [];
  var rows = hdrWs.getDataRange().getValues().slice(1);
  var out = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (String(r[11] || '').trim() !== 'DRAFT') continue;
    out.push({
      poNo:        String(r[0]).trim(),
      poDate:      fmtDate_(r[1]),
      supplierCode:String(r[2] || '').trim(),
      supplierName:String(r[3] || '').trim(),
      grandTotal:  Number(r[10]) || 0,
      createdAt:   fmtDateTime_(r[14]),
      createdBy:   String(r[13] || '')
    });
  }
  return out;
}

// ── Update DRAFT PO (edit-as-draft, mutate in place) ─────────
// Header row + lines are rewritten. Guard: refuses if any GRN_LOG row
// references this PO (defence-in-depth — DRAFTs shouldn't have GRN
// activity, but if they do, the row may be load-bearing for audit).
// If submit=true, status flips to OPEN in the same write.

function updateDraftPO(poNo, data) {
  try {
    if (!poNo) return { success: false, error: 'poNo required' };
    var result = canonicalizePO_(data);
    if (!result.ok) return { success: false, error: result.errors.join('; ') };

    var ss = getPOSpreadsheet_();
    var hdrWs = ss.getSheetByName('PO_HEADER');
    var lnWs  = ss.getSheetByName('PO_LINES');
    if (!hdrWs) throw new Error('PO_HEADER sheet not found.');
    if (!lnWs)  throw new Error('PO_LINES sheet not found.');

    // Locate header row
    var hdrData = hdrWs.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < hdrData.length; i++) {
      if (String(hdrData[i][0]).trim() === String(poNo).trim()) { rowIdx = i; break; }
    }
    if (rowIdx < 0) return { success: false, error: 'PO not found: ' + poNo };

    var curStatus = String(hdrData[rowIdx][11] || '').trim();
    if (curStatus !== 'DRAFT') {
      return { success: false, error: 'PO ' + poNo + ' is not in DRAFT status (current: ' + curStatus + '). Edit forbidden.' };
    }

    // GRN-ref guard
    var grnWs = ss.getSheetByName('GRN_LOG');
    if (grnWs && grnWs.getLastRow() > 1) {
      var grnRows = grnWs.getDataRange().getValues().slice(1);
      for (var g = 0; g < grnRows.length; g++) {
        if (String(grnRows[g][4] || '').trim() === String(poNo).trim()) {
          return { success: false, error: 'PO ' + poNo + ' has GRN activity (' + String(grnRows[g][0]).trim() + '). Edit forbidden — audit trail must be preserved.' };
        }
      }
    }

    var submit = !!data.submit;
    var newStatus = submit ? 'OPEN' : 'DRAFT';
    var now    = new Date();
    var user   = Session.getActiveUser().getEmail() || 'QA';
    var poDate = data.poDate ? new Date(data.poDate) : (hdrData[rowIdx][1] || now);
    var dueDate = data.dueDate ? new Date(data.dueDate) : '';

    // Overwrite header row (preserve poNo at col 1, createdBy/createdAt at cols 14/15)
    var createdBy = String(hdrData[rowIdx][13] || user);
    var createdAt = hdrData[rowIdx][14] || now;
    var newRow = [
      poNo,
      poDate,
      String(data.supplierCode || '').trim(),
      String(data.supplierName || '').trim(),
      dueDate,
      'INR',
      Number(data.gstPct) || 0,
      String(data.paymentTerms || ''),
      result.totals.subTotal,
      result.totals.gstAmount,
      result.totals.grandTotal,
      newStatus,
      String(data.remarks || ''),
      createdBy,
      createdAt,
      user,   // approvedBy / lastEditedBy
      ''
    ];
    hdrWs.getRange(rowIdx + 1, 1, 1, newRow.length).setValues([newRow]);
    hdrWs.getRange(rowIdx + 1, 2).setNumberFormat('dd-MMM-yyyy');
    hdrWs.getRange(rowIdx + 1, 5).setNumberFormat('dd-MMM-yyyy');
    hdrWs.getRange(rowIdx + 1, 15).setNumberFormat('dd-MMM-yyyy HH:mm');

    // Wipe existing lines for this poNo, then re-append
    var lnData = lnWs.getDataRange().getValues();
    for (var j = lnData.length - 1; j >= 1; j--) {
      if (String(lnData[j][0]).trim() === String(poNo).trim()) {
        lnWs.deleteRow(j + 1);
      }
    }
    var headerDueDate = dueDate;
    result.lines.forEach(function(line) {
      var linePromised = (line.promised_date ? new Date(line.promised_date) : '') || headerDueDate || '';
      lnWs.appendRow([
        poNo,
        line.line_no,
        line.material_code,
        line.material_desc,
        line.unit,
        line.qty_ordered,
        line.unit_price,
        line.line_amount,
        0,
        line.qty_ordered,
        'OPEN',
        '',
        linePromised
      ]);
      var lastLnRow = lnWs.getLastRow();
      if (linePromised) lnWs.getRange(lastLnRow, 13).setNumberFormat('dd-MMM-yyyy');
    });

    return { success: true, poNo: poNo, status: newStatus };
  } catch(e) {
    Logger.log('updateDraftPO: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── Get recent POs (Landing tile + Records list) ──────────────

function getRecentPOs(limit) {
  limit = limit || 50;
  var ss = getPOSpreadsheet_();
  var hdrWs = ss.getSheetByName('PO_HEADER');
  if (!hdrWs || hdrWs.getLastRow() < 2) return [];
  var rows = hdrWs.getDataRange().getValues().slice(1);
  var results = [];
  for (var i = rows.length - 1; i >= 0 && results.length < limit; i--) {
    var r = rows[i];
    results.push({
      poNo:        String(r[0] || '').trim(),
      date:        fmtDate_(r[1]),
      supplierCode:String(r[2] || '').trim(),
      supplierName:String(r[3] || '').trim(),
      dueDate:     fmtDate_(r[4]),
      grandTotal:  Number(r[10]) || 0,
      status:      String(r[11] || '').trim()
    });
  }
  return results;
}

// ── INTERNAL: Apply GRN receipts to PO ───────────────────────

/**
 * Updates PO_LINES qty_received, qty_pending, line_status, last_grn_no
 * and recomputes header status after a GRN save.
 *
 * Lock-free: idempotent recompute is safe under concurrent callers.
 * If two GRNs race against the same PO, each call recomputes qty_received
 * from its own receipts payload independently; reconcilePOReceipts() can
 * be run from menu to authoritatively rebuild qty_received from GRN_LOG.
 *
 * @param {string} poNo
 * @param {Array<{materialCode:string, qtyReceived:number, poLineNo?:number}>} receipts
 * @param {string} grnNo
 */
function applyGRNReceiptsToPO_(poNo, receipts, grnNo) {
  var ss = getPOSpreadsheet_();
  var lnWs  = ss.getSheetByName('PO_LINES');
  var hdrWs = ss.getSheetByName('PO_HEADER');
  if (!lnWs || !hdrWs) return { touchedLines: 0, headerStatus: 'UNKNOWN', overReceiptWarnings: [], notFound: [] };

  var lnData = lnWs.getDataRange().getValues();
  var touchedLines = 0;
  var overReceiptWarnings = [];
  var notFound = [];

  receipts.forEach(function(rcpt) {
    var matCode   = String(rcpt.materialCode || '').trim();
    var qtyRcvd   = Number(rcpt.qtyReceived) || 0;
    var poLineNo  = rcpt.poLineNo ? Number(rcpt.poLineNo) : null;

    // Find matching line(s)
    var matchRows = [];
    for (var i = 1; i < lnData.length; i++) {
      var rPoNo = String(lnData[i][0] || '').trim();
      var rMat  = String(lnData[i][2] || '').trim();
      var rLine = Number(lnData[i][1]) || 0;
      if (rPoNo !== String(poNo).trim()) continue;
      if (rMat  !== matCode) continue;
      if (poLineNo && rLine !== poLineNo) continue;
      matchRows.push(i);
    }

    if (matchRows.length === 0) {
      notFound.push(matCode);
      return;
    }

    // Use first match (for unambiguous case); multi-line same-material resolved by poLineNo
    var idx = matchRows[0];
    var qtyOrdered  = Number(lnData[idx][5]) || 0;
    var prevReceived = Number(lnData[idx][8]) || 0;

    // HIGH #2 drift check: re-read qty_received just before write. If it changed
    // since the snapshot at line 514, another GRN write raced us. We use the
    // live value as the base so neither receipt is lost, and surface a warning
    // so ops knows to verify via reconcilePOReceipts.
    var liveReceived = Number(lnWs.getRange(idx + 1, 9).getValue()) || 0;
    if (Math.abs(liveReceived - prevReceived) > 0.0005) {
      overReceiptWarnings.push('Concurrency drift detected on line ' + lnData[idx][1] + ' (' + matCode + '): snapshot=' + prevReceived + ' live=' + liveReceived + '. Both receipts retained; run Reconcile PO Receipts to verify.');
      prevReceived = liveReceived;
    }

    var newReceived  = prevReceived + qtyRcvd;
    var newPending   = Math.max(0, qtyOrdered - newReceived);
    var lineStatus   = (newReceived <= 0) ? 'OPEN' : (newReceived < qtyOrdered) ? 'PARTIAL' : 'CLOSED';

    if (newReceived > qtyOrdered) {
      overReceiptWarnings.push('Line ' + lnData[idx][1] + ' (' + matCode + '): received ' + newReceived + ' > ordered ' + qtyOrdered);
    }

    lnWs.getRange(idx + 1, 9).setValue(newReceived);
    lnWs.getRange(idx + 1, 10).setValue(newPending);
    lnWs.getRange(idx + 1, 11).setValue(lineStatus);
    lnWs.getRange(idx + 1, 12).setValue(grnNo);
    // Update in-memory for header recompute
    lnData[idx][8]  = newReceived;
    lnData[idx][9]  = newPending;
    lnData[idx][10] = lineStatus;
    touchedLines++;
  });

  // Recompute header status from lines
  var headerStatus = deriveHeaderStatus_(lnData, poNo, hdrWs);

  return { touchedLines: touchedLines, headerStatus: headerStatus, overReceiptWarnings: overReceiptWarnings, notFound: notFound };
}

/**
 * Reads all lines for poNo, derives header status, writes it to PO_HEADER.
 * Returns the new header status string.
 */
function deriveHeaderStatus_(lnData, poNo, hdrWs) {
  var lineStatuses = [];
  for (var i = 1; i < lnData.length; i++) {
    if (String(lnData[i][0] || '').trim() !== String(poNo).trim()) continue;
    var ls = String(lnData[i][10] || '').trim();
    if (ls !== 'CANCELLED') lineStatuses.push(ls);
  }
  var headerStatus;
  if (lineStatuses.length === 0) {
    headerStatus = 'OPEN';
  } else if (lineStatuses.every(function(s) { return s === 'CLOSED'; })) {
    headerStatus = 'CLOSED';
  } else if (lineStatuses.some(function(s) { return s === 'PARTIAL' || s === 'CLOSED'; })) {
    headerStatus = 'PARTIAL_RECEIVED';
  } else {
    headerStatus = 'OPEN';
  }

  // Write to PO_HEADER
  if (hdrWs && hdrWs.getLastRow() > 1) {
    var hdrData = hdrWs.getDataRange().getValues();
    for (var h = 1; h < hdrData.length; h++) {
      if (String(hdrData[h][0] || '').trim() !== String(poNo).trim()) continue;
      var curStatus = String(hdrData[h][11] || '').trim();
      if (curStatus === 'DRAFT' || curStatus === 'CANCELLED') break; // never auto-promote these
      hdrWs.getRange(h + 1, 12).setValue(headerStatus);
      break;
    }
  }
  return headerStatus;
}

// ── Reconcile PO Receipts (self-heal) ────────────────────────

/**
 * Menu-exposed self-heal. Re-derives qty_received for every PO line
 * by summing GRN_LOG where isPOAttached_(poRef). Fixes any drift from
 * partial failures in saveGRN. Idempotent.
 */
function reconcilePOReceipts() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  // Lock-free: idempotent recompute from GRN_LOG truth; safe to run anytime
  // even under concurrent GRN saves (next run resolves any race).
  try {
    var ss = getPOSpreadsheet_();
    var grnWs = ss.getSheetByName('GRN_LOG');
    var lnWs  = ss.getSheetByName('PO_LINES');
    var hdrWs = ss.getSheetByName('PO_HEADER');
    if (!lnWs || !hdrWs) { SpreadsheetApp.getUi().alert('PO_LINES or PO_HEADER sheet not found.'); return; }

    // Step 1: Sum GRN receipts by (poRef, materialCode)
    var grnSums = {}; // key: poNo+'|'+matCode → total qty
    if (grnWs && grnWs.getLastRow() > 1) {
      grnWs.getDataRange().getValues().slice(1).forEach(function(r) {
        var poRef  = String(r[4] || '').trim();
        var mat    = String(r[6] || '').trim();
        var qty    = Number(r[10]) || 0;
        if (!isPOAttached_(poRef) || !mat) return;
        var k = poRef + '|' + mat;
        grnSums[k] = (grnSums[k] || 0) + qty;
      });
    }

    // Step 2: Read PO_LINES, build updated values
    if (lnWs.getLastRow() < 2) { SpreadsheetApp.getUi().alert('PO_LINES is empty.'); return; }
    var lnData = lnWs.getDataRange().getValues();

    // For multi-line same-material: group line indices by (poNo, matCode)
    var lineGroups = {}; // key: poNo+'|'+mat → [rowIdx, ...]
    for (var i = 1; i < lnData.length; i++) {
      var pn  = String(lnData[i][0] || '').trim();
      var mat = String(lnData[i][2] || '').trim();
      if (!pn || !mat) continue;
      var k = pn + '|' + mat;
      if (!lineGroups[k]) lineGroups[k] = [];
      lineGroups[k].push(i);
    }

    var diffs = 0;
    var processedPoNos = {};

    Object.keys(lineGroups).forEach(function(k) {
      var idxs  = lineGroups[k];
      var parts = k.split('|');
      var pn    = parts[0];
      var mat   = parts[1];
      var grnTotal = grnSums[k] || 0;

      processedPoNos[pn] = true;

      if (idxs.length === 1) {
        // Unambiguous: exact match
        var idx       = idxs[0];
        var qtyOrdered = Number(lnData[idx][5]) || 0;
        var oldRcvd    = Number(lnData[idx][8]) || 0;
        var newRcvd    = grnTotal;
        var newPending = Math.max(0, qtyOrdered - newRcvd);
        var lineStatus = (newRcvd <= 0) ? 'OPEN' : (newRcvd < qtyOrdered) ? 'PARTIAL' : 'CLOSED';
        if (oldRcvd !== newRcvd) {
          lnWs.getRange(idx + 1, 9).setValue(newRcvd);
          lnWs.getRange(idx + 1, 10).setValue(newPending);
          lnWs.getRange(idx + 1, 11).setValue(lineStatus);
          lnData[idx][8]  = newRcvd;
          lnData[idx][9]  = newPending;
          lnData[idx][10] = lineStatus;
          diffs++;
        }
      } else {
        // Multi-line same material: split GRN sum proportionally by qty_ordered weighting (estimate)
        var totalOrdered = idxs.reduce(function(s, ix) { return s + (Number(lnData[ix][5]) || 0); }, 0);
        idxs.forEach(function(idx) {
          var qtyOrdered = Number(lnData[idx][5]) || 0;
          var weight     = totalOrdered > 0 ? qtyOrdered / totalOrdered : 1 / idxs.length;
          var newRcvd    = Math.round(grnTotal * weight * 1000) / 1000;
          var oldRcvd    = Number(lnData[idx][8]) || 0;
          var newPending = Math.max(0, qtyOrdered - newRcvd);
          var lineStatus = (newRcvd <= 0) ? 'OPEN' : (newRcvd < qtyOrdered) ? 'PARTIAL' : 'CLOSED';
          if (oldRcvd !== newRcvd) {
            lnWs.getRange(idx + 1, 9).setValue(newRcvd);
            lnWs.getRange(idx + 1, 10).setValue(newPending);
            lnWs.getRange(idx + 1, 11).setValue(lineStatus);
            Logger.log('reconcilePOReceipts: line ' + lnData[idx][1] + ' of ' + parts[0] + ' is estimated via proportional split.');
            lnData[idx][8]  = newRcvd;
            lnData[idx][9]  = newPending;
            lnData[idx][10] = lineStatus;
            diffs++;
          }
        });
      }
    });

    // Step 3: Re-derive header status for all touched POs
    Object.keys(processedPoNos).forEach(function(pn) {
      deriveHeaderStatus_(lnData, pn, hdrWs);
    });

    SpreadsheetApp.getUi().alert('PO Receipts Reconciled', diffs + ' line(s) updated. ' +
      Object.keys(processedPoNos).length + ' PO(s) processed.', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch(e) {
    Logger.log('reconcilePOReceipts: ' + e.message);
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}
