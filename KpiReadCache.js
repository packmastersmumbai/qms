// KpiReadCache.js
// ------------------------------------------------------------
// Request-scoped memoization for the full-sheet reads the KPI dashboard performs.
//
// MEASURED PROBLEM (2026-08-03): getQmsKpis took 51.7s cold, 2.1s warm. The page sat
// on "Loading summary…" / "Loading…" for ~52s on first load each morning. This had
// been dismissed as suite flake several times, because an isolated run happened to
// hit the warm CacheService entry and passed — the full-suite runs hit it cold.
//
// COST SHAPE: KPI_REGISTRY has 18 KPIs, 6 declaring sparkline:true. _kpiSparkline_
// re-invokes that KPI's function once PER DAY across a 7-day window, so one load runs
// 18 + (6 x 7) = 60 KPI evaluations. Every evaluation calls _pmGetRows_(ss, SHEET),
// which does a full getDataRange().getValues() AND rebuilds the header index. That is
// ~60 full-sheet scans of GRN_LOG / IQC_LOG / OQC_LOG / NCR_LOG per dashboard load.
//
// FIX: memoize _pmGetRows_ itself — the single chokepoint all 23 call sites go
// through. Same approach already proven in ProductionReadCache.js: in Apps Script one
// google.script.run call is a single execution, so a module-global is naturally
// request-scoped. It is born fresh and dies with the call — no TTL, no cross-request
// staleness. Each sheet is read once; the 42 sparkline passes then re-filter an
// in-memory array instead of re-reading.
//
// CORRECTNESS: these are pure read snapshots feeding read-only KPI maths — nothing in
// the KPI path writes. The returned object is SHARED between callers, so callers must
// not mutate it; every current call site only reads (.rows.forEach, .idx lookups).
// kpiReadCacheReset_() is exposed for any future caller that writes then re-reads
// within the same request.
// ------------------------------------------------------------

var _KPI_READ_CACHE = null;

function kpiCache_() {
  if (!_KPI_READ_CACHE) _KPI_READ_CACHE = {};
  return _KPI_READ_CACHE;
}

// Drop the snapshot so later reads in the SAME request see a mutation.
// Nothing calls this today — the KPI path is read-only.
function kpiReadCacheReset_() {
  _KPI_READ_CACHE = null;
}

/**
 * Memoized version of the {hdr, rows, idx} read that every KPI function performs.
 * Returns the identical object instance for repeat calls within one request.
 *
 * Shape is deliberately identical to the original _pmGetRows_, including the
 * { hdr:[], rows:[], idx:{} } empty case, so no call site needs changing.
 */
function kpiRowsCached_(ss, sheetName) {
  var c = kpiCache_();
  if (!c.rows) c.rows = {};
  if (Object.prototype.hasOwnProperty.call(c.rows, sheetName)) return c.rows[sheetName];

  var out = { hdr: [], rows: [], idx: {} };
  try {
    var sh = (ss || getSpreadsheet()).getSheetByName(sheetName);
    if (sh && sh.getLastRow() >= 2) {
      var data = sh.getDataRange().getValues();
      var hdr = data[0].map(function (h) { return String(h || '').trim(); });
      var idx = {};
      hdr.forEach(function (h, i) { idx[h.toLowerCase()] = i; });
      out = { hdr: hdr, rows: data.slice(1), idx: idx };
    }
  } catch (e) {
    out = { hdr: [], rows: [], idx: {} };
  }
  c.rows[sheetName] = out;
  return out;
}
