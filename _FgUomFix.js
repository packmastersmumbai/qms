// FG unit of measure -> NOS, across every sheet that carries it.
//   ?diag=fguomfix              → dry run
//   ?diag=fguomfix&confirm=YES  → apply
//
// DECISION (from the owner): a finished good is counted in NOS.
//
// BOM col E held container FORMATS, not units: CON(79) Bottles(79) Sachet(19)
// Pouch(12) Can(6). That is a pack description ("this FG ships as bottles"),
// which is not the same question as "what do I count it in".
//
// WHY THIS IS NOT A SINGLE-SHEET FIX
// Unlike compUom and type — display-only, so rewriting BOM was enough — fgUom
// is PERSISTED downstream:
//   BOM col E  -> getBomRows_ (Production.js:613)
//              -> PROD_JOBS col G   (Production.js:854, on job create)
//              -> PROD_BOOK col H   (Production.js:1280, on booking)
// Fixing BOM alone would leave 9 existing jobs reading CON/Sachet while every
// new one reads NOS — the same value split across two vocabularies, which is
// worse than one consistent wrong vocabulary because reports would silently
// group them apart.
//
// So all three are rewritten together, in one confirm.
//
// MASTERS_Materials is deliberately NOT touched: FG materials there carry KG,
// which is the WEIGHT unit and a separate fact from the count unit. Overwriting
// it would destroy information rather than normalise it. That disagreement is
// real and stays visible in ?diag=vocabaudit's 13-row baseline.

var FG_UOM_TARGET_ = 'NOS';
// Everything in BOM col E is a container format, so every value maps to NOS.
// Listed explicitly rather than blanket-replacing: an unrecognised value must
// be REPORTED, not silently overwritten.
var FG_UOM_FORMATS_ = ['CON', 'CONS', 'BOTTLES', 'BOTTLE', 'SACHET', 'POUCH',
                       'CAN', 'CANS', 'JAR', 'TUBE', 'NOS', "NO'S", 'PC', 'PCS'];

function fixFgUom(apply) {
  var ss = getSpreadsheet();
  var out = ['FG UoM -> ' + FG_UOM_TARGET_ + ' — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('');

  var known = {};
  FG_UOM_FORMATS_.forEach(function (f) { known[f] = true; });

  var plans = [], unknown = [];

  // Each target: sheet, 0-based column, and a label for the report.
  // Indices verified against the header constants, not inferred from the
  // appendRow order: PROD_JOBS_HEADERS_ (Production.js:528) puts 'UoM' at 6,
  // PROD_BOOKING_HEADERS_ (:533) puts 'FG UoM' at 7. The booking sheet is named
  // PROD_BOOKING_LOG (:543) — 'PROD_BOOK' would have silently matched nothing
  // and reported success with that sheet untouched.
  var TARGETS = [
    { sheet: 'BOM',              col: 4, label: 'col E (FG UoM)' },
    { sheet: 'PROD_JOBS',        col: 6, label: 'col G (UoM)' },
    { sheet: 'PROD_BOOKING_LOG', col: 7, label: 'col H (FG UoM)' }
  ];

  TARGETS.forEach(function (t) {
    var ws = ss.getSheetByName(t.sheet);
    if (!ws || ws.getLastRow() < 2) {
      out.push(t.sheet + ': absent or empty — skipped');
      return;
    }
    var d = ws.getDataRange().getValues();
    var writes = [], moves = {};
    for (var i = 1; i < d.length; i++) {
      // BOM rows are keyed by FG code in col B; log sheets by their own col A.
      var keyed = (t.sheet === 'BOM') ? String(d[i][1] || '').trim()
                                      : String(d[i][0] || '').trim();
      if (!keyed) continue;
      var cur = String(d[i][t.col] || '').trim();
      if (!cur) continue;
      if (!known[cur.toUpperCase()]) {
        unknown.push(t.sheet + ' row ' + (i + 1) + ' "' + cur + '"');
        continue;
      }
      if (cur !== FG_UOM_TARGET_) {
        writes.push({ row: i + 1, from: cur });
        moves[cur] = (moves[cur] || 0) + 1;
      }
    }
    plans.push({ ws: ws, target: t, writes: writes });
    out.push(t.sheet + ' ' + t.label + ': ' + writes.length + ' rows');
    Object.keys(moves).sort().forEach(function (k) {
      out.push('    ' + k + ' -> ' + FG_UOM_TARGET_ + '   (' + moves[k] + ')');
    });
  });

  out.push('');
  out.push('unrecognised values (LEFT ALONE): ' + unknown.length);
  unknown.slice(0, 10).forEach(function (u) { out.push('     ?  ' + u); });
  if (unknown.length) {
    out.push('  A value not in FG_UOM_FORMATS_ is not necessarily a container');
    out.push('  format. It is reported rather than overwritten.');
  }
  out.push('');
  out.push('MASTERS_Materials NOT touched: FG rows carry KG, which is the WEIGHT');
  out.push('unit — a different fact from the count unit, not a stale spelling.');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  var total = 0;
  plans.forEach(function (p) {
    p.writes.forEach(function (w) {
      p.ws.getRange(w.row, p.target.col + 1).setValue(FG_UOM_TARGET_);
      total++;
    });
  });

  out.push('APPLIED: ' + total + ' cells set to ' + FG_UOM_TARGET_ + '.');
  out.push('BOM, PROD_JOBS and PROD_BOOK now share one FG unit vocabulary, so');
  out.push('existing jobs and new ones group together in reports.');
  return out.join('\n');
}
