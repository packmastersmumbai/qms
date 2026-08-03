// _LocationAudit.js
// ------------------------------------------------------------
// READ-ONLY. What does the LIVE LOCATIONS sheet actually contain, and how far
// has it drifted from the two hardcoded tables that are supposed to mirror it?
//
//   LOCATIONS sheet                      — the real slots (12 cols)
//   LOCATIONS_BAY_TABLE (Initialize.js)  — seed-time slot counts per bay
//   STORAGE_ZONES (WarehouseFloorplan)   — the drawn grid; hardcoded, never
//                                          validated against the sheet
//
// Reports floors, sections, bays, types, Active flags, and which locations hold
// stock but are NOT drawable by the floorplan's bay list (A-F) — i.e. invisible
// on the map. Writes nothing.
// ------------------------------------------------------------

function locationAudit() {
  var ss = getSpreadsheet();
  var out = { error: null };

  try {
    var ws = ss.getSheetByName('LOCATIONS');
    if (!ws || ws.getLastRow() < 2) return { error: 'LOCATIONS sheet missing or empty' };

    var d   = ws.getDataRange().getValues();
    var hdr = d[0].map(function (h) { return String(h || '').trim(); });
    var rows = d.slice(1).filter(function (r) { return String(r[0] || '').trim(); });

    // Column contract: ID, Floor, Section, Aisle, Rack, Shelf, Bin, Label, Type,
    // Capacity Qty, Capacity Unit, Active
    var byFloor = {}, byType = {}, bySection = {}, byRack = {}, inactive = [];
    rows.forEach(function (r) {
      var floor = String(r[1] || '(blank)').trim();
      var sect  = String(r[2] || '(blank)').trim();
      var rack  = String(r[4] || '(none)').trim();
      var type  = String(r[8] || '(blank)').trim().toUpperCase();
      var act   = String(r[11] || '').trim().toUpperCase();
      byFloor[floor]   = (byFloor[floor]   || 0) + 1;
      byType[type]     = (byType[type]     || 0) + 1;
      bySection[sect]  = (bySection[sect]  || 0) + 1;
      byRack[rack]     = (byRack[rack]     || 0) + 1;
      if (act && act !== 'Y') inactive.push(String(r[0]).trim() + ' (' + act + ')');
    });

    // The floorplan can only draw bays A-F (STORAGE_ZONES). Anything else is a
    // real location that will never appear on the map.
    var DRAWABLE = { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1 };
    var undrawable = rows.filter(function (r) {
      return !DRAWABLE[String(r[4] || '').trim().toUpperCase()];
    }).map(function (r) { return String(r[0]).trim(); });

    // Which of those actually hold stock right now?
    var withStock = [];
    try {
      var sum = (typeof getStockSummary === 'function') ? getStockSummary() : [];
      var held = {};
      sum.forEach(function (s) {
        var id = String(s.locationId || '').trim();
        if (id) held[id] = (held[id] || 0) + (Number(s.balance) || 0);
      });
      undrawable.forEach(function (id) { if (held[id]) withStock.push(id + ' = ' + held[id]); });
    } catch (e) {}

    out.headers          = hdr;
    out.totalLocations   = rows.length;
    out.byFloor          = byFloor;
    out.bySection        = bySection;
    out.byType           = byType;
    out.rackCounts       = byRack;
    out.inactiveCount    = inactive.length;
    out.inactiveSample   = inactive.slice(0, 15);
    out.undrawableCount  = undrawable.length;
    out.undrawableSample = undrawable.slice(0, 25);
    out.undrawableHoldingStock = withStock.slice(0, 25);
    out.note = 'undrawable = a real location whose Rack is not A-F, so ' +
               'WarehouseFloorplan STORAGE_ZONES cannot render it. Any of those ' +
               'holding stock is invisible on the map today.';

    // ---- CAPACITY: is it actually configured, or is the fit engine carrying it? ----
    // Two independent capacity sources exist:
    //   LOCATIONS cols 9/10 (Capacity Qty / Unit)  — per-location, sheet-configured
    //   computePalletFit_ (Warehouse.js)           — per-MATERIAL, derived from
    //     MASTERS_Materials perPallet / eachL,W,H / eachWeight against a hardcoded
    //     1200x1000x1500mm, 1000kg pallet envelope
    // Which one is populated decides whether a schema change must preserve real data
    // or is only carrying blanks.
    var capSet = 0, capBlank = 0, capUnits = {}, capSamples = [];
    rows.forEach(function (r) {
      var q = String(r[9] || '').trim();
      var u = String(r[10] || '').trim();
      if (q !== '' && Number(q) > 0) {
        capSet++;
        if (u) capUnits[u] = (capUnits[u] || 0) + 1;
        if (capSamples.length < 10) capSamples.push(String(r[0]).trim() + ' = ' + q + ' ' + u);
      } else capBlank++;
    });
    out.capacity = {
      locationsWithCapacityQty: capSet,
      locationsBlank: capBlank,
      unitsUsed: capUnits,
      samples: capSamples
    };

    // Material-side geometry that the fit engine actually relies on.
    try {
      var mats = (typeof getMaterials === 'function') ? getMaterials() : [];
      var withPerPallet = 0, withGeom = 0, withNeither = 0;
      mats.forEach(function (m) {
        var pp = Number(m.perPallet) || 0;
        var geom = (Number(m.eachL) || 0) * (Number(m.eachW) || 0) * (Number(m.eachH) || 0) > 0 &&
                   (Number(m.eachWeight) || 0) > 0;
        if (pp > 0) withPerPallet++;
        else if (geom) withGeom++;
        else withNeither++;
      });
      out.materialFitData = {
        totalMaterials: mats.length,
        withPerPalletTIxHI: withPerPallet,
        withFullGeometryOnly: withGeom,
        withNeither_cannotSuggestSlot: withNeither
      };
    } catch (e) { out.materialFitData = { error: e.message }; }

    // ---- What UNIT is stock actually held in? ----
    // Volume/weight fit only makes sense for discrete eaches. If most stock is KG
    // or MTR, "how many fit on a pallet" is the wrong question and the method must
    // differ per unit family.
    try {
      var mats2 = (typeof getMaterials === 'function') ? getMaterials() : [];
      var byUnit = {}, byCat = {};
      mats2.forEach(function (m) {
        var u = String(m.unit || '(blank)').trim().toUpperCase();
        byUnit[u] = (byUnit[u] || 0) + 1;
        var c = String(m.category || '(blank)').trim().toUpperCase();
        byCat[c] = (byCat[c] || 0) + 1;
      });
      out.materialUnits = byUnit;
      out.materialCategories = byCat;

      // How much stock sits in a pallet slot (B###) vs a logical zone today?
      var sum2 = (typeof getStockSummary === 'function') ? getStockSummary() : [];
      var inSlots = 0, inZones = 0, slotIds = {}, zoneIds = {};
      sum2.forEach(function (s) {
        var id = String(s.locationId || '').trim().toUpperCase();
        if (/^B\d{3}$/.test(id)) { inSlots++; slotIds[id] = 1; }
        else { inZones++; zoneIds[id] = 1; }
      });
      out.stockPlacement = {
        lotsInPalletSlots: inSlots,
        distinctSlotsUsed: Object.keys(slotIds).length,
        lotsInLogicalZones: inZones,
        distinctZonesUsed: Object.keys(zoneIds).length,
        zoneList: Object.keys(zoneIds).slice(0, 12)
      };
    } catch (e) { out.materialUnits = { error: e.message }; }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}
