// Write the BOM sheet's own columns into a clean state. Dry run by default.
//   ?diag=bomsheetfix              → dry run
//   ?diag=bomsheetfix&confirm=YES  → apply
//
// Earlier commits fixed the READERS (getBomRows_ derives `type` from
// MASTERS_Materials.Category and `clientCode` from MASTERS_Customers, and the
// FG filter matches code-or-name case-insensitively). That made the app
// correct while leaving the SHEET messy — anyone opening BOM still saw
// LABEL/Labels/label as three values and "Dorf Ketal" where the customer master
// says "DORF KETAL". A passing audit alongside a messy sheet is exactly the
// green-but-wrong signal this session has been removing.
//
// This is the second stage that was scoped and then not done: now that no
// reader depends on col K, its stale contents can be replaced safely.
//
// TWO fixes:
//   A. col K (Type)   -> the component's MASTERS_Materials.Category
//   B. col A (Client) -> the MASTERS_Customers CODE
//
// col E (FG UoM) is deliberately NOT touched here — see the note at the bottom.

function fixBomSheet(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('BOM');
  if (!ws) return 'BOM sheet missing.';
  var d = ws.getDataRange().getValues();
  if (d.length < 2) return 'BOM is empty.';

  var out = ['BOM sheet repair — ' + (apply ? 'LIVE' : 'DRY RUN')];
  out.push('rows=' + (d.length - 1));
  out.push('');

  var hdr = d[0];
  if (String(hdr[5]).trim().toLowerCase().indexOf('component') !== 0 ||
      String(hdr[0]).trim().toLowerCase().indexOf('client') !== 0) {
    return 'ABORT: BOM header is not the expected shape (A=Client, F=Component). ' +
           'Got A="' + hdr[0] + '" F="' + hdr[5] + '".';
  }

  // Lookups, read once.
  var catByCode = {};
  var mw = ss.getSheetByName('MASTERS_Materials');
  if (mw && mw.getLastRow() > 1) {
    mw.getDataRange().getValues().slice(1).forEach(function (r) {
      var c = String(r[MAT_COL.CODE] || '').trim();
      if (c) catByCode[c] = String(r[MAT_COL.CATEGORY] || '').trim();
    });
  }
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

  var typeWrites = [], typeUnresolved = [], typeMoves = {};
  var clientWrites = [], clientUnresolved = [], clientMoves = {};

  for (var i = 1; i < d.length; i++) {
    var r = d[i];
    if (!String(r[1] || '').trim()) continue;
    var rowNo = i + 1;

    // A — Type from the component's material Category.
    var comp = String(r[5] || '').trim();
    var curType = String(r[10] || '').trim();
    if (comp) {
      var wantType = catByCode[comp];
      if (!wantType) typeUnresolved.push(comp);
      else if (wantType !== curType) {
        typeWrites.push({ row: rowNo, to: wantType });
        typeMoves[curType + ' -> ' + wantType] = (typeMoves[curType + ' -> ' + wantType] || 0) + 1;
      }
    }

    // B — Client name -> customer CODE.
    var cl = String(r[0] || '').trim();
    if (cl) {
      var wantCode = codeByAny[cl.toUpperCase()];
      if (!wantCode) clientUnresolved.push(cl);
      else if (wantCode !== cl) {
        clientWrites.push({ row: rowNo, to: wantCode });
        clientMoves[cl + ' -> ' + wantCode] = (clientMoves[cl + ' -> ' + wantCode] || 0) + 1;
      }
    }
  }

  out.push('A — col K (Type) <- MASTERS_Materials.Category: ' + typeWrites.length + ' rows');
  Object.keys(typeMoves).sort().forEach(function (k) { out.push('    ' + k + '   (' + typeMoves[k] + ')'); });
  out.push('  components not in the material master: ' + typeUnresolved.length +
           (typeUnresolved.length ? '  ' + typeUnresolved.slice(0, 5).join(', ') : ''));
  out.push('');

  out.push('B — col A (Client) <- MASTERS_Customers CODE: ' + clientWrites.length + ' rows');
  Object.keys(clientMoves).sort().forEach(function (k) { out.push('    ' + k + '   (' + clientMoves[k] + ')'); });
  out.push('  clients not in the customer master: ' + clientUnresolved.length +
           (clientUnresolved.length ? '  ' + clientUnresolved.slice(0, 5).join(', ') : ''));
  out.push('');

  // Refuse to half-apply: an unresolvable code means the lookup is wrong, and
  // writing the resolvable ones would leave the sheet in a mixed state that is
  // harder to reason about than the mess it started from.
  if (typeUnresolved.length || clientUnresolved.length) {
    out.push('ABORT-WORTHY: some codes do not resolve. Fix the masters first —');
    out.push('writing only the resolvable rows would leave BOM half-converted.');
    if (!apply) out.push('');
  }

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }
  if (typeUnresolved.length || clientUnresolved.length) {
    return out.join('\n') + '\nNOT APPLIED.';
  }

  typeWrites.forEach(function (w) { ws.getRange(w.row, 11).setValue(w.to); });
  clientWrites.forEach(function (w) { ws.getRange(w.row, 1).setValue(w.to); });

  out.push('APPLIED:');
  out.push('  col K rewritten: ' + typeWrites.length);
  out.push('  col A rewritten: ' + clientWrites.length);
  out.push('');
  out.push('getFGListByClient already matches code OR name case-insensitively,');
  out.push('so both the old name and the new code keep working for callers.');
  return out.join('\n');
}

// col E (FG UoM) — NOT FIXED, deliberately. It holds container FORMATS
// (CON/Bottles/Sachet/Pouch/Can), not units, so it looks like the same class of
// problem as col I. It is not:
//
//   1. Every FG's unit in MASTERS_Materials is KG, while col E says "Bottles".
//      Those disagree on MEANING, not spelling. Normalising col E to NOS would
//      invent a third answer; copying the master's KG would label a case of 120
//      bottles as kilograms. Neither is defensible without knowing what the
//      business counts FG in.
//   2. Unlike compUom and type, fgUom is NOT display-only — Production.js:854
//      writes it into PROD_JOBS, so past jobs are already stamped with these
//      values. Changing the vocabulary now splits history across two spellings.
//
// Needs a decision: is an FG counted in cases, bottles, or kg? Once answered,
// the fix is mechanical and belongs here.
