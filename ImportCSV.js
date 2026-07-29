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
        } else if (docType === 'SUPPLIER') {
          importSupplierRow_(cols, i);
        } else if (docType === 'CUSTOMER') {
          importCustomerRow_(cols, i);
        } else if (docType === 'MATERIAL') {
          importMaterialRow_(cols, i);
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

// ── Master imports (upsert by code — re-import updates, never duplicates) ──────
// Shared upsert: find a row by its code column; overwrite if found, else append.
function _upsertMasterByCode_(ss, sheetName, codeCol, row) {
  var ws = ss.getSheetByName(sheetName);
  if (!ws) throw new Error(sheetName + ' not found');
  var code = String(row[codeCol] || '').trim();
  if (!code) throw new Error('code (col ' + (codeCol + 1) + ') is required');
  var last = ws.getLastRow();
  if (last >= 2) {
    var codes = ws.getRange(2, codeCol + 1, last - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0] || '').trim() === code) {
        ws.getRange(i + 2, 1, 1, row.length).setValues([row]);   // update in place
        return;
      }
    }
  }
  ws.appendRow(row);                                              // new → append
}

// MASTERS_Suppliers live cols (A→H): Code, Name, Contact, Phone, Material Supplied,
// City / Location, Approved (Y/N), State Code. There is NO Email column — the old
// mapping assumed one at E and shifted Approved into State Code.
function importSupplierRow_(cols, rowNum) {
  _upsertMasterByCode_(getSpreadsheet(), 'MASTERS_Suppliers', 0, [
    cols[0] || ('SUP-' + rowNum), cols[1] || '', cols[2] || '', cols[3] || '',
    cols[4] || '', cols[5] || '', (cols[6] || 'Y'), cols[7] || ''
  ]);
}

// MASTERS_Customers cols: Code, Name, Contact, Phone, Email, Products Supplied, City
function importCustomerRow_(cols, rowNum) {
  _upsertMasterByCode_(getSpreadsheet(), 'MASTERS_Customers', 0, [
    cols[0] || ('CUST-' + rowNum), cols[1] || '', cols[2] || '', cols[3] || '',
    cols[4] || '', cols[5] || '', cols[6] || ''
  ]);
}

// MASTERS_Materials cols: Code, Desc, Unit, Category, DefaultLocation, ReorderLevel (F),
// geometry G→L left blank on import (set later via the material form). Upsert preserves
// any existing geometry by only writing A–F when the row already carries more columns.
function importMaterialRow_(cols, rowNum) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) throw new Error('MASTERS_Materials not found');
  var code = String(cols[0] || '').trim();
  if (!code) throw new Error('material code (col 1) is required');
  var af = [cols[0], cols[1] || '', cols[2] || '', cols[3] || '', cols[4] || '',
            (cols[5] !== undefined && cols[5] !== '' ? cols[5] : '')];  // A–F
  var last = ws.getLastRow();
  if (last >= 2) {
    var codes = ws.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0] || '').trim() === code) {
        ws.getRange(i + 2, 1, 1, af.length).setValues([af]);   // update A–F, keep G→L geometry
        return;
      }
    }
  }
  ws.appendRow(af.concat(['','','','','','']));                 // new → 12-col row, geometry blank
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
