// ============================================================
// _POPDiag.js — Purchase Order diagnostic harness (11 sections)
// P2 — Pack Masters QMS
//
// Menu: QMS System → 📊 Run POP Diagnostics → writes _POP_DIAG
//       QMS System → 🛰️ Trace PO by docNo   → writes _POP_TRACE
// ============================================================

// Headless wrapper for clasp run / scheduled jobs — no UI alert, returns
// { errors, warns, total, fails }. Sheet write still happens.
function runPOPDiag_core() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  return _runPOPDiagImpl(true);
}

function runPOPDiag() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  return _runPOPDiagImpl(false);
}

function _runPOPDiagImpl(headless) {
  var ss  = getSpreadsheet();
  var ui  = headless ? null : SpreadsheetApp.getUi();
  var report = []; // [section, check, value, severity]

  function add(section, check, value, severity) {
    report.push([section, check, String(value == null ? '' : value), severity || 'INFO']);
  }

  // ── §1. Sheet existence + header drift ─────────────────────
  var sheetsNeeded = ['PO_HEADER', 'PO_LINES', 'GRN_LOG', 'MASTERS_Suppliers', 'MASTERS_Materials'];
  sheetsNeeded.forEach(function(name) {
    var w = ss.getSheetByName(name);
    if (!w) { add('1. Sheets', name, 'MISSING', 'ERROR'); return; }
    add('1. Sheets', name, w.getLastRow() + ' rows', 'INFO');
  });

  var hdrWs = ss.getSheetByName('PO_HEADER');
  var lnWs  = ss.getSheetByName('PO_LINES');

  // Header drift check for PO_HEADER
  if (hdrWs && hdrWs.getLastColumn() >= 1) {
    var expectedHdr = PO_HEADER_HEADERS;
    var actualHdr   = hdrWs.getRange(1, 1, 1, hdrWs.getLastColumn()).getValues()[0];
    var hdrDrift = [];
    for (var i = 0; i < expectedHdr.length; i++) {
      if (String(actualHdr[i] || '').trim() !== expectedHdr[i]) {
        hdrDrift.push('col ' + (i+1) + ' is "' + actualHdr[i] + '" (want "' + expectedHdr[i] + '")');
      }
    }
    add('1. Sheets', 'PO_HEADER header drift', hdrDrift.length === 0 ? 'none' : hdrDrift.join('; '),
        hdrDrift.length === 0 ? 'INFO' : 'ERROR');
  }
  // Header drift for PO_LINES
  if (lnWs && lnWs.getLastColumn() >= 1) {
    var expectedLn = PO_LINE_HEADERS;
    var actualLn   = lnWs.getRange(1, 1, 1, lnWs.getLastColumn()).getValues()[0];
    var lnDrift = [];
    for (var j = 0; j < expectedLn.length; j++) {
      if (String(actualLn[j] || '').trim() !== expectedLn[j]) {
        lnDrift.push('col ' + (j+1) + ': "' + actualLn[j] + '" → "' + expectedLn[j] + '"');
      }
    }
    add('1. Sheets', 'PO_LINES header drift', lnDrift.length === 0 ? 'none' : lnDrift.join('; '),
        lnDrift.length === 0 ? 'INFO' : 'ERROR');
  }
  // MASTERS_Suppliers state_code col
  var suppWs = ss.getSheetByName('MASTERS_Suppliers');
  if (suppWs) {
    var suppHdrRow = suppWs.getLastColumn() >= 8 ? suppWs.getRange(1, 8, 1, 1).getValue() : '';
    add('1. Sheets', 'MASTERS_Suppliers col 8 (State Code)', String(suppHdrRow),
        String(suppHdrRow).trim() === 'State Code' ? 'INFO' : 'WARN');
  }

  // ── §2. Doc-number counter sanity ──────────────────────────
  var nextPo = peekNextDocNumber('po');
  add('2. Counter', 'peekNextDocNumber(po)', nextPo, nextPo === '—' ? 'ERROR' : 'INFO');
  if (hdrWs && hdrWs.getLastRow() > 1) {
    var prefixPO = 'PM/PO/2026-';
    var maxSeq = 0;
    hdrWs.getRange(2, 1, hdrWs.getLastRow() - 1, 1).getValues().forEach(function(r) {
      var s = String(r[0] || '');
      if (s.indexOf(prefixPO) === 0) {
        var n = parseInt(s.substring(prefixPO.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
    var counterOk = nextPo !== '—' && parseInt(String(nextPo).replace(prefixPO, ''), 10) > maxSeq;
    add('2. Counter', 'max PO suffix in PO_HEADER', maxSeq, 'INFO');
    add('2. Counter', 'counter > max?', counterOk ? 'YES' : 'NO', counterOk ? 'INFO' : 'ERROR');
  }

  // ── §3. Status distribution ────────────────────────────────
  var statusCounts = {};
  var staleDrafts = 0;
  var now = new Date();
  if (hdrWs && hdrWs.getLastRow() > 1) {
    hdrWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var st = String(r[11] || '').trim();
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      if (st === 'DRAFT') {
        var created = r[14];
        if (created instanceof Date) {
          var ageMs = now - created;
          if (ageMs > 30 * 24 * 60 * 60 * 1000) staleDrafts++;
        }
      }
    });
    Object.keys(statusCounts).forEach(function(st) {
      add('3. Status dist', st, statusCounts[st], 'INFO');
    });
    add('3. Status dist', 'DRAFT older than 30 days', staleDrafts, staleDrafts > 0 ? 'WARN' : 'INFO');
  } else {
    add('3. Status dist', 'PO_HEADER', 'empty', 'INFO');
  }

  // ── §4. Line-vs-header status consistency ──────────────────
  var lnDataAll = [];
  if (lnWs && lnWs.getLastRow() > 1) {
    lnDataAll = lnWs.getDataRange().getValues().slice(1);
  }
  var hdrRows = [];
  if (hdrWs && hdrWs.getLastRow() > 1) {
    hdrRows = hdrWs.getDataRange().getValues().slice(1);
  }

  var inconsistencies4 = 0;
  hdrRows.forEach(function(hr) {
    var pn = String(hr[0] || '').trim();
    var hdrStatus = String(hr[11] || '').trim();
    if (hdrStatus === 'DRAFT' || hdrStatus === 'CANCELLED') return;
    var linesForPO = lnDataAll.filter(function(l) {
      return String(l[0] || '').trim() === pn && String(l[10] || '').trim() !== 'CANCELLED';
    });
    if (linesForPO.length === 0) return;
    var lineStatuses = linesForPO.map(function(l) { return String(l[10] || '').trim(); });
    var expected;
    if (lineStatuses.every(function(s) { return s === 'CLOSED'; })) expected = 'CLOSED';
    else if (lineStatuses.some(function(s) { return s === 'PARTIAL' || s === 'CLOSED'; })) expected = 'PARTIAL_RECEIVED';
    else expected = 'OPEN';
    if (expected !== hdrStatus) {
      add('4. Line-hdr consistency', pn, 'hdr=' + hdrStatus + ' expected=' + expected, 'ERROR');
      inconsistencies4++;
    }
  });
  if (inconsistencies4 === 0) add('4. Line-hdr consistency', 'all POs', 'consistent', 'INFO');

  // ── §5. Qty-pending math + header-totals drift ─────────────
  var qtyMathErrors = 0, totalsDriftCount = 0;
  lnDataAll.forEach(function(r) {
    var pn       = String(r[0] || '').trim();
    var ln       = Number(r[1]) || 0;
    var qtyOrd   = Number(r[5]) || 0;
    var qtyRcvd  = Number(r[8]) || 0;
    var qtyPend  = Number(r[9]);
    var expected = qtyOrd - qtyRcvd;
    if (Math.abs(qtyPend - expected) > 0.001) {
      add('5. Qty math', pn + ' L' + ln, 'pending=' + qtyPend + ' expected=' + expected, 'ERROR');
      qtyMathErrors++;
    }
  });
  if (qtyMathErrors === 0) add('5. Qty math', 'all lines', 'correct', 'INFO');

  // Header totals drift
  hdrRows.forEach(function(hr) {
    var pn = String(hr[0] || '').trim();
    var hdrSub = Number(hr[8]) || 0;
    var hdrGst = Number(hr[9]) || 0;
    var hdrGrand = Number(hr[10]) || 0;
    var gstPct = Number(hr[6]) || 0;
    var linesForPO = lnDataAll.filter(function(l) { return String(l[0] || '').trim() === pn; });
    var linesSub = linesForPO.reduce(function(s, l) { return s + (Number(l[7]) || 0); }, 0);
    var linesGst = linesSub * gstPct / 100;
    var linesGrand = linesSub + linesGst;
    if (Math.abs(hdrSub - linesSub) > 0.01 || Math.abs(hdrGrand - linesGrand) > 0.01) {
      add('5. Totals drift', pn, 'hdr=' + hdrGrand.toFixed(2) + ' lines=' + linesGrand.toFixed(2), 'WARN');
      totalsDriftCount++;
    }
  });
  if (totalsDriftCount === 0) add('5. Totals drift', 'all POs', 'no drift', 'INFO');

  // ── §6. Qty_received vs GRN_LOG reconciliation ─────────────
  var grnWs = ss.getSheetByName('GRN_LOG');
  var grnSums = {};
  if (grnWs && grnWs.getLastRow() > 1) {
    grnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var poRef = String(r[4] || '').trim();
      var mat   = String(r[6] || '').trim();
      var qty   = Number(r[10]) || 0;
      if (!isPOAttached_(poRef) || !mat) return;
      var k = poRef + '|' + mat;
      grnSums[k] = (grnSums[k] || 0) + qty;
    });
  }
  var reconcileMismatches = 0;
  lnDataAll.forEach(function(r) {
    var pn   = String(r[0] || '').trim();
    var mat  = String(r[2] || '').trim();
    var rcvd = Number(r[8]) || 0;
    var k    = pn + '|' + mat;
    var grnTotal = grnSums[k] || 0;
    if (Math.abs(rcvd - grnTotal) > 0.001) {
      add('6. GRN reconcile', pn + ' / ' + mat, 'PO_LINES=' + rcvd + ' GRN_sum=' + grnTotal, 'WARN');
      reconcileMismatches++;
    }
  });
  if (reconcileMismatches === 0) add('6. GRN reconcile', 'all lines', 'in sync', 'INFO');
  else add('6. GRN reconcile', 'suggestion', 'Run reconcilePOReceipts() from menu to self-heal', 'WARN');

  // ── §7. Over-receipt detection ─────────────────────────────
  var overRcpt = 0;
  lnDataAll.forEach(function(r) {
    var pn   = String(r[0] || '').trim();
    var ln   = Number(r[1]) || 0;
    var ord  = Number(r[5]) || 0;
    var rcvd = Number(r[8]) || 0;
    if (rcvd > ord) {
      add('7. Over-receipt', pn + ' L' + ln, 'rcvd=' + rcvd + ' ordered=' + ord, 'WARN');
      overRcpt++;
    }
  });
  if (overRcpt === 0) add('7. Over-receipt', 'all lines', 'none', 'INFO');

  // ── §8. Orphan GRNs ────────────────────────────────────────
  var poHeaderSet = {};
  hdrRows.forEach(function(r) { poHeaderSet[String(r[0] || '').trim()] = true; });

  var orphanCount = 0, legacyCount = 0;
  if (grnWs && grnWs.getLastRow() > 1) {
    grnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var poRef = String(r[4] || '').trim();
      if (!poRef) return;
      if (!isPOAttached_(poRef)) { legacyCount++; return; }
      if (!poHeaderSet[poRef]) {
        add('8. Orphan GRNs', String(r[0] || '').trim(), 'poRef=' + poRef + ' not in PO_HEADER', 'ERROR');
        orphanCount++;
      }
    });
  }
  if (orphanCount === 0) add('8. Orphan GRNs', 'attached GRNs', 'all resolve', 'INFO');
  add('8. Orphan GRNs', 'legacy free-text poRefs (non-PO-format)', legacyCount, 'INFO');

  // ── §9. PO aging without receipts ──────────────────────────
  var agingCount = 0;
  hdrRows.forEach(function(r) {
    var pn     = String(r[0] || '').trim();
    var status = String(r[11] || '').trim();
    var created = r[14];
    if (status !== 'OPEN') return;
    if (!(created instanceof Date)) return;
    var ageMs = now - created;
    if (ageMs < 14 * 24 * 60 * 60 * 1000) return;
    // Check for any receipts
    var hasReceipt = lnDataAll.some(function(l) {
      return String(l[0] || '').trim() === pn && (Number(l[8]) || 0) > 0;
    });
    if (!hasReceipt) {
      var ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      add('9. Aging', pn, 'OPEN ' + ageDays + ' days, zero receipts', 'WARN');
      agingCount++;
    }
  });
  if (agingCount === 0) add('9. Aging', 'OPEN POs', 'none stale >14 days', 'INFO');

  // ── §10. Supplier/material master resolution ───────────────
  var suppSet = {};
  if (suppWs && suppWs.getLastRow() > 1) {
    suppWs.getRange(2, 1, suppWs.getLastRow() - 1, 1).getValues().forEach(function(r) {
      suppSet[String(r[0] || '').trim()] = true;
    });
  }
  var matSet = {};
  var matWs = ss.getSheetByName('MASTERS_Materials');
  if (matWs && matWs.getLastRow() > 1) {
    matWs.getRange(2, 1, matWs.getLastRow() - 1, 1).getValues().forEach(function(r) {
      matSet[String(r[0] || '').trim()] = true;
    });
  }
  var brokenRefs = 0;
  hdrRows.forEach(function(r) {
    var pn   = String(r[0] || '').trim();
    var supp = String(r[2] || '').trim();
    if (supp && !suppSet[supp]) {
      add('10. Master refs', pn, 'supplier "' + supp + '" not in MASTERS_Suppliers', 'ERROR');
      brokenRefs++;
    }
  });
  lnDataAll.forEach(function(r) {
    var pn  = String(r[0] || '').trim();
    var mat = String(r[2] || '').trim();
    if (mat && !matSet[mat]) {
      add('10. Master refs', pn + ' line ' + r[1], 'material "' + mat + '" not in MASTERS_Materials', 'ERROR');
      brokenRefs++;
    }
  });
  if (brokenRefs === 0) add('10. Master refs', 'all refs', 'resolve OK', 'INFO');

  // ── §11. Line-count + orphan PO_LINES ─────────────────────
  var linesByPo = {};
  lnDataAll.forEach(function(r) {
    var pn = String(r[0] || '').trim();
    if (pn) linesByPo[pn] = (linesByPo[pn] || 0) + 1;
  });

  var headersWithNoLines = 0;
  hdrRows.forEach(function(r) {
    var pn = String(r[0] || '').trim();
    if (!pn) return;
    if (!linesByPo[pn]) {
      add('11. Line count', pn, 'PO_HEADER exists but 0 lines in PO_LINES', 'ERROR');
      headersWithNoLines++;
    }
  });
  if (headersWithNoLines === 0) add('11. Line count', 'all headers', 'have >= 1 line', 'INFO');

  var orphanLines = 0;
  Object.keys(linesByPo).forEach(function(pn) {
    if (!poHeaderSet[pn]) {
      add('11. Line count', 'orphan', 'po_no "' + pn + '" in PO_LINES has no PO_HEADER row', 'ERROR');
      orphanLines++;
    }
  });
  if (orphanLines === 0) add('11. Line count', 'orphan PO_LINES', 'none', 'INFO');

  // ── Write _POP_DIAG sheet ──────────────────────────────────
  var diag = ss.getSheetByName('_POP_DIAG') || ss.insertSheet('_POP_DIAG');
  diag.clear();
  diag.getRange(1, 1, 1, 4).setValues([['Section', 'Check', 'Value', 'Severity']])
    .setBackground('#0D1B6E').setFontColor('#FFFFFF').setFontWeight('bold');
  if (report.length) {
    diag.getRange(2, 1, report.length, 4).setValues(report);
    // Colour severity rows
    report.forEach(function(row, i) {
      var bg = row[3] === 'ERROR' ? '#FFEBEE' : row[3] === 'WARN' ? '#FFF3E0' : '#FFFFFF';
      diag.getRange(i + 2, 1, 1, 4).setBackground(bg);
    });
  }
  diag.setFrozenRows(1);
  diag.setTabColor('#FF5722');
  [1,2,3,4].forEach(function(c) { diag.setColumnWidth(c, 220); });

  var errorCount = report.filter(function(r) { return r[3] === 'ERROR'; }).length;
  var warnCount  = report.filter(function(r) { return r[3] === 'WARN';  }).length;
  if (headless) {
    return { fails: errorCount, errors: errorCount, warns: warnCount, total: report.length };
  }
  ui.alert('POP Diagnostics complete',
    report.length + ' checks.\nERROR: ' + errorCount + '  WARN: ' + warnCount + '\n\nSee "_POP_DIAG" sheet.',
    ui.ButtonSet.OK);
}

// ── tracePOById ───────────────────────────────────────────────

/**
 * Writes a step-by-step trace of one PO to _POP_TRACE sheet.
 * Sections: header dump | lines | GRN receipts | IQC dispositions | STOCK_LEDGER | per-line OTD
 */
function tracePOById(poNo) {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ss  = getSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  poNo = String(poNo || '').trim();
  if (!poNo) { ui.alert('No PO number provided.'); return; }

  var trace = ss.getSheetByName('_POP_TRACE') || ss.insertSheet('_POP_TRACE');
  trace.clear();
  trace.setTabColor('#9C27B0');

  var row = 1;
  function heading(title) {
    trace.getRange(row, 1, 1, 6).merge().setValue(title)
      .setBackground('#0D1B6E').setFontColor('#FFFFFF').setFontWeight('bold');
    row++;
  }
  function cols(arr) {
    var cols4 = arr.concat(['','','','','','']).slice(0, 6);
    trace.getRange(row, 1, 1, 6).setValues([cols4]);
    row++;
  }

  // §A Header
  heading('=== PO HEADER: ' + poNo + ' ===');
  cols(['Field', 'Value']);
  var hdrWs = ss.getSheetByName('PO_HEADER');
  var hdrFound = false;
  if (hdrWs && hdrWs.getLastRow() > 1) {
    var hdrData = hdrWs.getDataRange().getValues();
    var hdrLabels = hdrData[0];
    for (var i = 1; i < hdrData.length; i++) {
      if (String(hdrData[i][0] || '').trim() !== poNo) continue;
      hdrFound = true;
      hdrLabels.forEach(function(label, ci) {
        var v = hdrData[i][ci];
        if (v instanceof Date && !isNaN(v)) v = Utilities.formatDate(v, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm');
        cols([label, String(v != null ? v : '')]);
      });
      break;
    }
  }
  if (!hdrFound) { cols(['ERROR', 'PO not found: ' + poNo]); }

  // §B Lines
  row++;
  heading('=== PO LINES ===');
  cols(['line_no','material_code','qty_ordered','qty_received','qty_pending','line_status']);
  var lnWs = ss.getSheetByName('PO_LINES');
  var linesData = [];
  if (lnWs && lnWs.getLastRow() > 1) {
    lnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      if (String(r[0] || '').trim() !== poNo) return;
      linesData.push(r);
      cols([r[1], r[2], r[5], r[8], r[9], r[10]]);
    });
  }

  // §C GRN receipts
  row++;
  heading('=== GRN RECEIPTS for ' + poNo + ' ===');
  cols(['GRN No.','Date','Material Code','Qty Received','IQC Status','']);
  var grnWs = ss.getSheetByName('GRN_LOG');
  var linkedGrnNos = [];
  if (grnWs && grnWs.getLastRow() > 1) {
    grnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      if (String(r[4] || '').trim() !== poNo) return;
      var grnNo = String(r[0] || '').trim();
      if (linkedGrnNos.indexOf(grnNo) === -1) linkedGrnNos.push(grnNo);
      var d = r[1];
      if (d instanceof Date && !isNaN(d)) d = Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MMM-yyyy');
      cols([grnNo, d, r[6], r[10], r[15], '']);
    });
  }
  if (linkedGrnNos.length === 0) cols(['(no GRN receipts)', '', '', '', '', '']);

  // §D IQC dispositions
  row++;
  heading('=== IQC DISPOSITIONS ===');
  cols(['IQC No.','GRN Ref','Material Desc','Disposition','Accepted Qty','Rejected Qty']);
  var iqcWs = ss.getSheetByName('IQC_LOG');
  if (iqcWs && iqcWs.getLastRow() > 1 && linkedGrnNos.length > 0) {
    var hasIqc = false;
    iqcWs.getDataRange().getValues().slice(1).forEach(function(r) {
      if (linkedGrnNos.indexOf(String(r[2] || '').trim()) === -1) return;
      cols([r[0], r[2], r[4], r[22], r[26], r[27]]);
      hasIqc = true;
    });
    if (!hasIqc) cols(['(no IQC records)', '', '', '', '', '']);
  } else {
    cols(['(no GRNs to link)', '', '', '', '', '']);
  }

  // §E STOCK_LEDGER
  row++;
  heading('=== STOCK LEDGER (GRN_RECEIPT entries) ===');
  cols(['Txn ID','Timestamp','Material Code','Qty In','Location ID','GRN Ref']);
  var ledWs = ss.getSheetByName('STOCK_LEDGER');
  if (ledWs && ledWs.getLastRow() > 1 && linkedGrnNos.length > 0) {
    var hasLed = false;
    ledWs.getDataRange().getValues().slice(1).forEach(function(r) {
      if (String(r[2] || '').trim() !== 'GRN_RECEIPT') return;
      if (linkedGrnNos.indexOf(String(r[10] || '').trim()) === -1) return;
      var ts = r[1];
      if (ts instanceof Date && !isNaN(ts)) ts = Utilities.formatDate(ts, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm');
      cols([r[0], ts, r[3], r[6], r[5], r[10]]);
      hasLed = true;
    });
    if (!hasLed) cols(['(no STOCK_LEDGER entries)', '', '', '', '', '']);
  } else {
    cols(['(no GRNs or no STOCK_LEDGER)', '', '', '', '', '']);
  }

  // §F Per-line OTD computation
  row++;
  heading('=== PER-LINE OTD (On-Time Delivery) ===');
  cols(['line_no','material_code','promised_date','last_grn_date','OTD?','notes']);

  // Build grnDate by grnNo
  var grnDateMap = {};
  if (grnWs && grnWs.getLastRow() > 1) {
    grnWs.getDataRange().getValues().slice(1).forEach(function(r) {
      var grnNo = String(r[0] || '').trim();
      if (!grnDateMap[grnNo] && r[1] instanceof Date) grnDateMap[grnNo] = r[1];
    });
  }
  var hdrDueDate = null;
  if (hdrFound && hdrWs) {
    var hd2 = hdrWs.getDataRange().getValues();
    for (var hh = 1; hh < hd2.length; hh++) {
      if (String(hd2[hh][0] || '').trim() !== poNo) continue;
      hdrDueDate = hd2[hh][4] instanceof Date ? hd2[hh][4] : null;
      break;
    }
  }

  linesData.forEach(function(r) {
    var ln       = r[1];
    var mat      = String(r[2] || '').trim();
    var promised = r[12] instanceof Date ? r[12] : (hdrDueDate || null);
    var lastGrn  = String(r[11] || '').trim();
    var grnDate  = lastGrn ? grnDateMap[lastGrn] : null;
    var promStr  = promised ? Utilities.formatDate(promised, 'Asia/Kolkata', 'dd-MMM-yyyy') : 'N/A';
    var grnStr   = grnDate  ? Utilities.formatDate(grnDate,  'Asia/Kolkata', 'dd-MMM-yyyy') : 'not received';
    var otd      = 'N/A', notes = '';
    if (promised && grnDate) {
      otd   = grnDate <= promised ? 'ON TIME' : 'LATE';
      if (grnDate > promised) {
        var days = Math.round((grnDate - promised) / (24 * 60 * 60 * 1000));
        notes = days + ' day(s) late';
      }
    } else if (!grnDate) {
      notes = promised && promised < new Date() ? 'OVERDUE (not yet received)' : 'pending receipt';
    }
    cols([ln, mat, promStr, grnStr, otd, notes]);
  });

  trace.setFrozenRows(0);
  [1,2,3,4,5,6].forEach(function(c) { trace.setColumnWidth(c, 180); });
  ui.alert('Trace complete', 'PO trace written to "_POP_TRACE" sheet.\n' + linesData.length + ' line(s) traced.', ui.ButtonSet.OK);
}
