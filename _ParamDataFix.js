// One-off, idempotent repair of MASTERS_Parameters. Follows _ParamHeaderFix's
// contract: dry run by default, &confirm=YES to apply, every step re-runnable.
//   ?diag=paramdatafix              → dry run (writes nothing)
//   ?diag=paramdatafix&confirm=YES  → apply
//
// FOUR fixes, in dependency order (3 must precede 4 or the plan orphans):
//   1. std_value on the 68 category params. IQC_F renders the "Accept:" line only
//      `if (p.std)` (IQC_F.html:1220), so a blank std drops it entirely. tol_min/
//      tol_max are read (IQC.js:43) but never rendered or compared — populating
//      them would change nothing on screen, so this fix does NOT touch them.
//      Visual/Functional params get a criterion restated from their OWN
//      check_brief; measured params get 'As per spec' — an honest placeholder,
//      NOT a fabricated limit. QA supplies the real numbers later.
//   2. Corrupted numeric cells on QP014/QP020/QP021 — percent-text in tol_min
//      against a decimal in tol_max (e.g. min='−0.5%' vs max=0.005). No pair can
//      both be right; blanked rather than guessed.
//   3. Repoint product 2967583's CONTROL_FG plan off the legacy QP codes onto
//      category codes, PRESERVING its three overrides.
//   4. Archive the 35 legacy QP rows by setting category='ARCHIVED'. NOT deleted
//      — reversible, and nothing reads a blank-category row anyway (the legacy
//      fallback at IQC.js:122 uses hardcoded IQC_PARAMS, not these rows).
// Plus: create CONTROL_RM, which ?diag=paramlink expects and finds MISSING.

// Acceptance criteria restated from each row's own check_brief. Only rows whose
// method is inherently pass/fail get a real criterion; measured ones get the
// placeholder. Keyed by param code so a re-run is a no-op on already-set cells.
var PARAM_STD_QUALITATIVE_ = {
  // HDPE_BOTTLE
  HB_LEAK:    'No leak / no pressure drop',
  HB_DROP:    'No crack or leak after drop',
  HB_COLOUR:  'Matches approved colour standard (D65)',
  HB_CLARITY: 'No haze beyond approved limit',
  // LABEL
  LB_PRINT:   'No smudge, misregistration or missing text vs proof',
  LB_BARCODE: 'Scans first attempt, verifier grade >= C',
  // CARTON
  CT_PRINT:   'No smudge or misregistration vs proof',
  CT_PLY:     'No delamination under load',
  // BULK
  BK_CONTAM:  'No foreign matter / black specks',
  BK_COLOUR:  'Matches colour standard (D65)',
  // FILM
  FM_PRINT:   'Print density even, no streaks vs proof',
  FM_CORE:    'Core ID per spec, winding even, no telescoping',
  // PAPER — all five are measured; no qualitative entry.
  // POUCH
  PO_LEAK:    'No leak or burst at test pressure',
  PO_SPOUT:   'Spout seated square, no cross-thread',
  PO_GUSSET:  'Stands unaided when filled',
  PO_PRINT:   'No smudge or misregistration vs proof',
  PO_DELAM:   'No delamination',
  // RUBBER
  RB_AGE:     'No perish, cracking or surface tack',
  // SACHET
  SA_LEAK:    'No leak',
  SA_NOTCH:   'Tears cleanly at notch by hand',
  SA_PRINT:   'Batch code legible, print matches proof',
  SA_DELAM:   'No delamination',
  // FG
  FG_APPEAR:  'No surface defect, scuff or deformation',
  FG_LEAK:    'No leak',
  FG_CAPFIT:  'Cap seated square, no cross-thread',
  FG_SEAL:    'Induction seal intact, full circumference',
  FG_LABEL:   'Label present, square, within placement tolerance',
  FG_CODING:  'MRP / batch / MFD present and legible'
};
var PARAM_STD_MEASURED_ = 'As per spec';

// Legacy QP code -> category code, for product 2967583's control plan. Mapped by
// the physical test, verified against the dump: QP014 Fill Weight/Net Weight,
// QP015 Appearance-Surface Defects, QP018 Leak Test — all three FG params.
var QP_REPOINT_ = { QP014: 'FG_FILLWT', QP015: 'FG_APPEAR', QP018: 'FG_LEAK' };

// tol_min/tol_max pairs that cannot both be true (percent-text vs decimal).
var QP_BAD_TOL_ = ['QP014', 'QP020', 'QP021'];

function fixParamData(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Parameters');
  if (!ws) return 'MASTERS_Parameters missing.';

  var C = PARAM_COL;
  var d = ws.getDataRange().getValues();
  var out = ['MASTERS_Parameters data repair — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('rows=' + (d.length - 1) + '  cols=' + ws.getLastColumn());
  out.push('');

  // Guard: this fix is positional. Refuse to run against an unexpected header
  // rather than write into the wrong columns (the MASTERS_Materials failure mode).
  var hdr = d[0];
  if (String(hdr[C.CATEGORY]).trim() !== 'category' ||
      String(hdr[C.STD_VALUE]).trim() !== 'std_value' ||
      String(hdr[C.CODE]).trim() !== 'code') {
    return 'ABORT: header is not the expected contract (code/std_value/category ' +
           'at ' + C.CODE + '/' + C.STD_VALUE + '/' + C.CATEGORY + '). ' +
           'Run ?diag=paramheaderfix first.';
  }

  var stdWrites = [], tolWrites = [], archived = [], skipped = 0;

  for (var i = 1; i < d.length; i++) {
    var r = d[i], code = String(r[C.CODE] || '').trim();
    if (!code) continue;
    var cat = String(r[C.CATEGORY] || '').trim();
    var row = i + 1;

    if (cat === 'ARCHIVED') { skipped++; continue; }

    // ── Fix 1: std_value on categorised rows ────────────────────────────────
    if (cat) {
      var cur = String(r[C.STD_VALUE] || '').trim();
      if (cur === '' || cur === '-') {
        var want = PARAM_STD_QUALITATIVE_[code] || PARAM_STD_MEASURED_;
        stdWrites.push({ row: row, code: code, cat: cat, to: want,
                         derived: !!PARAM_STD_QUALITATIVE_[code] });
      } else skipped++;
      continue;
    }

    // ── Fix 4: archive the legacy uncategorised QP rows ──────────────────────
    archived.push({ row: row, code: code, name: String(r[C.NAME] || '') });

    // ── Fix 2: blank the contradictory tolerance pairs ───────────────────────
    if (QP_BAD_TOL_.indexOf(code) !== -1) {
      var mn = String(r[C.TOL_MIN] || '').trim(), mx = String(r[C.TOL_MAX] || '').trim();
      if (mn !== '' || mx !== '') tolWrites.push({ row: row, code: code, mn: mn, mx: mx });
    }
  }

  out.push('FIX 1 — std_value on category params: ' + stdWrites.length + ' to write');
  var derivedN = stdWrites.filter(function(x){ return x.derived; }).length;
  out.push('  from check_brief: ' + derivedN +
           '   placeholder "' + PARAM_STD_MEASURED_ + '": ' + (stdWrites.length - derivedN));
  stdWrites.slice(0, 6).forEach(function(x){
    out.push('    ' + x.code + ' [' + x.cat + '] -> "' + x.to + '"');
  });
  if (stdWrites.length > 6) out.push('    ... +' + (stdWrites.length - 6) + ' more');
  out.push('  already set, left alone: ' + skipped);
  out.push('');

  out.push('FIX 2 — contradictory tol pairs to blank: ' + tolWrites.length);
  tolWrites.forEach(function(x){
    out.push('    ' + x.code + '  min="' + x.mn + '" max="' + x.mx + '"  -> both blank');
  });
  out.push('');

  // ── Fix 3: repoint the one live control plan ───────────────────────────────
  var cf = ss.getSheetByName('CONTROL_FG');
  var planWrites = [];
  if (cf && cf.getLastRow() > 1) {
    var cd = cf.getDataRange().getValues();
    for (var j = 1; j < cd.length; j++) {
      var pc = String(cd[j][1] || '').trim();
      if (QP_REPOINT_[pc]) {
        planWrites.push({ row: j + 1, item: String(cd[j][0] || ''), from: pc,
                          to: QP_REPOINT_[pc],
                          ov: [cd[j][3], cd[j][4], cd[j][5]].filter(function(v){
                                return v !== '' && v != null; }).length });
      }
    }
  }
  out.push('FIX 3 — CONTROL_FG rows to repoint: ' + planWrites.length);
  planWrites.forEach(function(x){
    out.push('    row ' + x.row + '  ' + x.item + '  ' + x.from + ' -> ' + x.to +
             '  (overrides preserved: ' + x.ov + ')');
  });
  if (!planWrites.length) out.push('    none — already repointed or no plan uses QP codes.');
  out.push('');

  out.push('FIX 4 — legacy QP rows to archive: ' + archived.length);
  archived.slice(0, 5).forEach(function(x){ out.push('    ' + x.code + '  ' + x.name); });
  if (archived.length > 5) out.push('    ... +' + (archived.length - 5) + ' more');
  out.push('  (category -> "ARCHIVED"; rows NOT deleted, fully reversible)');
  out.push('');

  // ── CONTROL_RM ─────────────────────────────────────────────────────────────
  var rmExists = !!ss.getSheetByName('CONTROL_RM');
  out.push('CONTROL_RM: ' + (rmExists ? 'exists — no action' : 'MISSING — will create (headers only)'));
  out.push('');

  // Safety: archiving must not orphan a control-plan reference.
  var stillRef = [];
  if (cf && cf.getLastRow() > 1) {
    var cd2 = cf.getDataRange().getValues();
    var archSet = {};
    archived.forEach(function(a){ archSet[a.code] = true; });
    for (var k = 1; k < cd2.length; k++) {
      var p2 = String(cd2[k][1] || '').trim();
      if (archSet[p2] && !QP_REPOINT_[p2]) stillRef.push(cd2[k][0] + ' -> ' + p2);
    }
  }
  if (stillRef.length) {
    out.push('!! ABORT-WORTHY: ' + stillRef.length + ' control-plan rows reference a QP code');
    out.push('   with no repoint mapping. Archiving would orphan them:');
    stillRef.slice(0, 10).forEach(function(s){ out.push('     ' + s); });
    out.push('   Add these to QP_REPOINT_ before applying.');
    return out.join('\n');
  }
  out.push('Orphan check: 0 control-plan rows would break.');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES to apply.');
    return out.join('\n');
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  // Order matters: repoint the plan BEFORE archiving, so the sheet is never in a
  // state where a live plan points at an archived code.
  planWrites.forEach(function(x){ cf.getRange(x.row, 2).setValue(x.to); });
  stdWrites.forEach(function(x){ ws.getRange(x.row, C.STD_VALUE + 1).setValue(x.to); });
  tolWrites.forEach(function(x){
    ws.getRange(x.row, C.TOL_MIN + 1).setValue('');
    ws.getRange(x.row, C.TOL_MAX + 1).setValue('');
  });
  archived.forEach(function(x){ ws.getRange(x.row, C.CATEGORY + 1).setValue('ARCHIVED'); });

  if (!rmExists) {
    var rm = ss.insertSheet('CONTROL_RM');
    var rmHdr = ['item_code','param_code','enabled','std_value_override','tol_min_override','tol_max_override'];
    rm.getRange(1, 1, 1, rmHdr.length).setValues([rmHdr]);
    rm.setFrozenRows(1);
  }

  out.push('APPLIED:');
  out.push('  std_value written: ' + stdWrites.length);
  out.push('  tol pairs blanked: ' + tolWrites.length);
  out.push('  control-plan rows repointed: ' + planWrites.length);
  out.push('  rows archived: ' + archived.length);
  out.push('  CONTROL_RM: ' + (rmExists ? 'untouched' : 'created'));
  return out.join('\n');
}
