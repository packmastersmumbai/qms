// ============================================================
// _LedgerAudit.js — does every module actually write STOCK_LEDGER correctly?
//
// `node e2e-diag.js ledgeraudit`. READ-ONLY.
//
// Answers the question by auditing the SHEET, not by reading the writers.
// A writer that looks right and never fires is the failure mode that matters,
// and only the ledger's own rows can show it.
//
// STOCK_LEDGER columns (0-based, per writeStockLedger_ in Warehouse.js):
//   0 TxnID  1 Date  2 TxnType  3 MaterialCode  4 Batch/Lot  5 LocationID
//   6 QtyIn  7 QtyOut  8 BalanceAfter  9 RefDocType  10 RefDocNo
//   11 Operator  12 Remarks  13 MaterialDesc
// ============================================================

var LA_COL_ = { TXN:0, DATE:1, TYPE:2, MAT:3, BATCH:4, LOC:5,
                IN:6, OUT:7, BAL:8, REFTYPE:9, REFNO:10, OP:11, REMARK:12, DESC:13 };

// Every txnType the codebase can emit, grouped by the module that owns it.
// If a group has ZERO rows, that module has never successfully written.
var LA_EXPECTED_ = {
  'GRN receipt':        ['GRN_RECEIPT'],
  'IQC decisions':      ['IQC_ACCEPT', 'IQC_ACCEPT_REMAINDER_OUT', 'IQC_ACCEPT_REMAINDER_QUARANTINE',
                         'IQC_REJECT_OUT', 'IQC_REJECT_QUARANTINE', 'IQC_HOLD_OUT', 'IQC_HOLD_IN',
                         'IQC_HOLD_ACCEPT', 'IQC_HOLD_REJECT'],
  // RM_ISSUE / PROD_BOOK / PROD_RETURN / SAMPLE are CURRENT vocabulary, not
  // legacy: Warehouse.js:1037 chooses between RM_ISSUE and PROD_BOOK at issue
  // time, and Production.js:1537-1542 reads PROD_BOOK and PROD_RETURN to compute
  // booked/returned per job. An earlier version of this map omitted them and
  // reported them as unknown — the map was wrong, not the ledger.
  'Production issue':   ['PROD_CONSUME', 'RM_ISSUE'],
  'Production booking': ['PROD_BOOK', 'PROD_BOOK_REVERSE', 'PROD_BOOK_ROLLBACK', 'PROD_RETURN'],
  'Production losses':  ['PROD_LOSS', 'PROD_SCRAP', 'PROD_WASTAGE'],
  'Rework':             ['REWORK_COMPLETE_IN', 'REWORK_COMPLETE_OUT', 'REWORK_SCRAP', 'REWORK_SCRAP_IN'],
  'NCR rework':         ['NCR_REWORK_IN', 'NCR_REWORK_OUT'],
  'Movement / putaway': ['LOCATION_TRANSFER', 'SCAN_MOVE', 'SCAN_RECEIVE', 'SCAN_SHIP'],
  'OQC':                ['OQC_RELEASE', 'OQC_REJECT_OUT', 'OQC_REJECT_QUARANTINE'],
  'Dispatch':           ['FG_DISPATCH'],
  'Customer return':    ['CUSTOMER_RETURN_IN', 'CUSTOMER_RETURN_RESTOCK_IN', 'CUSTOMER_RETURN_RESTOCK_OUT',
                         'CUSTOMER_RETURN_REWORK_IN', 'CUSTOMER_RETURN_REWORK_OUT'],
  'Sampling':           ['SAMPLE_IN', 'SAMPLE_OUT', 'SAMPLE'],
  'Scrap':              ['SCRAP']
};

// Moves that must come in pairs — stock leaving one place must arrive somewhere.
// An unpaired OUT is stock that vanished; an unpaired IN is stock invented.
var LA_PAIRS_ = [
  ['IQC_REJECT_OUT', 'IQC_REJECT_QUARANTINE'],
  ['IQC_HOLD_OUT', 'IQC_HOLD_IN'],
  ['IQC_ACCEPT_REMAINDER_OUT', 'IQC_ACCEPT_REMAINDER_QUARANTINE'],
  ['OQC_REJECT_OUT', 'OQC_REJECT_QUARANTINE'],
  ['REWORK_COMPLETE_OUT', 'REWORK_COMPLETE_IN'],
  ['NCR_REWORK_OUT', 'NCR_REWORK_IN'],
  ['REWORK_SCRAP', 'REWORK_SCRAP_IN'],
  ['CUSTOMER_RETURN_RESTOCK_OUT', 'CUSTOMER_RETURN_RESTOCK_IN'],
  ['CUSTOMER_RETURN_REWORK_OUT', 'CUSTOMER_RETURN_REWORK_IN'],
  ['SAMPLE_OUT', 'SAMPLE_IN']
];

function _laPad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function _laNum_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

function ledgerAudit() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws) return 'STOCK_LEDGER not found';
  if (ws.getLastRow() < 2) return 'STOCK_LEDGER is empty';

  var vals = ws.getRange(2, 1, ws.getLastRow() - 1, 14).getValues();
  var out = ['STOCK LEDGER AUDIT', '', 'rows: ' + vals.length, ''];

  // ── 1. Which modules have actually written? ────────────────────────────
  var byType = {}, known = {};
  Object.keys(LA_EXPECTED_).forEach(function (g) {
    LA_EXPECTED_[g].forEach(function (t) { known[t] = g; });
  });
  var unknownTypes = {};
  vals.forEach(function (r) {
    var t = String(r[LA_COL_.TYPE] || '').trim();
    if (!t) return;
    byType[t] = (byType[t] || 0) + 1;
    if (!known[t]) unknownTypes[t] = (unknownTypes[t] || 0) + 1;
  });

  out.push('── 1. MODULE COVERAGE ─────────────────────────────────');
  var silent = [];
  Object.keys(LA_EXPECTED_).forEach(function (group) {
    var total = 0, detail = [];
    LA_EXPECTED_[group].forEach(function (t) {
      var n = byType[t] || 0;
      total += n;
      if (n) detail.push(t + '=' + n);
    });
    out.push(_laPad_(group, 21) + _laPad_(total ? String(total) + ' rows' : 'NEVER WRITTEN', 16) +
             detail.join('  '));
    if (!total) silent.push(group);
  });

  // ── 2. Balance arithmetic ─────────────────────────────────────────────
  // BalanceAfter must equal the running balance for that material+batch+location.
  // A mismatch means a writer bypassed writeStockLedger_ or a row was hand-edited.
  out.push('');
  out.push('── 2. BALANCE ARITHMETIC ──────────────────────────────');
  var running = {}, mismatches = [], negatives = {}, mismatchTotal = 0;
  vals.forEach(function (r, i) {
    var key = String(r[LA_COL_.MAT]).trim() + '|' + String(r[LA_COL_.BATCH]).trim() +
              '|' + String(r[LA_COL_.LOC]).trim();
    var prev = running[key] || 0;
    var expect = prev + _laNum_(r[LA_COL_.IN]) - _laNum_(r[LA_COL_.OUT]);
    running[key] = expect;
    var actual = _laNum_(r[LA_COL_.BAL]);
    if (Math.abs(actual - expect) > 0.001) {
      if (mismatches.length < 12) {
        mismatches.push('row ' + (i + 2) + '  ' + _laPad_(String(r[LA_COL_.TYPE]), 26) +
                        'expected ' + expect + '  sheet says ' + actual +
                        '  (' + String(r[LA_COL_.MAT]) + ')');
      }
      mismatchTotal++;
    }
    if (expect < -0.001) negatives[key] = expect;
  });
  out.push(mismatchTotal
    ? 'MISMATCHES: ' + mismatchTotal + ' row(s)  (showing first ' + mismatches.length + ')'
    : 'OK — every BalanceAfter matches the running total for its key.');
  mismatches.forEach(function (m) { out.push('   ' + m); });

  var negKeys = Object.keys(negatives);
  out.push('');
  out.push('negative-balance keys: ' + negKeys.length +
           (negKeys.length ? '  (stock issued that was never received)' : ''));
  negKeys.slice(0, 8).forEach(function (k) {
    out.push('   ' + _laPad_(k, 46) + negatives[k]);
  });

  // ── 3. Paired moves ───────────────────────────────────────────────────
  out.push('');
  out.push('── 3. PAIRED MOVES (out must have a matching in) ──────');
  var anyPairIssue = false;
  LA_PAIRS_.forEach(function (p) {
    var a = byType[p[0]] || 0, b = byType[p[1]] || 0;
    if (!a && !b) return;                       // feature unused — not a defect
    var flag = (a === b) ? 'OK' : 'MISMATCH';
    if (a !== b) anyPairIssue = true;
    out.push('   ' + _laPad_(p[0], 34) + _laPad_(String(a), 6) +
             _laPad_(p[1], 34) + _laPad_(String(b), 6) + flag);
  });
  if (!anyPairIssue) out.push('   all present pairs balance.');

  // ── 4. Data quality on the rows themselves ────────────────────────────
  out.push('');
  out.push('── 4. ROW QUALITY ─────────────────────────────────────');
  var noMat = 0, noBatch = 0, noLoc = 0, noRef = 0, bothZero = 0, bothNonZero = 0;
  vals.forEach(function (r) {
    if (!String(r[LA_COL_.MAT]).trim())   noMat++;
    if (!String(r[LA_COL_.BATCH]).trim()) noBatch++;
    if (!String(r[LA_COL_.LOC]).trim())   noLoc++;
    if (!String(r[LA_COL_.REFNO]).trim()) noRef++;
    var qi = _laNum_(r[LA_COL_.IN]), qo = _laNum_(r[LA_COL_.OUT]);
    if (!qi && !qo) bothZero++;
    if (qi && qo)   bothNonZero++;
  });
  out.push(_laPad_('missing material code', 26) + noMat);
  out.push(_laPad_('missing batch/lot', 26) + noBatch);
  out.push(_laPad_('missing location', 26) + noLoc);
  out.push(_laPad_('missing ref doc no', 26) + noRef);
  out.push(_laPad_('qty in AND out both 0', 26) + bothZero + '   (a no-op row)');
  out.push(_laPad_('qty in AND out both set', 26) + bothNonZero + '   (should be one or the other)');

  var uk = Object.keys(unknownTypes);
  if (uk.length) {
    out.push('');
    out.push('txnTypes not in the expected map (' + uk.length + '):');
    uk.slice(0, 10).forEach(function (t) { out.push('   ' + _laPad_(t, 34) + unknownTypes[t]); });
  }

  // ── Verdict ───────────────────────────────────────────────────────────
  out.push('');
  out.push('── VERDICT ────────────────────────────────────────────');
  var fail = [];
  if (silent.length)        fail.push(silent.length + ' module(s) never wrote: ' + silent.join(', '));
  if (mismatchTotal)        fail.push(mismatchTotal + ' balance mismatch(es)');
  if (anyPairIssue)         fail.push('unpaired move(s)');
  if (bothNonZero)          fail.push(bothNonZero + ' row(s) with both in and out set');
  out.push(fail.length ? ('FAIL — ' + fail.join(' | ')) : 'PASS — ledger is internally consistent.');
  if (negKeys.length) {
    out.push('NOTE: ' + negKeys.length + ' negative-balance key(s) — pre-existing data, ' +
             'reported separately from the writer check.');
  }
  return out.join('\n');
}

// Did Rework / NCR-rework never write because they are BROKEN, or because
// nobody has ever completed one? Only the source sheets can tell them apart,
// and the difference decides whether this is a bug or a non-event.
function ledgerWhySilent() {
  var ss = getSpreadsheet();
  var out = ['WHY ARE REWORK / NCR SILENT?', ''];
  function tally(sheetName, statusCol1Based) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) { out.push(_laPad_(sheetName, 20) + '(sheet missing)'); return; }
    var n = sh.getLastRow() - 1;
    if (n < 1) { out.push(_laPad_(sheetName, 20) + '0 rows — feature never used'); return; }
    var counts = {};
    if (statusCol1Based && sh.getLastColumn() >= statusCol1Based) {
      sh.getRange(2, statusCol1Based, n, 1).getValues().forEach(function (r) {
        var s = String(r[0] || '(blank)').trim().toUpperCase();
        counts[s] = (counts[s] || 0) + 1;
      });
    }
    var parts = Object.keys(counts).map(function (k) { return k + '=' + counts[k]; });
    out.push(_laPad_(sheetName, 20) + _laPad_(n + ' rows', 12) + parts.join('  '));
  }
  // REWORK_LOG col 11 = Status (set to COMPLETED at Rework.js:164).
  tally('REWORK_LOG', 11);
  tally('NCR_LOG', 0);
  out.push('');
  out.push('A rework only writes to the ledger when it is COMPLETED. If no row is');
  out.push('COMPLETED, "NEVER WRITTEN" means the feature is unused, not broken.');
  return out.join('\n');
}

// What ARE the 205 zero-qty rows? A no-op row is only harmless if it is a
// status marker; if a real movement wrote 0 by mistake, stock is missing.
function ledgerZeroRows() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  var vals = ws.getRange(2, 1, ws.getLastRow() - 1, 14).getValues();
  var byType = {}, samples = [];
  vals.forEach(function (r, i) {
    if (_laNum_(r[LA_COL_.IN]) || _laNum_(r[LA_COL_.OUT])) return;
    var t = String(r[LA_COL_.TYPE] || '(blank)').trim();
    byType[t] = (byType[t] || 0) + 1;
    if (samples.length < 10) {
      samples.push('row ' + (i + 2) + '  ' + _laPad_(t, 20) +
                   _laPad_(String(r[LA_COL_.MAT]), 14) +
                   _laPad_(String(r[LA_COL_.REFNO]), 20) +
                   'bal=' + r[LA_COL_.BAL] + '  ' + String(r[LA_COL_.REMARK]).slice(0, 40));
    }
  });
  var out = ['ZERO-QUANTITY LEDGER ROWS', ''];
  Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; })
    .forEach(function (t) { out.push('   ' + _laPad_(t, 26) + byType[t]); });
  out.push('');
  out.push('samples:');
  samples.forEach(function (s) { out.push('   ' + s); });
  return out.join('\n');
}

// The 36 production rows with qty 0 carry the real amount in their REMARK
// ("Consumed 36.424 KG"). If the remark says a number and the qty column says
// 0, stock left the floor and the ledger never debited it. Quantify the gap.
function ledgerZeroQtyProd() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  var vals = ws.getRange(2, 1, ws.getLastRow() - 1, 14).getValues();
  var PROD = { PROD_CONSUME:1, PROD_SCRAP:1, PROD_WASTAGE:1, PROD_LOSS:1, SCRAP:1 };
  var rows = [], byType = {}, totalByUnit = {};
  vals.forEach(function (r, i) {
    var t = String(r[LA_COL_.TYPE] || '').trim();
    if (!PROD[t]) return;
    if (_laNum_(r[LA_COL_.IN]) || _laNum_(r[LA_COL_.OUT])) return;
    var rem = String(r[LA_COL_.REMARK] || '');
    // "Consumed 36.424 KG (booking ...)" / "Scrap 4 KG (...)"
    var m = rem.match(/([\d.]+)\s*([A-Za-z']+)/);
    var qty = m ? Number(m[1]) : 0;
    var unit = m ? m[2].toUpperCase() : '?';
    byType[t] = (byType[t] || 0) + 1;
    if (qty) totalByUnit[unit] = (totalByUnit[unit] || 0) + qty;
    if (rows.length < 40) {
      rows.push(_laPad_('row ' + (i + 2), 9) + _laPad_(t, 14) +
                _laPad_(String(r[LA_COL_.MAT]), 12) +
                _laPad_(String(r[LA_COL_.BATCH]), 22) +
                _laPad_(String(r[LA_COL_.REFNO]), 22) +
                'remark says ' + (qty ? (qty + ' ' + unit) : '(no qty)'));
    }
  });
  var out = ['PRODUCTION ROWS WRITTEN WITH QTY 0', ''];
  out.push('These say a quantity in the remark but debited NOTHING.');
  out.push('');
  Object.keys(byType).forEach(function (t) { out.push('   ' + _laPad_(t, 16) + byType[t] + ' rows'); });
  out.push('');
  out.push('undebited totals by unit:');
  Object.keys(totalByUnit).forEach(function (u) {
    out.push('   ' + _laPad_(u, 8) + Math.round(totalByUnit[u] * 1000) / 1000);
  });
  out.push('');
  rows.forEach(function (r) { out.push(r); });
  return out.join('\n');
}

// Are the qty-0 production rows HISTORICAL (an old bug, already fixed) or is
// the live code still producing them? Dates decide it. If the newest one is
// old, the writer is fine and only the data needs repair.
function ledgerZeroProdDates() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  var vals = ws.getRange(2, 1, ws.getLastRow() - 1, 14).getValues();
  var PROD = { PROD_CONSUME:1, PROD_SCRAP:1, PROD_WASTAGE:1, PROD_LOSS:1 };
  var zero = [], good = [];
  vals.forEach(function (r) {
    var t = String(r[LA_COL_.TYPE] || '').trim();
    if (!PROD[t]) return;
    var d = r[LA_COL_.DATE];
    var when = (d instanceof Date) ? d.getTime() : 0;
    if (!_laNum_(r[LA_COL_.IN]) && !_laNum_(r[LA_COL_.OUT])) zero.push(when);
    else good.push(when);
  });
  function fmt(ms) {
    return ms ? Utilities.formatDate(new Date(ms), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') : '(none)';
  }
  var out = ['ZERO-QTY PRODUCTION ROWS — ARE THEY STILL HAPPENING?', ''];
  out.push(_laPad_('qty-0 rows', 22) + zero.length);
  out.push(_laPad_('  earliest', 22) + fmt(Math.min.apply(null, zero.concat([Infinity])) === Infinity ? 0 : Math.min.apply(null, zero)));
  out.push(_laPad_('  LATEST', 22) + fmt(zero.length ? Math.max.apply(null, zero) : 0));
  out.push('');
  out.push(_laPad_('correct rows', 22) + good.length);
  out.push(_laPad_('  earliest', 22) + fmt(good.length ? Math.min.apply(null, good) : 0));
  out.push(_laPad_('  LATEST', 22) + fmt(good.length ? Math.max.apply(null, good) : 0));
  out.push('');
  if (zero.length && good.length) {
    out.push(Math.max.apply(null, good) > Math.max.apply(null, zero)
      ? 'VERDICT: the newest production row is CORRECT and newer than the newest'
      : 'VERDICT: a qty-0 row is the NEWEST — the writer may still be broken.');
  }
  return out.join('\n');
}
