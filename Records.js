// ============================================================
// Records.gs — Records list + counts
// Pack Masters QMS | Google Apps Script
// ============================================================

// Sheet name mapping
var SHEET_MAP = {
  GRN:            'GRN_LOG',
  IQC:            'IQC_LOG',
  OQC:            'OQC_LOG',
  Gatepass:       'GATEPASS_LOG',
  IPQC:           'IPQC_Sessions',
  NCR:            'NCR_LOG',
  CustomerReturn: 'CUSTOMER_RETURN_LOG'
};

// Column indices (1-based) per sheet type
// GRN_LOG:      col1=docNo, col2=date, col4=supplierName, col16=status
// IQC_LOG:      col1=docNo, col2=date, col3=grnNo, col4=materialDesc, last=result
// OQC_LOG:      col1=docNo, col2=date, col3=customerName, last=result
// GATEPASS_LOG: col1=docNo, col2=date, col3=customerName, last=status

/**
 * Returns an array of record objects for the given type.
 * @param {string} type - 'GRN' | 'IQC' | 'OQC' | 'Gatepass'
 * @param {Object} filters - { fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD', search: '' }
 * @returns {Array} [ { docNo, date, name, status }, … ] newest-first, max 200
 */
function getRecordsList(type, filters) {
  var cacheKey = 'pmqms_records_list_' + type + '_' + JSON.stringify(filters || {}).substring(0, 200);
  var cached = _pmCacheGet_(cacheKey);
  if (cached) return cached;
  var result = _computeRecordsList_(type, filters);
  _pmCachePut_(cacheKey, result);
  return result;
}

function _computeRecordsList_(type, filters) {
  // ALL: merge across logs newest-first
  if (type === 'ALL') return _getRecordsAll(filters);

  var sheetName = SHEET_MAP[type];
  if (!sheetName) return [];

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];

  // Read all data in one call (skip row 1 header)
  var startRow = 2;
  var numRows  = lastRow - startRow + 1;
  if (numRows <= 0) return [];

  var data = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  // Parse filters
  var fromDate = null, toDate = null, search = '';
  if (filters) {
    if (filters.fromDate) fromDate = new Date(filters.fromDate + 'T00:00:00');
    if (filters.toDate)   toDate   = new Date(filters.toDate   + 'T23:59:59');
    if (filters.search)   search   = String(filters.search).toLowerCase().trim();
  }

  var results = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    // Skip empty rows
    var docNo = row[0] ? String(row[0]).trim() : '';
    if (!docNo) continue;

    // Parse date (column 2, index 1)
    var rawDate = row[1];
    var rowDate = rawDate ? (rawDate instanceof Date ? rawDate : new Date(rawDate)) : null;

    // Date range filter
    if (fromDate && rowDate && rowDate < fromDate) continue;
    if (toDate   && rowDate && rowDate > toDate)   continue;

    // Build name and status depending on type
    var name   = '';
    var status = '';

    if (type === 'GRN') {
      name   = row[3]       ? String(row[3]).trim()       : '';       // col4 supplierName
      // col16 = IQC disposition; bare 'PENDING'/blank means IQC not yet done.
      // Show 'IQC Pending' so it isn't read as an ambiguous workflow state.
      status = row[15]      ? String(row[15]).trim()      : 'PENDING'; // col16 status
      if (status.toUpperCase() === 'PENDING') status = 'IQC Pending';
    } else if (type === 'IQC') {
      var grnNo      = row[2] ? String(row[2]).trim() : '';           // col3
      var materialDesc = row[3] ? String(row[3]).trim() : '';         // col4
      name = grnNo && materialDesc ? grnNo + ' · ' + materialDesc
           : grnNo || materialDesc;
      status = row[lastCol - 1] ? String(row[lastCol - 1]).trim() : 'PENDING'; // last col
    } else if (type === 'OQC') {
      name   = row[2]        ? String(row[2]).trim()       : '';      // col3 customerName
      status = row[lastCol - 1] ? String(row[lastCol - 1]).trim() : 'PENDING';
    } else if (type === 'Gatepass') {
      var gpType = row[2] ? String(row[2]).trim() : '';              // col3: dispatch type (IN/OUT…)
      var gpParty = row[4] ? String(row[4]).trim() : '';             // col5: party name
      name   = gpType && gpParty ? gpType + ' · ' + gpParty : gpType || gpParty;
      status = row[15] ? String(row[15]).trim() : 'ISSUED';          // col16: status
    } else if (type === 'IPQC') {
      var productName = row[2] ? String(row[2]).trim() : '';
      var batchVal    = row[3] ? String(row[3]).trim() : '';
      name   = productName && batchVal ? productName + ' · Batch ' + batchVal : productName || batchVal;
      status = row[9] ? String(row[9]).trim() : 'OPEN';              // col10 = status
    } else if (type === 'NCR') {
      // NCR_LOG cols: 0 docNo · 1 date · 2 source · 5 materialDesc · 6 batchNo · 10 disposition · 14 status
      var ncrSrc   = row[2] ? String(row[2]).trim() : '';
      var ncrMat   = row[5] ? String(row[5]).trim() : '';
      var ncrBatch = row[6] ? String(row[6]).trim() : '';
      name   = ncrSrc + (ncrMat ? ' · ' + ncrMat : '') + (ncrBatch ? ' · ' + ncrBatch : '');
      status = row[14] ? String(row[14]).trim() : 'OPEN';
    } else if (type === 'CustomerReturn') {
      // CUSTOMER_RETURN_LOG cols: 0 rtnNo · 1 date · 3 custName · 6 productDesc · 7 fgBatch · 13 disposition · 15 status
      var crCust = row[3] ? String(row[3]).trim() : '';
      var crProd = row[6] ? String(row[6]).trim() : '';
      name   = crCust + (crProd ? ' · ' + crProd : '');
      status = row[15] ? String(row[15]).trim() : 'OPEN';
    }

    // Search filter (docNo or name)
    if (search) {
      var haystack = (docNo + ' ' + name).toLowerCase();
      if (haystack.indexOf(search) === -1) continue;
    }

    results.push({
      docNo:  docNo,
      date:   rowDate ? formatDate(rowDate) : (rawDate ? String(rawDate) : ''),
      name:   name,
      status: status || 'PENDING'
    });
  }

  // Deduplicate GRN and Gatepass by docNo (multi-item = multiple rows per doc)
  if (type === 'GRN' || type === 'Gatepass') {
    var itemCounts = {};
    results.forEach(function(r) { itemCounts[r.docNo] = (itemCounts[r.docNo] || 0) + 1; });
    var seen = {};
    var deduped = [];
    results.forEach(function(r) {
      if (!seen[r.docNo]) {
        seen[r.docNo] = true;
        if (itemCounts[r.docNo] > 1) {
          r.name = r.name + ' (' + itemCounts[r.docNo] + ' items)';
        }
        deduped.push(r);
      }
    });
    results = deduped;
  }

  // Reverse to get newest-first (assumes data is oldest-first in sheet)
  results.reverse();

  // Cap at 200
  if (results.length > 200) results = results.slice(0, 200);

  return results;
}


/**
 * ALL-type aggregator: pulls last N rows from each log, merges newest-first.
 * Tagged with `type` so the UI can render colored badges.
 */
function _getRecordsAll(filters) {
  var types = ['GRN', 'IQC', 'IPQC', 'OQC', 'Gatepass', 'NCR', 'CustomerReturn'];
  var combined = [];
  types.forEach(function(t) {
    try {
      var rows = getRecordsList(t, filters) || [];
      rows.forEach(function(r) { r.type = t; combined.push(r); });
    } catch(e) { Logger.log('_getRecordsAll ' + t + ': ' + e); }
  });
  // Sort newest-first by date (string compare on dd-MMM-yyyy is wrong; parse instead)
  combined.sort(function(a, b) {
    var da = new Date(a.date || 0).getTime();
    var db = new Date(b.date || 0).getTime();
    return db - da;
  });
  if (combined.length > 200) combined = combined.slice(0, 200);
  return combined;
}

/**
 * Returns counts of records in each log sheet.
 * @returns {{ grn: number, iqc: number, oqc: number, gp: number, ipqc: number }}
 */
function getRecordsCounts() {
  var cached = _pmCacheGet_('pmqms_records_counts_v1');
  if (cached) return cached;
  var result = _computeRecordsCounts_();
  _pmCachePut_('pmqms_records_counts_v1', result);
  return result;
}

function _computeRecordsCounts_() {
  // Switched to PENDING counts (matches Landing tile semantics).
  // Total record counts retained as `.total*` for any caller that needs them.
  var ss = getSpreadsheet();
  var pending = {};
  try {
    pending = computePendingCounts_(ss);
  } catch(e) { Logger.log('Pending count error: ' + e); }
  return {
    grn:  pending.GRN  || 0,
    iqc:  pending.IQC  || 0,
    oqc:  pending.OQC  || 0,
    gp:   pending.Gatepass || 0,
    ipqc: pending.IPQC || 0,
    totalGrn:  _countRows(ss, 'GRN_LOG'),
    totalIqc:  _countRows(ss, 'IQC_LOG'),
    totalOqc:  _countRows(ss, 'OQC_LOG'),
    totalGp:   _countRows(ss, 'GATEPASS_LOG'),
    totalIpqc: _countRows(ss, 'IPQC_Sessions')
  };
}

/**
 * Count unique documents in a sheet.
 * For multi-item sheets (GRN_LOG, GATEPASS_LOG), counts unique docNos.
 * For others, counts total rows.
 */
function _countRows(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 0;
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  // GRN_LOG and GATEPASS_LOG store one row per item — count unique docNos
  if (sheetName === 'GRN_LOG' || sheetName === 'GATEPASS_LOG') {
    var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
    var seen = {};
    vals.forEach(function(r) { if (r[0]) seen[String(r[0]).trim()] = true; });
    return Object.keys(seen).length;
  }
  return last - 1;
}


/**
 * Format a Date object as dd-MMM-yyyy (e.g. 14-Mar-2026).
 */
function formatDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  var months = ['Jan','Feb','Mar','Apr','May','Jun',
                'Jul','Aug','Sep','Oct','Nov','Dec'];
  var dd   = String(d.getDate()).padStart(2, '0');
  var mmm  = months[d.getMonth()];
  var yyyy = d.getFullYear();
  return dd + '-' + mmm + '-' + yyyy;
}

