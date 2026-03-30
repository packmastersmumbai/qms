// ============================================================
// Masters.gs — Server functions that return dropdown data
// Called by HTML forms via google.script.run
// ============================================================

function getSuppliers() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Suppliers');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0] && r[6] === 'Y'; })
    .map(function(r) { return { code: r[0], name: r[1], contact: r[2], phone: r[3], material: r[4] }; });
}

function getMaterials() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0]; })
    .map(function(r) { return { code: String(r[0]).trim(), desc: r[1], unit: r[2], category: r[3] }; });
}

function getCustomers() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Customers');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0]; })
    .map(function(r) { return { code: r[0], name: r[1], contact: r[2], phone: r[3], email: r[4] }; });
}

function getInspectors() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Personnel');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0]; })
    .map(function(r) { return { name: r[0], role: r[1], dept: r[2], phone: r[3] }; });
}

function getRecentGRNs() {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  if (data.length < 2) return [];

  // Map all rows, reverse to most-recent-first, then deduplicate by grnNo
  var mapped = data.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        grnNo:        r[0],
        date:         r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
        supplierName: r[3],   // renamed from 'supplier'
        material:     r[7],   // kept for dropdown label in IQC_F.html init()
        batch:        r[8],
        iqcStatus:    r[15] || 'PENDING'
      };
    })
    .reverse();

  // Deduplicate: keep first occurrence per grnNo in reversed (most-recent-first) order
  var seen = {};
  var deduped = [];
  mapped.forEach(function(g) {
    if (!seen[g.grnNo]) {
      seen[g.grnNo] = true;
      deduped.push(g);
    }
  });

  return deduped.slice(0, 30);
}

function getFormInitData() {
  return {
    suppliers:  getSuppliers(),
    materials:  getMaterials(),
    customers:  getCustomers(),
    inspectors: getInspectors(),
    aqlLevels:  ['AQL 0.65', 'AQL 1.0', 'AQL 2.5', 'AQL 4.0', 'AQL 6.5'],
    defaultAql: 'AQL 2.5'
  };
}
