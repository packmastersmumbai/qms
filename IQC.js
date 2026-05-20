// ============================================================
// IQC.gs — Save and read IQC records
// 12 inspection parameters from PM/FRM/IQC-02
// ============================================================

var IQC_PARAMS = [
  { id: 'qty',        label: 'Quantity',              spec: 'As per PO',           ccp: true  },
  { id: 'pkg',        label: 'Packaging Condition',   spec: 'Intact / Undamaged',  ccp: false },
  { id: 'colour',     label: 'Colour',                spec: 'Per approved sample', ccp: true  },
  { id: 'shape',      label: 'Shape / Form',          spec: 'Per specification',   ccp: false },
  { id: 'dims',       label: 'Size / Dimensions',     spec: 'Per spec sheet',      ccp: true  },
  { id: 'weight',     label: 'Net Weight',            spec: 'Per spec (calibrated balance)', ccp: true  },
  { id: 'clean',      label: 'Cleanliness',           spec: 'No contamination',    ccp: true  },
  { id: 'odour',      label: 'Odour',                 spec: 'Normal / None',       ccp: false },
  { id: 'label',      label: 'Label Accuracy',        spec: 'Matches PO / Spec',   ccp: false },
  { id: 'msds',       label: 'MSDS / SDS Available',  spec: 'Received',            ccp: false },
  { id: 'shelf',      label: 'Shelf Life / Expiry',   spec: 'Min 75% remaining',   ccp: true  },
  { id: 'coa',        label: 'COA / Test Report',     spec: 'Received & Verified', ccp: true  }
];

function getIQCFormInit() {
  return {
    docNumber:  peekNextDocNumber('iqc'),
    recentGRNs: getUnInspectedGRNs(),
    inspectors: getInspectors(),
    params:     IQC_PARAMS,
    aqlLevels:  ['AQL 0.65', 'AQL 1.0', 'AQL 2.5', 'AQL 4.0', 'AQL 6.5'],
    defaultAql: 'AQL 2.5',
    today:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

// Returns only GRNs that do NOT already have an IQC record linked to them
function getUnInspectedGRNs() {
  var ss = getSpreadsheet();

  // Collect GRN numbers that already have an IQC record (IQC_LOG col 3 = GRN No.)
  var inspectedSet = {};
  var iqcWs = ss.getSheetByName('IQC_LOG');
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iqcVals = iqcWs.getRange(2, 3, iqcWs.getLastRow() - 1, 1).getValues();
    iqcVals.forEach(function(r) {
      if (r[0]) inspectedSet[String(r[0]).trim()] = true;
    });
  }

  // Get all GRNs and filter out those already inspected
  var allGRNs = getRecentGRNs();
  return allGRNs.filter(function(g) {
    return !inspectedSet[String(g.grnNo).trim()];
  });
}

function saveIQC(data) {
  try {
    var ss  = getSpreadsheet();
    var ws  = ss.getSheetByName('IQC_LOG');
    if (!ws) throw new Error('IQC_LOG sheet not found. Run Setup first.');

    var now  = new Date();
    var disp = data.disposition || '';
    var operatorId = data.operatorName || '';

    // NCR is raised once for the whole rejected session (after rows are written),
    // and back-stamped into col 24 of every row in this batch. ncrRef can be
    // pre-supplied by caller to override; otherwise auto-raised on REJECTED.
    var ncrNo = data.ncrRef || '';

    var docNos = [];
    var ledgerWarning = '';

    // Capture the first data row we will write BEFORE the append loop.
    // This prevents the back-stamp (NCR ref in col 24) from landing on the
    // wrong rows when a concurrent insert happens between appendRow and
    // the post-loop getLastRow() recompute (Race 3 fix).
    var firstAppendRow = ws.getLastRow() + 1;

    data.items.forEach(function(item) {
      var docNo  = getNextDocNumber('iqc');
      var params = item.params || {};

      var row = [
        docNo,                          // col 1
        new Date(data.date),            // col 2
        data.grnNo,                     // col 3
        data.supplierName  || '',       // col 4
        item.materialDesc  || '',       // col 5
        item.batchNo       || '',       // col 6
        data.inspector     || '',       // col 7
        data.aqlLevel      || 'AQL 2.5', // col 8
        item.sampleSize != null ? item.sampleSize : 0,  // col 9
        data.sampleId      || '',       // col 10
        params.qty    || '',            // col 11
        params.pkg    || '',            // col 12
        params.colour || '',            // col 13
        params.shape  || '',            // col 14
        params.dims   || '',            // col 15
        params.weight || '',            // col 16
        params.clean  || '',            // col 17
        params.odour  || '',            // col 18
        params.label  || '',            // col 19
        params.msds   || '',            // col 20
        params.shelf  || '',            // col 21
        params.coa    || '',            // col 22
        disp,                           // col 23
        ncrNo,                          // col 24
        data.deviationRef  || '',       // col 25
        data.remarks       || '',       // col 26
        item.acceptedQty != null ? item.acceptedQty : 0,  // col 27
        item.rejectedQty != null ? item.rejectedQty : 0,  // col 28
        now,                            // col 29
        operatorId                      // col 30: operator_id — add this header manually in the sheet
      ];

      ws.appendRow(row);

      var lastRow = ws.getLastRow();
      ws.getRange(lastRow, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(lastRow, 29).setNumberFormat('dd-MMM-yyyy HH:mm');

      // Colour-code disposition cell (col 23)
      var dispCell = ws.getRange(lastRow, 23);
      if      (disp === 'ACCEPTED')               dispCell.setBackground('#E8F5E9');
      else if (disp === 'REJECTED')               dispCell.setBackground('#FFEBEE');
      else if (disp === 'HOLD')                   dispCell.setBackground('#FFF3CD');
      else if (disp === 'ACCEPTED WITH DEVIATION') dispCell.setBackground('#FFE0B2');

      // STOCK_LEDGER mirror: on REJECT, transfer rejected qty from GRN location → QUARANTINE.
      // ACCEPT writes a zero-qty status marker so the ledger shows the IQC pass event.
      if (typeof writeStockLedger_ === 'function') {
        try {
          var grnLoc = '';
          var grnWs2 = ss.getSheetByName('GRN_LOG');
          if (grnWs2 && grnWs2.getLastRow() > 1 && data.grnNo) {
            var grnData = grnWs2.getDataRange().getValues();
            for (var gi = 1; gi < grnData.length; gi++) {
              if (String(grnData[gi][0]).trim() === String(data.grnNo).trim() &&
                  String(grnData[gi][8]).trim() === String(item.batchNo || '').trim()) {
                grnLoc = String(grnData[gi][20] || '').trim();  // col 21 = Location ID
                break;
              }
            }
          }
          var matCode = item.materialCode || '';
          var rejQty  = Number(item.rejectedQty) || 0;

          if (disp === 'ACCEPTED' || disp === 'ACCEPTED WITH DEVIATION') {
            if (grnLoc && matCode && item.batchNo) {
              writeStockLedger_('IQC_ACCEPT', matCode, item.batchNo, grnLoc,
                0, 0, 'IQC', docNo, data.inspector || '',
                'IQC passed — stock available for issuance');
            }
          } else if (disp === 'REJECTED' && rejQty > 0 && grnLoc && matCode && item.batchNo) {
            var qLocs = (typeof getLocations === 'function') ? getLocations('QUARANTINE') : [];
            var quarId = qLocs.length > 0 ? qLocs[0].id : 'QUARANTINE';
            writeStockLedger_('IQC_REJECT_OUT', matCode, item.batchNo, grnLoc,
              0, rejQty, 'IQC', docNo, data.inspector || '',
              'IQC reject — moved to ' + quarId);
            writeStockLedger_('IQC_REJECT_QUARANTINE', matCode, item.batchNo, quarId,
              rejQty, 0, 'IQC', docNo, data.inspector || '',
              'IQC reject — quarantined pending NCR disposition');
          }
        } catch(ledgerErr) {
          Logger.log('IQC ledger mirror failed: ' + ledgerErr.message);
          // IQC row is already written — partial-commit → save-with-warning.
          if (!ledgerWarning) {
            ledgerWarning = 'Document saved but stock ledger update failed — contact admin.';
          }
        }
      }

      docNos.push(docNo);
    });

    var warnings = [];
    if (ledgerWarning) warnings.push(ledgerWarning);

    // Update GRN status once, after all rows are written
    if (data.grnNo) updateGRNIQCStatus(data.grnNo, disp || 'PENDING');

    // Auto-raise NCR for rejected sessions, then back-stamp col 24 (NCR Ref) on every row of this batch.
    var ncrError = '';
    if (disp === 'REJECTED' && !ncrNo && docNos.length > 0) {
      var firstItem = data.items[0] || {};
      ncrNo = raiseNCR_({
        date:         data.date,
        source:       'IQC',
        sourceRef:    docNos.join(', '),
        materialCode: firstItem.materialCode || '',
        materialDesc: firstItem.materialDesc || '',
        batchNo:      firstItem.batchNo || '',
        qtyAffected:  data.items.reduce(function(s, it) { return s + (Number(it.rejectedQty) || 0); }, 0),
        unit:         firstItem.unit || '',
        defectDesc:   data.remarks || 'IQC rejection — see ' + docNos.join(', ')
      });
      if (ncrNo) {
        // Use the pre-loop captured index — not a post-loop getLastRow() recompute —
        // so a concurrent insert cannot cause the back-stamp to hit the wrong rows.
        ws.getRange(firstAppendRow, 24, docNos.length, 1).setValue(ncrNo);
      } else {
        ncrError = 'NCR auto-raise FAILED — raise the NCR manually and update the IQC record.';
        warnings.push(ncrError);
      }
    }

    return { success: true, docNos: docNos, ncrNo: ncrNo, ncrError: ncrError, warnings: warnings };

  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function getIQCRowForWA(row) {
  var ws = getSpreadsheet().getSheetByName('IQC_LOG');
  if (!ws || row < 2) return null;
  var r = ws.getRange(row, 1, 1, 29).getValues()[0];
  if (!r[0]) return null;
  return {
    type:       'IQC',
    docNo:      r[0],
    date:       r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
    grnNo:      r[2],
    supplier:   r[3],
    material:   r[4],
    batch:      r[5],
    inspector:  r[6],
    disposition:r[22],
    ncrRef:     r[23]
  };
}

// Returns all GRN_LOG line items for a given GRN doc number
// Used by IQC_F.html to build matrix columns after GRN selection
function getGRNItems(grnNo) {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(grnNo).trim()) {
      items.push({
        materialCode: String(data[i][6] || ''),   // col 7
        materialDesc: String(data[i][7] || ''),   // col 8
        batchNo:      String(data[i][8] || ''),   // col 9
        qtyOrdered:   Number(data[i][9])  || 0,   // col 10
        qtyReceived:  Number(data[i][10]) || 0,   // col 11
        unit:         String(data[i][11] || '')   // col 12
      });
    }
  }
  return items;
}
