// ============================================================
// _LedgerReconDiag.js — STOCK_LEDGER reconciliation (Phase 3)
// P3 — Pack Masters QMS — VALIDATION_PLAN.md
//
// Flags drift in STOCK_LEDGER on a per (material, batch, location) basis.
// Cross-checks FG triples against FG_DISPATCH_LOTS available qty.
//
// Mirrors _POPDiag.js pattern:
//   runLedgerReconcile()      → menu (UI alert)
//   runLedgerReconcile_core() → headless (clasp run / triggers)
// Sheet output: _LEDGER_RECON (4-col: Section | Check | Value | Severity)
//
// STOCK_LEDGER schema (from Warehouse.js writeStockLedger_):
//   0 Txn ID | 1 Timestamp | 2 Txn Type | 3 Material Code | 4 Batch
//   5 Location ID | 6 Qty In | 7 Qty Out | 8 Balance After
//   9 Ref Doc Type | 10 Ref Doc No. | 11 Operator | 12 Remarks
//
// FG_DISPATCH_LOTS schema (FG_DISPATCH_HEADERS):
//   0 Lot ID | 6 Product Code | 8 FG Batch / PO | 9 FG Location ID
//   12 Qty Available | 14 Status
// ============================================================

function runLedgerReconcile()      { return _runLedgerReconcileImpl(false); }
function runLedgerReconcile_core() { return _runLedgerReconcileImpl(true);  }

function _runLedgerReconcileImpl(headless) {
  var ss = getSpreadsheet();
  var ui = headless ? null : SpreadsheetApp.getUi();
  var report = [];
  var drifts = [];

  function add(section, check, value, severity) {
    report.push([section, check, String(value == null ? '' : value), severity || 'INFO']);
  }

  // ── Load STOCK_LEDGER ─────────────────────────────────────
  var ledWs = ss.getSheetByName('STOCK_LEDGER');
  if (!ledWs) {
    add('0. Pre-flight', 'STOCK_LEDGER', 'MISSING', 'ERROR');
    return _writeReconSheet_(ss, report, drifts, headless, ui);
  }
  add('0. Pre-flight', 'STOCK_LEDGER rows', ledWs.getLastRow() - 1, 'INFO');

  // Build triple-keyed aggregation map
  // key = mat|batch|loc → { in, out, byType:{txType:{in,out,count}}, count }
  var map = {};
  if (ledWs.getLastRow() > 1) {
    var data = ledWs.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var mat = String(r[3] == null ? '' : r[3]).trim();
      var bat = String(r[4] == null ? '' : r[4]).trim();
      var loc = String(r[5] == null ? '' : r[5]).trim();
      var tx  = String(r[2] == null ? '' : r[2]).trim() || 'UNKNOWN';
      var qIn = Number(r[6]) || 0;
      var qOut = Number(r[7]) || 0;
      // Skip fully empty rows
      if (!mat && !bat && !loc && !qIn && !qOut) continue;
      var key = mat + '|' + bat + '|' + loc;
      if (!map[key]) {
        map[key] = { mat: mat, batch: bat, loc: loc, in: 0, out: 0, count: 0, byType: {} };
      }
      var e = map[key];
      e.in += qIn;
      e.out += qOut;
      e.count++;
      if (!e.byType[tx]) e.byType[tx] = { in: 0, out: 0, count: 0 };
      e.byType[tx].in += qIn;
      e.byType[tx].out += qOut;
      e.byType[tx].count++;
    }
  }
  var triples = Object.keys(map);
  add('0. Pre-flight', 'unique (mat,batch,loc) triples', triples.length, 'INFO');

  // ── §1. Ledger by triple ──────────────────────────────────
  var negNetCount = 0, orphanIssueCount = 0;
  triples.forEach(function(k) {
    var e = map[k];
    var net = e.in - e.out;
    var typeKeys = Object.keys(e.byType);
    var breakdown = typeKeys.map(function(t) {
      var bt = e.byType[t];
      return t + ':+' + bt.in + '/-' + bt.out;
    }).join(', ');
    add('1. Ledger by triple',
        e.mat + ' | ' + e.batch + ' | ' + e.loc,
        'net=' + net + ' (' + breakdown + ')',
        'INFO');

    if (net < -0.001) {
      add('1. Ledger by triple',
          e.mat + ' | ' + e.batch + ' | ' + e.loc,
          'NEGATIVE NET: ' + net + ' — more issued than received',
          'WARN');
      negNetCount++;
      drifts.push({ kind: 'NEGATIVE_NET', mat: e.mat, batch: e.batch, loc: e.loc, net: net });
    }

    if (net > 0.001) {
      // Check whether any "inflow" tx type exists — GRN_RECEIPT, RETURN, or ADJUSTMENT
      // (FG_RELEASE / OQC_RELEASE / production receipt also legitimate inflows.)
      var inflowTypes = ['GRN_RECEIPT', 'RETURN', 'ADJUSTMENT', 'OQC_RELEASE',
                         'FG_RELEASE', 'PROD_RECEIPT', 'LOCATION_TRANSFER'];
      var hasInflow = inflowTypes.some(function(t) {
        return e.byType[t] && e.byType[t].in > 0;
      });
      if (!hasInflow && e.in > 0) {
        // qty_in > 0 came from an unrecognised tx type — note it but not necessarily orphan
        add('1. Ledger by triple',
            e.mat + ' | ' + e.batch + ' | ' + e.loc,
            'positive net but only via tx types: ' + typeKeys.join(','),
            'INFO');
      } else if (!hasInflow && e.in === 0 && e.out > 0) {
        add('1. Ledger by triple',
            e.mat + ' | ' + e.batch + ' | ' + e.loc,
            'ORPHAN ISSUE: out=' + e.out + ' with no inflow tx',
            'WARN');
        orphanIssueCount++;
        drifts.push({ kind: 'ORPHAN_ISSUE', mat: e.mat, batch: e.batch, loc: e.loc, out: e.out });
      }
    }
  });
  if (negNetCount === 0) add('1. Ledger by triple', 'negative-net triples', 0, 'INFO');
  if (orphanIssueCount === 0) add('1. Ledger by triple', 'orphan-issue triples', 0, 'INFO');

  // ── §2. FG cross-check vs FG_DISPATCH_LOTS ────────────────
  var fgWs = ss.getSheetByName('FG_DISPATCH_LOTS');
  if (!fgWs) {
    add('2. FG cross-check', 'FG_DISPATCH_LOTS', 'sheet missing — skipped', 'INFO');
  } else {
    // Sum qty_available where status in {AVAILABLE, PARTIAL} keyed by mat|batch|loc
    // FG col layout: 6 product_code, 8 fg_batch/po, 9 fg_location_id, 12 qty_available, 14 status
    var fgAvail = {};
    if (fgWs.getLastRow() > 1) {
      fgWs.getDataRange().getValues().slice(1).forEach(function(r) {
        var status = String(r[14] || '').trim().toUpperCase();
        if (status !== 'AVAILABLE' && status !== 'PARTIAL') return;
        var mat = String(r[6] || '').trim();
        var bat = String(r[8] || '').trim();
        var loc = String(r[9] || '').trim();
        var qav = Number(r[12]) || 0;
        var key = mat + '|' + bat + '|' + loc;
        fgAvail[key] = (fgAvail[key] || 0) + qav;
      });
    }
    var fgKeys = Object.keys(fgAvail);
    add('2. FG cross-check', 'FG lots (AVAILABLE|PARTIAL) triples', fgKeys.length, 'INFO');

    if (fgKeys.length === 0) {
      add('2. FG cross-check', 'live FG lots', 'none — nothing to cross-check', 'INFO');
    }

    var fgMismatchCount = 0;
    fgKeys.forEach(function(k) {
      var fgQty = fgAvail[k];
      var led = map[k];
      var ledNet = led ? (led.in - led.out) : 0;
      var delta = ledNet - fgQty;
      if (!led) {
        add('2. FG cross-check', k,
            'FG_lot_avail=' + fgQty + ' but NO STOCK_LEDGER entries for triple',
            'ERROR');
        fgMismatchCount++;
        drifts.push({ kind: 'FG_NO_LEDGER', key: k, fgQty: fgQty });
      } else if (Math.abs(delta) > 0.01) {
        add('2. FG cross-check', k,
            'ledger_net=' + ledNet + ' vs FG_avail=' + fgQty + ' (Δ=' + delta.toFixed(3) + ')',
            'ERROR');
        fgMismatchCount++;
        drifts.push({ kind: 'FG_DRIFT', key: k, ledgerNet: ledNet, fgQty: fgQty, delta: delta });
      } else {
        add('2. FG cross-check', k,
            'ledger=' + ledNet + ' = FG_avail=' + fgQty + ' ✓',
            'INFO');
      }
    });
    if (fgMismatchCount === 0 && fgKeys.length > 0) {
      add('2. FG cross-check', 'all FG triples', 'reconcile cleanly', 'INFO');
    }
  }

  // ── §3. RM cross-check (gap note) ─────────────────────────
  add('3. RM cross-check',
      'on-hand source',
      'no RM_ON_HAND sheet — STOCK_LEDGER net is sole source of truth for RM',
      'INFO');

  // ── Write _LEDGER_RECON sheet and return ──────────────────
  return _writeReconSheet_(ss, report, drifts, headless, ui);
}

function _writeReconSheet_(ss, report, drifts, headless, ui) {
  var diag = ss.getSheetByName('_LEDGER_RECON') || ss.insertSheet('_LEDGER_RECON');
  diag.clear();
  diag.getRange(1, 1, 1, 4).setValues([['Section', 'Check', 'Value', 'Severity']])
    .setBackground('#0D1B6E').setFontColor('#FFFFFF').setFontWeight('bold');
  if (report.length) {
    diag.getRange(2, 1, report.length, 4).setValues(report);
    report.forEach(function(row, i) {
      var bg = row[3] === 'ERROR' ? '#FFEBEE'
             : row[3] === 'WARN'  ? '#FFF3E0'
             : row[3] === 'FAIL'  ? '#FFCDD2'
             : '#FFFFFF';
      diag.getRange(i + 2, 1, 1, 4).setBackground(bg);
    });
  }
  diag.setFrozenRows(1);
  diag.setTabColor('#00838F');
  [1,2,3,4].forEach(function(c) { diag.setColumnWidth(c, 260); });

  var errorCount = report.filter(function(r) { return r[3] === 'ERROR'; }).length;
  var warnCount  = report.filter(function(r) { return r[3] === 'WARN';  }).length;
  var summary = {
    errors: errorCount,
    warns:  warnCount,
    total:  report.length,
    drifts: drifts
  };
  if (headless) return summary;
  ui.alert('Ledger Reconcile complete',
    report.length + ' checks.\nERROR: ' + errorCount + '  WARN: ' + warnCount +
    '\nDrifts captured: ' + drifts.length + '\n\nSee "_LEDGER_RECON" sheet.',
    ui.ButtonSet.OK);
  return summary;
}
