// _GhostLocationFix.js
// ------------------------------------------------------------
// Converts the "ghost" locations — IDs that STOCK_LEDGER uses but LOCATIONS
// never defined — into real, defined locations. Two independent operations:
//
//   ?diag=ghostfix                 dry run: what WOULD be defined
//   ?diag=ghostfix&confirm=YES     LIVE: append the missing LOCATIONS rows
//
//   ?diag=ghostmerge               dry run: the -AA typo transfers
//   ?diag=ghostmerge&confirm=YES   LIVE: write LOCATION_TRANSFER rows
//
// WHY THIS IS SAFE FOR THE DEFINITIONS: defining a location does NOT move stock.
// The ledger already carries these IDs; adding the row makes the existing rows
// legitimate. No STOCK_LEDGER row is touched, so balances, FIFO and history are
// unchanged — they simply become visible and type-aware.
//
// THE MERGE IS DIFFERENT and is deliberately a separate command: it WRITES stock
// movements. It exists only because the operator confirmed the -AA entries are
// mis-keys of -A and that the material is physically in -A.
//
// Both are idempotent: re-running skips what already exists.
// ------------------------------------------------------------

// Type inferred from what the material master actually assigns to each location
// (?diag=ghostgrade), not from the name:
//   RM-STORE-C  10 mats  BULK/NOS      -> RM
//   RM-STORE-E  78 mats  OUTER/NO'S    -> RM   (most-used default in the system)
//   FG-STORE-A  10 mats  100% FG/KGS   -> FG
//   FG-STORE-B   6 mats  100% FG/LTR   -> FG
//   FG-STORE-C   3 mats  100% FG/LTR   -> FG
//   FG-STORE-F  19 mats  100% FG/KGS   -> FG
//   BUFFER       2 mats  LABELS        -> staging area, kept as its own location
//
// FLOOR: all 'GF' per operator decision (2026-08-04) to match the existing zones
// and unblock the work. Floor is a single-cell edit per row afterwards; it drives
// the multi-floor map, so it must be corrected before that map is built.
var GHOST_LOCATION_DEFS_ = [
  // [id,           floor, section,     label,                      type,  capQty, capUnit]
  ['RM-STORE-C',    'GF', 'Stores',    'RM Store — Bay C',          'RM',   '', ''],
  ['RM-STORE-E',    'GF', 'Stores',    'RM Store — Bay E',          'RM',   '', ''],
  ['FG-STORE-A',    'GF', 'FG',        'FG Store — Bay A',          'FG',   '', ''],
  ['FG-STORE-B',    'GF', 'FG',        'FG Store — Bay B',          'FG',   '', ''],
  ['FG-STORE-C',    'GF', 'FG',        'FG Store — Bay C',          'FG',   '', ''],
  ['FG-STORE-F',    'GF', 'FG',        'FG Store — Bay F',          'FG',   '', ''],
  ['BUFFER',        'GF', 'Stores',    'Staging Buffer',            'RM',   '', '']
];

function ghostLocationFix(confirm) {
  var ss = getSpreadsheet();
  var out = { dryRun: !confirm, wouldAdd: [], added: [], skipped: [], error: null };

  try {
    var ws = ss.getSheetByName('LOCATIONS');
    if (!ws) return { error: 'LOCATIONS sheet not found' };

    // Assert the SHEET width, never a constant. A 12-col contract written into a
    // sheet of a different width is exactly how MASTERS_Materials broke.
    var width = ws.getLastColumn();
    out.sheetWidth = width;
    if (width < 12) {
      return { error: 'LOCATIONS is ' + width + ' cols; expected >= 12. Aborting rather than writing a misaligned row.' };
    }

    var existing = {};
    if (ws.getLastRow() > 1) {
      ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().forEach(function (r) {
        var id = String(r[0] || '').trim();
        if (id) existing[id.toUpperCase()] = true;
      });
    }

    GHOST_LOCATION_DEFS_.forEach(function (g) {
      if (existing[g[0].toUpperCase()]) { out.skipped.push(g[0] + ' (already defined)'); return; }
      // Row shape must match LOCATIONS_HEADERS exactly:
      // ID, Floor, Section, Aisle, Rack, Shelf, Bin, Label, Type, CapQty, CapUnit, Active
      var row = [g[0], g[1], g[2], '', '', '', '', g[3], g[4], g[5], g[6], 'Y'];
      while (row.length < width) row.push('');   // pad to the LIVE width
      if (confirm) { ws.appendRow(row); out.added.push(g[0]); }
      else out.wouldAdd.push({ id: g[0], floor: g[1], type: g[4], label: g[3] });
    });

    out.summary = confirm
      ? ('Defined ' + out.added.length + ' location(s); skipped ' + out.skipped.length + '.')
      : ('DRY RUN — would define ' + out.wouldAdd.length + ', skip ' + out.skipped.length +
         '. No STOCK_LEDGER row is touched: these IDs are already in the ledger, so ' +
         'defining them changes no balance, only makes them legitimate and typed.');
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// ── The -AA typo merge — WRITES STOCK MOVEMENTS ──────────────────────────────
// Operator confirmed (2026-08-04) that RM-STORE-AA / FG-STORE-AA are mis-keys and
// the material is physically in the -A location. Recorded as an explicit
// LOCATION_TRANSFER so the audit trail shows a deliberate correction rather than
// a silent edit. Balances are read live; a zero balance is skipped.
var GHOST_MERGE_PAIRS_ = [
  { from: 'RM-STORE-AA', to: 'RM-STORE-A' },
  { from: 'FG-STORE-AA', to: 'FG-STORE'   }
];

// Has this exact correction already been written? Guards a double-fire of the
// SAME lot within one request — google.script.run retries after a dropped
// response are a documented risk in this codebase, and Phase 2D adds idempotency
// keys to GRN/Rework for the same reason. This endpoint writes real stock
// movements, so it gets the same discipline.
//
// recordLocationTransfer's balance check would ALSO reject a duplicate (the source
// is empty after the first move), but that is an accident of ordering, not a
// guarantee — and it would report "Insufficient stock", which reads like a data
// problem rather than "already done".
function _ghostMergeAlreadyDone_(materialCode, batch, fromLoc, toLoc) {
  try {
    var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
    if (!ws || ws.getLastRow() < 2) return false;
    var d = ws.getDataRange().getValues();
    var h = d[0].map(function (x) { return String(x || '').trim().toLowerCase(); });
    function idx(names) {
      for (var i = 0; i < names.length; i++) { var k = h.indexOf(names[i]); if (k >= 0) return k; }
      for (var j = 0; j < h.length; j++) {
        for (var m = 0; m < names.length; m++) if (h[j].indexOf(names[m]) >= 0) return j;
      }
      return -1;
    }
    var cMat = idx(['material code']), cBat = idx(['batch', 'lot']);
    var cLoc = idx(['location id', 'location']), cRem = idx(['remarks', 'remark']);
    if (cMat < 0 || cLoc < 0) return false;

    var tag = GHOST_MERGE_TAG_;
    for (var r = d.length - 1; r >= 1; r--) {          // newest first
      var row = d[r];
      if (String(row[cMat] || '').trim() !== String(materialCode).trim()) continue;
      if (cBat >= 0 && String(row[cBat] || '').trim() !== String(batch).trim()) continue;
      if (String(row[cLoc] || '').trim().toUpperCase() !== String(toLoc).toUpperCase()) continue;
      if (cRem >= 0 && String(row[cRem] || '').indexOf(tag) >= 0) return true;
    }
  } catch (e) { Logger.log('_ghostMergeAlreadyDone_: ' + e.message); }
  return false;
}

var GHOST_MERGE_TAG_ = '[ghostmerge]';

function ghostLocationMerge(confirm) {
  var out = { dryRun: !confirm, moves: [], error: null };
  try {
    var summary = (typeof getStockSummary === 'function') ? getStockSummary() : [];

    GHOST_MERGE_PAIRS_.forEach(function (pair) {
      summary.forEach(function (s) {
        if (String(s.locationId || '').trim().toUpperCase() !== pair.from) return;
        var qty = Number(s.balance) || 0;
        if (qty <= 0) return;

        var move = {
          materialCode: s.materialCode, batch: s.batchOrLotNo,
          from: pair.from, to: pair.to, qty: qty, status: ''
        };

        if (_ghostMergeAlreadyDone_(s.materialCode, s.batchOrLotNo, pair.from, pair.to)) {
          move.status = 'ALREADY DONE — skipped';
          out.moves.push(move);
          return;
        }
        if (!confirm) { move.status = 'WOULD MOVE'; out.moves.push(move); return; }

        try {
          var res = recordLocationTransfer({
            materialCode:   s.materialCode,
            batchOrLotNo:   s.batchOrLotNo,
            fromLocationId: pair.from,
            toLocationId:   pair.to,
            qty:            qty,
            // The tag is what makes this detectably idempotent — see
            // _ghostMergeAlreadyDone_. Keep it in the remarks text.
            reason:         GHOST_MERGE_TAG_ + ' CORRECTION — mis-keyed location ' + pair.from +
                            ' (confirmed typo of ' + pair.to + ')',
            transferredBy:  'ghostLocationMerge'
          });
          move.status = (res && res.success !== false) ? 'MOVED' : ('FAILED: ' + ((res && res.error) || '?'));
        } catch (e2) { move.status = 'FAILED: ' + e2.message; }
        out.moves.push(move);
      });
    });

    out.summary = confirm
      ? ('Executed ' + out.moves.filter(function (m) { return m.status === 'MOVED'; }).length + ' transfer(s).')
      : ('DRY RUN — ' + out.moves.length + ' transfer(s) would be written. These are REAL stock ' +
         'movements; run again with &confirm=YES only if the material is physically in the -A location.');
  } catch (e) {
    out.error = e.message;
  }
  return out;
}
