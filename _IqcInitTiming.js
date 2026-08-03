// _IqcInitTiming.js
// ------------------------------------------------------------
// READ-ONLY timing probe for getIQCFormInit(), which the suite measured at ~7.5s.
//
// WHY A PROBE FIRST: the backlog assumed the fix was "copy the KpiReadCache
// pattern". That is only correct if the cost is repeat full-sheet reads. This
// attributes the time to each contributor BEFORE any cache is written, so the
// fix targets the measured chokepoint rather than the assumed one.
//
// It also reports a SECOND call in the same execution: with a request-scoped
// memo in place the second call should collapse to ~0ms. Run before and after
// the change to prove the cache is actually wired.
//
// Writes nothing. Safe to run against production.
// ------------------------------------------------------------

function iqcInitTiming() {
  var out = { steps: [], note: '' };

  function timed(label, fn) {
    var t0 = new Date().getTime();
    var val = null, err = null;
    try { val = fn(); } catch (e) { err = e.message; }
    var ms = new Date().getTime() - t0;
    out.steps.push({
      step: label,
      ms: ms,
      size: (val && val.length != null) ? val.length : (val ? 1 : 0),
      error: err
    });
    return val;
  }

  // Individual contributors, in the order getIQCFormInit calls them.
  timed('peekNextDocNumber(iqc)  [CONFIG]', function () { return peekNextDocNumber('iqc'); });
  timed('getUnInspectedGRNs()    [IQC_LOG + GRN_LOG + MASTERS_Suppliers]', function () { return getUnInspectedGRNs(); });
  timed('getInspectors()         [MASTERS_Personnel]', function () { return getInspectors(); });

  // Whole call, twice in the SAME execution — the second reveals memoization.
  timed('getIQCFormInit() call #1', function () { return getIQCFormInit(); });
  timed('getIQCFormInit() call #2 (should be ~0ms once cached)', function () { return getIQCFormInit(); });

  var total = 0;
  out.steps.forEach(function (s) { total += s.ms; });
  out.totalMs = total;

  var c1 = 0, c2 = 0;
  out.steps.forEach(function (s) {
    if (s.step.indexOf('call #1') >= 0) c1 = s.ms;
    if (s.step.indexOf('call #2') >= 0) c2 = s.ms;
  });
  out.note = (c1 > 0 && c2 < c1 * 0.2)
    ? 'CACHED: call #2 collapsed to ' + c2 + 'ms from ' + c1 + 'ms.'
    : 'NOT CACHED: call #2 cost ' + c2 + 'ms vs ' + c1 + 'ms — each call still re-reads.';

  return out;
}
