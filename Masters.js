// ============================================================
// Masters.gs — Server functions that return dropdown data
// Called by HTML forms via google.script.run
// ============================================================

function getSuppliers() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Suppliers');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0] && (r[7] === 'Y' || r[6] === 'Y'); })
    .map(function(r) { return { code: r[0], name: r[1], contact: r[2], phone: r[3], email: r[4] || '', material: r[5] || r[4] || '' }; });
}

function getMaterials() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return [];
  var data = ws.getDataRange().getValues();
  return data.slice(1).filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        code: String(r[0]).trim(),
        desc: r[1],
        unit: r[2],
        category: r[3],
        defaultLocation: String(r[4] || '').trim()
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
// Idempotent — only writes header if missing.
function ensureMaterialsLocationColumn_() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Materials');
  if (!ws) return;
  var lastCol = ws.getLastColumn();
  if (lastCol < 5) {
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
    row = [data.code, data.desc, data.unit, data.category, data.defaultLocation || ''];
    var values2 = ws2.getDataRange().getValues();
    for (var j = 1; j < values2.length; j++) {
      if (String(values2[j][0]).trim() === String(data.code).trim()) {
        ws2.getRange(j + 1, 1, 1, row.length).setValues([row]);
        return { ok: true };
      }
    }
    ws2.appendRow(row);

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
    row = [data.code, data.name, data.uom, 'FG'];
    var vFG = wsFG.getDataRange().getValues();
    for (var m = 1; m < vFG.length; m++) {
      if (String(vFG[m][0]).trim() === String(data.code).trim()) {
        wsFG.getRange(m + 1, 1, 1, row.length).setValues([row]);
        return { ok: true };
      }
    }
    wsFG.appendRow(row);

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
