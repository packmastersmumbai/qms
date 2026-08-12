// ============================================================
// _ZeroQtyBackfill.js — repair the 36 May production rows written with qty 0.
//
//   node e2e-diag.js zeroqtyfix                 → DRY RUN (default, writes nothing)
//   node e2e-diag.js "zeroqtyfix&confirm=YES"   → applies
//
// THE DEFECT (historical, writer already fixed — see ?diag=zeroproddates):
// Between 19-May and 27-May-2026, PROD_CONSUME / PROD_SCRAP / PROD_WASTAGE /
// SCRAP rows were written with BOTH qtyIn and qtyOut = 0 while their Remarks
// recorded the real amount ("Consumed 36.424 KG (booking …)"). Stock left the
// floor and the ledger never debited it: 111.613 KG + 504.983 PC.
//
// WHY BACKFILL RATHER THAN POST CORRECTIONS: the owner chose in-place repair so
// the May rows read correctly in history instead of a May shortfall reappearing
// as a today-dated spike.
//
// WHAT MAKES THIS SAFE TO DO IN PLACE:
//   - Only the qtyOut cell of an already-zero row is touched. No row is added,
//     deleted or re-dated, and no non-zero quantity is ever overwritten.
//   - BalanceAfter is recomputed for the repaired row AND every later row that
//     shares its material|batch|location key — otherwise the ledger would be
//     arithmetically inconsistent, which ?diag=ledgeraudit would (correctly)
//     start failing on.
//   - The quantity is parsed from the row's own Remark, never inferred.
//   - A row whose Remark carries no parseable number is SKIPPED, not guessed.
//   - Dry run prints every intended change first; ?diag=backupsheets snapshot
//     is taken before applying.
// ============================================================

var ZQ_COL_ = { TXN:0, DATE:1, TYPE:2, MAT:3, BATCH:4, LOC:5,
                IN:6, OUT:7, BAL:8, REFTYPE:9, REFNO:10, OP:11, REMARK:12, DESC:13 };

// Only these types are repairable. Each is a DEBIT (stock leaving), so the
// recovered amount belongs in qtyOut. Anything else is left alone.
var ZQ_TYPES_ = { PROD_CONSUME:1, PROD_SCRAP:1, PROD_WASTAGE:1, PROD_LOSS:1 };

function _zqPad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function _zqNum_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

// "Consumed 36.424 KG (booking PM/PROD/2026-020-BK)" → 36.424
// Anchored to the leading verb so a number inside the booking id can never win.
function _zqQtyFromRemark_(remark) {
  var m = String(remark || '')
    .match(/^\s*(?:Consumed|Scrap|Wastage|Loss)\s+([\d.]+)\s/i);
  if (!m) return null;
  var q = Number(m[1]);
  return (isFinite(q) && q > 0) ? q : null;
}

function zeroQtyBackfill(apply) {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws) return 'STOCK_LEDGER not found';
  var n = ws.getLastRow() - 1;
  if (n < 1) return 'STOCK_LEDGER is empty';

  var vals = ws.getRange(2, 1, n, 14).getValues();
  var out = ['ZERO-QTY PRODUCTION BACKFILL' + (apply ? '  [APPLYING]' : '  [DRY RUN]'), ''];

  // ── Pass 1: identify repairable rows ──────────────────────────────────
  var fixes = [], skipped = [], totals = {};
  vals.forEach(function (r, i) {
    var type = String(r[ZQ_COL_.TYPE] || '').trim();
    if (!ZQ_TYPES_[type]) return;
    if (_zqNum_(r[ZQ_COL_.IN]) || _zqNum_(r[ZQ_COL_.OUT])) return;   // already has a qty

    var qty = _zqQtyFromRemark_(r[ZQ_COL_.REMARK]);
    if (qty == null) {
      skipped.push('row ' + (i + 2) + '  ' + _zqPad_(type, 14) +
                   'no parseable qty in: "' + String(r[ZQ_COL_.REMARK]).slice(0, 50) + '"');
      return;
    }
    var unit = (String(r[ZQ_COL_.REMARK]).match(/^\s*\w+\s+[\d.]+\s+(\S+)/) || [])[1] || '?';
    totals[unit] = (totals[unit] || 0) + qty;
    fixes.push({ rowIdx: i, sheetRow: i + 2, type: type, qty: qty, unit: unit,
                 key: String(r[ZQ_COL_.MAT]).trim() + '|' + String(r[ZQ_COL_.BATCH]).trim() +
                      '|' + String(r[ZQ_COL_.LOC]).trim(),
                 mat: String(r[ZQ_COL_.MAT]).trim(), ref: String(r[ZQ_COL_.REFNO]).trim() });
  });

  out.push('repairable rows: ' + fixes.length + '   skipped: ' + skipped.length);
  Object.keys(totals).forEach(function (u) {
    out.push('   ' + _zqPad_('debit ' + u, 16) + Math.round(totals[u] * 1000) / 1000);
  });
  out.push('');
  fixes.forEach(function (f) {
    out.push('   ' + _zqPad_('row ' + f.sheetRow, 10) + _zqPad_(f.type, 14) +
             _zqPad_(f.mat, 12) + _zqPad_(f.ref, 22) + 'qtyOut 0 -> ' + f.qty + ' ' + f.unit);
  });
  if (skipped.length) {
    out.push('');
    out.push('SKIPPED (left untouched — no guessing):');
    skipped.forEach(function (s) { out.push('   ' + s); });
  }
  if (!fixes.length) { out.push(''); out.push('Nothing to do.'); return out.join('\n'); }

  // ── Pass 2: recompute BalanceAfter for every affected key ─────────────
  // A repaired debit shifts the running balance of its key for that row and
  // EVERY later row sharing the key. Recompute the whole ledger's running
  // balances with the fixes applied, then write back only the cells that move.
  var fixByIdx = {};
  fixes.forEach(function (f) { fixByIdx[f.rowIdx] = f.qty; });

  var running = {}, balUpdates = [];
  vals.forEach(function (r, i) {
    var key = String(r[ZQ_COL_.MAT]).trim() + '|' + String(r[ZQ_COL_.BATCH]).trim() +
              '|' + String(r[ZQ_COL_.LOC]).trim();
    var qIn  = _zqNum_(r[ZQ_COL_.IN]);
    var qOut = fixByIdx.hasOwnProperty(i) ? fixByIdx[i] : _zqNum_(r[ZQ_COL_.OUT]);
    var bal  = (running[key] || 0) + qIn - qOut;
    running[key] = bal;
    if (Math.abs(bal - _zqNum_(r[ZQ_COL_.BAL])) > 0.001) {
      balUpdates.push({ sheetRow: i + 2, from: _zqNum_(r[ZQ_COL_.BAL]), to: bal,
                        type: String(r[ZQ_COL_.TYPE]), key: key });
    }
  });

  out.push('');
  out.push('BalanceAfter cells to rewrite: ' + balUpdates.length +
           '   (the ' + fixes.length + ' repaired rows plus every later row on the same lot)');
  balUpdates.slice(0, 15).forEach(function (b) {
    out.push('   ' + _zqPad_('row ' + b.sheetRow, 10) + _zqPad_(b.type, 20) +
             b.from + ' -> ' + b.to);
  });
  if (balUpdates.length > 15) out.push('   … and ' + (balUpdates.length - 15) + ' more');

  // Negative balances the repair introduces or deepens — the honest consequence
  // of debiting stock that was consumed but never recorded.
  var negNow = 0;
  Object.keys(running).forEach(function (k) { if (running[k] < -0.001) negNow++; });
  out.push('');
  out.push('negative-balance keys AFTER repair: ' + negNow);

  if (!apply) {
    out.push('');
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES to apply.');
    return out.join('\n');
  }

  // ── Apply ─────────────────────────────────────────────────────────────
  // Single-cell setValue per change: the rows are scattered, and a full-column
  // rewrite would risk clobbering concurrent writes from a live save.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return out.join('\n') + '\n\nABORTED — could not acquire lock.';
  try {
    fixes.forEach(function (f) {
      ws.getRange(f.sheetRow, ZQ_COL_.OUT + 1).setValue(f.qty);
    });
    balUpdates.forEach(function (b) {
      ws.getRange(b.sheetRow, ZQ_COL_.BAL + 1).setValue(b.to);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // The balance memo and any cached reads are now stale.
  try { if (typeof prodCacheReset_ === 'function') prodCacheReset_(); } catch (e) {}
  try { if (typeof invalidatePmCache_ === 'function') invalidatePmCache_(); } catch (e) {}

  out.push('');
  out.push('APPLIED — ' + fixes.length + ' qtyOut cells and ' +
           balUpdates.length + ' BalanceAfter cells rewritten.');
  out.push('Caches invalidated. Re-run ?diag=ledgeraudit to confirm arithmetic.');
  return out.join('\n');
}
