// Repair what the NEW BOM rows (148 added 2026-08-04) got wrong, and report
// precisely what cannot be repaired without a human.
//   ?diag=ketofix              → dry run
//   ?diag=ketofix&confirm=YES  → apply
//
// WHAT ?diag=vocabaudit CAUGHT (first run after the rows were added):
//   FAIL 148 rows whose Client does not resolve  (KETO 125, NICHEM SOLUTION 23)
//   FAIL 127 rows whose component does not resolve to a material Category
//   FAIL  25 FG codes + 26 component codes not in MASTERS_Materials
//   FAIL  UoM disagreements 13 -> 36  ("No's" is back in col I)
//   plus col K reverted to mixed values (TAPE/TAPE-FLAT, LABELS/LABELS-FLAT)
//
// TWO DIFFERENT PROBLEMS, and only one is mine to fix.
//
// FIXABLE — spelling and vocabulary:
//   A. Client "NICHEM SOLUTION" -> the customer master's code NS. The master
//      says "NICHEM SOLUTIONS" (plural); the BOM rows are singular, so the join
//      misses by one character.
//   B. Comp UoM "No's" -> NOS, and the rest of the canonical map, exactly as
//      ?diag=bomvocabfix already did for the older rows.
//
// NOT FIXABLE BY SCRIPT — structurally incomplete rows:
//   C. The 25 KETO FG codes (2233-0001 "Pharmsil 1000ML" etc.) do not exist in
//      MASTERS_Materials at all.
//   D. Every KETO row has col F (Component) set to the FG's OWN code, with the
//      real component identity written only as a WORD in col G — "BULK",
//      "BOTTLES", "LABELS", "CARTON", "TAPE". Example, FG 2233-0001:
//        comp=2233-0001  compDesc=BULK     qty=10.5 KG
//        comp=2233-0001  compDesc=BOTTLES  qty=10   No's
//      A component code cannot be derived from the word "BOTTLES" — there are
//      seven bottle materials in the master. Inventing one would silently point
//      production at the wrong stock, so these are REPORTED, not guessed.
//
// Client KETO is likewise left alone: it matches no customer code or name, and
// creating a customer master row is an owner decision, not a cleanup.

var KETO_CLIENT_FIX_ = { 'NICHEM SOLUTION': 'NS', 'NICHEM SOLUTIONS': 'NS' };

function fixKetoBom(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('BOM');
  if (!ws) return 'BOM sheet missing.';
  var d = ws.getDataRange().getValues();
  if (d.length < 2) return 'BOM is empty.';

  var out = ['New-BOM-rows repair — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('rows=' + (d.length - 1));
  out.push('');

  var hdr = d[0];
  if (String(hdr[0]).trim().toLowerCase().indexOf('client') !== 0 ||
      String(hdr[5]).trim().toLowerCase().indexOf('component') !== 0) {
    return 'ABORT: BOM header is not the expected shape.';
  }

  // Material master: code -> category, for the col K rewrite.
  var catByCode = {};
  var mw = ss.getSheetByName('MASTERS_Materials');
  if (mw && mw.getLastRow() > 1) {
    mw.getDataRange().getValues().slice(1).forEach(function (r) {
      var c = String(r[MAT_COL.CODE] || '').trim();
      if (c) catByCode[c] = String(r[MAT_COL.CATEGORY] || '').trim();
    });
  }
  // Customer master: name/code (upper) -> code.
  var codeByAny = {};
  var cw = ss.getSheetByName('MASTERS_Customers');
  if (cw && cw.getLastRow() > 1) {
    cw.getDataRange().getValues().slice(1).forEach(function (r) {
      var code = String(r[0] || '').trim(), name = String(r[1] || '').trim();
      if (!code) return;
      codeByAny[code.toUpperCase()] = code;
      if (name) codeByAny[name.toUpperCase()] = code;
    });
  }

  var clientW = [], uomW = [], typeW = [], selfRef = [], unknownClient = {}, uomMoves = {}, clientMoves = {};

  for (var i = 1; i < d.length; i++) {
    var r = d[i], rowNo = i + 1;
    var fg = String(r[1] || '').trim();
    if (!fg) continue;

    // A — client
    var cl = String(r[0] || '').trim();
    if (cl) {
      var want = codeByAny[cl.toUpperCase()] || KETO_CLIENT_FIX_[cl.toUpperCase()];
      if (want && want !== cl) {
        clientW.push({ row: rowNo, to: want });
        clientMoves[cl + ' -> ' + want] = (clientMoves[cl + ' -> ' + want] || 0) + 1;
      } else if (!want) {
        unknownClient[cl] = (unknownClient[cl] || 0) + 1;
      }
    }

    // B — comp UoM
    var raw = String(r[8] || '').trim();
    if (raw) {
      var canon = (typeof BOM_UOM_CANON_ !== 'undefined') ? BOM_UOM_CANON_[raw.toUpperCase()] : null;
      if (canon && canon !== raw) {
        uomW.push({ row: rowNo, to: canon });
        uomMoves[raw + ' -> ' + canon] = (uomMoves[raw + ' -> ' + canon] || 0) + 1;
      }
    }

    // C/D — self-referencing component rows.
    var comp = String(r[5] || '').trim();
    if (comp && comp === fg) {
      selfRef.push({ row: rowNo, fg: fg, word: String(r[6] || '').trim() });
      continue;               // its col K cannot be derived either
    }

    // col K from the master, where the component actually resolves.
    if (comp && catByCode[comp] && catByCode[comp] !== String(r[10] || '').trim()) {
      typeW.push({ row: rowNo, to: catByCode[comp] });
    }
  }

  out.push('A — Client -> customer CODE: ' + clientW.length + ' rows');
  Object.keys(clientMoves).sort().forEach(function (k) { out.push('    ' + k + '   (' + clientMoves[k] + ')'); });
  out.push('  clients matching NO customer (LEFT ALONE): ' +
           Object.keys(unknownClient).map(function (k) { return k + '(' + unknownClient[k] + ')'; }).join(', ') || '  none');
  out.push('');

  out.push('B — Comp UoM -> canonical: ' + uomW.length + ' rows');
  Object.keys(uomMoves).sort().forEach(function (k) { out.push('    ' + k + '   (' + uomMoves[k] + ')'); });
  out.push('');

  out.push('C — col K <- master Category (resolvable rows only): ' + typeW.length + ' rows');
  out.push('');

  out.push('D — SELF-REFERENCING rows (component = its own FG): ' + selfRef.length);
  var byWord = {};
  selfRef.forEach(function (s) { byWord[s.word || '(blank)'] = (byWord[s.word || '(blank)'] || 0) + 1; });
  Object.keys(byWord).sort().forEach(function (k) { out.push('    compDesc "' + k + '"  (' + byWord[k] + ' rows)'); });
  out.push('  NOT FIXABLE BY SCRIPT. Col F holds the FG code instead of the');
  out.push('  component item code; the real component is only a WORD in col G.');
  out.push('  "BOTTLES" cannot be resolved to one of seven bottle materials —');
  out.push('  guessing would point production at the wrong stock.');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  clientW.forEach(function (w) { ws.getRange(w.row, 1).setValue(w.to); });
  uomW.forEach(function (w) { ws.getRange(w.row, 9).setValue(w.to); });
  typeW.forEach(function (w) { ws.getRange(w.row, 11).setValue(w.to); });

  out.push('APPLIED: client ' + clientW.length + ', uom ' + uomW.length + ', type ' + typeW.length + '.');
  out.push('STILL FAILING by design: ' + selfRef.length + ' self-referencing rows and');
  out.push('client KETO — both need owner input, and vocabaudit will keep saying so.');
  return out.join('\n');
}
