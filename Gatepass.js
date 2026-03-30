// ============================================================
// Gatepass.gs — Save and read Gatepass records
// ============================================================

function getGatpassFormInit() {
  var suppliers = getSuppliers().map(function(s) {
    return { code: s.code, name: s.name, type: 'Supplier' };
  });
  var customers = getCustomers().map(function(c) {
    return { code: c.code, name: c.name, type: 'Customer' };
  });

  return {
    docNumber: peekNextDocNumber('gp'),
    parties:   suppliers.concat(customers),
    materials: getMaterials(),
    personnel: getInspectors(),
    today:     Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  };
}

function saveGatepass(data) {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName('GATEPASS_LOG');
    if (!ws) throw new Error('GATEPASS_LOG sheet not found. Run Setup first.');

    var docNo = getNextDocNumber('gp');
    var now   = new Date();
    var user  = Session.getActiveUser().getEmail() || 'QA';
    var date  = new Date(data.date);

    // Support multi-item array or fallback to single-item (backward compat)
    var items = (data.items && data.items.length > 0) ? data.items : [{
      materialCode: data.materialCode || '',
      materialDesc: data.materialDesc || '',
      qty:          data.qty          || '',
      unit:         data.unit         || ''
    }];

    items.forEach(function(item) {
      ws.appendRow([
        docNo,
        date,
        data.type          || '',
        data.oqcRef        || '',
        data.partyName     || '',
        item.materialCode  || '',
        item.materialDesc  || '',
        item.qty           || '',
        item.unit          || '',
        data.vehicleNo     || '',
        data.driverName    || '',
        data.transporter   || '',
        data.authorizedBy  || '',
        data.securityGuard || '',
        data.remarks       || '',
        'ISSUED',
        user,
        now,
        data.dispatchZone  || ''
      ]);
    });

    var lastRow  = ws.getLastRow();
    var startRow = lastRow - items.length + 1;
    for (var r = startRow; r <= lastRow; r++) {
      ws.getRange(r, 2).setNumberFormat('dd-MMM-yyyy');
      ws.getRange(r, 18).setNumberFormat('dd-MMM-yyyy HH:mm');
    }

    return { success: true, docNo: docNo };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}

function getGatewayRowForWA(row) {
  var ws = getSpreadsheet().getSheetByName('GATEPASS_LOG');
  if (!ws || row < 2) return null;
  var r = ws.getRange(row, 1, 1, 19).getValues()[0];
  if (!r[0]) return null;
  return {
    type:         'GATEPASS',
    docNo:        r[0],
    date:         r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'dd-MMM-yyyy') : '',
    dispatchType: r[2],
    oqcRef:       r[3],
    party:        r[4],
    materialCode: r[5],
    materialDesc: r[6],
    qty:          r[7],
    unit:         r[8],
    vehicleNo:    r[9],
    driverName:   r[10],
    transporter:  r[11],
    authorizedBy: r[12],
    status:       r[15] || 'ISSUED',
    createdBy:    r[16]
  };
}
