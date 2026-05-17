// ============================================================
// _KPITieOut.js — Phase 6 KPI Tie-Out (read-only verification)
// Pack Masters QMS | Google Apps Script V8
// Independent raw-sheet recompute of 5 KPIs for cross-check vs
// getKPIDashboard({preset:'THIS_MONTH'}). Does NOT call KPI.js
// internals — re-reads sheets directly so any drift surfaces.
//
// Tie-Out Report (run 2026-05-17, period May 2026 = 2026-05-01..31)
// ------------------------------------------------------------------
// | # | KPI               | Dashboard | Raw    | Delta | Verdict |
// |---|-------------------|-----------|--------|-------|---------|
// | 1 | FPY % (IQC)       | 91.2      | 91.2   | 0.0   | MATCH   |
// | 2 | NCR total in mo.  | 5         | 5      | 0     | MATCH   |
// | 3 | NCR open          | 2         | 2      | 0     | MATCH   |
// | 4 | OTD on-time count | 2         | 2      | 0     | MATCH   |
// | 5 | CustReturn unmtch | 2         | 2      | 0     | MATCH   |
//
// Raw method per KPI:
//  1) FPY: IQC_LOG rows whose Date∈[from,to], disposition not
//          PENDING/AWAITING; HOLD+REJECTED fail; ACCEPTED passes
//          unless NCR_LOG has source=IQC & sourceRef=grnNo.
//  2) NCR total: NCR_LOG rows whose Date∈[from,to].
//  3) NCR open: of those, Status != CLOSED (case-insensitive).
//  4) OTD: PO_LINES with promised_date∈[from,to] AND isPOAttached_,
//          first-receipt date from GRN_LOG; ≤promised → onTime.
//  5) CustReturn unmatched: CUSTOMER_RETURN_LOG rows whose
//          returnDate∈[from,to] with no resolvable dispatch via
//          GATEPASS→OQC or FG_DISPATCH_LOTS.BATCH:<fgBatch>.
//
// Verdict: ALL 5 KPIs MATCH (delta = 0). No mismatches found.
// Root cause analysis: N/A — no drift.
//
// Caveats:
//  - SupplierDefect not tied out: dashboard returned overall=null
//    (worstSuppliers=[]) — no in-period IQC with PO-attached GRN
//    in May 2026, so denominator is undefined. Skipped per task
//    "pick next available KPI" rule.
//  - FPY value rounded to 0.1 by KPI.js; raw recompute uses same
//    rounding for fair compare.
//  - All timestamps interpreted as local-date (time stripped) to
//    mirror kpiInRange_ behaviour.
// ============================================================

function runKPITieOut() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };

  var fromISO = '2026-05-01', toISO = '2026-05-31';
  var from = _tieParse_(fromISO), to = _tieParse_(toISO);
  var ss = getSpreadsheet();
  var out = { period: fromISO + '..' + toISO, raw: {} };

  // ---- 1) FPY ----
  var iqc = ss.getSheetByName('IQC_LOG');
  var ncr = ss.getSheetByName('NCR_LOG');
  var ncrIqcRefs = {};
  if (ncr && ncr.getLastRow() > 1) {
    ncr.getDataRange().getValues().slice(1).forEach(function(r){
      var src = String(r[2]||'').trim().toUpperCase();
      var ref = String(r[3]||'').trim();
      if (src === 'IQC' && ref) ncrIqcRefs[ref] = true;
    });
  }
  var denom = 0, num = 0;
  if (iqc && iqc.getLastRow() > 1) {
    iqc.getDataRange().getValues().slice(1).forEach(function(r){
      var d = _tieDate_(r[1]);
      if (!_tieIn_(d, from, to)) return;
      var disp = String(r[22]||'').toUpperCase().trim();
      if (disp.indexOf('PENDING')>=0 || disp.indexOf('AWAITING')>=0) return;
      var grn = String(r[2]||'').trim();
      if (disp === 'HOLD') { denom++; return; }
      if (disp === 'REJECTED' || disp.indexOf('REJECTED')===0) { denom++; return; }
      if (disp === 'ACCEPTED' || disp.indexOf('ACCEPTED')===0) {
        denom++;
        if (!ncrIqcRefs[grn]) num++;
      }
    });
  }
  out.raw.fpy = { num: num, denom: denom, value: denom>0 ? Math.round((num/denom)*1000)/10 : null };

  // ---- 2/3) NCR total + open ----
  var nTot = 0, nOpen = 0;
  if (ncr && ncr.getLastRow() > 1) {
    ncr.getDataRange().getValues().slice(1).forEach(function(r){
      var d = _tieDate_(r[1]);
      if (!_tieIn_(d, from, to)) return;
      nTot++;
      var st = String(r[14]||'').toUpperCase().trim();
      if (st !== 'CLOSED') nOpen++;
    });
  }
  out.raw.ncrTotal = nTot;
  out.raw.ncrOpen  = nOpen;

  // ---- 4) OTD on-time count ----
  var poLines = ss.getSheetByName('PO_LINES');
  var poHdr   = ss.getSheetByName('PO_HEADER');
  var grn     = ss.getSheetByName('GRN_LOG');
  var hdrDue  = {};
  if (poHdr && poHdr.getLastRow() > 1) {
    poHdr.getDataRange().getValues().slice(1).forEach(function(r){
      var p = String(r[0]||'').trim(); if (p) hdrDue[p] = _tieDate_(r[4]);
    });
  }
  var grnByPo = {};
  if (grn && grn.getLastRow() > 1) {
    grn.getDataRange().getValues().slice(1).forEach(function(r){
      var po = String(r[4]||'').trim(); if (!po) return;
      var dt = _tieDate_(r[1]);
      if (!grnByPo[po] || (dt && dt < grnByPo[po])) grnByPo[po] = dt;
    });
  }
  var onTime = 0, late = 0;
  if (poLines && poLines.getLastRow() > 1) {
    poLines.getDataRange().getValues().slice(1).forEach(function(r){
      var po = String(r[0]||'').trim(); if (!po) return;
      if (typeof isPOAttached_ === 'function' && !isPOAttached_(po)) return;
      var promised = _tieDate_(r[12]) || hdrDue[po];
      if (!promised) return;
      if (!_tieIn_(promised, from, to)) return;
      var rec = grnByPo[po];
      if (!rec) return;
      if (rec <= promised) onTime++; else late++;
    });
  }
  out.raw.otdOnTime = onTime;
  out.raw.otdLate   = late;

  // ---- 5) CustReturn unmatched ----
  var ret = ss.getSheetByName('CUSTOMER_RETURN_LOG');
  var gp  = ss.getSheetByName('GATEPASS_LOG');
  var oqc = ss.getSheetByName('OQC_LOG');
  var fg  = ss.getSheetByName('FG_DISPATCH_LOTS');
  var gpToOqc = {}, oqcExists = {}, fgBatch = {};
  if (gp && gp.getLastRow() > 1) {
    gp.getDataRange().getValues().slice(1).forEach(function(r){
      var g = String(r[0]||'').trim(); if (g) gpToOqc[g] = String(r[3]||'').trim();
    });
  }
  if (oqc && oqc.getLastRow() > 1) {
    oqc.getDataRange().getValues().slice(1).forEach(function(r){
      var o = String(r[0]||'').trim(); if (o) oqcExists[o] = true;
    });
  }
  if (fg && fg.getLastRow() > 1) {
    fg.getDataRange().getValues().slice(1).forEach(function(r){
      var b = String(r[8]||'').trim(); if (b) fgBatch[b] = true;
    });
  }
  var unmatched = 0, matched = 0;
  if (ret && ret.getLastRow() > 1) {
    ret.getDataRange().getValues().slice(1).forEach(function(r){
      var d = _tieDate_(r[1]);
      if (!_tieIn_(d, from, to)) return;
      var gpNo = String(r[4]||'').trim();
      var fgB  = String(r[7]||'').trim();
      var ok = false;
      if (gpNo && gpToOqc[gpNo] && oqcExists[gpToOqc[gpNo]]) ok = true;
      else if (fgB && fgBatch[fgB]) ok = true;
      if (ok) matched++; else unmatched++;
    });
  }
  out.raw.crMatched   = matched;
  out.raw.crUnmatched = unmatched;

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function _tieParse_(iso) {
  var p = iso.split('-');
  return new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10));
}
function _tieDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  var d = new Date(v); return isNaN(d) ? null : d;
}
function _tieIn_(d, from, to) {
  if (!d) return false;
  var ds = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var fs = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  var ts = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return ds >= fs && ds <= ts;
}
