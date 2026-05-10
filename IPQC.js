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
    ws.appendRow(['session_id', 'product_code', 'batch', 'round_no', 'timestamp', 'param_code', 'param_name', 'std_value', 'unit', 'actual_value', 'result', 'remark']);
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
  return {
    fgList:     getFG(),
    inspectors: getInspectors(),
    today:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

function startSession(data) {
  try {
    var sessionId = data.productCode + '_' + data.batch;
    var ws = _ensureIPQCSessions();
    var values = ws.getDataRange().getValues();

    // Check for existing session
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === sessionId) {
        if (values[i][9] === 'OPEN') {
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
      if (values[i][9] === 'OPEN') {
        result.push({
          sessionId:   values[i][0],
          productCode: values[i][1],
          productName: values[i][2],
          batch:       values[i][3],
          inspector:   values[i][4],
          line:        values[i][5],
          date:        values[i][6],
          startTime:   values[i][7],
          rounds:      values[i][10] || 0
        });
      }
    }
    result.reverse();
    return result;
  } catch(e) {
    Logger.log(e);
    return [];
  }
}

function getSessionRounds(sessionId) {
  try {
    var ws = _ensureIPQCLog();
    var values = ws.getDataRange().getValues();
    // IPQC_LOG columns: session_id[0], product_code[1], batch[2], round_no[3], timestamp[4], param_code[5], param_name[6], std_value[7], unit[8], actual_value[9], result[10], remark[11]
    var roundMap = {};
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() !== String(sessionId).trim()) continue;
      var rNo = values[i][3];
      if (!roundMap[rNo]) {
        roundMap[rNo] = { roundNo: rNo, timestamp: values[i][4], params: [] };
      }
      roundMap[rNo].params.push({
        paramCode:   values[i][5],
        paramName:   values[i][6],
        stdValue:    values[i][7],
        unit:        values[i][8],
        actualValue: values[i][9],
        result:      values[i][10],
        remark:      values[i][11]
      });
    }

    var rounds = [];
    for (var key in roundMap) {
      rounds.push(roundMap[key]);
    }
    rounds.sort(function(a, b) { return a.roundNo - b.roundNo; });
    return { rounds: rounds };
  } catch(e) {
    Logger.log(e);
    return { rounds: [] };
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

    var roundNo = currentRounds + 1;
    var now = new Date();
    var tsStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');

    var params = roundData.params || [];
    for (var j = 0; j < params.length; j++) {
      var p = params[j];
      logWs.appendRow([
        sessionId,
        roundData.productCode || '',
        roundData.batch       || '',
        roundNo,
        tsStr,
        p.paramCode   || '',
        p.paramName   || '',
        p.stdValue    || '',
        p.unit        || '',
        p.actualValue || '',
        p.result      || '',
        p.remark      || ''
      ]);
    }

    // Increment rounds count in IPQC_Sessions
    if (sessRowIdx > 0) {
      // rounds is column 11 (index 10, 1-based col 11)
      sessWs.getRange(sessRowIdx, 11).setValue(roundNo);
    }

    return { ok: true, roundNo: roundNo };
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
    var ncrNo = getNextDocNumber('ncr');
    var ws = _ensureIPQCLog();
    var values = ws.getDataRange().getValues();
    // IPQC_LOG: session_id[0], ..., round_no[3], ..., param_code[5], ..., remark[11]
    var found = false;
    for (var i = 1; i < values.length; i++) {
      if (
        String(values[i][0]).trim() === String(sessionId).trim() &&
        String(values[i][5]).trim() === String(paramCode).trim() &&
        String(values[i][3]).trim() === String(roundNo).trim()
      ) {
        var existingRemark = values[i][11] || '';
        var newRemark = 'NCR:' + ncrNo + ' — ' + remark;
        if (existingRemark) newRemark = newRemark + ' | ' + existingRemark;
        ws.getRange(i + 1, 12).setValue(newRemark);
        found = true;
        break;
      }
    }

    if (!found) {
      // Row not found — append a note row so the NCR reference is not lost
      var tsStr = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
      ws.appendRow([
        sessionId, '', '', roundNo, tsStr, paramCode, '', '', '', '', 'NOTE',
        'NCR:' + ncrNo + ' — ' + remark + ' [row not found at time of NCR raise]'
      ]);
    }

    return { ok: true, ncrNo: ncrNo };
  } catch(e) {
    Logger.log(e);
    return { ok: false, error: e.message };
  }
}
