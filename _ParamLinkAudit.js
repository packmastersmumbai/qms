// READ-ONLY: does every CONTROL_FG/CONTROL_RM param_code resolve to a real
// MASTERS_Parameters row, and does every material's inspectionCategory have
// params? Writes nothing. ?diag=paramlink
function auditParamLinks() {
  var ss = getSpreadsheet();
  var out = [];
  var pw = ss.getSheetByName('MASTERS_Parameters');
  if (!pw) return 'MASTERS_Parameters missing.';
  var pd = pw.getDataRange().getValues();
  var dict = {}, cats = {};
  for (var i = 1; i < pd.length; i++) {
    var code = String(pd[i][0] || '').trim();
    if (!code) continue;
    dict[code] = true;
    var c = String(pd[i][11] || '').trim();
    if (c) cats[c] = (cats[c] || 0) + 1;
  }
  out.push('DICTIONARY: ' + Object.keys(dict).length + ' param codes');
  out.push('CATEGORIES: ' + Object.keys(cats).sort().map(function(k){return k+'('+cats[k]+')';}).join(' '));
  out.push('');

  ['CONTROL_FG','CONTROL_RM'].forEach(function(sn){
    var w = ss.getSheetByName(sn);
    if (!w) { out.push(sn + ': MISSING'); return; }
    var d = w.getDataRange().getValues();
    var orphan = [], items = {}, enabled = 0;
    for (var j = 1; j < d.length; j++) {
      var item = String(d[j][0] || '').trim(), pc = String(d[j][1] || '').trim();
      if (!item || !pc) continue;
      items[item] = true;
      if (d[j][2] === 'Y' || d[j][2] === true) enabled++;
      if (!dict[pc]) orphan.push(item + ' -> ' + pc);
    }
    out.push(sn + ': ' + (d.length-1) + ' rows, ' + Object.keys(items).length +
             ' products, ' + enabled + ' enabled');
    out.push('  ORPHAN param_codes (not in dictionary): ' + orphan.length);
    orphan.slice(0,8).forEach(function(o){ out.push('    !! ' + o); });
  });
  out.push('');

  // Every material's inspectionCategory -> does it have params?
  var mw = ss.getSheetByName('MASTERS_Materials');
  if (mw) {
    var md = mw.getDataRange().getValues();
    var used = {}, noCat = 0, fg = 0;
    for (var k = 1; k < md.length; k++) {
      if (!md[k][0]) continue;
      var cat3 = String(md[k][3] || '').trim().toUpperCase();
      if (cat3 === 'FG') fg++;
      var ic = String(md[k][12] || '').trim();
      if (!ic) { noCat++; continue; }
      used[ic] = (used[ic] || 0) + 1;
    }
    out.push('MATERIALS: ' + (md.length-1) + ' rows, ' + fg + ' FG');
    out.push('  with inspectionCategory: ' + Object.keys(used).sort()
      .map(function(k){ return k+'('+used[k]+')'+(cats[k]?'':' <-- NO PARAMS!'); }).join(' '));
    out.push('  BLANK inspectionCategory: ' + noCat +
             (noCat ? '  <-- these fall back to legacy generic params' : ''));
  }
  return out.join('\n');
}
