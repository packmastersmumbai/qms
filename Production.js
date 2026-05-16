// ============================================================
// Production.js — RM issuance to production (UI consumer of the
// Warehouse.issueRMForProduction gate)
// ============================================================
//
// PROD_ISSUE_LOG schema (12 cols):
//   Issue ID, Timestamp, Production Order No., Material Code,
//   Material Name, Batch / Lot No., Location ID, Qty Issued, Unit,
//   Issued By, GRN Ref, Remarks

var PROD_ISSUE_HEADERS_ = [
  'Issue ID', 'Timestamp', 'Production Order No.', 'Material Code',
  'Material Name', 'Batch / Lot No.', 'Location ID', 'Qty Issued', 'Unit',
  'Issued By', 'GRN Ref', 'Remarks'
];

function getProdIssueSheet_() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('PROD_ISSUE_LOG');
  if (!ws) {
    ws = ss.insertSheet('PROD_ISSUE_LOG');
    ws.getRange(1, 1, 1, PROD_ISSUE_HEADERS_.length).setValues([PROD_ISSUE_HEADERS_]);
    ws.setFrozenRows(1);
    ws.getRange(1, 1, 1, PROD_ISSUE_HEADERS_.length)
      .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
  }
  return ws;
}

// ---------- Form init ----------

function getProductionFormInit() {
  var docNumber = (typeof peekNextDocNumber === 'function') ? peekNextDocNumber('prod') : '';
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var inspectors = (typeof getInspectors === 'function') ? getInspectors() : [];
  var materials  = (typeof getMaterials === 'function') ? getMaterials() : [];
  return {
    docNumber: docNumber,
    today: today,
    inspectors: inspectors,
    materials: materials
  };
}

// Returns FIFO-ordered, IQC-accepted, non-quarantine lots for one material
// suitable to issue to production. Each lot includes its IQC disposition.
function getProductionLotsForMaterial(materialCode) {
  if (!materialCode) return [];
  var lots = (typeof getFIFOLots === 'function') ? getFIFOLots(materialCode) : [];
  if (!lots.length) return [];

  // Resolve IQC disposition per batch (latest IQC row per GRN)
  var grnByBatch = {};
  var grnWs = getSpreadsheet().getSheetByName('GRN_LOG');
  if (grnWs && grnWs.getLastRow() > 1) {
    var g = grnWs.getDataRange().getValues();
    for (var i = 1; i < g.length; i++) {
      var mat = String(g[i][6] || '').trim();
      var batch = String(g[i][8] || '').trim();
      if (mat === materialCode && batch && !grnByBatch[batch]) {
        grnByBatch[batch] = String(g[i][0] || '').trim();
      }
    }
  }
  var dispByGRN = {};
  var iqcWs = getSpreadsheet().getSheetByName('IQC_LOG');
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iq = iqcWs.getDataRange().getValues();
    for (var j = iq.length - 1; j >= 1; j--) {
      var ref = String(iq[j][2] || '').trim();
      if (ref && !dispByGRN[ref]) {
        dispByGRN[ref] = String(iq[j][22] || '').toUpperCase();
      }
    }
  }

  return lots.map(function(l){
    var grnNo = grnByBatch[l.batchOrLotNo] || '';
    var disp  = dispByGRN[grnNo] || 'PENDING';
    return {
      materialCode:  l.materialCode,
      batchOrLotNo:  l.batchOrLotNo,
      locationId:    l.locationId,
      balance:       l.balance,
      grnNo:         grnNo,
      iqcDisposition: disp,
      grnDate:       l.grnDate
    };
  });
}

// ---------- Recent issues ----------

function getRecentProductionIssues(limit) {
  var ws = getProdIssueSheet_();
  if (ws.getLastRow() < 2) return [];
  var n = Math.min(limit || 10, ws.getLastRow() - 1);
  var rows = ws.getRange(ws.getLastRow() - n + 1, 1, n, PROD_ISSUE_HEADERS_.length).getValues();
  return rows.reverse().map(function(r){
    return {
      issueId:     r[0],
      timestamp:   r[1],
      prodOrderNo: r[2],
      materialCode: r[3],
      materialName: r[4],
      batchOrLotNo: r[5],
      locationId:  r[6],
      qtyIssued:   r[7],
      unit:        r[8],
      issuedBy:    r[9],
      grnRef:      r[10],
      remarks:     r[11]
    };
  });
}

// ---------- Issue RM (wraps Warehouse gate + writes PROD_ISSUE_LOG) ----------

function issueRMToProduction(data) {
  try {
    if (typeof issueRMForProduction !== 'function') {
      return { success: false, error: 'Warehouse.issueRMForProduction not loaded.' };
    }
    var gateResult = issueRMForProduction({
      materialCode:      data.materialCode,
      batchOrLotNo:      data.batchOrLotNo,
      locationId:        data.locationId,
      qtyToIssue:        data.qtyToIssue,
      productionOrderNo: data.productionOrderNo,
      issuedBy:          data.issuedBy
    });
    if (!gateResult || !gateResult.success) {
      return gateResult || { success: false, error: 'Issue gate failed.' };
    }

    // Gate passed and STOCK_LEDGER row was written by Warehouse.
    // Now write PROD_ISSUE_LOG for traceable production-side history.
    var issueId  = getNextDocNumber('prod');
    var mats     = (typeof getMaterials === 'function') ? getMaterials() : [];
    var mat = null;
    for (var i = 0; i < mats.length; i++) {
      var c = mats[i].code || mats[i].itemCode;
      if (c === data.materialCode) { mat = mats[i]; break; }
    }
    var matName = mat ? (mat.name || mat.itemDescription || '') : '';
    var unit    = data.unit || (mat ? (mat.unit || '') : '');

    var ws = getProdIssueSheet_();
    ws.appendRow([
      issueId, new Date(),
      data.productionOrderNo || '',
      data.materialCode, matName,
      data.batchOrLotNo, data.locationId,
      Number(data.qtyToIssue) || 0, unit,
      data.issuedBy || '',
      gateResult.grnNo || '',
      data.remarks || ('IQC disp: ' + (gateResult.iqcDisposition || ''))
    ]);
    ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');

    return {
      success: true,
      issueId: issueId,
      balance: gateResult.balance,
      grnNo: gateResult.grnNo,
      iqcDisposition: gateResult.iqcDisposition
    };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}
