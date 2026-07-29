// Read-only probe: what is actually IN each MASTERS_Materials column?
// Needed before remapping MAT_COL — a header can be right while the data below
// it is empty, and vice versa. Exposed via ?diag=matprobe.
function probeMaterialColumns() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials not found.';
  var lastCol = ws.getLastColumn(), lastRow = ws.getLastRow();
  var data = ws.getRange(1, 1, Math.min(lastRow, 200), lastCol).getValues();
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var out = [];
  out.push('MASTERS_Materials COLUMN PROBE  (' + (lastRow - 1) + ' data rows, ' + lastCol + ' cols)');
  out.push('');
  for (var c = 0; c < lastCol; c++) {
    var filled = 0, samples = [], types = {};
    for (var r = 1; r < data.length; r++) {
      var v = data[r][c];
      if (v === '' || v === null || v === undefined) continue;
      filled++;
      var t = (v instanceof Date) ? 'Date' : typeof v;
      types[t] = (types[t] || 0) + 1;
      if (samples.length < 3) samples.push(String(v).slice(0, 28));
    }
    out.push('  ' + letters.charAt(c) + ' [' + c + ']  "' + String(data[0][c] || '(no header)') + '"');
    out.push('       filled ' + filled + '/' + (data.length - 1) +
             '   types: ' + (Object.keys(types).map(function(k){return k+'×'+types[k];}).join(', ') || '-'));
    out.push('       eg: ' + (samples.join(' | ') || '(all blank)'));
  }
  return out.join('\n');
}
