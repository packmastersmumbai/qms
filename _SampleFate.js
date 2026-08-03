// _SampleFate.js
// ------------------------------------------------------------
// READ-ONLY. Answers "what happens to the samples after inspection?" from the
// live ledger rather than from the code's intent.
//
// recordSample writes a PAIRED move: SAMPLE_OUT from the receiving location,
// SAMPLE_IN to SAMPLE-CABINET. Nothing in the codebase ever writes a move OUT
// of SAMPLE-CABINET — no return-to-stock, no consumption, no scrap, no
// disposition. If that is true, the cabinet balance only ever grows, and this
// reports by how much.
// ------------------------------------------------------------

function sampleFate() {
  var ss = getSpreadsheet();
  var out = { cabinet: {}, totals: {}, txnTypes: {}, sampleLog: {}, note: '' };

  try {
    // ---- STOCK_LEDGER: everything touching SAMPLE-CABINET ----
    var ws = ss.getSheetByName('STOCK_LEDGER');
    if (ws && ws.getLastRow() > 1) {
      var d = ws.getDataRange().getValues();
      var h = d[0].map(function (x) { return String(x || '').trim().toLowerCase(); });
      var cType = h.indexOf('txn type'), cLoc = h.indexOf('location id');
      var cQty  = h.indexOf('qty'),      cMat = h.indexOf('material code');
      if (cType < 0) h.forEach(function (x, i) { if (cType < 0 && x.indexOf('type') >= 0) cType = i; });
      if (cLoc  < 0) h.forEach(function (x, i) { if (cLoc  < 0 && x.indexOf('location') >= 0) cLoc = i; });
      if (cQty  < 0) h.forEach(function (x, i) { if (cQty  < 0 && x.indexOf('qty') >= 0) cQty = i; });

      var inQty = 0, outQty = 0, rows = 0, mats = {};
      d.slice(1).forEach(function (r) {
        var loc = String(r[cLoc] || '').trim().toUpperCase();
        var typ = String(r[cType] || '').trim().toUpperCase();
        if (typ) out.txnTypes[typ] = (out.txnTypes[typ] || 0) + 1;
        if (loc.indexOf('SAMPLE') < 0) return;
        rows++;
        var q = Number(r[cQty]) || 0;
        if (q >= 0) inQty += q; else outQty += Math.abs(q);
        var m = String(r[cMat] || '').trim();
        if (m) mats[m] = (mats[m] || 0) + q;
      });

      out.cabinet = {
        ledgerRowsTouchingSample: rows,
        totalIn: inQty,
        totalOut: outQty,
        netHeld: inQty - outQty,
        distinctMaterials: Object.keys(mats).length
      };
    }

    // ---- SAMPLE_LOG: how many pulls, and is there any disposition column? ----
    var sl = ss.getSheetByName('SAMPLE_LOG');
    if (sl && sl.getLastRow() > 1) {
      var sd = sl.getDataRange().getValues();
      var shdr = sd[0].map(function (x) { return String(x || '').trim(); });
      var qi = shdr.map(function (x) { return x.toLowerCase(); }).indexOf('qty sample');
      var tot = 0;
      sd.slice(1).forEach(function (r) { tot += Number(r[qi]) || 0; });
      out.sampleLog = {
        headers: shdr,
        pulls: sd.length - 1,
        totalQtyPulled: tot,
        hasDispositionColumn: shdr.some(function (x) {
          return /disposition|status|returned|consumed|scrapp?ed|fate/i.test(x);
        })
      };
    }
  } catch (e) {
    out.error = e.message;
  }

  out.note = 'A SAMPLE-CABINET balance that only grows, with no disposition ' +
             'column in SAMPLE_LOG, confirms samples are pulled and never ' +
             'formally closed out.';
  return out;
}
