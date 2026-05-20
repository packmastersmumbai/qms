// ============================================================
// IPQC.gs — In-Process Quality Control
// Session-based inspection rounds against FG control plan
// Called by HTML forms via google.script.run
// ============================================================

// ---------- Sheet auto-create helpers ----------

function _ensureIPQCSessions() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('IPQC_Sessions');
  if (!ws) {
    ws = ss.insertSheet('IPQC_Sessions');
    ws.appendRow(['session_id', 'product_code', 'product_name', 'batch', 'inspector', 'line', 'date', 'start_time', 'end_time', 'status', 'rounds']);
  }
  return ws;
}

function _ensureIPQCLog() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('IPQC_LOG');
  if (!ws) {
    ws = ss.insertSheet('IPQC_LOG');
    ws.appendRow(['session_id', 'product_code', 'batch', 'round_no', 'timestamp', 'param_code', 'param_name', 'std_value', 'unit', 'actual_value', 'result', 'remark', 'elapsed_hms', 'period_start', 'period_end', 'avg_weight']);
  }
  return ws;
}

// ---------- Public API ----------

function getIPQCParams(productCode) {
  try {
    var ss = getSpreadsheet();

    var cpWs = ss.getSheetByName('CONTROL_FG');
    if (!cpWs) {
      return { params: [], warning: 'No control plan configured for this product' };
    }

    var cpData = cpWs.getDataRange().getValues();
    if (cpData.length < 2) {
      return { params: [], warning: 'No control plan configured for this product' };
    }

    // Build map of enabled control plan rows for this product
    // CONTROL_FG columns: item_code[0], param_code[1], enabled[2], std_value_override[3], tol_min_override[4], tol_max_override[5]
    var cpMap = {};
    for (var i = 1; i < cpData.length; i++) {
      var r = cpData[i];
      if (String(r[0]).trim() === String(productCode).trim() && (r[2] === 'Y' || r[2] === true)) {
        cpMap[String(r[1]).trim()] = {
          stdValueOverride: r[3],
          tolMinOverride:   r[4],
          tolMaxOverride:   r[5]
        };
      }
    }

    if (Object.keys(cpMap).length === 0) {
      return { params: [], warning: 'No control plan configured for this product' };
    }

    // Load MASTERS_Parameters
    // columns: code[0], name[1], unit[2], std_value[3], tol_min[4], tol_max[5], method_type[6], check_brief[7], tools[8], doc_ref[9], doc_number[10]
    var paramWs = ss.getSheetByName('MASTERS_Parameters');
    var paramMap = {};
    if (paramWs) {
      var paramData = paramWs.getDataRange().getValues();
      for (var j = 1; j < paramData.length; j++) {
        var p = paramData[j];
        if (p[0]) {
          paramMap[String(p[0]).trim()] = {
            paramName:  p[1],
            unit:       p[2],
            stdValue:   p[3],
            tolMin:     p[4],
            tolMax:     p[5],
            methodType: p[6],
            checkBrief: p[7],
            tools:      p[8]
          };
        }
      }
    }

    var params = [];
    for (var code in cpMap) {
      var cp = cpMap[code];
      var master = paramMap[code] || {};
      params.push({
        paramCode:  code,
        paramName:  master.paramName  || code,
        unit:       master.unit       || '',
        stdValue:   cp.stdValueOverride !== '' && cp.stdValueOverride !== undefined ? cp.stdValueOverride : (master.stdValue || ''),
        tolMin:     cp.tolMinOverride  !== '' && cp.tolMinOverride  !== undefined ? cp.tolMinOverride  : (master.tolMin  || ''),
        tolMax:     cp.tolMaxOverride  !== '' && cp.tolMaxOverride  !== undefined ? cp.tolMaxOverride  : (master.tolMax  || ''),
        methodType: master.methodType  || '',
        checkBrief: master.checkBrief  || '',
        tools:      master.tools       || ''
      });
    }

    return { params: params };
  } catch(e) {
    Logger.log(e);
    return { params: [], warning: e.message };
  }
}

function getIPQCFormInit() {
  var sessions = [];
  var loadWarnings = [];
  try {
    var r = getOpenSessions();
    sessions = r.sessions || [];
  } catch(e) {
    Logger.log('getIPQCFormInit: getOpenSessions failed — ' + e.message);
    loadWarnings.push('Open sessions failed to load — refresh or contact admin.');
  }
  return {
    fgList:       getFG(),
    inspectors:   getInspectors(),
    openSessions: sessions,
    today:        Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'),
    loadWarnings: loadWarnings
  };
}

function startSession(data) {
  try {
    var sessionId = data.productCode + '_' + data.batch + '_' + (data.inspector || '');
    var ws = _ensureIPQCSessions();
    var values = ws.getDataRange().getValues();

    // Check for existing session
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === sessionId) {
        if (String(values[i][9]).trim() === 'OPEN') {
          return { ok: true, resumed: true, sessionId: sessionId, rounds: values[i][10] || 0,
                   date: values[i][6], startTime: values[i][7] };
        } else {
          return { ok: false, error: 'A CLOSED session already exists for this product+batch. Use a new batch number.' };
        }
      }
    }

    // New session
    var now = new Date();
    var dateStr  = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    var timeStr  = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');
    ws.appendRow([
      sessionId,
      data.productCode,
      data.productName || '',
      data.batch,
      data.inspector   || '',
      data.line        || '',
      dateStr,
      timeStr,
      '',       // end_time
      'OPEN',
      0         // rounds
    ]);
    return { ok: true, resumed: false, sessionId: sessionId };
  } catch(e) {
    Logger.log(e);
    return { ok: false, error: e.message };
  }
}

function getOpenSessions() {
  try {
    var ws = _ensureIPQCSessions();
    var values = ws.getDataRange().getValues();
    var result = [];
    // IPQC_Sessions columns: session_id[0], product_code[1], product_name[2], batch[3], inspector[4], line[5], date[6], start_time[7], end_time[8], status[9], rounds[10]
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][9]).trim() === 'OPEN') {
        var rawDate = values[i][6];
        var dateStr = rawDate instanceof Date
          ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'dd/MM/yyyy')
          : String(rawDate);
        result.push({
          sessionId:   String(values[i][0]),
          productCode: String(values[i][1]),
          productName: String(values[i][2]),
          batch:       String(values[i][3]),
          inspector:   String(values[i][4]),
          line:        String(values[i][5]),
          date:        dateStr,
          startTime:   String(values[i][7]),
          rounds:      Number(values[i][10]) || 0
        });
      }
    }
    result.reverse();
    return { ok: true, sessions: result };
  } catch(e) {
    Logger.log(e);
    return { ok: false, error: e.message, sessions: [] };
  }
}

function getSessionRounds(sessionId) {
  try {
    Logger.log('getSessionRounds called with sessionId=' + JSON.stringify(sessionId));
    var ws = _ensureIPQCLog();
    var values = ws.getDataRange().getValues();
    Logger.log('IPQC_LOG total rows: ' + (values.length - 1));
    // IPQC_LOG cols: session_id[0] · product_code[1] · batch[2] · round_no[3] · timestamp[4]
    //   · param_code[5] · param_name[6] · std_value[7] · unit[8] · actual_value[9]
    //   · result[10] · remark[11] · elapsed_hms[12] · period_start[13] · period_end[14] · avg_weight[15]
    var sid = String(sessionId || '').trim();
    var roundMap = {};
    var matchCount = 0;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() !== sid) continue;
      matchCount++;
      var rNo = Number(values[i][3]);     // force numeric — avoid string/number key drift
      if (isNaN(rNo)) continue;
      var key = 'r' + rNo;                // prefixed string key — defensive
      if (!roundMap[key]) {
        roundMap[key] = {
          roundNo:    rNo,
          timestamp:  values[i][4] instanceof Date ? values[i][4].toISOString() : String(values[i][4] || ''),
          elapsedHms: values[i][12] instanceof Date
            ? Utilities.formatDate(values[i][12], 'Asia/Kolkata', 'HH:mm:ss')
            : String(values[i][12] || ''),
          avgWeight:  values[i][15] != null ? String(values[i][15]) : '',
          params: []
        };
      }
      roundMap[key].params.push({
        paramCode:   String(values[i][5] || ''),
        paramName:   String(values[i][6] || ''),
        stdValue:    values[i][7] != null ? String(values[i][7]) : '',
        unit:        String(values[i][8] || ''),
        actualValue: values[i][9] != null ? String(values[i][9]) : '',
        result:      String(values[i][10] || ''),
        remark:      String(values[i][11] || '')
      });
    }
    Logger.log('getSessionRounds matched ' + matchCount + ' rows for sid=' + sid);

    var rounds = [];
    for (var k in roundMap) { rounds.push(roundMap[k]); }
    rounds.sort(function(a, b) { return a.roundNo - b.roundNo; });
    Logger.log('getSessionRounds returning ' + rounds.length + ' rounds: ' + rounds.map(function(r){return 'R'+r.roundNo+'('+r.params.length+'p)';}).join(','));
    return { rounds: rounds };
  } catch(e) {
    Logger.log('getSessionRounds ERROR: ' + e);
    return { rounds: [], error: String(e) };
  }
}

function saveRound(sessionId, roundData) {
  try {
    var logWs  = _ensureIPQCLog();
    var sessWs = _ensureIPQCSessions();

    // Find current rounds count in IPQC_Sessions
    var sessValues = sessWs.getDataRange().getValues();
    var sessRowIdx = -1;
    var currentRounds = 0;
    for (var i = 1; i < sessValues.length; i++) {
      if (String(sessValues[i][0]).trim() === String(sessionId).trim()) {
        sessRowIdx   = i + 1; // 1-based sheet row
        currentRounds = sessValues[i][10] || 0;
        break;
      }
    }

    if (sessRowIdx < 0) {
      return { ok: false, error: 'Session not found: ' + sessionId };
    }

    var params = roundData.params || [];
    var lock = LockService.getScriptLock();
    // SCOPED LOCK: round-number derivation, log append, and counter write must all be
    // atomic — two concurrent round submissions otherwise produce duplicate round numbers.
    if (!lock.tryLock(10000)) {
      throw new Error('LOCK_TIMEOUT: saveRound could not acquire script lock within 10 s');
    }
    var roundNo;
    try {
      // Re-read the session row INSIDE the lock so we see any counter increment
      // from a concurrent call that beat us to the lock.
      var freshValues = sessWs.getDataRange().getValues();
      var freshRounds = 0;
      for (var k = 1; k < freshValues.length; k++) {
        if (String(freshValues[k][0]).trim() === String(sessionId).trim()) {
          freshRounds = freshValues[k][10] || 0;
          break;
        }
      }
      roundNo = Number(freshRounds) + 1;

      var now   = new Date();
      var tsStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');

      for (var j = 0; j < params.length; j++) {
        var p = params[j];
        logWs.appendRow([
          sessionId,
          roundData.productCode     || '',
          roundData.batch           || '',
          roundNo,
          tsStr,
          p.paramCode               || '',
          p.paramName               || '',
          p.stdValue                || '',
          p.unit                    || '',
          p.actualValue             || '',
          p.result                  || '',
          p.remark                  || '',
          roundData.elapsedHms      || '',
          roundData.periodStartTime || '',
          roundData.periodEndTime   || '',
          roundData.avgWeight       || ''
        ]);
      }

      // Increment rounds count INSIDE the lock so the counter is already updated
      // before any concurrent caller re-reads it after we release.
      if (sessRowIdx > 0) {
        // rounds is column 11 (index 10, 1-based col 11)
        sessWs.getRange(sessRowIdx, 11).setValue(roundNo);
      }
    } finally {
      lock.releaseLock();
    }

    // Auto-raise NCR for any out-of-spec (FAIL / REJECT) parameters in this round.
    // Runs OUTSIDE the lock (lock was released in finally above) so it does not
    // hold the script lock while doing NCR_LOG I/O.
    var ncrWarnings = [];
    var failedParams = params.filter(function(p) {
      var r = String(p.result || '').trim().toUpperCase();
      return r === 'FAIL' || r === 'REJECT' || r === 'REJECTED' || r === 'NG';
    });
    if (failedParams.length > 0) {
      // Look up product/batch from session row (already read above)
      var productCodeForNCR = roundData.productCode || '';
      var batchForNCR = roundData.batch || '';
      if (!productCodeForNCR || !batchForNCR) {
        // Fallback: re-read session row
        try {
          var svLookup = sessWs.getDataRange().getValues();
          for (var si = 1; si < svLookup.length; si++) {
            if (String(svLookup[si][0]).trim() === String(sessionId).trim()) {
              productCodeForNCR = productCodeForNCR || String(svLookup[si][1] || '');
              batchForNCR = batchForNCR || String(svLookup[si][3] || '');
              break;
            }
          }
        } catch(e2) {}
      }
      // Resolve product description from MASTERS_Materials
      var productDescForNCR = '';
      try {
        var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
        for (var mi2 = 0; mi2 < mats.length; mi2++) {
          if (String(mats[mi2].code || mats[mi2].itemCode || '').trim() === productCodeForNCR) {
            productDescForNCR = mats[mi2].name || mats[mi2].itemDescription || '';
            break;
          }
        }
      } catch(e3) {}

      // Load NCR_LOG once for dedup lookups (avoids repeated sheet reads per param).
      var ncrLogValues = [];
      try {
        var ncrLogWs = getSpreadsheet().getSheetByName('NCR_LOG');
        if (ncrLogWs && ncrLogWs.getLastRow() > 1) {
          ncrLogValues = ncrLogWs.getDataRange().getValues();
        }
      } catch(e4) { Logger.log('IPQC dedup: NCR_LOG read failed — ' + e4.message); }

      failedParams.forEach(function(p) {
        try {
          // Idempotency guard: skip if an NCR for this exact session+round+param already exists.
          var stableRef = sessionId + ' / round ' + roundNo + ' / ' + p.paramCode;
          var alreadyRaised = false;
          for (var di = 1; di < ncrLogValues.length; di++) {
            if (String(ncrLogValues[di][2] || '').trim() === 'IPQC' &&
                String(ncrLogValues[di][3] || '').trim() === stableRef) {
              alreadyRaised = true;
              break;
            }
          }
          if (alreadyRaised) return;

          var ncrNo = (typeof raiseNCR_ === 'function') ? raiseNCR_({
            date:         new Date(),
            source:       'IPQC',
            sourceRef:    sessionId + ' / round ' + roundNo + ' / ' + p.paramCode,
            materialCode: productCodeForNCR || '',
            materialDesc: productDescForNCR,
            batchNo:      batchForNCR || '',
            qtyAffected:  0,
            unit:         p.unit || '',
            defectDesc:   'IPQC out-of-spec — ' + (p.paramName || p.paramCode) +
                          ' actual=' + (p.actualValue || '') + ' std=' + (p.stdValue || '') +
                          (p.remark ? ' — ' + p.remark : '')
          }) : '';
          if (ncrNo) {
            // Back-stamp the IPQC_LOG remark column for this specific param row.
            // Find the row we just appended for this param inside the lock.
            var lv2 = logWs.getDataRange().getValues();
            for (var li = lv2.length - 1; li >= 1; li--) {
              if (String(lv2[li][0]).trim() === String(sessionId).trim() &&
                  Number(lv2[li][3]) === roundNo &&
                  String(lv2[li][5]).trim() === String(p.paramCode).trim()) {
                var existRmk = lv2[li][11] || '';
                var newRmk = 'NCR:' + ncrNo + (existRmk ? ' | ' + existRmk : '');
                logWs.getRange(li + 1, 12).setValue(newRmk);
                break;
              }
            }
          } else {
            ncrWarnings.push('NCR auto-raise FAILED for param ' + p.paramCode + ' round ' + roundNo + ' — raise manually.');
          }
        } catch(ncrErr) {
          Logger.log('IPQC auto-NCR failed for ' + p.paramCode + ': ' + ncrErr.message);
          ncrWarnings.push('NCR auto-raise FAILED for param ' + p.paramCode + ' — raise manually.');
        }
      });
    }

    return { ok: true, roundNo: roundNo, ncrWarnings: ncrWarnings };
  } catch(e) {
    Logger.log(e);
    return { ok: false, error: e.message };
  }
}

function closeSession(sessionId) {
  try {
    var ws = _ensureIPQCSessions();
    var values = ws.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(sessionId).trim()) {
        var endTime = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm:ss');
        // end_time = col 9 (1-based), status = col 10 (1-based)
        ws.getRange(i + 1, 9).setValue(endTime);
        ws.getRange(i + 1, 10).setValue('CLOSED');
        return { ok: true };
      }
    }
    return { ok: false, error: 'Session not found' };
  } catch(e) {
    Logger.log(e);
    return { ok: false, error: e.message };
  }
}

// Returns weight data keyed by periodNo -> rowIdx -> value
// Used by the matrix to prefill past period columns
function getSessionWeightData(sessionId) {
  try {
    var ws = _ensureIPQCLog();
    var values = ws.getDataRange().getValues();
    // IPQC_LOG: session_id[0], ..., round_no[3], ..., param_code[5], ..., actual_value[9]
    var result = {};
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() !== String(sessionId).trim()) continue;
      var roundNo = Number(values[i][3]);
      var code = String(values[i][5]).trim();
      // Weight rows are coded W01–W10
      if (/^W\d{2}$/.test(code)) {
        var rowIdx = parseInt(code.substring(1), 10);
        if (!result[roundNo]) result[roundNo] = {};
        result[roundNo][rowIdx] = values[i][9] !== undefined && values[i][9] !== '' ? String(values[i][9]) : '';
      }
    }
    return result;
  } catch(e) {
    Logger.log(e);
    return {};
  }
}

// Returns CLOSED IPQC sessions not yet consumed by an OQC entry.
// Used by OQC form to prefill product + batch from a completed IPQC run.
function getClosedIPQCSessionsForOQC() {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('IPQC_Sessions');
    if (!ws || ws.getLastRow() < 2) return [];

    var usedRefs = {};
    var oqcWs = ss.getSheetByName('OQC_LOG');
    if (oqcWs && oqcWs.getLastRow() > 1) {
      var oqcData = oqcWs.getRange(2, 20, oqcWs.getLastRow() - 1, 1).getValues();
      oqcData.forEach(function(r) { if (r[0]) usedRefs[String(r[0]).trim()] = true; });
    }

    var values = ws.getDataRange().getValues();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    var results = [];

    for (var i = 1; i < values.length; i++) {
      var sid = String(values[i][0] || '').trim();
      if (!sid) continue;
      if (String(values[i][9]).trim() !== 'CLOSED') continue;
      if (usedRefs[sid]) continue;
      var d = values[i][6];
      if (d && new Date(d) < cutoff) continue;

      var dateStr = d
        ? Utilities.formatDate(new Date(d), 'Asia/Kolkata', 'dd-MMM')
        : '';
      results.push({
        sessionId:   sid,
        productCode: String(values[i][1] || ''),
        productName: String(values[i][2] || ''),
        batch:       String(values[i][3] || ''),
        date:        dateStr,
        label:       sid + ' · ' + String(values[i][2] || values[i][1]) + ' · ' + String(values[i][3] || '') + (dateStr ? ' · ' + dateStr : '')
      });
    }
    results.reverse();
    return results;
  } catch(e) {
    Logger.log(e);
    return [];
  }
}

function getIPQCStatusForBatch(productCode, batch) {
  try {
    var sessionId = productCode + '_' + batch;
    var ws = _ensureIPQCSessions();
    var values = ws.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === sessionId) {
        return {
          found:     true,
          status:    values[i][9],
          sessionId: sessionId,
          rounds:    values[i][10] || 0
        };
      }
    }
    return { found: false };
  } catch(e) {
    Logger.log(e);
    return { found: false };
  }
}

function raiseIPQCNCR(sessionId, paramCode, roundNo, remark) {
  try {
    var ws = _ensureIPQCLog();
    var values = ws.getDataRange().getValues();

    // Find the IPQC_LOG row this NCR is being raised against
    // IPQC_LOG: session_id[0], product_code[1], batch[2], round_no[3], ts[4], param_code[5], param_name[6], ..., remark[11]
    var matchRow = null;
    var matchIdx = -1;
    for (var i = 1; i < values.length; i++) {
      if (
        String(values[i][0]).trim() === String(sessionId).trim() &&
        String(values[i][5]).trim() === String(paramCode).trim() &&
        String(values[i][3]).trim() === String(roundNo).trim()
      ) {
        matchRow = values[i];
        matchIdx = i;
        break;
      }
    }

    // Look up product/batch from IPQC_Sessions if we couldn't find the param row
    var productCode = matchRow ? matchRow[1] : '';
    var batch       = matchRow ? matchRow[2] : '';
    var paramName   = matchRow ? matchRow[6] : paramCode;
    if (!productCode || !batch) {
      var sessWs = _ensureIPQCSessions();
      var sessData = sessWs.getDataRange().getValues();
      for (var k = 1; k < sessData.length; k++) {
        if (String(sessData[k][0]).trim() === String(sessionId).trim()) {
          productCode = productCode || sessData[k][1];
          batch       = batch || sessData[k][3];
          break;
        }
      }
    }

    // Resolve product description from MASTERS_Materials if available
    var productDesc = '';
    try {
      var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
      for (var m = 0; m < mats.length; m++) {
        if (String(mats[m].code || mats[m].itemCode || '').trim() === String(productCode).trim()) {
          productDesc = mats[m].name || mats[m].itemDescription || '';
          break;
        }
      }
    } catch(e) {}

    // Write to NCR_LOG via the shared writer so this NCR appears in the triage queue.
    var ncrNo = (typeof raiseNCR_ === 'function') ? raiseNCR_({
      date:         new Date(),
      source:       'IPQC',
      sourceRef:    sessionId + ' / round ' + roundNo + ' / ' + paramCode,
      materialCode: productCode || '',
      materialDesc: productDesc,
      batchNo:      batch || '',
      qtyAffected:  0,
      unit:         '',
      defectDesc:   'IPQC reject — ' + (paramName || paramCode) + ' — ' + (remark || '')
    }) : '';

    if (!ncrNo) {
      return { ok: false, error: 'NCR_LOG write failed.' };
    }

    // Back-stamp the IPQC_LOG remark column so the matrix shows NCR ref inline
    if (matchIdx >= 0) {
      var existingRemark = values[matchIdx][11] || '';
      var newRemark = 'NCR:' + ncrNo + ' — ' + (remark || '');
      if (existingRemark) newRemark = newRemark + ' | ' + existingRemark;
      ws.getRange(matchIdx + 1, 12).setValue(newRemark);
    } else {
      // Row not found — append a note row so the NCR reference is not lost
      var tsStr = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
      ws.appendRow([
        sessionId, productCode || '', batch || '', roundNo, tsStr, paramCode, paramName || '', '', '', '', 'NOTE',
        'NCR:' + ncrNo + ' — ' + (remark || '') + ' [row not found at time of NCR raise]'
      ]);
    }

    return { ok: true, ncrNo: ncrNo };
  } catch(e) {
    Logger.log(e);
    return { ok: false, error: e.message };
  }
}

// ---------- Diagnostic (one-shot, callable from clasp run) ----------
function diag_IPQC_state() {
  var ss = getSpreadsheet();
  var sessWs = ss.getSheetByName('IPQC_Sessions');
  var logWs  = ss.getSheetByName('IPQC_LOG');
  var out = { sessions: [], logCounts: {}, logTotalRows: 0 };
  if (sessWs) {
    var sv = sessWs.getDataRange().getValues();
    for (var i = 1; i < sv.length; i++) {
      out.sessions.push({
        row: i + 1,
        id: String(sv[i][0]),
        product: String(sv[i][1]),
        batch: String(sv[i][3]),
        inspector: String(sv[i][4]),
        status: String(sv[i][9]),
        roundsCounter: sv[i][10]
      });
    }
  }
  if (logWs) {
    var lv = logWs.getDataRange().getValues();
    out.logTotalRows = lv.length - 1;
    for (var j = 1; j < lv.length; j++) {
      var id = String(lv[j][0]).trim();
      var rn = String(lv[j][3]);
      var key = id + ' :: R' + rn;
      out.logCounts[key] = (out.logCounts[key] || 0) + 1;
    }
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function diag_getSessionRounds(sessionId) {
  var r = getSessionRounds(sessionId);
  // Strip Date objects to strings so clasp run can serialize
  if (r && r.rounds) {
    r.rounds.forEach(function(rd) {
      if (rd.timestamp instanceof Date) rd.timestamp = rd.timestamp.toISOString();
    });
  }
  return JSON.stringify(r);
}

// Diagnostic: dump up to 5 IPQC_LOG rows. Optional sessionFilter substring
// narrows to a specific session; omit it to sample any rows.
function diag_logSampleRows(sessionFilter) {
  var ss = getSpreadsheet();
  var logWs = ss.getSheetByName('IPQC_LOG');
  var lv = logWs.getDataRange().getValues();
  var samples = [];
  var filter = sessionFilter ? String(sessionFilter) : '';
  for (var i = 1; i < lv.length && samples.length < 5; i++) {
    var id = String(lv[i][0]);
    if (!filter || id.indexOf(filter) !== -1) {
      samples.push({
        rowIdx: i,
        sessionId_raw: id,
        sessionId_len: id.length,
        sessionId_charCodes: Array.from(id).slice(0,30).map(function(c){return c.charCodeAt(0);}),
        round_no: lv[i][3],
        round_no_type: typeof lv[i][3],
        param_code: String(lv[i][5])
      });
    }
  }
  return JSON.stringify(samples, null, 2);
}
