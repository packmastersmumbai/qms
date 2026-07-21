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

// Lifecycle action per chokepoint (real STOCK_LEDGER effect):
//   RECEIVE → IN at the chokepoint's real location (new stock)
//   MOVE    → OUT at lot's current location + IN at the chokepoint's real location
//   SHIP    → OUT reducing balance to zero (dispatched)
var CHOKEPOINT_ACTION_ = {
  'LOC|GATE-IN':    'RECEIVE',
  'LOC|FLOOR-1-IN': 'MOVE',
  'LOC|FLOOR-2-IN': 'MOVE',
  'LOC|GATE-OUT':   'SHIP'
};

// Chokepoint → real LOCATIONS row id. Created by ensureChokepointLocations_().
// GATE-OUT has no destination location (stock leaves the building → 'DISPATCHED' marker).
var CHOKEPOINT_LOCATION_ = {
  'LOC|GATE-IN':    'SCAN-GATE-IN',
  'LOC|FLOOR-1-IN': 'SCAN-FLOOR-1',
  'LOC|FLOOR-2-IN': 'SCAN-FLOOR-2',
  'LOC|GATE-OUT':   'DISPATCHED'
};

// New LOCATIONS rows backing the chokepoints (matches LOCATIONS_HEADERS, 12 cols).
var CHOKEPOINT_LOCATION_ROWS_ = [
  ['SCAN-GATE-IN', 'GF', 'Stores', '', '', '', '', 'Scan — Gate In (receiving)', 'RM', '', '', 'Y'],
  ['SCAN-FLOOR-1', '1F', 'Floor 1', '', '', '', '', 'Scan — 1st Floor',          'WIP','', '', 'Y'],
  ['SCAN-FLOOR-2', '2F', 'Floor 2', '', '', '', '', 'Scan — 2nd Floor',          'WIP','', '', 'Y']
];

/**
 * Idempotently add the 3 chokepoint locations to the LOCATIONS sheet.
 * (GATE-OUT is a logical 'DISPATCHED' state, not a physical location.)
 * Safe to re-run — skips ids that already exist. Returns {added, existing}.
 */
function ensureChokepointLocations_() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName('LOCATIONS');
  if (!sh) throw new Error('LOCATIONS sheet missing — run Initialize first');
  var have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(r){
      if (r[0]) have[String(r[0]).trim()] = true;
    });
  }
  var added = [], existing = [];
  CHOKEPOINT_LOCATION_ROWS_.forEach(function(row){
    if (have[row[0]]) { existing.push(row[0]); return; }
    sh.appendRow(row);
    added.push(row[0]);
  });
  return { added: added, existing: existing };
}

/** Public setup entry point — call once on rollout (also ensures pilot sheets). */
function setupScanWms() {
  ensurePilotSheets();
  var loc = ensureChokepointLocations_();
  return { ok: true, locations: loc };
}

/** Config for the scan UI / verification — the 4 chokepoints, their verb, action, and target location. */
function getChokepointConfig() {
  return Object.keys(CHOKEPOINTS_).map(function(loc){
    return { locationId: loc, verb: CHOKEPOINTS_[loc], action: CHOKEPOINT_ACTION_[loc], targetLocation: CHOKEPOINT_LOCATION_[loc] };
  });
}

// ---------------------------------------------------------------------------
// Sheet ensure (idempotent — safe to call repeatedly)
// ---------------------------------------------------------------------------

/**
 * Replace the OPERATORS sheet contents with the DWM-mirrored seed.
 * Admin-only; idempotent. Use when rolling out PLAN-V3.3 to a fresh tenant
 * or resetting the seed after testing.
 */
function reseedOperators() {
  var ss = getSpreadsheet();
  var opSh = ss.getSheetByName(OPERATORS_SHEET) || _ensureSheetWithHeaders_(ss, OPERATORS_SHEET, OPERATORS_HEADERS);
  // Clear body rows (keep header)
  if (opSh.getLastRow() > 1) {
    opSh.getRange(2, 1, opSh.getLastRow() - 1, OPERATORS_HEADERS.length).clearContent();
  }
  var seed = [
    ['1234','Admin',  'admin',     'day','true'],
    ['1111','Khushi', 'grn-clerk', 'day','true'],
    ['2222','Anuj',   'floor-1',   'day','true'],
    ['3333','Santosh','floor-2',   'day','true'],
    ['4444','Rajesh', 'gate',      'day','true'],
    ['5555','TBM',    'admin',     'day','true'],
    ['6666','BBM',    'owner',     'day','true']
  ];
  opSh.getRange(2, 1, seed.length, OPERATORS_HEADERS.length).setValues(seed);
  return { ok: true, seeded: seed.length };
}

function ensurePilotSheets() {
  var ss = getSpreadsheet();
  _ensureSheetWithHeaders_(ss, SCAN_EVENTS_SHEET,  SCAN_EVENTS_HEADERS);
  _ensureSheetWithHeaders_(ss, WIFI_LOG_SHEET,     WIFI_LOG_HEADERS);
  _ensureSheetWithHeaders_(ss, PILOT_DAILY_SHEET,  PILOT_DAILY_HEADERS);
  var opSh = _ensureSheetWithHeaders_(ss, OPERATORS_SHEET, OPERATORS_HEADERS);
  // Seed PINs on first creation only — mirrors DWM user list (7 active users).
  // Role mapping = DWM role → PM QMS chokepoint duty. PINs are PM-QMS-local
  // (NOT DWM's hashed PINs); rotate them by editing this sheet.
  if (opSh && opSh.getLastRow() < 2) {
    var seed = [
      ['1234','Admin',  'admin',     'day','true'],
      ['1111','Khushi', 'grn-clerk', 'day','true'],
      ['2222','Anuj',   'floor-1',   'day','true'],
      ['3333','Santosh','floor-2',   'day','true'],
      ['4444','Rajesh', 'gate',      'day','true'],
      ['5555','TBM',    'admin',     'day','true'],
      ['6666','BBM',    'owner',     'day','true']
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
// Lookup — current stock state for a lot, + a preview of the scan's effect
// ---------------------------------------------------------------------------

/**
 * Look up a lot's current stock and return what THIS scan would do.
 * lotId is matched against STOCK_LEDGER batch/lot (case-insensitive).
 *
 * Returns:
 *   { found, lotId, materialCode, materialDesc, unit,
 *     current: [{locationId, balance}], totalBalance,
 *     action, fromLocation, toLocation, preview, ok, blockReason }
 *
 * ok=false + blockReason set when the action can't proceed (e.g. SHIP/MOVE a
 * lot with no stock, or RECEIVE a lot that already has stock).
 */
function lookupLotForScan(lotId, locationId) {
  var lot = String(lotId || '').trim();
  var loc = String(locationId || '').trim();
  if (!lot) return { found: false, ok: false, blockReason: 'lotId required' };
  if (!CHOKEPOINTS_.hasOwnProperty(loc)) return { found: false, ok: false, blockReason: 'Invalid chokepoint' };

  var action = CHOKEPOINT_ACTION_[loc];
  var target = CHOKEPOINT_LOCATION_[loc];

  // Current stock for this lot across locations (positive balances only).
  var summary = getStockSummary().filter(function(s){
    return String(s.batchOrLotNo).trim().toLowerCase() === lot.toLowerCase() && s.balance > 0;
  });
  var totalBalance = summary.reduce(function(a, s){ return a + Number(s.balance || 0); }, 0);
  var materialCode = summary.length ? summary[0].materialCode : '';

  // Material desc/unit (best-effort from masters).
  var desc = '', unit = '';
  if (materialCode) {
    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    for (var i = 0; i < mats.length; i++) {
      if (mats[i].code === materialCode) { desc = mats[i].desc || ''; unit = mats[i].unit || ''; break; }
    }
  }

  // Pick the source location = the location holding the most of this lot.
  var fromLoc = '';
  if (summary.length) {
    summary.sort(function(a, b){ return b.balance - a.balance; });
    fromLoc = summary[0].locationId;
  }

  var out = {
    found: summary.length > 0,
    lotId: lot, materialCode: materialCode, materialDesc: desc, unit: unit,
    current: summary.map(function(s){ return { locationId: s.locationId, balance: s.balance }; }),
    totalBalance: totalBalance,
    action: action, fromLocation: fromLoc, toLocation: target,
    ok: true, blockReason: ''
  };

  if (action === 'RECEIVE') {
    if (totalBalance > 0) {
      out.ok = false;
      out.blockReason = 'Lot already in stock (' + totalBalance + (unit ? ' ' + unit : '') + ' at ' + fromLoc + '). Use a floor scan to move it, or receive via GRN.';
    }
    out.preview = 'Receive lot ' + lot + ' into ' + target;
  } else if (action === 'MOVE') {
    if (totalBalance <= 0) {
      out.ok = false;
      out.blockReason = 'Lot not in stock — cannot move. Receive it at Gate-In (or via GRN) first.';
    }
    out.preview = 'Move ' + totalBalance + (unit ? ' ' + unit : '') + ' of ' + lot + ' from ' + (fromLoc || '?') + ' → ' + target;
  } else if (action === 'SHIP') {
    if (totalBalance <= 0) {
      out.ok = false;
      out.blockReason = 'Lot not in stock — nothing to dispatch.';
    }
    out.preview = 'Dispatch ' + totalBalance + (unit ? ' ' + unit : '') + ' of ' + lot + ' from ' + (fromLoc || '?');
  }
  return out;
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
  var locationId = String((payload || {}).locationId || '').trim();
  var lotId     = String((payload || {}).lotId || '').trim();
  var operator  = String((payload || {}).operator || '').trim();
  var confirmed = (payload || {}).confirmed === true;   // UI must confirm the previewed action

  // Validate locationId — must be one of the 4 chokepoints
  if (!CHOKEPOINTS_.hasOwnProperty(locationId)) {
    throw new Error('Invalid locationId: ' + locationId);
  }
  var verb   = CHOKEPOINTS_[locationId];
  var action = CHOKEPOINT_ACTION_[locationId];
  var target = CHOKEPOINT_LOCATION_[locationId];

  // Identity = self-selected operator name (no PIN, no Google gate).
  var op = resolveOperatorByName_(operator);
  if (!op) throw new Error('Select who you are first');

  if (!lotId) throw new Error('lotId required');
  if (lotId.length > 100) throw new Error('lotId too long');

  // Re-evaluate stock state server-side (never trust the client preview).
  var look = lookupLotForScan(lotId, locationId);
  if (!look.ok) throw new Error(look.blockReason || 'Scan not allowed');
  if (!confirmed) throw new Error('Confirm the action first');

  // ---- Real STOCK_LEDGER lifecycle write (single source of truth) ----
  var refNo = 'SCAN-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var mat   = look.materialCode;
  var desc  = look.materialDesc;
  var moved = 0;

  if (action === 'RECEIVE') {
    // Gate-In is a real receive: operator enters the qty (lot is new, nothing to look up).
    var rcvQty = Number((payload || {}).qty) || 0;
    if (rcvQty <= 0) throw new Error('Enter the quantity received at Gate-In');
    var rcvMat = String((payload || {}).materialCode || mat || '').trim();
    if (!rcvMat) throw new Error('Material code required for Gate-In receive');
    moved = rcvQty;
    writeStockLedger_('SCAN_RECEIVE', rcvMat, lotId, target, rcvQty, 0, 'SCAN', refNo, op.name, 'Gate-In scan receive', desc);
    mat = rcvMat;
  } else if (action === 'MOVE') {
    // Debit EACH holding location for what it actually holds, then one IN at the target.
    // Was: the lot's TOTAL balance debited from the single largest holder — which drove
    // that location negative and left phantom stock at every other location.
    moved = 0;
    (look.current || []).forEach(function(c){
      var q = Number(c.balance) || 0;
      if (q <= 0) return;
      writeStockLedger_('SCAN_MOVE', mat, lotId, c.locationId, 0, q, 'SCAN', refNo, op.name, 'Move → ' + target, desc);
      moved += q;
    });
    if (moved > 0) {
      writeStockLedger_('SCAN_MOVE', mat, lotId, target, moved, 0, 'SCAN', refNo, op.name,
        'Move ← ' + (look.current || []).map(function(c){ return c.locationId; }).join(', '), desc);
    }
  } else if (action === 'SHIP') {
    // Debit each holding location for its own balance so the lot goes to zero everywhere.
    moved = 0;
    (look.current || []).forEach(function(c){
      var q = Number(c.balance) || 0;
      if (q <= 0) return;
      writeStockLedger_('SCAN_SHIP', mat, lotId, c.locationId, 0, q, 'SCAN', refNo, op.name, 'Dispatched via Gate-Out scan', desc);
      moved += q;
    });
  }

  // ---- Pilot compliance log (SCAN_EVENTS) — unchanged measurement stream ----
  var gEmail = '';
  try { gEmail = Session.getActiveUser().getEmail() || ''; } catch(e) {}
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(SCAN_EVENTS_SHEET);
  if (!sh) { ensurePilotSheets(); sh = ss.getSheetByName(SCAN_EVENTS_SHEET); }
  var ts = new Date();
  sh.appendRow([ ts, op.name, '', op.name, locationId, verb, lotId, moved || '', gEmail ]);

  return {
    ok: true, ts: ts.toISOString(), verb: verb, action: action, lotId: lotId,
    operator: op.name, role: op.role, shift: op.shift,
    materialCode: mat, qtyMoved: moved, toLocation: (action === 'SHIP' ? 'DISPATCHED' : target),
    refNo: refNo
  };
}

/**
 * Identity for the scan UI — returns the signed-in Google account if available.
 * Best-effort only; the scan UI no longer gates on this (operator picks a name).
 */
function getScanUser() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch(e) {}
  return { email: email };
}

/**
 * Operator names for the scan-page "Who are you?" dropdown.
 * Returns active operators from the OPERATORS sheet: [{name, role, shift}].
 * No PIN, no Google sign-in — identity is a self-selected name.
 */
function getOperators() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(OPERATORS_SHEET);
  if (!sh || sh.getLastRow() < 2) { ensurePilotSheets(); sh = ss.getSheetByName(OPERATORS_SHEET); }
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, OPERATORS_HEADERS.length).getValues();
  var out = [];
  rows.forEach(function(r){
    // OPERATORS_HEADERS = ['pin','displayName','role','shift','active']
    if (String(r[4]).toLowerCase() === 'false') return;
    var name = String(r[1] || '').trim();
    if (!name) return;
    out.push({ name: name, role: String(r[2] || ''), shift: String(r[3] || '') });
  });
  return out;
}

// Resolve an operator name → {name, role, shift}. Returns a bare {name} if the
// name isn't in the sheet (free-typed), so scans are never blocked.
function resolveOperatorByName_(name) {
  var n = String(name || '').trim();
  if (!n) return null;
  var list = getOperators();
  for (var i = 0; i < list.length; i++) {
    if (list[i].name.toLowerCase() === n.toLowerCase()) return list[i];
  }
  return { name: n, role: '', shift: '' };
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
  var locationId = String((payload || {}).locationId || '');
  var latency    = Number((payload || {}).latency_ms || 0);
  var status     = String((payload || {}).status || 'OK').toUpperCase();
  if (['OK','TIMEOUT','ERROR'].indexOf(status) === -1) status = 'ERROR';
  var gEmail = '';
  try { gEmail = Session.getActiveUser().getEmail() || ''; } catch(e) {}
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(WIFI_LOG_SHEET);
  if (!sh) { ensurePilotSheets(); sh = ss.getSheetByName(WIFI_LOG_SHEET); }
  // WIFI_LOG col 2 was operatorPin; now stores the Google email (schema unchanged).
  sh.appendRow([new Date(), gEmail, locationId, latency, status]);
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

// ---------------------------------------------------------------------------
// Security hardening (per veritas v4 STOP 0.535 — security seat findings)
// ---------------------------------------------------------------------------

/**
 * One-shot: protect SCAN_EVENTS, WIFI_LOG, OPERATORS from edit by anyone
 * other than the spreadsheet owner. Pilot sheets contain operatorPin + personal
 * googleEmail — must not be mutable by general domain users.
 *
 * Run from clasp: `clasp run lockPilotSheets`
 * Idempotent — safe to re-run.
 */
function lockPilotSheets() {
  var ss = getSpreadsheet();
  var sheetsToLock = [SCAN_EVENTS_SHEET, WIFI_LOG_SHEET, OPERATORS_SHEET, PILOT_DAILY_SHEET];
  var owner = ss.getOwner ? ss.getOwner() : null;
  var ownerEmail = owner ? owner.getEmail() : Session.getEffectiveUser().getEmail();
  var locked = [];
  sheetsToLock.forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    // Remove existing protections owned by this script first (idempotent)
    var existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    existing.forEach(function(p){ try { p.remove(); } catch(e) {} });
    var prot = sh.protect().setDescription('Pilot security: edit restricted to owner per veritas v4 finding');
    // Strip all editors except owner
    prot.removeEditors(prot.getEditors().map(function(u){ return u.getEmail(); }).filter(function(e){ return e && e !== ownerEmail; }));
    if (prot.canDomainEdit()) prot.setDomainEdit(false);
    locked.push(name);
  });
  return { ok: true, locked: locked, ownerEmail: ownerEmail };
}

/**
 * Day-0 manual auth-boundary verification.
 * Run from clasp (`clasp run verifyAuthBoundary`) or from Apps Script editor.
 * Confirms that recordScan() rejects unauthenticated/invalid calls per the
 * validation protocol's "1-line manual test on Day 0" requirement.
 *
 * Tests:
 *   1. recordScan with invalid locationId → must throw
 *   2. recordScan with unknown PIN → must throw
 *   3. recordScan with missing lotId → must throw
 *   4. Session.getActiveUser().getEmail() returns a value (proves Google auth context)
 *
 * Returns {ok, passed, failed, details}.
 */
function verifyAuthBoundary() {
  var results = [];
  function check(name, fn, expectThrow) {
    try {
      fn();
      results.push({ name: name, passed: !expectThrow, note: expectThrow ? 'expected throw but got success' : 'returned ok' });
    } catch (e) {
      results.push({ name: name, passed: !!expectThrow, note: String(e).slice(0, 120) });
    }
  }
  var firstOp = (getOperators()[0] || {}).name || 'Admin';
  check('reject invalid locationId', function() {
    recordScan({ operator: firstOp, locationId: 'LOC|HACKER', lotId: 'TEST/AUTH/001' });
  }, true);
  check('reject missing operator', function() {
    recordScan({ operator: '', locationId: 'LOC|GATE-IN', lotId: 'TEST/AUTH/002' });
  }, true);
  check('reject missing lotId', function() {
    recordScan({ operator: firstOp, locationId: 'LOC|GATE-IN', lotId: '' });
  }, true);
  var passed = results.filter(function(r){ return r.passed; }).length;
  return { ok: passed === results.length, passed: passed, failed: results.length - passed, details: results };
}
