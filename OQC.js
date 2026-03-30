// ============================================================
// OQC.gs — Save and read OQC records
// Based on PM/FRM/FQC-01 Final Quality Control Release
// ============================================================

function getOQCFormInit() {
  var allMats = getMaterials();
  var fgMats  = allMats.filter(function(m) { return m.category && m.category.toUpperCase() === 'FG'; });
  return {
    docNumber:  peekNextDocNumber('oqc'),
    customers:  getCustomers(),
    materials:  fgMats,
    inspectors: getInspectors(),
    today:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

function saveOQC(data) {
  try {
    var ss  = getSpreadsheet();
    var ws  = ss.getSheetByName('OQC_LOG');
    if (!ws) throw new Error('OQC_LOG sheet not found. Run Setup first.');

    var now    = new Date();
    var dec    = data.releaseDecision || 'PENDING';
    var docNos = [];

    data.items.forEach(function(item) {
      var docNo  = getNextDocNumber('oqc');
      var checks = item.checks || {};

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
        item.acceptedQty != null ? item.acceptedQty : 0,
        item.rejectedQty != null ? item.rejectedQty : 0,
        now
      ];

      ws.appendRow(row);

      var lastRow = ws.getLastRow();
      ws.getRange(lastRow, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(lastRow, 19).setNumberFormat('dd-MMM-yyyy HH:mm');

      var decCell = ws.getRange(lastRow, 15);
      if      (dec === 'RELEASED') decCell.setBackground('#E8F5E9');
      else if (dec === 'REJECTED') decCell.setBackground('#FFEBEE');
      else if (dec === 'HOLD')     decCell.setBackground('#FFF3CD');

      docNos.push(docNo);
    });

    return { success: true, docNos: docNos };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function getOQCRowForWA(row) {
  var ws = getSpreadsheet().getSheetByName('OQC_LOG');
  if (!ws || row < 2) return null;
  var r = ws.getRange(row, 1, 1, 19).getValues()[0];
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
