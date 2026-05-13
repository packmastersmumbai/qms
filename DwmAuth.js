// ============================================================
// DwmAuth.gs — PIN-based authentication and session management
// ============================================================

function dwmHashPin_(pin) {
  return sha256Hex_(String(pin));
}

function createSession_(userId) {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(DWM_SHEETS.SESSIONS);
  var sessionId = Utilities.getUuid();
  var now = new Date();
  var exp = new Date(now.getTime() + DWM_SESSION_TTL_MS);
  sh.appendRow([sessionId, userId, now.toISOString(), exp.toISOString()]);
  return sessionId;
}

function validateSession(sessionId) {
  if (!sessionId) return null;
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(DWM_SHEETS.SESSIONS);
  if (!sh || sh.getLastRow() < 2) return null;
  var data = sh.getDataRange().getValues();
  var nowMs = new Date().getTime();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === sessionId) {
      var expMs = new Date(data[r][3]).getTime();
      if (expMs < nowMs) return null;
      var userId = data[r][1];
      var user = getUserById_(userId);
      if (!user || !user.isActive) return null;
      return { userId: user.userId, role: user.role, name: user.name };
    }
  }
  return null;
}

function validateSessionFast_(sessionId) {
  if (!sessionId) return null;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sess_' + sessionId);
  if (cached) return JSON.parse(cached);

  const result = validateSession(sessionId);
  if (result) cache.put('sess_' + sessionId, JSON.stringify(result), 300);

  if (Math.random() < 0.05) pruneExpiredSessions_();
  return result;
}

function pruneExpiredSessions_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DWM_SHEETS.SESSIONS);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const toDelete = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const expiresAt = data[i][3]; // column index 3 (0-based) — matches validateSession
    if (expiresAt && new Date(expiresAt) < now) toDelete.push(i + 1);
  }
  toDelete.forEach(row => sheet.deleteRow(row));
}

function destroySession_(sessionId) {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(DWM_SHEETS.SESSIONS);
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === sessionId) {
      sh.deleteRow(r + 1);
      return;
    }
  }
}

function getUserById_(userId) {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(DWM_SHEETS.USERS);
  if (!sh || sh.getLastRow() < 2) return null;
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === userId) {
      return {
        userId: data[r][0], name: data[r][1], pin_hash: data[r][2],
        role: data[r][3], isActive: data[r][4] === true,
        createdAt: data[r][5], mustReset: data[r][6] === true,
        rowIndex: r + 1
      };
    }
  }
  return null;
}

function loginWithPin(userId, pin) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status:'error', message:'System busy, try again.' };
  try {
    var user = getUserById_(userId);
    if (!user || !user.isActive) {
      logAudit_(userId || 'UNKNOWN', 'LOGIN_FAIL', 'unknown or inactive user');
      return { status:'error', message:'Invalid user or PIN.' };
    }

    if (isLockedOut_(userId)) {
      return { status:'error', message:'Too many wrong attempts. Wait 60 seconds.' };
    }

    if (user.pin_hash !== dwmHashPin_(pin)) {
      logAudit_(userId, 'LOGIN_FAIL', 'wrong pin');
      if (countRecentFailures_(userId) + 1 >= DWM_LOCKOUT_THRESHOLD) {
        logAudit_(userId, 'LOCKOUT', '60s after ' + DWM_LOCKOUT_THRESHOLD + ' failures');
      }
      return { status:'error', message:'Invalid user or PIN.' };
    }

    var sessionId = createSession_(user.userId);
    logAudit_(userId, 'LOGIN', 'role=' + user.role);
    return {
      status: 'success',
      sessionId: sessionId,
      userId: user.userId,
      name: user.name,
      role: user.role,
      mustReset: user.mustReset === true
    };
  } finally {
    lock.releaseLock();
  }
}

function isLockedOut_(userId) {
  return countRecentFailures_(userId) >= DWM_LOCKOUT_THRESHOLD;
}

function countRecentFailures_(userId) {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(DWM_SHEETS.AUDIT);
  if (!sh || sh.getLastRow() < 2) return 0;
  var data = sh.getDataRange().getValues();
  var cutoffMs = new Date().getTime() - DWM_LOCKOUT_WINDOW_MS;
  var count = 0;
  for (var r = data.length - 1; r >= 1; r--) {
    var ts = new Date(data[r][0]).getTime();
    if (ts < cutoffMs) break;
    if (data[r][1] === userId && data[r][2] === 'LOGIN_FAIL') count++;
  }
  return count;
}

function logout(sessionId) {
  var s = validateSession(sessionId);
  if (s) logAudit_(s.userId, 'LOGOUT', '');
  destroySession_(sessionId);
  return { status:'success' };
}

function changePin(sessionId, oldPin, newPin) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    if (!/^\d{4}$/.test(String(newPin))) return { status:'error', message:'PIN must be exactly 4 digits.' };
    var user = getUserById_(s.userId);
    if (user.pin_hash !== dwmHashPin_(oldPin) && !user.mustReset) {
      return { status:'error', message:'Current PIN is incorrect.' };
    }
    var ss = getSpreadsheet();
    var sh = ss.getSheetByName(DWM_SHEETS.USERS);
    sh.getRange(user.rowIndex, 3).setValue(dwmHashPin_(newPin));
    sh.getRange(user.rowIndex, 7).setValue(false);
    logAudit_(s.userId, 'PIN_CHANGE', '');
    return { status:'success' };
  } catch (e) {
    logAudit_('SYSTEM','ERROR','changePin: ' + e);
    return { status:'error', message: e.message };
  }
}

function listActiveUsersForLogin() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(DWM_SHEETS.USERS);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    if (data[r][4] === true) out.push({ userId: data[r][0], name: data[r][1] });
  }
  return out;
}
