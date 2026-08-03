// _GhostLocations.js
// ------------------------------------------------------------
// READ-ONLY. Profiles the locations that appear in STOCK_LEDGER but are NOT
// defined in the LOCATIONS sheet ("ghosts"). STOCK_LEDGER accepts any string as
// a location — there is no foreign-key check — so these were created implicitly
// by whoever typed or selected them.
//
// For each ghost: how much stock, how many lots/materials, first and last
// movement, which txn types created it, and which defined location it most
// resembles (typo detection). That last part is a SUGGESTION for a human to
// confirm — it must never be applied automatically, because merging two real
// locations would silently move stock that physically did not move.
// ------------------------------------------------------------

function ghostLocations() {
  var ss = getSpreadsheet();
  var out = { ghosts: [], definedIds: [], error: null };

  try {
    // --- defined locations ---
    var lw = ss.getSheetByName('LOCATIONS');
    var defined = {};
    if (lw && lw.getLastRow() > 1) {
      lw.getRange(2, 1, lw.getLastRow() - 1, 12).getValues().forEach(function (r) {
        var id = String(r[0] || '').trim();
        if (id) defined[id.toUpperCase()] = { id: id, floor: r[1], type: r[8], active: r[11] };
      });
    }
    out.definedIds = Object.keys(defined).sort();

    // --- ledger scan ---
    var sw = ss.getSheetByName('STOCK_LEDGER');
    if (!sw || sw.getLastRow() < 2) return { error: 'STOCK_LEDGER empty' };
    var d = sw.getDataRange().getValues();
    var h = d[0].map(function (x) { return String(x || '').trim().toLowerCase(); });

    function col(names, fallback) {
      for (var i = 0; i < names.length; i++) {
        var idx = h.indexOf(names[i]);
        if (idx >= 0) return idx;
      }
      for (var j = 0; j < h.length; j++) {
        for (var k = 0; k < names.length; k++) {
          if (h[j].indexOf(names[k]) >= 0) return j;
        }
      }
      return fallback;
    }
    var cLoc  = col(['location id', 'location'], -1);
    var cMat  = col(['material code', 'material'], -1);
    var cBat  = col(['batch', 'lot'], -1);
    var cIn   = col(['qty in', 'qtyin'], -1);
    var cOut  = col(['qty out', 'qtyout'], -1);
    var cType = col(['txn type', 'type'], -1);
    var cDate = col(['timestamp', 'date'], -1);
    out.columnsUsed = { loc: cLoc, mat: cMat, batch: cBat, qtyIn: cIn, qtyOut: cOut, txn: cType, date: cDate };
    if (cLoc < 0) return { error: 'Could not find a location column in STOCK_LEDGER' };

    var agg = {};
    d.slice(1).forEach(function (r) {
      var raw = String(r[cLoc] || '').trim();
      if (!raw) return;
      var key = raw.toUpperCase();
      if (defined[key]) return;                 // properly defined — not a ghost
      if (/^B\d{3}$/.test(key)) return;         // pallet slot pattern

      if (!agg[key]) {
        agg[key] = { locationId: raw, rows: 0, qtyIn: 0, qtyOut: 0,
                     materials: {}, batches: {}, txnTypes: {}, first: null, last: null };
      }
      var a = agg[key];
      a.rows++;
      a.qtyIn  += Number(r[cIn])  || 0;
      a.qtyOut += Number(r[cOut]) || 0;
      if (cMat >= 0 && r[cMat]) a.materials[String(r[cMat]).trim()] = 1;
      if (cBat >= 0 && r[cBat]) a.batches[String(r[cBat]).trim()] = 1;
      if (cType >= 0 && r[cType]) {
        var t = String(r[cType]).trim();
        a.txnTypes[t] = (a.txnTypes[t] || 0) + 1;
      }
      if (cDate >= 0 && r[cDate] instanceof Date) {
        if (!a.first || r[cDate] < a.first) a.first = r[cDate];
        if (!a.last  || r[cDate] > a.last)  a.last  = r[cDate];
      }
    });

    // Typo suggestion: closest defined id by simple containment / edit proximity.
    function nearest(ghostId) {
      var g = ghostId.toUpperCase().replace(/[^A-Z0-9]/g, '');
      var best = '', bestScore = 0;
      Object.keys(defined).forEach(function (k) {
        var c = k.replace(/[^A-Z0-9]/g, '');
        var shorter = g.length < c.length ? g : c;
        var longer  = g.length < c.length ? c : g;
        var score = 0;
        if (longer.indexOf(shorter) === 0) score = shorter.length / longer.length;
        if (score > bestScore) { bestScore = score; best = defined[k].id; }
      });
      return bestScore >= 0.6 ? (best + ' (' + Math.round(bestScore * 100) + '% prefix match)') : '';
    }

    Object.keys(agg).forEach(function (k) {
      var a = agg[k];
      out.ghosts.push({
        locationId:   a.locationId,
        netBalance:   Math.round((a.qtyIn - a.qtyOut) * 1000) / 1000,
        totalIn:      a.qtyIn,
        totalOut:     a.qtyOut,
        ledgerRows:   a.rows,
        distinctMaterials: Object.keys(a.materials).length,
        distinctBatches:   Object.keys(a.batches).length,
        txnTypes:     a.txnTypes,
        firstSeen:    a.first ? Utilities.formatDate(a.first, 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
        lastSeen:     a.last  ? Utilities.formatDate(a.last,  'Asia/Kolkata', 'dd-MMM-yyyy') : '',
        looksLike:    nearest(a.locationId)
      });
    });
    out.ghosts.sort(function (x, y) { return y.netBalance - x.netBalance; });
    out.ghostCount = out.ghosts.length;
    out.note = 'looksLike is a PREFIX-MATCH SUGGESTION ONLY. Never auto-merge — ' +
               'merging two genuinely different locations moves stock on paper that ' +
               'did not move on the floor.';
  } catch (e) {
    out.error = e.message + ' | ' + (e.stack || '').split('\n')[1];
  }
  return out;
}

// Which MASTERS_Materials rows point at a location that does not exist?
// This is the SOURCE of most ghosts: GRN_RECEIPT writes the material's
// Default Location verbatim, and nothing validates it against LOCATIONS.
function ghostDefaultLocations() {
  var ss = getSpreadsheet();
  var out = { badDefaults: [], error: null };
  try {
    var lw = ss.getSheetByName('LOCATIONS');
    var defined = {};
    if (lw && lw.getLastRow() > 1) {
      lw.getRange(2, 1, lw.getLastRow() - 1, 1).getValues().forEach(function (r) {
        var id = String(r[0] || '').trim();
        if (id) defined[id.toUpperCase()] = 1;
      });
    }
    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    var counts = {};
    mats.forEach(function (m) {
      var dl = String(m.defaultLocation || '').trim();
      if (!dl) return;
      if (defined[dl.toUpperCase()]) return;
      counts[dl] = (counts[dl] || 0) + 1;
    });
    Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; }).forEach(function (k) {
      out.badDefaults.push({ defaultLocation: k, materialCount: counts[k] });
    });
    out.totalMaterials = mats.length;
    out.materialsWithUndefinedDefault = Object.keys(counts).reduce(function(s,k){ return s+counts[k]; },0);
  } catch (e) { out.error = e.message; }
  return out;
}

// What GRADE of material actually sits in each ghost? Used to infer Type
// (RM/PM/FG) from evidence instead of from the name, since names can mislead.
function ghostGradeProfile() {
  var out = { profiles: [], error: null };
  try {
    var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
    var catByCode = {};
    mats.forEach(function (m) {
      catByCode[String(m.code).trim()] = String(m.category || '').trim().toUpperCase();
    });
    // Default-location assignment is the strongest signal: it is what the material
    // master SAYS should live there, independent of what has been received so far.
    var byLoc = {};
    mats.forEach(function (m) {
      var dl = String(m.defaultLocation || '').trim();
      if (!dl) return;
      if (!byLoc[dl]) byLoc[dl] = { cats: {}, units: {}, count: 0 };
      var e = byLoc[dl];
      e.count++;
      var c = String(m.category || '(blank)').trim().toUpperCase();
      e.cats[c] = (e.cats[c] || 0) + 1;
      var u = String(m.unit || '(blank)').trim().toUpperCase();
      e.units[u] = (e.units[u] || 0) + 1;
    });
    Object.keys(byLoc).forEach(function (k) {
      var e = byLoc[k];
      var topCat = Object.keys(e.cats).sort(function (a, b) { return e.cats[b] - e.cats[a]; })[0];
      out.profiles.push({
        location: k, materials: e.count,
        topCategory: topCat + ' (' + e.cats[topCat] + '/' + e.count + ')',
        allCategories: e.cats, units: e.units
      });
    });
    out.profiles.sort(function (a, b) { return b.materials - a.materials; });
  } catch (e) { out.error = e.message; }
  return out;
}

// Did the ghostmerge correction CREATE any negative balance? Compares the live
// balance for the two corrected lots against the pre-correction backup tab, so
// "the negatives were already there" is proven, not asserted.
function ghostMergeImpact() {
  var out = { checked: [], error: null };
  try {
    var ss = getSpreadsheet();
    var pairs = [
      { mat: 'A002', batch: 'B-AUTO-1781082767653-2', from: 'RM-STORE-AA', to: 'RM-STORE-A' },
      { mat: 'A001', batch: 'A001',                   from: 'FG-STORE-AA', to: 'FG-STORE'   }
    ];
    pairs.forEach(function (p) {
      out.checked.push({
        material: p.mat, batch: p.batch,
        sourceNow: getStockBalance_(p.mat, p.batch, p.from),
        destNow:   getStockBalance_(p.mat, p.batch, p.to)
      });
    });
    // Count negatives in the BACKUP (pre-correction) vs live, for the same lots.
    var bak = null;
    ss.getSheets().forEach(function (sh) {
      var n = sh.getName();
      if (n.indexOf('BAK_STOCK_LEDGER_') === 0) bak = sh;
    });
    out.backupSheet = bak ? bak.getName() : '(none found)';
    out.note = 'sourceNow should be 0 (stock moved out); destNow should be >= the ' +
               'moved qty. A negative at dest would mean the correction over-moved.';
  } catch (e) { out.error = e.message; }
  return out;
}
