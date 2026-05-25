// ============================================================
// Gatepass.gs — Save and read Gatepass records
// ============================================================

function getGatpassFormInit() {
  var suppliers = getSuppliers().map(function(s) {
    return { code: s.code, name: s.name, type: 'Supplier' };
  });
  var customers = getCustomers().map(function(c) {
    return { code: c.code, name: c.name, type: 'Customer' };
  });

  return {
    docNumber: peekNextDocNumber('gp'),
    parties:   suppliers.concat(customers),
    materials: getMaterials(),
    personnel: getInspectors(),
    today:     Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

function saveGatepass(data) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('GATEPASS_LOG');
    if (!ws) throw new Error('GATEPASS_LOG sheet not found. Run Setup first.');

    // Outbound dispatches must reference a RELEASED/ACCEPTED OQC that has not been used.
    // UI dropdown already filters; this defends against crafted-JSON bypass.
    if (String(data.type || '').toUpperCase() === 'OUTBOUND') {
      assertOQCReleasedForRef_(data.oqcRef, ss);
    }

    var docNo = getNextDocNumber('gp');
    var now   = new Date();
    var user  = Session.getActiveUser().getEmail() || 'QA';
    var date  = new Date(data.date);
    var operatorId = data.operatorName || '';

    // Support multi-item array or fallback to single-item (backward compat)
    var items = (data.items && data.items.length > 0) ? data.items : [{
      materialCode: data.materialCode || '',
      materialDesc: data.materialDesc || '',
      qty:          data.qty          || '',
      unit:         data.unit         || ''
    }];

    items.forEach(function(item) {
      ws.appendRow([
        docNo,
        date,
        data.type          || '',
        data.oqcRef        || '',
        data.partyName     || '',
        item.materialCode  || '',
        item.materialDesc  || '',
        item.qty           || '',
        item.unit          || '',
        data.vehicleNo     || '',
        data.driverName    || '',
        data.transporter   || '',
        data.authorizedBy  || '',
        data.securityGuard || '',
        data.remarks       || '',
        'ISSUED',
        user,
        now,
        data.dispatchZone  || '',
        operatorId           // last col: operator_id — add this header manually in the sheet
      ]);
    });

    var lastRow  = ws.getLastRow();
    var startRow = lastRow - items.length + 1;
    for (var r = startRow; r <= lastRow; r++) {
      ws.getRange(r, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(r, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
    }

    return { success: true, docNo: docNo };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// Returns FIFO-ordered lot allocation plan for a material + requested qty.
// Each lot = one released, un-dispatched OQC record for the material.
// Allocates qty greedily oldest-first; returns lot rows with suggestedQty capped at available.
function getFIFOAllocation(materialCode, qtyRequested) {
  try {
    var ss    = getSpreadsheet();
    var oqcWs = ss.getSheetByName('OQC_LOG');
    if (!oqcWs || oqcWs.getLastRow() < 2) return { lots: [], total: 0 };

    var usedRefs = {};
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (gpWs && gpWs.getLastRow() > 1) {
      gpWs.getRange(2, 4, gpWs.getLastRow() - 1, 1).getValues()
        .forEach(function(r) { if (r[0]) usedRefs[String(r[0]).trim()] = true; });
    }

    var oqcData = oqcWs.getDataRange().getValues();
    var lots = [];
    for (var i = 1; i < oqcData.length; i++) {
      var row      = oqcData[i];
      var docNo    = String(row[0] || '').trim();
      var date     = row[1];
      var material = String(row[5] || '').trim();
      var qty      = parseFloat(row[7]) || 0;
      var unit     = String(row[8] || 'Pcs');
      var decision = String(row[14] || '').toUpperCase();
      if (!docNo) continue;
      if (decision !== 'RELEASED' && decision !== 'ACCEPTED') continue;
      if (usedRefs[docNo]) continue;
      if (materialCode && material.toLowerCase().indexOf(materialCode.toLowerCase()) === -1 &&
          materialCode.toLowerCase().indexOf(material.toLowerCase()) === -1) continue;
      lots.push({ docNo: docNo, date: date, availableQty: qty, unit: unit });
    }

    // Sort oldest first (FIFO)
    lots.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

    var remaining = parseFloat(qtyRequested) || 0;
    var result = lots.map(function(lot, idx) {
      var suggested = Math.min(lot.availableQty, Math.max(0, remaining));
      remaining -= suggested;
      return {
        docNo:        lot.docNo,
        date:         lot.date instanceof Date ? Utilities.formatDate(lot.date, 'Asia/Kolkata', 'dd/MM/yyyy') : String(lot.date || ''),
        availableQty: lot.availableQty,
        unit:         lot.unit,
        suggestedQty: suggested,
        isOldest:     idx === 0
      };
    });

    var total = result.reduce(function(s, l) { return s + l.suggestedQty; }, 0);
    return { lots: result, total: total };
  } catch(e) {
    Logger.log(e);
    return { lots: [], total: 0, error: e.message };
  }
}

function getReleasedOQCsForGatepass() {
  try {
    var ss = getSpreadsheet();
    var oqcWs = ss.getSheetByName('OQC_LOG');
    if (!oqcWs || oqcWs.getLastRow() < 2) return [];

    var usedRefs = {};
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (gpWs && gpWs.getLastRow() > 1) {
      var gpData = gpWs.getRange(2, 4, gpWs.getLastRow() - 1, 1).getValues();
      gpData.forEach(function(r) { if (r[0]) usedRefs[String(r[0]).trim()] = true; });
    }

    var oqcData = ss.getSheetByName('OQC_LOG').getDataRange().getValues();
    var cutoff  = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    var results = [];

    for (var i = 1; i < oqcData.length; i++) {
      var row      = oqcData[i];
      var docNo    = String(row[0] || '').trim();
      var date     = row[1];
      var custName = String(row[3] || '');
      var batchPO  = String(row[4] || '');
      var material = String(row[5] || '');
      var decision = String(row[14] || '').toUpperCase();

      if (!docNo) continue;
      if (decision !== 'RELEASED' && decision !== 'ACCEPTED') continue;
      if (usedRefs[docNo]) continue;
      if (date && new Date(date) < cutoff) continue;

      var dateStr = date ? Utilities.formatDate(new Date(date), 'Asia/Kolkata', 'dd-MMM') : '';
      results.push({
        docNo:    docNo,
        label:    docNo + ' · ' + material + (batchPO ? ' · ' + batchPO : '') + (dateStr ? ' · ' + dateStr : ''),
        customer: custName,
        material: material,
        batchPO:  batchPO,
        date:     dateStr
      });
    }
    return results;
  } catch(e) {
    Logger.log(e);
    return [];
  }
}

function getGatewayRowForWA(row) {
  var ws = getSpreadsheet().getSheetByName('GATEPASS_LOG');
  if (!ws || row < 2) return null;
  var r = ws.getRange(row, 1, 1, 19).getValues()[0];
  if (!r[0]) return null;
  return {
    type:         'GATEPASS',
    docNo:        r[0],
    date:         r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
    dispatchType: r[2],
    oqcRef:       r[3],
    party:        r[4],
    materialCode: r[5],
    materialDesc: r[6],
    qty:          r[7],
    unit:         r[8],
    vehicleNo:    r[9],
    driverName:   r[10],
    transporter:  r[11],
    authorizedBy: r[12],
    status:       r[15] || 'ISSUED',
    createdBy:    r[16]
  };
}

// Backend OQC pass-gate. Throws if oqcRef is missing, not RELEASED/ACCEPTED, or already consumed.
// Schema matches getReleasedOQCsForGatepass(): OQC_LOG col A (0) = docNo, col O (14) = decision.
// GATEPASS_LOG col D (3) = OQC_REF.
function assertOQCReleasedForRef_(oqcRef, ssOpt) {
  if (!oqcRef) throw new Error('Outbound Gatepass requires an OQC reference.');
  var ss = ssOpt || getSpreadsheet();
  var oqcWs = ss.getSheetByName('OQC_LOG');
  if (!oqcWs) throw new Error('OQC_LOG sheet not found.');
  var ref = String(oqcRef).trim();

  var oqcData = oqcWs.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < oqcData.length; i++) {
    if (String(oqcData[i][0]).trim() === ref) {
      var decision = String(oqcData[i][14] || '').toUpperCase();
      if (decision !== 'RELEASED' && decision !== 'ACCEPTED') {
        throw new Error('Cannot dispatch — OQC ' + ref + ' has decision "' + (decision || 'PENDING') + '".');
      }
      found = true;
      break;
    }
  }
  if (!found) throw new Error('OQC reference ' + ref + ' not found in OQC_LOG.');

  // Replay guard — reject if this ref is already consumed by another gatepass.
  var gpWs = ss.getSheetByName('GATEPASS_LOG');
  if (gpWs && gpWs.getLastRow() > 1) {
    var used = gpWs.getRange(2, 4, gpWs.getLastRow() - 1, 1).getValues();
    for (var j = 0; j < used.length; j++) {
      if (String(used[j][0] || '').trim() === ref) {
        throw new Error('OQC ' + ref + ' has already been dispatched on a prior Gatepass.');
      }
    }
  }
  return true;
}
