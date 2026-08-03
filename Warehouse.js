// ============================================================
// Warehouse.gs — Stock ledger, balance, location, FIFO, scrap, sample
// Single source of truth for material movement.
// STOCK_LEDGER schema (14 cols, see Initialize.STOCK_LEDGER_HEADERS):
//   0 Txn ID | 1 Timestamp | 2 Txn Type | 3 Material Code | 4 Batch | 5 Location ID
//   6 Qty In | 7 Qty Out  | 8 Balance After | 9 Ref Doc Type | 10 Ref Doc No.
//   11 Operator | 12 Remarks | 13 Material Desc
// ============================================================

// ---------- Storage-grade classification ----------
// Declared at the top of the file because getStockView() (line ~459) reads both
// while classifying, and these are `var` assignments — they are only populated
// once top-level code has run. Keeping them above their first use removes any
// dependency on statement order.

// Material categories that live in PM (packaging) bays. Singular forms only —
// categoryToGrade_ handles the plural by stripping a trailing S.
var _WH_PM_CATEGORIES_ = {
  'LABEL': true, 'CARTON': true, 'CAN': true, 'BOTTLE': true,
  'RIBBON': true, 'TAPE': true, 'PLUG': true, 'CAP': true,
  // Pack components found live in MASTERS_Materials that previously mapped to no
  // grade at all (and therefore got no bay segregation on putaway):
  //   SACHET / MONO CARTON / OUTER — Dorf Ketal pack build
  //   SLEVE — sheet spelling of SLEEVE; both accepted
  //   RUBBER — bands/gaskets used in packing
  'SACHET': true, 'MONO CARTON': true, 'OUTER': true,
  'SLEEVE': true, 'SLEVE': true, 'RUBBER': true, 'SHRINK': true, 'POUCH': true
};

// Location types that are deliberately NOT in the unclassified catch-all because
// they are surfaced by their own dedicated view/flow. Anything outside this set
// and outside the RM/PM/FG/QUARANTINE branches is a data problem worth showing.
var _WH_OWN_VIEW_TYPES_ = {
  'WIP': true, 'SCRAP': true, 'SAMPLE': true, 'REWORK': true
};

// ---------- Ledger primitives ----------

// ------------------------------------------------------------
// withStockLock_ — run a check-then-write critical section under the SAME
// script lock writeStockLedger_ uses, so a caller's availability read and its
// ledger append are atomic against concurrent requests (fixes the TOCTOU
// over-issue class). GAS script locks are reentrant within one execution, so
// wrapping a section that itself calls writeStockLedger_ does NOT deadlock.
// Returns fn()'s result. On lock-acquire failure returns {success:false,...}.
// ------------------------------------------------------------
function withStockLock_(fn) {
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(15000);
    if (!acquired) {
      return { success: false, error: 'System busy (stock lock timeout). Please retry.' };
    }
    return fn();
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function writeStockLedger_(txnType, materialCode, batchOrLotNo, locationId,
                            qtyIn, qtyOut, refDocType, refDocNo, operator, remarks, materialDesc) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('STOCK_LEDGER');
  if (!ws) return '';
  var txnId = 'TXN-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss')
              + '-' + Math.floor(Math.random() * 1000);
  var qIn  = Number(qtyIn)  || 0;
  var qOut = Number(qtyOut) || 0;
  var op   = operator || (function(){ try { return Session.getActiveUser().getEmail() || ''; } catch(e){ return ''; } })();

  // SCOPED LOCK: balance-read + appendRow must be atomic to prevent two concurrent
  // calls reading the same stale balance and writing duplicate "Balance After" values.
  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(10000);
    if (!lockAcquired) {
      throw new Error('LOCK_TIMEOUT: writeStockLedger_ could not acquire script lock within 10 s');
    }
    var balance = getStockBalance_(materialCode, batchOrLotNo, locationId) + qIn - qOut;
    ws.appendRow([
      txnId,
      new Date(),
      txnType || '',
      materialCode || '',
      batchOrLotNo || '',
      locationId || '',
      qIn,
      qOut,
      balance,
      refDocType || '',
      refDocNo || '',
      op,
      remarks || '',
      materialDesc || ''
    ]);
    var lr = ws.getLastRow();
    ws.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    // Keep the balance memo correct WITHOUT a rescan: we just computed this key's new
    // balance above, so store it. This is what keeps multi-lot issue / multi-line
    // booking fast (no full-sheet read per ledger row).
    if (_STOCK_BAL_CACHE) _STOCK_BAL_CACHE[_stockBalKey_(materialCode, batchOrLotNo, locationId)] = balance;
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
  // Invalidate the request-scoped read snapshot so any subsequent read in this
  // same request (e.g. the next lot's warehouse gate) sees this debit/credit.
  if (typeof prodCacheReset_ === 'function') prodCacheReset_();
  return txnId;
}

// All transactions for a specific batch — used by the ledger drawer.
// Scans the full STOCK_LEDGER (no row cap), returns oldest-first for running balance.
function getStockLedgerForBatch(materialCode, batchOrLotNo) {
  try {
    var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
    if (!ws || ws.getLastRow() < 2) return [];
    var rows = ws.getDataRange().getValues();
    var TZ = 'Asia/Kolkata';
    var mc = String(materialCode || '').trim().toLowerCase();
    var bn = String(batchOrLotNo || '').trim().toLowerCase();
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r[0]) continue;
      if (String(r[3] || '').trim().toLowerCase() !== mc) continue;
      if (bn && String(r[4] || '').trim().toLowerCase() !== bn) continue;
      out.push({
        txnId:        r[0],
        timestamp:    r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'dd-MMM HH:mm') : String(r[1] || ''),
        txnType:      r[2] || '',
        materialCode: r[3] || '',
        batchOrLotNo: r[4] || '',
        locationId:   r[5] || '',
        qtyIn:        Number(r[6]) || 0,
        qtyOut:       Number(r[7]) || 0,
        balance:      Number(r[8]) || 0,
        refDocType:   r[9] || '',
        refDocNo:     r[10] || '',
        operator:     r[11] || '',
        remarks:      r[12] || ''
      });
    }
    return out; // oldest-first (sheet order)
  } catch(e) {
    Logger.log('getStockLedgerForBatch error: ' + e.message);
    return [];
  }
}

// Recent stock movements for the Movements tab (Warehouse_F.html).
// Returns most-recent N (default 100) ledger rows newest-first.
function getStockMovements(limit) {
  try {
    var n = Number(limit) || 100;
    var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
    if (!ws || ws.getLastRow() < 2) return [];
    var rows = ws.getDataRange().getValues();
    var TZ = 'Asia/Kolkata';
    var out = [];
    // Iterate from newest row back
    for (var i = rows.length - 1; i >= 1 && out.length < n; i--) {
      var r = rows[i];
      if (!r[0]) continue;
      out.push({
        txnId:        r[0],
        timestamp:    r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'dd-MMM HH:mm') : String(r[1] || ''),
        txnType:      r[2] || '',
        materialCode: r[3] || '',
        batchOrLotNo: r[4] || '',
        locationId:   r[5] || '',
        qtyIn:        Number(r[6]) || 0,
        qtyOut:       Number(r[7]) || 0,
        balance:      Number(r[8]) || 0,
        refDocType:   r[9] || '',
        refDocNo:     r[10] || '',
        operator:     r[11] || '',
        remarks:      r[12] || ''
      });
    }
    return out;
  } catch(e) {
    Logger.log('getStockMovements error: ' + e.message);
    return [];
  }
}

// Request-scoped balance memo, keyed mat|batch|loc. Module-global = one execution, so
// it cannot leak across requests (same lifetime as _SS_CACHE).
// ponytail: writeStockLedger_ is the ONLY mutation path, so it updates this in place
// instead of forcing a rescan — that is what makes issue/booking fast. Anything that
// writes to STOCK_LEDGER outside writeStockLedger_ must call _stockBalCacheReset_().
var _STOCK_BAL_CACHE = null;
function _stockBalKey_(mc, bn, lc) {
  return String(mc || '').trim() + '|' + String(bn || '').trim() + '|' + String(lc || '').trim();
}
function _stockBalCacheReset_() { _STOCK_BAL_CACHE = null; }

function getStockBalance_(materialCode, batchOrLotNo, locationId) {
  var key = _stockBalKey_(materialCode, batchOrLotNo, locationId);
  if (_STOCK_BAL_CACHE && _STOCK_BAL_CACHE[key] !== undefined) return _STOCK_BAL_CACHE[key];

  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return 0;
  // One full scan builds EVERY key's balance, not just the one asked for — the next
  // lot/component in the same request is then free. Was: a full scan per call, i.e.
  // ~5 scans per booking line (reverse/consume/scrap/wastage/loss).
  var data = ws.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var k = _stockBalKey_(r[3], r[4], r[5]);
    map[k] = (map[k] || 0) + (Number(r[6]) || 0) - (Number(r[7]) || 0);
  }
  _STOCK_BAL_CACHE = map;
  return map[key] || 0;
}

// ---------- Reads ----------

function getStockSummary() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return [];
  var data = ws.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var mat = String(r[3] == null ? '' : r[3]).trim();
    var btc = String(r[4] == null ? '' : r[4]).trim();
    var loc = String(r[5] == null ? '' : r[5]).trim();
    var key = mat + '|' + btc + '|' + loc;
    if (!map[key]) map[key] = { materialCode: mat, batchOrLotNo: btc, locationId: loc, qtyIn: 0, qtyOut: 0 };
    map[key].qtyIn  += Number(r[6]) || 0;
    map[key].qtyOut += Number(r[7]) || 0;
  }
  return Object.keys(map).map(function(k){
    var m = map[k];
    return { materialCode: m.materialCode, batchOrLotNo: m.batchOrLotNo,
             locationId: m.locationId, balance: m.qtyIn - m.qtyOut };
  }).filter(function(r){ return r.balance > 0; });
}

// Negative-balance lots — the ones getStockSummary() silently drops (balance > 0 filter).
// Surfaced so over-issues can't hide. Returns [{materialCode, batchOrLotNo, locationId, balance}].
function getNegativeStockLots() {
  var ws = getSpreadsheet().getSheetByName('STOCK_LEDGER');
  if (!ws || ws.getLastRow() < 2) return [];
  var data = ws.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var key = String(r[3]||'').trim() + '|' + String(r[4]||'').trim() + '|' + String(r[5]||'').trim();
    if (!map[key]) map[key] = { materialCode: String(r[3]||'').trim(), batchOrLotNo: String(r[4]||'').trim(),
                                locationId: String(r[5]||'').trim(), bal: 0 };
    map[key].bal += (Number(r[6])||0) - (Number(r[7])||0);
  }
  return Object.keys(map).map(function(k){ return map[k]; })
    .filter(function(m){ return m.bal < -0.0001; })
    .map(function(m){ return { materialCode: m.materialCode, batchOrLotNo: m.batchOrLotNo,
                               locationId: m.locationId, balance: Math.round(m.bal*1000)/1000 }; })
    .sort(function(a,b){ return a.balance - b.balance; });
}

function getStockByMaterial() {
  var summary = getStockSummary();
  var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
  var matMap = {};
  mats.forEach(function(m){ matMap[m.code || m.itemCode] = m; });
  var grouped = {};
  summary.forEach(function(s){
    var k = s.materialCode;
    if (!grouped[k]) grouped[k] = {
      materialCode: k,
      name: (matMap[k] || {}).name || (matMap[k] || {}).itemDescription || k,
      unit: (matMap[k] || {}).unit || '',
      lots: []
    };
    grouped[k].lots.push(s);
  });
  return Object.keys(grouped).map(function(k){ return grouped[k]; });
}

// Low-stock alert: materials whose total on-hand (summed across all lots and
// locations) has fallen to or below their reorderLevel from MASTERS_Materials.
// Items with reorderLevel <= 0 (blank in the sheet) never alert. Most-critical
// (largest shortfall) first. Reuses getStockSummary() — no new reads of the ledger.
function getLowStockItems() {
  var summary = getStockSummary();             // [{materialCode, batchOrLotNo, locationId, balance}]
  var mats = (typeof getMaterials === 'function') ? getMaterials() : [];

  // Total on-hand per material code across every location/lot.
  var onHand = {};
  summary.forEach(function(s){
    var k = String(s.materialCode).trim();
    onHand[k] = (onHand[k] || 0) + (Number(s.balance) || 0);
  });

  var low = [];
  mats.forEach(function(m){
    var reorder = Number(m.reorderLevel) || 0;
    if (reorder <= 0) return;                   // no threshold set → no alert
    var have = onHand[m.code] || 0;             // materials with zero ledger rows count as 0
    if (have <= reorder) {
      low.push({
        code: m.code,
        desc: m.desc || m.code,
        unit: m.unit || '',
        onHand: have,
        reorderLevel: reorder,
        shortBy: reorder - have                 // >= 0
      });
    }
  });

  low.sort(function(a, b){ return b.shortBy - a.shortBy; });
  return low;
}

// Returns lots for a material across AVAILABLE locations (i.e., not quarantine),
// ordered by GRN receipt date (FIFO). Lots in QUARANTINE / SCRAP / SAMPLE are excluded.
// NOTE: This function provides a FIFO advisory only — it does NOT enforce pick order.
// The Dispatch / Gatepass UI shows the advisory but currently allows any lot to be selected.
// TODO (future task): enforce FIFO by blocking dispatch of a newer lot when an older lot
// with positive balance exists at a non-quarantine location. Implement in Gatepass.js
// issueForDispatch() by calling getFIFOLots() and comparing the operator-selected lotId
// against fifoLots[0].batchOrLotNo before permitting the write.
function getFIFOLots(materialCode) {
  // Parked material must never be issuable. HOLD / FG_HOLD / REWORK were missing here
  // even though getPutawayQueue and getStockView both treat them as parked — so stock
  // awaiting a decision could be picked into production.
  var quarantineTypes = { 'QUARANTINE': 1, 'SCRAP': 1, 'SAMPLE': 1,
                          'HOLD': 1, 'FG_HOLD': 1, 'FG-HOLD': 1, 'REWORK': 1 };
  // Request-scoped cached reads (LOCATIONS, STOCK_LEDGER, GRN dates) — see
  // ProductionReadCache.js. Falls back to direct reads if that module is absent.
  var locTypeById = (typeof prodLocTypes_ === 'function') ? prodLocTypes_() : (function(){
    var m = {}, w = getSpreadsheet().getSheetByName('LOCATIONS');
    if (w && w.getLastRow() > 1) w.getRange(2,1,w.getLastRow()-1,12).getValues().forEach(function(r){
      if (r[0]) m[String(r[0]).trim()] = String(r[8]||'').toUpperCase(); });
    return m;
  })();

  var matKey = String(materialCode == null ? '' : materialCode).trim();
  var stockSummary = (typeof prodStockSummary_ === 'function') ? prodStockSummary_() : getStockSummary();
  var summary = stockSummary.filter(function(s){
    if (String(s.materialCode).trim() !== matKey) return false;
    if (s.balance <= 0) return false;
    var locId = String(s.locationId).trim();
    var t = locTypeById[locId] || '';
    if (quarantineTypes[t]) return false;
    // Fallback: a location missing from the LOCATIONS sheet resolves to '' and would
    // otherwise pass — so a lot literally parked at 'QUARANTINE'/'SCRAP'/'FG-HOLD' could
    // be issued. Judge by the id itself when the type is unknown.
    if (!t) {
      var up = locId.toUpperCase();
      if (/QUARANTINE|SCRAP|SAMPLE|HOLD|REWORK/.test(up)) return false;
    }
    return true;
  }).map(function(s){ return { materialCode: s.materialCode, batchOrLotNo: s.batchOrLotNo,
    locationId: s.locationId, balance: s.balance }; }); // copy — we set grnDate below, don't mutate the shared snapshot

  // GRN dates by batch/lot (cached)
  var grnDates;
  if (typeof prodGrnByBatch_ === 'function') {
    grnDates = prodGrnByBatch_().grnByBatch.dateByBatch;
  } else {
    grnDates = {};
    var ws = getSpreadsheet().getSheetByName('GRN_LOG');
    if (ws && ws.getLastRow() > 1) {
      var data = ws.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var lotNo = String(data[i][8] || '').trim();
        if (lotNo && !grnDates[lotNo]) grnDates[lotNo] = data[i][1];
      }
    }
  }
  summary.forEach(function(s){ s.grnDate = grnDates[s.batchOrLotNo] || new Date(0); });
  summary.sort(function(a, b){
    var da = new Date(a.grnDate), db = new Date(b.grnDate);
    if (da - db !== 0) return da - db;
    return a.batchOrLotNo < b.batchOrLotNo ? -1 : 1;
  });
  return summary;
}

// ── Putaway Queue ─────────────────────────────────────────────
// Worklist of accepted stock still sitting in a buffer/zone that has NOT yet been
// moved into a physical pallet slot. Powers PutawayQueue_F.html. Reuses getStockSummary()
// (balance>0 rollup) + getMaterials() for name/UOM/category — no new ledger reads.
//
// A row is putaway-PENDING when: balance > 0 AND its location is NOT a pallet slot
// (does not match /^B\d{3}$/) AND is NOT a stay-put location. Stay-put = anything whose
// id contains QUARANTINE / HOLD / SCRAP / SAMPLE / REWORK (case-insensitive) — that stock
// is deliberately parked and must not be slotted. Everything else (buffer, RM-STORE-*,
// FG-STORE, un-slotted GRN zones …) is pending.
//
// Returns [{materialCode, desc, unit, category, batchOrLotNo, fromLocationId, qty}],
// sorted by fromLocationId then materialCode.
function getPutawayQueue() {
  try {
    var STAY_PUT = ['QUARANTINE', 'HOLD', 'SCRAP', 'SAMPLE', 'REWORK'];

    var matMap = {}; // code → { desc, unit, category }
    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    mats.forEach(function(m) {
      var code = String(m.code || m.itemCode || '').trim();
      if (code) matMap[code] = {
        desc:     String(m.desc || m.name || m.itemDescription || code),
        unit:     String(m.unit || ''),
        category: String(m.category || '')
      };
    });

    var pending = getStockSummary().filter(function(s) {
      if (!(Number(s.balance) > 0)) return false;
      return isPutawayPending_(s.locationId, STAY_PUT);
    });

    var rows = pending.map(function(s) {
      var m = matMap[s.materialCode] || {};
      return {
        materialCode:   s.materialCode,
        desc:           m.desc || s.materialCode,
        unit:           m.unit || '',
        category:       m.category || '',
        batchOrLotNo:   s.batchOrLotNo,
        fromLocationId: s.locationId,
        qty:            Number(s.balance) || 0
      };
    });

    rows.sort(function(a, b) {
      if (a.fromLocationId !== b.fromLocationId) return a.fromLocationId < b.fromLocationId ? -1 : 1;
      return a.materialCode < b.materialCode ? -1 : (a.materialCode > b.materialCode ? 1 : 0);
    });
    return rows;
  } catch(e) {
    Logger.log('getPutawayQueue failed: ' + e.message);
    return [];
  }
}

// Mechanism (pure): is `locationId` a putaway-pending location? A pallet slot (^B\d{3}$)
// is already slotted → not pending. A stay-put location (id contains any stayPut token)
// is deliberately parked → not pending. Everything else is pending.
function isPutawayPending_(locationId, stayPut) {
  var id = String(locationId || '').trim().toUpperCase();
  if (!id) return false;
  if (/^B\d{3}$/.test(id)) return false;                       // already in a pallet slot
  for (var i = 0; i < stayPut.length; i++) {
    if (id.indexOf(stayPut[i]) !== -1) return false;           // parked (quarantine/hold/…)
  }
  return true;
}

// ---------- LOCATIONS access ----------

function getLocations(typeFilter) {
  var ws = getSpreadsheet().getSheetByName('LOCATIONS');
  if (!ws || ws.getLastRow() < 2) return [];
  var rows = ws.getRange(2, 1, ws.getLastRow() - 1, 12).getValues()
    .filter(function(r){ return r[0] && r[11] !== 'N'; });
  if (typeFilter) {
    var t = String(typeFilter).toUpperCase();
    rows = rows.filter(function(r){ return String(r[8] || '').toUpperCase() === t; });
  }
  return rows.map(function(r){
    return {
      id: r[0], floor: r[1], section: r[2], aisle: r[3], rack: r[4],
      shelf: r[5], bin: r[6], label: r[7] || r[0], type: r[8],
      capacityQty: r[9], capacityUnit: r[10], active: r[11]
    };
  });
}

function getOpenRMLocations() {
  return getLocations('RM').concat(getLocations('QUARANTINE'));
}

function getFGLocations() {
  return getLocations('FG').concat(getLocations('FG_HOLD'));
}

// ── P4: 5-tab stock view ──────────────────────────────────────
// Returns { rm, fg, wip, quarantine, rework } each as an array of row objects.
function getStockView() {
  try {
    var ss  = getSpreadsheet();
    var TZ  = 'Asia/Kolkata';
    var now = new Date();
    function ageDays(d) {
      if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
      return Math.floor((now - d) / 86400000);
    }
    function fmtDate(d) {
      if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
      return Utilities.formatDate(d, TZ, 'dd-MMM-yyyy');
    }

    // --- build location-type map ---
    var locTypeMap = {}; // locationId → type string (RM, FG, FG_HOLD, QUARANTINE, REWORK, SCRAP, SAMPLE, WIP)
    var locWs = ss.getSheetByName('LOCATIONS');
    if (locWs && locWs.getLastRow() > 1) {
      locWs.getRange(2, 1, locWs.getLastRow() - 1, 12).getValues().forEach(function(r) {
        if (r[0]) locTypeMap[String(r[0]).trim()] = String(r[8] || '').toUpperCase();
      });
    }
    // Infer type from locationId prefix for locations not in the LOCATIONS sheet
    function inferLocType(locId) {
      var id = String(locId || '').trim().toUpperCase();
      if (!id) return '';
      if (id === 'QUARANTINE' || id.startsWith('QUAR')) return 'QUARANTINE';
      if (id === 'SCRAP' || id.startsWith('SCRAP')) return 'SCRAP';
      if (id === 'SAMPLE' || id.startsWith('SAMPLE')) return 'SAMPLE';
      if (id === 'REWORK' || id.startsWith('REWORK')) return 'REWORK';
      if (id === 'WIP' || id.startsWith('WIP')) return 'WIP';
      if (id === 'HOLD' || id.startsWith('FG-HOLD') || id.startsWith('FG_HOLD')) return 'FG_HOLD';
      if (id.startsWith('FG')) return 'FG';
      if (id.startsWith('RM')) return 'RM';
      // Physical pallet slots use a floor-letter + number ID (^[ABC]\d{3}$). Their Type is set
      // on the LOCATIONS row (primary path), so this only runs for an untyped/missing row — a
      // fallback so heatmap colouring never resolves to '' (RISK-1). Bay is NOT parsed from the
      // ID; without the row the true type is unknown, so return a neutral non-empty 'SLOT'.
      if (/^[ABC]\d{3}$/.test(id)) return 'SLOT';
      return '';
    }

    // --- material master map ---
    var matMap = {}; // code → { name, unit }
    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    mats.forEach(function(m) {
      var code = String(m.code || m.itemCode || '').trim();
      // category is required: getStockView routes a lot to its RM/PM/FG tab by
      // material grade, not by where it is stored.
      if (code) matMap[code] = { name: m.name || m.itemDescription || m.desc || code,
                                 unit: m.unit || '', category: m.category || '' };
    });

    // --- current balances by (matCode, batch, locationId) ---
    var summary = getStockSummary(); // [{materialCode, batchOrLotNo, locationId, balance}]

    // --- GRN_LOG: grnDate + supplier + IQC status by batch ---
    var grnMap = {}; // batchNo → { date, supplier, iqcStatus, grnNo }
    var grnWs = ss.getSheetByName('GRN_LOG');
    if (grnWs && grnWs.getLastRow() > 1) {
      grnWs.getDataRange().getValues().slice(1).forEach(function(r) {
        var batch = String(r[8] || '').trim();
        if (batch && !grnMap[batch]) {
          grnMap[batch] = {
            date:      r[1] instanceof Date ? r[1] : new Date(r[1]),
            supplier:  String(r[3] || ''),
            iqcStatus: String(r[15] || 'PENDING'),
            grnNo:     String(r[0] || '')
          };
        }
      });
    }

    // --- OQC_LOG: oqcDate + release decision + customer by batch ---
    var oqcMap = {}; // batchNo → { date, decision, oqcNo }
    var oqcWs = ss.getSheetByName('OQC_LOG');
    if (oqcWs && oqcWs.getLastRow() > 1) {
      oqcWs.getDataRange().getValues().slice(1).forEach(function(r) {
        var batch = String(r[3] || '').trim(); // col 4 = Batch/PO
        if (batch && !oqcMap[batch]) {
          oqcMap[batch] = {
            date:     r[1] instanceof Date ? r[1] : new Date(r[1]),
            decision: String(r[14] || ''),
            oqcNo:    String(r[0] || ''),
            customer: String(r[2] || '')
          };
        }
      });
    }

    // --- FG_DISPATCH_LOTS: customer by batch ---
    var dispMap = {}; // batchNo → customer
    var dispWs = ss.getSheetByName('FG_DISPATCH_LOTS');
    if (dispWs && dispWs.getLastRow() > 1) {
      dispWs.getDataRange().getValues().slice(1).forEach(function(r) {
        var batch = String(r[3] || '').trim();
        if (batch && !dispMap[batch]) dispMap[batch] = String(r[2] || '');
      });
    }

    // --- PROD_JOBS WIP: IN_PROGRESS jobs ---
    var wipRows = [];
    var prodWs = ss.getSheetByName('PROD_JOBS');
    if (prodWs && prodWs.getLastRow() > 1) {
      prodWs.getDataRange().getValues().slice(1).forEach(function(r) {
        var st = String(r[8] || '').toUpperCase();
        if (st === 'IN_PROGRESS' || st === 'BOOKED') {
          var wipDate = r[1] instanceof Date ? r[1] : new Date(r[1]);
          wipRows.push({
            jobId:    String(r[0] || ''),
            date:     fmtDate(wipDate),
            ageDays:  ageDays(wipDate),
            fgCode:   String(r[3] || ''),
            fgDesc:   String(r[4] || ''),
            fgQty:    Number(r[5]) || 0,
            fgUom:    String(r[6] || ''),
            ipqcId:   String(r[9] || ''),
            status:   st
          });
        }
      });
    }

    // --- REWORK_LOG: open rework ---
    var reworkRows = [];
    var rwWs = ss.getSheetByName('REWORK_LOG');
    if (rwWs && rwWs.getLastRow() > 1) {
      rwWs.getDataRange().getValues().slice(1).forEach(function(r) {
        var st = String(r[10] || '').toUpperCase();
        if (st === 'OPEN' || st === 'IN_PROGRESS') {
          reworkRows.push({
            reworkId:    String(r[0] || ''),
            date:        r[1] instanceof Date ? r[1] : new Date(r[1]),
            source:      String(r[2] || ''),
            sourceRef:   String(r[3] || ''),
            materialCode:String(r[4] || ''),
            materialDesc:String(r[5] || ''),
            batchNo:     String(r[6] || ''),
            qty:         Number(r[7]) || 0,
            unit:        String(r[8] || ''),
            status:      st
          });
        }
      });
    }

    // --- Classify stock lots by location type ---
    // PM (packaging material) is a first-class grade everywhere else in this file —
    // categoryToGrade_ maps LABEL/CARTON/CAP/etc to it and the bay map reserves
    // C/D for it — but it had no branch here, so ~86 lots in B026..B049 appeared
    // in NO view at all. `unclassified` is a catch-all so a location whose Type is
    // blank or unrecognised surfaces instead of silently dropping its stock.
    var rmRows = [], pmRows = [], fgRows = [], quarRows = [], unclRows = [];
    summary.forEach(function(s) {
      var locType = locTypeMap[s.locationId] || inferLocType(s.locationId);

      // WHICH TAB a lot belongs in follows WHAT IT IS (material category), not where
      // it happens to be stored. Storing a pallet of labels in RM-STORE-A is an
      // ordinary warehouse reality; it must still be found under PM. Location type
      // still governs the special states below (quarantine/WIP/scrap/sample/rework)
      // because those describe the stock's STATUS, which storage genuinely defines.
      var matCat   = (matMap[s.materialCode] || {}).category || '';
      var matGrade = categoryToGrade_(matCat);          // 'RM' | 'PM' | 'FG' | ''
      var isStateLoc = (locType === 'QUARANTINE' || _WH_OWN_VIEW_TYPES_[locType]);
      if (!isStateLoc && matGrade) locType = matGrade;
      var grn     = grnMap[s.batchOrLotNo]  || {};
      var oqc     = oqcMap[s.batchOrLotNo]  || {};
      var mat     = matMap[s.materialCode]   || { name: s.materialCode, unit: '' };
      var ageDate = grn.date || oqc.date || null;
      var age     = ageDays(ageDate);

      if (locType === 'RM' || locType === 'PM') {
        // PM shares RM's row shape (supplier / GRN date / IQC status all apply to
        // bought-in packaging), so one builder serves both; only the bucket differs.
        (locType === 'PM' ? pmRows : rmRows).push({
          materialCode: s.materialCode,
          materialDesc: mat.name,
          batchNo:      s.batchOrLotNo,
          supplier:     grn.supplier || '',
          location:     s.locationId,
          qty:          s.balance,
          unit:         mat.unit || '',
          grnDate:      fmtDate(grn.date),
          ageDays:      age,
          iqcStatus:    grn.iqcStatus || 'PENDING'
        });
      } else if (locType === 'FG' || locType === 'FG_HOLD') {
        fgRows.push({
          materialCode: s.materialCode,
          materialDesc: mat.name,
          batchNo:      s.batchOrLotNo,
          customer:     dispMap[s.batchOrLotNo] || oqc.customer || '',
          location:     s.locationId,
          qty:          s.balance,
          unit:         mat.unit || '',
          oqcDate:      fmtDate(oqc.date),
          ageDays:      age,
          oqcRef:       oqc.oqcNo || ''
        });
      } else if (locType === 'QUARANTINE') {
        quarRows.push({
          materialCode: s.materialCode,
          materialDesc: mat.name,
          batchNo:      s.batchOrLotNo,
          location:     s.locationId,
          qty:          s.balance,
          unit:         mat.unit || '',
          since:        fmtDate(grn.date || oqc.date),
          ageDays:      age,
          sourceRef:    grn.grnNo || oqc.oqcNo || ''
        });
      } else if (!_WH_OWN_VIEW_TYPES_[locType]) {
        // Anything that is not handled above AND does not have its own dedicated
        // view (WIP / SCRAP / SAMPLE / REWORK are surfaced elsewhere) lands here
        // rather than disappearing. A row showing up in this list means a
        // LOCATIONS Type is blank, misspelled, or genuinely new.
        unclRows.push({
          materialCode: s.materialCode,
          materialDesc: mat.name,
          batchNo:      s.batchOrLotNo,
          location:     s.locationId,
          locType:      locType || '(blank)',
          qty:          s.balance,
          unit:         mat.unit || '',
          since:        fmtDate(grn.date || oqc.date),
          ageDays:      age,
          sourceRef:    grn.grnNo || oqc.oqcNo || ''
        });
      }
    });

    return {
      rm:           rmRows,
      pm:           pmRows,
      fg:           fgRows,
      wip:          wipRows,
      quarantine:   quarRows,
      unclassified: unclRows,
      rework:     reworkRows.map(function(r) {
        var age2 = ageDays(r.date);
        return {
          reworkId:    r.reworkId,
          materialCode:r.materialCode,
          materialDesc:r.materialDesc,
          batchNo:     r.batchNo,
          qty:         r.qty,
          unit:        r.unit,
          source:      r.source,
          sourceRef:   r.sourceRef,
          since:       fmtDate(r.date),
          ageDays:     age2,
          status:      r.status
        };
      })
    };
  } catch(e) {
    Logger.log('getStockView failed: ' + e.message);
    return { rm: [], pm: [], fg: [], wip: [], quarantine: [], unclassified: [], rework: [] };
  }
}

// (_WH_OWN_VIEW_TYPES_ declared at top of file, above first use.)

function saveLocation(d) {
  var ws = getSpreadsheet().getSheetByName('LOCATIONS');
  if (!ws) return { success: false, error: 'LOCATIONS sheet missing.' };
  var id = String(d.id || '').trim();
  if (!id) return { success: false, error: 'Location ID required.' };
  // Update if row exists, else append
  if (ws.getLastRow() > 1) {
    var ids = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id) {
        ws.getRange(i + 2, 1, 1, 12).setValues([[
          id, d.floor || '', d.section || '', d.aisle || '', d.rack || '',
          d.shelf || '', d.bin || '',
          d.label || id,
          d.type || 'RM', d.capacityQty || '', d.capacityUnit || '', d.active || 'Y'
        ]]);
        return { success: true, updated: true };
      }
    }
  }
  ws.appendRow([
    id, d.floor || '', d.section || '', d.aisle || '', d.rack || '',
    d.shelf || '', d.bin || '',
    d.label || id,
    d.type || 'RM', d.capacityQty || '', d.capacityUnit || '', d.active || 'Y'
  ]);
  return { success: true };
}

// Hard-delete if no STOCK_LEDGER rows reference this location; otherwise soft-delete (Active='N').
// Keeps historical traceability intact for ISO 9001 audits.
function deleteLocation(id) {
  try {
    var locId = String(id || '').trim();
    if (!locId) return { success: false, error: 'Location ID required.' };
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('LOCATIONS');
    if (!ws || ws.getLastRow() < 2) return { success: false, error: 'LOCATIONS sheet empty.' };

    var ledger = ss.getSheetByName('STOCK_LEDGER');
    var referenced = false;
    if (ledger && ledger.getLastRow() > 1) {
      var locCol = ledger.getRange(2, 6, ledger.getLastRow() - 1, 1).getValues();
      for (var k = 0; k < locCol.length; k++) {
        if (String(locCol[k][0]).trim() === locId) { referenced = true; break; }
      }
    }

    var ids = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === locId) {
        if (referenced) {
          ws.getRange(i + 2, 12).setValue('N');
          return { success: true, soft: true, message: 'Location had stock history — marked inactive.' };
        }
        ws.deleteRow(i + 2);
        return { success: true, soft: false };
      }
    }
    return { success: false, error: 'Location ' + locId + ' not found.' };
  } catch(e) {
    Logger.log('deleteLocation failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ---------- Movements ----------

function recordLocationTransfer(data) {
  // data: { materialCode, batchOrLotNo, fromLocationId, toLocationId, qty, reason, transferredBy }
  try {
    var qty = Number(data.qty) || 0;
    if (qty <= 0) return { success: false, error: 'Transfer qty must be > 0.' };
    // Atomic: balance check + both ledger appends under one lock so a concurrent
    // transfer can't pass the same availability check and over-issue the source.
    return withStockLock_(function(){
      var bal = getStockBalance_(data.materialCode, data.batchOrLotNo, data.fromLocationId);
      if (bal < qty) return { success: false, error: 'Insufficient stock at source (' + bal + ').' };

      var id = 'TRF-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
      // data.reason was accepted in the signature but DISCARDED — remarks were
      // hardcoded, so callers passing a reason (corrections, putaway, scrap moves)
      // had it silently dropped and the ledger could not say WHY stock moved.
      // Appended, not substituted, so the existing "OUT → X" / "IN ← Y" text every
      // current reader relies on is preserved.
      var why = String(data.reason || '').trim();
      var sfx = why ? ' · ' + why : '';
      writeStockLedger_('LOCATION_TRANSFER', data.materialCode, data.batchOrLotNo,
        data.fromLocationId, 0, qty, 'TRANSFER', id, data.transferredBy, 'OUT → ' + data.toLocationId + sfx);
      writeStockLedger_('LOCATION_TRANSFER', data.materialCode, data.batchOrLotNo,
        data.toLocationId, qty, 0, 'TRANSFER', id, data.transferredBy, 'IN ← ' + data.fromLocationId + sfx);
      return { success: true, transferId: id };
    });
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// Thin public entrypoint for the IQC auto-putaway flow. Adapts the client's
// payload to recordLocationTransfer and stamps the reason 'PUTAWAY' so the
// ledger shows why accepted stock left its GRN zone.
// payload: { materialCode, batchOrLotNo, qty, fromLocationId, toLocationId, transferredBy }
function runPutaway(payload) {
  var p = payload || {};
  return recordLocationTransfer({
    materialCode:   p.materialCode,
    batchOrLotNo:   p.batchOrLotNo,
    fromLocationId: p.fromLocationId,
    toLocationId:   p.toLocationId,
    qty:            p.qty,
    reason:         'PUTAWAY',
    transferredBy:  p.transferredBy
  });
}

// Multi-pallet putaway: transfer one source lot into SEVERAL slots per the allocation plan
// (from suggestSlot().plan). Each entry is {slotId, qty}. Runs them in order; reports per-slot
// result so a partial failure (e.g. one slot filled between suggest and confirm) is visible
// rather than silently dropping stock.
function runPutawayPlan(payload) {
  var p = payload || {};
  var plan = (p.plan || []).filter(function(a){ return a && a.slotId && Number(a.qty) > 0; });
  if (!plan.length) return { success: false, error: 'Empty putaway plan.' };
  var moved = 0, results = [], anyFail = false;
  plan.forEach(function(a) {
    var res = recordLocationTransfer({
      materialCode:   p.materialCode,
      batchOrLotNo:   p.batchOrLotNo,
      fromLocationId: p.fromLocationId,
      toLocationId:   a.slotId,
      qty:            Number(a.qty),
      reason:         'PUTAWAY',
      transferredBy:  p.transferredBy
    });
    var ok = res && res.success !== false;
    if (ok) moved += Number(a.qty); else anyFail = true;
    results.push({ slotId: a.slotId, qty: Number(a.qty), ok: ok, error: ok ? '' : (res && res.error) || 'failed' });
  });
  return { success: !anyFail, movedQty: moved, slots: plan.length, results: results };
}

function recordScrap(data) {
  // data: { refDocType, refDocNo, materialCode, batchOrLotNo, qtyScrap, unit, scrapReason, scrapDestination, recordedBy, locationId }
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('SCRAP_LOG');
    if (!ws) return { success: false, error: 'SCRAP_LOG sheet missing.' };
    var id = getNextDocNumber('scr');
    ws.appendRow([
      id, new Date(),
      data.refDocType || '', data.refDocNo || '',
      data.materialCode || '', data.batchOrLotNo || '',
      Number(data.qtyScrap) || 0, data.unit || '',
      data.scrapReason || '', data.scrapDestination || '',
      data.recordedBy || ''
    ]);
    ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');
    writeStockLedger_('SCRAP', data.materialCode, data.batchOrLotNo,
      data.locationId || 'SCRAP-AREA',
      0, Number(data.qtyScrap) || 0,
      data.refDocType || '', data.refDocNo || '',
      data.recordedBy || '', data.scrapReason || '');
    return { success: true, scrapId: id };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function recordSample(data) {
  // data: { refDocType, refDocNo, materialCode, batchOrLotNo, qtySample, unit, samplePurpose, takenBy, locationStored, locationId }
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('SAMPLE_LOG');
    if (!ws) return { success: false, error: 'SAMPLE_LOG sheet missing.' };
    var id = getNextDocNumber('smp');
    ws.appendRow([
      id, new Date(),
      data.refDocType || '', data.refDocNo || '',
      data.materialCode || '', data.batchOrLotNo || '',
      Number(data.qtySample) || 0, data.unit || '',
      data.samplePurpose || '', data.takenBy || '',
      data.locationStored || 'SAMPLE-CABINET'
    ]);
    ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy HH:mm');

    // Taking a sample is a MOVE, not a disappearance: OUT of the location the material
    // actually sits in, IN to the sample cabinet. Previously this wrote a single OUT at
    // the CABINET — a location never credited — so the cabinet went negative while the
    // full received qty stayed issuable at source, double-counting the sampled units.
    var qty = Number(data.qtySample) || 0;
    var cabinet = String(data.locationStored || 'SAMPLE-CABINET').trim() || 'SAMPLE-CABINET';
    // sourceLocationId is the real holding location; fall back to the legacy locationId
    // only when it is not the cabinet itself (older callers passed the cabinet here).
    var src = String(data.sourceLocationId || '').trim();
    if (!src && String(data.locationId || '').trim() !== cabinet) src = String(data.locationId || '').trim();
    if (qty > 0 && src) {
      writeStockLedger_('SAMPLE_OUT', data.materialCode, data.batchOrLotNo, src,
        0, qty, data.refDocType || '', data.refDocNo || '',
        data.takenBy || '', 'Sample pulled → ' + cabinet + (data.samplePurpose ? ' (' + data.samplePurpose + ')' : ''));
      writeStockLedger_('SAMPLE_IN', data.materialCode, data.batchOrLotNo, cabinet,
        qty, 0, data.refDocType || '', data.refDocNo || '',
        data.takenBy || '', 'Sample held ← ' + src);
    } else if (qty > 0) {
      // No source known (legacy caller): record the sample without touching stock rather
      // than driving the cabinet negative. Surfaced so it can be reconciled.
      Logger.log('recordSample: no source location for ' + data.materialCode + '/' + data.batchOrLotNo + ' — ledger skipped');
      return { success: true, sampleId: id, warning: 'Sample logged but stock not moved — source location unknown.' };
    }
    return { success: true, sampleId: id };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// ---------- RM-issuance gate ----------
// Issues RM to production, but only if the linked GRN's IQC status is PASS/ACCEPTED
// AND the lot is at a non-quarantine location.
// data: { materialCode, batchOrLotNo, locationId, qtyToIssue, productionOrderNo, issuedBy }
function issueRMForProduction(data) {
  try {
    var qty = Number(data.qtyToIssue) || 0;
    if (qty <= 0) return { success: false, error: 'Issue qty must be > 0.' };
    var mat   = String(data.materialCode || '').trim();
    var batch = String(data.batchOrLotNo || '').trim();
    var loc   = String(data.locationId || '').trim();
    if (!mat || !batch || !loc) return { success: false, error: 'materialCode, batch and locationId required.' };

    // Gate: lookup IQC status for this GRN batch
    var grnWs = getSpreadsheet().getSheetByName('GRN_LOG');
    var iqcWs = getSpreadsheet().getSheetByName('IQC_LOG');
    var grnNoForBatch = '';
    if (grnWs && grnWs.getLastRow() > 1) {
      var g = grnWs.getDataRange().getValues();
      for (var i = 1; i < g.length; i++) {
        if (String(g[i][6]).trim() === mat && String(g[i][8]).trim() === batch) {
          grnNoForBatch = String(g[i][0]).trim();
          break;
        }
      }
    }
    if (!grnNoForBatch) {
      return { success: false, error: 'No GRN found for ' + mat + ' / ' + batch + '.' };
    }
    // Resolve IQC disposition for THIS batch under that GRN — match on GRN ref
    // (col 3 / idx 2) AND batch (col 6 / idx 5). A single GRN can hold multiple
    // batches with different dispositions; keying by GRN alone would let an
    // ACCEPTED sibling batch flip a REJECTED batch to issuable. Latest row wins.
    var iqcDisp = '';
    if (iqcWs && iqcWs.getLastRow() > 1) {
      var iq = iqcWs.getDataRange().getValues();
      for (var j = iq.length - 1; j >= 1; j--) {
        if (String(iq[j][2]).trim() === grnNoForBatch &&
            String(iq[j][5]).trim() === batch) {
          iqcDisp = String(iq[j][22] || '').toUpperCase();
          break;
        }
      }
    }
    if (iqcDisp !== 'ACCEPTED' && iqcDisp !== 'PASS' && iqcDisp !== 'ACCEPTED WITH DEVIATION') {
      return {
        success: false,
        error: 'RM blocked — GRN ' + grnNoForBatch + ' has IQC disposition "' + (iqcDisp || 'PENDING') + '". Only ACCEPTED / ACCEPTED WITH DEVIATION can be issued.'
      };
    }

    // Gate: location must not be quarantine
    var locTypeById = {};
    var locWs = getSpreadsheet().getSheetByName('LOCATIONS');
    if (locWs && locWs.getLastRow() > 1) {
      locWs.getRange(2, 1, locWs.getLastRow() - 1, 12).getValues().forEach(function(r){
        if (r[0]) locTypeById[String(r[0]).trim()] = String(r[8] || '').toUpperCase();
      });
    }
    var locType = locTypeById[loc] || '';
    if (locType === 'QUARANTINE' || locType === 'SCRAP' || locType === 'SAMPLE') {
      return { success: false, error: 'Cannot issue from location type ' + locType + '.' };
    }

    // Atomic: balance gate + ledger write under one lock so two concurrent
    // issues can't both pass the same availability check and over-issue the lot.
    return withStockLock_(function(){
      var bal = getStockBalance_(mat, batch, loc);
      if (bal < qty) {
        return { success: false, error: 'Insufficient stock at ' + loc + ' (have ' + bal + ', need ' + qty + ').' };
      }
      var txnType = (data.txnType === 'PROD_BOOK') ? 'PROD_BOOK' : 'RM_ISSUE';
      var refNo = data.productionOrderNo || ('PROD-' + Date.now());
      writeStockLedger_(txnType, mat, batch, loc,
        0, qty,
        'PRODUCTION', refNo,
        data.issuedBy || '',
        txnType === 'PROD_BOOK' ? 'Booked for FG production — pending consumption' : 'RM issued — IQC pass verified');
      return { success: true, balance: bal - qty, grnNo: grnNoForBatch, iqcDisposition: iqcDisp };
    });
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

// ============================================================
// Phase 2 — Optimal-slot suggestion (min(volume, weight) fit engine)
// ------------------------------------------------------------
// Standard pallet envelope for a single B### slot. Phase-1 slots are modelled
// as one ISO-6780 pallet position each. These are the ONLY assumptions used when
// a material has no explicit perPallet (TI×HI) count, so they are named constants
// (not magic numbers) and documented for future floor re-verification.
//   PALLET_SLOT_VOLUME_MM3 : usable stack envelope = 1200 × 1000 × 1500 mm
//     (ISO pallet footprint 1200×1000 mm, safe stack height 1500 mm) = 1.8e9 mm³.
//   PALLET_SLOT_MAX_WEIGHT_KG : conservative dynamic pallet load = 1000 kg.
// eachL/eachW/eachH from MASTERS_Materials are in mm, eachWeight in kg — so the
// volume divide stays in mm³ and needs no unit conversion.
var PALLET_SLOT_VOLUME_MM3    = 1200 * 1000 * 1500; // 1.8e9 mm³ usable per slot
var PALLET_SLOT_MAX_WEIGHT_KG = 1000;               // kg dynamic load per slot

// Mechanism (pure): how many eaches of `material` fit on ONE pallet slot, plus the
// binding constraint. Returns { ok, unitsPerPallet, bound, reason }.
//  - Prefer the explicit TI×HI count (material.perPallet) when present — it is the
//    real-world stacking pattern and beats a geometric estimate.
//  - Otherwise fall back to min(volume-bound, weight-bound) over the pallet envelope.
//  - Missing/zero geometry → graceful { ok:false } (never divide-by-zero, never throw).
function computePalletFit_(material) {
  var m = material || {};
  var perPallet = Number(m.perPallet) || 0;
  if (perPallet > 0) {
    // TI×HI is the authoritative pack; treat its declared fitClass as the basis hint.
    var declared = String(m.fitClass || '').toUpperCase();
    var bound = (declared === 'WEIGHT' || declared === 'VOLUME') ? declared : 'PALLET_PATTERN';
    return { ok: true, unitsPerPallet: perPallet, bound: bound, reason: 'TI×HI pack' };
  }

  var L = Number(m.eachL) || 0, W = Number(m.eachW) || 0, H = Number(m.eachH) || 0;
  var wt = Number(m.eachWeight) || 0;
  var eachVolume = L * W * H; // computed, never stored
  if (eachVolume <= 0 || wt <= 0) {
    return { ok: false, unitsPerPallet: 0, bound: '', reason: 'geometry unknown, cannot suggest' };
  }

  var byVolume = Math.floor(PALLET_SLOT_VOLUME_MM3 / eachVolume);   // light/bulky → volume-bound
  var byWeight = Math.floor(PALLET_SLOT_MAX_WEIGHT_KG / wt);        // heavy/dense → weight-bound
  var capacity = Math.min(byVolume, byWeight);
  if (capacity <= 0) {
    return { ok: false, unitsPerPallet: 0, bound: '', reason: 'a single each exceeds one pallet slot' };
  }
  var bound = (byWeight <= byVolume) ? 'WEIGHT' : 'VOLUME';
  return { ok: true, unitsPerPallet: capacity, bound: bound, reason: 'min(volume,weight)' };
}

// Suggest the best pallet slot(s) for putting away `qty` eaches of `materialCode`.
// Minimum-tap putaway: prefer consolidating onto a slot already holding the SAME
// material, else the best empty slot (same bay/type as the material's home first).
//
// Returns:
//   { success:true, slotId, palletsNeeded, unitsPerPallet, bound, consolidating, ranked:[...] }
//   { success:false, error }  — geometry unknown, or "No available position".
//
// `deps` is an optional injection point for testing (in-memory fixtures) so the
// engine can be exercised without live sheet data. Production passes nothing and
// the live reads are used. google.script.run calls this as suggestSlot(code, qty).
function suggestSlot(materialCode, qty, deps) {
  try {
    var code = String(materialCode || '').trim();
    var wantQty = Number(qty) || 0;
    if (!code) return { success: false, error: 'materialCode required.' };
    if (wantQty <= 0) return { success: false, error: 'qty must be > 0.' };

    var d = deps || {};
    var getMats = d.getMaterials || (typeof getMaterials === 'function' ? getMaterials : function(){ return []; });
    var getLocs = d.getLocations || getLocations;
    var getSummary = d.getStockSummary || getStockSummary;

    // --- material + fit basis ---
    var material = _findMaterial_(getMats(), code);
    if (!material) return { success: false, error: 'Material ' + code + ' not found.' };
    var fit = computePalletFit_(material);
    if (!fit.ok) return { success: false, error: fit.reason };

    var palletsNeeded = Math.ceil(wantQty / fit.unitsPerPallet);

    // --- occupancy per slot (from the live ledger rollup) ---
    var occupantByLoc = {}; // slotId → materialCode currently stored (first positive-balance lot)
    getSummary().forEach(function(s) {
      if ((Number(s.balance) || 0) <= 0) return;
      var loc = String(s.locationId || '').trim();
      if (!/^[ABC]\d{3}$/.test(loc)) return;      // only physical pallet slots
      if (!occupantByLoc[loc]) occupantByLoc[loc] = String(s.materialCode || '').trim();
    });

    // --- rank candidate slots ---
    // Grade drives which bay a material belongs in. Materials carry `category`, not a grade —
    // map category → grade (RM/PM/FG) so slots can be segregated. Fall back to any explicit
    // type field if present. Empty grade = un-graded → no segregation (old any-slot behaviour).
    var homeType = String(material.type || material.defaultType || categoryToGrade_(material.category) || '').toUpperCase();
    var ranked = _rankSlots_(getLocs(), occupantByLoc, code, homeType);
    if (!ranked.length) return { success: false, error: 'No available position' };

    var best = ranked[0];

    // --- multi-pallet allocation: split wantQty across palletsNeeded slots ---
    // Walk `ranked` (consolidating slot first, then grade-matched empties) filling one pallet's
    // worth per slot until the qty is placed. Fewer eligible slots than needed → allocate what
    // fits and flag the shortfall so the caller can warn (stock stays in source for the remainder).
    var perPallet = fit.unitsPerPallet;
    var remaining = wantQty, plan = [];
    for (var i = 0; i < ranked.length && remaining > 0; i++) {
      var take = Math.min(perPallet, remaining);
      plan.push({ slotId: ranked[i].id, qty: take, consolidating: ranked[i].consolidating });
      remaining -= take;
    }
    var shortfallQty = remaining > 0 ? remaining : 0;   // qty that had no slot (bays full)

    return {
      success: true,
      slotId: best.id,                  // first slot (back-compat: single-slot callers)
      plan: plan,                       // [{slotId, qty, consolidating}] — spans palletsNeeded slots
      palletsNeeded: palletsNeeded,
      slotsAllocated: plan.length,
      shortfallQty: shortfallQty,       // > 0 → not enough slots; remainder stays in source
      unitsPerPallet: fit.unitsPerPallet,
      bound: fit.bound,                 // 'WEIGHT' | 'VOLUME' | 'PALLET_PATTERN'
      consolidating: best.consolidating,
      basis: fit.reason,
      ranked: ranked.map(function(r){ return { slotId: r.id, consolidating: r.consolidating }; })
    };
  } catch(e) {
    Logger.log('suggestSlot failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Map a material's category to its storage grade (RM/PM/FG) — the grade a slot's `type` must
// match for putaway. Single source of truth for category→grade routing (mirrors the bay map:
// RM→Bay A, PM→Bays C/D, FG→Bay E). Unknown categories return '' (no segregation).
function categoryToGrade_(category) {
  var c = String(category || '').toUpperCase().trim();
  // Singular/plural both occur in MASTERS_Materials (LABEL + LABELS, CARTON +
  // CARTONS). Strip a trailing S so a plural never falls through to '' — a
  // gradeless material gets no bay segregation on putaway.
  if (c.length > 3 && c.charAt(c.length - 1) === 'S') {
    var singular = c.slice(0, -1);
    if (_WH_PM_CATEGORIES_[singular]) return 'PM';
  }
  if (c === 'BULK') return 'RM';
  if (c === 'FG')   return 'FG';
  if (_WH_PM_CATEGORIES_[c]) return 'PM';
  return '';
}

// (_WH_PM_CATEGORIES_ declared at top of file, above first use.)

// Find a material record by code across getMaterials()' several possible key names.
function _findMaterial_(materials, code) {
  var c = String(code).trim();
  for (var i = 0; i < materials.length; i++) {
    var m = materials[i];
    if (String(m.code || m.itemCode || '').trim() === c) return m;
  }
  return null;
}

// Mechanism (pure): rank pallet slots for putaway. A slot already holding the SAME
// material (consolidation) always outranks an empty slot; among empties, one whose
// type matches the material's home type outranks an off-type empty. Slots holding a
// DIFFERENT material are rejected (Phase-1 = one material per pallet slot).
function _rankSlots_(locations, occupantByLoc, code, homeType) {
  var candidates = [];
  locations.forEach(function(loc) {
    var id = String(loc.id || '').trim();
    if (!/^[ABC]\d{3}$/.test(id)) return;            // physical slots only, zones excluded
    if (String(loc.active) === 'N') return;

    var occupant = occupantByLoc[id] || '';
    if (occupant && occupant !== code) return;       // occupied by a different material → skip

    var consolidating = occupant === code;
    var sameType = homeType && String(loc.type || '').toUpperCase() === homeType;
    // GRADE SEGREGATION: when the material's grade (homeType) is known, an EMPTY slot of a
    // different grade is INELIGIBLE — PM stock must not land in an RM/FG bay, etc. Consolidating
    // into a slot already holding this exact material is always allowed (same goods).
    if (!consolidating && homeType && !sameType) return;
    // Lower rank sorts first: consolidating (0) < same-grade empty (1). Cross-grade empties are
    // filtered above when homeType is set; rank-2 remains only for un-graded materials (old behaviour).
    var rank = consolidating ? 0 : (sameType ? 1 : 2);
    candidates.push({ id: id, consolidating: consolidating, rank: rank });
  });

  candidates.sort(function(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); // stable, lexical by ID within a tier
  });
  return candidates;
}

// ------------------------------------------------------------
// Runnable GAS-editor assert for Step-6 suggestSlot + fit engine.
// Uses in-memory fixtures via the `deps` injection point — never reads live sheets.
// Proves the two checks the task requires:
//  1. suggestSlot prefers a consolidating slot (same material) over an emptier
//     separate one;
//  2. a heavy 27 kg pack resolves WEIGHT-bound while light empty cans resolve
//     VOLUME-bound (min(volume,weight) picks the right constraint).
// Logger-based pass/fail, also returned.
// ------------------------------------------------------------
function _testSuggestSlot() {
  var results = [];
  function assert(cond, msg) {
    results.push({ pass: !!cond, msg: msg });
    Logger.log((cond ? 'PASS ' : 'FAIL ') + msg);
  }

  // --- fixtures: two PM materials, six pallet slots in bay B/C (type PM) ---
  var materials = [
    // Heavy 27 kg FG box, no TI×HI declared → must fall to weight-bound.
    { code: 'FG-BOX', desc: 'Heavy box', type: 'PM',
      eachL: 400, eachW: 300, eachH: 300, eachWeight: 27, perPallet: '', fitClass: '' },
    // Light empty can, no TI×HI declared → must fall to volume-bound.
    { code: 'PM-CAN', desc: 'Empty can', type: 'PM',
      eachL: 100, eachW: 100, eachH: 200, eachWeight: 0.05, perPallet: '', fitClass: '' }
  ];
  var locations = [
    { id: 'B001', type: 'PM', active: 'Y' }, { id: 'B002', type: 'PM', active: 'Y' },
    { id: 'B003', type: 'PM', active: 'Y' }, { id: 'C001', type: 'PM', active: 'Y' },
    { id: 'C002', type: 'PM', active: 'Y' }, { id: 'C003', type: 'PM', active: 'Y' }
  ];
  // B002 already holds FG-BOX (a partially-used consolidation target). B001 is empty.
  var summary = [
    { materialCode: 'FG-BOX', batchOrLotNo: 'L1', locationId: 'B002', balance: 5 }
  ];
  var deps = {
    getMaterials:   function(){ return materials; },
    getLocations:   function(){ return locations; },
    getStockSummary:function(){ return summary; }
  };

  // --- Check 1: consolidation beats an emptier separate slot ---
  var r1 = suggestSlot('FG-BOX', 10, deps);
  assert(r1.success, 'suggestSlot(FG-BOX) succeeds');
  assert(r1.slotId === 'B002', 'prefers consolidating slot B002 over empty B001 (got ' + r1.slotId + ')');
  assert(r1.consolidating === true, 'best slot flagged consolidating');

  // --- Check 2a: heavy 27 kg pack resolves WEIGHT-bound ---
  assert(r1.bound === 'WEIGHT', 'heavy 27kg pack is WEIGHT-bound (got ' + r1.bound + ')');
  // 1000 kg / 27 kg ≈ 37 units per pallet; volume would allow far more.
  assert(r1.unitsPerPallet === Math.floor(1000 / 27),
    'weight ceiling = floor(1000/27) = ' + Math.floor(1000 / 27) + ' (got ' + r1.unitsPerPallet + ')');
  assert(r1.palletsNeeded === Math.ceil(10 / Math.floor(1000 / 27)),
    'palletsNeeded = ceil(qty / unitsPerPallet)');

  // --- Check 2b: light empty can resolves VOLUME-bound ---
  var r2 = suggestSlot('PM-CAN', 100, deps);
  assert(r2.success, 'suggestSlot(PM-CAN) succeeds');
  assert(r2.bound === 'VOLUME', 'light can is VOLUME-bound (got ' + r2.bound + ')');
  // No PM-CAN in stock → no consolidation; best is the first empty PM slot B001.
  assert(r2.consolidating === false, 'no same-material slot → not consolidating');
  assert(r2.slotId === 'B001', 'empties ranked lexically → B001 first (got ' + r2.slotId + ')');

  // --- Check 3: missing geometry is graceful, not a crash ---
  var deps2 = {
    getMaterials:   function(){ return [{ code: 'NOGEO', type: 'PM' }]; },
    getLocations:   function(){ return locations; },
    getStockSummary:function(){ return []; }
  };
  var r3 = suggestSlot('NOGEO', 5, deps2);
  assert(r3.success === false && /geometry unknown/.test(r3.error),
    'missing geometry → graceful "geometry unknown" (got ' + JSON.stringify(r3) + ')');

  // --- Check 4: full warehouse → "No available position" ---
  var deps3 = {
    getMaterials:   function(){ return materials; },
    getLocations:   function(){ return [{ id: 'B001', type: 'PM', active: 'Y' }]; },
    getStockSummary:function(){ return [{ materialCode: 'OTHER', batchOrLotNo: 'X', locationId: 'B001', balance: 3 }]; }
  };
  var r4 = suggestSlot('FG-BOX', 5, deps3);
  assert(r4.success === false && r4.error === 'No available position',
    'no free slot → "No available position" (got ' + JSON.stringify(r4) + ')');

  var failed = results.filter(function(r){ return !r.pass; });
  var summaryMsg = '_testSuggestSlot: ' + (results.length - failed.length) + '/' + results.length + ' asserts passed';
  Logger.log(summaryMsg);
  return { ok: failed.length === 0, summary: summaryMsg, results: results };
}
