// ============================================================
// Trace.gs — Batch traceability (RM/PM lot ↔ FG batch ↔ Dispatch)
// Pack Masters QMS | Google Apps Script
//
// Public entry:
//   traceBatch(anyDocNo) → unified trace object (see _emptyTrace_)
//
// Anchor resolver (4-layer):
//   1. PROD_JOBS.Job ID
//   2. Sheet docNo match across PO/GRN/IQC/IPQC/OQC/GP/NCR/CR/Dispatch
//   3. STOCK_LEDGER.Batch / Lot No.  (RM/PM lot)
//   4. BOM.Component                  (material code → all lots ever received)
//
// Cache: 6h TTL, fingerprint-invalidated (_pmSheetFingerprint_) — a sheet edit refreshes
// it immediately, but unchanged sheets serve the cached trace instead of re-scanning ~26
// sheets (~20-30s) on every open. (Was 60s, so most opens re-computed the full trace.)
//
// Date floor: default last 90 days; trace.meta.dateFloor exposes this.
// Loop guard: visited set keyed (kind,id), MAX_HOPS=30.
// Truncation: downstream FG-jobs and NCRs capped at 10 (UI offers "show all").
// ============================================================

var TRACE_DEFAULT_DAYS = 90;
var TRACE_MAX_HOPS     = 30;
var TRACE_LIST_CAP     = 10;
var TRACE_CACHE_TTL_S  = 21600;   // 6h (was 60s); safe — fingerprint-invalidated on sheet edits

function traceBatch(anyDocNo, opts) {
  if (!anyDocNo) return _emptyTrace_('Empty query.');
  var q = String(anyDocNo).trim();
  if (!q) return _emptyTrace_('Empty query.');
  var fullHistory = !!(opts && opts.fullHistory);
  var noCap = !!(opts && opts.noCap);

  var cacheKey = 'pmqms_trace_v1_' + (fullHistory ? 'full_' : '') + (noCap ? 'nocap_' : '') + q;
  var cached = _pmCacheGet_(cacheKey);
  if (cached) return cached;

  var result = _computeTrace_(q, { fullHistory: fullHistory, noCap: noCap });
  try {
    var raw = JSON.stringify({ fp: _pmSheetFingerprint_(), data: result });
    CacheService.getScriptCache().put(cacheKey, raw, TRACE_CACHE_TTL_S);
  } catch (e) { /* cache failure is non-fatal */ }
  return result;
}

function _emptyTrace_(message) {
  return {
    success: true,
    anchor: null,
    message: message || '',
    upstream:   { components: [] },
    thisBatch:  { focus: null, ipqc: [] },
    downstream: { oqc: [], gatepass: [], dispatch: [], fgJobs: [] },
    issues:     { ncr: [], customerReturn: [], orphans: [] },
    meta:       { dateFloor: null, truncated: {}, computedAt: _nowLabel_() }
  };
}

function _nowLabel_() {
  try {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm');
  } catch(e) { return new Date().toISOString(); }
}

function _dateFloorMs_(fullHistory) {
  if (fullHistory) return 0;
  return new Date().getTime() - (TRACE_DEFAULT_DAYS * 24 * 3600 * 1000);
}

// Drop rows older than the 90-day floor across downstream + IPQC + issues.
// Rows without a parseable date are kept (better to over-show than hide).
// Total drops are recorded in trace.meta.dateFiltered.
function _applyDateFloor_(trace) {
  var floor = _dateFloorMs_(false);
  var dropped = 0;
  function keep(row) {
    var t = _toMs_(row && row.dateLabel);
    if (!t) return true;
    if (t >= floor) return true;
    dropped++;
    return false;
  }
  if (trace.downstream) {
    ['oqc','gatepass','dispatch','fgJobs'].forEach(function(k){
      if (Array.isArray(trace.downstream[k])) trace.downstream[k] = trace.downstream[k].filter(keep);
    });
  }
  if (trace.thisBatch && Array.isArray(trace.thisBatch.ipqc)) {
    trace.thisBatch.ipqc = trace.thisBatch.ipqc.filter(keep);
  }
  if (trace.issues) {
    ['ncr','customerReturn','orphans'].forEach(function(k){
      if (Array.isArray(trace.issues[k])) trace.issues[k] = trace.issues[k].filter(keep);
    });
  }
  trace.meta.dateFiltered = dropped;
}

function _safeStr_(v) { return v == null ? '' : String(v).trim(); }
function _toMs_(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  var t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

// ----------------------------------------------------------------
// Resolver
// ----------------------------------------------------------------
function _computeTrace_(q, opts) {
  var fullHistory = !!(opts && opts.fullHistory);
  var noCap = !!(opts && opts.noCap);
  try {
    var anchor = _resolveAnchor_(q);
    if (!anchor) {
      var empty = _emptyTrace_('No record found for "' + q + '".');
      empty.success = true;
      return empty;
    }
    var trace = _emptyTrace_('');
    trace.anchor = anchor;
    trace.meta.dateFloor = fullHistory ? 0 : TRACE_DEFAULT_DAYS;
    trace.meta.fullHistory = fullHistory;
    trace.meta.noCap = noCap;

    // Visited set prevents loops + redundant walks
    var visited = {};
    function mark(kind, id) { visited[kind + ':' + id] = true; }
    function seen(kind, id) { return !!visited[kind + ':' + id]; }

    mark(anchor.type, anchor.docNo);

    // Route to a walker based on resolved kind
    if (anchor.type === 'PRODUCTION') {
      _walkFromFG_(trace, anchor.docNo, visited);
    } else if (anchor.type === 'LOT') {
      _walkFromLot_(trace, anchor.materialCode, anchor.batchOrLot, visited);
    } else if (anchor.type === 'GRN') {
      var lots = _lotsForGRN_(anchor.docNo);
      lots.forEach(function(l){
        if (!seen('LOT', l.material+'|'+l.batch)) _walkFromLot_(trace, l.material, l.batch, visited);
      });
    } else if (anchor.type === 'PO') {
      var grns = _grnsForPO_(anchor.docNo);
      grns.forEach(function(g){
        _lotsForGRN_(g.docNo).forEach(function(l){
          if (!seen('LOT', l.material+'|'+l.batch)) _walkFromLot_(trace, l.material, l.batch, visited);
        });
      });
    } else if (anchor.type === 'IQC') {
      // IQC row points at GRN; walk via the GRN's lots
      var grnRef = anchor.linkedGRN;
      if (grnRef) {
        _lotsForGRN_(grnRef).forEach(function(l){
          if (!seen('LOT', l.material+'|'+l.batch)) _walkFromLot_(trace, l.material, l.batch, visited);
        });
      }
    } else if (anchor.type === 'IPQC') {
      // IPQC session → FG batch via productCode + batch
      var jobs = _jobsForIPQC_(anchor.productCode, anchor.batch);
      if (jobs.length) {
        _walkFromFG_(trace, jobs[0].jobId, visited);
      } else {
        // Standalone IPQC; nothing to walk — keep anchor only
      }
    } else if (anchor.type === 'OQC') {
      var fg = _fgJobForOQC_(anchor.docNo, anchor.linkedFGBatch);
      if (fg) _walkFromFG_(trace, fg, visited);
    } else if (anchor.type === 'GATEPASS') {
      var fg2 = _fgJobForOQC_(anchor.linkedOQCRef, null);
      if (fg2) _walkFromFG_(trace, fg2, visited);
      // Always show this gatepass in the downstream lane regardless
      trace.downstream.gatepass.push({ docNo: anchor.docNo, status: anchor.status, date: anchor.dateLabel, party: anchor.party });
    } else if (anchor.type === 'DISPATCH') {
      var fg3 = _fgJobForOQC_(anchor.linkedOQCRef, anchor.linkedFGBatch);
      if (fg3) _walkFromFG_(trace, fg3, visited);
      trace.downstream.dispatch.push({ docNo: anchor.docNo, status: anchor.status, date: anchor.dateLabel, customer: anchor.party });
    } else if (anchor.type === 'NCR') {
      // NCR carries its own material+batch — walk as lot
      if (anchor.materialCode && anchor.batchOrLot) {
        _walkFromLot_(trace, anchor.materialCode, anchor.batchOrLot, visited);
      }
      trace.issues.ncr.push({
        docNo: anchor.docNo, status: anchor.status, date: anchor.dateLabel,
        defect: anchor.defect, raisedAtStep: anchor.source || 'NCR'
      });
    } else if (anchor.type === 'CR') {
      if (anchor.fgBatch) {
        var fgJob = _jobForFGBatch_(anchor.fgBatch);
        if (fgJob) _walkFromFG_(trace, fgJob, visited);
      }
      trace.issues.customerReturn.push({
        docNo: anchor.docNo, status: anchor.status, date: anchor.dateLabel,
        reason: anchor.defect, raisedAtStep: 'CustomerReturn'
      });
    }

    // Always: attach NCRs and Returns relevant to any lot in the upstream
    _attachIssuesForTrace_(trace);

    // Date-floor filter (skip when fullHistory). Anchor + focus rows are always kept.
    if (!fullHistory) _applyDateFloor_(trace);

    // Truncate (skipped when noCap)
    if (!noCap) {
      if (trace.downstream.fgJobs.length > TRACE_LIST_CAP) {
        trace.meta.truncated.fgJobs = trace.downstream.fgJobs.length;
        trace.downstream.fgJobs = trace.downstream.fgJobs.slice(0, TRACE_LIST_CAP);
      }
      if (trace.downstream.oqc.length > TRACE_LIST_CAP) {
        trace.meta.truncated.oqc = trace.downstream.oqc.length;
        trace.downstream.oqc = trace.downstream.oqc.slice(0, TRACE_LIST_CAP);
      }
      if (trace.downstream.gatepass.length > TRACE_LIST_CAP) {
        trace.meta.truncated.gatepass = trace.downstream.gatepass.length;
        trace.downstream.gatepass = trace.downstream.gatepass.slice(0, TRACE_LIST_CAP);
      }
      if (trace.downstream.dispatch.length > TRACE_LIST_CAP) {
        trace.meta.truncated.dispatch = trace.downstream.dispatch.length;
        trace.downstream.dispatch = trace.downstream.dispatch.slice(0, TRACE_LIST_CAP);
      }
      if (trace.issues.ncr.length > TRACE_LIST_CAP) {
        trace.meta.truncated.ncr = trace.issues.ncr.length;
        trace.issues.ncr = trace.issues.ncr.slice(0, TRACE_LIST_CAP);
      }
      if (trace.thisBatch.ipqc.length > TRACE_LIST_CAP) {
        trace.meta.truncated.ipqc = trace.thisBatch.ipqc.length;
        trace.thisBatch.ipqc = trace.thisBatch.ipqc.slice(0, TRACE_LIST_CAP);
      }
    }

    return trace;
  } catch (e) {
    Logger.log('traceBatch fatal: ' + e + ' stack: ' + e.stack);
    var t = _emptyTrace_('Trace failed: ' + e.message);
    t.success = false;
    return t;
  }
}

// ----------------------------------------------------------------
// Anchor resolver — 4 layers
// ----------------------------------------------------------------
function _resolveAnchor_(q) {
  var ss = getSpreadsheet();
  // Layer 1: PROD_JOBS exact match
  var pj = ss.getSheetByName('PROD_JOBS');
  if (pj && pj.getLastRow() > 1) {
    var pjData = traceValues_('PROD_JOBS');
    for (var i = 1; i < pjData.length; i++) {
      if (_safeStr_(pjData[i][0]) === q) {
        return {
          type: 'PRODUCTION', docNo: q,
          label: _safeStr_(pjData[i][3]) + ' — ' + _safeStr_(pjData[i][4]),
          status: _safeStr_(pjData[i][8]) || 'BOOKED',
          dateLabel: pjData[i][1] ? Utilities.formatDate(new Date(pjData[i][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
          client: _safeStr_(pjData[i][2]),
          fgCode: _safeStr_(pjData[i][3]),
          fgDesc: _safeStr_(pjData[i][4]),
          fgQty:  Number(pjData[i][5]) || 0,
          fgUom:  _safeStr_(pjData[i][6]),
          issueIds: _safeStr_(pjData[i][7])
        };
      }
    }
  }

  // Layer 2: docNo match across module sheets
  var modules = [
    { sheet: 'PO_HEADER',           col: 0, type: 'PO',         build: _buildPOAnchor_ },
    { sheet: 'GRN_LOG',             col: 0, type: 'GRN',        build: _buildGRNAnchor_ },
    { sheet: 'IQC_LOG',             col: 0, type: 'IQC',        build: _buildIQCAnchor_ },
    { sheet: 'IPQC_Sessions',       col: 0, type: 'IPQC',       build: _buildIPQCAnchor_ },
    { sheet: 'OQC_LOG',             col: 0, type: 'OQC',        build: _buildOQCAnchor_ },
    { sheet: 'GATEPASS_LOG',        col: 0, type: 'GATEPASS',   build: _buildGPAnchor_ },
    { sheet: 'FG_DISPATCH_LOTS',    col: 0, type: 'DISPATCH',   build: _buildDispatchAnchor_ },
    { sheet: 'NCR_LOG',             col: 0, type: 'NCR',        build: _buildNCRAnchor_ },
    { sheet: 'CUSTOMER_RETURN_LOG', col: 0, type: 'CR',         build: _buildCRAnchor_ }
  ];
  for (var m = 0; m < modules.length; m++) {
    var mod = modules[m];
    // Dynamic sheet name — resolved from the module table at runtime, so it
    // goes through the cache by NAME rather than a hard-coded call.
    var ws = ss.getSheetByName(mod.sheet);
    if (!ws || ws.getLastRow() < 2) continue;
    var data = traceValues_('GRN_LOG');
    for (var r = 1; r < data.length; r++) {
      if (_safeStr_(data[r][mod.col]) === q) {
        return mod.build(data[r]);
      }
    }
  }

  // Layer 3: STOCK_LEDGER batch/lot match (any txn touching this lot ID)
  var sl = ss.getSheetByName('STOCK_LEDGER');
  if (sl && sl.getLastRow() > 1) {
    var slData = traceValues_('STOCK_LEDGER');
    for (var s = 1; s < slData.length; s++) {
      if (_safeStr_(slData[s][4]) === q) {
        return {
          type: 'LOT', docNo: q,
          label: _safeStr_(slData[s][3]) + ' · Batch ' + q,
          materialCode: _safeStr_(slData[s][3]),
          batchOrLot:   q,
          status: 'ACTIVE',
          dateLabel: slData[s][1] ? Utilities.formatDate(new Date(slData[s][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : ''
        };
      }
    }
  }

  // Layer 4: BOM component code match
  var bom = ss.getSheetByName('BOM');
  if (bom && bom.getLastRow() > 1) {
    var bomData = traceValues_('BOM');
    for (var b = 1; b < bomData.length; b++) {
      if (_safeStr_(bomData[b][5]) === q) {
        return {
          type: 'LOT', docNo: q,
          label: _safeStr_(bomData[b][6]) + ' (no specific batch)',
          materialCode: q, batchOrLot: '',
          status: 'MATERIAL', dateLabel: ''
        };
      }
    }
  }

  return null;
}

// ----------------------------------------------------------------
// Anchor builders (per module)
// ----------------------------------------------------------------
function _buildPOAnchor_(row) {
  return {
    type: 'PO', docNo: _safeStr_(row[0]),
    label: 'PO — ' + _safeStr_(row[3]),
    status: _safeStr_(row[11]) || 'OPEN',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    party: _safeStr_(row[3])
  };
}
function _buildGRNAnchor_(row) {
  return {
    type: 'GRN', docNo: _safeStr_(row[0]),
    label: 'GRN — ' + _safeStr_(row[3]) + ' · ' + _safeStr_(row[7]),
    status: _safeStr_(row[15]) || 'IQC Pending',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    party: _safeStr_(row[3]),
    materialCode: _safeStr_(row[6]),
    batchOrLot: _safeStr_(row[8]),
    poRef: _safeStr_(row[4])
  };
}
function _buildIQCAnchor_(row) {
  return {
    type: 'IQC', docNo: _safeStr_(row[0]),
    label: 'IQC — ' + _safeStr_(row[4]),
    status: _safeStr_(row[22]) || 'PENDING',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    linkedGRN: _safeStr_(row[2]),
    batchOrLot: _safeStr_(row[5])
  };
}
function _buildIPQCAnchor_(row) {
  return {
    type: 'IPQC', docNo: _safeStr_(row[0]),
    label: 'IPQC — ' + _safeStr_(row[2]) + ' · Batch ' + _safeStr_(row[3]),
    status: _safeStr_(row[9]) || 'OPEN',
    dateLabel: row[6] ? Utilities.formatDate(new Date(row[6]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    productCode: _safeStr_(row[1]),
    batch:       _safeStr_(row[3])
  };
}
function _buildOQCAnchor_(row) {
  var lastIdx = row.length - 1;
  return {
    type: 'OQC', docNo: _safeStr_(row[0]),
    label: 'OQC — ' + _safeStr_(row[3]) + ' · ' + _safeStr_(row[5]),
    status: _safeStr_(row[14]) || _safeStr_(row[lastIdx]) || 'PENDING',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    party: _safeStr_(row[3]),
    linkedFGBatch: _safeStr_(row[4])
  };
}
function _buildGPAnchor_(row) {
  return {
    type: 'GATEPASS', docNo: _safeStr_(row[0]),
    label: 'Gatepass — ' + _safeStr_(row[2]) + ' · ' + _safeStr_(row[4]),
    status: _safeStr_(row[15]) || 'ISSUED',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    party: _safeStr_(row[4]),
    linkedOQCRef: _safeStr_(row[3])
  };
}
function _buildDispatchAnchor_(row) {
  return {
    type: 'DISPATCH', docNo: _safeStr_(row[0]),
    label: 'Dispatch Lot — ' + _safeStr_(row[5]) + ' · ' + _safeStr_(row[7]),
    status: _safeStr_(row[14]) || 'AVAILABLE',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    party: _safeStr_(row[5]),
    linkedOQCRef:  _safeStr_(row[2]),
    linkedFGBatch: _safeStr_(row[8])
  };
}
function _buildNCRAnchor_(row) {
  return {
    type: 'NCR', docNo: _safeStr_(row[0]),
    label: 'NCR — ' + _safeStr_(row[5]) + ' · ' + _safeStr_(row[6]),
    status: _safeStr_(row[14]) || 'OPEN',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    source: _safeStr_(row[2]),
    materialCode: _safeStr_(row[4]),
    batchOrLot:   _safeStr_(row[6]),
    defect:       _safeStr_(row[9])
  };
}
function _buildCRAnchor_(row) {
  return {
    type: 'CR', docNo: _safeStr_(row[0]),
    label: 'Customer Return — ' + _safeStr_(row[3]) + ' · ' + _safeStr_(row[6]),
    status: _safeStr_(row[15]) || 'OPEN',
    dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
    party: _safeStr_(row[3]),
    fgBatch: _safeStr_(row[7]),
    defect: _safeStr_(row[10])
  };
}

// ----------------------------------------------------------------
// Walkers
// ----------------------------------------------------------------
function _walkFromFG_(trace, jobId, visited) {
  var ss = getSpreadsheet();

  // 1. Fetch job header
  var pj = ss.getSheetByName('PROD_JOBS');
  if (!pj) return;
  var pjData = traceValues_('PROD_JOBS');
  var job = null;
  for (var i = 1; i < pjData.length; i++) {
    if (_safeStr_(pjData[i][0]) === jobId) { job = pjData[i]; break; }
  }
  if (!job) return;

  trace.thisBatch.focus = {
    type: 'PRODUCTION', docNo: jobId,
    fgCode: _safeStr_(job[3]), fgDesc: _safeStr_(job[4]),
    fgQty:  Number(job[5]) || 0, fgUom: _safeStr_(job[6]),
    client: _safeStr_(job[2]), status: _safeStr_(job[8]) || 'BOOKED',
    dateLabel: job[1] ? Utilities.formatDate(new Date(job[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm') : '',
    ipqcId: _safeStr_(job[9]), bookingId: _safeStr_(job[10])
  };
  var issueIds = _safeStr_(job[7]).split(/[,\s]+/).filter(Boolean);

  // 2. Upstream: from PROD_ISSUE_LOG (always present) + PROD_BOOKING_LOG (post-close)
  var issueLog = ss.getSheetByName('PROD_ISSUE_LOG');
  var bookLog  = ss.getSheetByName('PROD_BOOKING_LOG');
  var issuedRows = [];
  if (issueLog && issueLog.getLastRow() > 1) {
    var ilData = traceValues_('PROD_ISSUE_LOG');
    for (var ii = 1; ii < ilData.length; ii++) {
      if (issueIds.indexOf(_safeStr_(ilData[ii][0])) !== -1) {
        issuedRows.push({
          issueId: _safeStr_(ilData[ii][0]),
          poNo:    _safeStr_(ilData[ii][2]),
          matCode: _safeStr_(ilData[ii][3]),
          matName: _safeStr_(ilData[ii][4]),
          batch:   _safeStr_(ilData[ii][5]),
          location:_safeStr_(ilData[ii][6]),
          qty:     Number(ilData[ii][7]) || 0,
          unit:    _safeStr_(ilData[ii][8]),
          grnRef:  _safeStr_(ilData[ii][10])
        });
      }
    }
  }

  // Booking detail (qty consumed/returned/scrap/wastage/loss per component+lot)
  var bookedByKey = {};
  if (bookLog && bookLog.getLastRow() > 1) {
    var blData = traceValues_('PROD_BOOKING_LOG');
    for (var bb = 1; bb < blData.length; bb++) {
      if (_safeStr_(blData[bb][2]) !== jobId) continue;
      var k = _safeStr_(blData[bb][8]) + '|' + _safeStr_(blData[bb][10]);
      bookedByKey[k] = {
        booked:   Number(blData[bb][12]) || 0,
        consumed: Number(blData[bb][13]) || 0,
        returned: Number(blData[bb][14]) || 0,
        scrap:    Number(blData[bb][15]) || 0,
        wastage:  Number(blData[bb][16]) || 0,
        loss:     Number(blData[bb][17]) || 0
      };
    }
  }

  // Read BOM type map so we can label RM vs PM in the upstream lane
  var bomTypeByCode = {};
  var bomDescByCode = {};
  var bomWs = ss.getSheetByName('BOM');
  if (bomWs && bomWs.getLastRow() > 1) {
    var bomD = traceValues_('BOM');
    for (var bi = 1; bi < bomD.length; bi++) {
      if (_safeStr_(bomD[bi][1]) !== _safeStr_(job[3])) continue;
      var code = _safeStr_(bomD[bi][5]);
      if (!code) continue;
      bomTypeByCode[code] = _safeStr_(bomD[bi][10]) || 'COMP';
      bomDescByCode[code] = _safeStr_(bomD[bi][6]);
    }
  }

  // Group by component
  var byComp = {};
  issuedRows.forEach(function(r){
    if (!byComp[r.matCode]) {
      byComp[r.matCode] = {
        compCode: r.matCode, compDesc: r.matName || bomDescByCode[r.matCode] || '',
        type: bomTypeByCode[r.matCode] || 'COMP',
        unit: r.unit,
        totalIssued: 0, totalConsumed: 0,
        lots: []
      };
    }
    var book = bookedByKey[r.matCode + '|' + r.batch] || {};
    byComp[r.matCode].totalIssued += r.qty;
    byComp[r.matCode].totalConsumed += (book.consumed || 0);

    // Resolve GRN + IQC for this lot (single source: GRN_LOG by batch+material)
    var lotProvenance = _provenanceForLot_(r.matCode, r.batch, r.grnRef);

    byComp[r.matCode].lots.push({
      batch: r.batch, location: r.location,
      issuedQty: r.qty,
      consumedQty: book.consumed || 0,
      returnedQty: book.returned || 0,
      scrapQty:    book.scrap    || 0,
      wastageQty:  book.wastage  || 0,
      lossQty:     book.loss     || 0,
      grn: lotProvenance.grn, iqc: lotProvenance.iqc, po: lotProvenance.po,
      flags: lotProvenance.flags
    });
  });
  trace.upstream.components = Object.keys(byComp).map(function(k){ return byComp[k]; });

  // 3. This batch: IPQC sessions for the same productCode + (best-effort) batch
  // Job batch is rarely the IPQC batch (IPQC uses its own batch string), so
  // surface ALL closed-or-open IPQC for the product on/near the job timestamp.
  var ipqcWs = ss.getSheetByName('IPQC_Sessions');
  if (ipqcWs && ipqcWs.getLastRow() > 1) {
    var iqD = traceValues_('IPQC_Sessions');
    var jobMs = _toMs_(job[1]);
    var IPQC_WINDOW_MS = 3 * 24 * 3600 * 1000; // ±3 days from job timestamp
    for (var ip = 1; ip < iqD.length; ip++) {
      if (_safeStr_(iqD[ip][1]) !== _safeStr_(job[3])) continue;
      // Filter to sessions near the job timestamp — same productCode reused across many runs
      var sessMs = _toMs_(iqD[ip][6]);
      if (jobMs && sessMs && Math.abs(sessMs - jobMs) > IPQC_WINDOW_MS) continue;
      trace.thisBatch.ipqc.push({
        docNo:   _safeStr_(iqD[ip][0]),
        batch:   _safeStr_(iqD[ip][3]),
        status:  _safeStr_(iqD[ip][9]) || 'OPEN',
        inspector: _safeStr_(iqD[ip][4]),
        rounds:  Number(iqD[ip][10]) || 0,
        dateLabel: iqD[ip][6] ? Utilities.formatDate(new Date(iqD[ip][6]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : ''
      });
    }
  }

  // 4. Downstream: OQC → Gatepass → Dispatch, anchored on FG code (+ batch when known)
  var oqcByRef = [];
  var oqcWs = ss.getSheetByName('OQC_LOG');
  if (oqcWs && oqcWs.getLastRow() > 1) {
    var oD = traceValues_('OQC_LOG');
    for (var oi = 1; oi < oD.length; oi++) {
      var batchOrPO = _safeStr_(oD[oi][4]);
      var matDesc   = _safeStr_(oD[oi][5]);
      // Match on FG batch OR (when batch-blank old data) on FG desc
      if (batchOrPO === jobId || matDesc === _safeStr_(job[4])) {
        var oqcDoc = _safeStr_(oD[oi][0]);
        var oqcStat = _safeStr_(oD[oi][14]) || _safeStr_(oD[oi][oD[oi].length - 1]) || 'PENDING';
        oqcByRef.push(oqcDoc);
        trace.downstream.oqc.push({
          docNo: oqcDoc, status: oqcStat,
          dateLabel: oD[oi][1] ? Utilities.formatDate(new Date(oD[oi][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
          customer: _safeStr_(oD[oi][3])
        });
      }
    }
  }

  // Gatepasses link via OQC_REF
  if (oqcByRef.length) {
    var gpWs = ss.getSheetByName('GATEPASS_LOG');
    if (gpWs && gpWs.getLastRow() > 1) {
      var gD = traceValues_('GATEPASS_LOG');
      for (var gi = 1; gi < gD.length; gi++) {
        if (oqcByRef.indexOf(_safeStr_(gD[gi][3])) !== -1) {
          trace.downstream.gatepass.push({
            docNo: _safeStr_(gD[gi][0]),
            status: _safeStr_(gD[gi][15]) || 'ISSUED',
            dateLabel: gD[gi][1] ? Utilities.formatDate(new Date(gD[gi][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
            party: _safeStr_(gD[gi][4])
          });
        }
      }
    }
  }

  // Dispatch lots: match on OQC_REF or FG Batch
  var dspWs = ss.getSheetByName('FG_DISPATCH_LOTS');
  if (dspWs && dspWs.getLastRow() > 1) {
    var dD = traceValues_('FG_DISPATCH_LOTS');
    for (var di = 1; di < dD.length; di++) {
      var hit = (oqcByRef.indexOf(_safeStr_(dD[di][2])) !== -1) || _safeStr_(dD[di][8]) === jobId;
      if (!hit) continue;
      trace.downstream.dispatch.push({
        docNo: _safeStr_(dD[di][0]),
        status: _safeStr_(dD[di][14]) || 'AVAILABLE',
        dateLabel: dD[di][1] ? Utilities.formatDate(new Date(dD[di][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
        customer: _safeStr_(dD[di][5])
      });
    }
  }
}

function _walkFromLot_(trace, materialCode, batchOrLot, visited) {
  if (!materialCode) return;
  if (Object.keys(visited).length > TRACE_MAX_HOPS) return;

  // 1. Provenance: GRN + IQC + PO for this lot
  var lotProvenance = _provenanceForLot_(materialCode, batchOrLot, '');
  if (!trace.thisBatch.focus) {
    trace.thisBatch.focus = {
      type: 'LOT',
      materialCode: materialCode, batchOrLot: batchOrLot || '(no batch)',
      grn: lotProvenance.grn, iqc: lotProvenance.iqc, po: lotProvenance.po,
      flags: lotProvenance.flags
    };
  }
  // Push as a single-lot "component" entry in upstream
  trace.upstream.components.push({
    compCode: materialCode, compDesc: lotProvenance.matDesc || '',
    type: lotProvenance.bomType || 'COMP',
    unit: '',
    totalIssued: 0, totalConsumed: 0,
    lots: [{
      batch: batchOrLot, location: lotProvenance.location || '',
      issuedQty: 0, consumedQty: 0,
      grn: lotProvenance.grn, iqc: lotProvenance.iqc, po: lotProvenance.po,
      flags: lotProvenance.flags
    }]
  });

  // 2. Downstream: every PROD_ISSUE_LOG row consuming this (material, batch),
  // then for each, expand its FG job into downstream lane.
  var ss = getSpreadsheet();
  var issueLog = ss.getSheetByName('PROD_ISSUE_LOG');
  if (!issueLog || issueLog.getLastRow() < 2) return;
  var ilData = traceValues_('PROD_ISSUE_LOG');
  var consumingIssueIds = [];
  for (var ii = 1; ii < ilData.length; ii++) {
    if (_safeStr_(ilData[ii][3]) !== materialCode) continue;
    if (batchOrLot && _safeStr_(ilData[ii][5]) !== batchOrLot) continue;
    consumingIssueIds.push(_safeStr_(ilData[ii][0]));
  }
  if (!consumingIssueIds.length) return;

  // Resolve to FG jobs
  var pj = ss.getSheetByName('PROD_JOBS');
  if (!pj || pj.getLastRow() < 2) {
    // Orphan: issued but no job header
    trace.issues.orphans.push({
      kind: 'ISSUED_WITHOUT_JOB',
      issueIds: consumingIssueIds.slice(0, 5),
      note: 'PROD_JOBS sheet missing or empty; ' + consumingIssueIds.length + ' issue(s) reference lot.'
    });
    return;
  }
  var pjData = traceValues_('PROD_JOBS');
  var matchedJobs = {};
  for (var pi = 1; pi < pjData.length; pi++) {
    var rowIds = _safeStr_(pjData[pi][7]).split(/[,\s]+/).filter(Boolean);
    var hit = rowIds.some(function(id){ return consumingIssueIds.indexOf(id) !== -1; });
    if (!hit) continue;
    matchedJobs[_safeStr_(pjData[pi][0])] = pjData[pi];
  }
  var fgJobIds = Object.keys(matchedJobs);
  // Flag orphan issues (issued but no job)
  var orphanIssues = consumingIssueIds.filter(function(iid){
    return !fgJobIds.some(function(j){
      var rowIds = _safeStr_(matchedJobs[j][7]).split(/[,\s]+/);
      return rowIds.indexOf(iid) !== -1;
    });
  });
  if (orphanIssues.length) {
    trace.issues.orphans.push({
      kind: 'ISSUED_WITHOUT_JOB',
      issueIds: orphanIssues.slice(0, 5),
      note: orphanIssues.length + ' issue row(s) reference this lot but have no PROD_JOBS header. Possible failed/partial issue.'
    });
  }

  fgJobIds.forEach(function(j){
    var row = matchedJobs[j];
    trace.downstream.fgJobs.push({
      jobId: j,
      fgCode: _safeStr_(row[3]), fgDesc: _safeStr_(row[4]),
      fgQty: Number(row[5]) || 0, fgUom: _safeStr_(row[6]),
      status: _safeStr_(row[8]) || 'BOOKED',
      dateLabel: row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : ''
    });
  });
}

// ----------------------------------------------------------------
// Provenance helper: for (material, batch), find the GRN that brought it in,
// the IQC that inspected it, and the PO referenced by the GRN.
// ----------------------------------------------------------------
function _provenanceForLot_(materialCode, batchOrLot, knownGrnRef) {
  var out = {
    grn: null, iqc: null, po: null,
    matDesc: '', bomType: '', location: '',
    flags: []
  };
  if (!materialCode) return out;
  var ss = getSpreadsheet();

  // 1. GRN row — match by materialCode + batchOrLot (or by knownGrnRef directly)
  var grnWs = ss.getSheetByName('GRN_LOG');
  var grnRow = null;
  if (grnWs && grnWs.getLastRow() > 1) {
    var gData = traceValues_('GRN_LOG');
    for (var i = 1; i < gData.length; i++) {
      var ok;
      if (knownGrnRef) {
        ok = _safeStr_(gData[i][0]) === knownGrnRef &&
             _safeStr_(gData[i][6]) === materialCode;
      } else {
        ok = _safeStr_(gData[i][6]) === materialCode &&
             (!batchOrLot || _safeStr_(gData[i][8]) === batchOrLot);
      }
      if (ok) { grnRow = gData[i]; break; }
    }
  }
  if (grnRow) {
    out.matDesc  = _safeStr_(grnRow[7]);
    out.location = _safeStr_(grnRow[20]);
    out.grn = {
      docNo: _safeStr_(grnRow[0]),
      date:  grnRow[1] ? Utilities.formatDate(new Date(grnRow[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
      supplier: _safeStr_(grnRow[3]),
      status: _safeStr_(grnRow[15]) || 'IQC Pending',
      poRef: _safeStr_(grnRow[4])
    };

    // 2. IQC — find latest IQC row whose GRN No. == grnRow[0]
    var iqcWs = ss.getSheetByName('IQC_LOG');
    if (iqcWs && iqcWs.getLastRow() > 1) {
      var iqData = traceValues_('IQC_LOG');
      var iqcHit = null;
      for (var j = iqData.length - 1; j >= 1; j--) {
        if (_safeStr_(iqData[j][2]) === out.grn.docNo) { iqcHit = iqData[j]; break; }
      }
      if (iqcHit) {
        out.iqc = {
          docNo: _safeStr_(iqcHit[0]),
          date:  iqcHit[1] ? Utilities.formatDate(new Date(iqcHit[1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
          disposition: _safeStr_(iqcHit[22]) || 'PENDING'
        };
        // Defensive flag: lot consumed without IQC pass
        var disp = out.iqc.disposition.toUpperCase();
        if (disp !== 'ACCEPTED' && disp !== 'PASS' && disp !== 'ACCEPTED WITH DEVIATION') {
          out.flags.push('iqc-not-passed');
        }
      } else {
        out.flags.push('no-iqc');
      }
    }

    // 3. PO header (by po_no)
    if (out.grn.poRef) {
      var poWs = ss.getSheetByName('PO_HEADER');
      if (poWs && poWs.getLastRow() > 1) {
        var poData = traceValues_('PO_HEADER');
        for (var p = 1; p < poData.length; p++) {
          if (_safeStr_(poData[p][0]) === out.grn.poRef) {
            out.po = {
              docNo: _safeStr_(poData[p][0]),
              date:  poData[p][1] ? Utilities.formatDate(new Date(poData[p][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
              supplier: _safeStr_(poData[p][3]),
              status: _safeStr_(poData[p][11]) || 'OPEN'
            };
            break;
          }
        }
      }
    }
  } else {
    out.flags.push('no-grn');
  }

  // BOM type — first row matching materialCode (any FG)
  var bomWs = ss.getSheetByName('BOM');
  if (bomWs && bomWs.getLastRow() > 1) {
    var bD = traceValues_('BOM');
    for (var bk = 1; bk < bD.length; bk++) {
      if (_safeStr_(bD[bk][5]) === materialCode) {
        out.bomType = _safeStr_(bD[bk][10]) || 'COMP';
        if (!out.matDesc) out.matDesc = _safeStr_(bD[bk][6]);
        break;
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------
// Issue attachment — find NCRs / Customer Returns linked to anything in trace
// ----------------------------------------------------------------
function _attachIssuesForTrace_(trace) {
  var ss = getSpreadsheet();

  // Build (materialCode|batch) keyset from upstream + focus
  var keyset = {};
  trace.upstream.components.forEach(function(c){
    (c.lots || []).forEach(function(l){
      if (c.compCode && l.batch) keyset[c.compCode + '|' + l.batch] = true;
    });
  });
  if (trace.thisBatch.focus && trace.thisBatch.focus.type === 'LOT') {
    var f = trace.thisBatch.focus;
    if (f.materialCode && f.batchOrLot) keyset[f.materialCode + '|' + f.batchOrLot] = true;
  }

  // NCR matches: require BOTH material AND batch (avoid false positives)
  var ncrWs = ss.getSheetByName('NCR_LOG');
  if (ncrWs && ncrWs.getLastRow() > 1) {
    var nD = traceValues_('NCR_LOG');
    for (var i = 1; i < nD.length; i++) {
      var k = _safeStr_(nD[i][4]) + '|' + _safeStr_(nD[i][6]);
      if (!keyset[k]) continue;
      // Skip if already attached (e.g., NCR was the anchor itself)
      var doc = _safeStr_(nD[i][0]);
      if (trace.issues.ncr.some(function(n){ return n.docNo === doc; })) continue;
      trace.issues.ncr.push({
        docNo: doc,
        status: _safeStr_(nD[i][14]) || 'OPEN',
        dateLabel: nD[i][1] ? Utilities.formatDate(new Date(nD[i][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
        raisedAtStep: _safeStr_(nD[i][2]) || 'NCR',
        defect: _safeStr_(nD[i][9])
      });
    }
  }

  // Customer Return matches: by FG Batch (when focus is FG) — col 7
  if (trace.thisBatch.focus && trace.thisBatch.focus.type === 'PRODUCTION') {
    var crWs = ss.getSheetByName('CUSTOMER_RETURN_LOG');
    if (crWs && crWs.getLastRow() > 1) {
      var cD = traceValues_('CUSTOMER_RETURN_LOG');
      var fgJobId = trace.thisBatch.focus.docNo;
      for (var ci = 1; ci < cD.length; ci++) {
        if (_safeStr_(cD[ci][7]) !== fgJobId) continue;
        trace.issues.customerReturn.push({
          docNo: _safeStr_(cD[ci][0]),
          status: _safeStr_(cD[ci][15]) || 'OPEN',
          dateLabel: cD[ci][1] ? Utilities.formatDate(new Date(cD[ci][1]), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '',
          reason:  _safeStr_(cD[ci][10]),
          raisedAtStep: 'CustomerReturn'
        });
      }
    }
  }
}

// ----------------------------------------------------------------
// Small lookups used by anchor router
// ----------------------------------------------------------------
function _lotsForGRN_(grnNo) {
  var out = [];
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws || ws.getLastRow() < 2) return out;
  var data = traceValues_('GRN_LOG');
  for (var i = 1; i < data.length; i++) {
    if (_safeStr_(data[i][0]) === grnNo) {
      out.push({ material: _safeStr_(data[i][6]), batch: _safeStr_(data[i][8]) });
    }
  }
  return out;
}

function _grnsForPO_(poNo) {
  var out = [];
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws || ws.getLastRow() < 2) return out;
  var data = traceValues_('GRN_LOG');
  for (var i = 1; i < data.length; i++) {
    if (_safeStr_(data[i][4]) === poNo) {
      out.push({ docNo: _safeStr_(data[i][0]) });
    }
  }
  return out;
}

function _jobsForIPQC_(productCode, batch) {
  var out = [];
  var ws = getSpreadsheet().getSheetByName('PROD_JOBS');
  if (!ws || ws.getLastRow() < 2) return out;
  var data = traceValues_('GRN_LOG');
  for (var i = 1; i < data.length; i++) {
    if (_safeStr_(data[i][3]) === productCode) {
      out.push({ jobId: _safeStr_(data[i][0]), batch: batch || '' });
    }
  }
  return out;
}

function _fgJobForOQC_(oqcRef, fgBatchRef) {
  if (!oqcRef && !fgBatchRef) return null;
  var ss = getSpreadsheet();
  var pj = ss.getSheetByName('PROD_JOBS');
  if (!pj || pj.getLastRow() < 2) return null;
  var pjData = traceValues_('PROD_JOBS');
  // 1. Exact match: fgBatchRef is a PROD_JOBS jobId
  if (fgBatchRef) {
    for (var i = 1; i < pjData.length; i++) {
      if (_safeStr_(pjData[i][0]) === fgBatchRef) return _safeStr_(pjData[i][0]);
    }
  }
  // 2. Real data: OQC col 4 holds customer PO or supplier batch (e.g. P032240305, B2605E2E),
  // not the internal jobId. Look up the OQC row, then match Material Description (col 5)
  // against PROD_JOBS.fgDesc (col 4), picking the timestamp-closest job.
  if (oqcRef) {
    var oqcWs = ss.getSheetByName('OQC_LOG');
    if (oqcWs && oqcWs.getLastRow() > 1) {
      var oqcData = traceValues_('OQC_LOG');
      var matDesc = '', oqcDate = 0;
      for (var o = 1; o < oqcData.length; o++) {
        if (_safeStr_(oqcData[o][0]) === oqcRef) {
          matDesc = _safeStr_(oqcData[o][5]);
          oqcDate = _toMs_(oqcData[o][1]);
          break;
        }
      }
      if (matDesc) {
        var best = null, bestDelta = Infinity;
        for (var j = 1; j < pjData.length; j++) {
          if (_safeStr_(pjData[j][4]) !== matDesc) continue;
          var jDate = _toMs_(pjData[j][1]);
          var delta = oqcDate ? (oqcDate - jDate) : 0;
          if (delta < 0) delta = -delta * 10; // penalize jobs after OQC date
          if (delta < bestDelta) { bestDelta = delta; best = _safeStr_(pjData[j][0]); }
        }
        if (best) return best;
      }
    }
  }
  return null;
}

function _jobForFGBatch_(fgBatch) {
  if (!fgBatch) return null;
  var ws = getSpreadsheet().getSheetByName('PROD_JOBS');
  if (!ws || ws.getLastRow() < 2) return null;
  var data = traceValues_('PROD_JOBS');
  for (var i = 1; i < data.length; i++) {
    if (_safeStr_(data[i][0]) === fgBatch) return _safeStr_(data[i][0]);
  }
  return null;
}
