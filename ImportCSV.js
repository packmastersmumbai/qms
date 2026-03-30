// ============================================================
// ImportCSV.gs — Bulk import past GRN/IQC/OQC data from CSV
// CSV columns: Date, Doc No., Type (GRN/IQC/OQC), Supplier/Customer,
//              Material, Batch, Qty, Result/Disposition, Inspector, Remarks
// ============================================================

function importPastData(csvContent, docType) {
  try {
    var ss = getSpreadsheet();
    var lines = csvContent.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length < 2) return { success: false, error: 'CSV has no data rows.' };

    var imported = 0;
    var errors   = [];

    // Skip header row (row 0)
    for (var i = 1; i < lines.length; i++) {
      var cols = parseCSVLine_(lines[i]);
      try {
        if (docType === 'GRN') {
          importGRNRow_(ss, cols, i);
        } else if (docType === 'IQC') {
          importIQCRow_(ss, cols, i);
        } else if (docType === 'OQC') {
          importOQCRow_(ss, cols, i);
        }
        imported++;
      } catch(e) {
        errors.push('Row ' + (i + 1) + ': ' + e.message);
      }
    }

    return {
      success: true,
      imported: imported,
      errors: errors
    };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function importGRNRow_(ss, cols, rowNum) {
  var ws = ss.getSheetByName('GRN_LOG');
  if (!ws) throw new Error('GRN_LOG not found');
  // cols: Date, GRN No., Supplier, Material, Batch, Qty Ordered, Qty Received, COA, Remarks, IQC Status
  ws.appendRow([
    cols[1] || ('IMPORT-GRN-' + rowNum),  // GRN No.
    cols[0] ? new Date(cols[0]) : new Date(), // Date
    '',           // Supplier Code
    cols[2] || '', // Supplier Name
    '',           // PO Ref
    '',           // Invoice No
    '',           // Material Code
    cols[3] || '', // Material Desc
    cols[4] || '', // Batch
    cols[5] || '', // Qty Ordered
    cols[6] || '', // Qty Received
    '',           // Unit
    cols[7] || '', // COA
    '',           // Expiry
    cols[8] || '', // Remarks
    cols[9] || 'PENDING', // IQC Status
    'IMPORT',
    new Date()
  ]);
}

function importIQCRow_(ss, cols, rowNum) {
  var ws = ss.getSheetByName('IQC_LOG');
  if (!ws) throw new Error('IQC_LOG not found');
  // cols: Date, IQC No., GRN No., Supplier, Material, Batch, Inspector, Result/Disposition, Remarks
  ws.appendRow([
    cols[1] || ('IMPORT-IQC-' + rowNum),
    cols[0] ? new Date(cols[0]) : new Date(),
    cols[2] || '', // GRN No.
    cols[3] || '', // Supplier
    cols[4] || '', // Material
    cols[5] || '', // Batch
    cols[6] || '', // Inspector
    'AQL 2.5', '', '', // AQL, sample size, sample ID
    '','','','','','','','','','','','', // 12 params (blank for imported)
    cols[7] || 'PENDING', // Disposition
    '','',          // NCR ref, deviation ref
    cols[8] || '', // Remarks
    new Date()
  ]);
}

function importOQCRow_(ss, cols, rowNum) {
  var ws = ss.getSheetByName('OQC_LOG');
  if (!ws) throw new Error('OQC_LOG not found');
  // cols: Date, OQC No., Customer, Material, Batch/PO, Inspector, Decision, Remarks
  ws.appendRow([
    cols[1] || ('IMPORT-OQC-' + rowNum),
    cols[0] ? new Date(cols[0]) : new Date(),
    '',            // Customer Code
    cols[2] || '', // Customer Name
    cols[4] || '', // Batch/PO
    cols[3] || '', // Material
    'Y',           // IPQC Reviewed
    '',            // Sample Size
    '','','','','', // 5 checks (blank)
    cols[5] || '', // Inspector
    cols[6] || 'PENDING', // Release Decision
    cols[7] || '', // Remarks
    new Date()
  ]);
}

function parseCSVLine_(line) {
  var result = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}
