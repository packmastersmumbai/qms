// ============================================================
// MastersCrud.gs — Tabbed CRUD for MASTERS_* sheets
// Phase 3 of Landing v2 redesign
// Gated by Owner mode (verifyOwnerPin / pm.ui.ownerMode)
// ============================================================

// Schema: name → { sheet, codeCol(0-idx), columns:[{key, label, type}] }
// type: 'text' | 'num' | 'enum:Y/N' | 'longtext'
var MASTERS_SCHEMA_ = {
  Suppliers: {
    sheet: 'MASTERS_Suppliers',
    codeCol: 0,
    // Column order MUST match the real MASTERS_Suppliers sheet headers
    // (see Initialize.js createMasterSheet_): Supplier Code, Supplier Name,
    // Contact Person, Phone / WhatsApp, Material Supplied, City / Location,
    // Approved (Y/N), State Code.
    columns: [
      { key:'code',      label:'Code',       type:'text' },
      { key:'name',      label:'Name',       type:'text' },
      { key:'contact',   label:'Contact',    type:'text' },
      { key:'phone',     label:'Phone',      type:'text' },
      { key:'material',  label:'Material',   type:'text' },
      { key:'city',      label:'City',       type:'text' },
      { key:'approved',  label:'Approved',   type:'enum:Y/N' },
      { key:'stateCode', label:'State Code', type:'text' }
    ]
  },
  Materials: {
    sheet: 'MASTERS_Materials',
    codeCol: 0,
    columns: [
      { key:'code',            label:'Code',             type:'text' },
      { key:'desc',            label:'Description',      type:'text' },
      { key:'unit',            label:'Unit',             type:'text' },
      { key:'category',        label:'Category',         type:'text' },
      { key:'defaultLocation', label:'Default Location', type:'text' }
    ]
  },
  Customers: {
    sheet: 'MASTERS_Customers',
    codeCol: 0,
    columns: [
      { key:'code',     label:'Code',     type:'text' },
      { key:'name',     label:'Name',     type:'text' },
      { key:'contact',  label:'Contact',  type:'text' },
      { key:'phone',    label:'Phone',    type:'text' },
      { key:'email',    label:'Email',    type:'text' },
      { key:'products', label:'Products', type:'text' },
      { key:'city',     label:'City',     type:'text' }
    ]
  },
  Personnel: {
    sheet: 'MASTERS_Personnel',
    codeCol: 0,
    columns: [
      { key:'name',   label:'Name',   type:'text' },
      { key:'role',   label:'Role',   type:'text' },
      { key:'dept',   label:'Dept',   type:'text' },
      { key:'phone',  label:'Phone',  type:'text' },
      { key:'notify', label:'Notify', type:'enum:Y/N' }
    ]
  },
  Parameters: {
    sheet: 'MASTERS_Parameters',
    codeCol: 0,
    columns: [
      { key:'code',        label:'Code',        type:'text' },
      { key:'name',        label:'Name',        type:'text' },
      { key:'unit',        label:'Unit',        type:'text' },
      { key:'std_value',   label:'Std Value',   type:'text' },
      { key:'tol_min',     label:'Tol Min',     type:'text' },
      { key:'tol_max',     label:'Tol Max',     type:'text' },
      { key:'method_type', label:'Method',      type:'text' },
      { key:'check_brief', label:'Check Brief', type:'longtext' },
      { key:'tools',       label:'Tools',       type:'text' },
      { key:'doc_ref',     label:'Doc Ref',     type:'text' },
      { key:'doc_number',  label:'Doc Number',  type:'text' }
    ]
  }
};

var MASTERS_AUDIT_COLS_ = ['LastModified', 'ModifiedBy'];

function getMastersSchema() {
  // Strip server-only sheet name from response
  var out = {};
  Object.keys(MASTERS_SCHEMA_).forEach(function(n){
    out[n] = { columns: MASTERS_SCHEMA_[n].columns };
  });
  return out;
}

function _mastersRequireOwner_() {
  var on = String(PropertiesService.getScriptProperties().getProperty('pm.ui.ownerMode') || 'false') === 'true';
  if (!on) throw new Error('Owner mode required');
}

function _mastersEnsureAudit_(ws) {
  if (!ws) return;
  var lastCol = ws.getLastColumn();
  if (lastCol < 1) return;
  var hdr = ws.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h){ return String(h||'').trim(); });
  var addAt = lastCol + 1;
  MASTERS_AUDIT_COLS_.forEach(function(name){
    if (hdr.indexOf(name) < 0) {
      ws.getRange(1, addAt).setValue(name).setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
      addAt++;
    }
  });
}

function _mastersOperator_() {
  try { return Session.getActiveUser().getEmail() || 'QA'; } catch(e) { return 'QA'; }
}

// Public: returns table data for one master sheet.
function getMastersTable(name) {
  try {
    var s = MASTERS_SCHEMA_[name];
    if (!s) return { ok:false, error:'unknown master: ' + name };
    var ws = getSpreadsheet().getSheetByName(s.sheet);
    if (!ws) return { ok:true, name:name, columns:s.columns, rows:[] };
    _mastersEnsureAudit_(ws);
    var data = ws.getDataRange().getValues();
    if (data.length < 2) return { ok:true, name:name, columns:s.columns, rows:[] };
    var hdr = data[0].map(function(h){ return String(h||'').trim(); });
    var auditModIdx = hdr.indexOf('LastModified');
    var auditByIdx = hdr.indexOf('ModifiedBy');
    var rows = data.slice(1).filter(function(r){ return r[s.codeCol]; }).map(function(r){
      var obj = {};
      s.columns.forEach(function(c, i){ obj[c.key] = r[i] != null ? r[i] : ''; });
      obj._lastModified = auditModIdx >= 0 ? r[auditModIdx] : '';
      obj._modifiedBy = auditByIdx >= 0 ? r[auditByIdx] : '';
      return obj;
    });
    return { ok:true, name:name, columns:s.columns, rows:rows };
  } catch (e) {
    return { ok:false, error: String(e && e.message || e) };
  }
}

// Public: upsert a row by code. fields = {key:value, ...}
function upsertMasterRow(name, code, fields) {
  try {
    _mastersRequireOwner_();
    var s = MASTERS_SCHEMA_[name];
    if (!s) return { ok:false, error:'unknown master: ' + name };
    if (!code) return { ok:false, error:'code required' };
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName(s.sheet);
    if (!ws) return { ok:false, error:'sheet missing: ' + s.sheet };
    _mastersEnsureAudit_(ws);
    var data = ws.getDataRange().getValues();
    var hdr = data[0].map(function(h){ return String(h||'').trim(); });
    var auditModIdx = hdr.indexOf('LastModified');
    var auditByIdx = hdr.indexOf('ModifiedBy');

    // Build the row in column order
    var newRow = [];
    for (var i = 0; i < hdr.length; i++) newRow.push('');
    s.columns.forEach(function(c, i){
      if (i < hdr.length) newRow[i] = fields[c.key] != null ? fields[c.key] : '';
    });
    // Force code value
    newRow[s.codeCol] = code;
    var now = new Date();
    if (auditModIdx >= 0) newRow[auditModIdx] = now;
    if (auditByIdx >= 0) newRow[auditByIdx] = _mastersOperator_();

    // Find existing
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][s.codeCol] || '').trim() === String(code).trim()) {
        ws.getRange(r + 1, 1, 1, newRow.length).setValues([newRow]);
        if (auditModIdx >= 0) ws.getRange(r + 1, auditModIdx + 1).setNumberFormat('dd-MMM-yyyy HH:mm');
        try {
          CacheService.getScriptCache().removeAll(['pmqms_landing_v1','pmqms_records_counts_v1']);
        } catch (e) {}
        return { ok:true, mode:'updated', code:code };
      }
    }
    // Append
    ws.appendRow(newRow);
    var lastRow = ws.getLastRow();
    if (auditModIdx >= 0) ws.getRange(lastRow, auditModIdx + 1).setNumberFormat('dd-MMM-yyyy HH:mm');
    return { ok:true, mode:'inserted', code:code };
  } catch (e) {
    return { ok:false, error: String(e && e.message || e) };
  }
}

// Public: delete one row by code. Soft-checks FK references and warns.
function deleteMasterRow(name, code) {
  try {
    _mastersRequireOwner_();
    var s = MASTERS_SCHEMA_[name];
    if (!s) return { ok:false, error:'unknown master: ' + name };
    if (!code) return { ok:false, error:'code required' };
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName(s.sheet);
    if (!ws) return { ok:false, error:'sheet missing' };
    var data = ws.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][s.codeCol] || '').trim() === String(code).trim()) {
        ws.deleteRow(r + 1);
        return { ok:true, code:code, warnings: _mastersFkWarnings_(ss, name, code) };
      }
    }
    return { ok:false, error:'not found: ' + code };
  } catch (e) {
    return { ok:false, error: String(e && e.message || e) };
  }
}

function _mastersFkWarnings_(ss, name, code) {
  var warnings = [];
  try {
    if (name === 'Suppliers') {
      var po = ss.getSheetByName('PO_HEADER');
      if (po && po.getLastRow() > 1) {
        var data = po.getDataRange().getValues();
        var hdr = data[0].map(function(h){ return String(h||'').toLowerCase().trim(); });
        var ci = hdr.indexOf('supplier_code');
        if (ci >= 0) {
          var n = 0;
          for (var i = 1; i < data.length; i++) {
            if (String(data[i][ci]||'').trim() === String(code).trim()) n++;
          }
          if (n) warnings.push(n + ' PO_HEADER row(s) still reference this supplier');
        }
      }
    } else if (name === 'Materials') {
      var grn = ss.getSheetByName('GRN_LOG');
      if (grn && grn.getLastRow() > 1) {
        var d = grn.getDataRange().getValues();
        var h = d[0].map(function(x){ return String(x||'').toLowerCase().trim(); });
        var ci2 = h.indexOf('material code');
        if (ci2 >= 0) {
          var n2 = 0;
          for (var j = 1; j < d.length; j++) {
            if (String(d[j][ci2]||'').trim() === String(code).trim()) n2++;
          }
          if (n2) warnings.push(n2 + ' GRN_LOG row(s) still reference this material');
        }
      }
    } else if (name === 'Customers') {
      var fg = ss.getSheetByName('FG_DISPATCH_LOTS');
      if (fg && fg.getLastRow() > 1) {
        var d3 = fg.getDataRange().getValues();
        var h3 = d3[0].map(function(x){ return String(x||'').toLowerCase().trim(); });
        var ci3 = h3.indexOf('customer code');
        if (ci3 >= 0) {
          var n3 = 0;
          for (var k = 1; k < d3.length; k++) {
            if (String(d3[k][ci3]||'').trim() === String(code).trim()) n3++;
          }
          if (n3) warnings.push(n3 + ' FG_DISPATCH_LOTS row(s) still reference this customer');
        }
      }
    }
  } catch (e) {}
  return warnings;
}

function diag_mastersTable(name) {
  var r = getMastersTable(name || 'Suppliers');
  return JSON.stringify({ name:r.name, columns:(r.columns||[]).length, rows:(r.rows||[]).length, sample:(r.rows||[]).slice(0,2) }, null, 2);
}
