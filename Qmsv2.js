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
function statusToColumn_(type, status) {
  var s = String(status || '').toUpperCase();
  if (/ACCEPT|PASS|RELEASE|DISPATCHED|CLOSED|COMPLETE|DONE/.test(s)) return 'done';
  if (/PENDING|OPEN|AVAILABLE|ISSUED|BOOKED/.test(s))               return 'pending';
  return 'inProgress';
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

  var columns = { pending: [], inProgress: [], done: [] };

  records.forEach(function(r) {
    var ageDays = recordAgeDays_(r.date);
    var col = statusToColumn_(type, r.status);
    var card = {
      docNo:   r.docNo,
      name:    r.name,
      status:  r.status,
      date:    r.date,
      stage:   statusToStage(type, r.status),
      ageDays: ageDays,
      overdue: col !== 'done' && ageDays > threshold
    };
    columns[col].push(card);
  });

  return {
    type:    type,
    role:    role || '',
    stages:  QMSV2_STAGES,
    columns: columns,
    counts: {
      pending:    columns.pending.length,
      inProgress: columns.inProgress.length,
      done:       columns.done.length,
      total:      records.length
    }
  };
}
