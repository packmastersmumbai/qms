// ============================================================
// KPI.js — P7 KPI Engine: server endpoints, compute fns,
//           cache, period resolver, 2-hop join helpers
// Pack Masters QMS | Google Apps Script V8
// Read-only. No LockService. No sheet writes.
// ============================================================

// ── Public endpoints ──────────────────────────────────────────

/**
 * Main dashboard endpoint.
 * periodOpts: { preset:'THIS_MONTH'|'LAST_30'|'LAST_90'|'THIS_FY'|'CUSTOM', fromISO?, toISO? }
 */
function getKPIDashboard(periodOpts) {
  periodOpts = periodOpts || { preset: 'THIS_MONTH' };
  var cacheKey = 'kpi:v1:' + JSON.stringify(periodOpts);

  // Cache probe
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      var parsed = JSON.parse(cached);
      parsed.cacheHit = true;
      return parsed;
    }
  } catch(e) {
    Logger.log('KPI cache read error: ' + e.message);
  }

  var period = kpiPeriodResolve_(periodOpts);
  var thresholds = kpiGetThresholds_();
  var ctx = kpiLoadContext_(period.sparkBuckets[0].from);

  // Build tiles: current + prev + 6 sparkline buckets per metric
  var tiles = {};

  // FPY
  var fpyCur  = kpiFPY_(period.fromDate, period.toDate, ctx, thresholds);
  var fpyPrev = kpiFPY_(period.prevFrom, period.prevTo, ctx, thresholds);
  var fpySpark = period.sparkBuckets.map(function(b) { return kpiFPY_(b.from, b.to, ctx, thresholds).value; });
  tiles.fpy = {
    value:  fpyCur.value,
    prev:   fpyPrev.value,
    delta:  fpyCur.value != null && fpyPrev.value != null ? fpyCur.value - fpyPrev.value : null,
    spark:  fpySpark,
    status: fpyCur.status,
    count:  fpyCur.count,
    denom:  fpyCur.denom
  };

  // NCR
  var ncrCur  = kpiNCR_(period.fromDate, period.toDate, ctx, thresholds);
  var ncrPrev = kpiNCR_(period.prevFrom, period.prevTo, ctx, thresholds);
  var ncrSpark = period.sparkBuckets.map(function(b) { return kpiNCR_(b.from, b.to, ctx, thresholds).total; });
  tiles.ncr = {
    total:    ncrCur.total,
    open:     ncrCur.open,
    bySource: ncrCur.bySource,
    spark:    ncrSpark,
    status:   ncrCur.status
  };

  // Supplier Defect
  var sdCur  = kpiSupplierDefect_(period.fromDate, period.toDate, ctx, thresholds);
  var sdPrev = kpiSupplierDefect_(period.prevFrom, period.prevTo, ctx, thresholds);
  var sdSpark = period.sparkBuckets.map(function(b) { return kpiSupplierDefect_(b.from, b.to, ctx, thresholds).overall; });
  tiles.supplierDefect = {
    overall:        sdCur.overall,
    worstSuppliers: sdCur.worstSuppliers.slice(0, 20),
    spark:          sdSpark,
    status:         sdCur.status
  };

  // Customer Return
  var crCur  = kpiCustReturn_(period.fromDate, period.toDate, ctx, thresholds);
  var crPrev = kpiCustReturn_(period.prevFrom, period.prevTo, ctx, thresholds);
  var crSpark = period.sparkBuckets.map(function(b) { return kpiCustReturn_(b.from, b.to, ctx, thresholds).rate; });
  tiles.custReturn = {
    rate:      crCur.rate,
    matched:   crCur.matched,
    unmatched: crCur.unmatched,
    spark:     crSpark,
    status:    crCur.status
  };

  // OTD
  var otdCur  = kpiOTD_(period.fromDate, period.toDate, ctx, thresholds);
  var otdPrev = kpiOTD_(period.prevFrom, period.prevTo, ctx, thresholds);
  var otdSpark = period.sparkBuckets.map(function(b) { return kpiOTD_(b.from, b.to, ctx, thresholds).rate; });
  tiles.otd = {
    rate:        otdCur.rate,
    onTime:      otdCur.onTime,
    late:        otdCur.late,
    openOverdue: otdCur.openOverdue,
    spark:       otdSpark,
    status:      otdCur.status
  };

  var payload = {
    period:        { fromISO: kpiDateToISO_(period.fromDate), toISO: kpiDateToISO_(period.toDate), label: period.label },
    tiles:         tiles,
    computedAtISO: new Date().toISOString(),
    cacheHit:      false
  };

  // Cache write (skip if >90KB)
  try {
    var serialized = JSON.stringify(payload);
    if (serialized.length < 90000) {
      CacheService.getScriptCache().put(cacheKey, serialized, 300);
    } else {
      Logger.log('KPI payload too large for cache (' + serialized.length + ' bytes), skipping.');
    }
  } catch(e) {
    Logger.log('KPI cache write error: ' + e.message);
  }

  return payload;
}

/**
 * Drill-down endpoint. Returns {columns, rows, routeTo?}
 * FPY and supplierDefect return inline rows (no routeTo).
 * NCR, custReturn return routeTo for Records_F.
 * OTD returns inline tabs.
 */
function getKPIDrilldown(metricKey, periodOpts, subFilter) {
  periodOpts = periodOpts || { preset: 'THIS_MONTH' };
  subFilter  = subFilter  || {};
  var period = kpiPeriodResolve_(periodOpts);
  var thresholds = kpiGetThresholds_();
  var ctx = kpiLoadContext_(period.fromDate);

  if (metricKey === 'fpy') {
    return kpiFPYDrilldown_(period.fromDate, period.toDate, ctx);
  }
  if (metricKey === 'supplierDefect') {
    // Full list, fresh compute (uncached)
    var sd = kpiSupplierDefect_(period.fromDate, period.toDate, ctx, thresholds);
    return {
      columns: ['Supplier', 'Defect Rate %', 'Rejected Qty', 'Total Qty', 'Status'],
      rows: sd.worstSuppliers.map(function(s) {
        return [s.supplier, s.rate != null ? s.rate.toFixed(2) : '—', s.rejQty, s.totQty, s.status];
      })
    };
  }
  if (metricKey === 'ncr') {
    var fromISO = kpiDateToISO_(period.fromDate);
    var toISO   = kpiDateToISO_(period.toDate);
    return { routeTo: 'Records_F?type=NCR_LOG&from=' + fromISO + '&to=' + toISO };
  }
  if (metricKey === 'custReturn') {
    var fromISO2 = kpiDateToISO_(period.fromDate);
    var toISO2   = kpiDateToISO_(period.toDate);
    return { routeTo: 'Records_F?type=CUSTOMER_RETURN_LOG&from=' + fromISO2 + '&to=' + toISO2 };
  }
  if (metricKey === 'otd') {
    return kpiOTDDrilldown_(period.fromDate, period.toDate, ctx, thresholds, subFilter);
  }
  return { columns: [], rows: [] };
}

/** Flush all KPI cache entries (clears script cache entirely — acceptable for this app). */
function kpiCacheFlush() {
  try {
    CacheService.getScriptCache().removeAll([]);
    // removeAll([]) is a no-op; iterate known presets instead
    var presets = ['THIS_MONTH','LAST_30','LAST_90','THIS_FY'];
    var keys = presets.map(function(p) { return 'kpi:v1:' + JSON.stringify({ preset: p }); });
    CacheService.getScriptCache().removeAll(keys);
    Logger.log('KPI cache flushed: ' + keys.length + ' keys.');
  } catch(e) {
    Logger.log('kpiCacheFlush error: ' + e.message);
  }
  try {
    SpreadsheetApp.getUi().alert('KPI cache flushed. Next dashboard load will recompute.');
  } catch(e) {}
}

// ── Threshold loader ──────────────────────────────────────────

function kpiGetThresholds_() {
  var ss = getSpreadsheet();
  var cfg = ss ? ss.getSheetByName('CONFIG') : null;
  var map = {};
  if (cfg && cfg.getLastRow() > 1) {
    var data = cfg.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) map[String(data[i][0]).trim()] = data[i][1];
    }
  }
  function num(key, def) { var v = parseFloat(map[key]); return isNaN(v) ? def : v; }
  return {
    fpyGreen:        num('KPI_FPY_GREEN',         95),
    fpyAmber:        num('KPI_FPY_AMBER',         90),
    defectAmber:     num('KPI_DEFECT_AMBER',       2),
    defectRed:       num('KPI_DEFECT_RED',         5),
    otdGreen:        num('KPI_OTD_GREEN',          90),
    otdAmber:        num('KPI_OTD_AMBER',          80),
    returnWindowDays:num('KPI_RETURN_WINDOW_DAYS', 60),
    returnAmber:     num('KPI_RETURN_AMBER',        1),
    returnRed:       num('KPI_RETURN_RED',          3),
    ncrOpenRed:      num('KPI_NCR_OPEN_RED',       10)
  };
}

// ── Period resolver ───────────────────────────────────────────

function kpiPeriodResolve_(opts) {
  var tz = 'Asia/Kolkata';
  var now = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var today = kpiParseDate_(todayStr);

  var fromDate, toDate, label;

  if (opts.preset === 'CUSTOM' && opts.fromISO && opts.toISO) {
    fromDate = kpiParseDate_(opts.fromISO);
    toDate   = kpiParseDate_(opts.toISO);
    label    = opts.fromISO + ' to ' + opts.toISO;
  } else if (opts.preset === 'LAST_30') {
    toDate   = today;
    fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 30);
    label    = 'Last 30 Days';
  } else if (opts.preset === 'LAST_90') {
    toDate   = today;
    fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 90);
    label    = 'Last 90 Days';
  } else if (opts.preset === 'THIS_FY') {
    // Indian FY: Apr 1 → Mar 31. Switchover at midnight IST Apr 1.
    var mm = parseInt(Utilities.formatDate(now, tz, 'MM'), 10);
    var yyyy = parseInt(Utilities.formatDate(now, tz, 'yyyy'), 10);
    var fyStartYear = (mm >= 4) ? yyyy : yyyy - 1;
    fromDate = kpiParseDate_(fyStartYear + '-04-01');
    toDate   = kpiParseDate_((fyStartYear + 1) + '-03-31');
    label    = 'FY ' + fyStartYear + '-' + String(fyStartYear + 1).slice(2);
  } else {
    // THIS_MONTH default
    var m = Utilities.formatDate(now, tz, 'MM');
    var y = Utilities.formatDate(now, tz, 'yyyy');
    fromDate = kpiParseDate_(y + '-' + m + '-01');
    // Last day of month: day 0 of next month
    var nextMonthFirst = new Date(parseInt(y, 10), parseInt(m, 10), 1);
    toDate = new Date(nextMonthFirst.getTime() - 86400000);
    label  = Utilities.formatDate(now, tz, 'MMMM yyyy');
  }

  // Previous period: same span length ending day before fromDate
  var spanDays = Math.round((toDate - fromDate) / 86400000) + 1;
  var prevTo   = new Date(fromDate.getTime() - 86400000);
  var prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86400000);

  // 6 sparkline buckets
  var bucketSize = Math.ceil(spanDays / 6);
  var sparkBuckets = [];
  for (var i = 0; i < 6; i++) {
    var bFrom = new Date(fromDate.getTime() + i * bucketSize * 86400000);
    var bTo   = new Date(Math.min(fromDate.getTime() + (i + 1) * bucketSize * 86400000 - 86400000, toDate.getTime()));
    sparkBuckets.push({ from: bFrom, to: bTo });
  }

  return {
    fromDate:    fromDate,
    toDate:      toDate,
    label:       label,
    prevFrom:    prevFrom,
    prevTo:      prevTo,
    sparkBuckets: sparkBuckets
  };
}

// ── Context loader (reads sheets ONCE per dashboard call) ─────

function kpiLoadContext_(maxFromDate) {
  var ss = getSpreadsheet();
  var ctx = {
    iqcRows:     [],
    ncrRows:     [],
    grnMap:      {},  // grnNo → {supplierCode, supplierName, poRef}
    gpMap:       {},  // gpNo  → {oqcRef, createdAt}
    oqcMap:      {},  // docNo → {date, disposition}
    fgDispMap:   {},  // lotId → {firstDispatchedAt, oqcRef}
    returnRows:  [],
    poLineRows:  [],
    poHeaderMap: {}, // poNo  → {dueDate, ...}
    grnReceiptMap: {} // poNo+':'+lineNo → min receiptDate
  };

  var cutoff = maxFromDate instanceof Date ? maxFromDate : kpiParseDate_(String(maxFromDate));
  // Extend cutoff back by return window (60d) so denominator is accurate
  var extendedCutoff = new Date(cutoff.getTime() - 60 * 86400000);

  // IQC_LOG: Date(1), GRN No.(2), Disposition(22), Accepted Qty(26), Rejected Qty(27)
  var iqcWs = ss ? ss.getSheetByName('IQC_LOG') : null;
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iqcData = iqcWs.getDataRange().getValues();
    for (var i = 1; i < iqcData.length; i++) {
      var r = iqcData[i];
      var d = kpiToDate_(r[1]);
      ctx.iqcRows.push({ date: d, grnNo: String(r[2]||'').trim(), disposition: String(r[22]||'').trim(), acceptedQty: Number(r[26]||0), rejectedQty: Number(r[27]||0), raw: r });
    }
  }

  // NCR_LOG: Date(1), Source(2), SourceRef(3), Status(14), DispositionAt(12)
  var ncrWs = ss ? ss.getSheetByName('NCR_LOG') : null;
  if (ncrWs && ncrWs.getLastRow() > 1) {
    var ncrData = ncrWs.getDataRange().getValues();
    for (var i2 = 1; i2 < ncrData.length; i2++) {
      var rn = ncrData[i2];
      ctx.ncrRows.push({ date: kpiToDate_(rn[1]), source: String(rn[2]||'').trim().toUpperCase() || 'UNKNOWN', sourceRef: String(rn[3]||'').trim(), status: String(rn[14]||'').trim().toUpperCase(), dispositionAt: kpiToDate_(rn[12]) });
    }
  }

  // GRN_LOG: GRN No.(0), Date(1), Supplier Code(2), Supplier Name(3), PO Reference(4)
  var grnWs = ss ? ss.getSheetByName('GRN_LOG') : null;
  if (grnWs && grnWs.getLastRow() > 1) {
    var grnData = grnWs.getDataRange().getValues();
    for (var i3 = 1; i3 < grnData.length; i3++) {
      var rg = grnData[i3];
      var gNo = String(rg[0]||'').trim();
      if (!gNo) continue;
      var receiptDate = kpiToDate_(rg[1]);
      ctx.grnMap[gNo] = { supplierCode: String(rg[2]||'').trim(), supplierName: String(rg[3]||'').trim(), poRef: String(rg[4]||'').trim(), date: receiptDate };
      // Build OTD receipt map: poRef + lineNo → min receipt date
      // GRN_LOG doesn't have lineNo per se; poRef links it to a PO.
      // We store grnNo-level receipt dates; OTD will join via poRef.
      var poRef = String(rg[4]||'').trim();
      if (poRef) {
        if (!ctx.grnReceiptMap[poRef]) ctx.grnReceiptMap[poRef] = [];
        ctx.grnReceiptMap[poRef].push({ grnNo: gNo, date: receiptDate });
      }
    }
  }

  // GATEPASS_LOG: GP_NO(0), DATE(1), TYPE(2), OQC_REF(3), CREATED_AT(17)
  var gpWs = ss ? ss.getSheetByName('GATEPASS_LOG') : null;
  if (gpWs && gpWs.getLastRow() > 1) {
    var gpData = gpWs.getDataRange().getValues();
    for (var i4 = 1; i4 < gpData.length; i4++) {
      var rp = gpData[i4];
      var gpNo = String(rp[0]||'').trim();
      if (!gpNo) continue;
      ctx.gpMap[gpNo] = { oqcRef: String(rp[3]||'').trim(), createdAt: kpiToDate_(rp[17] || rp[1]) };
    }
  }

  // OQC_LOG: OQC No.(0), Date(1), Release Decision(14)
  var oqcWs = ss ? ss.getSheetByName('OQC_LOG') : null;
  if (oqcWs && oqcWs.getLastRow() > 1) {
    var oqcData = oqcWs.getDataRange().getValues();
    for (var i5 = 1; i5 < oqcData.length; i5++) {
      var ro = oqcData[i5];
      var oNo = String(ro[0]||'').trim();
      if (!oNo) continue;
      ctx.oqcMap[oNo] = { date: kpiToDate_(ro[1]), disposition: String(ro[14]||'').trim().toUpperCase() };
    }
  }

  // FG_DISPATCH_LOTS: Lot ID(0), OQC Ref(2), First Dispatched At(15), FG Batch / PO(8)
  var fgWs = ss ? ss.getSheetByName('FG_DISPATCH_LOTS') : null;
  if (fgWs && fgWs.getLastRow() > 1) {
    var fgData = fgWs.getDataRange().getValues();
    for (var i6 = 1; i6 < fgData.length; i6++) {
      var rf = fgData[i6];
      var lotId = String(rf[0]||'').trim();
      var fgBatch = String(rf[8]||'').trim();
      if (lotId) ctx.fgDispMap[lotId] = { oqcRef: String(rf[2]||'').trim(), firstDispatchedAt: kpiToDate_(rf[15]), fgBatch: fgBatch };
      // Also index by fgBatch for fallback join
      if (fgBatch) ctx.fgDispMap['BATCH:' + fgBatch] = { oqcRef: String(rf[2]||'').trim(), firstDispatchedAt: kpiToDate_(rf[15]), fgBatch: fgBatch };
    }
  }

  // CUSTOMER_RETURN_LOG: Return No.(0), Return Date(1), Original Gatepass No.(4), FG Batch No.(7)
  var retWs = ss ? ss.getSheetByName('CUSTOMER_RETURN_LOG') : null;
  if (retWs && retWs.getLastRow() > 1) {
    var retData = retWs.getDataRange().getValues();
    for (var i7 = 1; i7 < retData.length; i7++) {
      var rr = retData[i7];
      ctx.returnRows.push({ returnNo: String(rr[0]||'').trim(), returnDate: kpiToDate_(rr[1]), gpNo: String(rr[4]||'').trim(), fgBatch: String(rr[7]||'').trim() });
    }
  }

  // PO_HEADER: po_no(0), due_date(4)
  var poHdrWs = ss ? ss.getSheetByName('PO_HEADER') : null;
  if (poHdrWs && poHdrWs.getLastRow() > 1) {
    var poHdrData = poHdrWs.getDataRange().getValues();
    for (var i8 = 1; i8 < poHdrData.length; i8++) {
      var rh = poHdrData[i8];
      var poNo = String(rh[0]||'').trim();
      if (poNo) ctx.poHeaderMap[poNo] = { dueDate: kpiToDate_(rh[4]) };
    }
  }

  // PO_LINES: po_no(0), line_no(1), promised_date(12)
  var poLinesWs = ss ? ss.getSheetByName('PO_LINES') : null;
  if (poLinesWs && poLinesWs.getLastRow() > 1) {
    var poLinesData = poLinesWs.getDataRange().getValues();
    for (var i9 = 1; i9 < poLinesData.length; i9++) {
      var rl = poLinesData[i9];
      var lPoNo = String(rl[0]||'').trim();
      var lLineNo = String(rl[1]||'').trim();
      if (!lPoNo) continue;
      ctx.poLineRows.push({ poNo: lPoNo, lineNo: lLineNo, promisedDate: kpiToDate_(rl[12]) });
    }
  }

  return ctx;
}

// ── FPY ───────────────────────────────────────────────────────

function kpiFPY_(fromDate, toDate, ctx, thresholds) {
  // Build NCR source=IQC set keyed by sourceRef (= GRN No.)
  var ncrIqcRefs = {};
  ctx.ncrRows.forEach(function(n) {
    if (n.source === 'IQC' && n.sourceRef) ncrIqcRefs[n.sourceRef] = true;
  });

  var denom = 0, numerator = 0;
  ctx.iqcRows.forEach(function(row) {
    if (!kpiInRange_(row.date, fromDate, toDate)) return;
    var disp = row.disposition.toUpperCase().trim();
    // Exclude pending/awaiting/deviation-pending
    if (disp.indexOf('PENDING') >= 0 || disp.indexOf('AWAITING') >= 0) return;
    denom++;
    // HOLD → fail (100% defect)
    if (disp === 'HOLD') return; // denom included, numerator not incremented
    // REJECTED → fail
    if (disp === 'REJECTED' || disp.indexOf('REJECTED') === 0) return;
    // ACCEPTED* → pass if no IQC-NCR for grnRef
    if (disp === 'ACCEPTED' || disp.indexOf('ACCEPTED') === 0) {
      if (!ncrIqcRefs[row.grnNo]) numerator++;
      return;
    }
    // Unknown dispositions: exclude from denom too
    denom--;
  });

  if (denom === 0) return { value: null, count: 0, denom: 0, status: 'grey' };
  var value = (numerator / denom) * 100;
  var status = value >= thresholds.fpyGreen ? 'green' : value >= thresholds.fpyAmber ? 'amber' : 'red';
  return { value: Math.round(value * 10) / 10, count: numerator, denom: denom, status: status };
}

function kpiFPYDrilldown_(fromDate, toDate, ctx) {
  var ncrIqcRefs = {};
  ctx.ncrRows.forEach(function(n) { if (n.source === 'IQC' && n.sourceRef) ncrIqcRefs[n.sourceRef] = true; });

  var rows = [];
  ctx.iqcRows.forEach(function(row) {
    if (!kpiInRange_(row.date, fromDate, toDate)) return;
    var disp = row.disposition.toUpperCase().trim();
    if (disp.indexOf('PENDING') >= 0 || disp.indexOf('AWAITING') >= 0) return;
    var isAccepted = disp === 'ACCEPTED' || disp.indexOf('ACCEPTED') === 0;
    if (!isAccepted) return;
    if (ncrIqcRefs[row.grnNo]) {
      // Failure row: ACCEPTED* but has NCR
      rows.push([kpiDateToISO_(row.date), row.grnNo, row.disposition, 'FAIL — NCR exists']);
    }
  });
  return { columns: ['Date', 'GRN No.', 'Disposition', 'Reason'], rows: rows };
}

// ── NCR ───────────────────────────────────────────────────────

function kpiNCR_(fromDate, toDate, ctx, thresholds) {
  var today = new Date();
  var bySource = {};
  ctx.ncrRows.forEach(function(n) {
    if (!kpiInRange_(n.date, fromDate, toDate)) return;
    var src = n.source || 'UNKNOWN';
    if (!bySource[src]) bySource[src] = { source: src, count: 0, open: 0, totalAge: 0 };
    var grp = bySource[src];
    grp.count++;
    var closed = n.status === 'CLOSED';
    if (!closed) grp.open++;
    var refDate = closed ? (n.dispositionAt || today) : today;
    var age = Math.max(0, Math.round((refDate - n.date) / 86400000));
    grp.totalAge += age;
  });

  var arr = Object.keys(bySource).map(function(k) {
    var g = bySource[k];
    return { source: g.source, count: g.count, open: g.open, avgAge: g.count ? Math.round(g.totalAge / g.count) : 0 };
  });
  arr.sort(function(a, b) { return b.count - a.count; });
  var totalOpen = arr.reduce(function(s, x) { return s + x.open; }, 0);
  var total = arr.reduce(function(s, x) { return s + x.count; }, 0);
  var status = totalOpen > thresholds.ncrOpenRed ? 'red' : totalOpen > 0 ? 'amber' : 'green';
  return { total: total, open: totalOpen, bySource: arr, status: status };
}

// ── Supplier Defect ───────────────────────────────────────────

function kpiSupplierDefect_(fromDate, toDate, ctx, thresholds) {
  var bySupplier = {};
  ctx.iqcRows.forEach(function(row) {
    if (!kpiInRange_(row.date, fromDate, toDate)) return;
    var grn = ctx.grnMap[row.grnNo];
    if (!grn || !grn.poRef) return;
    if (typeof isPOAttached_ !== 'function' || !isPOAttached_(grn.poRef)) return;
    var sup = grn.supplierCode || grn.supplierName || 'UNKNOWN';
    if (!bySupplier[sup]) bySupplier[sup] = { supplier: sup, rejQty: 0, totQty: 0 };
    var disp = row.disposition.toUpperCase().trim();
    var isHold = disp === 'HOLD' || disp.indexOf('HOLD') >= 0;
    var tot = row.acceptedQty + row.rejectedQty;
    if (isHold) {
      // HOLD = 100% defect: add total to both numerator and denominator
      bySupplier[sup].rejQty += tot;
      bySupplier[sup].totQty += tot;
    } else {
      bySupplier[sup].rejQty += row.rejectedQty;
      bySupplier[sup].totQty += tot;
    }
  });

  var list = Object.keys(bySupplier).map(function(k) {
    var s = bySupplier[k];
    if (s.totQty === 0) return null;
    var rate = (s.rejQty / s.totQty) * 100;
    var status = rate > thresholds.defectRed ? 'red' : rate > thresholds.defectAmber ? 'amber' : 'green';
    return { supplier: s.supplier, rate: Math.round(rate * 100) / 100, rejQty: s.rejQty, totQty: s.totQty, status: status };
  }).filter(Boolean);
  list.sort(function(a, b) { return b.rate - a.rate; });

  var overall = null;
  var totRej = list.reduce(function(s, x) { return s + x.rejQty; }, 0);
  var totAll = list.reduce(function(s, x) { return s + x.totQty; }, 0);
  if (totAll > 0) overall = Math.round((totRej / totAll) * 10000) / 100;
  var tileStatus = list.some(function(x) { return x.status === 'red'; }) ? 'red' :
                   list.some(function(x) { return x.status === 'amber'; }) ? 'amber' : 'green';
  return { overall: overall, worstSuppliers: list, status: tileStatus };
}

// ── Customer Return ───────────────────────────────────────────

function isOQCReleasedDisp_(disp) {
  var d = (disp || '').toUpperCase().trim();
  return d === 'RELEASED' || d === 'ACCEPTED' || d === 'ACCEPTED WITH DEVIATION';
}

function kpiCustReturn_(fromDate, toDate, ctx, thresholds) {
  var windowDays = thresholds.returnWindowDays || 60;
  var windowMs   = windowDays * 86400000;

  // Denominator: OQC released in (fromDate - window, toDate)
  var denomFrom = new Date(fromDate.getTime() - windowMs);
  var denom = 0;
  Object.keys(ctx.oqcMap).forEach(function(k) {
    var oqc = ctx.oqcMap[k];
    if (isOQCReleasedDisp_(oqc.disposition) && kpiInRange_(oqc.date, denomFrom, toDate)) denom++;
  });

  // Numerator: returns in period whose dispatch date is >= returnDate - window
  var matched = 0, unmatched = 0;
  ctx.returnRows.forEach(function(ret) {
    if (!kpiInRange_(ret.returnDate, fromDate, toDate)) return;
    // 2-hop join: gpNo → gpMap → oqcRef → oqcMap → date
    var dispDate = null;
    var gpNo = ret.gpNo;
    if (gpNo && ctx.gpMap[gpNo]) {
      var gp = ctx.gpMap[gpNo];
      var oqcRef = gp.oqcRef;
      if (oqcRef && ctx.oqcMap[oqcRef]) {
        dispDate = ctx.oqcMap[oqcRef].date;
      }
    }
    // Fallback: FG Batch → FG_DISPATCH_LOTS
    if (!dispDate && ret.fgBatch) {
      var fgKey = 'BATCH:' + ret.fgBatch;
      if (ctx.fgDispMap[fgKey]) dispDate = ctx.fgDispMap[fgKey].firstDispatchedAt;
    }
    if (!dispDate) { unmatched++; return; }
    // Check window
    var age = (ret.returnDate - dispDate) / 86400000;
    if (age >= 0 && age <= windowDays) matched++;
    else unmatched++;
  });

  var rate = denom > 0 ? Math.round((matched / denom) * 10000) / 100 : null;
  var status = rate == null ? 'grey' : rate <= thresholds.returnAmber ? 'green' : rate <= thresholds.returnRed ? 'amber' : 'red';
  return { rate: rate, matched: matched, unmatched: unmatched, status: status };
}

// ── OTD ───────────────────────────────────────────────────────

function kpiOTD_(fromDate, toDate, ctx, thresholds) {
  var today = new Date();
  var onTime = 0, late = 0, openOverdue = 0;

  ctx.poLineRows.forEach(function(line) {
    if (typeof isPOAttached_ !== 'function' || !isPOAttached_(line.poNo)) return;
    // Promised date: line.promisedDate or fallback to header
    var promised = line.promisedDate;
    if (!promised && ctx.poHeaderMap[line.poNo]) promised = ctx.poHeaderMap[line.poNo].dueDate;
    if (!promised) return; // both blank → exclude

    // Period filter on promisedDate
    if (!kpiInRange_(promised, fromDate, toDate)) return;

    // Find receipts for this PO
    var receipts = ctx.grnReceiptMap[line.poNo] || [];
    if (receipts.length === 0) {
      // No GRN → open line
      if (promised < today) openOverdue++;
      return;
    }
    // First receipt date
    var firstReceipt = receipts.reduce(function(min, r) {
      return (r.date && (!min || r.date < min)) ? r.date : min;
    }, null);
    if (!firstReceipt) return;
    if (firstReceipt <= promised) onTime++;
    else late++;
  });

  var total = onTime + late;
  var rate = total > 0 ? Math.round((onTime / total) * 1000) / 10 : null;
  var status = rate == null ? 'grey' : rate >= thresholds.otdGreen ? 'green' : rate >= thresholds.otdAmber ? 'amber' : 'red';
  return { rate: rate, onTime: onTime, late: late, openOverdue: openOverdue, status: status };
}

function kpiOTDDrilldown_(fromDate, toDate, ctx, thresholds, subFilter) {
  var today = new Date();
  var onTimeRows = [], lateRows = [], overdueRows = [];

  ctx.poLineRows.forEach(function(line) {
    if (typeof isPOAttached_ !== 'function' || !isPOAttached_(line.poNo)) return;
    var promised = line.promisedDate;
    if (!promised && ctx.poHeaderMap[line.poNo]) promised = ctx.poHeaderMap[line.poNo].dueDate;
    if (!promised) return;
    if (!kpiInRange_(promised, fromDate, toDate)) return;

    var receipts = ctx.grnReceiptMap[line.poNo] || [];
    var poISO = kpiDateToISO_(promised);
    if (receipts.length === 0) {
      if (promised < today) overdueRows.push([line.poNo, line.lineNo, poISO, '—', 'OVERDUE']);
      return;
    }
    var firstReceipt = receipts.reduce(function(min, r) {
      return (r.date && (!min || r.date < min)) ? r.date : min;
    }, null);
    if (!firstReceipt) return;
    var receiptISO = kpiDateToISO_(firstReceipt);
    if (firstReceipt <= promised) onTimeRows.push([line.poNo, line.lineNo, poISO, receiptISO, 'ON TIME']);
    else lateRows.push([line.poNo, line.lineNo, poISO, receiptISO, 'LATE']);
  });

  var columns = ['PO No.', 'Line', 'Promised', 'First Receipt', 'Status'];
  return {
    columns: columns,
    tabs: [
      { label: 'On Time (' + onTimeRows.length + ')',   rows: onTimeRows   },
      { label: 'Late (' + lateRows.length + ')',         rows: lateRows     },
      { label: 'Open Overdue (' + overdueRows.length + ')', rows: overdueRows }
    ]
  };
}

// ── Helpers ───────────────────────────────────────────────────

function kpiParseDate_(iso) {
  var parts = iso.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function kpiToDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  var d = new Date(v);
  return isNaN(d) ? null : d;
}

function kpiInRange_(date, from, to) {
  if (!date) return false;
  var d = kpiToDate_(date);
  if (!d) return false;
  // Compare by date only (strip time)
  var ds = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var fs = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate()) : null;
  var ts = to   ? new Date(to.getFullYear(),   to.getMonth(),   to.getDate())   : null;
  if (fs && ds < fs) return false;
  if (ts && ds > ts) return false;
  return true;
}

function kpiDateToISO_(date) {
  if (!date) return '';
  var d = kpiToDate_(date);
  if (!d) return '';
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}
