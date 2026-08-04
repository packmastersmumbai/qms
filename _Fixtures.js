// _Fixtures.js — Phase 3A: a seeded, known-state session the e2e suite can drive
// deterministically. This is the blocker behind the e2e coverage gap: the suite
// was 153/153 green while GRN's save was reported dead, and savepaths coverage
// swung 3 -> 1 -> 2 forms across one session with NO code change, purely because
// live sheet data moved underneath it.
//
//   ?diag=fixtures                    → report current fixture state
//   ?diag=fixtureseed&confirm=YES     → create/refresh the fixture set
//   ?diag=fixtureclear&confirm=YES    → archive every fixture row
//
// WHY A FIXTURE GRN IS VISIBLE, AND STAYS VISIBLE
// getUnInspectedGRNs (IQC.js:191) offers a GRN until an IQC_LOG row references
// it, and getRecentGRNs (Masters.js:416) returns only the LAST 30 GRNs scanning
// bottom-up. So a fixture must be APPENDED (newest wins) and its IQC rows must be
// archived to make it selectable again. fixtureclear does exactly that, which is
// what makes a run repeatable rather than one-shot.
//
// Everything uses the established TEST/ docNo convention (_TestHelpers.js) so
// fixtures never consume a real audit sequence number and archiveTestRows can
// reclaim them wholesale.

var FIX_PREFIX_      = 'TEST-FIX';
var FIX_SUPPLIER_    = 'TEST-FIX-SUP';
var FIX_MATERIAL_    = 'TEST-FIX-MAT';
var FIX_BATCH_       = 'TEST-FIX-BATCH';
// A category with params that carry a REAL unit + measuring method, so the
// tolerance-advisory path (IQC_F.html) actually renders a reading input. CARTON
// qualifies: CT_DIM/CT_GSM/CT_BURST/CT_ECT are Dimensional/Gravimetric/Mechanical.
var FIX_CATEGORY_    = 'CARTON';
var FIX_QTY_         = 1000;

function _fixFindRow_(ws, col, value) {
  if (!ws || ws.getLastRow() < 2) return 0;
  var vals = ws.getRange(2, col + 1, ws.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === value) return i + 2;
  }
  return 0;
}

// ── Report ───────────────────────────────────────────────────────────────────
function fixtureState() {
  var ss = getSpreadsheet();
  var out = ['PM QMS e2e fixtures — STATE'];
  out.push('');

  var supWs = ss.getSheetByName('MASTERS_Suppliers');
  var matWs = ss.getSheetByName('MASTERS_Materials');
  var grnWs = ss.getSheetByName('GRN_LOG');
  var iqcWs = ss.getSheetByName('IQC_LOG');

  out.push('supplier ' + FIX_SUPPLIER_ + ': ' +
           (_fixFindRow_(supWs, 0, FIX_SUPPLIER_) ? 'present' : 'MISSING'));

  var matRow = _fixFindRow_(matWs, 0, FIX_MATERIAL_);
  if (matRow) {
    var cat = String(matWs.getRange(matRow, MAT_COL.INSP_CATEGORY + 1).getValue() || '').trim();
    out.push('material ' + FIX_MATERIAL_ + ': present, inspectionCategory=' +
             (cat || '(BLANK — IQC would fall back to generic params)'));
  } else out.push('material ' + FIX_MATERIAL_ + ': MISSING');

  // Fixture GRNs, and whether each is still IQC-selectable.
  var grns = [];
  if (grnWs && grnWs.getLastRow() > 1) {
    grnWs.getRange(2, 1, grnWs.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var v = String(r[0] || '').trim();
      if (v.indexOf(FIX_PREFIX_) === 0 && grns.indexOf(v) === -1) grns.push(v);
    });
  }
  var inspected = {};
  if (iqcWs && iqcWs.getLastRow() > 1) {
    iqcWs.getRange(2, 3, iqcWs.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (r[0]) inspected[String(r[0]).trim()] = true;
    });
  }
  out.push('');
  out.push('fixture GRNs: ' + grns.length);
  grns.forEach(function (g) {
    out.push('   ' + g + (inspected[g] ? '  — already inspected (NOT selectable)' : '  — selectable in IQC'));
  });

  // Rework queue — getReworkItems only lists OPEN / IN_PROGRESS rows.
  var rwWs = ss.getSheetByName('REWORK_LOG');
  var rwOpen = 0;
  if (rwWs && rwWs.getLastRow() > 1) {
    rwWs.getDataRange().getValues().slice(1).forEach(function (r) {
      if (String(r[0] || '').indexOf(FIX_PREFIX_) === 0 &&
          ['OPEN', 'IN_PROGRESS'].indexOf(String(r[10] || '').toUpperCase()) >= 0) rwOpen++;
    });
  }
  out.push('');
  out.push('open fixture rework items: ' + rwOpen +
           (rwOpen ? '  — Rework form has something to complete' : '  — Rework will SKIP'));

  // The 30-row visibility window is the reason fixtures silently vanish.
  if (grnWs && grnWs.getLastRow() > 1) {
    var all = grnWs.getRange(2, 1, grnWs.getLastRow() - 1, 1).getValues();
    var seen = {}, recent = [];
    for (var i = all.length - 1; i >= 0 && recent.length < 30; i--) {
      var k = String(all[i][0] || '').trim();
      if (!k || seen[k]) continue;
      seen[k] = true; recent.push(k);
    }
    var inWindow = grns.filter(function (g) { return recent.indexOf(g) !== -1; });
    out.push('');
    out.push('getRecentGRNs window (last 30): ' + inWindow.length + '/' + grns.length +
             ' fixture GRNs visible');
    if (grns.length && inWindow.length < grns.length) {
      out.push('   !! live receipts have pushed fixtures out of the window — re-seed.');
    }
  }
  return out.join('\n');
}

// ── Seed ─────────────────────────────────────────────────────────────────────
function seedFixtures(apply) {
  if (!CONFIG._TESTING_ENABLED) return 'testing disabled (CONFIG._TESTING_ENABLED)';
  var ss = getSpreadsheet();
  var out = ['PM QMS e2e fixtures — ' + (apply ? 'SEED (LIVE)' : 'SEED (DRY RUN)')];
  out.push('');

  var supWs = ss.getSheetByName('MASTERS_Suppliers');
  var matWs = ss.getSheetByName('MASTERS_Materials');
  var grnWs = ss.getSheetByName('GRN_LOG');
  if (!supWs || !matWs || !grnWs) return 'ABORT: a required master/log sheet is missing.';

  var plan = [];
  var supRow = _fixFindRow_(supWs, 0, FIX_SUPPLIER_);
  plan.push({ what: 'supplier ' + FIX_SUPPLIER_, act: supRow ? 'exists — leave' : 'CREATE (approved)' });

  var matRow = _fixFindRow_(matWs, 0, FIX_MATERIAL_);
  if (!matRow) {
    plan.push({ what: 'material ' + FIX_MATERIAL_, act: 'CREATE (category ' + FIX_CATEGORY_ + ')' });
  } else {
    var curCat = String(matWs.getRange(matRow, MAT_COL.INSP_CATEGORY + 1).getValue() || '').trim();
    plan.push({ what: 'material ' + FIX_MATERIAL_,
                act: curCat === FIX_CATEGORY_ ? 'exists — leave'
                                              : 'SET inspectionCategory ' + (curCat || '(blank)') + ' -> ' + FIX_CATEGORY_ });
  }

  // Reuse an existing SELECTABLE fixture GRN instead of minting another. Without
  // this, every seed appended one more and they accumulated (3 after three runs)
  // — each consuming a slot in the 30-row getRecentGRNs window that live
  // receipts also compete for. Only mint when none is selectable.
  var grnNo = '', reused = false;
  var iqcWs0 = ss.getSheetByName('IQC_LOG');
  var inspected0 = {};
  if (iqcWs0 && iqcWs0.getLastRow() > 1) {
    iqcWs0.getRange(2, 3, iqcWs0.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (r[0]) inspected0[String(r[0]).trim()] = true;
    });
  }
  if (grnWs.getLastRow() > 1) {
    var gAll = grnWs.getRange(2, 1, grnWs.getLastRow() - 1, 1).getValues();
    for (var gi = gAll.length - 1; gi >= 0; gi--) {
      var gv = String(gAll[gi][0] || '').trim();
      if (gv.indexOf(FIX_PREFIX_) === 0 && !inspected0[gv]) { grnNo = gv; reused = true; break; }
    }
  }
  if (!grnNo) grnNo = _testNextSeq_(FIX_PREFIX_ + '/GRN');
  plan.push({ what: 'GRN ' + grnNo,
              act: reused ? 'exists and is IQC-selectable — reuse'
                          : 'CREATE — ' + FIX_QTY_ + ' units, appended (newest)' });

  plan.forEach(function (p) { out.push('  ' + p.what + ': ' + p.act); });
  out.push('');

  if (!apply) {
    _seedReworkFixture_(ss, out, false);
    _seedFgLotFixture_(ss, out, false);
    _seedOutboundGatepass_(ss, out, false);
    out.push('');
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  // Supplier — approved, or it will not appear in the GRN supplier dropdown.
  // Schema (Initialize.js:315): Supplier Code | Supplier Name | Contact Person |
  // Phone / WhatsApp | Material Supplied | City / Location | Approved (Y/N) | State Code
  if (!supRow) {
    var sup = new Array(Math.max(8, supWs.getLastColumn())).fill('');
    sup[0] = FIX_SUPPLIER_;
    sup[1] = 'E2E Fixture Supplier (do not use)';
    sup[2] = 'E2E Fixture';
    sup[4] = 'E2E Fixture Carton';
    sup[5] = 'Mumbai';
    sup[6] = 'Y';   // Approved — index 6, verified against Initialize.js:315
    supWs.appendRow(sup);
  }

  // Material — categorised, so IQC serves CARTON params rather than the generic
  // fallback. Written positionally through MAT_COL, never by raw index.
  if (!matRow) {
    var mat = new Array(MAT_WIDTH).fill('');
    mat[MAT_COL.CODE]          = FIX_MATERIAL_;
    mat[MAT_COL.DESC]          = 'E2E Fixture Carton (do not use)';
    mat[MAT_COL.UNIT]          = 'NOS';
    mat[MAT_COL.CATEGORY]      = 'RM';
    // A blank default location is the ghost-location root cause (Phase 1 closed
    // 128 -> 0). A fixture must not reintroduce the very defect the system now
    // guards against, so it gets a real, existing RM location.
    mat[MAT_COL.DEFAULT_LOCATION] = 'RM-STORE-A';
    mat[MAT_COL.INSP_CATEGORY] = FIX_CATEGORY_;
    matWs.appendRow(mat);
  } else {
    matWs.getRange(matRow, MAT_COL.INSP_CATEGORY + 1).setValue(FIX_CATEGORY_);
  }

  // GRN — appended so it lands inside the last-30 window. Skipped entirely when
  // an existing fixture GRN is still selectable (see the reuse check above).
  if (reused) {
    out.push('');
    _seedReworkFixture_(ss, out, true);
    _seedFgLotFixture_(ss, out, true);
    _seedOutboundGatepass_(ss, out, true);
    out.push('');
    out.push('SEEDED (GRN reused).');
    out.push('  GRN: ' + grnNo + '  material: ' + FIX_MATERIAL_ + '  category: ' + FIX_CATEGORY_);
    return out.join('\n');
  }
  var now = new Date();
  var g = new Array(GRN_HEADERS.length).fill('');
  g[0]  = grnNo;
  g[1]  = now;
  g[2]  = FIX_SUPPLIER_;
  g[3]  = 'E2E Fixture Supplier (do not use)';
  g[6]  = FIX_MATERIAL_;
  g[7]  = 'E2E Fixture Carton (do not use)';
  g[8]  = FIX_BATCH_;
  g[9]  = FIX_QTY_;
  g[10] = FIX_QTY_;
  g[11] = 'NOS';
  g[14] = 'E2E fixture row — safe to archive (?diag=fixtureclear)';
  g[15] = 'PENDING';
  g[16] = 'claude-e2e-fixture';
  g[17] = now;
  grnWs.appendRow(g);
  var lr = grnWs.getLastRow();
  grnWs.getRange(lr, 2).setNumberFormat('dd-MMM-yyyy');
  grnWs.getRange(lr, 18).setNumberFormat('dd-MMM-yyyy HH:mm');

  out.push('');
  _seedReworkFixture_(ss, out, true);
  _seedFgLotFixture_(ss, out, true);
  _seedOutboundGatepass_(ss, out, true);

  out.push('');
  out.push('SEEDED.');
  out.push('  GRN: ' + grnNo + '  material: ' + FIX_MATERIAL_ + '  category: ' + FIX_CATEGORY_);
  out.push('  This GRN is now IQC-selectable (no IQC_LOG row references it).');
  return out.join('\n');
}

// ── Rework queue fixture ─────────────────────────────────────────────────────
// getReworkItems (Rework.js:39) lists REWORK_LOG rows whose Status (col 10) is
// OPEN or IN_PROGRESS. With an empty queue the form renders but has nothing to
// complete, so its save path is untestable — reported as SKIPPED, indefinitely.
// Schema: REWORK_LOG_HEADERS (Initialize.js:271), 19 wide.
function _seedReworkFixture_(ss, out, apply) {
  var ws = ss.getSheetByName('REWORK_LOG');
  if (!ws) { out.push('REWORK_LOG: MISSING — skipped'); return; }

  // Already have an open fixture row? Then this is a no-op (idempotent).
  var existing = 0;
  if (ws.getLastRow() > 1) {
    var d = ws.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0] || '').indexOf(FIX_PREFIX_) === 0 &&
          ['OPEN', 'IN_PROGRESS'].indexOf(String(d[i][10] || '').toUpperCase()) >= 0) existing++;
    }
  }
  if (existing) { out.push('REWORK_LOG: ' + existing + ' open fixture row(s) — leave'); return; }
  out.push('REWORK_LOG: CREATE 1 open rework item');
  if (!apply) return;

  var now = new Date();
  var r = new Array(REWORK_LOG_HEADERS.length).fill('');
  r[0]  = _testNextSeq_(FIX_PREFIX_ + '/RW');
  r[1]  = now;
  r[2]  = 'E2E-FIXTURE';
  r[3]  = '';
  r[4]  = FIX_MATERIAL_;
  r[5]  = 'E2E Fixture Carton (do not use)';
  r[6]  = FIX_BATCH_;
  r[7]  = 50;
  r[8]  = 'NOS';
  r[9]  = 'RM-STORE-A';
  r[10] = 'OPEN';
  r[17] = 'E2E fixture row — safe to archive (?diag=fixtureclear)';
  // Material Type drives which ref field the form requires (Rework.js:126):
  // 'RM' asks for a re-IQC ref, 'FG' for a re-OQC ref. RM matches the fixture
  // material's category, so the form's own branch stays self-consistent.
  r[18] = 'RM';
  ws.appendRow(r);
  ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy');
}

// ── FG dispatch lot fixture ──────────────────────────────────────────────────
// Dispatch's FIFO picker builds chosenPlan from a server plan (Dispatch_F.html:525)
// that reads AVAILABLE rows out of FG_DISPATCH_LOTS. With no available lot the
// picker stays empty and the save path is unreachable.
//
// Delegates to createTestFGLot (_TestHelpers.js:191) rather than re-implementing
// the 19-column append — that helper already writes status AVAILABLE and the
// qtyReleased/qtyDispatched/qtyAvailable triple correctly.
function _seedFgLotFixture_(ss, out, apply) {
  var ws = ss.getSheetByName('FG_DISPATCH_LOTS');
  if (!ws) { out.push('FG_DISPATCH_LOTS: MISSING — skipped'); return; }

  var avail = 0;
  if (ws.getLastRow() > 1) {
    var d = ws.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      // col 14 (0-based) = Status, per the sheet-schema quick ref.
      if (String(d[i][0] || '').indexOf('TEST-FGL-') === 0 &&
          String(d[i][14] || '').toUpperCase() === 'AVAILABLE') avail++;
    }
  }
  if (avail) { out.push('FG_DISPATCH_LOTS: ' + avail + ' AVAILABLE test lot(s) — leave'); return; }
  out.push('FG_DISPATCH_LOTS: CREATE 1 AVAILABLE lot');
  if (!apply) return;

  var r = (typeof createTestFGLot === 'function')
    ? createTestFGLot({ qtyReleased: 500, batch: FIX_BATCH_ })
    : { success: false, error: 'createTestFGLot missing' };
  out.push('  ' + (r.success ? ('created ' + r.lotId) : ('FAILED: ' + r.error)));
}

// ── Outbound gatepass fixture (for CustomerReturn) ───────────────────────────
// getReturnableGatepasses (CustomerReturn.js:65-70) keeps only rows whose TYPE
// contains 'OUT' or 'DISPATCH', then filters by PARTY against the chosen
// customer. So the return form needs a real outbound gatepass addressed to a
// customer that exists in the customer dropdown — otherwise the cascade dead-ends
// at "no gatepasses for this customer".
//
// PARTY must match a REAL customer, not the fixture supplier: the form filters by
// the customer picked from MASTERS_Customers, so an invented party name would
// never be selectable.
function _seedOutboundGatepass_(ss, out, apply) {
  var ws = ss.getSheetByName('GATEPASS_LOG');
  if (!ws) { out.push('GATEPASS_LOG: MISSING — skipped'); return; }

  var existing = 0;
  if (ws.getLastRow() > 1) {
    var d = ws.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0] || '').indexOf(FIX_PREFIX_) === 0) existing++;
    }
  }
  if (existing) { out.push('GATEPASS_LOG: ' + existing + ' fixture gatepass(es) — leave'); return; }

  // Borrow the first real customer so the form's own dropdown can select it.
  var party = '';
  try {
    var cw = ss.getSheetByName('MASTERS_Customers');
    if (cw && cw.getLastRow() > 1) party = String(cw.getRange(2, 2).getValue() || '').trim();
  } catch (e) {}
  if (!party) { out.push('GATEPASS_LOG: no customer in MASTERS_Customers — skipped'); return; }

  out.push('GATEPASS_LOG: CREATE 1 outbound gatepass for "' + party + '"');
  if (!apply) return;

  var now = new Date();
  var g = new Array(GATEPASS_HEADERS.length).fill('');
  g[0]  = _testNextSeq_(FIX_PREFIX_ + '/GP');
  g[1]  = now;
  g[2]  = 'FG OUT';               // must contain OUT / DISPATCH
  g[3]  = '';                      // OQC_REF — optional; batch resolves via OQC_LOG
  g[4]  = party;
  g[5]  = FIX_MATERIAL_;
  g[6]  = 'E2E Fixture Carton (do not use)';
  g[7]  = 25;
  g[8]  = 'NOS';
  g[9]  = 'MH00FIX0000';
  g[10] = 'E2E FIXTURE DRIVER';
  g[12] = 'e2e-fixture';
  g[14] = 'E2E fixture row — safe to archive (?diag=fixtureclear)';
  g[15] = 'APPROVED';
  ws.appendRow(g);
  ws.getRange(ws.getLastRow(), 2).setNumberFormat('dd-MMM-yyyy');
}

// ── Clear ────────────────────────────────────────────────────────────────────
// Archives fixture rows rather than deleting, and — critically — removes the
// IQC_LOG rows that would otherwise keep the fixture GRN out of the dropdown.
function clearFixtures(apply) {
  if (!CONFIG._TESTING_ENABLED) return 'testing disabled (CONFIG._TESTING_ENABLED)';
  var ss = getSpreadsheet();
  var out = ['PM QMS e2e fixtures — ' + (apply ? 'CLEAR (LIVE)' : 'CLEAR (DRY RUN)')];
  out.push('');

  // IQC rows are matched on the GRN reference (col 3), not on their own docNo:
  // a REAL saveIQC against a fixture GRN mints a real IQC/… number, and leaving
  // that row behind would silently make the fixture unselectable for every
  // later run — the exact failure that made savepaths coverage drift.
  var targets = [];
  var iqcWs = ss.getSheetByName('IQC_LOG');
  if (iqcWs && iqcWs.getLastRow() > 1) {
    var iv = iqcWs.getRange(2, 1, iqcWs.getLastRow() - 1, 3).getValues();
    iv.forEach(function (r, i) {
      if (String(r[2] || '').trim().indexOf(FIX_PREFIX_) === 0) {
        targets.push({ sheet: 'IQC_LOG', row: i + 2, doc: String(r[0] || ''), ref: String(r[2] || '') });
      }
    });
  }
  out.push('IQC_LOG rows referencing a fixture GRN: ' + targets.length);
  targets.slice(0, 8).forEach(function (t) { out.push('   row ' + t.row + '  ' + t.doc + ' -> ' + t.ref); });
  out.push('');

  var grnWs = ss.getSheetByName('GRN_LOG');
  var grnRows = 0;
  if (grnWs && grnWs.getLastRow() > 1) {
    grnWs.getRange(2, 1, grnWs.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (String(r[0] || '').trim().indexOf(FIX_PREFIX_) === 0) grnRows++;
    });
  }
  out.push('GRN_LOG fixture rows: ' + grnRows);
  out.push('');
  out.push('Masters (supplier/material) are LEFT IN PLACE — they carry no doc');
  out.push('sequence and re-seeding reuses them.');
  out.push('');

  if (!apply) {
    out.push('DRY RUN — nothing written. Re-run with &confirm=YES.');
    return out.join('\n');
  }

  // Descending, so earlier deletions do not shift later row indices.
  if (iqcWs) {
    for (var i = targets.length - 1; i >= 0; i--) iqcWs.deleteRow(targets[i].row);
  }
  var moved = archiveTestRows('GRN_LOG', FIX_PREFIX_, 0);
  // Rework rows are keyed by their own docNo (col A), so archiveTestRows handles
  // them directly. Without this, re-seeding would pile up open queue items.
  var movedRw = archiveTestRows('REWORK_LOG', FIX_PREFIX_, 0);
  var movedFg = archiveTestRows('FG_DISPATCH_LOTS', 'TEST-FGL-', 0);
  var movedGp = archiveTestRows('GATEPASS_LOG', FIX_PREFIX_, 0);

  out.push('CLEARED.');
  out.push('  IQC_LOG rows removed:     ' + targets.length);
  out.push('  GRN_LOG rows archived:    ' + ((moved && moved.moved) || 0));
  out.push('  REWORK_LOG rows archived: ' + ((movedRw && movedRw.moved) || 0));
  out.push('  FG lot rows archived:     ' + ((movedFg && movedFg.moved) || 0));
  out.push('  GATEPASS rows archived:   ' + ((movedGp && movedGp.moved) || 0));
  return out.join('\n');
}
