// ============================================================
// Dashboard.gs — Aggregate data for the dashboard panel
// ============================================================

// Convert any GAS Date object → formatted string so google.script.run can serialize it
function sv_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Kolkata', 'dd-MMM-yyyy');
  return (v === undefined || v === null) ? '' : v;
}

function getDashboardData(filter) {
  try {
    filter = filter || {};
    var typeFilter = filter.type  || 'ALL';
    var dateFilter = filter.range || 'ALL';
    var ss = getSpreadsheet();
    if (!ss) {
      var storedId = '';
      try { storedId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || 'NOT SET'; } catch(ex) { storedId = 'read error'; }
      return { rows: null, error: 'SS NULL. ID=[' + storedId + ']', diag: { step: 'no-ss' } };
    }
    var grnRows  = getGRNRows_(ss, typeFilter, dateFilter);
    var iqcRows  = getIQCRows_(ss, typeFilter, dateFilter);
    var oqcRows  = getOQCRows_(ss, typeFilter, dateFilter);
    var gpRows   = getGPRows_(ss, typeFilter, dateFilter);
    var ipqcRows = getIPQCRows_(ss, typeFilter, dateFilter);
    var rows = [].concat(grnRows).concat(iqcRows).concat(oqcRows).concat(gpRows).concat(ipqcRows);
    rows.sort(function(a, b) { return (b.rawDate || 0) - (a.rawDate || 0); });
    return { rows: rows, counts: buildCounts_(rows) };
  } catch(e) {
    var msg = (e && (e.message || String(e))) || 'Unknown error';
    return { rows: null, error: msg, diag: { step: 'caught', err: msg } };
  }
}

function getGPRows_(ss, typeFilter, dateFilter) {
  if (typeFilter !== 'ALL' && typeFilter !== 'GP') return [];
  var ws = ss.getSheetByName('GATEPASS_LOG');
  if (!ws) return [];
  var lastRow = ws.getLastRow();
  if (lastRow < 2) return [];
  var data = ws.getRange(2, 1, lastRow - 1, 19).getValues();
  // Deduplicate multi-item gatepasses — one dashboard row per docNo
  var byDoc = {};
  var docOrder = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (!passesDateFilter_(r[1], dateFilter)) continue;
    var key = String(r[0]).trim();
    if (!byDoc[key]) {
      docOrder.push(key);
      byDoc[key] = {
        type: 'GP', docNo: sv_(r[0]), rawDate: r[1] ? new Date(r[1]).getTime() : 0,
        date: r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
        party: sv_(r[4]), material: sv_(r[6]), batch: sv_(r[2]),
        status: sv_(r[15]) || 'ISSUED', inspector: sv_(r[12]) || '',
        itemCount: 0,
        detail: {
          gpNo: sv_(r[0]), dispatchType: sv_(r[2]), oqcRef: sv_(r[3]),
          party: sv_(r[4]), materialCode: sv_(r[5]), materialDesc: sv_(r[6]),
          qty: sv_(r[7]), unit: sv_(r[8]), vehicleNo: sv_(r[9]),
          driverName: sv_(r[10]), transporter: sv_(r[11]),
          authorizedBy: sv_(r[12]), securityGuard: sv_(r[13]),
          remarks: sv_(r[14]), status: sv_(r[15]), dispatchZone: sv_(r[18])
        }
      };
    }
    byDoc[key].itemCount++;
  }
  var rows = [];
  docOrder.forEach(function(k) {
    var row = byDoc[k];
    if (row.itemCount > 1) row.material = row.material + ' (+' + (row.itemCount - 1) + ' more)';
    rows.push(row);
  });
  return rows;
}

function getGRNRows_(ss, typeFilter, dateFilter) {
  if (typeFilter !== 'ALL' && typeFilter !== 'GRN') return [];
  var ws = ss.getSheetByName('GRN_LOG');
  if (!ws) return [];
  var lastRow = ws.getLastRow();
  if (lastRow < 2) return [];
  var data = ws.getRange(2, 1, lastRow - 1, 19).getValues();
  // Deduplicate multi-item GRNs — one dashboard row per docNo
  var byDoc = {};
  var docOrder = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (!passesDateFilter_(r[1], dateFilter)) continue;
    var key = String(r[0]).trim();
    if (!byDoc[key]) {
      docOrder.push(key);
      byDoc[key] = {
        type: 'GRN', docNo: sv_(r[0]), rawDate: r[1] ? new Date(r[1]).getTime() : 0,
        date: r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
        party: sv_(r[3]), material: sv_(r[7]), batch: sv_(r[8]),
        status: sv_(r[15]) || 'PENDING', inspector: sv_(r[16]) || '',
        itemCount: 0,
        detail: {
          grnNo: sv_(r[0]), supplier: sv_(r[3]), poRef: sv_(r[4]), invoiceNo: sv_(r[5]),
          material: sv_(r[7]), batch: sv_(r[8]), unit: sv_(r[11]),
          qtyOrdered: sv_(r[9]), qtyReceived: sv_(r[10]),
          coa: sv_(r[12]), expiry: r[13] ? Utilities.formatDate(new Date(r[13]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
          remarks: sv_(r[14]), iqcStatus: sv_(r[15])
        }
      };
    }
    byDoc[key].itemCount++;
  }
  var rows = [];
  docOrder.forEach(function(k) {
    var row = byDoc[k];
    if (row.itemCount > 1) row.material = row.material + ' (+' + (row.itemCount - 1) + ' more)';
    rows.push(row);
  });
  return rows;
}

function getIQCRows_(ss, typeFilter, dateFilter) {
  if (typeFilter !== 'ALL' && typeFilter !== 'IQC') return [];
  var ws = ss.getSheetByName('IQC_LOG');
  if (!ws) return [];
  var lastRow = ws.getLastRow();
  if (lastRow < 2) return [];
  var data = ws.getRange(2, 1, lastRow - 1, 29).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (!passesDateFilter_(r[1], dateFilter)) continue;
    rows.push({
      type:     'IQC',
      docNo:    sv_(r[0]),
      rawDate:  r[1] ? new Date(r[1]).getTime() : 0,
      date:     r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
      party:    sv_(r[3]),
      material: sv_(r[4]),
      batch:    sv_(r[5]),
      status:   sv_(r[22]) || 'PENDING',
      inspector:sv_(r[6])  || '',
      detail: {
        iqcNo: sv_(r[0]), grnRef: sv_(r[2]), supplier: sv_(r[3]), material: sv_(r[4]),
        batch: sv_(r[5]), inspector: sv_(r[6]), aql: sv_(r[7]), sampleSize: sv_(r[8]),
        disposition: sv_(r[22]), ncrRef: sv_(r[23]), remarks: sv_(r[25]),
        acceptedQty: sv_(r[26]), rejectedQty: sv_(r[27]),
        params: {
          qty: sv_(r[10]), pkg: sv_(r[11]), colour: sv_(r[12]), shape: sv_(r[13]),
          dims: sv_(r[14]), weight: sv_(r[15]), clean: sv_(r[16]), odour: sv_(r[17]),
          label: sv_(r[18]), msds: sv_(r[19]), shelf: sv_(r[20]), coa: sv_(r[21])
        }
      }
    });
  }
  return rows;
}

function getOQCRows_(ss, typeFilter, dateFilter) {
  if (typeFilter !== 'ALL' && typeFilter !== 'OQC') return [];
  var ws = ss.getSheetByName('OQC_LOG');
  if (!ws) return [];
  var lastRow = ws.getLastRow();
  if (lastRow < 2) return [];
  var data = ws.getRange(2, 1, lastRow - 1, 20).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (!passesDateFilter_(r[1], dateFilter)) continue;
    rows.push({
      type:     'OQC',
      docNo:    sv_(r[0]),
      rawDate:  r[1] ? new Date(r[1]).getTime() : 0,
      date:     r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
      party:    sv_(r[3]),
      material: sv_(r[5]),
      batch:    sv_(r[4]),
      status:   sv_(r[14]) || 'PENDING',
      inspector:sv_(r[13]) || '',
      detail: {
        oqcNo: sv_(r[0]), customer: sv_(r[3]), batchPO: sv_(r[4]), material: sv_(r[5]),
        ipqcReviewed: sv_(r[6]), sampleSize: sv_(r[7]), inspector: sv_(r[13]),
        releaseDecision: sv_(r[14]), remarks: sv_(r[15]),
        ipqcSessionRef: sv_(r[19]),
        checks: {
          fillWeight: sv_(r[8]), label: sv_(r[9]), seal: sv_(r[10]),
          appearance: sv_(r[11]), custSpec: sv_(r[12])
        }
      }
    });
  }
  return rows;
}

function getIPQCRows_(ss, typeFilter, dateFilter) {
  if (typeFilter !== 'ALL' && typeFilter !== 'IPQC') return [];
  var ws = ss.getSheetByName('IPQC_Sessions');
  if (!ws) return [];
  var lastRow = ws.getLastRow();
  if (lastRow < 2) return [];
  var data = ws.getRange(2, 1, lastRow - 1, 11).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (!passesDateFilter_(r[6], dateFilter)) continue;
    rows.push({
      type:      'IPQC',
      docNo:     sv_(r[0]),
      rawDate:   r[6] ? new Date(r[6]).getTime() : 0,
      date:      r[6] ? Utilities.formatDate(new Date(r[6]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
      party:     sv_(r[2]),
      material:  sv_(r[1]),
      batch:     sv_(r[3]),
      status:    sv_(r[9]) || 'OPEN',
      inspector: sv_(r[4]) || '',
      detail: {
        sessionId:   sv_(r[0]),
        productCode: sv_(r[1]),
        productName: sv_(r[2]),
        batch:       sv_(r[3]),
        inspector:   sv_(r[4]),
        line:        sv_(r[5]),
        startTime:   sv_(r[7]),
        endTime:     sv_(r[8]),
        status:      sv_(r[9]) || 'OPEN',
        rounds:      sv_(r[10])
      }
    });
  }
  return rows;
}

function passesDateFilter_(dateVal, range) {
  if (range === 'ALL' || !dateVal) return true;
  var d = new Date(dateVal);
  var now = new Date();
  if (range === 'TODAY') {
    var dFmt   = Utilities.formatDate(d,   'Asia/Kolkata', 'yyyy-MM-dd');
    var nowFmt = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    return dFmt === nowFmt;
  }
  if (range === 'WEEK') {
    var weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    return d >= weekAgo;
  }
  if (range === 'MONTH') {
    var dFmt   = Utilities.formatDate(d,   'Asia/Kolkata', 'yyyy-MM');
    var nowFmt = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM');
    return dFmt === nowFmt;
  }
  return true;
}

function buildCounts_(rows) {
  var c = { total: rows.length, pass: 0, fail: 0, hold: 0, pending: 0 };
  rows.forEach(function(r) {
    var s = (r.status || '').toUpperCase();
    if (s === 'ACCEPTED' || s === 'RELEASED' || s === 'ISSUED') c.pass++;
    else if (s === 'REJECTED')                                  c.fail++;
    else if (s === 'HOLD')                                      c.hold++;
    else if (s === 'CLOSED')                                    c.pass++;
    else                                                        c.pending++;
  });
  return c;
}

