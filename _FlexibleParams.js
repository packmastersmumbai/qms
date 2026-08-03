/**
 * _FlexibleParams.js — inspection parameters for flexible packaging + misc components.
 *
 *   ?diag=flexparams               DRY RUN (writes nothing)
 *   ?diag=flexparams&confirm=YES   append the missing rows
 *
 * Adds four categories that had none, covering the 11 materials still uncategorised
 * after the FG exclusion:
 *   POUCH     (4)  spouted stand-up pouches for Milex/MPH automotive fluids
 *   SACHET    (4)  5-10 ml multi-layer laminate sachets
 *   FILM      (0)  laminates / rolls / thermal ribbon — no material uses it YET, but
 *                  RIBBON currently resolves to LABEL, which is a poor fit (LABEL
 *                  measures adhesion + barcode; ribbon is a printing consumable).
 *                  Seeded so ribbons/laminate rollstock can be moved here.
 *   RUBBER    (1)  elastic band used to unitise sachets
 *
 * Design notes:
 *  - Follows the existing convention exactly: 2-letter prefix, method_type drawn from
 *    Gravimetric | Dimensional | Mechanical | Visual | Instrumental | Functional,
 *    check_brief written as an instruction to the operator, doc_ref PM/FRM/IQC-02.
 *  - CCP flags are deliberate, not decorative. These pouches and sachets hold
 *    automotive fluids: a seal or leak failure is a product-safety and contamination
 *    event, so PO_SEAL / PO_LEAK / SA_SEAL / SA_LEAK are CCPs. Cosmetic checks
 *    (print, colour) are not.
 *  - std/tol are left blank exactly like the five existing categories: the DICTIONARY
 *    defines WHAT to measure; per-product limits come from CONTROL_FG overrides.
 *  - Idempotent: appends only codes that are not already present.
 */

// code, name, unit, method, check_brief, tools, doc_ref, category, ccp, sort
var FLEX_PARAM_ROWS_ = [
  // ── POUCH — spouted stand-up pouches ────────────────────────────────
  ['PO_DIM',    'Dimensions (W x H)',   'mm',      'Dimensional', 'Measure lay-flat width and height vs artwork spec.',                 'Steel rule / vernier',  'PM/FRM/IQC-02', 'POUCH', 'N', 1],
  ['PO_THICK',  'Laminate Thickness',   'micron',  'Dimensional', 'Measure total laminate thickness at 4 points; record the minimum.',  'Dial thickness gauge',  'PM/FRM/IQC-02', 'POUCH', 'N', 2],
  ['PO_GSM',    'Substrate GSM',        'gsm',     'Gravimetric', 'Cut a known area, weigh, compute grams per square metre.',           'GSM cutter + balance',  'PM/FRM/IQC-02', 'POUCH', 'N', 3],
  ['PO_SEAL',   'Seal Strength',        'N/15mm',  'Mechanical',  'Cut a 15 mm strip across the seal; peel at 180 deg; record force.',  'Tensile / peel tester', 'PM/FRM/IQC-02', 'POUCH', 'Y', 4],
  ['PO_LEAK',   'Leak / Burst Test',    '',        'Functional',  'Fill and pressurise or vacuum-immerse; watch for bubbles or seepage.','Leak tester / vacuum',  'PM/FRM/IQC-02', 'POUCH', 'Y', 5],
  ['PO_SPOUT',  'Spout Fitment & Torque','Nm',     'Functional',  'Check spout weld for gaps; open/close the cap and record torque.',   'Torque meter',          'PM/FRM/IQC-02', 'POUCH', 'Y', 6],
  ['PO_GUSSET', 'Bottom Gusset / Stand','',        'Visual',      'Fill to nominal; the pouch must stand unaided without leaning.',     'Flat bench',            'PM/FRM/IQC-02', 'POUCH', 'N', 7],
  ['PO_PRINT',  'Print Quality',        '',        'Visual',      'Check registration, smudge and missing text against the proof.',     'Loupe / proof',         'PM/FRM/IQC-02', 'POUCH', 'N', 8],
  ['PO_DELAM',  'Delamination',         '',        'Visual',      'Inspect for layer separation, tunnelling or trapped air.',           'Light box',             'PM/FRM/IQC-02', 'POUCH', 'Y', 9],

  // ── SACHET — small multi-layer laminate sachets ─────────────────────
  ['SA_DIM',    'Dimensions (W x H)',   'mm',      'Dimensional', 'Measure sachet width and height vs pack size spec.',                 'Steel rule / vernier',  'PM/FRM/IQC-02', 'SACHET', 'N', 1],
  ['SA_THICK',  'Laminate Thickness',   'micron',  'Dimensional', 'Measure total laminate thickness at 4 points; record the minimum.',  'Dial thickness gauge',  'PM/FRM/IQC-02', 'SACHET', 'N', 2],
  ['SA_SEAL',   'Seal Strength',        'N/15mm',  'Mechanical',  'Peel a 15 mm strip across each seal edge; record the lowest force.', 'Tensile / peel tester', 'PM/FRM/IQC-02', 'SACHET', 'Y', 3],
  ['SA_LEAK',   'Leak Test',            '',        'Functional',  'Vacuum-immerse or squeeze-test a filled sachet; no seepage allowed.','Vacuum leak tester',    'PM/FRM/IQC-02', 'SACHET', 'Y', 4],
  ['SA_FILL',   'Fill Volume / Weight', 'ml',      'Gravimetric', 'Weigh or decant contents; compare against declared fill.',           'Balance 0.01 g',        'PM/FRM/IQC-02', 'SACHET', 'Y', 5],
  ['SA_NOTCH',  'Tear Notch / Openability','',     'Functional',  'Tear at the notch by hand; must open cleanly without tools.',        '-',                     'PM/FRM/IQC-02', 'SACHET', 'N', 6],
  ['SA_PRINT',  'Print & Batch Coding', '',        'Visual',      'Verify artwork, MRP, batch number and MFD are present and legible.', 'Loupe / proof',         'PM/FRM/IQC-02', 'SACHET', 'Y', 7],
  ['SA_DELAM',  'Delamination',         '',        'Visual',      'Inspect for layer separation, tunnelling or trapped air.',           'Light box',             'PM/FRM/IQC-02', 'SACHET', 'N', 8],

  // ── FILM — laminate rollstock, wrap, thermal transfer ribbon ────────
  ['FM_THICK',  'Thickness',            'micron',  'Dimensional', 'Measure film thickness across the web at 5 points.',                 'Dial thickness gauge',  'PM/FRM/IQC-02', 'FILM', 'N', 1],
  ['FM_WIDTH',  'Reel Width',           'mm',      'Dimensional', 'Measure the wound reel width vs spec.',                              'Steel rule',            'PM/FRM/IQC-02', 'FILM', 'N', 2],
  ['FM_GSM',    'GSM / Yield',          'gsm',     'Gravimetric', 'Cut a known area, weigh, compute grams per square metre.',           'GSM cutter + balance',  'PM/FRM/IQC-02', 'FILM', 'N', 3],
  ['FM_COF',    'Coefficient of Friction','',      'Instrumental','Run a COF sled over the film; record static and kinetic values.',    'COF tester',            'PM/FRM/IQC-02', 'FILM', 'N', 4],
  ['FM_TENSILE','Tensile / Elongation', 'N',       'Mechanical',  'Pull a strip to break; record peak force and elongation.',           'Tensile tester',        'PM/FRM/IQC-02', 'FILM', 'N', 5],
  ['FM_PRINT',  'Print / Ribbon Density','',       'Visual',      'Print a test swatch; check density, smudge and edge sharpness.',     'Loupe / test print',    'PM/FRM/IQC-02', 'FILM', 'N', 6],
  ['FM_CORE',   'Core ID & Winding',    'mm',      'Dimensional', 'Measure core inner diameter; check for telescoping or loose winds.', 'Vernier caliper',       'PM/FRM/IQC-02', 'FILM', 'N', 7],

  // ── FG — finished goods (filled, capped, labelled, cartoned) ────────
  // Derived from what CONTROL_FG ALREADY enables in practice for real products
  // (QP014 fill weight with 440/450/460 overrides, QP015 appearance, QP018 leak),
  // extended with the packing-line CCPs the legacy set already defines: label
  // presence, MRP/batch/MFD legibility, cap fitment and induction seal.
  // These are IPQC-time checks on the packed unit, NOT incoming-material checks —
  // which is why FG could not simply borrow BULK (MFI and Granule Size are raw-resin
  // measurements and meaningless on a finished adhesive).
  ['FG_FILLWT',  'Fill Weight / Net Weight', 'g',  'Gravimetric', 'Weigh a filled unit; compare against declared fill weight.',        'Balance 0.01 g',      'PM/FRM/IQC-02', 'FG', 'Y', 1],
  ['FG_APPEAR',  'Appearance / Surface',     '',   'Visual',      'Inspect for dents, scuffs, contamination and fill level.',          'Light box',           'PM/FRM/IQC-02', 'FG', 'N', 2],
  ['FG_LEAK',    'Leak Test',                '',   'Functional',  'Invert or pressurise a filled unit; no seepage at cap or seam.',    'Leak tester',         'PM/FRM/IQC-02', 'FG', 'Y', 3],
  ['FG_CAPFIT',  'Cap Fitment',              '',   'Functional',  'Check cap seats fully and torques to spec; no cross-threading.',    'Torque meter',        'PM/FRM/IQC-02', 'FG', 'Y', 4],
  ['FG_SEAL',    'Induction Seal',           '',   'Functional',  'Peel the liner; seal must be continuous with no channels.',         '-',                   'PM/FRM/IQC-02', 'FG', 'Y', 5],
  ['FG_LABEL',   'Label Presence & Position','mm', 'Visual',      'Verify correct label, squareness and placement vs artwork spec.',   'Steel rule / proof',  'PM/FRM/IQC-02', 'FG', 'Y', 6],
  ['FG_CODING',  'MRP / Batch / MFD Coding', '',   'Visual',      'Verify MRP, batch number and MFD are present, correct and legible.','Loupe',               'PM/FRM/IQC-02', 'FG', 'Y', 7],
  ['FG_CARTON',  'Carton Pack & Count',      'pcs','Count',       'Count units per carton; check carton print and sealing.',           '-',                   'PM/FRM/IQC-02', 'FG', 'N', 8],

  // ── RUBBER — elastic bands / rubber components ──────────────────────
  ['RB_DIM',    'Dimensions (L x W)',   'mm',      'Dimensional', 'Measure relaxed length and cut width vs spec.',                      'Steel rule / vernier',  'PM/FRM/IQC-02', 'RUBBER', 'N', 1],
  ['RB_THICK',  'Thickness',            'mm',      'Dimensional', 'Measure band thickness at 3 points.',                                'Dial thickness gauge',  'PM/FRM/IQC-02', 'RUBBER', 'N', 2],
  ['RB_ELONG',  'Elongation at Break',  '%',       'Mechanical',  'Stretch to break; record elongation as a percentage of original.',   'Tensile tester',        'PM/FRM/IQC-02', 'RUBBER', 'Y', 3],
  ['RB_RETRACT','Retraction / Set',     '%',       'Mechanical',  'Hold stretched 1 min, release, measure permanent set after 1 min.',  'Steel rule / timer',    'PM/FRM/IQC-02', 'RUBBER', 'N', 4],
  ['RB_AGE',    'Ageing / Perish',      '',        'Visual',      'Inspect for cracking, stickiness or brittleness; check stock age.',  'Light box',             'PM/FRM/IQC-02', 'RUBBER', 'N', 5]
];

function seedFlexibleParams(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Parameters');
  if (!ws) return 'MASTERS_Parameters missing';

  var C = (typeof PARAM_COL !== 'undefined') ? PARAM_COL : null;
  if (!C) return 'PARAM_COL contract missing (Masters.js not loaded)';

  var lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();
  var existing = {};
  if (lastRow > 1) {
    ws.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r) {
      var c = String(r[0] || '').trim(); if (c) existing[c] = 1;
    });
  }

  var L = ['Flexible / misc inspection parameters — ' + (apply ? 'LIVE' : 'DRY RUN')];
  L.push('MASTERS_Parameters: ' + (lastRow - 1) + ' rows x ' + lastCol + ' cols');
  L.push('');

  var toAdd = FLEX_PARAM_ROWS_.filter(function (r) { return !existing[r[0]]; });
  var skip = FLEX_PARAM_ROWS_.length - toAdd.length;

  var byCat = {};
  toAdd.forEach(function (r) { byCat[r[7]] = (byCat[r[7]] || 0) + 1; });
  Object.keys(byCat).sort().forEach(function (c) {
    L.push('  ' + c + '  +' + byCat[c]);
    toAdd.filter(function (r) { return r[7] === c; }).forEach(function (r) {
      L.push('     ' + r[0] + '  ' + r[1] + (r[8] === 'Y' ? '   [CCP]' : ''));
    });
  });
  if (skip) L.push('');
  if (skip) L.push('  already present, skipped: ' + skip);

  if (!toAdd.length) { L.push(''); L.push('Nothing to add — all codes already exist.'); return L.join('\n'); }

  if (!apply) {
    L.push('');
    L.push('DRY RUN — nothing written. Re-run with &confirm=YES to apply.');
    return L.join('\n');
  }

  // Build rows positioned by the PARAM_COL contract rather than by literal order,
  // so a future column move cannot silently shift what gets written.
  var width = Math.max(lastCol, C.SORT + 1);
  var out = toAdd.map(function (r) {
    var row = new Array(width).fill('');
    row[C.CODE] = r[0]; row[C.NAME] = r[1]; row[C.UNIT] = r[2];
    row[C.METHOD_TYPE] = r[3]; row[C.CHECK_BRIEF] = r[4]; row[C.TOOLS] = r[5];
    row[C.DOC_REF] = r[6]; row[C.CATEGORY] = r[7]; row[C.CCP] = r[8]; row[C.SORT] = r[9];
    return row;
  });
  ws.getRange(lastRow + 1, 1, out.length, width).setValues(out);
  SpreadsheetApp.flush();

  L.push('');
  L.push('APPLIED: ' + out.length + ' parameters appended. 0 existing rows modified.');
  return L.join('\n');
}
