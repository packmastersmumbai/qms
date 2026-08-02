/**
 * _InspCatProposal.js — READ-ONLY. Proposes an inspectionCategory for every material.
 * Writes NOTHING. ?diag=inspcatproposal
 *
 * The 31 category-specific IQC/IPQC params are unreachable because col 12
 * (MAT_COL.INSP_CATEGORY) is blank on all 180 materials. This shows what the
 * mapping WOULD be, derived from the existing populated Category column plus
 * the item description, so the mapping can be reviewed before anything is written.
 */

// The five categories that actually have parameters defined in MASTERS_Parameters.
var INSP_CATS_ = ['HDPE_BOTTLE', 'LABEL', 'PAPER', 'CARTON', 'BULK'];

// Description keywords -> inspection category. Ordered: first match wins, so the
// most specific patterns must come first.
var INSP_RULES_ = [
  ['HDPE_BOTTLE', /\b(hdpe|bottle|jar|container|canister|drum|pet\b|preform|closure|cap\b|lid\b)/i],
  ['LABEL',       /\b(label|sticker|sleeve|shrink|wrap[- ]?around|bopp|decal)/i],
  ['CARTON',      /\b(carton|corrugat|box|shipper|master case|rsc\b|fluted)/i],
  ['PAPER',       /\b(paper|kraft|liner|board|duplex|insert|leaflet|manual|booklet)/i],
  ['BULK',        /\b(powder|granule|resin|adhesive|glue|ink|solvent|chemical|compound|masterbatch|kg\b|litre|liter)/i],
];

function proposeInspectionCategories() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials missing';

  var lr = ws.getLastRow(), lc = ws.getLastColumn();
  var hdr = ws.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var data = ws.getRange(2, 1, lr - 1, lc).getValues();

  var CODE = 0, DESC = 1, CATEGORY = 3, INSP = 12;

  var L = [];
  L.push('=== inspectionCategory PROPOSAL (READ-ONLY — nothing written) ===');
  L.push('sheet: ' + lr + ' rows x ' + lc + ' cols');
  L.push('header[' + INSP + '] = "' + (hdr[INSP] || '(blank)') + '"   <- target column');
  L.push('header[' + CATEGORY + '] = "' + (hdr[CATEGORY] || '(blank)') + '"   <- existing populated column');
  L.push('');

  // What does the existing Category column already contain?
  var existing = {};
  data.forEach(function (r) {
    var c = String(r[CATEGORY] || '').trim().toUpperCase() || '(blank)';
    existing[c] = (existing[c] || 0) + 1;
  });
  L.push('--- existing Category column values ---');
  Object.keys(existing).sort(function (a, b) { return existing[b] - existing[a]; })
    .forEach(function (k) {
      var usable = INSP_CATS_.indexOf(k) >= 0;
      L.push('  ' + (usable ? 'DIRECT MATCH ' : '             ') + k + '  x' + existing[k]);
    });

  // Build the proposal.
  var bySource = { direct: 0, keyword: 0, unresolved: 0 };
  var byCat = {};
  var unresolved = [];
  var samples = {};
  var alreadySet = 0;

  data.forEach(function (r, i) {
    if (String(r[INSP] || '').trim()) { alreadySet++; return; }
    var code = String(r[CODE] || '').trim();
    var desc = String(r[DESC] || '').trim();
    var cat = String(r[CATEGORY] || '').trim().toUpperCase();

    var proposed = '', how = '';
    if (INSP_CATS_.indexOf(cat) >= 0) {          // the existing column already holds a valid category
      proposed = cat; how = 'direct';
    } else {
      for (var k = 0; k < INSP_RULES_.length; k++) {
        if (INSP_RULES_[k][1].test(desc)) { proposed = INSP_RULES_[k][0]; how = 'keyword'; break; }
      }
    }
    if (!proposed) {
      bySource.unresolved++;
      if (unresolved.length < 25) unresolved.push('    row ' + (i + 2) + '  ' + code + '  cat="' + cat + '"  ' + desc.slice(0, 52));
      return;
    }
    bySource[how]++;
    byCat[proposed] = (byCat[proposed] || 0) + 1;
    if (!samples[proposed]) samples[proposed] = [];
    if (samples[proposed].length < 4) samples[proposed].push(code + ' ' + desc.slice(0, 40) + ' [' + how + ']');
  });

  L.push('');
  L.push('--- PROPOSED ---');
  L.push('  already set : ' + alreadySet);
  L.push('  from existing Category column : ' + bySource.direct);
  L.push('  from description keywords     : ' + bySource.keyword);
  L.push('  UNRESOLVED (need your call)   : ' + bySource.unresolved);
  L.push('');
  Object.keys(byCat).sort().forEach(function (c) {
    L.push('  ' + c + '  ->  ' + byCat[c] + ' materials');
    (samples[c] || []).forEach(function (s) { L.push('       ' + s); });
  });

  if (unresolved.length) {
    L.push('');
    L.push('--- UNRESOLVED (no rule matched; these would stay blank) ---');
    unresolved.forEach(function (u) { L.push(u); });
    if (bySource.unresolved > unresolved.length) {
      L.push('    ... +' + (bySource.unresolved - unresolved.length) + ' more');
    }
  }

  // ── Blocker check: does the target column even exist? ──────────────
  L.push('');
  L.push('--- SCHEMA BLOCKER ---');
  if (lc <= INSP) {
    L.push('  MAT_COL.INSP_CATEGORY = ' + INSP + ' but the sheet has only ' + lc +
           ' columns (0..' + (lc - 1) + '). The target column DOES NOT EXIST,');
    L.push('  so no inspectionCategory can be stored and getCategoryParams() can');
    L.push('  never resolve a category. The category system is inert by schema,');
    L.push('  not by missing data.');
  } else {
    L.push('  OK — column ' + INSP + ' exists.');
  }
  // The contract disagrees with the live header from col 5 onward.
  var CONTRACT = ['Item Code','Item Description','Unit','Category','Default Location',
    'Reorder Level','Each L (mm)','Each W (mm)','Each H (mm)','Each Weight (kg)',
    'Per Pallet (TIxHI)','Fit Class','Inspection Category'];
  var drift = [];
  for (var c = 0; c < CONTRACT.length; c++) {
    var actual = c < hdr.length ? hdr[c] : '(MISSING COLUMN)';
    if (String(actual).toLowerCase() !== CONTRACT[c].toLowerCase()) {
      drift.push('    [' + c + '] contract "' + CONTRACT[c] + '"  vs  sheet "' + actual + '"');
    }
  }
  if (drift.length) {
    L.push('');
    L.push('  MAT_COL vs live header mismatches (' + drift.length + '):');
    drift.forEach(function (d) { L.push(d); });
    L.push('  Consequence: writes through MAT_COL land in the WRONG column. Cols 6/8/9');
    L.push('  already hold numbers under audit/dimension headers — dimension values');
    L.push('  written through the shifted contract.');
  }

  L.push('');
  L.push('NOTHING WAS WRITTEN. Fix the schema before applying any category mapping.');
  var out = L.join('\n');
  Logger.log(out);
  return out;
}

/**
 * Write the proposed inspectionCategory for every material that resolves.
 *   ?diag=inspcatapply               DRY RUN
 *   ?diag=inspcatapply&confirm=YES   apply
 *
 * Only writes col 12. Never overwrites a value that is already set, and leaves
 * unresolved materials blank rather than guessing — a wrong category means
 * inspecting against the wrong parameter set, which is worse than none.
 */
function applyInspectionCategories(apply) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Materials');
  if (!ws) return 'MASTERS_Materials missing';

  var lr = ws.getLastRow(), lc = ws.getLastColumn();
  var CODE = 0, DESC = 1, CATEGORY = 3, INSP = 12;

  var L = ['inspectionCategory apply — ' + (apply ? 'LIVE' : 'DRY RUN')];
  if (lc <= INSP) {
    L.push('BLOCKED: sheet has ' + lc + ' columns; col ' + INSP + ' does not exist.');
    L.push('Run ?diag=matschemafix&confirm=YES first.');
    return L.join('\n');
  }

  var data = ws.getRange(2, 1, lr - 1, lc).getValues();
  var col = [], counts = {}, skipped = 0, unresolved = 0, kept = 0;

  data.forEach(function (r) {
    var current = String(r[INSP] || '').trim();
    if (current) { col.push([current]); kept++; return; }   // never overwrite

    var cat = String(r[CATEGORY] || '').trim().toUpperCase();
    var desc = String(r[DESC] || '').trim();
    var proposed = '';
    if (INSP_CATS_.indexOf(cat) >= 0) {
      proposed = cat;
    } else {
      for (var k = 0; k < INSP_RULES_.length; k++) {
        if (INSP_RULES_[k][1].test(desc)) { proposed = INSP_RULES_[k][0]; break; }
      }
    }
    if (proposed) { counts[proposed] = (counts[proposed] || 0) + 1; skipped++; }
    else { unresolved++; }
    col.push([proposed]);
  });

  L.push('  already set (left alone) : ' + kept);
  L.push('  to write                 : ' + skipped);
  L.push('  left blank (unresolved)  : ' + unresolved);
  Object.keys(counts).sort().forEach(function (c) { L.push('    ' + c + ' -> ' + counts[c]); });

  if (!apply) {
    L.push('');
    L.push('DRY RUN — nothing written. Re-run with &confirm=YES to apply.');
    return L.join('\n');
  }

  ws.getRange(2, INSP + 1, col.length, 1).setValues(col);
  SpreadsheetApp.flush();
  L.push('');
  L.push('APPLIED: ' + skipped + ' categories written to col ' + INSP + '.');
  return L.join('\n');
}
