/**
 * Qmsv2.js — QMS v2 cockpit server layer (P1, Task T1).
 *
 * Reuse-only board data: reads existing getRecordsList(type) and maps each
 * record's status into kanban columns + a 6-stage pipeline index. Does NOT
 * touch the stock engine. ACTION_REGISTRY_ / runAction land in T5/T6.
 *
 * Contracts relied on (verified, do not assume):
 *   getRecordsList(type)  -> [{docNo, date, name, status}]  newest-first, cap 200
 *   getOperators()        -> [{name, role, shift}]
 */

// 6-stage pipeline shown on every card (spec §13 / PLAN-QMSV2-P1 T4).
var QMSV2_STAGES = ['GRN', 'IQC', 'PUTAWAY', 'ISSUE', 'OQC', 'DISPATCH'];

// Roles → which doc-type tabs are that role's "My Work" (spec §13 matrix).
// 'manager' sees everything. Used by the client to default + filter the board.
var QMSV2_ROLE_STAGES = {
  gate:      ['GRN'],
  inspector: ['IQC', 'IPQC', 'OQC'],
  storage:   ['IPQC', 'Dispatch', 'NCR'],   // putaway/move/issue/return surface here
  dispatch:  ['Dispatch'],
  manager:   ['GRN', 'IQC', 'IPQC', 'OQC', 'Dispatch', 'Production', 'NCR']
};

function getRoleStageMap() {
  return QMSV2_ROLE_STAGES;
}

/**
 * Resolve an OPERATORS-sheet role (location/duty value like 'gate','floor-1',
 * 'admin','owner') to a cockpit role key in QMSV2_ROLE_STAGES.
 * The sheet's 'role' column is chokepoint duty, NOT a cockpit role — this is
 * the single mapping point. Unknown roles fall back to 'storage' (floor duty).
 */
function resolveCockpitRole_(sheetRole) {
  var r = String(sheetRole || '').toLowerCase().trim();
  if (r === 'owner' || r === 'admin' || r === 'manager') return 'manager';
  if (r === 'gate') return 'gate';
  if (r === 'qa' || r === 'inspector' || r === 'lab')    return 'inspector';
  if (r === 'dispatch')                                  return 'dispatch';
  // floor-1 / floor-2 / storage / anything else = floor storage duty
  return 'storage';
}

/**
 * Operators for the cockpit identity dropdown, each carrying a resolved
 * cockpitRole so the client never has to know the sheet→role mapping.
 * Shape: [{ name, role, shift, cockpitRole }].
 */
function getQmsv2Operators() {
  return (getOperators() || []).map(function (op) {
    return {
      name: op.name,
      role: op.role,
      shift: op.shift,
      cockpitRole: resolveCockpitRole_(op.role)
    };
  });
}

/**
 * Map a record's raw status string to a pipeline stage index (0-5) for its type.
 * Heuristic (documented in PLAN-QMSV2-P1 risk table) — approximate, not full trace.
 * Returns the index of the stage the record currently sits AT.
 */
function statusToStage(type, status) {
  var s = String(status || '').toUpperCase();

  switch (type) {
    case 'GRN':
      // GRN created → at GRN; once IQC disposition set it has moved to IQC.
      return /PENDING/.test(s) ? 0 : 1;
    case 'IQC':
      // Accepted material proceeds to putaway; rejected stays at IQC.
      return /ACCEPT|PASS|RELEASE/.test(s) ? 2 : 1;
    case 'IPQC':
      return 3; // in-process = on the line, between issue and OQC
    case 'OQC':
      return /ACCEPT|PASS|RELEASE/.test(s) ? 5 : 4;
    case 'Dispatch':
      return 5;
    case 'Production':
      return 3; // production job lives at the ISSUE→line stage
    default:
      return 0;
  }
}

/**
 * Bucket a record's status into a kanban column.
 *   pending    — not started / awaiting action
 *   inProgress — open / mid-flow
 *   done       — terminal accept/release/dispatch
 */
// Four-column model: pending | rejected | hold | completed.
// (Grounded against live data: REJECTED and HOLD are real values; IN_PROGRESS
// folds into pending as still-active work.)
function statusToColumn_(type, status) {
  var s = String(status || '').toUpperCase();
  if (/REJECT/.test(s))                                                         return 'rejected';
  if (/HOLD/.test(s))                                                           return 'hold';
  if (/ACCEPT|PASS|RELEASE|DISPATCHED|CLOSED|COMPLETE|DONE|PRODUCED/.test(s))   return 'completed';
  return 'pending';
}

// Age in whole days from a record's display date string.
// getRecordsList emits dates via formatDate -> "DD-Mmm-YYYY". Some logs (e.g.
// IPQC) carry a non-date in col 2, so date can be a bare/unparseable string
// that Date() coerces to ~1970, fabricating a huge age (and false overdue).
// Guard: only trust the known formatDate shape; anything else = unknown age (0).
function recordAgeDays_(dateStr) {
  if (!dateStr) return 0;
  if (!/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(String(dateStr).trim())) return 0;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  // Reject implausible dates (before 2020) — defends against epoch coercion.
  if (d.getFullYear() < 2020) return 0;
  var ms = (new Date()).getTime() - d.getTime();
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

// Per-type overdue threshold (days). Conservative defaults; tune later.
var QMSV2_OVERDUE_DAYS = {
  GRN: 2, IQC: 2, IPQC: 1, OQC: 2, Dispatch: 3, Production: 5, NCR: 7
};

/**
 * getQmsv2Board(type, role) — board data for one doc-type tab.
 * Returns { type, role, stages, columns:{pending:[],inProgress:[],done:[]},
 *           counts:{pending,inProgress,done,total} }.
 * Each card: { docNo, name, status, date, stage, ageDays, overdue }.
 */
function getQmsv2Board(type, role) {
  var records = getRecordsList(type) || [];
  var threshold = QMSV2_OVERDUE_DAYS[type] || 3;

  var columns = { pending: [], rejected: [], hold: [], completed: [] };

  records.forEach(function(r) {
    var ageDays = recordAgeDays_(r.date);
    var col = statusToColumn_(type, r.status);
    var card = {
      docNo:   r.docNo,
      name:    r.name,
      status:  r.status,
      date:    r.date,
      qty:     r.qty || '',
      stage:   statusToStage(type, r.status),
      ageDays: ageDays,
      overdue: col === 'pending' && ageDays > threshold
    };
    columns[col].push(card);
  });

  return {
    type:    type,
    role:    role || '',
    stages:  QMSV2_STAGES,
    columns: columns,
    counts: {
      pending:   columns.pending.length,
      rejected:  columns.rejected.length,
      hold:      columns.hold.length,
      completed: columns.completed.length,
      total:     records.length
    }
  };
}

// ---------------------------------------------------------------------------
// Action registry (T5) — the "+" picker.
//   kind:'launch' → client navigateTo(form); existing Tier-2 flow, NOT rebuilt.
//   kind:'inline' → client renders a config-driven form; runAction handles submit.
// Groups: Receive · Inspect · Make · Ship · Move · Resolve.
// In P1 only 'move' is wired end-to-end (T6); other inline actions are
// declared (so the picker is complete) but runAction guards them as not-yet.
// ---------------------------------------------------------------------------
var QMSV2_ACTIONS = [
  // Receive
  { id:'grn',        label:'Goods Receipt',   group:'Receive', kind:'launch', form:'GRN' },
  // Inspect
  { id:'iqc',        label:'Incoming QC',     group:'Inspect', kind:'launch', form:'IQC' },
  { id:'ipqc',       label:'In-Process QC',   group:'Inspect', kind:'launch', form:'IPQC' },
  { id:'oqc',        label:'Outgoing QC',     group:'Inspect', kind:'launch', form:'OQC' },
  { id:'sample',     label:'Pull Sample',     group:'Inspect', kind:'inline', serverFn:'runAction',
    fields:[{ name:'material', type:'material' }, { name:'lot', type:'text' }, { name:'qty', type:'number' }] },
  // Make
  { id:'production',  label:'Production Job',  group:'Make',    kind:'launch', form:'Production' },
  { id:'issue',       label:'Issue RM',        group:'Make',    kind:'inline', serverFn:'runAction',
    fields:[{ name:'material', type:'material' }, { name:'lot', type:'text' },
            { name:'fromLoc', type:'location' }, { name:'prodOrder', type:'text' },
            { name:'qty', type:'number' }] },
  { id:'rework',      label:'Rework Complete', group:'Make',    kind:'launch', form:'Rework' },
  // Ship
  { id:'dispatch',    label:'Dispatch',        group:'Ship',    kind:'launch', form:'Dispatch' },
  // Move — the P1 proof-of-write (T6)
  { id:'move',        label:'Move Stock',      group:'Move',    kind:'inline', serverFn:'runAction',
    fields:[{ name:'material', type:'material' }, { name:'lot', type:'text' },
            { name:'fromLoc', type:'location' }, { name:'toLoc', type:'location' },
            { name:'qty', type:'number' }] },
  // Putaway checklist — shell built (Stitch layout); write wiring deferred to P2.
  { id:'putaway',     label:'Putaway Checklist', group:'Move',  kind:'checklist' },
  // Resolve
  { id:'ncr',         label:'Raise NCR',       group:'Resolve', kind:'launch', form:'NCR' },
  { id:'custreturn',  label:'Customer Return', group:'Resolve', kind:'launch', form:'CustomerReturn' },
  { id:'scrap',       label:'Scrap',           group:'Resolve', kind:'inline', serverFn:'runAction', critical:true,
    warning:'Scrapping permanently removes stock. This cannot be undone.',
    fields:[{ name:'material', type:'material' }, { name:'lot', type:'text' },
            { name:'fromLoc', type:'location' }, { name:'qty', type:'number' },
            { name:'reason', type:'select', options:['Defect','Expired','Damaged','Contaminated','Other'] }] }
];

// Group display order for the picker.
var QMSV2_ACTION_GROUPS = ['Receive', 'Inspect', 'Make', 'Ship', 'Move', 'Resolve'];

function getQmsv2Actions() {
  return { groups: QMSV2_ACTION_GROUPS, actions: QMSV2_ACTIONS };
}

// Next-action suggestions when a record is opened, keyed by its pipeline stage
// (QMSV2_STAGES index from statusToStage). These are the actions a user most
// likely takes to advance the record. Action ids must exist in QMSV2_ACTIONS.
// 0:GRN 1:IQC 2:PUTAWAY 3:ISSUE 4:OQC 5:DISPATCH
var QMSV2_NEXT_BY_STAGE = {
  0: ['iqc'],                 // received → inspect
  1: ['putaway', 'ncr'],      // IQC done → store, or raise NCR
  2: ['issue', 'move'],       // in store → issue to production / relocate
  3: ['ipqc', 'sample'],      // on line → in-process QC / pull sample
  4: ['dispatch'],            // OQC released → dispatch
  5: ['custreturn']           // dispatched → (handle a return)
};
// Always available regardless of stage.
var QMSV2_ALWAYS_ACTIONS = ['move', 'scrap', 'ncr'];

/**
 * getNextActions(type, stage, status) → ordered, de-duped list of action objects
 * (from QMSV2_ACTIONS) suggested for a record at the given pipeline stage.
 * Returns [{id,label,group,kind,...}] so the client can render + dispatch them
 * through the existing picker machinery. `type`/`status` reserved for future
 * per-type refinement; stage is the primary driver today.
 */
function getNextActions(type, stage, status) {
  var byId = {};
  QMSV2_ACTIONS.forEach(function(a){ byId[a.id] = a; });
  // A completed/terminal record has no "advance" action left — showing the full stage set
  // (and the always-on move/scrap) on a done record is misleading. Offer only 'ncr' so a
  // problem can still be raised against it. statusToColumn_ is the single completion oracle.
  var ids;
  if (statusToColumn_(type, status) === 'completed') {
    ids = ['ncr'];
  } else {
    ids = (QMSV2_NEXT_BY_STAGE[Number(stage)] || []).concat(QMSV2_ALWAYS_ACTIONS);
  }
  var seen = {}, out = [];
  ids.forEach(function(id){
    if (seen[id] || !byId[id]) return;
    seen[id] = true;
    out.push(byId[id]);
  });
  return out;
}

// Lean trace for the cockpit detail view. traceBatch() is heavy (scans ~26 sheets) and its
// FULL payload fails to deliver over the page's google.script.run in the GAS double-iframe
// (large object → silent drop). This wrapper runs the (cached) traceBatch server-side, then
// returns a SMALL, capped projection with only the fields renderDetail consumes — so it
// transmits reliably and fast. Cap lanes to keep the payload tiny.
function getQmsv2TraceLite(docNo, cap) {
  cap = cap || 5;
  function take(arr, mapFn) {
    return (arr || []).slice(0, cap).map(mapFn);
  }
  try {
    var t = traceBatch(docNo) || {};
    if (t.success === false) return { success: false, message: t.message || 'Trace unavailable.' };
    var up = (t.upstream && t.upstream.components) || [];
    var ipqc = (t.thisBatch && t.thisBatch.ipqc) || [];
    var dn = t.downstream || {};
    var iss = t.issues || {};
    var a = t.anchor || {};
    return {
      success: true,
      anchor: { materialCode: a.materialCode || '', batchOrLot: a.batchOrLot || '' },
      upstream:   { components: take(up, function(c){ return { compCode:c.compCode||'', compDesc:c.compDesc||'', totalIssued:c.totalIssued, unit:c.unit||'', type:c.type||'' }; }) },
      thisBatch:  { ipqc: take(ipqc, function(r){ return { docNo:r.docNo||'', inspector:r.inspector||'', rounds:r.rounds, status:r.status||'' }; }) },
      downstream: {
        oqc:      take(dn.oqc,      function(r){ return { docNo:r.docNo||'', customer:r.customer||'', status:r.status||'' }; }),
        dispatch: take(dn.dispatch, function(r){ return { docNo:r.docNo||'', customer:r.customer||'', status:r.status||'' }; }),
        fgJobs:   take(dn.fgJobs,   function(r){ return { jobId:r.jobId||'', fgCode:r.fgCode||'', fgDesc:r.fgDesc||'', status:r.status||'' }; })
      },
      issues: {
        ncr:            take(iss.ncr,            function(r){ return { docNo:r.docNo||'', source:r.source||'', status:r.status||'' }; }),
        customerReturn: take(iss.customerReturn, function(r){ return { docNo:r.docNo||'', customer:r.customer||'', status:r.status||'' }; })
      },
      caps: { applied: cap }
    };
  } catch (e) {
    return { success: false, message: String(e && e.message || e).slice(0, 120) };
  }
}

// Form-source data for inline action dropdowns (lazy — client requests when an
// inline action opens). Shapes verified against Warehouse.js:
//   getStockSummary -> [{materialCode, batchOrLotNo, locationId, balance}]
//   getLocations    -> [{id, label, type, ...}]
function getActionFormData() {
  var summary = getStockSummary() || [];
  // Distinct material codes that currently have stock.
  var seen = {}, materials = [];
  summary.forEach(function(s){
    var code = String(s.materialCode || '').trim();
    if (!code || seen[code]) return;
    seen[code] = true;
    materials.push({ code: code });
  });
  materials.sort(function(a, b){ return a.code < b.code ? -1 : 1; });
  var locs = (getLocations() || []).map(function(l){
    return { id: String(l.id), label: String(l.label || l.id) };
  });
  return { materials: materials, locations: locs, stock: summary };
}

// Putaway queue — lots currently sitting at an inbound/quarantine location that
// await placement. SHELL DATA (read-only): surfaces real stock rows whose
// location looks like a receiving/inbound spot so the checklist has live items.
// The actual placement write (Scan rack → recordLocationTransfer) is P2.
//
// RENAMED from getPutawayQueue. It collided with Warehouse.js:402, which every
// caller actually wants: PutawayQueue.html:12 documents that shape, and
// Code.js:817 reads r.fromLocationId, which this version does not return (it
// returns `from`) — so whenever this definition won the parse, the putaway
// diagnostic grouped every row under "(blank)". Worse, the demo fallback below
// (`if (!rows.length) rows = summary.slice(0, 8)`) FABRICATES rows that are not
// actually pending putaway. In GAS every .js shares one global scope and the
// last definition parsed wins, so which one you got was load-order luck.
// Unreferenced under the new name; kept rather than deleted because it is the
// QMSv2 shell's intended data source.
function qmsv2PutawayQueue_() {
  var summary = getStockSummary() || [];
  var INBOUND = /(GATE|INBOUND|RECEIV|QUARANT|IQC|HOLD|STAGE|UNSORT)/i;
  var rows = summary.filter(function(s){ return INBOUND.test(String(s.locationId || '')); });
  // Fallback: if nothing matches an inbound pattern, show the most recent stock
  // rows so the shell is never empty in a demo/pilot sheet.
  if (!rows.length) rows = summary.slice(0, 8);
  return rows.slice(0, 25).map(function(s){
    return { material: s.materialCode, lot: s.batchOrLotNo, from: s.locationId, qty: s.balance };
  });
}

// On-hand for a material+lot+location, for the inline Move form's reference.
// lot may be blank (move whole-material at a location); getStockBalance_ keys
// on exact material|lot|location.
function getOnHand(materialCode, lot, locationId) {
  return getStockBalance_(materialCode, lot || '', locationId);
}

/**
 * runAction(actionId, payload) — Tier-1 action dispatch (T6).
 * P1 wires only 'move' end-to-end → recordLocationTransfer (writes STOCK_LEDGER).
 * Other inline actions are declared in the registry but guarded here until
 * their phase. Always returns { success, ... } | { success:false, error }.
 */
function runAction(actionId, payload) {
  payload = payload || {};
  // Guard: all stock-moving actions require a positive quantity. recordScrap/recordSample
  // do not check this themselves, so enforce it here before any write.
  if (['move','issue','sample','scrap'].indexOf(actionId) !== -1) {
    if (!(Number(payload.qty) > 0)) return { success: false, error: 'Quantity must be greater than 0.' };
  }
  if (actionId === 'move') {
    return recordLocationTransfer({
      materialCode:   payload.material,
      batchOrLotNo:   payload.lot || '',
      fromLocationId: payload.fromLoc,
      toLocationId:   payload.toLoc,
      qty:            payload.qty,
      reason:         'QMSv2 Move',
      transferredBy:  payload.by || ''
    });
  }
  if (actionId === 'issue') {
    // Gated RM issuance (IQC=ACCEPTED + non-quarantine location). Writes PROD_ISSUE_LOG + STOCK_LEDGER OUT.
    return issueRMForProduction({
      materialCode:      payload.material,
      batchOrLotNo:      payload.lot || '',
      locationId:        payload.fromLoc,
      qtyToIssue:        payload.qty,
      productionOrderNo: payload.prodOrder || '',
      issuedBy:          payload.by || ''
    });
  }
  if (actionId === 'sample') {
    // Pull inspection sample → SAMPLE_LOG + STOCK_LEDGER OUT to SAMPLE-CABINET.
    return recordSample({
      refDocType:     'QMSv2',
      refDocNo:       '',
      materialCode:   payload.material,
      batchOrLotNo:   payload.lot || '',
      qtySample:      payload.qty,
      unit:           '',
      samplePurpose:  'QMSv2 Pull Sample',
      takenBy:        payload.by || '',
      locationStored: 'SAMPLE-CABINET',
      locationId:     payload.fromLoc || ''
    });
  }
  if (actionId === 'scrap') {
    // Destructive — writes SCRAP_LOG + STOCK_LEDGER OUT to SCRAP-AREA.
    return recordScrap({
      refDocType:       'QMSv2',
      refDocNo:         '',
      materialCode:     payload.material,
      batchOrLotNo:     payload.lot || '',
      qtyScrap:         payload.qty,
      unit:             '',
      scrapReason:      payload.reason || 'Unspecified',
      scrapDestination: 'SCRAP-AREA',
      recordedBy:       payload.by || '',
      locationId:       payload.fromLoc || ''
    });
  }
  return { success: false, error: 'Action "' + actionId + '" is not enabled.' };
}
