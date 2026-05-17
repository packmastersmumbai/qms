// ============================================================
// NCR.gs — Non-Conformance Report lifecycle
// Auto-raised from IQC / IPQC / OQC reject paths.
// Disposition picked separately (default: PENDING_DISPOSITION until Prod Mgr acts).
// ============================================================

var NCR_DISPOSITIONS = [
  'rework-FG', 'rework-RM', 'scrap', 'use-as-is', 'supplier-return'
];

// Public entry point — called from IQC.js / IPQC.js / OQC.js on reject.
// Returns the new NCR docNo, or '' on failure (never throws into caller).
// Caller passes a flat object — no schema dependency between modules.
function raiseNCR_(payload) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('NCR_LOG');
    if (!ws) throw new Error('NCR_LOG sheet not found.');

    var docNo = getNextDocNumber('ncr');
    var now   = new Date();
    var user  = (function() { try { return Session.getActiveUser().getEmail() || 'QA'; } catch(e) { return 'QA'; } })();

    ws.appendRow([
      docNo,                                  // c1  NCR No
      payload.date ? new Date(payload.date) : now,  // c2  Date
      payload.source         || '',           // c3  Source (IQC/IPQC/OQC/Customer)
      payload.sourceRef      || '',           // c4  Source Ref (the IQC/IPQC/OQC docNo)
      payload.materialCode   || '',           // c5  Material Code
      payload.materialDesc   || '',           // c6  Material Desc
      payload.batchNo        || '',           // c7  Batch No
      payload.qtyAffected != null ? payload.qtyAffected : 0,  // c8  Qty Affected
      payload.unit           || '',           // c9  Unit
      payload.defectDesc     || '',           // c10 Defect Description
      'PENDING_DISPOSITION',                  // c11 Disposition (default per Lean UX decision)
      '',                                     // c12 Disposition By
      '',                                     // c13 Disposition At
      '',                                     // c14 CAPA Ref
      'OPEN',                                 // c15 Status
      user,                                   // c16 Created By
      now                                     // c17 Timestamp
    ]);

    var lastRow = ws.getLastRow();
    ws.getRange(lastRow, 2).setNumberFormat('dd-MMM-yyyy');
    ws.getRange(lastRow, 17).setNumberFormat('dd-MMM-yyyy HH:mm');
    ws.getRange(lastRow, 11).setBackground('#FFF3CD');  // amber — pending action

    return docNo;
  } catch(e) {
    Logger.log('raiseNCR_ failed: ' + e.message);
    return '';
  }
}

// Backwards-compat alias — plan doc and some skeleton code uses createNCR_.
function createNCR_(payload) { return raiseNCR_(payload); }

// Records inspector/manager disposition decision against an existing NCR.
function setNCRDisposition(ncrDocNo, disposition, dispositionBy) {
  if (NCR_DISPOSITIONS.indexOf(disposition) < 0) {
    return { success: false, error: 'Invalid disposition. Allowed: ' + NCR_DISPOSITIONS.join(', ') };
  }
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('NCR_LOG');
    if (!ws) throw new Error('NCR_LOG sheet not found.');
    var data = ws.getDataRange().getValues();
    var ref = String(ncrDocNo).trim();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === ref) {
        var row = i + 1;
        var fromStatus = String(data[i][14] || '').toUpperCase() || 'OPEN';
        var toStatus = disposition === 'use-as-is' ? 'CLOSED' : 'IN_PROGRESS';
        ws.getRange(row, 11).setValue(disposition).setBackground('#E8F5E9');
        ws.getRange(row, 12).setValue(dispositionBy || '');
        ws.getRange(row, 13).setValue(new Date()).setNumberFormat('dd-MMM-yyyy HH:mm');
        ws.getRange(row, 15).setValue(toStatus);
        logNCRHistory_(ref, fromStatus, toStatus, dispositionBy, 'Disposition: ' + disposition);
        return { success: true };
      }
    }
    return { success: false, error: 'NCR ' + ref + ' not found.' };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function getOpenNCRs() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('NCR_LOG');
  if (!ws || ws.getLastRow() < 2) return [];
  var data = ws.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var st = String(r[14] || '').toUpperCase();
    if (st === 'OPEN' || st === 'IN_PROGRESS') {
      out.push({
        docNo:        r[0],
        date:         r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Kolkata', 'dd-MMM-yyyy') : String(r[1] || ''),
        source:       r[2],
        sourceRef:    r[3],
        materialDesc: r[5],
        batchNo:      r[6],
        qtyAffected:  r[7],
        defectDesc:   r[9],
        disposition:  r[10],
        dispositionBy: r[11],
        dispositionAt: r[12] instanceof Date ? Utilities.formatDate(r[12], 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : String(r[12] || ''),
        capaRef:      r[13],
        status:       st
      });
    }
  }
  return out;
}

function getNCRDispositions() { return NCR_DISPOSITIONS.slice(); }

// ── NCR closure ──────────────────────────────────────────────
// Closes an NCR after effectiveness verification.
// payload: { capaRef, effectiveness ('PASS'|'FAIL'|'NOT_REQUIRED'), notes, closedBy }
// Pre-conditions: NCR must be IN_PROGRESS (i.e. disposition is set).
// Side effects: writes to NCR_LOG row + appends to NCR_HISTORY.
function closeNCR(ncrDocNo, payload) {
  payload = payload || {};
  if (['PASS','FAIL','NOT_REQUIRED'].indexOf(payload.effectiveness) < 0) {
    return { success: false, error: 'Invalid effectiveness. Must be PASS, FAIL, or NOT_REQUIRED.' };
  }
  if (payload.effectiveness === 'FAIL') {
    return { success: false, error: 'Effectiveness FAIL — do not close. Re-open CAPA cycle.' };
  }
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('NCR_LOG');
    if (!ws) throw new Error('NCR_LOG sheet not found.');
    ensureNCRClosureColumns_(ws);
    var data = ws.getDataRange().getValues();
    var ref = String(ncrDocNo).trim();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== ref) continue;
      var row = i + 1;
      var curStatus = String(data[i][14] || '').toUpperCase();
      if (curStatus === 'CLOSED') {
        return { success: false, error: 'NCR ' + ref + ' is already CLOSED.' };
      }
      if (curStatus !== 'IN_PROGRESS') {
        return { success: false, error: 'NCR ' + ref + ' is ' + curStatus + ' — set a disposition before closing.' };
      }
      var curDisp = String(data[i][10] || '').toUpperCase();
      if (!curDisp || curDisp === 'PENDING_DISPOSITION') {
        return { success: false, error: 'NCR ' + ref + ' has no disposition set.' };
      }
      var now = new Date();
      // CAPA Ref (col 14) — write if supplied (or leave existing)
      if (payload.capaRef) ws.getRange(row, 14).setValue(payload.capaRef);
      // Status (col 15)
      ws.getRange(row, 15).setValue('CLOSED').setBackground('#E8F5E9');
      // Closure columns (added by ensureNCRClosureColumns_)
      var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
      var iClosedBy = headers.indexOf('Closed By') + 1;
      var iClosedAt = headers.indexOf('Closed At') + 1;
      var iEffective = headers.indexOf('Effectiveness Check') + 1;
      var iCloseNotes = headers.indexOf('Closure Notes') + 1;
      if (iClosedBy)  ws.getRange(row, iClosedBy).setValue(payload.closedBy || '');
      if (iClosedAt)  ws.getRange(row, iClosedAt).setValue(now).setNumberFormat('dd-MMM-yyyy HH:mm');
      if (iEffective) ws.getRange(row, iEffective).setValue(payload.effectiveness);
      if (iCloseNotes && payload.notes) ws.getRange(row, iCloseNotes).setValue(payload.notes);

      logNCRHistory_(ref, curStatus, 'CLOSED', payload.closedBy, payload.notes || ('Effectiveness: ' + payload.effectiveness));
      return { success: true };
    }
    return { success: false, error: 'NCR ' + ref + ' not found.' };
  } catch(e) {
    Logger.log('closeNCR error: ' + e.message);
    return { success: false, error: e.message };
  }
}

function ensureNCRClosureColumns_(ws) {
  var headers = ws.getRange(1, 1, 1, Math.max(ws.getLastColumn(), 17)).getValues()[0];
  var wanted = ['Closed By', 'Closed At', 'Effectiveness Check', 'Closure Notes'];
  var lastCol = ws.getLastColumn();
  wanted.forEach(function(name) {
    if (headers.indexOf(name) < 0) {
      lastCol++;
      ws.getRange(1, lastCol).setValue(name).setFontWeight('bold');
    }
  });
}

function logNCRHistory_(docNo, fromStatus, toStatus, actor, notes) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('NCR_HISTORY');
    if (!ws) {
      ws = ss.insertSheet('NCR_HISTORY');
      ws.appendRow(['Timestamp', 'NCR No.', 'From Status', 'To Status', 'Actor', 'Notes']);
      ws.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1A237E').setFontColor('#FFFFFF');
      ws.setFrozenRows(1);
    }
    ws.appendRow([new Date(), docNo, fromStatus, toStatus, actor || '', notes || '']);
    ws.getRange(ws.getLastRow(), 1).setNumberFormat('dd-MMM-yyyy HH:mm:ss');
  } catch(e) {
    Logger.log('logNCRHistory_ error: ' + e.message);
  }
}

// One-shot smoke test — raises a synthetic NCR and reports back.
function testRaiseNCR() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui = SpreadsheetApp.getUi();
  var docNo = raiseNCR_({
    date:         new Date(),
    source:       'TEST',
    sourceRef:    'SMOKE-TEST',
    materialCode: 'TEST-MAT-001',
    materialDesc: 'Synthetic test material',
    batchNo:      'TEST-BATCH-' + Math.floor(Math.random() * 9999),
    qtyAffected:  42,
    unit:         'PC',
    defectDesc:   'Synthetic NCR — smoke test of raiseNCR_(). Delete this row when done.'
  });
  if (docNo) ui.alert('Test NCR raised', 'NCR ' + docNo + ' written to NCR_LOG.\n\nOpen the sheet to inspect, then delete the row.', ui.ButtonSet.OK);
  else       ui.alert('Test NCR FAILED', 'See Logger for error.', ui.ButtonSet.OK);
}
