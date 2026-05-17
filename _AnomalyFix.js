// One-shot inspector + fixer for PM/PO/2026-004 L3 over-receipt anomaly.
// Created 2026-05-17, can be deleted after Phase 1 anomaly closure.

function _inspectGRN040() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('GRN_LOG');
  var data = ws.getDataRange().getValues();
  var hits = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'PM/GRN/2026-040') {
      hits.push({
        row: i + 1,
        docNo: data[i][0],
        materialCode: data[i][6],
        materialDesc: data[i][7],
        batchNo: data[i][8],
        qtyOrdered: data[i][9],
        qtyReceived: data[i][10],
        unit: data[i][11],
        location: data[i][20]
      });
    }
  }
  return hits;
}

function _inspectLedger040() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('STOCK_LEDGER');
  var data = ws.getDataRange().getValues();
  var hits = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][10] === 'PM/GRN/2026-040') {
      hits.push({
        row: i + 1,
        txType: data[i][0],
        materialCode: data[i][1],
        batchNo: data[i][2],
        location: data[i][3],
        qtyIn: data[i][4],
        qtyOut: data[i][5],
        refDocNo: data[i][10]
      });
    }
  }
  return hits;
}

// Fix GRN/2026-040 line for material 2966564:
//   qtyOrdered 199 -> 100 (match PO/2026-004 L3)
//   qtyReceived 199 -> 99 (true received qty, given PO qtyOrdered was 100)
// No STOCK_LEDGER row exists for this GRN line (legacy data, pre-ledger-wiring) — nothing to update there.
function _fixGRN040Overreceipt() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ss = getSpreadsheet();
  var result = { grn: null };
  var matCode = 2966564; // numeric, as stored

  var grnWs = ss.getSheetByName('GRN_LOG');
  var grnData = grnWs.getDataRange().getValues();
  for (var i = 1; i < grnData.length; i++) {
    if (grnData[i][0] === 'PM/GRN/2026-040' && Number(grnData[i][6]) === matCode) {
      var ordBefore = grnData[i][9];
      var recBefore = grnData[i][10];
      if (ordBefore === 199 && recBefore === 199) {
        grnWs.getRange(i + 1, 10).setValue(100); // qtyOrdered
        grnWs.getRange(i + 1, 11).setValue(99);  // qtyReceived
        result.grn = { row: i + 1, qtyOrdered: { before: 199, after: 100 }, qtyReceived: { before: 199, after: 99 } };
      } else {
        result.grn = { row: i + 1, skipped: true, ordBefore: ordBefore, recBefore: recBefore };
      }
      break;
    }
  }

  SpreadsheetApp.flush();
  return result;
}
