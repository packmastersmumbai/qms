// ProductionReadCache.js
// ------------------------------------------------------------
// Request-scoped memoization for the heavy full-sheet reads that the
// production issue-plan flow performs once PER COMPONENT PER PASS.
//
// In Apps Script, one google.script.run / doGet call is a single script
// execution: module-globals are born fresh and die when the call returns
// (same lifetime as _SS_CACHE in Code.js). So caching in a module-global is
// naturally per-request — no staleness across requests, no TTL to reason about.
//
// Before: previewProductionPickList over an N-component FG re-read STOCK_LEDGER,
// GRN_LOG, IQC_LOG and LOCATIONS ~2N times each (~6N full-sheet scans).
// After: each of those sheets is read at most once per request; every
// getProductionLotsForMaterial / getFIFOLots / getStockForComponents_ call
// reuses the snapshot. ~6N scans → ~4 total.
//
// Correctness: these are pure read snapshots. Any function that WRITES to a
// cached sheet (issue, booking, reversal) must call prodCacheReset_() so a
// subsequent read in the same request re-reads fresh. The issue-plan flow
// reads-then-writes-then-returns, so the reset points are the write helpers.
// ------------------------------------------------------------

var _PROD_READ_CACHE = null;

function prodCache_() {
  if (!_PROD_READ_CACHE) _PROD_READ_CACHE = {};
  return _PROD_READ_CACHE;
}

// Call after any STOCK_LEDGER / GRN_LOG / IQC_LOG write so later reads in the
// same request see the mutation. Cheap — just drops the snapshot.
function prodCacheReset_() {
  _PROD_READ_CACHE = null;
}

// STOCK_LEDGER rollup (balance per material|batch|location, balance>0).
// Single full read; identical output to Warehouse.getStockSummary().
function prodStockSummary_() {
  var c = prodCache_();
  if (c.stockSummary) return c.stockSummary;
  c.stockSummary = getStockSummary();
  return c.stockSummary;
}

// MASTERS_Materials: code → Category. Backs the DERIVED `type` in getBomRows_,
// which replaced BOM col K (23 spellings for the ~20 values this column already
// holds). Memoised for the same reason everything else here is: getBomRows_ maps
// ~195 rows, and a per-row sheet read is exactly the N-full-scans shape that
// made the issue-plan slow (see the module header).
function prodMatCategories_() {
  var c = prodCache_();
  if (c.matCategories) return c.matCategories;
  var map = {};
  try {
    var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
    if (ws && ws.getLastRow() > 1) {
      ws.getDataRange().getValues().slice(1).forEach(function (r) {
        var code = String(r[MAT_COL.CODE] || '').trim();
        if (code) map[code] = String(r[MAT_COL.CATEGORY] || '').trim();
      });
    }
  } catch (e) { Logger.log('prodMatCategories_: ' + e.message); }
  c.matCategories = map;
  return map;
}

// Component code → its material Category. Empty string when unresolved, so the
// caller can fall back to whatever BOM col K still holds.
function _bomTypeFor_(compCode) {
  if (!compCode) return '';
  return prodMatCategories_()[compCode] || '';
}

// MASTERS_Materials: code → Unit. Backs the issue-plan UoM coherence check.
// Stock balances come out of STOCK_LEDGER in the MASTER's unit, while the BOM's
// `consum` is expressed in the BOM's Comp UoM. When those two disagree,
// `required = consum * qty` and `available` are different quantities and the
// subtraction is meaningless — see prodUomMismatch_. Same memo rationale as
// prodMatCategories_: one read, not one per BOM row.
function prodMatUnits_() {
  var c = prodCache_();
  if (c.matUnits) return c.matUnits;
  var map = {};
  try {
    var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
    if (ws && ws.getLastRow() > 1) {
      ws.getDataRange().getValues().slice(1).forEach(function (r) {
        var code = String(r[MAT_COL.CODE] || '').trim();
        if (code) map[code] = String(r[MAT_COL.UNIT] || '').trim();
      });
    }
  } catch (e) { Logger.log('prodMatUnits_: ' + e.message); }
  c.matUnits = map;
  return map;
}

// Does this component's BOM unit disagree with its material master unit?
// Returns '' when coherent (or when either side is unknown — an unresolved code
// or a blank unit is a different problem, and blocking on it would stop
// production for a data gap that is not an arithmetic error). Otherwise returns
// the master unit, so the caller can name both units in its message.
function prodUomMismatch_(compCode, bomUom) {
  var bu = String(bomUom || '').trim().toUpperCase();
  if (!compCode || !bu) return '';
  var mu = String(prodMatUnits_()[compCode] || '').trim();
  if (!mu) return '';
  return mu.toUpperCase() === bu ? '' : mu;
}

// MASTERS_Customers: UPPERCASED name → code, and code → code. Backs the
// clientCode resolved in getBomRows_ so production can filter FG by a stable
// code instead of a display name. Same memo rationale as prodMatCategories_.
function prodCustomerCodes_() {
  var c = prodCache_();
  if (c.custCodes) return c.custCodes;
  var map = {};
  try {
    var ws = getSpreadsheet().getSheetByName('MASTERS_Customers');
    if (ws && ws.getLastRow() > 1) {
      ws.getDataRange().getValues().slice(1).forEach(function (r) {
        var code = String(r[0] || '').trim();
        var name = String(r[1] || '').trim();
        if (!code) return;
        map[code.toUpperCase()] = code;
        if (name) map[name.toUpperCase()] = code;
      });
    }
  } catch (e) { Logger.log('prodCustomerCodes_: ' + e.message); }
  c.custCodes = map;
  return map;
}

// BOM.Client (a display name) → customer CODE. '' when unmatched, so a BOM row
// referencing a client absent from the master degrades to name-only matching
// rather than vanishing from the FG list.
function _bomClientCodeFor_(clientName) {
  if (!clientName) return '';
  return prodCustomerCodes_()[clientName.toUpperCase()] || '';
}

// LOCATIONS: id → type (upper). One read; used to exclude quarantine/scrap/sample.
function prodLocTypes_() {
  var c = prodCache_();
  if (c.locTypes) return c.locTypes;
  var map = {};
  var ws = getSpreadsheet().getSheetByName('LOCATIONS');
  if (ws && ws.getLastRow() > 1) {
    ws.getRange(2, 1, ws.getLastRow() - 1, 12).getValues().forEach(function(r){
      if (r[0]) map[String(r[0]).trim()] = String(r[8] || '').toUpperCase();
    });
  }
  c.locTypes = map;
  return map;
}

// GRN_LOG: batch/lot → first GRN docNo, and batch/lot → GRN date.
// One read serves both the disposition-join and the FIFO date-sort.
function prodGrnByBatch_() {
  var c = prodCache_();
  if (c.grnByBatch) return c;
  var grnNoByBatch = {};   // for a given material we still filter by mat at call site
  var grnDateByBatch = {};
  var grnNoByMatBatch = {}; // 'mat|batch' → grnNo (disposition join is material-scoped)
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (ws && ws.getLastRow() > 1) {
    var g = ws.getDataRange().getValues();
    for (var i = 1; i < g.length; i++) {
      var mat   = String(g[i][6] || '').trim();
      var batch = String(g[i][8] || '').trim();
      if (!batch) continue;
      if (grnDateByBatch[batch] === undefined) grnDateByBatch[batch] = g[i][1];
      var mk = mat + '|' + batch;
      if (grnNoByMatBatch[mk] === undefined) grnNoByMatBatch[mk] = String(g[i][0] || '').trim();
    }
  }
  c.grnByBatch = { dateByBatch: grnDateByBatch, noByMatBatch: grnNoByMatBatch };
  return c;
}

// IQC_LOG: 'GRN|batch' → latest disposition (upper). One read.
// Keyed per BATCH (col 3 ref + col 6 batch), NOT per GRN — a single GRN can hold
// multiple batches with different dispositions, so keying by GRN alone would let
// an ACCEPTED sibling batch flip a REJECTED batch to issuable. Latest row wins.
function prodDispByGRN_() {
  var c = prodCache_();
  if (c.dispByGRN) return c.dispByGRN;
  var map = {};
  var ws = getSpreadsheet().getSheetByName('IQC_LOG');
  if (ws && ws.getLastRow() > 1) {
    var iq = ws.getDataRange().getValues();
    for (var j = iq.length - 1; j >= 1; j--) {
      var ref   = String(iq[j][2] || '').trim();
      var batch = String(iq[j][5] || '').trim();
      if (!ref) continue;
      var key = ref + '|' + batch;
      if (map[key] === undefined) map[key] = String(iq[j][22] || '').toUpperCase();
    }
  }
  c.dispByGRN = map;
  return map;
}
