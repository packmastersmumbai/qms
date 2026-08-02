/**
 * _DummyDataAudit.js — READ-ONLY. Deletes nothing, writes nothing.
 *
 * Two jobs the existing _TestRecordScan.js does not cover:
 *  1. Classify each smoke-test hit as SYNTHETIC (whole record was machine-created)
 *     vs TAINTED (a real business document that merely has a test value in one
 *     actor column). Deleting a TAINTED row destroys a genuine record.
 *  2. Scan the MASTERS_* reference sheets, which _TestRecordScan deliberately skips
 *     but which Masters / MastersCrud / ControlPlan / Trace all read from.
 *
 * Entry point: auditDummyData()   →  ?diag=dummyaudit
 */

var DUMMY_MARKER_RE_ = /(claude[\s\-]*smoke[\s\-]*test|\bE2E[\/\-]|\bBATCH-E2E|smoke[\s\-]*test|\bdummy\b|\bdemo\b|delete\s*me|\btest\s*supplier\b|\bfoobar\b|\bacme\b|mr\.?\s*test|john\s*doe)/i;

// Reference sheets behind the four modules under review.
var MASTER_SHEETS_ = [
  'MASTERS_Materials', 'MASTERS_Suppliers', 'MASTERS_Customers',
  'MASTERS_Parameters', 'MASTERS_Operators', 'MASTERS_Products',
  'LOCATIONS', 'BOM', 'CONTROL_FG', 'CONFIG'
];

// Columns that record WHO did something. A marker here means the record was
// touched by a test, not that the record itself is fake.
var ACTOR_COL_RE_ = /(by|actor|user|operator|inspector|revised_by|modifiedby|createdby)$/i;

function auditDummyData() {
  var ss = getSpreadsheet();
  var L = [];

  L.push('===== DUMMY / TEST DATA AUDIT (READ-ONLY) =====');

  // ── 1. Transactional: synthetic vs tainted ────────────────────────
  L.push('\n--- TRANSACTIONAL ---');
  ['NCR_LOG', 'NCR_HISTORY', 'SAMPLE_LOG', 'REVISIONS_LOG'].forEach(function (name) {
    var ws = ss.getSheetByName(name);
    if (!ws) { L.push(name + ': MISSING'); return; }
    var lr = ws.getLastRow(), lc = ws.getLastColumn();
    if (lr < 2) { L.push(name + ': empty'); return; }
    var headers = ws.getRange(1, 1, 1, lc).getValues()[0].map(String);
    var data = ws.getRange(2, 1, lr - 1, lc).getValues();

    var synthetic = [], tainted = [];
    data.forEach(function (row, i) {
      var actorHits = [], dataHits = [];
      for (var c = 0; c < row.length; c++) {
        var v = row[c]; if (v == null || v === '') continue;
        if (!DUMMY_MARKER_RE_.test(String(v))) continue;
        (ACTOR_COL_RE_.test(headers[c].trim()) ? actorHits : dataHits)
          .push(headers[c] + '="' + String(v).slice(0, 40) + '"');
      }
      if (!actorHits.length && !dataHits.length) return;
      var rec = { row: i + 2, id: String(row[0]).slice(0, 24),
                  where: actorHits.concat(dataHits).join(' ; ') };
      // Marker ONLY in an actor column => the business record is real.
      (dataHits.length ? synthetic : tainted).push(rec);
    });

    L.push('\n' + name + ' — total rows ' + (lr - 1) +
           ' | SYNTHETIC ' + synthetic.length + ' | TAINTED ' + tainted.length);
    if (synthetic.length) {
      L.push('  SAFE TO DELETE (fake records):');
      synthetic.slice(0, 8).forEach(function (r) { L.push('    row ' + r.row + ' id=' + r.id + ' ' + r.where); });
      if (synthetic.length > 8) L.push('    ... +' + (synthetic.length - 8) + ' more');
    }
    if (tainted.length) {
      L.push('  REAL RECORDS w/ test actor (deleting these LOSES real data):');
      tainted.slice(0, 8).forEach(function (r) { L.push('    row ' + r.row + ' id=' + r.id + ' ' + r.where); });
      if (tainted.length > 8) L.push('    ... +' + (tainted.length - 8) + ' more');
      // Show the id span so the user can judge whether it is a contiguous test run.
      var ids = tainted.map(function (r) { return r.id; }).filter(Boolean);
      if (ids.length) L.push('    id span: ' + ids[0] + '  ..  ' + ids[ids.length - 1]);
    }
  });

  // ── 2. Master/reference sheets ────────────────────────────────────
  L.push('\n--- MASTERS / REFERENCE (behind Masters, MastersCrud, ControlPlan, Trace) ---');
  MASTER_SHEETS_.forEach(function (name) {
    var ws = ss.getSheetByName(name);
    if (!ws) { L.push(name + ': ABSENT'); return; }
    var lr = ws.getLastRow(), lc = ws.getLastColumn();
    if (lr < 2 || lc < 1) { L.push(name + ': empty (' + lr + ' rows)'); return; }
    var headers = ws.getRange(1, 1, 1, lc).getValues()[0].map(String);
    var data = ws.getRange(2, 1, lr - 1, lc).getValues();
    var hits = [];
    var blankFirstCol = 0;
    data.forEach(function (row, i) {
      if (String(row[0]).trim() === '') blankFirstCol++;
      for (var c = 0; c < row.length; c++) {
        var v = row[c]; if (v == null || v === '') continue;
        if (DUMMY_MARKER_RE_.test(String(v))) {
          hits.push('row ' + (i + 2) + ' ' + headers[c] + '="' + String(v).slice(0, 34) + '"');
          break;
        }
      }
    });
    L.push('\n' + name + ' — ' + (lr - 1) + ' rows x ' + lc + ' cols | dummy ' + hits.length +
           ' | blank-key rows ' + blankFirstCol);
    L.push('  header: ' + headers.join(' | ').slice(0, 200));
    hits.slice(0, 6).forEach(function (h) { L.push('    ' + h); });
    if (hits.length > 6) L.push('    ... +' + (hits.length - 6) + ' more');
  });

  var out = L.join('\n');
  Logger.log(out);
  return out;
}
