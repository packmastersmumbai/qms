// Read-only report of BOM rows whose Component code is missing from
// MASTERS_Materials, with everything needed to create the material.
// Exposed via ?diag=bomgaps. Writes nothing — creation is a separate,
// explicitly confirmed step once the descriptions are approved.
function reportBomComponentGaps() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('BOM');
  if (!ws) return 'BOM sheet not found.';
  var data = ws.getDataRange().getValues();

  var mats = {};
  getMaterials().forEach(function(m) { mats[String(m.code).trim()] = true; });

  // Per Production.getBomRows_: B fgCode, C fgDesc, F compCode, G compDesc, I compUom
  var B_FG = 1, B_FGDESC = 2, B_COMP = 5, B_COMPDESC = 6, B_COMPUOM = 8, B_CLIENT = 0;

  var gaps = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var comp = String(r[B_COMP] || '').trim();
    if (!comp || mats[comp]) continue;
    if (!gaps[comp]) gaps[comp] = { code: comp, desc: '', uom: '', rows: [] };
    if (!gaps[comp].desc) gaps[comp].desc = String(r[B_COMPDESC] || '').trim();
    if (!gaps[comp].uom)  gaps[comp].uom  = String(r[B_COMPUOM] || '').trim();
    gaps[comp].rows.push({
      sheetRow: i + 1,
      client:   String(r[B_CLIENT] || '').trim(),
      fgCode:   String(r[B_FG] || '').trim(),
      fgDesc:   String(r[B_FGDESC] || '').trim()
    });
  }

  var keys = Object.keys(gaps);
  var out = [];
  out.push('BOM COMPONENT GAPS  (components referenced by BOM but absent from MASTERS_Materials)');
  out.push('');
  if (!keys.length) { out.push('None — every BOM component resolves.'); return out.join('\n'); }

  keys.forEach(function(k) {
    var g = gaps[k];
    out.push('CODE: ' + g.code);
    out.push('  description (from BOM) : ' + (g.desc || '(blank)'));
    out.push('  uom (from BOM)         : ' + (g.uom || '(blank)'));
    out.push('  referenced by ' + g.rows.length + ' BOM row(s):');
    g.rows.forEach(function(rw) {
      out.push('    row ' + rw.sheetRow + '  client=' + rw.client +
               '  FG=' + rw.fgCode + ' (' + rw.fgDesc + ')');
    });
    out.push('');
  });
  out.push('These would be created in MASTERS_Materials as: Item Code, Item Description,');
  out.push('Unit, Category=RM, Default Location=(blank). Confirm the descriptions first.');
  return out.join('\n');
}

// Create the missing components in MASTERS_Materials. Idempotent: a code that
// already exists is skipped, so re-running is safe. Category defaults to LABEL
// when the description looks like a label, else RM — both are existing
// categories in the sheet. Gated on confirm=YES.
function createMissingBomComponents(doWrite) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('BOM');
  if (!ws) return 'BOM sheet not found.';
  var mws = ss.getSheetByName('MASTERS_Materials');
  if (!mws) return 'MASTERS_Materials not found.';

  var data = ws.getDataRange().getValues();
  var mats = {};
  getMaterials().forEach(function(m) { mats[String(m.code).trim()] = true; });

  var B_COMP = 5, B_COMPDESC = 6, B_COMPUOM = 8;
  var toAdd = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var comp = String(r[B_COMP] || '').trim();
    if (!comp || mats[comp] || toAdd[comp]) continue;
    var desc = String(r[B_COMPDESC] || '').trim();
    toAdd[comp] = {
      code: comp,
      desc: desc,
      uom:  _bgNormalizeUom_(String(r[B_COMPUOM] || '').trim()),
      cat:  /label/i.test(desc) ? 'LABEL' : 'RM'
    };
  }

  var keys = Object.keys(toAdd);
  var out = [];
  out.push('CREATE MISSING BOM COMPONENTS  (' + (doWrite ? 'LIVE WRITE' : 'DRY RUN') + ')');
  out.push('rows to create: ' + keys.length);
  out.push('');
  keys.forEach(function(k) {
    var a = toAdd[k];
    out.push('  ' + a.code + '  |  ' + a.desc + '  |  ' + a.uom + '  |  ' + a.cat);
  });

  if (!doWrite) {
    out.push('');
    out.push('Dry run — nothing written. Re-run with &confirm=YES to apply.');
    return out.join('\n');
  }

  // Write through saveMaster so the sparse-patch writer (which cannot shift
  // columns) is the single creation path, rather than a positional appendRow.
  keys.forEach(function(k) {
    var a = toAdd[k];
    saveMaster('material', { code: a.code, desc: a.desc, unit: a.uom,
                             category: a.cat, defaultLocation: '' });
  });
  SpreadsheetApp.flush();

  var after = getMaterials().length;
  out.push('');
  out.push('CREATED ' + keys.length + '. getMaterials() now returns: ' + after);
  return out.join('\n');
}

// BOM writes "No's" / "Nos" / "NOS" for pieces; the material master uses PC.
function _bgNormalizeUom_(u) {
  var s = String(u || '').trim();
  if (/^no'?s?$/i.test(s)) return 'PC';
  return s || 'PC';
}
