// ============================================================
// KpiConfig.gs — PropertiesService-backed UI config + KPI registry
// Phase 1 of Landing v2 redesign (spec: 2026-05-19-landing-v2-kpi-config-design.md)
// ============================================================

var PM_PERSONAS_ = ['Operator', 'Manager'];
var PM_TILE_MODULES_ = ['PO','GRN','IQC','IPQC','Production','OQC','Gatepass','Dispatch','NCR','CustomerReturn'];

// Single source of truth for KPIs. To add KPI #13: append one entry + write _kpi_<key>_ helper.
function _kpiFnMap_() {
  return {
    IQC_PASS:_kpi_iqcPass_, FPY:_kpi_fpy_, OTD:_kpi_otd_, NCR_MTTR:_kpi_ncrMttr_,
    SUPPLIER_OTIF:_kpi_supplierOtif_, TOP_DEFECT:_kpi_topDefect_, FIFO_COMPL:_kpi_fifoCompl_,
    AGED_STOCK:_kpi_agedStock_, DWELL:_kpi_dwell_, IPQC_REJECT:_kpi_ipqcReject_,
    CR_RATE:_kpi_crRate_, COST_OF_QUAL:_kpi_coq_
  };
}

var KPI_REGISTRY = [
  { key:'IQC_PASS',      label:'IQC Pass %',       target:97, format:'pct',  unit:'%',    sparkline:true,  group:'hero' },
  { key:'FPY',           label:'First-Pass Yield', target:92, format:'pct',  unit:'%',    sparkline:true,  group:'hero' },
  { key:'OTD',           label:'Dispatch TAT',     target:2,  format:'num',  unit:'d',    sparkline:true,  group:'hero' },
  { key:'NCR_MTTR',      label:'NCR Resolve Days', target:3,  format:'num',  unit:'d',    sparkline:true,  group:'hero' },
  { key:'SUPPLIER_OTIF', label:'Supplier OTIF',    target:90, format:'pct',  unit:'%',    sparkline:false, group:'drill' },
  { key:'TOP_DEFECT',    label:'Top Defect',       target:null,format:'text',unit:'',     sparkline:false, group:'drill' },
  { key:'FIFO_COMPL',    label:'FIFO Compliance',  target:95, format:'pct',  unit:'%',    sparkline:false, group:'drill' },
  { key:'AGED_STOCK',    label:'Aged Stock >30d',  target:0,  format:'num',  unit:' lots',sparkline:false, group:'drill' },
  { key:'DWELL',         label:'Module Dwell',     target:null,format:'text',unit:'',     sparkline:false, group:'drill' },
  { key:'IPQC_REJECT',   label:'IPQC Reject %',    target:3,  format:'pct',  unit:'%',    sparkline:false, group:'drill' },
  { key:'CR_RATE',       label:'Customer Return %',target:1,  format:'pct',  unit:'%',    sparkline:false, group:'drill' },
  { key:'COST_OF_QUAL',  label:'NCR Qty Affected', target:null,format:'num',  unit:' u',  sparkline:false, group:'drill' }
];

// ── Persona persona helpers ─────────────────────────────────────
function _pmNormPersona_(p) {
  return (PM_PERSONAS_.indexOf(p) >= 0) ? p : 'Manager';
}

// Public: read merged UI settings for persona. Defaults from registry + tile module list.
function getUISettings(persona) {
  persona = _pmNormPersona_(persona);
  var props = PropertiesService.getScriptProperties();
  var prefix = 'pm.ui.' + persona + '.';
  var all = props.getProperties();

  var out = {
    persona: persona,
    tiles: {},
    kpis: { show: {}, targets: {} },
    ownerMode: String(all['pm.ui.ownerMode'] || 'false') === 'true'
  };

  // Tile visibility — Operator defaults to all on except big-picture (Dispatch off).
  PM_TILE_MODULES_.forEach(function(m){
    var k = prefix + 'tile.' + m;
    if (all.hasOwnProperty(k)) {
      out.tiles[m] = (all[k] === 'true');
    } else {
      out.tiles[m] = (persona === 'Operator' && m === 'Dispatch') ? false : true;
    }
  });

  // KPI visibility + targets — Operator defaults: only FPY+OTD shown; Manager: all hero on + all drill on
  KPI_REGISTRY.forEach(function(r){
    var keyShow = prefix + 'kpi.show.' + r.key;
    if (all.hasOwnProperty(keyShow)) {
      out.kpis.show[r.key] = (all[keyShow] === 'true');
    } else {
      if (persona === 'Operator') {
        out.kpis.show[r.key] = (r.key === 'FPY' || r.key === 'OTD');
      } else {
        out.kpis.show[r.key] = true;
      }
    }
    var keyTgt = prefix + 'kpi.target.' + r.key;
    if (all.hasOwnProperty(keyTgt)) {
      var n = Number(all[keyTgt]);
      out.kpis.targets[r.key] = isNaN(n) ? r.target : n;
    } else {
      out.kpis.targets[r.key] = r.target;
    }
  });

  return out;
}

// Public: save one setting. Verifies write by re-reading; returns {ok, applied}.
// patch = { kind:'tile'|'kpiShow'|'kpiTarget'|'ownerMode'|'ownerPin', key, value }
function saveUISettings(persona, patch) {
  try {
    persona = _pmNormPersona_(persona);
    var props = PropertiesService.getScriptProperties();
    if (!patch || !patch.kind) return { ok:false, error:'missing kind' };

    var propKey;
    var propVal;
    if (patch.kind === 'tile') {
      if (PM_TILE_MODULES_.indexOf(patch.key) < 0) return { ok:false, error:'unknown tile' };
      propKey = 'pm.ui.' + persona + '.tile.' + patch.key;
      propVal = String(!!patch.value);
    } else if (patch.kind === 'kpiShow') {
      if (!KPI_REGISTRY.some(function(r){ return r.key === patch.key; })) return { ok:false, error:'unknown kpi' };
      propKey = 'pm.ui.' + persona + '.kpi.show.' + patch.key;
      propVal = String(!!patch.value);
    } else if (patch.kind === 'kpiTarget') {
      if (!KPI_REGISTRY.some(function(r){ return r.key === patch.key; })) return { ok:false, error:'unknown kpi' };
      var n = Number(patch.value);
      if (isNaN(n)) return { ok:false, error:'value not numeric' };
      propKey = 'pm.ui.' + persona + '.kpi.target.' + patch.key;
      propVal = String(n);
    } else if (patch.kind === 'ownerMode') {
      propKey = 'pm.ui.ownerMode';
      propVal = String(!!patch.value);
    } else if (patch.kind === 'ownerPin') {
      if (!/^\d{4}$/.test(String(patch.value))) return { ok:false, error:'pin must be 4 digits' };
      propKey = 'pm.ui.ownerPin';
      propVal = String(patch.value);
    } else {
      return { ok:false, error:'unknown kind: ' + patch.kind };
    }

    props.setProperty(propKey, propVal);
    // Verification readback
    var readback = props.getProperty(propKey);
    if (readback !== propVal) {
      return { ok:false, error:'readback mismatch', expected:propVal, got:readback };
    }
    // Invalidate downstream caches
    try {
      CacheService.getScriptCache().removeAll([
        'pmqms_uisettings_' + persona,
        'pmqms_kpis_' + persona
      ]);
    } catch (e) {}
    return { ok:true, applied: propVal, key: propKey };
  } catch (e) {
    return { ok:false, error: String(e && e.message || e) };
  }
}

function verifyOwnerPin(pin) {
  try {
    var stored = PropertiesService.getScriptProperties().getProperty('pm.ui.ownerPin') || '0000';
    return String(pin) === stored;
  } catch (e) { return false; }
}

// ── KPI runner ──────────────────────────────────────────────────
// Returns array of KPI result objects, filtered by persona's kpi.show toggles.
// periodOpts (optional): { preset:'THIS_MONTH'|'LAST_30'|'LAST_90'|'THIS_FY'|'CUSTOM',
//                          fromISO?, toISO? }
// When periodOpts is omitted or null, defaults to last-30d (original Landing v2 behaviour).
function getQmsKpis(persona, periodOpts) {
  persona = _pmNormPersona_(persona);
  // Resolve period window
  var now = new Date();
  var from, periodLabel;
  if (periodOpts && periodOpts.preset) {
    var tz = 'Asia/Kolkata';
    if (periodOpts.preset === 'CUSTOM' && periodOpts.fromISO && periodOpts.toISO) {
      from = new Date(periodOpts.fromISO);
      now  = new Date(periodOpts.toISO);
      now.setHours(23, 59, 59, 999);
      periodLabel = periodOpts.fromISO + ' to ' + periodOpts.toISO;
    } else if (periodOpts.preset === 'LAST_90') {
      from = new Date(now.getTime() - 90*24*60*60*1000);
      periodLabel = 'Last 90 Days';
    } else if (periodOpts.preset === 'THIS_FY') {
      var mm = parseInt(Utilities.formatDate(now, tz, 'MM'), 10);
      var yyyy = parseInt(Utilities.formatDate(now, tz, 'yyyy'), 10);
      var fyStartYear = (mm >= 4) ? yyyy : yyyy - 1;
      from = new Date(fyStartYear + '-04-01');
      now  = new Date((fyStartYear + 1) + '-03-31');
      now.setHours(23, 59, 59, 999);
      periodLabel = 'FY ' + fyStartYear + '-' + String(fyStartYear + 1).slice(2);
    } else if (periodOpts.preset === 'THIS_MONTH') {
      var mStr = Utilities.formatDate(now, tz, 'MM');
      var yStr = Utilities.formatDate(now, tz, 'yyyy');
      from = new Date(yStr + '-' + mStr + '-01');
      periodLabel = Utilities.formatDate(now, tz, 'MMMM yyyy');
    } else {
      // LAST_30 default
      from = new Date(now.getTime() - 30*24*60*60*1000);
      periodLabel = 'Last 30 Days';
    }
  } else {
    from = new Date(now.getTime() - 30*24*60*60*1000);
    periodLabel = 'Last 30 Days';
  }

  // Cache key includes period so different periods cache independently.
  // Skip cache for CUSTOM ranges (too many possible keys).
  var preset = (periodOpts && periodOpts.preset) || 'LAST_30';
  var cacheKey = preset === 'CUSTOM' ? null : ('pmqms_kpis_' + persona + '_' + preset);
  if (cacheKey) {
    try {
      var hit = CacheService.getScriptCache().get(cacheKey);
      if (hit) {
        var parsed = JSON.parse(hit);
        if (parsed.fp === _pmSheetFingerprint_()) {
          var cachedResult = parsed.data;
          cachedResult._periodLabel = periodLabel;
          cachedResult._computedAtISO = parsed.ts || '';
          return cachedResult;
        }
      }
    } catch (e) {}
  }

  var settings = getUISettings(persona);
  var ss = getSpreadsheet();

  var fnMap = _kpiFnMap_();
  var results = [];
  KPI_REGISTRY.forEach(function(r){
    if (!settings.kpis.show[r.key]) return;
    var entry = {
      key: r.key, label: r.label, group: r.group,
      format: r.format, unit: r.unit,
      target: settings.kpis.targets[r.key],
      value: null, status: 'ok', message: '', sparkline: null
    };
    try {
      var fn = fnMap[r.key];
      if (typeof fn !== 'function') throw new Error('KPI fn missing: ' + r.key);
      var res = fn(ss, from, now);
      entry.value = (res && typeof res === 'object') ? res.value : res;
      if (r.sparkline) {
        entry.sparkline = _kpiSparkline_(r.key, ss, now, 7);
      }
    } catch (e) {
      entry.status = 'error';
      entry.message = String(e && e.message || e).slice(0, 80);
    }
    results.push(entry);
  });

  // Attach period metadata so callers can display it
  results._periodLabel    = periodLabel;
  results._computedAtISO  = new Date().toISOString();

  if (cacheKey) {
    try {
      CacheService.getScriptCache().put(cacheKey, JSON.stringify({
        fp: _pmSheetFingerprint_(), data: results, ts: results._computedAtISO
      }), 60);
    } catch (e) {}
  }

  return results;
}

// Build 7-day sparkline by calling KPI fn for each day window
function _kpiSparkline_(key, ss, now, days) {
  var fn = _kpiFnMap_()[key];
  if (typeof fn !== 'function') return null;
  var out = [];
  for (var i = days - 1; i >= 0; i--) {
    var dayEnd = new Date(now.getTime() - i*24*60*60*1000);
    var dayStart = new Date(dayEnd.getTime() - 24*60*60*1000);
    try {
      var r = fn(ss, dayStart, dayEnd);
      var v = (r && typeof r === 'object') ? r.value : r;
      out.push((v === null || isNaN(v)) ? null : Number(v));
    } catch (e) { out.push(null); }
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────
function _pmGetRows_(ss, sheetName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return { hdr:[], rows:[], idx:{} };
  var data = sh.getDataRange().getValues();
  var hdr = data[0].map(function(h){ return String(h || '').trim(); });
  var idx = {};
  hdr.forEach(function(h,i){ idx[h.toLowerCase()] = i; });
  return { hdr:hdr, rows:data.slice(1), idx:idx };
}
function _pmCol_(idx, names) {
  for (var i = 0; i < names.length; i++) {
    var k = String(names[i]).toLowerCase();
    if (idx.hasOwnProperty(k)) return idx[k];
  }
  return -1;
}
function _pmInRange_(v, from, to) {
  if (!v) return false;
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return false;
  return d >= from && d <= to;
}

// ── Phase 1 KPI implementations (4 hero) ───────────────────────
function _kpi_iqcPass_(ss, from, to) {
  var t = _pmGetRows_(ss, 'IQC_LOG');
  if (!t.rows.length) return { value:null };
  var ciDisp = _pmCol_(t.idx, ['disposition','status']);
  var ciDate = _pmCol_(t.idx, ['date','timestamp','iqc date','inspection date']);
  if (ciDisp < 0) return { value:null };
  var passSet = {'PASS':1,'ACCEPT':1,'ACCEPTED':1};
  var failSet = {'FAIL':1,'REJECT':1,'REJECTED':1,'HOLD':1};
  var pass = 0, total = 0;
  t.rows.forEach(function(r){
    if (ciDate >= 0 && !_pmInRange_(r[ciDate], from, to)) return;
    var d = String(r[ciDisp] || '').trim().toUpperCase();
    if (!d) return;
    if (passSet[d] || failSet[d]) {
      total++;
      if (passSet[d]) pass++;
    }
  });
  return { value: total ? Math.round((pass/total)*1000)/10 : null };
}

function _kpi_fpy_(ss, from, to) {
  var t = _pmGetRows_(ss, 'IPQC_Sessions');
  if (!t.rows.length) return { value:null };
  var ciStatus = _pmCol_(t.idx, ['status','session status']);
  var ciResult = _pmCol_(t.idx, ['result','final result','disposition']);
  var ciDate = _pmCol_(t.idx, ['date','timestamp','start time','created']);
  if (ciStatus < 0 && ciResult < 0) return { value:null };
  var pass = 0, total = 0;
  t.rows.forEach(function(r){
    if (ciDate >= 0 && !_pmInRange_(r[ciDate], from, to)) return;
    var s = String((ciResult >= 0 ? r[ciResult] : r[ciStatus]) || '').trim().toUpperCase();
    if (!s) return;
    total++;
    if (s === 'PASS' || s === 'CLOSED' || s === 'COMPLETE' || s === 'COMPLETED' || s === 'ACCEPT') pass++;
  });
  return { value: total ? Math.round((pass/total)*1000)/10 : null };
}

// OTD — defined here as Dispatch TAT: median days from OQC Date to First Dispatched At.
// Uses FG_DISPATCH_LOTS only. No CUSTOMER_ORDERS sheet exists in the QMS, so a true
// promise-date OTD (% of orders shipped by committed date) cannot be computed.
// To add real OTD: create a CUSTOMER_ORDERS sheet with columns [order_no, promised_date,
// shipped_date] and replace this function body. The KPI key and label will stay 'OTD'.
// NOTE: KPI.js kpiOTD_() computed a different OTD (GRN receipt vs PO promised date).
// That definition is also superseded here — see KPI.js deprecation header for history.
function _kpi_otd_(ss, from, to) {
  var fg = _pmGetRows_(ss, 'FG_DISPATCH_LOTS');
  if (!fg.rows.length) return { value:null };
  var ciOqcDate  = _pmCol_(fg.idx, ['oqc date']);
  var ciDispAt   = _pmCol_(fg.idx, ['first dispatched at','last dispatched at','dispatch date']);
  if (ciOqcDate < 0 || ciDispAt < 0) return { value:null };
  var diffs = [];
  fg.rows.forEach(function(r){
    var dd = r[ciDispAt]; if (!dd) return;
    if (!_pmInRange_(dd, from, to)) return;
    var oqc = r[ciOqcDate]; if (!oqc) return;
    var oqcD = new Date(oqc), dispD = new Date(dd);
    if (isNaN(oqcD.getTime()) || isNaN(dispD.getTime())) return;
    var days = (dispD - oqcD) / (24*60*60*1000);
    if (days < 0) return; // data anomaly
    diffs.push(days);
  });
  if (!diffs.length) return { value:null };
  diffs.sort(function(a,b){ return a-b; });
  var med = diffs[Math.floor(diffs.length/2)];
  return { value: Math.round(med*10)/10 };
}

function _kpi_ncrMttr_(ss, from, to) {
  var t = _pmGetRows_(ss, 'NCR_LOG');
  if (!t.rows.length) return { value:null };
  var ciStatus = _pmCol_(t.idx, ['status']);
  var ciOpen = _pmCol_(t.idx, ['opened','open date','date','created','timestamp']);
  var ciClose = _pmCol_(t.idx, ['closed','close date','closed on','resolved']);
  if (ciOpen < 0 || ciClose < 0) return { value:null };
  var sumDays = 0, n = 0;
  t.rows.forEach(function(r){
    var s = String((ciStatus >= 0 ? r[ciStatus] : '') || '').toUpperCase();
    if (s && s.indexOf('CLOSED') < 0 && s.indexOf('RESOLVED') < 0) return;
    var o = r[ciOpen], c = r[ciClose];
    if (!o || !c) return;
    var od = new Date(o), cd = new Date(c);
    if (isNaN(od.getTime()) || isNaN(cd.getTime())) return;
    if (cd < from || cd > to) return;
    sumDays += (cd - od) / (24*60*60*1000);
    n++;
  });
  return { value: n ? Math.round((sumDays/n)*10)/10 : null };
}

// ── Phase 2 drill KPIs ──────────────────────────────────────────

// Supplier OTIF — % of GRN rows received on/before PO due date, last 30d.
// Join GRN_LOG.PO Reference → PO_HEADER.po_no.due_date.
function _kpi_supplierOtif_(ss, from, to) {
  var po = _pmGetRows_(ss, 'PO_HEADER');
  var grn = _pmGetRows_(ss, 'GRN_LOG');
  if (!po.rows.length || !grn.rows.length) return { value:null };
  var ciPoNo = _pmCol_(po.idx, ['po_no','po no.','po no']);
  var ciDue = _pmCol_(po.idx, ['due_date','due date','promise date']);
  if (ciPoNo < 0 || ciDue < 0) return { value:null };
  var dueByPo = {};
  po.rows.forEach(function(r){
    var k = String(r[ciPoNo] || '').trim();
    if (k) dueByPo[k] = r[ciDue];
  });
  var ciGrnDate = _pmCol_(grn.idx, ['date']);
  var ciPoRef = _pmCol_(grn.idx, ['po reference','po ref','po_ref','po no.']);
  if (ciGrnDate < 0 || ciPoRef < 0) return { value:null };
  var on = 0, total = 0;
  grn.rows.forEach(function(r){
    var d = r[ciGrnDate]; if (!d) return;
    if (!_pmInRange_(d, from, to)) return;
    var poRef = String(r[ciPoRef] || '').trim();
    if (!poRef) return;
    var due = dueByPo[poRef]; if (!due) return;
    total++;
    if (new Date(d) <= new Date(due)) on++;
  });
  return { value: total ? Math.round((on/total)*1000)/10 : null };
}

// Top Defect — most-frequent first word of NCR Defect Description, last 30d.
function _kpi_topDefect_(ss, from, to) {
  var t = _pmGetRows_(ss, 'NCR_LOG');
  if (!t.rows.length) return { value:null };
  var ciDate = _pmCol_(t.idx, ['date','timestamp']);
  var ciDef = _pmCol_(t.idx, ['defect description','defect','defect type']);
  if (ciDef < 0) return { value:null };
  var counts = {};
  t.rows.forEach(function(r){
    if (ciDate >= 0 && !_pmInRange_(r[ciDate], from, to)) return;
    var raw = String(r[ciDef] || '').trim();
    if (!raw) return;
    var word = raw.split(/[\s,;:.\-\/]+/)[0].toUpperCase();
    if (!word || word.length < 3) return;
    counts[word] = (counts[word] || 0) + 1;
  });
  var best = null, bestN = 0;
  Object.keys(counts).forEach(function(k){
    if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  });
  return { value: best ? (best + ' (' + bestN + ')') : null };
}

// FIFO Compliance — without PROD_BOOK we can't directly verify pick order,
// fallback: % of GRN lots fully consumed within first-in window via STOCK_LEDGER.
// Heuristic: for each material, check if oldest available lot has Qty Out > 0
// before any newer lot. Returns null if STOCK_LEDGER absent.
function _kpi_fifoCompl_(ss, from, to) {
  var sl = _pmGetRows_(ss, 'STOCK_LEDGER');
  if (!sl.rows.length) return { value:null };
  var ciTs  = _pmCol_(sl.idx, ['timestamp','date']);
  var ciMat = _pmCol_(sl.idx, ['material code']);
  var ciLot = _pmCol_(sl.idx, ['batch / lot no.','batch','lot','batch no.']);
  var ciQtyIn  = _pmCol_(sl.idx, ['qty in']);
  var ciQtyOut = _pmCol_(sl.idx, ['qty out']);
  // Need at least ts + mat + lot; use Qty In/Out columns to detect direction
  // (more reliable than Txn Type string matching which varies by data entry)
  if (ciTs < 0 || ciMat < 0 || ciLot < 0) return { value:null };
  if (ciQtyIn < 0 && ciQtyOut < 0) return { value:null };
  var inByMat = {}; // mat → [{lot, ts}] sorted chronologically
  var totalOut = 0, fifoOut = 0;
  // First pass: collect receipt (IN) rows
  sl.rows.forEach(function(r){
    var qIn = (ciQtyIn >= 0) ? Number(r[ciQtyIn]) : 0;
    if (!(qIn > 0)) return;
    var mat = String(r[ciMat] || '').trim();
    if (!mat) return;
    (inByMat[mat] = inByMat[mat] || []).push({ lot:String(r[ciLot]||'').trim(), ts:new Date(r[ciTs]) });
  });
  Object.keys(inByMat).forEach(function(m){
    inByMat[m].sort(function(a,b){ return a.ts - b.ts; });
  });
  // Second pass: each issue (OUT) row in window → check its lot is oldest available
  sl.rows.forEach(function(r){
    var qOut = (ciQtyOut >= 0) ? Number(r[ciQtyOut]) : 0;
    if (!(qOut > 0)) return;
    var ts = new Date(r[ciTs]); if (isNaN(ts.getTime())) return;
    if (!_pmInRange_(ts, from, to)) return;
    var mat = String(r[ciMat] || '').trim();
    var lot = String(r[ciLot] || '').trim();
    if (!mat || !lot) return;
    var ins = inByMat[mat] || [];
    var oldest = null;
    for (var i = 0; i < ins.length; i++) {
      if (ins[i].ts <= ts) { oldest = ins[i]; break; }
    }
    if (!oldest) return;
    totalOut++;
    if (oldest.lot === lot) fifoOut++;
  });
  return { value: totalOut ? Math.round((fifoOut/totalOut)*1000)/10 : null };
}

// Aged Stock >30d — count of GRN lots with Qty Available > 0 AND GRN Date < (today - 30).
// Uses STOCK_LEDGER Balance After by lot (last entry per lot) joined with GRN_LOG date.
function _kpi_agedStock_(ss, from, to) {
  var grn = _pmGetRows_(ss, 'GRN_LOG');
  var sl = _pmGetRows_(ss, 'STOCK_LEDGER');
  if (!grn.rows.length) return { value:null };
  var ciDate = _pmCol_(grn.idx, ['date']);
  var ciLot = _pmCol_(grn.idx, ['batch / lot no.','batch']);
  var ciMat = _pmCol_(grn.idx, ['material code']);
  if (ciDate < 0 || ciLot < 0) return { value:null };
  // Build map of latest balance per (mat, lot) from STOCK_LEDGER
  var balByKey = {};
  if (sl.rows.length) {
    var slTs = _pmCol_(sl.idx, ['timestamp','date']);
    var slMat = _pmCol_(sl.idx, ['material code']);
    var slLot = _pmCol_(sl.idx, ['batch / lot no.','batch']);
    var slBal = _pmCol_(sl.idx, ['balance after','balance']);
    if (slTs >= 0 && slLot >= 0 && slBal >= 0) {
      var sorted = sl.rows.slice().sort(function(a,b){ return new Date(a[slTs]) - new Date(b[slTs]); });
      sorted.forEach(function(r){
        var k = String(r[slMat] || '') + '|' + String(r[slLot] || '');
        balByKey[k] = Number(r[slBal]);
      });
    }
  }
  var cutoff = new Date(to.getTime() - 30*24*60*60*1000);
  var aged = 0;
  grn.rows.forEach(function(r){
    var d = r[ciDate]; if (!d) return;
    var dt = new Date(d); if (isNaN(dt.getTime())) return;
    if (dt >= cutoff) return;
    var k = String(r[ciMat] || '') + '|' + String(r[ciLot] || '');
    var bal = balByKey[k];
    if (bal == null || isNaN(bal) || bal <= 0) return;
    aged++;
  });
  return { value: aged };
}

// Module Dwell — median hours between Created At and Closed At per module.
// Returns "GRN 4h · IQC 12h" style summary.
function _kpi_dwell_(ss, from, to) {
  var modules = [
    { name:'GRN', sheet:'GRN_LOG', ts:'Timestamp', close:null },
    { name:'IQC', sheet:'IQC_LOG', ts:'Date', close:'Timestamp' },
    { name:'NCR', sheet:'NCR_LOG', ts:'Timestamp', close:'Closed At' }
  ];
  var parts = [];
  modules.forEach(function(m){
    var t = _pmGetRows_(ss, m.sheet);
    if (!t.rows.length) return;
    var ciOpen = _pmCol_(t.idx, [m.ts.toLowerCase()]);
    var ciClose = m.close ? _pmCol_(t.idx, [m.close.toLowerCase()]) : -1;
    if (ciOpen < 0) return;
    var diffs = [];
    t.rows.forEach(function(r){
      var o = r[ciOpen];
      var c = (ciClose >= 0) ? r[ciClose] : null;
      if (!o || !c) return;
      var od = new Date(o), cd = new Date(c);
      if (isNaN(od.getTime()) || isNaN(cd.getTime())) return;
      if (cd < from || cd > to) return;
      diffs.push((cd - od) / (60*60*1000));
    });
    if (!diffs.length) return;
    diffs.sort(function(a,b){ return a-b; });
    var med = diffs[Math.floor(diffs.length/2)];
    parts.push(m.name + ' ' + (med < 1 ? '<1' : med.toFixed(0)) + 'h');
  });
  return { value: parts.length ? parts.join(' · ') : null };
}

// IPQC Reject % — IPQC_Sessions where status is REJECT/FAIL over total terminated.
function _kpi_ipqcReject_(ss, from, to) {
  var t = _pmGetRows_(ss, 'IPQC_Sessions');
  if (!t.rows.length) return { value:null };
  var ciStatus = _pmCol_(t.idx, ['status']);
  var ciDate = _pmCol_(t.idx, ['date','start_time','timestamp']);
  if (ciStatus < 0) return { value:null };
  var reject = 0, total = 0;
  t.rows.forEach(function(r){
    if (ciDate >= 0 && !_pmInRange_(r[ciDate], from, to)) return;
    var s = String(r[ciStatus] || '').trim().toUpperCase();
    if (!s) return;
    if (s === 'OPEN' || s === 'IN_PROGRESS') return;
    total++;
    if (s === 'REJECT' || s === 'REJECTED' || s === 'FAIL' || s === 'FAILED') reject++;
  });
  return { value: total ? Math.round((reject/total)*1000)/10 : null };
}

// Customer Return % — CR rows / FG dispatch lots, last 30d.
function _kpi_crRate_(ss, from, to) {
  var cr = _pmGetRows_(ss, 'CUSTOMER_RETURN_LOG');
  var fg = _pmGetRows_(ss, 'FG_DISPATCH_LOTS');
  if (!fg.rows.length) return { value:null };
  var ciCrDate = _pmCol_(cr.idx, ['return date','timestamp','date']);
  var ciFgDate = _pmCol_(fg.idx, ['timestamp','oqc date','first dispatched at']);
  if (ciFgDate < 0) return { value:null };
  var crN = 0, fgN = 0;
  fg.rows.forEach(function(r){
    if (_pmInRange_(r[ciFgDate], from, to)) fgN++;
  });
  cr.rows.forEach(function(r){
    if (ciCrDate >= 0 && !_pmInRange_(r[ciCrDate], from, to)) return;
    crN++;
  });
  return { value: fgN ? Math.round((crN/fgN)*1000)/10 : null };
}

// Cost of Quality — sum of NCR Qty Affected (proxy; no cost column), last 30d.
function _kpi_coq_(ss, from, to) {
  var t = _pmGetRows_(ss, 'NCR_LOG');
  if (!t.rows.length) return { value:null };
  var ciDate = _pmCol_(t.idx, ['date','timestamp']);
  var ciQty = _pmCol_(t.idx, ['qty affected','qty']);
  if (ciQty < 0) return { value:null };
  var sum = 0;
  t.rows.forEach(function(r){
    if (ciDate >= 0 && !_pmInRange_(r[ciDate], from, to)) return;
    var q = Number(r[ciQty]); if (isNaN(q)) return;
    sum += q;
  });
  return { value: sum > 0 ? Math.round(sum*100)/100 : null };
}

// ── Bundle for Landing v2 — one round-trip ─────────────────────
function getLandingBundleV2(persona) {
  persona = _pmNormPersona_(persona);
  return {
    landing: (function(){ try { return getQmsLandingState(); } catch(e){ return null; } })(),
    recordsCounts: (function(){ try { return getRecordsCounts(); } catch(e){ return null; } })(),
    settings: getUISettings(persona),
    kpis: getQmsKpis(persona),
    registry: KPI_REGISTRY.map(function(r){ return {key:r.key, label:r.label, group:r.group, format:r.format, unit:r.unit, sparkline:r.sparkline, defaultTarget:r.target}; }),
    tileModules: PM_TILE_MODULES_,
    personas: PM_PERSONAS_
  };
}

// ── Diagnostics ─────────────────────────────────────────────────
function diag_qmsKpis(persona) {
  return JSON.stringify(getQmsKpis(persona || 'Manager'), null, 2);
}
function diag_uiSettings(persona) {
  return JSON.stringify(getUISettings(persona || 'Manager'), null, 2);
}
function diag_stockLedgerTypes(){
  var ss = getSpreadsheet();
  var t = _pmGetRows_(ss, 'STOCK_LEDGER');
  var ciType = _pmCol_(t.idx, ['txn type','type']);
  var ciQtyIn  = _pmCol_(t.idx, ['qty in']);
  var ciQtyOut = _pmCol_(t.idx, ['qty out']);
  var typeCounts = {}, inRows = 0, outRows = 0;
  t.rows.forEach(function(r){
    var typ = String(ciType >= 0 ? r[ciType] : '').trim();
    typeCounts[typ] = (typeCounts[typ] || 0) + 1;
    if (ciQtyIn >= 0 && Number(r[ciQtyIn]) > 0) inRows++;
    if (ciQtyOut >= 0 && Number(r[ciQtyOut]) > 0) outRows++;
  });
  return JSON.stringify({ typeCounts:typeCounts, inRows:inRows, outRows:outRows }, null, 2);
}
function diag_extraHeaders(){
  var ss = getSpreadsheet();
  var names = ['FG_DISPATCH_LOTS','PO_HEADER','IPQC_EVENTS','PROD_BOOK','STOCK_LEDGER'];
  var out = {};
  names.forEach(function(n){
    var sh = ss.getSheetByName(n);
    if (!sh) { out[n]='(missing)'; return; }
    if (sh.getLastRow()<1) { out[n]='(empty)'; return; }
    out[n] = { rows: sh.getLastRow()-1, headers: sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0] };
  });
  return JSON.stringify(out, null, 2);
}

// List every sheet with row count + headers — used to locate OQC/customer-order sheets.
function diag_allSheets(){
  var ss = getSpreadsheet();
  var out = {};
  ss.getSheets().forEach(function(sh){
    var lr = sh.getLastRow();
    out[sh.getName()] = (lr < 1)
      ? '(empty)'
      : { rows: lr-1, headers: sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0] };
  });
  return JSON.stringify(out, null, 2);
}
