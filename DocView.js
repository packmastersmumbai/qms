// ============================================================
// DocView.gs — Document detail view, revision saving, history
// ============================================================

// Column definitions by type (0-indexed, matching sheet headers)
var DOC_FIELD_MAPS = {
  GRN: {
    sheetName: 'GRN_LOG',
    totalCols: 19,
    multiItem: true,
    itemHeaders: ['Material Code', 'Description', 'Batch No.', 'Qty Ordered', 'Qty Received', 'Unit', 'Expiry Date'],
    itemCols:    [6, 7, 8, 9, 10, 11, 13],
    fields: [
      { key: 'docNo',        label: 'GRN No.',       col: 0  },
      { key: 'date',         label: 'Date',          col: 1,  isDate: true },
      { key: 'supplierCode', label: 'Supplier Code', col: 2  },
      { key: 'supplierName', label: 'Supplier Name', col: 3  },
      { key: 'poRef',        label: 'PO Reference',  col: 4  },
      { key: 'invoiceNo',    label: 'Invoice No.',   col: 5  },
      { key: 'coaReceived',  label: 'COA Received',  col: 12 },
      { key: 'storageZone',  label: 'Storage Zone',  col: 18 },
      { key: 'remarks',      label: 'Remarks',       col: 14 },
      { key: 'iqcStatus',    label: 'IQC Status',    col: 15, isStatus: true },
      { key: 'createdBy',    label: 'Created By',    col: 16, readOnly: true },
      { key: 'createdAt',    label: 'Created At',    col: 17, isTimestamp: true, readOnly: true }
    ]
  },
  Gatepass: {
    sheetName: 'GATEPASS_LOG',
    totalCols: 19,
    multiItem: true,
    itemHeaders: ['Material Code', 'Description', 'Qty', 'Unit'],
    itemCols:    [5, 6, 7, 8],
    fields: [
      { key: 'docNo',         label: 'GP No.',          col: 0  },
      { key: 'date',          label: 'Date',            col: 1,  isDate: true },
      { key: 'type',          label: 'Type',            col: 2  },
      { key: 'oqcRef',        label: 'OQC Reference',   col: 3  },
      { key: 'party',         label: 'Party',           col: 4  },
      { key: 'vehicleNo',     label: 'Vehicle No.',     col: 9  },
      { key: 'driverName',    label: 'Driver Name',     col: 10 },
      { key: 'transporter',   label: 'Transporter',     col: 11 },
      { key: 'authorizedBy',  label: 'Authorized By',   col: 12 },
      { key: 'securityGuard', label: 'Security Guard',  col: 13 },
      { key: 'dispatchZone',  label: 'Dispatch Zone',   col: 18 },
      { key: 'remarks',       label: 'Remarks',         col: 14 },
      { key: 'status',        label: 'Status',          col: 15, isStatus: true },
      { key: 'createdBy',     label: 'Created By',      col: 16, readOnly: true },
      { key: 'createdAt',     label: 'Created At',      col: 17, isTimestamp: true, readOnly: true }
    ]
  },
  IQC: {
    sheetName: 'IQC_LOG',
    totalCols: 29,
    fields: [
      { key: 'docNo',        label: 'IQC No.',               col: 0  },
      { key: 'date',         label: 'Date',                  col: 1,  isDate: true },
      { key: 'grnNo',        label: 'GRN No.',               col: 2  },
      { key: 'supplierName', label: 'Supplier Name',         col: 3  },
      { key: 'materialDesc', label: 'Material Description',  col: 4  },
      { key: 'batchNo',      label: 'Batch No.',             col: 5  },
      { key: 'inspector',    label: 'Inspector',             col: 6  },
      { key: 'aqlLevel',     label: 'AQL Level',             col: 7  },
      { key: 'sampleSize',   label: 'Sample Size',           col: 8  },
      { key: 'sampleId',     label: 'Sample ID',             col: 9  },
      { key: 'p_qty',        label: '1 - Quantity',          col: 10, isParam: true },
      { key: 'p_pkg',        label: '2 - Packaging',         col: 11, isParam: true },
      { key: 'p_colour',     label: '3 - Colour',            col: 12, isParam: true },
      { key: 'p_shape',      label: '4 - Shape/Form',        col: 13, isParam: true },
      { key: 'p_dims',       label: '5 - Dimensions',        col: 14, isParam: true },
      { key: 'p_weight',     label: '6 - Net Weight',        col: 15, isParam: true },
      { key: 'p_clean',      label: '7 - Cleanliness',       col: 16, isParam: true },
      { key: 'p_odour',      label: '8 - Odour',             col: 17, isParam: true },
      { key: 'p_label',      label: '9 - Label Accuracy',    col: 18, isParam: true },
      { key: 'p_msds',       label: '10 - MSDS/SDS',         col: 19, isParam: true },
      { key: 'p_shelf',      label: '11 - Shelf Life',       col: 20, isParam: true },
      { key: 'p_coa',        label: '12 - COA/Test Report',  col: 21, isParam: true },
      { key: 'disposition',  label: 'Disposition',           col: 22, isStatus: true },
      { key: 'ncrRef',       label: 'NCR Ref',               col: 23 },
      { key: 'deviationRef', label: 'Deviation Ref',         col: 24 },
      { key: 'remarks',      label: 'Remarks',               col: 25 },
      { key: 'acceptedQty',  label: 'Accepted Qty',          col: 26 },
      { key: 'rejectedQty',  label: 'Rejected Qty',          col: 27, readOnly: true },
      { key: 'createdAt',    label: 'Created At',            col: 28, isTimestamp: true, readOnly: true }
    ]
  },
  OQC: {
    sheetName: 'OQC_LOG',
    totalCols: 19,
    fields: [
      { key: 'docNo',          label: 'OQC No.',              col: 0  },
      { key: 'date',           label: 'Date',                 col: 1,  isDate: true },
      { key: 'customerCode',   label: 'Customer Code',        col: 2  },
      { key: 'customerName',   label: 'Customer Name',        col: 3  },
      { key: 'batchPO',        label: 'Batch / PO',           col: 4  },
      { key: 'materialDesc',   label: 'Material Description', col: 5  },
      { key: 'ipqcReviewed',   label: 'IPQC Reviewed',        col: 6  },
      { key: 'sampleSize',     label: 'AQL Sample Size',      col: 7  },
      { key: 'c_fillWeight',   label: 'Fill Weight',          col: 8,  isParam: true },
      { key: 'c_label',        label: 'Label Accuracy',       col: 9,  isParam: true },
      { key: 'c_seal',         label: 'Seal Integrity',       col: 10, isParam: true },
      { key: 'c_appearance',   label: 'Appearance',           col: 11, isParam: true },
      { key: 'c_custSpec',     label: 'Customer Spec',        col: 12, isParam: true },
      { key: 'inspector',      label: 'Inspector',            col: 13 },
      { key: 'releaseDecision',label: 'Release Decision',     col: 14, isStatus: true },
      { key: 'remarks',        label: 'Remarks',              col: 15 },
      { key: 'acceptedQty',    label: 'Accepted Qty',         col: 16 },
      { key: 'rejectedQty',    label: 'Rejected Qty',         col: 17, readOnly: true },
      { key: 'createdAt',      label: 'Created At',           col: 18, isTimestamp: true, readOnly: true }
    ]
  }
};

var REVISIONS_LOG_HEADERS = [
  'TYPE', 'DOC_NO', 'TIMESTAMP', 'REVISED_BY', 'FIELD', 'OLD_VALUE', 'NEW_VALUE'
];

// ── HTML template launcher ────────────────────────────────────

function getDocViewHtml(type, docNo) {
  var tpl = HtmlService.createTemplateFromFile('DocView_F');
  tpl.type  = type;
  tpl.docNo = docNo;
  return tpl.evaluate().getContent();
}

// ── Get full record detail ────────────────────────────────────

function getRecordDetail(type, docNo) {
  try {
    var map = DOC_FIELD_MAPS[type];
    if (!map) throw new Error('Unknown document type: ' + type);

    var ss = getSpreadsheet();
    var ws = ss.getSheetByName(map.sheetName);
    if (!ws) throw new Error(map.sheetName + ' sheet not found.');

    var data = ws.getDataRange().getValues();
    var firstRow = null;
    var items = [];

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== String(docNo).trim()) continue;

      if (!firstRow) firstRow = data[i];

      // Collect line items for multi-item docs
      if (map.multiItem) {
        var item = {};
        map.itemHeaders.forEach(function(h, hi) {
          var val = data[i][map.itemCols[hi]];
          if (val instanceof Date && !isNaN(val)) {
            val = Utilities.formatDate(val, 'Asia/Kolkata', 'dd-MMM-yyyy');
          } else {
            val = (val !== null && val !== undefined) ? String(val) : '';
          }
          item[h] = val;
        });
        items.push(item);
      }
    }

    if (!firstRow) return { success: false, error: 'Record not found: ' + docNo };

    var record = {};
    map.fields.forEach(function(f) {
      var val = firstRow[f.col];
      if (f.isDate || f.isTimestamp) {
        if (val instanceof Date && !isNaN(val)) {
          val = f.isTimestamp
            ? Utilities.formatDate(val, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm')
            : Utilities.formatDate(val, 'Asia/Kolkata', 'dd-MMM-yyyy');
        } else {
          val = val ? String(val) : '';
        }
      } else {
        val = (val !== null && val !== undefined) ? String(val) : '';
      }
      record[f.key] = val;
    });

    var revCount = getRevisionCount_(type, docNo);
    var result = { success: true, record: record, revisionCount: revCount, fields: map.fields };
    if (map.multiItem) {
      result.items = items;
      result.itemHeaders = map.itemHeaders;
    }
    return result;
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// ── Revision history ─────────────────────────────────────────

function getRevisionHistory(type, docNo) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('REVISIONS_LOG');
    if (!ws || ws.getLastRow() < 2) return { success: true, revisions: [] };

    var data = ws.getDataRange().getValues();
    // Columns: TYPE(0) | DOC_NO(1) | TIMESTAMP(2) | REVISED_BY(3) | FIELD(4) | OLD_VALUE(5) | NEW_VALUE(6)
    var groups = {};

    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (String(r[0]).trim() !== type || String(r[1]).trim() !== String(docNo).trim()) continue;

      var ts = r[2] instanceof Date ? Utilities.formatDate(r[2], 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : String(r[2]);
      var key = ts + '||' + r[3];

      if (!groups[key]) {
        groups[key] = { timestamp: ts, revisedBy: String(r[3]), changes: [] };
      }
      groups[key].changes.push({
        field:    String(r[4]),
        oldValue: String(r[5]),
        newValue: String(r[6])
      });
    }

    // Sort newest first
    var revisions = Object.values(groups).sort(function(a, b) {
      return b.timestamp > a.timestamp ? 1 : -1;
    });

    return { success: true, revisions: revisions };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function getRevisionCount_(type, docNo) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('REVISIONS_LOG');
    if (!ws || ws.getLastRow() < 2) return 0;
    var data = ws.getDataRange().getValues();
    var tsSet = {};
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === type && String(data[i][1]).trim() === String(docNo).trim()) {
        var key = String(data[i][2]) + '||' + String(data[i][3]);
        tsSet[key] = true;
      }
    }
    return Object.keys(tsSet).length;
  } catch(e) {
    return 0;
  }
}

// ── Save revision ─────────────────────────────────────────────

function saveRevision(type, docNo, updatedData) {
  try {
    var map = DOC_FIELD_MAPS[type];
    if (!map) throw new Error('Unknown document type: ' + type);

    var ss   = getSpreadsheet();
    var ws   = ss.getSheetByName(map.sheetName);
    if (!ws) throw new Error(map.sheetName + ' not found.');

    var data = ws.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(docNo).trim()) {
        rowIdx = i;
        break;
      }
    }
    if (rowIdx === -1) throw new Error('Record not found: ' + docNo);

    var now  = new Date();
    var user = Session.getActiveUser().getEmail() || 'QA';

    // Ensure REVISIONS_LOG exists
    var revWs = ss.getSheetByName('REVISIONS_LOG');
    if (!revWs) {
      revWs = ss.insertSheet('REVISIONS_LOG');
      revWs.getRange(1, 1, 1, REVISIONS_LOG_HEADERS.length)
        .setValues([REVISIONS_LOG_HEADERS])
        .setBackground('#0D1B6E')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setFontFamily('Arial')
        .setFontSize(10)
        .setHorizontalAlignment('center');
      revWs.setFrozenRows(1);
      revWs.setTabColor('#FF9800');
      REVISIONS_LOG_HEADERS.forEach(function(_, i) { revWs.setColumnWidth(i + 1, 150); });
    }

    var currentRow  = data[rowIdx];
    var revisions   = [];
    var updatedRow  = currentRow.slice();

    map.fields.forEach(function(f) {
      if (f.readOnly) return;  // skip doc no, createdBy, createdAt
      if (!(f.key in updatedData)) return;

      var oldVal = currentRow[f.col];
      var oldStr = (oldVal instanceof Date && !isNaN(oldVal))
        ? Utilities.formatDate(oldVal, 'Asia/Kolkata', 'yyyy-MM-dd')
        : String(oldVal !== null && oldVal !== undefined ? oldVal : '');

      var newStr = String(updatedData[f.key] !== null && updatedData[f.key] !== undefined
        ? updatedData[f.key] : '');

      if (oldStr.trim() !== newStr.trim()) {
        revisions.push([type, docNo, now, user, f.label, oldStr, newStr]);
        // Write new value into updatedRow
        if (f.isDate) {
          updatedRow[f.col] = newStr ? new Date(newStr) : '';
        } else {
          updatedRow[f.col] = newStr;
        }
      }
    });

    if (revisions.length === 0) {
      return { success: true, message: 'No changes detected.' };
    }

    // Append revision rows
    revWs.getRange(revWs.getLastRow() + 1, 1, revisions.length, 7).setValues(revisions);
    // Format timestamp column
    var startRow = revWs.getLastRow() - revisions.length + 1;
    revWs.getRange(startRow, 3, revisions.length, 1).setNumberFormat('dd-MMM-yyyy HH:mm');

    // Update the record row (write all cols back)
    ws.getRange(rowIdx + 1, 1, 1, map.totalCols).setValues([updatedRow]);

    return { success: true, changesCount: revisions.length };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}
