// TraceReadCache.js
// ------------------------------------------------------------
// Request-scoped memoization for Trace's full-sheet reads.
//
// MEASURED 2026-08-13 (?diag=perftrace, ?diag=sheetoverhead):
//   traceBatch()                6475ms
//   the 13 sheets read ONCE     6206ms
//   traceBatch() 2nd, same exec   14ms   (already cached at the result level)
//
// So the cost is entirely the reads, and the reads are dominated by FIXED
// per-call overhead rather than data volume:
//   CUSTOMER_RETURN_LOG    3 rows -> 493, 619, 328, 305, 348ms across 5 reads
//   STOCK_LEDGER        1281 rows -> 650ms
//   STOCK_LEDGER         1 cell   -> 189ms
//   getSheetByName x10             ->  12ms   (opening a tab is free)
// A 3-row sheet costs about as much as a 1281-row one, and re-reading the same
// sheet never gets cheaper. The bottleneck is the number of getValues() round
// trips, not how much they return.
//
// Trace makes 26 such calls across 13 sheets (PROD_JOBS six times). Memoizing
// them to one read each removes ~13 round trips outright.
//
// Same lifetime rule as ProductionReadCache: in Apps Script one
// google.script.run / doGet call is a single execution, so a module-global is
// naturally per-request — it is born fresh and dies with the call. No TTL, no
// cross-request staleness.
//
// Correctness: Trace is READ-ONLY. It never writes to any of these sheets, so
// unlike the production cache there is no reset point to get wrong. If a future
// change makes Trace write, add traceCacheReset_() after that write.
// ------------------------------------------------------------

var _TRACE_READ_CACHE = null;

function traceCache_() {
  if (!_TRACE_READ_CACHE) _TRACE_READ_CACHE = {};
  return _TRACE_READ_CACHE;
}

/** Drop the snapshot. Call after any write to a traced sheet. */
function traceCacheReset_() { _TRACE_READ_CACHE = null; }

/**
 * Full values of a sheet, read at most once per request.
 * Returns [] for a missing or empty sheet so callers can treat it uniformly —
 * several Trace walkers already guard on `.length`.
 */
function traceValues_(sheetName) {
  var c = traceCache_();
  if (c.hasOwnProperty(sheetName)) return c[sheetName];
  var out = [];
  try {
    var sh = getSpreadsheet().getSheetByName(sheetName);
    if (sh && sh.getLastRow() > 0) out = sh.getDataRange().getValues();
  } catch (e) {
    Logger.log('traceValues_(' + sheetName + '): ' + e.message);
  }
  c[sheetName] = out;
  return out;
}

/** How many reads did this request avoid? For ?diag=perftrace. */
function traceCacheStats_() {
  var c = _TRACE_READ_CACHE || {};
  var names = Object.keys(c);
  return { sheets: names.length, names: names.join(', ') };
}
