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
//
// WHERE: the scratch sheet lives in its OWN spreadsheet, not in the QMS data
// spreadsheet. Google's export endpoint 500s on a hidden sheet (see
// _grnSlipSheet_), so the tab has to stay visible — and a visible tab showing
// the last slip drawn does not belong in the file operators open every day.
// A separate file also means the lock only ever contends with other slip
// renders, never with ordinary sheet traffic.
// ============================================================

var GRN_SLIP_SHEET_ = 'SLIP_RENDER';
var GRN_SLIP_COLS_  = 6;
var GRN_SLIP_SS_KEY_ = 'pm.slip.renderSpreadsheetId';

// Pack Masters navy, matching the HTML letterhead.
var SLIP_NAVY_  = '#0d1b6e';
var SLIP_GREY_  = '#475569';
var SLIP_INK_   = '#0f172a';
var SLIP_RULE_  = '#cbd5e1';
var SLIP_TINT_  = '#f8fafc';

/**
 * The scratch spreadsheet. Created once, its id cached in Script Properties.
 * SpreadsheetApp.create is allowed under drive.file — the app is creating the
 * file itself, which is exactly what that scope grants.
 */
function _grnSlipSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(GRN_SLIP_SS_KEY_);
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e) { /* deleted or unreachable — fall through and mint a new one */ }
  }
  var ss = SpreadsheetApp.create('PM QMS — Slip Render (scratch, do not edit)');
  props.setProperty(GRN_SLIP_SS_KEY_, ss.getId());
  return ss;
}

/** Returns {ss, sh} — callers need the spreadsheet id to build the export URL. */
function _grnSlipSheet_() {
  var ss = _grnSlipSpreadsheet_();
  var sh = ss.getSheetByName(GRN_SLIP_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(GRN_SLIP_SHEET_);
    // A brand-new spreadsheet ships with a default 'Sheet1'; drop it so the
    // export gid is unambiguous and the file holds exactly one tab.
    ss.getSheets().forEach(function (s) {
      if (s.getSheetId() !== sh.getSheetId()) { try { ss.deleteSheet(s); } catch (e) {} }
    });
  }
  // MUST STAY VISIBLE. Google's export endpoint returns HTTP 500 for a hidden
  // sheet — proven by ?diag=hiddenexport: 500 while hidden, 200 the moment
  // showSheet() ran, same sheet and same URL. A hidden scratch sheet seemed
  // tidier and silently broke every export. Harmless here: nobody opens this file.
  try { if (sh.isSheetHidden()) sh.showSheet(); } catch (e) {}
  return { ss: ss, sh: sh };
}

/**
 * Reset the scratch sheet to a known state. Widths are tuned for A4 portrait.
 * Formats the whole grid rather than a computed row count: the previous version
 * took a `rows` estimate that was derived independently of the real last row, so
 * adding a row to the layout would have silently left the tail unformatted.
 * Also drops any images left behind by the previous render.
 */
function _grnSlipPrep_(sh) {
  sh.clear();
  try { sh.getImages().forEach(function (im) { im.remove(); }); } catch (e) {}
  var all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  try { all.breakApart(); } catch (e) {}
  try { all.setBorder(false, false, false, false, false, false); } catch (e) {}
  // A4 portrait printable width is ~720px at these margins; these six sum to 718.
  var widths = [34, 128, 196, 92, 128, 140];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);
  sh.getRange(1, 1, sh.getMaxRows(), GRN_SLIP_COLS_)
    .setFontFamily('Arial').setFontSize(9)
    .setVerticalAlignment('middle').setWrap(true);
  return sh;
}

/** Title band + document control line. Returns the next free row. */
function _grnSlipHeader_(sh) {
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

/**
 * getGRNPrintData stringifies quantities, so a raw write lands text in a numeric
 * column: float artefacts ("1.1000000000000001") would print verbatim and no
 * number format could correct them. Coerce back to a number when the string is
 * numeric, and let the cell's format handle the display.
 */
function _grnSlipQty_(v) {
  if (v == null || v === '') return '';
  var n = Number(v);
  return isNaN(n) ? String(v) : n;
}

/** Material items table. Returns the next free row. */
function _grnSlipItems_(sh, row, items) {
  var head = ['#', 'Code / कोड', 'Description / विवरण', 'Batch / बैच  ·  Expiry',
              'Ordered / Received', 'Unit'];
  sh.getRange(row, 1, 1, GRN_SLIP_COLS_).setValues([head])
    .setFontWeight('bold').setFontSize(8).setFontColor('#ffffff')
    .setBackground(SLIP_GREY_).setHorizontalAlignment('center');
  sh.setRowHeight(row, 20);
  var first = row + 1;

  var rows = [];
  (items || []).forEach(function (it, i) {
    // Expiry and ordered-qty are on the HTML slip; keeping them here holds the
    // two paths at content parity so the swap is not a silent data loss.
    var exp = it.expiryDate && it.expiryDate !== '—' ? it.expiryDate : '';
    var ord = _grnSlipQty_(it.qtyOrdered);
    var rec = _grnSlipQty_(it.qtyReceived);
    rows.push([
      i + 1,
      String(it.materialCode || ''),
      String(it.materialDesc || ''),
      String(it.batchNo || '') + (exp ? '\nExp ' + exp : ''),
      (ord === '' ? '—' : ord) + '  /  ' + (rec === '' ? '—' : rec),
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

/**
 * QR code, as an over-the-grid image anchored at the given cell.
 * A cell cannot hold a data: URI, so the sheet path fetches the PNG itself
 * rather than reusing generateGRNQR_'s base64 string. Failure is non-fatal —
 * a slip without a QR still beats no slip at all.
 */
function _grnSlipQr_(sh, row, col, docNo) {
  try {
    var target = getPublicUrl_() + '?doc=' + encodeURIComponent(docNo);
    var api = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&format=png&data=' +
              encodeURIComponent(target);
    var resp = UrlFetchApp.fetch(api, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return false;
    sh.insertImage(resp.getBlob(), col, row).setWidth(84).setHeight(84);
    return true;
  } catch (e) { return false; }
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
  var target = _grnSlipSheet_();
  var ss = target.ss;
  var sh = target.sh;

  _grnSlipPrep_(sh);

  var row = _grnSlipHeader_(sh);
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

  // The HTML slip embeds the attached photos. Reproducing them here would undo
  // the entire size saving, so the slip states the count and the record keeps
  // the images — the QR below is what gets a reader to them.
  var imgCount = (d.allImages || []).length;
  if (imgCount) {
    sh.getRange(row, 1, 1, GRN_SLIP_COLS_).merge()
      .setValue(imgCount + ' photo' + (imgCount === 1 ? '' : 's') +
                ' attached to this record — scan the QR to view')
      .setFontSize(8).setFontColor(SLIP_GREY_);
    sh.setRowHeight(row, 16);
  }
  row += 1;

  // QR sits beside the signatures, anchored one row above so the 84px image
  // clears the signing space rather than covering it.
  var qrRow = row;
  var hasQr = _grnSlipQr_(sh, qrRow, GRN_SLIP_COLS_, docNo);
  if (hasQr) {
    sh.getRange(qrRow + 2, GRN_SLIP_COLS_).setValue('Scan to verify')
      .setFontSize(7).setFontColor(SLIP_GREY_).setHorizontalAlignment('center');
    row += 3;
  }

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

  // The export endpoint is undocumented and 5xxs intermittently, so retry once.
  // Keep the response BODY in the error: the last time this returned 500 the
  // body was the only thing that identified the hidden-sheet cause, and
  // discarding it cost a whole diagnostic round trip to recover.
  var resp, code, body = '';
  for (var attempt = 0; attempt < 2; attempt++) {
    resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    code = resp.getResponseCode();
    if (code === 200) {
      return resp.getBlob()
                 .setName(String(docNo).replace(/[^A-Za-z0-9_.\-]/g, '_') + '.pdf');
    }
    try { body = String(resp.getContentText() || '').slice(0, 200); } catch (e) { body = ''; }
    if (code < 500) break;               // 4xx will not fix itself
    Utilities.sleep(1200);
  }
  throw new Error('Sheet export returned HTTP ' + code +
                  (body ? ' — ' + body.replace(/\s+/g, ' ') : ''));
}

/**
 * Build, store and share. Drop-in replacement for generateGRNPdf_.
 * Lock-guarded: one scratch sheet is shared by every concurrent save.
 */
function generateGRNPdfViaSheet_(docNo) {
  var lock = LockService.getScriptLock();
  var got = false;
  try {
    // A render is ~5-10s inside the lock (≈40 sheet writes, a flush, an external
    // export fetch, then upload+share). 30s left a queued third caller able to
    // time out, and the caller's catch in _docWorkGRN_ only logs — the record
    // would silently end up with no PDF link. 90s covers a realistic burst.
    got = lock.tryLock(90000);
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
