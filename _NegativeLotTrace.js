// ============================================================
// _NegativeLotTrace.js — read-only forensic trace of negative-balance stock lots.
//
// WHY: getNegativeStockLots() (Warehouse.js) reports WHICH lots are negative but not
// WHY. Deciding the correction treatment (adjust-to-zero vs write-off) needs the cause
// per lot, because the two classes need opposite treatment:
//   - RECORDING ERROR  → stock was never really consumed → adjust to zero.
//   - GENUINE OVER-ISSUE → material physically left → write off the loss.
//
// This file WRITES NOTHING. It replays each negative lot's ledger rows and classifies.
// Exposed via ?diag=negtrace (Code.js).
// ============================================================

// Ledger column indices (STOCK_LEDGER, see Warehouse.js header block).
var _NLT_COL = { TXN:0, TS:1, TYPE:2, MAT:3, BATCH:4, LOC:5, IN:6, OUT:7, BAL:8,
                 REFTYPE:9, REFNO:10, OP:11, REMARKS:12, DESC:13 };

// ------------------------------------------------------------
// traceNegativeLots — main entry. Returns {report, lots:[...]}.
// ------------------------------------------------------------
function traceNegativeLots() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return { report: 'STOCK_LEDGER empty.', lots: [] };

  var data = ws.getDataRange().getValues();
  var byKey = _nltGroupRowsByLot_(data);
  var negatives = _nltFindNegativeLots_(byKey);

  var lots = negatives.map(function(key) {
    return _nltAnalyseLot_(key, byKey[key]);
  });

  return { report: _nltFormatReport_(lots), lots: lots };
}

// Group every ledger row under its mat|batch|loc key, preserving sheet order.
function _nltGroupRowsByLot_(data) {
  var byKey = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[_NLT_COL.TXN]) continue;
    var key = String(r[_NLT_COL.MAT] || '').trim() + '|' +
              String(r[_NLT_COL.BATCH] || '').trim() + '|' +
              String(r[_NLT_COL.LOC] || '').trim();
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ row: i + 1, r: r });
  }
  return byKey;
}

function _nltFindNegativeLots_(byKey) {
  return Object.keys(byKey).filter(function(key) {
    var bal = byKey[key].reduce(function(sum, e) {
      return sum + (Number(e.r[_NLT_COL.IN]) || 0) - (Number(e.r[_NLT_COL.OUT]) || 0);
    }, 0);
    return bal < -0.0001;
  }).sort();
}

// ------------------------------------------------------------
// Replay one lot: find the exact txn that first drove it negative, and classify.
// ------------------------------------------------------------
function _nltAnalyseLot_(key, entries) {
  var parts = key.split('|');
  var running = 0;
  var firstNegative = null;
  var typeCounts = {};
  var totalIn = 0, totalOut = 0;

  entries.forEach(function(e) {
    var qIn  = Number(e.r[_NLT_COL.IN])  || 0;
    var qOut = Number(e.r[_NLT_COL.OUT]) || 0;
    totalIn  += qIn;
    totalOut += qOut;
    var type = String(e.r[_NLT_COL.TYPE] || '').trim();
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    var before = running;
    running += qIn - qOut;
    if (before >= -0.0001 && running < -0.0001 && !firstNegative) {
      firstNegative = {
        sheetRow: e.row,
        txnId:    e.r[_NLT_COL.TXN],
        when:     _nltFmtDate_(e.r[_NLT_COL.TS]),
        type:     type,
        qtyOut:   qOut,
        balBefore: Math.round(before * 1000) / 1000,
        balAfter:  Math.round(running * 1000) / 1000,
        refDoc:   String(e.r[_NLT_COL.REFTYPE] || '') + ' ' + String(e.r[_NLT_COL.REFNO] || ''),
        operator: e.r[_NLT_COL.OP],
        remarks:  e.r[_NLT_COL.REMARKS]
      };
    }
  });

  var balance = Math.round((totalIn - totalOut) * 1000) / 1000;
  var hasAnyReceipt = totalIn > 0.0001;

  return {
    materialCode: parts[0],
    batchOrLotNo: parts[1],
    locationId:   parts[2],
    balance:      balance,
    shortfall:    Math.abs(balance),
    totalIn:      Math.round(totalIn * 1000) / 1000,
    totalOut:     Math.round(totalOut * 1000) / 1000,
    txnCount:     entries.length,
    txnTypes:     typeCounts,
    firstNegative: firstNegative,
    cause:        _nltClassify_(hasAnyReceipt, firstNegative, typeCounts),
    suggested:    _nltSuggest_(hasAnyReceipt, firstNegative, typeCounts)
  };
}

// ------------------------------------------------------------
// Classification. Deliberately conservative: anything not matching a known
// signature is UNKNOWN so a human looks at it rather than being auto-treated.
// ------------------------------------------------------------
function _nltClassify_(hasAnyReceipt, firstNeg, typeCounts) {
  if (!hasAnyReceipt) {
    return 'NO_RECEIPT — lot was never booked in at this location; every txn is a debit. ' +
           'Classic signature of the multi-location scan bug (debited a location that never held it) ' +
           'or a missing/unpaired stock-in.';
  }
  if (!firstNeg) return 'UNKNOWN — negative overall but no single txn crossed zero (check for edits).';

  var t = String(firstNeg.type || '').toUpperCase();
  if (t.indexOf('SAMPLE') >= 0) {
    return 'SAMPLE_UNPAIRED — went negative on a sample pull; pre-fix sampling debited without a paired credit.';
  }
  if (t.indexOf('MOVE') >= 0 || t.indexOf('SHIP') >= 0) {
    return 'MULTI_LOC_SCAN — went negative on a MOVE/SHIP; pre-fix Scan.js debited the full qty from one ' +
           'location instead of per holding location.';
  }
  if (t.indexOf('ISSUE') >= 0 || t.indexOf('PROD') >= 0 || t.indexOf('CONSUME') >= 0) {
    return 'OVER_ISSUE — production issue/booking debited more than was on hand. Likely genuine physical ' +
           'consumption of stock that was never booked in, OR a pre-lock TOCTOU double-issue.';
  }
  return 'UNKNOWN (' + t + ') — went negative on an unrecognised txn type; needs manual review.';
}

function _nltSuggest_(hasAnyReceipt, firstNeg, typeCounts) {
  if (!hasAnyReceipt) return 'ADJUST_TO_ZERO';
  if (!firstNeg) return 'REVIEW';
  var t = String(firstNeg.type || '').toUpperCase();
  if (t.indexOf('SAMPLE') >= 0) return 'ADJUST_TO_ZERO';
  if (t.indexOf('MOVE') >= 0 || t.indexOf('SHIP') >= 0) return 'ADJUST_TO_ZERO';
  if (t.indexOf('ISSUE') >= 0 || t.indexOf('PROD') >= 0 || t.indexOf('CONSUME') >= 0) return 'WRITE_OFF';
  return 'REVIEW';
}

function _nltFmtDate_(v) {
  try {
    return (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : String(v || '');
  } catch (e) { return String(v || ''); }
}

// ------------------------------------------------------------
// Plain-text report — this is what ?diag=negtrace returns.
// ------------------------------------------------------------
function _nltFormatReport_(lots) {
  if (!lots.length) return 'No negative-balance lots. STOCK_LEDGER is clean.';

  var totalShort = lots.reduce(function(s, l) { return s + l.shortfall; }, 0);
  var byCause = {}, bySuggest = {};
  lots.forEach(function(l) {
    var c = l.cause.split(' ')[0];
    byCause[c] = (byCause[c] || 0) + 1;
    bySuggest[l.suggested] = (bySuggest[l.suggested] || 0) + 1;
  });

  var out = [];
  out.push('NEGATIVE STOCK LOT TRACE');
  out.push('========================');
  out.push('Lots negative : ' + lots.length);
  out.push('Total short   : ' + (Math.round(totalShort * 1000) / 1000) + ' units');
  out.push('');
  out.push('BY CAUSE:');
  Object.keys(byCause).sort().forEach(function(c) { out.push('  ' + _nltPad_(c, 18) + byCause[c]); });
  out.push('');
  out.push('SUGGESTED TREATMENT:');
  Object.keys(bySuggest).sort().forEach(function(s) { out.push('  ' + _nltPad_(s, 18) + bySuggest[s]); });
  out.push('');
  out.push('NOTE: "suggested" is a heuristic from the ledger signature only. ADJUST_TO_ZERO');
  out.push('assumes a recording error (stock never physically left). WRITE_OFF assumes the');
  out.push('material genuinely went out unbooked. Confirm against physical count before applying.');
  out.push('');
  out.push('PER-LOT DETAIL');
  out.push('--------------');

  lots.forEach(function(l, i) {
    out.push('');
    out.push((i + 1) + '. ' + l.materialCode + '  lot=' + (l.batchOrLotNo || '(blank)') +
             '  loc=' + (l.locationId || '(blank)'));
    out.push('   balance   : ' + l.balance + '   (in ' + l.totalIn + ' / out ' + l.totalOut +
             ' over ' + l.txnCount + ' txns)');
    out.push('   cause     : ' + l.cause);
    out.push('   suggested : ' + l.suggested);
    if (l.firstNegative) {
      var f = l.firstNegative;
      out.push('   went neg  : row ' + f.sheetRow + '  ' + f.when + '  ' + f.type +
               '  out=' + f.qtyOut + '  ' + f.balBefore + ' -> ' + f.balAfter);
      out.push('   ref/op    : ' + f.refDoc + '  by ' + (f.operator || '?'));
      if (f.remarks) out.push('   remarks   : ' + f.remarks);
    }
    out.push('   txn types : ' + Object.keys(l.txnTypes).map(function(k) {
      return k + '×' + l.txnTypes[k];
    }).join(', '));
  });

  return out.join('\n');
}

function _nltPad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}
