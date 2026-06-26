// E2E — Masters, KPI, Warehouse, POP (read-only checks).
const L = require('./e2e-lib.js');

(async () => {
  const browser = await L.launch();
  const R = L.makeRunner('MASTERS-KPI-WAREHOUSE');
  const { ctx, page, app, rpc, errors } = await L.openApp(browser);

  // ── Masters ───────────────────────────────────────────────────────────────
  await R.check('getSuppliers returns array with code+name', async () => {
    const r = await L.call(rpc, 'getSuppliers', []);
    if (!Array.isArray(r) || !r.length) return 'empty or not array';
    return (r[0].code && r[0].name) ? true : 'missing fields: ' + JSON.stringify(Object.keys(r[0]));
  });

  await R.check('getCustomers returns array with code+name', async () => {
    const r = await L.call(rpc, 'getCustomers', []);
    if (!Array.isArray(r) || !r.length) return 'empty or not array';
    return (r[0].code && r[0].name) ? true : 'missing fields: ' + JSON.stringify(Object.keys(r[0]));
  });

  await R.check('getInspectors returns non-empty array', async () => {
    const r = await L.call(rpc, 'getInspectors', []);
    return (Array.isArray(r) && r.length > 0) ? true : 'empty or not array: ' + JSON.stringify(r).slice(0, 60);
  });

  await R.check('getFG returns FG products array', async () => {
    const r = await L.call(rpc, 'getFG', []);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getParameters returns quality params', async () => {
    const r = await L.call(rpc, 'getParameters', []);
    return (Array.isArray(r) && r.length > 0) ? true : 'empty: ' + JSON.stringify(r).slice(0, 60);
  });

  await R.check('getFormInitData returns combined masters bundle', async () => {
    const r = await L.call(rpc, 'getFormInitData', []);
    if (!r || r.__err) return 'error: ' + JSON.stringify(r).slice(0, 120);
    return typeof r === 'object' ? true : 'unexpected: ' + typeof r;
  });

  // ── KPI ───────────────────────────────────────────────────────────────────
  await R.check('getKPIDashboard returns metrics object', async () => {
    const r = await L.call(rpc, 'getKPIDashboard', [{}]);
    if (!r || r.__err) return 'error: ' + JSON.stringify(r).slice(0, 120);
    return (typeof r === 'object') ? true : 'unexpected type: ' + typeof r;
  });

  await R.check('KPI dates are strings not raw Date', async () => {
    const r = await L.call(rpc, 'getKPIDashboard', [{ period: 'month' }]);
    if (!r || r.__err) return 'error or skip';
    const str = JSON.stringify(r);
    // Raw dates show as {} in RPC; look for suspiciously short empty objects in arrays
    const emptyObjCount = (str.match(/:\{\}/g) || []).length;
    return emptyObjCount < 3 ? true : 'possible raw Date objects detected (' + emptyObjCount + ' empty objects)';
  });

  // ── Warehouse ─────────────────────────────────────────────────────────────
  await R.check('getStockSummary returns array', async () => {
    const r = await L.call(rpc, 'getStockSummary', []);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getStockByMaterial returns array', async () => {
    const r = await L.call(rpc, 'getStockByMaterial', []);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getStockMovements returns array (no Date bug)', async () => {
    const r = await L.call(rpc, 'getStockMovements', [20]);
    if (!Array.isArray(r)) return 'NOT array: ' + typeof r;
    if (r.length) {
      const d = r[0].date || r[0].txnDate || r[0].timestamp;
      if (d !== undefined && typeof d === 'object' && d !== null)
        return 'date is raw object (Date serialization bug)';
    }
    return true;
  });

  await R.check('getLocations returns locations array', async () => {
    const r = await L.call(rpc, 'getLocations', [null]);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getFIFOLots returns array or null (not a crash)', async () => {
    const ss = await L.call(rpc, 'getStockSummary', []);
    if (!Array.isArray(ss) || !ss.length) return 'skip — no stock';
    // Use a materialCode known to have stock
    const matCode = ss.find(r => r.materialCode && !r.materialCode.startsWith('SMOKE'))?.materialCode;
    if (!matCode) return 'skip — no non-smoke material in stock';
    const r = await L.call(rpc, 'getFIFOLots', [matCode]);
    if (r && r.__err) return 'error: ' + r.__err;
    // null means no FIFO-eligible lots (correct behavior); array means lots exist
    return (r === null || Array.isArray(r)) ? true : 'unexpected return: ' + typeof r;
  });

  await R.check('getStockView returns data or null (not a crash)', async () => {
    const r = await L.call(rpc, 'getStockView', []);
    // null is valid when Warehouse_VIEW sheet is not set up; __err indicates a real crash
    if (r && r.__err) return 'error: ' + r.__err;
    return true;
  });

  // ── Low Stock (reorder-level alerting) ────────────────────────────────────
  await R.check('getMaterials includes reorderLevel field', async () => {
    const m = await L.call(rpc, 'getMaterials', []);
    if (!Array.isArray(m) || !m.length) return 'empty or not array';
    // reorderLevel must be present and numeric (0 when blank in sheet)
    return (typeof m[0].reorderLevel === 'number') ? true
      : 'reorderLevel missing/non-numeric: ' + JSON.stringify(Object.keys(m[0]));
  });

  await R.check('getLowStockItems returns array', async () => {
    const r = await L.call(rpc, 'getLowStockItems', []);
    return Array.isArray(r) ? true : 'NOT array: ' + (r && r.__err ? r.__err : typeof r);
  });

  await R.check('getLowStockItems rows have correct shape + invariants', async () => {
    const r = await L.call(rpc, 'getLowStockItems', []);
    if (!Array.isArray(r)) return 'NOT array';
    if (!r.length) { console.log('      (skip — no items at/below reorder; set col F in MASTERS_Materials to exercise invariants)'); return true; }
    const row = r[0];
    const keys = ['code', 'desc', 'onHand', 'reorderLevel', 'shortBy'];
    for (const k of keys) if (row[k] === undefined) return 'missing field: ' + k + ' — keys=' + Object.keys(row).join(',');
    // invariants: only items WITH a threshold appear; on-hand must be <= reorder; shortBy === reorder - onHand
    for (const x of r) {
      if (!(x.reorderLevel > 0)) return 'row with reorderLevel<=0 leaked: ' + x.code;
      if (!(x.onHand <= x.reorderLevel)) return 'row not actually low: ' + x.code + ' onHand=' + x.onHand + ' rol=' + x.reorderLevel;
      if (x.shortBy !== x.reorderLevel - x.onHand) return 'shortBy math wrong: ' + x.code;
    }
    return true;
  });

  await R.check('getLowStockItems sorted by shortBy descending', async () => {
    const r = await L.call(rpc, 'getLowStockItems', []);
    if (!Array.isArray(r) || r.length < 2) { console.log('      (skip — need >=2 low items to check sort)'); return true; }
    for (let i = 1; i < r.length; i++) if (r[i].shortBy > r[i - 1].shortBy) return 'not sorted at index ' + i;
    return true;
  });

  await R.check('UI: Warehouse Low Stock tab mounts and renders', async () => {
    await L.nav(app, page, 'Warehouse', null);
    for (let i = 0; i < 20; i++) {
      for (const f of page.frames()) {
        try {
          // click the Low Stock tab if present, then look for its panel/content
          const ok = await f.evaluate(() => {
            const btn = document.querySelector('[data-tab="lowstock"]');
            if (!btn) return false;
            btn.click();
            const panel = document.getElementById('panel-lowstock');
            const list  = document.getElementById('lowstockList');
            // rendered = panel exists AND list has content (cards OR the empty/✓ state)
            return !!(panel && list && list.textContent.trim().length > 0);
          }).catch(() => false);
          if (ok) return true;
        } catch (_) {}
      }
      await page.waitForTimeout(500);
    }
    return 'Low Stock tab/panel not found or did not render after 10s';
  });

  // ── Scan WMS (name-pick identity; real STOCK_LEDGER lifecycle) ─────────────
  await R.check('getOperators returns array of {name}', async () => {
    const r = await L.call(rpc, 'getOperators', []);
    if (!Array.isArray(r)) return 'NOT array: ' + (r && r.__err ? r.__err : typeof r);
    if (!r.length) return 'empty — OPERATORS sheet has no active rows';
    return (typeof r[0].name === 'string') ? true : 'missing name field: ' + JSON.stringify(Object.keys(r[0]));
  });

  await R.check('getChokepointConfig returns 4 chokepoints with action+targetLocation', async () => {
    const r = await L.call(rpc, 'getChokepointConfig', []);
    if (!Array.isArray(r) || r.length !== 4) return 'expected 4, got: ' + JSON.stringify(r).slice(0, 120);
    return r.every(c => c.verb && c.action && c.targetLocation) ? true : 'missing action/targetLocation: ' + JSON.stringify(r[0]);
  });

  await R.check('setupScanWms creates chokepoint locations (idempotent)', async () => {
    const r = await L.call(rpc, 'setupScanWms', []);
    if (!r || r.__err) return 'error: ' + JSON.stringify(r).slice(0, 120);
    return (r.ok && r.locations) ? true : 'unexpected: ' + JSON.stringify(r).slice(0, 120);
  });

  await R.check('chokepoint locations now appear in LOCATIONS', async () => {
    const r = await L.call(rpc, 'getLocations', [null]);
    if (!Array.isArray(r)) return 'NOT array';
    const ids = r.map(x => x.id || x.locationId || x['Location ID'] || x.code).filter(Boolean);
    const want = ['SCAN-GATE-IN', 'SCAN-FLOOR-1', 'SCAN-FLOOR-2'];
    const missing = want.filter(w => !ids.some(id => String(id) === w));
    return missing.length === 0 ? true : 'missing locations: ' + missing.join(',') + ' (saw ' + ids.slice(0,8).join(',') + ')';
  });

  await R.check('lookupLotForScan blocks MOVE of a non-existent lot', async () => {
    const r = await L.call(rpc, 'lookupLotForScan', ['E2E-NOEXIST-LOT-XYZ', 'LOC|FLOOR-1-IN']);
    if (!r || r.__err) return 'error: ' + JSON.stringify(r).slice(0, 120);
    return (r.ok === false && /not in stock/i.test(r.blockReason || '')) ? true : 'expected block, got: ' + JSON.stringify(r).slice(0, 140);
  });

  await R.check('recordScan rejects invalid locationId', async () => {
    const r = await L.call(rpc, 'recordScan', [{ operator: 'Admin', locationId: 'LOC|HACKER', lotId: 'E2E/AUTH/001', confirmed: true }]);
    return (r && r.__err) ? true : 'expected rejection, got: ' + JSON.stringify(r).slice(0, 120);
  });

  await R.check('recordScan rejects missing operator', async () => {
    const r = await L.call(rpc, 'recordScan', [{ operator: '', locationId: 'LOC|GATE-IN', lotId: 'E2E/AUTH/002', confirmed: true }]);
    return (r && r.__err) ? true : 'expected rejection, got: ' + JSON.stringify(r).slice(0, 120);
  });

  await R.check('recordScan requires confirmation', async () => {
    const op = (await L.call(rpc, 'getOperators', []))[0]?.name || 'Admin';
    const r = await L.call(rpc, 'recordScan', [{ operator: op, locationId: 'LOC|GATE-IN', lotId: 'E2E/CONFIRM/001', qty: 5, materialCode: 'E2E-MAT', confirmed: false }]);
    return (r && r.__err && /confirm/i.test(r.__err)) ? true : 'expected confirm-required, got: ' + JSON.stringify(r).slice(0, 120);
  });

  await R.check('recordScan Gate-In requires qty', async () => {
    const op = (await L.call(rpc, 'getOperators', []))[0]?.name || 'Admin';
    const r = await L.call(rpc, 'recordScan', [{ operator: op, locationId: 'LOC|GATE-IN', lotId: 'E2E/QTY/001', materialCode: 'E2E-MAT', confirmed: true }]);
    return (r && r.__err && /quantity/i.test(r.__err)) ? true : 'expected qty-required, got: ' + JSON.stringify(r).slice(0, 120);
  });

  // Full lifecycle round-trip: receive → move → ship, verifying real STOCK_LEDGER balance.
  await R.check('WMS lifecycle: receive→move→ship updates real stock balance', async () => {
    const op = (await L.call(rpc, 'getOperators', []))[0]?.name || 'Admin';
    const lot = 'E2E-WMS-' + Date.now();
    const mat = 'E2E-WMS-MAT';
    // 1) Receive 100 at Gate-In
    const rec = await L.call(rpc, 'recordScan', [{ operator: op, locationId: 'LOC|GATE-IN', lotId: lot, qty: 100, materialCode: mat, confirmed: true }]);
    if (!rec || rec.__err) return 'receive failed: ' + JSON.stringify(rec).slice(0, 120);
    // lookup should now find 100 in stock
    let look = await L.call(rpc, 'lookupLotForScan', [lot, 'LOC|FLOOR-1-IN']);
    if (!(look.totalBalance === 100)) return 'after receive expected 100, got ' + look.totalBalance;
    // 2) Move to Floor-1
    const mv = await L.call(rpc, 'recordScan', [{ operator: op, locationId: 'LOC|FLOOR-1-IN', lotId: lot, confirmed: true }]);
    if (!mv || mv.__err) return 'move failed: ' + JSON.stringify(mv).slice(0, 120);
    look = await L.call(rpc, 'lookupLotForScan', [lot, 'LOC|GATE-OUT']);
    if (!(look.totalBalance === 100 && /SCAN-FLOOR-1/.test(look.fromLocation))) return 'after move expected 100 @ SCAN-FLOOR-1, got ' + look.totalBalance + ' @ ' + look.fromLocation;
    // 3) Ship at Gate-Out → balance 0
    const sh = await L.call(rpc, 'recordScan', [{ operator: op, locationId: 'LOC|GATE-OUT', lotId: lot, confirmed: true }]);
    if (!sh || sh.__err) return 'ship failed: ' + JSON.stringify(sh).slice(0, 120);
    look = await L.call(rpc, 'lookupLotForScan', [lot, 'LOC|FLOOR-1-IN']);
    return (look.totalBalance === 0) ? true : 'after ship expected 0, got ' + look.totalBalance;
  });

  await R.check('UI: Gate-In shows GRN dropdown populated from real GRNs', async () => {
    await L.nav(app, page, 'Scan', null);
    for (let i = 0; i < 24; i++) {
      for (const f of page.frames()) {
        try {
          const res = await f.evaluate(() => {
            // need an operator chosen for chokepoints to be live; pick first if present
            const opSel = document.getElementById('opSelect');
            if (opSel && !opSel.value && opSel.options.length > 1) { opSel.value = opSel.options[1].value; opSel.dispatchEvent(new Event('change')); document.getElementById('opOk')?.click(); }
            const gate = document.querySelector('.chokepoint[data-loc="LOC|GATE-IN"]');
            if (!gate) return null;
            gate.click();
            const grn = document.getElementById('grnSelect');
            const hint = !!document.getElementById('grnQtyHint');
            if (!grn) return null;
            return { ready: true, opts: grn.options.length, hint };
          }).catch(() => null);
          if (res && res.ready) {
            // opts > 1 means real GRNs loaded (option 0 is the placeholder). Allow loading lag.
            if (res.opts > 1 && res.hint) return true;
          }
        } catch (_) {}
      }
      await page.waitForTimeout(500);
    }
    return 'GRN dropdown did not populate (>1 option) within 12s';
  });

  await R.check('UI: Scan page mounts with name dropdown (no keypad, no Google gate)', async () => {
    await L.nav(app, page, 'Scan', null);
    for (let i = 0; i < 20; i++) {
      for (const f of page.frames()) {
        try {
          const res = await f.evaluate(() => {
            const choke = document.querySelectorAll('.chokepoint').length;
            const keypad = document.querySelectorAll('button.key[data-d]').length;
            const lot = !!document.getElementById('lotInput');
            const opSel = !!document.getElementById('opSelect');
            const checkB = !!document.getElementById('checkBtn');
            const confirmC = !!document.getElementById('confirmCard');
            const noSignInWall = !/not signed in/i.test(document.body.innerText);
            if (choke === 4 && lot && checkB && confirmC) return { ok: true, keypad, opSel, noSignInWall };
            return null;
          }).catch(() => null);
          if (res && res.ok) {
            if (res.keypad !== 0) return 'PIN keypad still present (' + res.keypad + ' keys)';
            if (!res.opSel) return 'operator dropdown (#opSelect) missing';
            if (!res.noSignInWall) return '"Not signed in" wall still shown';
            return true;
          }
        } catch (_) {}
      }
      await page.waitForTimeout(500);
    }
    return 'Scan page (4 chokepoints + lot input) not found after 10s';
  });

  // ── POP (Purchase Orders) ─────────────────────────────────────────────────
  await R.check('getPOFormInit returns suppliers + docNumber', async () => {
    const r = await L.call(rpc, 'getPOFormInit', []);
    if (!r || r.__err) return 'error: ' + JSON.stringify(r).slice(0, 120);
    return (r.suppliers !== undefined || r.docNumber !== undefined) ? true
      : 'missing fields: ' + JSON.stringify(Object.keys(r));
  });

  await R.check('listDraftPOs returns array', async () => {
    const r = await L.call(rpc, 'listDraftPOs', []);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getRecentPOs returns array (no Date bug)', async () => {
    const r = await L.call(rpc, 'getRecentPOs', [10]);
    if (!Array.isArray(r)) return 'NOT array: ' + typeof r;
    if (r.length) {
      const d = r[0].date || r[0].poDate || r[0].createdAt;
      if (d !== undefined && typeof d === 'object' && d !== null)
        return 'date is raw object (Date serialization bug)';
    }
    return true;
  });

  // ── UI: KPI dashboard mounts ──────────────────────────────────────────────
  await R.check('UI: KPI dashboard mounts with metric tiles', async () => {
    await L.nav(app, page, 'KPI', null);
    for (let i = 0; i < 20; i++) {
      for (const f of page.frames()) {
        try {
          const ok = await f.evaluate(() =>
            !!(document.querySelector('.kpi-card, .kpi-tile, [id*="kpi"], [class*="metric"]') ||
               /FPY|OTD|NCR|Defect|Return/i.test(document.body.innerText))
          ).catch(() => false);
          if (ok) return true;
        } catch (_) {}
      }
      await page.waitForTimeout(500);
    }
    return 'KPI dashboard elements not found after 10s';
  });

  const summary = R.report();
  if (errors.length) console.log('\n[console errors]\n  ' + errors.slice(0, 5).join('\n  '));
  await ctx.close(); await browser.close();
  process.exit(summary.pass === summary.total ? 0 : 1);
})();
