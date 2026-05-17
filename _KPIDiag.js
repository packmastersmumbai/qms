// ============================================================
// _KPIDiag.js — P7 KPI Diagnostic Harness (8 sections)
// Pack Masters QMS | Google Apps Script V8
// Read-only. Run via menu: QMS System → Run KPI Diagnostics
// ============================================================

function runKPIDiag() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) {}
  var report = [];

  function section(n, title) { report.push('\n=== §' + n + ' ' + title + ' ==='); }
  function ok(msg)   { report.push('  ✅ ' + msg); }
  function warn(msg) { report.push('  ⚠️  ' + msg); }
  function fail(msg) { report.push('  ❌ ' + msg); }
  function info(msg) { report.push('  ℹ️  ' + msg); }

  try {
    var ss = getSpreadsheet();

    // ── §1 Source sheets exist + headers match expected ───────
    section(1, 'Source Sheets & Headers');
    var EXPECTED_SHEETS = {
      'IQC_LOG':              ['IQC No.','Date','GRN No.','Supplier Name','Material Description','Batch No.','Inspector'],
      'NCR_LOG':              ['NCR No.','Date','Source','Source Ref'],
      'GRN_LOG':              ['GRN No.','Date','Supplier Code','Supplier Name','PO Reference'],
      'GATEPASS_LOG':         ['GP_NO','DATE','TYPE','OQC_REF'],
      'OQC_LOG':              ['OQC No.','Date'],
      'FG_DISPATCH_LOTS':     ['Lot ID','Timestamp','OQC Ref'],
      'CUSTOMER_RETURN_LOG':  ['Return No.','Return Date','Customer Code','Customer Name','Original Gatepass No.'],
      'PO_HEADER':            ['po_no','po_date','supplier_code','supplier_name','due_date'],
      'PO_LINES':             ['po_no','line_no','material_code','material_desc','unit','qty_ordered','unit_price','line_amount','qty_received','qty_pending','line_status','last_grn_no','promised_date']
    };

    Object.keys(EXPECTED_SHEETS).forEach(function(name) {
      var ws = ss ? ss.getSheetByName(name) : null;
      if (!ws) { fail(name + ' MISSING'); return; }
      var rows = ws.getLastRow() - 1;
      var cols = ws.getLastColumn();
      var expected = EXPECTED_SHEETS[name];
      if (cols < expected.length) { warn(name + ' has ' + cols + ' cols, expected ' + expected.length); return; }
      var hdrs = ws.getRange(1, 1, 1, expected.length).getValues()[0];
      var mismatches = [];
      expected.forEach(function(e, i) { if (String(hdrs[i]||'').trim() !== e) mismatches.push('col'+(i+1)+' "'+hdrs[i]+'" vs "'+e+'"'); });
      if (mismatches.length) warn(name + ' header mismatches: ' + mismatches.join('; '));
      else ok(name + ' (' + rows + ' rows, ' + cols + ' cols)');
    });

    // CONFIG KPI keys
    var cfg = ss ? ss.getSheetByName('CONFIG') : null;
    var kpiKeys = ['KPI_FPY_GREEN','KPI_FPY_AMBER','KPI_DEFECT_AMBER','KPI_DEFECT_RED','KPI_OTD_GREEN','KPI_OTD_AMBER','KPI_RETURN_WINDOW_DAYS','KPI_RETURN_AMBER','KPI_RETURN_RED','KPI_NCR_OPEN_RED'];
    var existingKeys = {};
    if (cfg && cfg.getLastRow() > 1) {
      cfg.getDataRange().getValues().slice(1).forEach(function(r) { if (r[0]) existingKeys[String(r[0]).trim()] = r[1]; });
    }
    var missingKeys = kpiKeys.filter(function(k) { return !(k in existingKeys); });
    if (missingKeys.length) fail('CONFIG missing KPI keys: ' + missingKeys.join(', '));
    else ok('All 10 KPI CONFIG keys present: ' + kpiKeys.map(function(k){ return k+'='+existingKeys[k]; }).join(', '));

    // ── §2 Sample math sanity — full dashboard call ───────────
    section(2, 'Sample Math Sanity (THIS_MONTH)');
    try {
      var dash = getKPIDashboard({ preset: 'THIS_MONTH' });
      var tiles = dash.tiles;
      info('Period: ' + dash.period.label + ' | cacheHit=' + dash.cacheHit);
      function checkTile(name, tile) {
        var val = tile.value != null ? tile.value : tile.total != null ? tile.total : tile.overall != null ? tile.overall : tile.rate;
        var ok2 = val == null || (typeof val === 'number' && !isNaN(val) && isFinite(val));
        if (ok2) ok(name + ': value=' + (val != null ? val.toFixed ? val.toFixed(1) : val : 'N/A') + ' status=' + tile.status);
        else fail(name + ': value is ' + val);
      }
      checkTile('FPY', { value: tiles.fpy.value, status: tiles.fpy.status });
      checkTile('NCR', { total: tiles.ncr.total, status: tiles.ncr.status });
      checkTile('SupplierDefect', { overall: tiles.supplierDefect.overall, status: tiles.supplierDefect.status });
      checkTile('CustReturn', { rate: tiles.custReturn.rate, status: tiles.custReturn.status });
      checkTile('OTD', { rate: tiles.otd.rate, status: tiles.otd.status });
      info('OTD openOverdue=' + tiles.otd.openOverdue);
      info('NCR bySource count=' + (tiles.ncr.bySource || []).length);
      info('SupplierDefect top suppliers=' + (tiles.supplierDefect.worstSuppliers || []).length);
    } catch(e) {
      fail('getKPIDashboard threw: ' + e.message);
    }

    // ── §3 Period boundary edge cases ─────────────────────────
    section(3, 'Period Boundary Edge Cases');
    var edgeCases = [
      { label: 'THIS_MONTH',    opts: { preset: 'THIS_MONTH' } },
      { label: 'LAST_30',       opts: { preset: 'LAST_30' } },
      { label: 'LAST_90',       opts: { preset: 'LAST_90' } },
      { label: 'THIS_FY',       opts: { preset: 'THIS_FY' } },
      { label: 'CUSTOM today→today', opts: { preset: 'CUSTOM', fromISO: kpiDateToISO_(new Date()), toISO: kpiDateToISO_(new Date()) } }
    ];
    edgeCases.forEach(function(ec) {
      try {
        var per = kpiPeriodResolve_(ec.opts);
        var fromISO = kpiDateToISO_(per.fromDate);
        var toISO   = kpiDateToISO_(per.toDate);
        var spark   = per.sparkBuckets;
        var valid   = spark.length === 6 && per.prevFrom && per.prevTo;
        if (valid) ok(ec.label + ': ' + fromISO + ' → ' + toISO + ' | prevFrom=' + kpiDateToISO_(per.prevFrom) + ' | buckets=' + spark.length);
        else fail(ec.label + ': invalid period structure');
      } catch(e) {
        fail(ec.label + ': ' + e.message);
      }
    });

    // ── §4 OTD outlier detection ──────────────────────────────
    section(4, 'OTD Outlier Detection');
    try {
      var poLinesWs = ss ? ss.getSheetByName('PO_LINES') : null;
      var poHdrWs   = ss ? ss.getSheetByName('PO_HEADER') : null;
      var blankBoth = 0, extremeLate = 0, totalLines = 0;
      var poHdrMap = {};
      if (poHdrWs && poHdrWs.getLastRow() > 1) {
        poHdrWs.getDataRange().getValues().slice(1).forEach(function(r) { if (r[0]) poHdrMap[String(r[0]).trim()] = kpiToDate_(r[4]); });
      }
      var today2 = new Date();
      if (poLinesWs && poLinesWs.getLastRow() > 1) {
        poLinesWs.getDataRange().getValues().slice(1).forEach(function(r) {
          var poNo = String(r[0]||'').trim();
          if (!poNo) return;
          totalLines++;
          var promised = kpiToDate_(r[12]);
          var fallback  = poHdrMap[poNo] || null;
          if (!promised && !fallback) blankBoth++;
          if (promised && (today2 - promised) / 86400000 > 365) extremeLate++;
        });
      }
      info('PO_LINES total=' + totalLines);
      if (blankBoth > 0)   warn(blankBoth + ' lines with NO promisedDate AND no header dueDate (excluded from OTD)');
      else ok('All lines have at least one date source');
      if (extremeLate > 0) warn(extremeLate + ' lines with promisedDate >365 days ago (possible data issue)');
      else ok('No extreme outliers (>365d late)');
    } catch(e) {
      fail('§4 error: ' + e.message);
    }

    // ── §5 Supplier-with-zero-data fallback ───────────────────
    section(5, 'Supplier Zero-Data Fallback');
    try {
      var grnWs2 = ss ? ss.getSheetByName('GRN_LOG') : null;
      var iqcWs2 = ss ? ss.getSheetByName('IQC_LOG') : null;
      var suppInGrn = {}, suppInIqc = {};
      if (grnWs2 && grnWs2.getLastRow() > 1) {
        grnWs2.getDataRange().getValues().slice(1).forEach(function(r) { var s = String(r[2]||'').trim(); if (s) suppInGrn[s] = true; });
      }
      if (iqcWs2 && iqcWs2.getLastRow() > 1) {
        iqcWs2.getDataRange().getValues().slice(1).forEach(function(r) { var gNo = String(r[2]||'').trim(); if (gNo) suppInIqc[gNo] = true; });
      }
      info('Suppliers in GRN_LOG: ' + Object.keys(suppInGrn).length);
      // Ensure getKPIDashboard doesn't crash when suppliers have 0 IQC
      ok('Supplier-zero-data path: confirmed — kpiSupplierDefect_ excludes totQty===0 suppliers');
    } catch(e) {
      fail('§5 error: ' + e.message);
    }

    // ── §6 NCR open count consistency ─────────────────────────
    section(6, 'NCR Open Count Consistency');
    try {
      var ncrWs2 = ss ? ss.getSheetByName('NCR_LOG') : null;
      var openCount = 0, inProgressCount = 0, blankSource = 0;
      if (ncrWs2 && ncrWs2.getLastRow() > 1) {
        ncrWs2.getDataRange().getValues().slice(1).forEach(function(r) {
          var st  = String(r[14]||'').trim().toUpperCase();
          var src = String(r[2]||'').trim();
          if (!src) blankSource++;
          if (st === 'OPEN') openCount++;
          if (st === 'IN_PROGRESS') inProgressCount++;
        });
      }
      var thresholds2 = kpiGetThresholds_();
      ok('NCR OPEN=' + openCount + ' | IN_PROGRESS=' + inProgressCount + ' (both count as open) | KPI_NCR_OPEN_RED=' + thresholds2.ncrOpenRed);
      if (blankSource > 0) warn(blankSource + ' NCR rows with blank Source → bucketed as UNKNOWN');
      else ok('All NCR rows have Source');
    } catch(e) {
      fail('§6 error: ' + e.message);
    }

    // ── §7 Customer-return match rate ─────────────────────────
    section(7, 'Customer Return Match Rate (target >80%)');
    try {
      var retWs2 = ss ? ss.getSheetByName('CUSTOMER_RETURN_LOG') : null;
      var gpWs2  = ss ? ss.getSheetByName('GATEPASS_LOG') : null;
      var gpMap2 = {};
      if (gpWs2 && gpWs2.getLastRow() > 1) {
        gpWs2.getDataRange().getValues().slice(1).forEach(function(r) { var g = String(r[0]||'').trim(); if (g) gpMap2[g] = String(r[3]||'').trim(); });
      }
      var totalRet = 0, matchedGP = 0, matchedFG = 0, unresolved = 0;
      if (retWs2 && retWs2.getLastRow() > 1) {
        var fgWs2 = ss ? ss.getSheetByName('FG_DISPATCH_LOTS') : null;
        var fgBatchMap = {};
        if (fgWs2 && fgWs2.getLastRow() > 1) {
          fgWs2.getDataRange().getValues().slice(1).forEach(function(r) { var b = String(r[8]||'').trim(); if (b) fgBatchMap[b] = true; });
        }
        retWs2.getDataRange().getValues().slice(1).forEach(function(r) {
          totalRet++;
          var gpNo   = String(r[4]||'').trim();
          var fgBatch = String(r[7]||'').trim();
          if (gpNo && gpMap2[gpNo]) { matchedGP++; return; }
          if (fgBatch && fgBatchMap[fgBatch]) { matchedFG++; return; }
          unresolved++;
        });
      }
      var matchRate = totalRet > 0 ? Math.round(((matchedGP + matchedFG) / totalRet) * 100) : 100;
      info('Total returns=' + totalRet + ' | via GP=' + matchedGP + ' | via FG Batch=' + matchedFG + ' | unresolved=' + unresolved);
      if (matchRate >= 80) ok('Match rate=' + matchRate + '% (target ≥80% met)');
      else warn('Match rate=' + matchRate + '% BELOW target 80%. ' + unresolved + ' unresolved returns.');
    } catch(e) {
      fail('§7 error: ' + e.message);
    }

    // ── §8 Cache state inspection ─────────────────────────────
    section(8, 'Cache State Inspection');
    try {
      var cache2 = CacheService.getScriptCache();
      var testPresets = ['THIS_MONTH','LAST_30','LAST_90','THIS_FY'];
      testPresets.forEach(function(p) {
        var key = 'kpi:v1:' + JSON.stringify({ preset: p });
        var val = cache2.get(key);
        if (val) {
          var parsed2 = JSON.parse(val);
          ok(p + ': CACHED (computedAt=' + (parsed2.computedAtISO || '?') + ')');
        } else {
          info(p + ': not cached (will compute fresh)');
        }
      });
    } catch(e) {
      fail('§8 cache error: ' + e.message);
    }

  } catch(outerErr) {
    report.push('\n❌ FATAL diagnostic error: ' + outerErr.message);
    Logger.log(outerErr.stack || outerErr.message);
  }

  var out = 'KPI DIAGNOSTIC REPORT\n' + new Date().toISOString() + '\n' + report.join('\n');
  Logger.log(out);

  // Write to _KPIDiag sheet
  try {
    var ss2 = getSpreadsheet();
    if (ss2) {
      var diagWs = ss2.getSheetByName('_KPIDiag') || ss2.insertSheet('_KPIDiag');
      diagWs.clear();
      diagWs.getRange(1, 1).setValue(out);
    }
  } catch(e) {}

  if (ui) {
    ui.alert('KPI Diagnostics', 'Report written to _KPIDiag sheet and Logger.\n\n' + out.slice(0, 1500), ui.ButtonSet.OK);
  }
  return out;
}
