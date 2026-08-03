// _GrnEquivCheck.js
// ------------------------------------------------------------
// READ-ONLY equivalence proof for the getRecentGRNs rewrite (2026-08-04).
//
// The rewrite replaced "map every row -> reverse -> dedupe -> slice(0,30)"
// with "walk backwards -> dedupe -> stop at 30 -> map". The commit claimed the
// output was byte-identical. That claim was reasoned, not tested — veritas
// flagged it as unverified, correctly.
//
// This runs the OLD algorithm and the NEW algorithm against the SAME live
// GRN_LOG snapshot in one execution and deep-compares the results. It proves
// or disproves the claim on real production data instead of arguing about it.
//
// Writes nothing.
// ------------------------------------------------------------

function grnEquivCheck() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('GRN_LOG');
  if (!ws) return { error: 'GRN_LOG not found' };
  var data = ws.getDataRange().getValues();
  if (data.length < 2) return { error: 'GRN_LOG has no data rows' };

  var emailMap = {};
  try {
    var suppWs = ss.getSheetByName('MASTERS_Suppliers');
    if (suppWs && suppWs.getLastRow() > 1) {
      suppWs.getDataRange().getValues().slice(1).forEach(function (r) {
        if (r[0]) emailMap[String(r[0]).trim()] = String(r[4] || '').trim();
      });
    }
  } catch (e) {}

  function build(r) {
    return {
      grnNo:         r[0],
      date:          r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
      supplierCode:  String(r[2] || '').trim(),
      supplierName:  r[3],
      supplierEmail: emailMap[String(r[2] || '').trim()] || '',
      material:      r[7],
      batch:         r[8],
      iqcStatus:     r[15] || 'PENDING'
    };
  }

  // ---- OLD: map all -> reverse -> dedupe -> slice(0,30) ----
  var oldMapped = data.slice(1).filter(function (r) { return r[0]; }).map(build).reverse();
  var oldSeen = {}, oldDeduped = [];
  oldMapped.forEach(function (g) {
    if (!oldSeen[g.grnNo]) { oldSeen[g.grnNo] = true; oldDeduped.push(g); }
  });
  var oldOut = oldDeduped.slice(0, 30);

  // ---- NEW: walk backwards -> dedupe -> stop at 30 -> map ----
  var newSeen = {}, picked = [];
  for (var i = data.length - 1; i >= 1 && picked.length < 30; i--) {
    var r = data[i];
    if (!r[0]) continue;
    if (newSeen[r[0]]) continue;
    newSeen[r[0]] = true;
    picked.push(r);
  }
  var newOut = picked.map(build);

  // ---- Deep compare ----
  var diffs = [];
  if (oldOut.length !== newOut.length) {
    diffs.push('LENGTH: old=' + oldOut.length + ' new=' + newOut.length);
  }
  var n = Math.min(oldOut.length, newOut.length);
  for (var j = 0; j < n; j++) {
    var a = JSON.stringify(oldOut[j]), b = JSON.stringify(newOut[j]);
    if (a !== b) diffs.push('INDEX ' + j + ':\n  old=' + a + '\n  new=' + b);
  }

  return {
    totalDataRows: data.length - 1,
    oldCount: oldOut.length,
    newCount: newOut.length,
    identical: diffs.length === 0,
    diffCount: diffs.length,
    diffs: diffs.slice(0, 10),
    firstGrnOld: oldOut.length ? String(oldOut[0].grnNo) : '',
    firstGrnNew: newOut.length ? String(newOut[0].grnNo) : '',
    lastGrnOld:  oldOut.length ? String(oldOut[oldOut.length - 1].grnNo) : '',
    lastGrnNew:  newOut.length ? String(newOut[newOut.length - 1].grnNo) : ''
  };
}
