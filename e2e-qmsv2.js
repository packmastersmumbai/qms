// E2E (logic) — Qmsv2 board mapping verification (Task T1).
// Proves statusToStage / statusToColumn / overdue / getQmsv2Board shape
// deterministically against synthetic records. Mirrors Qmsv2.js exactly;
// keep in sync. Live RPC wiring is asserted in T8.

// --- algorithm under test (kept in sync with Qmsv2.js) ---
var QMSV2_STAGES = ['GRN', 'IQC', 'PUTAWAY', 'ISSUE', 'OQC', 'DISPATCH'];

function statusToStage(type, status) {
  var s = String(status || '').toUpperCase();
  switch (type) {
    case 'GRN':        return /PENDING/.test(s) ? 0 : 1;
    case 'IQC':        return /ACCEPT|PASS|RELEASE/.test(s) ? 2 : 1;
    case 'IPQC':       return 3;
    case 'OQC':        return /ACCEPT|PASS|RELEASE/.test(s) ? 5 : 4;
    case 'Dispatch':   return 5;
    case 'Production': return 3;
    default:           return 0;
  }
}

function statusToColumn(type, status) {
  var s = String(status || '').toUpperCase();
  if (/ACCEPT|PASS|RELEASE|DISPATCHED|CLOSED|COMPLETE|DONE/.test(s)) return 'done';
  if (/PENDING|OPEN|AVAILABLE|ISSUED|BOOKED/.test(s))               return 'pending';
  return 'inProgress';
}

var OVERDUE_DAYS = { GRN: 2, IQC: 2, IPQC: 1, OQC: 2, Dispatch: 3, Production: 5, NCR: 7 };

// T3: OPERATORS-sheet role (chokepoint duty) → cockpit role. Mirrors Qmsv2.js.
function resolveCockpitRole(sheetRole) {
  var r = String(sheetRole || '').toLowerCase().trim();
  if (r === 'owner' || r === 'admin' || r === 'manager') return 'manager';
  if (r === 'gate') return 'gate';
  if (r === 'qa' || r === 'inspector' || r === 'lab')    return 'inspector';
  if (r === 'dispatch')                                  return 'dispatch';
  return 'storage';
}

// Age guard mirrors Qmsv2.js recordAgeDays_ — only trust DD-Mmm-YYYY, reject pre-2020.
function ageDaysFrom(dateStr, todayMs) {
  if (!dateStr) return 0;
  if (!/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(String(dateStr).trim())) return 0;
  var d = new Date(dateStr);
  if (isNaN(d.getTime()) || d.getFullYear() < 2020) return 0;
  var ms = todayMs - d.getTime();
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

// Pure board builder: takes records + a fixed "today" so age math is deterministic.
function buildBoard(type, role, records, todayMs) {
  var threshold = OVERDUE_DAYS[type] || 3;
  var columns = { pending: [], inProgress: [], done: [] };
  records.forEach(function (r) {
    var ageDays = ageDaysFrom(r.date, todayMs);
    var col = statusToColumn(type, r.status);
    columns[col].push({
      docNo: r.docNo, name: r.name, status: r.status, date: r.date,
      stage: statusToStage(type, r.status), ageDays: ageDays,
      overdue: col !== 'done' && ageDays > threshold
    });
  });
  return {
    type: type, role: role || '', stages: QMSV2_STAGES, columns: columns,
    counts: {
      pending: columns.pending.length, inProgress: columns.inProgress.length,
      done: columns.done.length, total: records.length
    }
  };
}

var pass = 0, total = 0;
function check(name, cond) { total++; var ok = cond === true; console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  — ' + cond)); if (ok) pass++; }

var TODAY = new Date('2026-06-26T12:00:00').getTime();
var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Emit formatDate's "DD-Mmm-YYYY" so the age guard accepts it (matches Records.js).
function daysAgo(n) {
  var d = new Date(TODAY - n * 86400000);
  return String(d.getDate()).padStart(2, '0') + '-' + MON[d.getMonth()] + '-' + d.getFullYear();
}

// --- statusToStage ---
check('GRN pending → stage 0', statusToStage('GRN', 'IQC Pending') === 0 || 'got ' + statusToStage('GRN', 'IQC Pending'));
check('GRN dispositioned → stage 1', statusToStage('GRN', 'ACCEPTED') === 1 || 'got ' + statusToStage('GRN', 'ACCEPTED'));
check('IQC accepted → stage 2 (putaway)', statusToStage('IQC', 'ACCEPTED') === 2);
check('IQC rejected → stage 1', statusToStage('IQC', 'REJECTED') === 1);
check('OQC released → stage 5', statusToStage('OQC', 'RELEASED') === 5);
check('OQC pending → stage 4', statusToStage('OQC', 'PENDING') === 4);
check('Dispatch → stage 5', statusToStage('Dispatch', 'AVAILABLE') === 5);

// --- statusToColumn ---
check('ACCEPTED → done', statusToColumn('IQC', 'ACCEPTED') === 'done');
check('IQC Pending → pending', statusToColumn('GRN', 'IQC Pending') === 'pending');
check('OPEN → pending', statusToColumn('NCR', 'OPEN') === 'pending');
check('DISPATCHED → done', statusToColumn('Dispatch', 'DISPATCHED') === 'done');
check('unknown status → inProgress', statusToColumn('IQC', 'UNDER REVIEW') === 'inProgress');

// --- getQmsv2Board shape + bucketing + overdue ---
var records = [
  { docNo: 'GRN-001', name: 'Acme', status: 'IQC Pending', date: daysAgo(5) }, // pending, overdue (>2)
  { docNo: 'GRN-002', name: 'Beta', status: 'IQC Pending', date: daysAgo(1) }, // pending, not overdue
  { docNo: 'GRN-003', name: 'Cee',  status: 'ACCEPTED',    date: daysAgo(9) }, // done, never overdue
];
var board = buildBoard('GRN', 'storage', records, TODAY);

check('board has stages array (6)', Array.isArray(board.stages) && board.stages.length === 6);
check('board has 3 column buckets', !!board.columns.pending && !!board.columns.inProgress && !!board.columns.done);
check('counts.total = 3', board.counts.total === 3 || 'total=' + board.counts.total);
check('2 pending, 1 done', board.counts.pending === 2 && board.counts.done === 1 || 'p=' + board.counts.pending + ' d=' + board.counts.done);

var card = board.columns.pending.find(function (c) { return c.docNo === 'GRN-001'; });
check('card carries required fields', card && 'docNo' in card && 'name' in card && 'status' in card && 'stage' in card && 'overdue' in card && 'ageDays' in card);
check('old pending card flagged overdue', card && card.overdue === true || 'overdue=' + (card || {}).overdue);
check('recent pending card NOT overdue', board.columns.pending.find(function (c) { return c.docNo === 'GRN-002'; }).overdue === false);
check('done card never overdue', board.columns.done[0].overdue === false);
check('card stage index correct (pending GRN = 0)', card && card.stage === 0);

// --- resolveCockpitRole (T3) — seeded OPERATORS roles map correctly ---
check('owner → manager', resolveCockpitRole('owner') === 'manager');
check('admin → manager', resolveCockpitRole('admin') === 'manager');
check('gate → gate', resolveCockpitRole('gate') === 'gate');
check('floor-1 → storage (fallback)', resolveCockpitRole('floor-1') === 'storage');
check('floor-2 → storage (fallback)', resolveCockpitRole('floor-2') === 'storage');
check('qa → inspector', resolveCockpitRole('qa') === 'inspector');
check('dispatch → dispatch', resolveCockpitRole('dispatch') === 'dispatch');
check('empty role → storage', resolveCockpitRole('') === 'storage');

// --- age guard (T4 bug fix) — bad dates must NOT fabricate age/overdue ---
check('valid DD-Mmm-YYYY parses', ageDaysFrom('21-Jun-2026', TODAY) === 5 || 'got ' + ageDaysFrom('21-Jun-2026', TODAY));
check('empty date → 0', ageDaysFrom('', TODAY) === 0);
check('ISO date (wrong shape) → 0', ageDaysFrom('2026-06-21', TODAY) === 0);
check('bare number string → 0', ageDaysFrom('45123', TODAY) === 0);
check('garbage string → 0', ageDaysFrom('OPEN', TODAY) === 0);
check('pre-2020 plausible-shape → 0', ageDaysFrom('01-Jan-1970', TODAY) === 0);

// IPQC-style records with non-date in date field must not all flag overdue.
var ipqc = [
  { docNo: 'IP-1', name: 'X', status: 'OPEN', date: '45123' },
  { docNo: 'IP-2', name: 'Y', status: 'OPEN', date: '' }
];
var ipqcBoard = buildBoard('IPQC', 'storage', ipqc, TODAY);
check('IPQC bad-date cards not overdue', ipqcBoard.columns.pending.every(function (c) { return c.overdue === false; }) || 'some overdue');
check('IPQC bad-date age = 0', ipqcBoard.columns.pending.every(function (c) { return c.ageDays === 0; }) || 'nonzero age');

console.log('----- ' + pass + '/' + total + ' passed -----');
process.exit(pass === total ? 0 : 1);
