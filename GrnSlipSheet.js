// ============================================================
// GrnSlipSheet.js — render a GRN slip into a SHEET, then export that sheet
// as PDF. Replaces the HTML->PDF converter path for GRN.
//
// WHY (measured, ?diag=pdfcompare, same document):
//     HTML -> Utilities.getAs('application/pdf')   86758 B
//     Sheets export?format=pdf                     43276 B   -50%
// The HTML converter embeds font subsets into every file — ?diag=pdfweight put
// that floor at ~62 KB even with no logo, no Hindi and no CSS. The export
// endpoint is Google printing an already-rendered sheet, so that floor is not
// paid at all.
//
// This is the pattern MMT already uses in production (_prepSlipSheet /
// _slipHeader / _slipInfoBlock), so it is proven in-house rather than invented
// here.
//
// CONCURRENCY: the slip is drawn on ONE scratch sheet, so two saves at once
// would overwrite each other's layout mid-export. Everything below runs inside
// a script lock. GRN volume is far higher than MMT's, so this matters here in a
// way it does not there.
// ============================================================

var GRN_SLIP_SHEET_ = '_GRN_SLIP';   // leading underscore = hidden scratch sheet
var GRN_SLIP_COLS_  = 6;

// Pack Masters navy, matching the HTML letterhead.
var SLIP_NAVY_  = '#0d1b6e';
var SLIP_GREY_  = '#475569';
var SLIP_INK_   = '#0f172a';
var SLIP_RULE_  = '#cbd5e1';
var SLIP_TINT_  = '#f8fafc';

function _grnSlipSheet_() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(GRN_SLIP_SHEET_);
  if (!sh) sh = ss.insertSheet(GRN_SLIP_SHEET_);
  // MUST STAY VISIBLE. Google's export endpoint returns HTTP 500 for a hidden
  // sheet — proven by ?diag=hiddenexport: 500 while hidden, 200 the moment
  // showSheet() ran, same sheet and same URL. A hidden scratch sheet seemed
  // tidier and silently broke every export.
  try { if (sh.isSheetHidden()) sh.showSheet(); } catch (e) {}
  // Park it last so it is out of the way without being hidden.
  try { ss.setActiveSheet(sh); ss.moveActiveSheet(ss.getSheets().length); } catch (e) {}
  return sh;
}

/** Reset the scratch sheet to a known state. Widths are tuned for A4 portrait. */
function _grnSlipPrep_(sh, rows) {
  sh.clear();
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setBorder(false, false, false, false, false, false); } catch (e) {}
  // A4 portrait printable width is ~720px at these margins; these six sum to 718.
  var widths = [34, 128, 196, 92, 128, 140];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);
  sh.getRange(1, 1, Math.max(rows, 1), GRN_SLIP_COLS_)
    .setFontFamily('Arial').setFontSize(9)
    .setVerticalAlignment('middle').setWrap(true);
  return sh;
}

/** Title band + document control line. Returns the next free row. */
function _grnSlipHeader_(sh, d) {
  sh.getRange(1, 1, 1, GRN_SLIP_COLS_).merge()
    .setValue('GOODS RECEIPT NOTE  /  माल प्राप्ति नोट')
    .setFontWeight('bold').setFontSize(13)
    .setBackground(SLIP_NAVY_).setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 30);

  sh.getRange(2, 1, 1, GRN_SLIP_COLS_).merge()
    .setValue('PM/FRM/GRN-01   ·   Rev 00   ·   Effective 01-07-2025   ·   ISO 9001:2015 Cl. 8.4.3')
    .setFontSize(8).setFontColor(SLIP_GREY_).setBackground(SLIP_TINT_)
    .setHorizontalAlignment('center');
  sh.setRowHeight(2, 18);
  return 4;   // row 3 left blank as breathing space
}

/** Two label/value pairs per row. Returns the next free row. */
function _grnSlipInfo_(sh, startRow, pairs) {
  for (var i = 0; i < pairs.length; i++) {
    var r = startRow + Math.floor(i / 2);
    var c = (i % 2 === 0) ? 1 : 4;
    sh.getRange(r, c).setValue(pairs[i][0])
      .setFontWeight('bold').setFontSize(8).setFontColor(SLIP_GREY_);
    sh.getRange(r, c + 1, 1, 2).merge()
      .setValue(pairs[i][1] === '' || pairs[i][1] == null ? '—' : pairs[i][1])
      .setFontSize(9).setFontColor(SLIP_INK_);
    sh.setRowHeight(r, 18);
  }
  var lastRow = startRow + Math.ceil(pairs.length / 2) - 1;
  sh.getRange(lastRow, 1, 1, GRN_SLIP_COLS_)
    .setBorder(false, false, true, false, false, false, SLIP_RULE_, SpreadsheetApp.BorderStyle.SOLID);
  return lastRow + 2;
}

/** Section caption. */
function _grnSlipCaption_(sh, row, text) {
  sh.getRange(row, 1, 1, GRN_SLIP_COLS_).merge()
    .setValue(text).setFontWeight('bold').setFontSize(9)
    .setFontColor(SLIP_NAVY_).setBackground('#eef2ff');
  sh.setRowHeight(row, 20);
  return row + 1;
}

/** Material items table. Returns the next free row. */
function _grnSlipItems_(sh, row, items) {
  var head = ['#', 'Code / कोड', 'Description / विवरण', 'Batch / बैच', 'Received / मिली', 'Unit'];
  sh.getRange(row, 1, 1, GRN_SLIP_COLS_).setValues([head])
    .setFontWeight('bold').setFontSize(8).setFontColor('#ffffff')
    .setBackground(SLIP_GREY_).setHorizontalAlignment('center');
  sh.setRowHeight(row, 20);
  var first = row + 1;

  var rows = [];
  (items || []).forEach(function (it, i) {
    rows.push([
      i + 1,
      String(it.materialCode || ''),
      String(it.materialDesc || ''),
      String(it.batchNo || ''),
      it.qtyReceived == null ? '' : it.qtyReceived,
      String(it.unit || '')
    ]);
  });
  if (!rows.length) rows.push(['', '', 'No items recorded', '', '', '']);

  sh.getRange(first, 1, rows.length, GRN_SLIP_COLS_).setValues(rows).setFontSize(9);
  sh.getRange(first, 1, rows.length, 1).setHorizontalAlignment('center');
  sh.getRange(first, 5, rows.length, 1).setHorizontalAlignment('right').setFontWeight('bold');
  sh.getRange(row, 1, rows.length + 1, GRN_SLIP_COLS_)
    .setBorder(true, true, true, true, true, true, SLIP_RULE_, SpreadsheetApp.BorderStyle.SOLID);
  for (var i = 0; i < rows.length; i++) sh.setRowHeight(first + i, 18);
  return first + rows.length + 1;
}

/** Signature strip. */
function _grnSlipSignatures_(sh, row) {
  var labels = ['Received By / प्राप्तकर्ता', 'Verified By / सत्यापित', 'Approved By / अनुमोदित'];
  sh.setRowHeight(row, 34);            // space to sign
  for (var i = 0; i < 3; i++) {
    var c = 1 + i * 2;
    sh.getRange(row, c, 1, 2).merge()
      .setBorder(false, false, true, false, false, false, SLIP_INK_, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(row + 1, c, 1, 2).merge().setValue(labels[i])
      .setFontSize(8).setFontColor(SLIP_GREY_).setHorizontalAlignment('center');
  }
  sh.setRowHeight(row + 1, 16);
  return row + 2;
}

/**
 * Build the slip and return its PDF blob.
 * Kept separate from the store step so the size can be measured without
 * writing to Drive.
 */
function buildGrnSlipPdf(docNo) {
  var d = getGRNPrintData(docNo);
  var ss = getSpreadsheet();
  var sh = _grnSlipSheet_();

  var itemCount = Math.max((d.items || []).length, 1);
  _grnSlipPrep_(sh, 24 + itemCount);

  var row = _grnSlipHeader_(sh, d);
  row = _grnSlipInfo_(sh, row, [
    ['GRN No / जीआरएन क्र.', d.docNo],
    ['Date / तारीख',          d.date],
    ['Supplier / आपूर्तिकर्ता', (d.supplierCode ? '[' + d.supplierCode + '] ' : '') + (d.supplierName || '')],
    ['Invoice / चालान सं.',   d.invoiceNo],
    ['PO Ref / पीओ सं.',      d.poRef],
    ['COA / सीओए',            d.coaReceived],
    ['Status / स्थिति',        d.status],
    ['Inspector / निरीक्षक',   d.inspector],
    ['Storage / भंडारण',      d.storageZone],
    ['Remarks / टिप्पणी',      d.remarks]
  ]);

  row = _grnSlipCaption_(sh, row, 'MATERIAL ITEMS  /  सामग्री वस्तुएँ');
  row = _grnSlipItems_(sh, row, d.items);
  row += 1;
  row = _grnSlipSignatures_(sh, row);

  sh.getRange(row + 1, 1, 1, GRN_SLIP_COLS_).merge()
    .setValue('Generated ' + (d.printedAt || '') + '   ·   Pack Masters QMS')
    .setFontSize(7).setFontColor(SLIP_GREY_).setHorizontalAlignment('center');

  var lastRow = row + 1;
  SpreadsheetApp.flush();

  // Print exactly the block we drew — not the sheet's full grid.
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
            '/export?format=pdf' +
            '&gid=' + sh.getSheetId() +
            '&range=A1:F' + lastRow +
            '&portrait=true&fitw=true' +
            '&gridlines=false&printtitle=false&sheetnames=false' +
            '&pagenumbers=false&fzr=false' +
            '&top_margin=0.35&bottom_margin=0.35&left_margin=0.4&right_margin=0.4';

  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Sheet export returned HTTP ' + resp.getResponseCode());
  }
  return resp.getBlob().setName(String(docNo).replace(/[^A-Za-z0-9_.\-]/g, '_') + '.pdf');
}

/**
 * Build, store and share. Drop-in replacement for generateGRNPdf_.
 * Lock-guarded: one scratch sheet is shared by every concurrent save.
 */
function generateGRNPdfViaSheet_(docNo) {
  var lock = LockService.getScriptLock();
  var got = false;
  try {
    got = lock.tryLock(30000);
    if (!got) throw new Error('Could not acquire lock for slip rendering');
    var blob = buildGrnSlipPdf(docNo);
    var folderId = qmsMonthFolderId_('GRN', new Date());
    var up = drvUploadBlob(blob, blob.getName(), folderId);
    drvShareAnyone(up.id);
    return drvViewUrl(up.id);
  } finally {
    if (got) lock.releaseLock();
  }
}
