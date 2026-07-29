// Read-only: why a stock lot does / does not appear in the Warehouse RM or FG view.
// The views classify by LOCATION type, not material category, so a lot stored in a
// location whose Type doesn't resolve to RM/FG/FG_HOLD/QUARANTINE falls out of every
// view. Exposed via ?diag=whview.
function diagWarehouseViews() {
  var ss = getSpreadsheet();
  var summary = getStockSummary();               // balance > 0 lots
  var mats = {};
  getMaterials().forEach(function(m) {
    mats[String(m.code || m.itemCode || '').trim()] = String(m.category || '').trim();
  });

  // LOCATIONS: build id → Type exactly as the view does.
  var locType = {};
  var lw = ss.getSheetByName('LOCATIONS');
  var locHeader = '';
  if (lw && lw.getLastRow() > 1) {
    var ld = lw.getDataRange().getValues();
    locHeader = ld[0].join(' | ');
    // find the Type column by header name
    var tCol = -1, iCol = 0;
    for (var c = 0; c < ld[0].length; c++) {
      var h = String(ld[0][c] || '').trim().toLowerCase();
      if (h === 'type' || h === 'loc type' || h === 'location type') tCol = c;
      if (h === 'location id' || h === 'id' || h === 'locationid') iCol = c;
    }
    for (var i = 1; i < ld.length; i++) {
      var id = String(ld[i][iCol] || '').trim();
      if (id) locType[id] = tCol >= 0 ? String(ld[i][tCol] || '').trim().toUpperCase() : '';
    }
  }

  function infer(locId) {
    var id = String(locId || '').trim().toUpperCase();
    if (!id) return '';
    if (id === 'QUARANTINE' || id.indexOf('QUAR') === 0) return 'QUARANTINE';
    if (id === 'SCRAP'  || id.indexOf('SCRAP')  === 0) return 'SCRAP';
    if (id === 'SAMPLE' || id.indexOf('SAMPLE') === 0) return 'SAMPLE';
    if (id === 'REWORK' || id.indexOf('REWORK') === 0) return 'REWORK';
    if (id === 'WIP'    || id.indexOf('WIP')    === 0) return 'WIP';
    if (id === 'HOLD' || id.indexOf('FG-HOLD') === 0 || id.indexOf('FG_HOLD') === 0) return 'FG_HOLD';
    if (id.indexOf('FG') === 0) return 'FG';
    if (id.indexOf('RM') === 0) return 'RM';
    if (/^[ABC]\d{3}$/.test(id)) return 'SLOT';
    return '';
  }

  var buckets = {};   // view bucket → count
  var orphans = [];   // lots landing in NO view
  var mismatch = [];  // material category disagrees with location bucket
  var byLoc = {};

  summary.forEach(function(s) {
    var lt = locType[s.locationId] || infer(s.locationId);
    var view = (lt === 'RM') ? 'RM view'
             : (lt === 'FG' || lt === 'FG_HOLD') ? 'FG view'
             : (lt === 'QUARANTINE') ? 'Quarantine view'
             : 'NO VIEW';
    buckets[view] = (buckets[view] || 0) + 1;

    if (!byLoc[s.locationId]) byLoc[s.locationId] = { type: lt || '(unresolved)', n: 0, view: view };
    byLoc[s.locationId].n++;

    if (view === 'NO VIEW') {
      orphans.push({ code: s.materialCode, lot: s.batchOrLotNo, loc: s.locationId,
                     qty: s.balance, locType: lt || '(unresolved)',
                     cat: mats[String(s.materialCode).trim()] || '(no material row)' });
    } else {
      var cat = String(mats[String(s.materialCode).trim()] || '').toUpperCase();
      var grade = (cat === 'FG') ? 'FG' : (cat === 'BULK') ? 'RM'
                : (cat ? 'PM' : '');
      if (grade === 'FG' && view === 'RM view') mismatch.push(s.materialCode + ' lot ' + s.batchOrLotNo + ' — FG material sitting in RM location ' + s.locationId);
      if (grade && grade !== 'FG' && view === 'FG view') mismatch.push(s.materialCode + ' lot ' + s.batchOrLotNo + ' — ' + cat + ' material sitting in FG location ' + s.locationId);
    }
  });

  var out = [];
  out.push('WAREHOUSE VIEW CLASSIFICATION');
  out.push('=============================');
  out.push('Views split by LOCATION type (LOCATIONS.Type, else inferred from the id prefix).');
  out.push('Material category is NOT used. A lot in an unrecognised location shows in no view.');
  out.push('');
  out.push('LOCATIONS header: ' + (locHeader || '(sheet missing)'));
  out.push('');
  out.push('lots with balance > 0: ' + summary.length);
  Object.keys(buckets).sort().forEach(function(b) { out.push('  ' + _wvPad_(b, 18) + buckets[b]); });
  out.push('');

  out.push('LOCATIONS IN USE:');
  Object.keys(byLoc).sort().forEach(function(l) {
    out.push('  ' + _wvPad_(l, 20) + 'type=' + _wvPad_(byLoc[l].type, 14) + _wvPad_(byLoc[l].view, 18) + byLoc[l].n + ' lots');
  });
  out.push('');

  if (orphans.length) {
    out.push('✘ LOTS IN NO VIEW (' + orphans.length + ') — invisible in Warehouse RM and FG:');
    orphans.forEach(function(o) {
      out.push('  ' + _wvPad_(o.code, 16) + 'lot=' + _wvPad_(o.lot, 22) + 'loc=' + _wvPad_(o.loc, 16) +
               'locType=' + _wvPad_(o.locType, 14) + 'matCat=' + _wvPad_(o.cat, 10) + 'qty=' + o.qty);
    });
  } else {
    out.push('✔ every lot resolves to a view.');
  }
  out.push('');

  if (mismatch.length) {
    out.push('⚠ CATEGORY / LOCATION MISMATCH (' + mismatch.length + '):');
    mismatch.slice(0, 30).forEach(function(m) { out.push('  ' + m); });
    if (mismatch.length > 30) out.push('  … +' + (mismatch.length - 30) + ' more');
  } else {
    out.push('✔ no material-category vs location-type mismatches.');
  }

  // What is actually IN the no-view lots, grouped by material category, so the
  // "is this really packaging material?" question can be answered from data.
  out.push('');
  out.push('NO-VIEW LOTS BY MATERIAL CATEGORY:');
  var catAgg = {};
  orphans.forEach(function(o) {
    var k = o.cat || '(blank)';
    if (!catAgg[k]) catAgg[k] = { n: 0, qty: 0, egs: [] };
    catAgg[k].n++;
    catAgg[k].qty += Number(o.qty) || 0;
    if (catAgg[k].egs.length < 4) catAgg[k].egs.push(o.code + ' @' + o.loc + ' ×' + o.qty);
  });
  Object.keys(catAgg).sort().forEach(function(k) {
    var a = catAgg[k];
    out.push('  ' + _wvPad_(k, 12) + _wvPad_(a.n + ' lots', 10) + 'total qty ' + (Math.round(a.qty * 1000) / 1000));
    a.egs.forEach(function(e) { out.push('       ' + e); });
  });
  return out.join('\n');
}

function _wvPad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
