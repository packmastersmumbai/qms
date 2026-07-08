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

    // Telegram alert — NCR raised (covers IQC/OQC reject, IPQC OOS, customer return,
    // since all of those raise an NCR through this one chokepoint). Best-effort.
    try {
      var src  = String(payload.source || '').toUpperCase();
      var kind = src.indexOf('IQC') === 0 ? 'IQC_REJECT'
               : src.indexOf('OQC') === 0 ? 'OQC_REJECT'
               : src.indexOf('IPQC') === 0 ? 'IPQC_OOS'
               : src.indexOf('CUST') === 0 ? 'CUST_RETURN' : 'NCR';
      var detail = (payload.sourceRef ? 'Ref ' + payload.sourceRef + ' · ' : '') +
                   (payload.materialDesc || '') + (payload.defectDesc ? ' — ' + payload.defectDesc : '');
      sendQmsAlert(kind, docNo, detail);
    } catch (e) { Logger.log('QMS telegram alert skipped: ' + e.message); }

    // DWM next-action: NCR triage task (idempotent by NCR docNo). Best-effort.
    try {
      if (typeof pushDwmNextAction_ === 'function') {
        pushDwmNextAction_({
          type: 'NCR', docNo: docNo,
          material: payload.materialDesc || '',
          inspector: payload.raisedBy || payload.owner || '',
          status: 'REJECTED'   // routes to urgent triage in the next-action map
        });
      }
    } catch (e2) { Logger.log('QMS DWM push skipped: ' + e2.message); }

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
    var actor = (function() { try { return Session.getActiveUser().getEmail() || dispositionBy || ''; } catch(e) { return dispositionBy || ''; } })();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === ref) {
        var row = i + 1;
        var fromStatus = String(data[i][14] || '').toUpperCase() || 'OPEN';
        var toStatus = disposition === 'use-as-is' ? 'CLOSED' : 'IN_PROGRESS';
        ws.getRange(row, 11).setValue(disposition).setBackground('#E8F5E9');
        ws.getRange(row, 12).setValue(actor);
        ws.getRange(row, 13).setValue(new Date()).setNumberFormat('dd-MMM-yyyy HH:mm');
        ws.getRange(row, 15).setValue(toStatus);
        logNCRHistory_(ref, fromStatus, toStatus, actor, 'Disposition: ' + disposition);
        _logNCRRevision_(ref, actor, 'Disposition', String(data[i][10] || 'PENDING_DISPOSITION'), disposition);
        _logNCRRevision_(ref, actor, 'Status', fromStatus, toStatus);

        // Rework dispositions: move material to REWORK-AREA + create REWORK_LOG entry
        if (disposition === 'rework-FG' || disposition === 'rework-RM') {
          try {
            var ncrRow = data[i];
            var matCode  = String(ncrRow[4] || '').trim();
            var matDesc  = String(ncrRow[5] || '').trim();
            var batchNo  = String(ncrRow[6] || '').trim();
            var qty      = Number(ncrRow[7]) || 0;
            var unit     = String(ncrRow[8] || '').trim();
            var srcLoc   = disposition === 'rework-FG' ? 'FG-HOLD' : 'QUARANTINE';
            if (matCode && batchNo && qty > 0) {
              writeStockLedger_('NCR_REWORK_OUT', matCode, batchNo, srcLoc,
                0, qty, 'NCR', ref, actor, 'NCR ' + disposition + ' — to REWORK-AREA', matDesc);
              writeStockLedger_('NCR_REWORK_IN', matCode, batchNo, 'REWORK-AREA',
                qty, 0, 'NCR', ref, actor, 'NCR ' + disposition + ' — awaiting rework', matDesc);
              _createReworkLogEntry_(ref, 'NCR', ncrRow[2] || '', ncrRow[3] || '',
                matCode, matDesc, batchNo, qty, unit, actor,
                disposition === 'rework-FG' ? 'FG' : 'RM');
            }
          } catch(rwErr) {
            Logger.log('NCR rework ledger/log failed: ' + rwErr.message);
          }
        }

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

function getAllNCRs() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('NCR_LOG');
  if (!ws || ws.getLastRow() < 2) return [];
  // Resolve dynamic closure columns by header name (added by ensureNCRClosureColumns_)
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var iClosedBy   = headers.indexOf('Closed By');
  var iClosedAt   = headers.indexOf('Closed At');
  var iEffective  = headers.indexOf('Effectiveness Check');
  var iCloseNotes = headers.indexOf('Closure Notes');
  var iPhotos     = headers.indexOf('Photos');
  var TZ = 'Asia/Kolkata';
  function fmtDate(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'dd-MMM-yyyy') : String(v || ''); }
  function fmtDT(v)   { return v instanceof Date ? Utilities.formatDate(v, TZ, 'dd-MMM-yyyy HH:mm') : String(v || ''); }
  function colVal(row, idx) { return idx >= 0 ? row[idx] : ''; }

  var data = ws.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    var st = String(r[14] || '').toUpperCase() || 'OPEN';
    var photosRaw = colVal(r, iPhotos);
    var photos = [];
    if (photosRaw) {
      try { photos = JSON.parse(photosRaw); }
      catch(e) { photos = String(photosRaw).split('|').map(function(u){ return u.trim(); }).filter(Boolean); }
    }
    out.push({
      docNo:          r[0],
      date:           fmtDate(r[1]),
      source:         r[2],
      sourceRef:      r[3],
      materialDesc:   r[5],
      batchNo:        r[6],
      qtyAffected:    r[7],
      defectDesc:     r[9],
      disposition:    r[10],
      dispositionBy:  r[11],
      dispositionAt:  fmtDT(r[12]),
      capaRef:        r[13],
      status:         st,
      // Raised-by / raised-at come from createBy + timestamp columns
      raisedBy:       r[15] || '',
      raisedAt:       fmtDT(r[16]),
      // Closure fields (dynamic columns)
      closedBy:       colVal(r, iClosedBy),
      closedAt:       fmtDT(colVal(r, iClosedAt)),
      effectiveness:  colVal(r, iEffective),
      closureNotes:   colVal(r, iCloseNotes),
      photos:         photos
    });
  }
  return out;
}

// Append a photo (Drive URL) to an NCR row's Photos column.
// Returns { success, photos } so the UI can re-render thumbnails.
function appendNCRPhoto(ncrDocNo, photoUrl) {
  try {
    // Validate photoUrl must originate from Google Drive (prevents SSRF-style open redirect writes)
    if (!photoUrl || String(photoUrl).indexOf('https://drive.google.com/') !== 0) {
      return { success: false, error: 'photoUrl must be a https://drive.google.com/ URL.' };
    }
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('NCR_LOG');
    if (!ws) return { success: false, error: 'NCR_LOG sheet not found.' };
    // Ensure Photos column exists
    var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
    var iPhotos = headers.indexOf('Photos');
    if (iPhotos < 0) {
      var newCol = ws.getLastColumn() + 1;
      ws.getRange(1, newCol).setValue('Photos').setFontWeight('bold');
      iPhotos = newCol - 1;
    }
    var data = ws.getDataRange().getValues();
    var ref = String(ncrDocNo).trim();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== ref) continue;
      var existing = data[i][iPhotos];
      var arr = [];
      if (existing) {
        try { arr = JSON.parse(existing); }
        catch(e) { arr = String(existing).split('|').filter(Boolean); }
      }
      arr.push(photoUrl);
      ws.getRange(i + 1, iPhotos + 1).setValue(JSON.stringify(arr));
      return { success: true, photos: arr };
    }
    return { success: false, error: 'NCR ' + ref + ' not found.' };
  } catch(e) {
    Logger.log('appendNCRPhoto error: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Upload a base64-encoded image to Drive and attach to NCR.
// data: { ncrDocNo, base64, filename, mimeType }
var UPLOAD_NCR_PHOTO_MIME_ALLOWLIST_ = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
var UPLOAD_NCR_PHOTO_MAX_B64_LEN_    = 7000000;  // ~5 MB decoded

function uploadNCRPhoto(data) {
  try {
    data = data || {};
    if (!data.ncrDocNo || !data.base64) return { success: false, error: 'ncrDocNo and base64 required' };

    // 1. Enforce MIME allowlist (caller controls mimeType, so validate before use)
    var mime = String(data.mimeType || '').toLowerCase().trim();
    if (!mime || UPLOAD_NCR_PHOTO_MIME_ALLOWLIST_.indexOf(mime) < 0) {
      return { success: false, error: 'Invalid mimeType. Allowed: ' + UPLOAD_NCR_PHOTO_MIME_ALLOWLIST_.join(', ') };
    }

    // 2. Cap payload size before any decoding work
    if (String(data.base64).length > UPLOAD_NCR_PHOTO_MAX_B64_LEN_) {
      return { success: false, error: 'Image too large. Maximum ~5 MB.' };
    }

    // 3. Verify NCR row exists BEFORE decoding / creating the Drive file (fail fast)
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('NCR_LOG');
    if (!ws) return { success: false, error: 'NCR_LOG sheet not found.' };
    var ncrData = ws.getDataRange().getValues();
    var ref = String(data.ncrDocNo).trim();
    var ncrRowExists = false;
    for (var i = 1; i < ncrData.length; i++) {
      if (String(ncrData[i][0]).trim() === ref) { ncrRowExists = true; break; }
    }
    if (!ncrRowExists) return { success: false, error: 'NCR ' + ref + ' not found.' };

    var bytes = Utilities.base64Decode(data.base64);
    var blob  = Utilities.newBlob(bytes, mime, data.filename || ('ncr-' + Date.now() + '.jpg'));
    var folder = getOrCreateNCRPhotoFolder_();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
    return appendNCRPhoto(data.ncrDocNo, url);
  } catch(e) {
    Logger.log('uploadNCRPhoto error: ' + e.message);
    return { success: false, error: e.message };
  }
}

function getOrCreateNCRPhotoFolder_() {
  // <project>/QMS Data/NCR Photos — see QmsDrive.js
  return getQmsSubFolder_('NCR Photos');
}

// Append one row to REVISIONS_LOG. Never throws into caller.
function _logNCRRevision_(docNo, revisedBy, field, oldValue, newValue) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('REVISIONS_LOG');
    if (!ws) {
      ws = ss.insertSheet('REVISIONS_LOG');
      var hdrs = ['TYPE', 'DOC_NO', 'TIMESTAMP', 'REVISED_BY', 'FIELD', 'OLD_VALUE', 'NEW_VALUE'];
      ws.getRange(1, 1, 1, hdrs.length).setValues([hdrs]).setFontWeight('bold')
        .setBackground('#0D1B6E').setFontColor('#FFFFFF');
      ws.setFrozenRows(1);
    }
    ws.appendRow(['NCR', docNo, new Date(), revisedBy || '', field || '', oldValue || '', newValue || '']);
    ws.getRange(ws.getLastRow(), 3).setNumberFormat('dd-MMM-yyyy HH:mm');
  } catch(e) {
    Logger.log('_logNCRRevision_ failed: ' + e.message);
  }
}

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
      var actor = (function() { try { return Session.getActiveUser().getEmail() || payload.closedBy || ''; } catch(e) { return payload.closedBy || ''; } })();
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
      if (iClosedBy)  ws.getRange(row, iClosedBy).setValue(actor);
      if (iClosedAt)  ws.getRange(row, iClosedAt).setValue(now).setNumberFormat('dd-MMM-yyyy HH:mm');
      if (iEffective) ws.getRange(row, iEffective).setValue(payload.effectiveness);
      if (iCloseNotes && payload.notes) ws.getRange(row, iCloseNotes).setValue(payload.notes);

      logNCRHistory_(ref, curStatus, 'CLOSED', actor, payload.notes || ('Effectiveness: ' + payload.effectiveness));
      _logNCRRevision_(ref, actor, 'Status', curStatus, 'CLOSED');
      _logNCRRevision_(ref, actor, 'Effectiveness', '', payload.effectiveness);
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
