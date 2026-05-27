/**
 * Scan.js — Chokepoint Pilot (PLAN-V3.3)
 *
 * 4 chokepoints, 1 verb each, fixed by sticker location:
 *   LOC|GATE-IN     → RECEIVE
 *   LOC|GATE-OUT    → SHIP
 *   LOC|FLOOR-1-IN  → UP-1
 *   LOC|FLOOR-2-IN  → UP-2
 *
 * Operator authenticates via PIN keypad (server-side resolveOperator),
 * then scans the chokepoint sticker, then types/scans the lotId.
 *
 * Reuses PM QMS getSpreadsheet() + Session.getActiveUser() for the
 * outer Google-account auth layer. PIN is for identification only.
 */

var SCAN_EVENTS_SHEET    = 'SCAN_EVENTS';
var WIFI_LOG_SHEET       = 'WIFI_LOG';
var PILOT_DAILY_SHEET    = 'PILOT_DAILY';
var OPERATORS_SHEET      = 'OPERATORS';

var SCAN_EVENTS_HEADERS  = ['ts','userId','operatorPin','operatorName','locationId','verb','lotId','qty','googleEmail'];
var WIFI_LOG_HEADERS     = ['ts','operatorPin','locationId','latency_ms','status']; // status: OK | TIMEOUT | ERROR
var PILOT_DAILY_HEADERS  = ['date','locationId','expected_scans','actual_scans','bypass_pct','wifi_fail_pct','worst_role_shift_pct','notes'];
var OPERATORS_HEADERS    = ['pin','displayName','role','shift','active'];

// Chokepoint → verb table. Single source of truth.
var CHOKEPOINTS_ = {
  'LOC|GATE-IN':    'RECEIVE',
  'LOC|GATE-OUT':   'SHIP',
  'LOC|FLOOR-1-IN': 'UP-1',
  'LOC|FLOOR-2-IN': 'UP-2'
};

// ---------------------------------------------------------------------------
// Sheet ensure (idempotent — safe to call repeatedly)
// ---------------------------------------------------------------------------

function ensurePilotSheets() {
  var ss = getSpreadsheet();
  _ensureSheetWithHeaders_(ss, SCAN_EVENTS_SHEET,  SCAN_EVENTS_HEADERS);
  _ensureSheetWithHeaders_(ss, WIFI_LOG_SHEET,     WIFI_LOG_HEADERS);
  _ensureSheetWithHeaders_(ss, PILOT_DAILY_SHEET,  PILOT_DAILY_HEADERS);
  var opSh = _ensureSheetWithHeaders_(ss, OPERATORS_SHEET, OPERATORS_HEADERS);
  // Seed test PINs on first creation only (no rows beyond header).
  if (opSh && opSh.getLastRow() < 2) {
    var seed = [
      ['1234','Admin','admin','day','true'],
      ['1111','Priya','grn-clerk','day','true'],
      ['2222','Ravi','dispatch','day','true'],
      ['3333','Meena','floor-1','day','true'],
      ['4444','Suresh','floor-2','day','true']
    ];
    opSh.getRange(2, 1, seed.length, OPERATORS_HEADERS.length).setValues(seed);
  }
  return 'OK';
}

function _ensureSheetWithHeaders_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  // Backfill missing headers
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existing = sh.getRange(1, 1, 1, Math.max(lastCol, headers.length)).getValues()[0];
  var changed = false;
  for (var i = 0; i < headers.length; i++) {
    if ((existing[i] || '') !== headers[i]) { existing[i] = headers[i]; changed = true; }
  }
  if (changed) sh.getRange(1, 1, 1, headers.length).setValues([existing.slice(0, headers.length)]).setFontWeight('bold');
  return sh;
}

// ---------------------------------------------------------------------------
// Operator identity (PIN keypad)
// ---------------------------------------------------------------------------

/**
 * Resolve a 4-digit PIN → {pin, displayName, role, shift}.
 * Returns null if not found / inactive. PIN is identification only, not auth.
 */
function resolveOperator(pin) {
  var p = String(pin || '').trim();
  if (!/^\d{3,6}$/.test(p)) return null;
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(OPERATORS_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, OPERATORS_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[0]).trim() === p && String(r[4]).toLowerCase() !== 'false') {
      return {
        pin: p,
        displayName: String(r[1] || ''),
        role: String(r[2] || ''),
        shift: String(r[3] || '')
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core scan write
// ---------------------------------------------------------------------------

/**
 * Append one row to SCAN_EVENTS after validating locationId + PIN.
 * lotId is free-text (typed or scanned); qty optional.
 * Returns {ok:true, ts, verb} or throws.
 */
function recordScan(payload) {
  var pin       = String((payload || {}).pin || '').trim();
  var locationId = String((payload || {}).locationId || '').trim();
  var lotId     = String((payload || {}).lotId || '').trim();
  var qty       = (payload || {}).qty;

  // Validate locationId — must be one of the 4 chokepoints
  if (!CHOKEPOINTS_.hasOwnProperty(locationId)) {
    throw new Error('Invalid locationId: ' + locationId);
  }
  var verb = CHOKEPOINTS_[locationId];

  // Validate PIN → operator
  var op = resolveOperator(pin);
  if (!op) throw new Error('Unknown or inactive PIN');

  if (!lotId) throw new Error('lotId required');
  if (lotId.length > 100) throw new Error('lotId too long');

  // Try to capture Google account email (best-effort; may be empty in some contexts)
  var gEmail = '';
  try { gEmail = Session.getActiveUser().getEmail() || ''; } catch(e) {}

  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(SCAN_EVENTS_SHEET);
  if (!sh) { ensurePilotSheets(); sh = ss.getSheetByName(SCAN_EVENTS_SHEET); }

  var ts = new Date();
  sh.appendRow([
    ts,
    op.displayName,    // userId column = friendly name for downstream queries
    op.pin,
    op.displayName,
    locationId,
    verb,
    lotId,
    qty != null ? qty : '',
    gEmail
  ]);
  return { ok: true, ts: ts.toISOString(), verb: verb, operator: op.displayName, role: op.role, shift: op.shift };
}

// ---------------------------------------------------------------------------
// whereIsLot — derived current location from latest scan
// ---------------------------------------------------------------------------

/**
 * Given a lotId, return {locationId, verb, ts, implied} from the latest scan.
 * `implied` translates the last verb into a human-readable current state:
 *   RECEIVE → in warehouse
 *   UP-1    → on 1st floor
 *   UP-2    → on 2nd floor
 *   SHIP    → dispatched
 */
function whereIsLot(lotId) {
  var lot = String(lotId || '').trim();
  if (!lot) return { found: false, reason: 'lotId required' };
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(SCAN_EVENTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { found: false, reason: 'no scans recorded yet' };
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, SCAN_EVENTS_HEADERS.length).getValues();
  // Walk newest-first
  var latest = null;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][6]).trim() === lot) {
      latest = rows[i];
      break;
    }
  }
  if (!latest) return { found: false, reason: 'lot not scanned in this pilot' };
  var verb = latest[5];
  var implied = ({
    'RECEIVE': 'in warehouse',
    'UP-1':    'on 1st floor',
    'UP-2':    'on 2nd floor',
    'SHIP':    'dispatched'
  })[verb] || 'unknown';
  return {
    found: true,
    locationId: latest[4],
    verb: verb,
    ts: latest[0] instanceof Date ? latest[0].toISOString() : String(latest[0]),
    operator: latest[3],
    implied: implied
  };
}

// ---------------------------------------------------------------------------
// Wi-Fi heartbeat probe (client pings this every 60s)
// ---------------------------------------------------------------------------

function recordWifiProbe(payload) {
  var pin        = String((payload || {}).pin || '');
  var locationId = String((payload || {}).locationId || '');
  var latency    = Number((payload || {}).latency_ms || 0);
  var status     = String((payload || {}).status || 'OK').toUpperCase();
  if (['OK','TIMEOUT','ERROR'].indexOf(status) === -1) status = 'ERROR';
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(WIFI_LOG_SHEET);
  if (!sh) { ensurePilotSheets(); sh = ss.getSheetByName(WIFI_LOG_SHEET); }
  sh.appendRow([new Date(), pin, locationId, latency, status]);
  return { ok: true };
}

// Cheap server-side ping endpoint the client can hit to measure round-trip.
function pingScan() {
  return { ok: true, ts: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Nightly stats — bypass detection + compliance disaggregation + Wi-Fi rate
// ---------------------------------------------------------------------------

/**
 * Run nightly (or on demand). Computes per-chokepoint daily stats vs ground
 * truth and writes one row per (date, locationId) to PILOT_DAILY.
 *
 * Ground truth sources:
 *   GATE-IN     → GRN_LOG     (rows with that date)
 *   GATE-OUT    → GATEPASS_LOG or FG_DISPATCH_LOTS (whichever your dispatch flow uses)
 *   FLOOR-1-IN  → IPQC_Sessions (rows with that date, floor=1) — best-effort
 *   FLOOR-2-IN  → IPQC_Sessions (rows with that date, floor=2) — best-effort
 *
 * Returns the array of computed rows.
 */
function computeDailyPilotStats(dateStr) {
  var ss = getSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Kolkata';
  var today = dateStr ? new Date(dateStr) : new Date();
  var ymd = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  var scans   = _readRows_(ss, SCAN_EVENTS_SHEET);
  var wifi    = _readRows_(ss, WIFI_LOG_SHEET);
  var grn     = _readRows_(ss, 'GRN_LOG');
  var gatepass= _readRows_(ss, 'GATEPASS_LOG');
  var ipqc    = _readRows_(ss, 'IPQC_Sessions');

  // Filter scans + wifi to today
  var scansToday = scans.filter(function(r){ return _toYmd_(r[0], tz) === ymd; });
  var wifiToday  = wifi .filter(function(r){ return _toYmd_(r[0], tz) === ymd; });

  // Ground truth counts
  var grnToday      = grn     .filter(function(r){ return _toYmd_(r[0], tz) === ymd; }).length;
  var gatepassToday = gatepass.filter(function(r){ return _toYmd_(r[0], tz) === ymd; }).length;
  var ipqcTodayAll  = ipqc    .filter(function(r){ return _toYmd_(r[0], tz) === ymd; });
  // Floor inference for IPQC: best-effort — look for "1" or "2" in any column
  var ipqcF1 = ipqcTodayAll.filter(function(r){ return _rowMentions_(r, ['1F','FLOOR-1','floor 1','First','1st']); }).length || ipqcTodayAll.length;
  var ipqcF2 = ipqcTodayAll.filter(function(r){ return _rowMentions_(r, ['2F','FLOOR-2','floor 2','Second','2nd']); }).length || 0;

  var groundTruth = {
    'LOC|GATE-IN':    grnToday,
    'LOC|GATE-OUT':   gatepassToday,
    'LOC|FLOOR-1-IN': ipqcF1,
    'LOC|FLOOR-2-IN': ipqcF2
  };

  // Wi-Fi failure rate (overall, today)
  var wifiFail = wifiToday.filter(function(r){ return String(r[4]).toUpperCase() !== 'OK'; }).length;
  var wifiPct  = wifiToday.length ? (wifiFail / wifiToday.length) : 0;

  var rows = [];
  Object.keys(CHOKEPOINTS_).forEach(function(loc){
    var expected = Number(groundTruth[loc] || 0);
    var actual   = scansToday.filter(function(r){ return String(r[4]) === loc; }).length;
    var bypassPct = expected > 0 ? Math.max(0, (expected - actual) / expected) : 0;

    // worst (role × shift) cell for this chokepoint today
    var byCell = {};
    scansToday.forEach(function(r){
      if (String(r[4]) !== loc) return;
      var key = (r[1] || 'unknown') + '|' + _shiftOfTs_(r[0], tz);
      byCell[key] = (byCell[key] || 0) + 1;
    });
    // Without expected-per-cell ground truth, "worst cell %" is informational:
    // we report the cell with the FEWEST scans (lowest activity) as an early
    // warning. Real per-cell expected requires role-mapped GRN/dispatch logs.
    var minCell = Infinity;
    Object.keys(byCell).forEach(function(k){ if (byCell[k] < minCell) minCell = byCell[k]; });
    if (minCell === Infinity) minCell = 0;
    var worstPct = actual > 0 ? (minCell / actual) : 0;

    rows.push([
      ymd, loc, expected, actual,
      Number(bypassPct.toFixed(3)),
      Number(wifiPct.toFixed(3)),
      Number(worstPct.toFixed(3)),
      _verdictFor_(bypassPct, wifiPct)
    ]);
  });

  // Write rows to PILOT_DAILY (replace today's rows; append historical)
  var sh = ss.getSheetByName(PILOT_DAILY_SHEET);
  if (!sh) { ensurePilotSheets(); sh = ss.getSheetByName(PILOT_DAILY_SHEET); }
  // Remove today's rows first (idempotent)
  if (sh.getLastRow() >= 2) {
    var existing = sh.getRange(2, 1, sh.getLastRow() - 1, PILOT_DAILY_HEADERS.length).getValues();
    var keep = existing.filter(function(r){ return String(r[0]) !== ymd; });
    sh.getRange(2, 1, Math.max(existing.length, 1), PILOT_DAILY_HEADERS.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, PILOT_DAILY_HEADERS.length).setValues(keep);
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, PILOT_DAILY_HEADERS.length).setValues(rows);

  return rows;
}

function _verdictFor_(bypassPct, wifiPct) {
  if (wifiPct > 0.30) return 'CONNECTIVITY_FAIL';
  if (bypassPct > 0.50) return 'CHOKEPOINT_UNENFORCEABLE';
  if (bypassPct > 0.20) return 'WARN_root_cause_gap';
  if (bypassPct < 0.20) return 'OK';
  return 'OK';
}

function _readRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 1)).getValues();
}

function _toYmd_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (!v) return '';
  var d = new Date(v);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function _shiftOfTs_(v, tz) {
  if (!(v instanceof Date)) v = new Date(v);
  if (isNaN(v.getTime())) return 'unknown';
  var hh = Number(Utilities.formatDate(v, tz, 'HH'));
  if (hh >= 6 && hh < 18) return 'day';
  return 'night';
}

function _rowMentions_(row, needles) {
  for (var i = 0; i < row.length; i++) {
    var v = String(row[i] || '').toLowerCase();
    for (var j = 0; j < needles.length; j++) {
      if (v.indexOf(String(needles[j]).toLowerCase()) >= 0) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Trigger installer (one-time, idempotent)
// ---------------------------------------------------------------------------

function installPilotTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'computeDailyPilotStats') return 'already installed';
  }
  ScriptApp.newTrigger('computeDailyPilotStats')
    .timeBased()
    .atHour(22)
    .everyDays(1)
    .create();
  return 'installed';
}

// ---------------------------------------------------------------------------
// Public summary for admin UI (last 7 days)
// ---------------------------------------------------------------------------

function getPilotSummary() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(PILOT_DAILY_SHEET);
  if (!sh || sh.getLastRow() < 2) return { rows: [] };
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, PILOT_DAILY_HEADERS.length).getValues();
  // Last 7 calendar days
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Kolkata';
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  var cutYmd = Utilities.formatDate(cutoff, tz, 'yyyy-MM-dd');
  var filtered = rows.filter(function(r){ return String(r[0]) >= cutYmd; });
  return { headers: PILOT_DAILY_HEADERS, rows: filtered };
}
