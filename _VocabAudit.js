// READ-ONLY cross-sheet vocabulary audit. Writes nothing. ?diag=vocabaudit
//
// The question this answers: BOM, MASTERS_Customers and MASTERS_Materials each
// carry their OWN spelling of the same concepts (unit, customer/client, type,
// category). Where those spellings disagree, a join silently drops rows or a
// grouped report undercounts — and nothing errors.
//
// Reports the vocabularies side by side and, more importantly, the JOIN health
// between them, because a tidy-looking list per sheet can still fail to match.
function auditVocabularies() {
  var ss = getSpreadsheet();
  var out = ['CROSS-SHEET VOCABULARY AUDIT — read-only'];
  out.push('');

  function tally(o) {
    return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; })
      .map(function (k) { return k + '(' + o[k] + ')'; }).join('  ');
  }
  function count(map, v) {
    var k = String(v == null ? '' : v).trim() || '(blank)';
    map[k] = (map[k] || 0) + 1;
  }

  // ── MASTERS_Materials ──────────────────────────────────────────────────────
  var mw = ss.getSheetByName('MASTERS_Materials');
  var matUnit = {}, matCat = {}, matInsp = {}, matByCode = {}, matDescByCode = {};
  if (mw && mw.getLastRow() > 1) {
    mw.getDataRange().getValues().slice(1).forEach(function (r) {
      var code = String(r[MAT_COL.CODE] || '').trim();
      if (!code) return;
      matByCode[code] = String(r[MAT_COL.UNIT] || '').trim();
      matDescByCode[code] = String(r[MAT_COL.DESC] || '').trim();
      count(matUnit, r[MAT_COL.UNIT]);
      count(matCat,  r[MAT_COL.CATEGORY]);
      count(matInsp, r[MAT_COL.INSP_CATEGORY]);
    });
  }
  out.push('── MASTERS_Materials ──');
  out.push('  Unit:               ' + tally(matUnit));
  out.push('  Category (D):       ' + tally(matCat));
  out.push('  InspCategory (M):   ' + tally(matInsp));
  out.push('');

  // ── BOM ────────────────────────────────────────────────────────────────────
  // Header (from ?diag=dropdiag): Client | FGIDH | Material Description |
  // Base Quantity | UoM | Component | Mat Desc Component | Quantity (STPO) |
  // Comp UoM | Consum | Type | masterP
  var bw = ss.getSheetByName('BOM');
  var bomClient = {}, bomUom = {}, bomCompUom = {}, bomType = {}, bomConsum = {};
  var uomMismatch = [], fgCodes = {}, compCodes = {};
  if (bw && bw.getLastRow() > 1) {
    bw.getDataRange().getValues().slice(1).forEach(function (r) {
      if (!String(r[1] || '').trim()) return;
      count(bomClient,  r[0]);
      count(bomUom,     r[4]);
      count(bomCompUom, r[8]);
      count(bomType,    r[10]);
      count(bomConsum,  r[9]);
      var fg = String(r[1] || '').trim(), comp = String(r[5] || '').trim();
      if (fg) fgCodes[fg] = true;
      if (comp) compCodes[comp] = true;
      // Does the BOM's component UoM agree with the material master's Unit?
      var cu = String(r[8] || '').trim().toUpperCase();
      if (comp && cu && matByCode[comp] !== undefined) {
        var mu = String(matByCode[comp] || '').trim().toUpperCase();
        if (mu && cu !== mu) {
          uomMismatch.push(comp + '  BOM="' + String(r[8]).trim() + '"  master="' + matByCode[comp] + '"');
        }
      }
    });
  }
  out.push('── BOM ──');
  out.push('  Client:             ' + tally(bomClient));
  out.push('  UoM (FG, col E):    ' + tally(bomUom));
  out.push('  Comp UoM (col I):   ' + tally(bomCompUom));
  out.push('  Type (col K):       ' + tally(bomType));
  out.push('  Consum (col J):     ' + tally(bomConsum));
  out.push('');

  // ── MASTERS_Customers ──────────────────────────────────────────────────────
  var cw = ss.getSheetByName('MASTERS_Customers');
  var custNames = [], custCodes = [];
  if (cw && cw.getLastRow() > 1) {
    var chdr = cw.getRange(1, 1, 1, cw.getLastColumn()).getValues()[0];
    out.push('── MASTERS_Customers ──');
    out.push('  header: ' + chdr.map(function (h, i) { return i + ':' + (h || '(blank)'); }).join(' | '));
    cw.getDataRange().getValues().slice(1).forEach(function (r) {
      var code = String(r[0] || '').trim(), name = String(r[1] || '').trim();
      if (code) custCodes.push(code);
      if (name) custNames.push(name);
    });
    out.push('  rows: ' + custCodes.length);
    out.push('  codes: ' + custCodes.join(', '));
    out.push('  names: ' + custNames.join(' | '));
  } else out.push('── MASTERS_Customers: MISSING/EMPTY ──');
  out.push('');

  // ── THE JOINS (where uniformity actually matters) ──────────────────────────
  out.push('── JOIN HEALTH ──');

  // BOM.Client -> MASTERS_Customers. Is it a code, a name, or free text?
  var byCode = 0, byName = 0, unmatched = [];
  var codeSet = {}, nameSet = {};
  custCodes.forEach(function (c) { codeSet[c.toUpperCase()] = true; });
  custNames.forEach(function (n) { nameSet[n.toUpperCase()] = true; });
  Object.keys(bomClient).forEach(function (cl) {
    if (cl === '(blank)') return;
    var u = cl.toUpperCase();
    if (codeSet[u]) byCode++;
    else if (nameSet[u]) byName++;
    else unmatched.push(cl);
  });
  out.push('  BOM.Client vs MASTERS_Customers:');
  out.push('    matches a customer CODE: ' + byCode);
  out.push('    matches a customer NAME: ' + byName);
  out.push('    matches NEITHER:         ' + unmatched.length +
           (unmatched.length ? '   ' + unmatched.slice(0, 10).join(' | ') : ''));

  // BOM component UoM vs material master Unit.
  out.push('');
  out.push('  BOM Comp UoM vs MASTERS_Materials Unit:');
  out.push('    DISAGREEMENTS: ' + uomMismatch.length);
  uomMismatch.slice(0, 12).forEach(function (m) { out.push('      !! ' + m); });

  // BOM codes that do not resolve to a material.
  var badFg = Object.keys(fgCodes).filter(function (c) { return matByCode[c] === undefined; });
  var badComp = Object.keys(compCodes).filter(function (c) { return matByCode[c] === undefined; });
  out.push('');
  out.push('  BOM code resolution:');
  out.push('    FG codes not in MASTERS_Materials:        ' + badFg.length +
           (badFg.length ? '  ' + badFg.slice(0, 6).join(', ') : ''));
  out.push('    Component codes not in MASTERS_Materials: ' + badComp.length +
           (badComp.length ? '  ' + badComp.slice(0, 6).join(', ') : ''));

  // Which Category values does the InspCategory duplicate? This is the user's
  // question: can col M be derived from col D instead of stored separately?
  out.push('');
  out.push('── Category (D) -> InspCategory (M) mapping ──');
  var pairs = {};
  if (mw && mw.getLastRow() > 1) {
    mw.getDataRange().getValues().slice(1).forEach(function (r) {
      if (!String(r[MAT_COL.CODE] || '').trim()) return;
      var d = String(r[MAT_COL.CATEGORY] || '').trim() || '(blank)';
      var m = String(r[MAT_COL.INSP_CATEGORY] || '').trim() || '(blank)';
      pairs[d] = pairs[d] || {};
      pairs[d][m] = (pairs[d][m] || 0) + 1;
    });
  }
  var ambiguous = 0;
  Object.keys(pairs).sort().forEach(function (d) {
    var ms = Object.keys(pairs[d]);
    var line = '  ' + d + '  ->  ' + ms.map(function (m) { return m + '(' + pairs[d][m] + ')'; }).join(' , ');
    if (ms.length > 1) { line += '   <-- AMBIGUOUS'; ambiguous++; }
    out.push(line);
  });
  out.push('');
  out.push('  Category values mapping to MORE THAN ONE InspCategory: ' + ambiguous);
  out.push('  (0 would mean col M is fully derivable from col D and could be dropped)');

  return out.join('\n');
}
