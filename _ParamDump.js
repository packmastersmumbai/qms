// Read-only dump of MASTERS_Parameters + CONTROL_FG. Exposed via ?diag=paramdump.
function dumpParameters() {
  var ss = getSpreadsheet();
  var out = [];

  var pw = ss.getSheetByName('MASTERS_Parameters');
  if (!pw || pw.getLastRow() < 2) {
    out.push('MASTERS_Parameters: empty or missing.');
  } else {
    var pd = pw.getDataRange().getValues();
    out.push('MASTERS_Parameters  (' + (pd.length - 1) + ' rows, ' + pw.getLastColumn() + ' cols)');
    out.push('  header: ' + pd[0].join(' | '));
    out.push('');
    // Group by category (col L = index 11)
    var byCat = {};
    for (var i = 1; i < pd.length; i++) {
      var r = pd[i];
      if (!r[0]) continue;
      var cat = String(r[11] || '(no category)').trim() || '(blank)';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(r);
    }
    Object.keys(byCat).sort().forEach(function(cat) {
      out.push('  ── ' + cat + '  (' + byCat[cat].length + ')');
      byCat[cat].forEach(function(r) {
        out.push('     ' + _pdPad_(String(r[0] || ''), 14) + _pdPad_(String(r[1] || ''), 26) +
                 'unit=' + _pdPad_(String(r[2] || '-'), 8) +
                 'std=' + _pdPad_(String(r[3] === '' ? '-' : r[3]), 8) +
                 'min=' + _pdPad_(String(r[4] === '' ? '-' : r[4]), 8) +
                 'max=' + _pdPad_(String(r[5] === '' ? '-' : r[5]), 8) +
                 'method=' + _pdPad_(String(r[6] || '-'), 14) +
                 (String(r[12] || '').toUpperCase() === 'Y' ? 'CCP' : ''));
      });
      out.push('');
    });
  }

  var cw = ss.getSheetByName('CONTROL_FG');
  out.push('');
  if (!cw || cw.getLastRow() < 2) {
    out.push('CONTROL_FG: empty or missing — no per-product plans configured.');
    return out.join('\n');
  }
  var cd = cw.getDataRange().getValues();
  out.push('CONTROL_FG  (' + (cd.length - 1) + ' rows)');
  out.push('  header: ' + cd[0].join(' | '));
  var byItem = {};
  for (var j = 1; j < cd.length; j++) {
    var c = cd[j];
    if (!c[0]) continue;
    var it = String(c[0]).trim();
    if (!byItem[it]) byItem[it] = { on: 0, off: 0, ovr: 0, params: [] };
    var en = (c[2] === 'Y' || c[2] === true);
    en ? byItem[it].on++ : byItem[it].off++;
    var hasOvr = String(c[3] || '') !== '' || String(c[4] || '') !== '' || String(c[5] || '') !== '';
    if (hasOvr) byItem[it].ovr++;
    byItem[it].params.push(String(c[1] || '') + (en ? '' : '(off)') +
      (hasOvr ? ' [std=' + (c[3] === '' ? '-' : c[3]) + ' min=' + (c[4] === '' ? '-' : c[4]) + ' max=' + (c[5] === '' ? '-' : c[5]) + ']' : ''));
  }
  var items = Object.keys(byItem).sort();
  out.push('  products with a plan: ' + items.length);
  out.push('');
  items.forEach(function(it) {
    var b = byItem[it];
    out.push('  ── ' + it + '   enabled=' + b.on + ' disabled=' + b.off + ' with-overrides=' + b.ovr);
    b.params.forEach(function(p) { out.push('       ' + p); });
  });
  return out.join('\n');
}

function _pdPad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
