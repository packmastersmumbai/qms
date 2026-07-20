// ============================================================
// Masters.gs — Server functions that return dropdown data
// Called by HTML forms via google.script.run
// ============================================================

// ------------------------------------------------------------
// MASTERS_Materials column contract (single source of truth)
// ------------------------------------------------------------
// The sheet is a 12-column row A→L. Cols A–E (plus F reorderLevel) are the
// live fields today; cols F→L are reserved for Phase-2 storage geometry
// (F baseUnit/reorderLevel, G eachL, H eachW, I eachH, J eachWeight,
// K perPallet, L fitClass — see the floorplan task spec). The writer must
// NEVER clip past E: any pre-existing value in F→L has to survive an edit.
// Reader and writer both consume MAT_COL / MAT_WIDTH so the width is defined
// in exactly one place.
// Cols A–F are the live fields; G→L hold Phase-2 storage geometry, filled at
// material creation/edit. eachVolume (L×W×H) is COMPUTED at read/fit time and
// is deliberately NOT a stored column. fitClass is a WEIGHT|VOLUME display hint;
// the true capacity ceiling is min(volume,weight) regardless (Step 6 fit engine).
var MAT_COL = {
  CODE: 0, DESC: 1, UNIT: 2, CATEGORY: 3, DEFAULT_LOCATION: 4, REORDER_LEVEL: 5,
  EACH_L: 6, EACH_W: 7, EACH_H: 8, EACH_WEIGHT: 9, PER_PALLET: 10, FIT_CLASS: 11,
  INSP_CATEGORY: 12   // product inspection category (HDPE_BOTTLE|LABEL|PAPER|CARTON|BULK) — drives IQC/IPQC params
};
var MAT_WIDTH = 13;

// The 6 geometry columns G→L, in sheet order: key used on the material object,
// its 0-based column index, and the header text. Single source consumed by the
// reader, the writer patch, and the header-ensuring seed so the mapping lives
// in exactly one place.
var MAT_GEOMETRY_COLS = [
  { key: 'eachL',      col: MAT_COL.EACH_L,      header: 'Each L (mm)' },
  { key: 'eachW',      col: MAT_COL.EACH_W,      header: 'Each W (mm)' },
  { key: 'eachH',      col: MAT_COL.EACH_H,      header: 'Each H (mm)' },
  { key: 'eachWeight', col: MAT_COL.EACH_WEIGHT, header: 'Each Weight (kg)' },
  { key: 'perPallet',  col: MAT_COL.PER_PALLET,  header: 'Per Pallet (TIxHI)' },
  { key: 'fitClass',   col: MAT_COL.FIT_CLASS,   header: 'Fit Class' }
];

function getSuppliers() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Suppliers');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0] && (r[7] === 'Y' || r[6] === 'Y'); })
    .map(function(r) { return { code: r[0], name: r[1], contact: r[2], phone: r[3], email: r[4] || '', material: r[5] || r[4] || '' }; });
}

// Normalize a stored geometry cell to a positive number, or '' when blank/invalid.
// '' is falsy so Step-6's zero-geometry guard skips un-geometried materials, and
// a blank cell stays blank (not 0) when it round-trips back into the form.
function _geoNum_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return (isNaN(n) || n <= 0) ? '' : n;
}

function getMaterials() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[MAT_COL.CODE]; })
    .map(function(r) {
      return {
        code: String(r[MAT_COL.CODE]).trim(),
        desc: r[MAT_COL.DESC],
        unit: r[MAT_COL.UNIT],
        category: r[MAT_COL.CATEGORY],
        defaultLocation: String(r[MAT_COL.DEFAULT_LOCATION] || '').trim(),
        reorderLevel: Number(r[MAT_COL.REORDER_LEVEL]) || 0,  // col F; blank/0 = no low-stock alert
        // Cols G→L (indexes 6–11) round-tripped verbatim for Phase-2 geometry.
        // Optional and backward-compatible — existing callers ignore these.
        geometry: r.slice(6, 12).map(function(v) { return v == null ? '' : v; }),
        // Named geometry fields (G→L) so the material form can bind each input
        // and the fit engine reads by name. Blank cell → '' (falsy), never null.
        eachL:      _geoNum_(r[MAT_COL.EACH_L]),
        eachW:      _geoNum_(r[MAT_COL.EACH_W]),
        eachH:      _geoNum_(r[MAT_COL.EACH_H]),
        eachWeight: _geoNum_(r[MAT_COL.EACH_WEIGHT]),
        perPallet:  _geoNum_(r[MAT_COL.PER_PALLET]),
        fitClass:   String(r[MAT_COL.FIT_CLASS] || '').trim(),  // '' | 'WEIGHT' | 'VOLUME'
        inspectionCategory: String(r[MAT_COL.INSP_CATEGORY] || '').trim()
      };
    });
}

// Backfill GRN_LOG rows whose Location ID (col U / index 20) is blank,
// using the material's defaultLocation from MASTERS_Materials.
// Idempotent — only touches rows whose location is currently blank.
function backfillGRNLocations() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('GRN_LOG');
  if (!ws || ws.getLastRow() < 2) return { success: false, error: 'GRN_LOG empty.' };

  var mats = getMaterials();
  var locByCode = {};
  mats.forEach(function(m){
    if (m.code && m.defaultLocation) locByCode[m.code] = m.defaultLocation;
  });

  var data = ws.getDataRange().getValues();
  var filled = 0, noMaster = 0, alreadySet = 0;
  for (var i = 1; i < data.length; i++) {
    var curLoc = String(data[i][20] || '').trim();
    if (curLoc) { alreadySet++; continue; }
    var matCode = String(data[i][6] || '').trim();
    var loc = locByCode[matCode];
    if (!loc) { noMaster++; continue; }
    ws.getRange(i + 1, 21).setValue(loc);
    filled++;
  }
  return { success: true, filled: filled, alreadySet: alreadySet, noMaster: noMaster };
}

function backfillGRNLocationsUI() {
  if (!CONFIG._TESTING_ENABLED) return { success: false, error: 'testing disabled' };
  var ui = SpreadsheetApp.getUi();
  var res = backfillGRNLocations();
  if (!res.success) { ui.alert('Failed', res.error, ui.ButtonSet.OK); return; }
  ui.alert('GRN location backfill',
    'Filled: ' + res.filled +
    '\nAlready had location: ' + res.alreadySet +
    '\nNo default in material master: ' + res.noMaster +
    (res.noMaster ? '\n\nAdd Default Location (col E) to those materials in MASTERS_Materials, then re-run.' : ''),
    ui.ButtonSet.OK);
}

// Ensures MASTERS_Materials has a 'Default Location' header in column E.
// Idempotent — only writes the col E header if missing. It ONLY touches col E,
// so it neither adds nor removes the wider 12-col (A→L) layout: any Phase-2
// F→L headers/values present are left untouched (Step 5 owns seeding those).
function ensureMaterialsLocationColumn_() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return;
  var lastCol = ws.getLastColumn();
  if (lastCol < MAT_COL.DEFAULT_LOCATION + 1) {
    ws.getRange(1, 5).setValue('Default Location');
    ws.getRange(1, 5).setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
    return;
  }
  var header = String(ws.getRange(1, 5).getValue() || '').trim();
  if (!header) ws.getRange(1, 5).setValue('Default Location');
}

function getCustomers() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Customers');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0]; })
    .map(function(r) { return { code: r[0], name: r[1], contact: r[2], phone: r[3], email: r[4], products: r[5], city: r[6] }; });
}

function getInspectors() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Personnel');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0]; })
    .map(function(r) { return { name: r[0], role: r[1], dept: r[2], phone: r[3], notify: r[4] || 'Y' }; });
}

function getFG() {
  return getMaterials().filter(function(m) {
    return m.category && m.category.toUpperCase() === 'FG';
  }).map(function(m) { return { code: m.code, name: m.desc, category: m.category, uom: m.unit, description: m.desc }; });
}

function getParameters() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Parameters');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0]; })
    .map(function(r) { return { code: r[0], name: r[1], unit: r[2], stdValue: r[3], tolMin: r[4], tolMax: r[5], methodType: r[6], checkBrief: r[7], tools: r[8], docRef: r[9], docNumber: r[10] }; });
}

function getControlPlan(planType, itemCode) {
  var sheetName = planType === 'fg' ? 'CONTROL_FG' : 'CONTROL_RM';
  var ws = getSpreadsheet().getSheetByName(sheetName);
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1)
    .filter(function(r) {
      return r[0] && r[1] && (!itemCode || String(r[0]).trim() === String(itemCode).trim());
    })
    .map(function(r) { return { itemCode: r[0], paramCode: r[1], enabled: r[2] === 'Y' || r[2] === true, stdValueOverride: r[3], tolMinOverride: r[4], tolMaxOverride: r[5] }; });
}

function saveControlPlanRow(planType, row) {
  var sheetName = planType === 'fg' ? 'CONTROL_FG' : 'CONTROL_RM';
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName(sheetName);
  if (!ws) {
    ws = ss.insertSheet(sheetName);
    ws.appendRow(['item_code', 'param_code', 'enabled', 'std_value_override', 'tol_min_override', 'tol_max_override']);
  }
  var values = ws.getDataRange().getValues();
  var newRow = [row.itemCode, row.paramCode, row.enabled ? 'Y' : 'N', row.stdValueOverride || '', row.tolMinOverride || '', row.tolMaxOverride || ''];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(row.itemCode).trim() && String(values[i][1]).trim() === String(row.paramCode).trim()) {
      ws.getRange(i + 1, 1, 1, newRow.length).setValues([newRow]);
      return { ok: true };
    }
  }
  ws.appendRow(newRow);
  return { ok: true };
}

function saveControlPlan(planType, itemCode, rows) {
  var sheetName = planType === 'fg' ? 'CONTROL_FG' : 'CONTROL_RM';
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName(sheetName);
  if (!ws) {
    ws = ss.insertSheet(sheetName);
    ws.appendRow(['item_code', 'param_code', 'enabled', 'std_value_override', 'tol_min_override', 'tol_max_override']);
  }

  // Delete existing rows for this item, then append new ones
  var values = ws.getDataRange().getValues();
  // Collect row indices to delete (reverse order to preserve indices)
  var toDelete = [];
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]).trim() === String(itemCode).trim()) {
      toDelete.push(i + 1);
    }
  }
  toDelete.forEach(function(rowIdx) { ws.deleteRow(rowIdx); });

  // Append enabled rows
  rows.forEach(function(r) {
    ws.appendRow([r.itemCode, r.paramCode, 'Y', r.stdValueOverride || '', r.tolMinOverride || '', r.tolMaxOverride || '']);
  });

  return { ok: true };
}


// Per-item Control Plan metadata (e.g. weightMatrix toggle). Single row per item.
// Sheet: CONTROL_PLAN_META  cols: item_code | weight_matrix | updated_at | updated_by
function saveControlPlanMeta(itemCode, meta) {
  try {
    if (!itemCode) return { success: false, error: 'itemCode required' };
    meta = meta || {};
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('CONTROL_PLAN_META');
    if (!ws) {
      ws = ss.insertSheet('CONTROL_PLAN_META');
      ws.appendRow(['item_code', 'weight_matrix', 'updated_at', 'updated_by']);
      ws.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1A237E').setFontColor('#FFFFFF');
      ws.setFrozenRows(1);
    }
    var who = (function(){ try { return Session.getActiveUser().getEmail() || 'QA'; } catch(e){ return 'QA'; } })();
    var now = new Date();
    var values = ws.getDataRange().getValues();
    var newRow = [itemCode, meta.weightMatrix ? 'Y' : 'N', now, who];
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(itemCode).trim()) {
        ws.getRange(i + 1, 1, 1, 4).setValues([newRow]);
        ws.getRange(i + 1, 3).setNumberFormat('dd-MMM-yyyy HH:mm');
        return { success: true };
      }
    }
    ws.appendRow(newRow);
    ws.getRange(ws.getLastRow(), 3).setNumberFormat('dd-MMM-yyyy HH:mm');
    return { success: true };
  } catch(e) {
    Logger.log('saveControlPlanMeta error: ' + e.message);
    return { success: false, error: e.message };
  }
}

function getControlPlanMeta(itemCode) {
  try {
    var ws = getSpreadsheet().getSheetByName('CONTROL_PLAN_META');
    if (!ws || ws.getLastRow() < 2) return { weightMatrix: false };
    var values = ws.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(itemCode).trim()) {
        return { weightMatrix: values[i][1] === 'Y' || values[i][1] === true };
      }
    }
    return { weightMatrix: false };
  } catch(e) { return { weightMatrix: false }; }
}

function seedDefaultParameters() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('MASTERS_Parameters');
  if (!ws) {
    ws = ss.insertSheet('MASTERS_Parameters');
    ws.appendRow(['code','name','unit','std_value','tol_min','tol_max','method_type','check_brief','tools','doc_ref','doc_number']);
  }
  var existing = ws.getDataRange().getValues().slice(1).map(function(r) { return String(r[0]).trim(); });

  var params = [
    ['QP001','GSM (Grammage)','gsm','','','','Measurement','Weigh a 10×10 cm sample on precision balance. Calculate GSM = weight × 100.','Precision balance, 10×10cm cutter','IS 1060 / client spec','PM/QC/001'],
    ['QP002','Thickness','micron','','','','Measurement','Measure at 5 points (corners + centre) with micrometer. Record average.','Micrometer / thickness gauge','IS 14534','PM/QC/002'],
    ['QP003','Print Quality — Colour Match','','Pass/Fail','','','Visual','Compare printed sample against approved colour standard under D65 light source.','D65 light box, colour standard','Colour standard card','PM/QC/003'],
    ['QP004','Print Registration','mm','0','','0.5','Measurement','Measure misregistration between colour layers using loupe or comparator.','Loupe, steel rule','IS 4711','PM/QC/004'],
    ['QP005','Barcode Readability','Grade','A','B','A','Test','Scan barcode with verifier. Grade must be ≥ B. Check quiet zones and bar width.','Barcode verifier (ISO 15416)','ISO 15416','PM/QC/005'],
    ['QP006','Seal Strength','N/15mm','','Min as per spec','','Test','Cut 15mm strip across seal. Pull on tensile tester at 300 mm/min. Record peak force.','Tensile tester, sample cutter','ASTM F88','PM/QC/006'],
    ['QP007','Seal Integrity — Visual','','Pass/Fail','','','Visual','Inspect seal for continuity, wrinkles, voids, foreign material. No gaps/channels allowed.','Light box, magnifying glass','Internal SOP','PM/QC/007'],
    ['QP008','Bursting Strength','kPa','','Min as per spec','','Test','Place sample on Mullen tester. Apply hydraulic pressure until burst. Record value.','Mullen burst tester','IS 1060 Part 5','PM/QC/008'],
    ['QP009','Dimensions — Length × Width','mm','As per spec','−1','+1','Measurement','Measure with steel rule / calliper at 3 places. Average must be within tolerance.','Steel rule, vernier calliper','Drawing / spec sheet','PM/QC/009'],
    ['QP010','Peel Strength (Label)','g/25mm','','Min 200','','Test','Apply label to standard substrate. Peel at 180° angle. Record force.','Peel strength tester','ASTM D903','PM/QC/010'],
    ['QP011','Adhesion — Tape','','Pass/Fail','','','Test','Apply tape, press firmly, peel at 90°. Print must not lift. No delamination.','Standard substrate panel','Internal SOP','PM/QC/011'],
    ['QP012','Moisture Content','%','','','Max as per spec','Test','Weigh sample before and after oven drying at 105°C for 2 hrs. Calculate % moisture.','Moisture balance / oven + balance','IS 1060 Part 3','PM/QC/012'],
    ['QP013','Ink Adhesion (Tape Test)','%','100','90','100','Test','Apply 3M #610 tape on print, press, remove at 90°. No ink pull-off allowed. Rate visually.','3M #610 tape, magnifier','ASTM D3359','PM/QC/013'],
    ['QP014','Fill Weight / Net Weight','g','As per spec','−0.5%','+0.5%','Measurement','Weigh filled unit on calibrated balance. Tare pack, record net weight.','Calibrated weighing balance','Legal Metrology Act','PM/QC/014'],
    ['QP015','Appearance — Surface Defects','','Pass/Fail','','','Visual','Inspect under normal light for scratches, pinholes, contamination, streaks, wrinkles.','Light box','Internal SOP','PM/QC/015'],
    ['QP016','Carton Compression Strength','N','','Min as per spec','','Test','Place carton on compression tester. Apply load at 12 mm/min until failure.','Compression tester (BCT)','IS 7063','PM/QC/016'],
    ['QP017','Drop Test','','Pass/Fail','','','Test','Drop filled pack from 1m height on each face (6 faces). No leakage or structural failure.','Drop height jig / flat surface','ISTA 1A / client spec','PM/QC/017'],
    ['QP018','Leak Test','','Pass/Fail','','','Test','Submerge sealed pack in water for 30 sec. No air bubbles / water ingress.','Water bath','Internal SOP','PM/QC/018'],
    ['QP019','Label Placement','mm','As per spec','−1','+1','Measurement','Measure label position from reference edge using calliper. Check top, bottom, side offsets.','Vernier calliper, steel rule','Label spec drawing','PM/QC/019'],
    ['QP020','Quantity / Count','pcs','As per spec','0','0','Count','Count units in pack/box. Must equal declared quantity exactly.','Manual count / counter','Packing spec','PM/QC/020'],
    ['QP021','Gross Weight','g','As per spec','−1%','+1%','Measurement','Weigh filled and sealed pack including all packaging on calibrated balance. Record gross weight.','Calibrated weighing balance','Legal Metrology Act','PM/QC/021'],
    ['QP022','Net Weight','g','As per spec','−0.5%','+0.5%','Measurement','Tare the empty pack, then weigh filled unit. Net weight = gross − tare. Must be within tolerance.','Calibrated weighing balance','Legal Metrology Act','PM/QC/022']
  ];

  params.forEach(function(p) {
    if (existing.indexOf(p[0]) === -1) {
      ws.appendRow(p);
    }
  });
  return { ok: true, inserted: params.filter(function(p) { return existing.indexOf(p[0]) === -1; }).length };
}

function getRecentGRNs() {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName('GRN_LOG');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  if (data.length < 2) return [];

  // Build supplier email lookup from MASTERS_Suppliers
  var emailMap = {};
  try {
    var suppWs = ss.getSheetByName('MASTERS_Suppliers');
    if (suppWs && suppWs.getLastRow() > 1) {
      suppWs.getDataRange().getValues().slice(1).forEach(function(r) {
        if (r[0]) emailMap[String(r[0]).trim()] = String(r[4] || '').trim();
      });
    }
  } catch(e) {}

  // Map all rows, reverse to most-recent-first, then deduplicate by grnNo
  var mapped = data.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        grnNo:         r[0],
        date:          r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
        supplierCode:  String(r[2] || '').trim(),
        supplierName:  r[3],
        supplierEmail: emailMap[String(r[2] || '').trim()] || '',
        material:      r[7],
        batch:         r[8],
        iqcStatus:     r[15] || 'PENDING'
      };
    })
    .reverse();

  // Deduplicate: keep first occurrence per grnNo in reversed (most-recent-first) order
  var seen = {};
  var deduped = [];
  mapped.forEach(function(g) {
    if (!seen[g.grnNo]) {
      seen[g.grnNo] = true;
      deduped.push(g);
    }
  });

  return deduped.slice(0, 30);
}

function getFormInitData() {
  return {
    suppliers:  getSuppliers(),
    materials:  getMaterials(),
    customers:  getCustomers(),
    inspectors: getInspectors(),
    aqlLevels:  ['AQL 0.65', 'AQL 1.0', 'AQL 2.5', 'AQL 4.0', 'AQL 6.5'],
    defaultAql: 'AQL 2.5'
  };
}

function saveMaster(type, data) {
  var ss = getSpreadsheet();
  var sheetName, row;

  if (type === 'supplier') {
    var ws = ss.getSheetByName('MASTERS_Suppliers');
    if (!ws) throw new Error('Sheet MASTERS_Suppliers not found');
    row = [data.code, data.name, data.contact, data.phone, data.email || '', data.material, data.city, data.approved];
    sheetName = 'MASTERS_Suppliers';
    var values = ws.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(data.code).trim()) {
        ws.getRange(i + 1, 1, 1, row.length).setValues([row]);
        return { ok: true };
      }
    }
    ws.appendRow(row);

  } else if (type === 'material') {
    var ws2 = ss.getSheetByName('MASTERS_Materials');
    if (!ws2) throw new Error('Sheet MASTERS_Materials not found');
    ensureMaterialsLocationColumn_();
    ensureMaterialsGeometryColumns_();
    var patch = {};
    patch[MAT_COL.CODE] = data.code;
    patch[MAT_COL.DESC] = data.desc;
    patch[MAT_COL.UNIT] = data.unit;
    patch[MAT_COL.CATEGORY] = data.category;
    patch[MAT_COL.DEFAULT_LOCATION] = data.defaultLocation || '';
    _applyGeometryToPatch_(patch, data);   // cols G→L (blank fields omitted → preserved)
    return _upsertMaterialRow_(ws2, data.code, patch);

  } else if (type === 'customer') {
    var ws3 = ss.getSheetByName('MASTERS_Customers');
    if (!ws3) throw new Error('Sheet MASTERS_Customers not found');
    row = [data.code, data.name, data.contact, data.phone, data.email, data.products, data.city];
    var values3 = ws3.getDataRange().getValues();
    for (var k = 1; k < values3.length; k++) {
      if (String(values3[k][0]).trim() === String(data.code).trim()) {
        ws3.getRange(k + 1, 1, 1, row.length).setValues([row]);
        return { ok: true };
      }
    }
    ws3.appendRow(row);

  } else if (type === 'inspector') {
    var ws4 = ss.getSheetByName('MASTERS_Personnel');
    if (!ws4) throw new Error('Sheet MASTERS_Personnel not found');
    row = [data.name, data.role, data.dept, data.phone, data.notify];
    var values4 = ws4.getDataRange().getValues();
    for (var l = 1; l < values4.length; l++) {
      if (String(values4[l][0]).trim() === String(data.name).trim()) {
        ws4.getRange(l + 1, 1, 1, row.length).setValues([row]);
        return { ok: true };
      }
    }
    ws4.appendRow(row);

  } else if (type === 'fg') {
    var wsFG = ss.getSheetByName('MASTERS_Materials');
    if (!wsFG) throw new Error('Sheet MASTERS_Materials not found');
    var fgPatch = {};
    fgPatch[MAT_COL.CODE] = data.code;
    fgPatch[MAT_COL.DESC] = data.name;
    fgPatch[MAT_COL.UNIT] = data.uom;
    fgPatch[MAT_COL.CATEGORY] = 'FG';
    // Note: only A–D patched (mirrors the prior 4-col FG write); E–L are
    // preserved from the existing row rather than blanked as before.
    return _upsertMaterialRow_(wsFG, data.code, fgPatch);

  } else if (type === 'parameter') {
    var wsP = ss.getSheetByName('MASTERS_Parameters');
    if (!wsP) {
      wsP = ss.insertSheet('MASTERS_Parameters');
      wsP.appendRow(['code', 'name', 'unit', 'std_value', 'tol_min', 'tol_max', 'method_type', 'check_brief', 'tools', 'doc_ref', 'doc_number']);
    }
    row = [data.code, data.name, data.unit, data.stdValue, data.tolMin, data.tolMax, data.methodType, data.checkBrief, data.tools, data.docRef, data.docNumber];
    var vP = wsP.getDataRange().getValues();
    for (var n = 1; n < vP.length; n++) {
      if (String(vP[n][0]).trim() === String(data.code).trim()) {
        wsP.getRange(n + 1, 1, 1, row.length).setValues([row]);
        return { ok: true };
      }
    }
    wsP.appendRow(row);

  } else {
    throw new Error('Unknown master type: ' + type);
  }

  return { ok: true };
}

// Read-modify-write a MASTERS_Materials row to a full 12-col width by index.
// `patch` maps a 0-based column index (see MAT_COL) → new value. Any column
// NOT in the patch is preserved from the existing row, so pre-existing cols
// F→L (Phase-2 geometry) always survive an edit instead of being truncated.
// New rows are written as a full 12-col row (patched cols set, rest blank) so
// the row shape is consistent. Physically short rows are padded, not errored.
function _upsertMaterialRow_(ws, code, patch) {
  var values = ws.getDataRange().getValues();
  var target = String(code).trim();

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][MAT_COL.CODE]).trim() !== target) continue;
    var existing = _padMaterialRow_(values[r]);          // preserve F→L
    _applyMaterialPatch_(existing, patch);
    ws.getRange(r + 1, 1, 1, MAT_WIDTH).setValues([existing]);
    return { ok: true };
  }

  var fresh = _padMaterialRow_([]);                        // MAT_WIDTH blanks
  _applyMaterialPatch_(fresh, patch);
  ws.appendRow(fresh);
  return { ok: true };
}

// Return a 12-element copy of a raw sheet row: existing cells kept, missing
// trailing cells filled with '' so a physically short row never clips on write.
function _padMaterialRow_(rawRow) {
  var out = [];
  for (var c = 0; c < MAT_WIDTH; c++) {
    out.push(c < rawRow.length && rawRow[c] != null ? rawRow[c] : '');
  }
  return out;
}

// Copy the 6 geometry fields (G→L) from a form `data` object into a save patch.
// A key present in `data` is written (blank included, so the user can clear a
// field); a key ABSENT from `data` is left out of the patch so the existing cell
// survives untouched — this is what lets non-form callers (e.g. the `fg` branch)
// preserve geometry. Numeric fields are coerced to a positive number or '';
// fitClass is normalized to 'WEIGHT' | 'VOLUME' | ''. eachVolume is never written.
function _applyGeometryToPatch_(patch, data) {
  MAT_GEOMETRY_COLS.forEach(function(g) {
    if (!data.hasOwnProperty(g.key)) return;
    patch[g.col] = (g.key === 'fitClass') ? _normalizeFitClass_(data[g.key]) : _geoNum_(data[g.key]);
  });
}

// fitClass is a display hint only. Accept WEIGHT|VOLUME (any case); anything else
// (including blank) stores '' — the fit engine computes the real ceiling regardless.
function _normalizeFitClass_(v) {
  var s = String(v || '').trim().toUpperCase();
  return (s === 'WEIGHT' || s === 'VOLUME') ? s : '';
}

// Ensures MASTERS_Materials carries the 6 geometry headers in cols G→L. Sibling
// to ensureMaterialsLocationColumn_ (which only guards col E). Idempotent — writes
// a header only where the cell is blank, so existing data/headers are never
// clobbered. Also ensures col F carries a reorderLevel header when blank.
function ensureMaterialsGeometryColumns_() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return;
  if (!String(ws.getRange(1, MAT_COL.REORDER_LEVEL + 1).getValue() || '').trim()) {
    _writeMaterialHeader_(ws, MAT_COL.REORDER_LEVEL + 1, 'Reorder Level');
  }
  MAT_GEOMETRY_COLS.forEach(function(g) {
    var cell = ws.getRange(1, g.col + 1);
    if (!String(cell.getValue() || '').trim()) _writeMaterialHeader_(ws, g.col + 1, g.header);
  });
}

// Write a styled header cell matching the col-E header style set elsewhere.
function _writeMaterialHeader_(ws, colNum, text) {
  ws.getRange(1, colNum).setValue(text)
    .setFontWeight('bold').setBackground('#0B2A4A').setFontColor('#FFFFFF');
}

function _applyMaterialPatch_(row, patch) {
  Object.keys(patch).forEach(function(idxKey) {
    var idx = Number(idxKey);
    if (idx >= 0 && idx < MAT_WIDTH) row[idx] = patch[idxKey];
  });
}

// ------------------------------------------------------------
// Runnable GAS-editor assert for the 12-col truncation fix (RISK-3).
// Operates on a throwaway sandbox sheet so the real MASTERS_Materials is
// never mutated. Run directly from the Apps Script editor; pass/fail is
// Logger-based and also returned.
// ------------------------------------------------------------
function _testSaveMaterialWidth() {
  var ss = getSpreadsheet();
  var name = '_TEST_MASTERS_Materials';
  var ws = ss.getSheetByName(name);
  if (ws) ss.deleteSheet(ws);
  ws = ss.insertSheet(name);

  var results = [];
  function assert(cond, msg) {
    results.push({ pass: !!cond, msg: msg });
    Logger.log((cond ? 'PASS ' : 'FAIL ') + msg);
  }

  try {
    // Header + one legacy 5-col material plus a value planted in F→L (G,J,L).
    ws.appendRow(['Item Code', 'Description', 'Unit', 'Category', 'Default Location']);
    var seeded = _padMaterialRow_(['M1', 'Old Desc', 'kg', 'RM', 'B001']);
    seeded[6] = 'GEO-G';    // col G (index 6)
    seeded[9] = 'GEO-J';    // col J (index 9)
    seeded[11] = 'GEO-L';   // col L (index 11)
    ws.getRange(2, 1, 1, MAT_WIDTH).setValues([seeded]);

    // Edit ONLY an unrelated field (desc) via the real write engine.
    var patch = {};
    patch[MAT_COL.DESC] = 'New Desc';
    _upsertMaterialRow_(ws, 'M1', patch);

    var afterEdit = ws.getRange(2, 1, 1, MAT_WIDTH).getValues()[0];
    assert(afterEdit.length === MAT_WIDTH, 'edited row is exactly 12 cols wide (was ' + afterEdit.length + ')');
    assert(afterEdit[MAT_COL.DESC] === 'New Desc', 'unrelated edit applied (desc)');
    assert(afterEdit[MAT_COL.CATEGORY] === 'RM', 'col D (category) preserved');
    assert(afterEdit[MAT_COL.DEFAULT_LOCATION] === 'B001', 'col E (defaultLocation) preserved');
    assert(afterEdit[6] === 'GEO-G', 'col G survived edit (NOT truncated)');
    assert(afterEdit[9] === 'GEO-J', 'col J survived edit (NOT truncated)');
    assert(afterEdit[11] === 'GEO-L', 'col L survived edit (NOT truncated)');

    // Backward-compat: a brand-new material writes a clean 12-col row, F→L blank.
    var newPatch = {};
    newPatch[MAT_COL.CODE] = 'M2';
    newPatch[MAT_COL.DESC] = 'Fresh';
    newPatch[MAT_COL.UNIT] = 'pcs';
    newPatch[MAT_COL.CATEGORY] = 'PM';
    _upsertMaterialRow_(ws, 'M2', newPatch);
    var m2 = ws.getRange(3, 1, 1, MAT_WIDTH).getValues()[0];
    assert(m2.length === MAT_WIDTH, 'new material row is 12 cols (was ' + m2.length + ')');
    assert(m2[MAT_COL.CODE] === 'M2' && m2[MAT_COL.DESC] === 'Fresh', 'new material A–B written');
    var geomBlank = true;
    for (var c = 6; c < MAT_WIDTH; c++) { if (m2[c] !== '') geomBlank = false; }
    assert(geomBlank, 'new material F→L (geometry) blank, no garbage/undefined');

    // Edge: a physically short (<12 col) row pads rather than errors on edit.
    ws.appendRow(['M3', 'Short', 'kg']);   // only 3 cols physically
    var shortPatch = {};
    shortPatch[MAT_COL.DEFAULT_LOCATION] = 'B005';
    _upsertMaterialRow_(ws, 'M3', shortPatch);
    var m3 = ws.getRange(4, 1, 1, MAT_WIDTH).getValues()[0];
    assert(m3.length === MAT_WIDTH, 'short row padded to 12 cols on edit');
    assert(m3[MAT_COL.DEFAULT_LOCATION] === 'B005', 'short row patch applied after padding');
  } finally {
    var tmp = ss.getSheetByName(name);
    if (tmp) ss.deleteSheet(tmp);
  }

  var failed = results.filter(function(x) { return !x.pass; });
  var summary = (failed.length ? 'FAIL' : 'PASS') + ' — ' +
    (results.length - failed.length) + '/' + results.length + ' asserts passed';
  Logger.log(summary);
  return { ok: failed.length === 0, summary: summary, results: results };
}

// ------------------------------------------------------------
// Runnable GAS-editor assert for Step-5 material geometry (cols G→L).
// Sandbox sheet only — the real MASTERS_Materials is never touched. Proves:
//  1. the 6 geometry fields round-trip through the save patch + read mapping;
//  2. editing an unrelated field (desc) leaves geometry intact (Step-4 RMW);
//  3. eachVolume is derived (L×W×H), never stored in a column;
//  4. fitClass normalizes to WEIGHT|VOLUME, blank otherwise.
// Logger-based pass/fail, also returned.
// ------------------------------------------------------------
function _testMaterialGeometry() {
  var ss = getSpreadsheet();
  var name = '_TEST_MASTERS_Geometry';
  var ws = ss.getSheetByName(name);
  if (ws) ss.deleteSheet(ws);
  ws = ss.insertSheet(name);

  var results = [];
  function assert(cond, msg) {
    results.push({ pass: !!cond, msg: msg });
    Logger.log((cond ? 'PASS ' : 'FAIL ') + msg);
  }

  // Mirror getMaterials' flat geometry mapping against a single sandbox row.
  function readGeometry(code) {
    var vals = ws.getDataRange().getValues();
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][MAT_COL.CODE]).trim() !== String(code).trim()) continue;
      var r = vals[i];
      return {
        eachL: _geoNum_(r[MAT_COL.EACH_L]), eachW: _geoNum_(r[MAT_COL.EACH_W]),
        eachH: _geoNum_(r[MAT_COL.EACH_H]), eachWeight: _geoNum_(r[MAT_COL.EACH_WEIGHT]),
        perPallet: _geoNum_(r[MAT_COL.PER_PALLET]),
        fitClass: String(r[MAT_COL.FIT_CLASS] || '').trim()
      };
    }
    return null;
  }

  try {
    ws.appendRow(['Item Code', 'Description', 'Unit', 'Category', 'Default Location']);

    // Save a material WITH geometry through the same patch path saveMaster uses.
    var patch = {};
    patch[MAT_COL.CODE] = 'G1';
    patch[MAT_COL.DESC] = 'Boxed FG';
    patch[MAT_COL.CATEGORY] = 'FG';
    _applyGeometryToPatch_(patch, {
      eachL: 300, eachW: 200, eachH: 150, eachWeight: 27, perPallet: 16, fitClass: 'weight'
    });
    _upsertMaterialRow_(ws, 'G1', patch);

    var g = readGeometry('G1');
    assert(g.eachL === 300 && g.eachW === 200 && g.eachH === 150, 'each L/W/H round-trip');
    assert(g.eachWeight === 27, 'eachWeight round-trip');
    assert(g.perPallet === 16, 'perPallet (TIxHI) round-trip');
    assert(g.fitClass === 'WEIGHT', 'fitClass normalized to WEIGHT');

    // eachVolume is COMPUTED, never a stored column.
    var vol = g.eachL * g.eachW * g.eachH;
    assert(vol === 9000000, 'eachVolume computed L*W*H, not stored');
    var row = ws.getRange(2, 1, 1, MAT_WIDTH).getValues()[0];
    assert(row.length === MAT_WIDTH, 'row is exactly 12 cols (no volume overflow col)');

    // Edit an UNRELATED field — geometry must survive (Step-4 RMW).
    var editPatch = {};
    editPatch[MAT_COL.DESC] = 'Boxed FG v2';
    _upsertMaterialRow_(ws, 'G1', editPatch);
    var g2 = readGeometry('G1');
    assert(g2.eachL === 300 && g2.eachWeight === 27 && g2.perPallet === 16 && g2.fitClass === 'WEIGHT',
      'geometry survives an unrelated-field edit');
    assert(ws.getRange(2, MAT_COL.DESC + 1).getValue() === 'Boxed FG v2', 'unrelated edit applied');

    // Blank / invalid geometry → '' (falsy), and unknown fitClass → ''.
    var blankPatch = {};
    blankPatch[MAT_COL.CODE] = 'G2';
    _applyGeometryToPatch_(blankPatch, { eachL: '', eachWeight: 0, fitClass: 'bogus' });
    _upsertMaterialRow_(ws, 'G2', blankPatch);
    var gb = readGeometry('G2');
    assert(gb.eachL === '' && gb.eachWeight === '', 'blank/non-positive geometry stores as blank');
    assert(gb.fitClass === '', 'unrecognized fitClass stored as blank');
  } finally {
    var tmp = ss.getSheetByName(name);
    if (tmp) ss.deleteSheet(tmp);
  }

  var failed = results.filter(function(x) { return !x.pass; });
  var summary = (failed.length ? 'FAIL' : 'PASS') + ' — ' +
    (results.length - failed.length) + '/' + results.length + ' asserts passed';
  Logger.log(summary);
  return { ok: failed.length === 0, summary: summary, results: results };
}

function deleteMaster(type, code) {
  var ss = getSpreadsheet();
  var ws;

  if (type === 'supplier') {
    ws = ss.getSheetByName('MASTERS_Suppliers');
    if (!ws) throw new Error('Sheet MASTERS_Suppliers not found');
  } else if (type === 'material') {
    ws = ss.getSheetByName('MASTERS_Materials');
    if (!ws) throw new Error('Sheet MASTERS_Materials not found');
  } else if (type === 'customer') {
    ws = ss.getSheetByName('MASTERS_Customers');
    if (!ws) throw new Error('Sheet MASTERS_Customers not found');
  } else if (type === 'inspector') {
    ws = ss.getSheetByName('MASTERS_Personnel');
    if (!ws) throw new Error('Sheet MASTERS_Personnel not found');
  } else if (type === 'fg') {
    ws = ss.getSheetByName('MASTERS_Materials');
    if (!ws) throw new Error('Sheet MASTERS_Materials not found');
  } else if (type === 'parameter') {
    ws = ss.getSheetByName('MASTERS_Parameters');
    if (!ws) throw new Error('Sheet MASTERS_Parameters not found');
  } else {
    throw new Error('Unknown master type: ' + type);
  }

  var values = ws.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(code).trim()) {
      ws.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('Record not found: ' + code);
}
