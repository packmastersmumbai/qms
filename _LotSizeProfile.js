// _LotSizeProfile.js
// ------------------------------------------------------------
// READ-ONLY. Profiles ACTUAL received/inspected lot sizes so the sampling
// default is chosen from real data instead of an assumption.
//
// The operator's claim is "we hardly receive large quantity items". If true,
// most lots fall in the small code letters where Level II already samples very
// few units, and dropping to Level I saves little. If false, the saving is
// large. Either way the decision should be made on the distribution, not a
// recollection.
//
// Reports, for GRN_LOG receipt quantities and IQC_LOG lot sizes:
//   - the distribution across ISO 2859-1 code-letter bands
//   - total units that WOULD be inspected under Level II vs Level I
//     (using the engine's own getSamplingPlan, at the current AQL 2.5)
// Writes nothing.
// ------------------------------------------------------------

function lotSizeProfile() {
  var ss = getSpreadsheet();
  var out = { grn: null, iqc: null, error: null };

  function summarize(label, nums) {
    if (!nums.length) return { label: label, count: 0 };

    nums.sort(function (a, b) { return a - b; });
    var bands = [
      ['1-50', 1, 50], ['51-150', 51, 150], ['151-500', 151, 500],
      ['501-1200', 501, 1200], ['1201-3200', 1201, 3200],
      ['3201-10000', 3201, 10000], ['10001+', 10001, Infinity]
    ];
    var dist = bands.map(function (b) {
      var n = nums.filter(function (v) { return v >= b[1] && v <= b[2]; }).length;
      return { band: b[0], lots: n, pct: Math.round(n * 1000 / nums.length) / 10 };
    });

    // What the engine actually prescribes, at the CURRENT AQL, for each lot.
    var totII = 0, totI = 0, capped = 0;
    nums.forEach(function (lot) {
      var p2 = getSamplingPlan(lot, '2.5', 'II');
      var p1 = getSamplingPlan(lot, '2.5', 'I');
      if (p2 && !p2.error) totII += p2.sampleSize;
      if (p1 && !p1.error) totI += p1.sampleSize;
      // "capped" = sample size hit the lot size, i.e. 100% inspection anyway.
      if (p1 && !p1.error && p1.sampleSize >= lot) capped++;
    });

    return {
      label: label,
      count: nums.length,
      min: nums[0],
      median: nums[Math.floor(nums.length / 2)],
      p90: nums[Math.floor(nums.length * 0.9)],
      max: nums[nums.length - 1],
      distribution: dist,
      unitsInspected_LevelII: totII,
      unitsInspected_LevelI: totI,
      unitsSaved: totII - totI,
      pctSaved: totII ? Math.round((1 - totI / totII) * 1000) / 10 : 0,
      lotsWhereLevelIIsFullInspection: capped
    };
  }

  try {
    // GRN_LOG col 9 (0-based) = received qty in this schema; fall back scan.
    var gws = ss.getSheetByName('GRN_LOG');
    if (gws && gws.getLastRow() > 1) {
      var gd = gws.getDataRange().getValues();
      var hdr = gd[0].map(function (h) { return String(h || '').toLowerCase(); });
      var qi = -1;
      hdr.forEach(function (h, i) {
        if (qi < 0 && (h.indexOf('qty') >= 0 || h.indexOf('quantity') >= 0)) qi = i;
      });
      var gnums = [];
      if (qi >= 0) {
        gd.slice(1).forEach(function (r) {
          var v = parseFloat(r[qi]);
          if (!isNaN(v) && v > 0) gnums.push(v);
        });
      }
      out.grn = summarize('GRN_LOG received qty (col ' + qi + ': ' + (qi >= 0 ? gd[0][qi] : 'NOT FOUND') + ')', gnums);
    }

    var iws = ss.getSheetByName('IQC_LOG');
    if (iws && iws.getLastRow() > 1) {
      var id = iws.getDataRange().getValues();
      var ih = id[0].map(function (h) { return String(h || '').toLowerCase(); });
      var li = -1;
      ih.forEach(function (h, i) { if (li < 0 && h.indexOf('lot size') >= 0) li = i; });
      if (li < 0) ih.forEach(function (h, i) { if (li < 0 && h.indexOf('lot') >= 0) li = i; });
      var inums = [];
      if (li >= 0) {
        id.slice(1).forEach(function (r) {
          var v = parseFloat(r[li]);
          if (!isNaN(v) && v > 0) inums.push(v);
        });
      }
      out.iqc = summarize('IQC_LOG lot size (col ' + li + ': ' + (li >= 0 ? id[0][li] : 'NOT FOUND') + ')', inums);
    }
  } catch (e) {
    out.error = e.message;
  }

  return out;
}
