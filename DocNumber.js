// ============================================================
// DocNumber.gs — Auto-incrementing document number logic
// Thread-safe using LockService
// ============================================================

function getNextDocNumber(type) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss  = getSpreadsheet();
    var ws  = ss.getSheetByName('CONFIG');
    if (!ws) throw new Error('CONFIG sheet not found. Please run Setup first.');

    var prefixKey  = type + '_prefix';
    var counterKey = type + '_counter';
    var data = ws.getDataRange().getValues();

    var prefixRow  = -1, counterRow = -1;
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === prefixKey)  prefixRow  = i + 1;
      if (data[i][0] === counterKey) counterRow = i + 1;
    }

    // Auto-create missing rows rather than failing
    if (prefixRow < 0) {
      var newPrefixRow = ws.getLastRow() + 1;
      ws.getRange(newPrefixRow, 1).setValue(prefixKey);
      ws.getRange(newPrefixRow, 2).setValue('PM/' + type.toUpperCase() + '/2026-');
      prefixRow = newPrefixRow;
      data = ws.getDataRange().getValues();
    }
    if (counterRow < 0) {
      var newCounterRow = ws.getLastRow() + 1;
      ws.getRange(newCounterRow, 1).setValue(counterKey);
      ws.getRange(newCounterRow, 2).setValue(1);
      counterRow = newCounterRow;
    }

    var prefix  = ws.getRange(prefixRow,  2).getValue();
    var counter = parseInt(ws.getRange(counterRow, 2).getValue(), 10);
    var docNum  = prefix + String(counter).padStart(3, '0');

    ws.getRange(counterRow, 2).setValue(counter + 1);
    return docNum;
  } finally {
    lock.releaseLock();
  }
}

function peekNextDocNumber(type) {
  var ss  = getSpreadsheet();
  var ws  = ss.getSheetByName('CONFIG');
  if (!ws) return '—';
  var data = ws.getDataRange().getValues();
  var prefix = '', counter = 1;
  data.forEach(function(r) {
    if (r[0] === type + '_prefix')  prefix  = r[1];
    if (r[0] === type + '_counter') counter = parseInt(r[1], 10) || 1;
  });
  return prefix + String(counter).padStart(3, '0');
}
