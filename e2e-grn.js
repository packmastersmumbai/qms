// E2E — GRN module: form init, suppliers, materials, recent GRNs, UI mount.
const L = require('./e2e-lib.js');

(async () => {
  const browser = await L.launch();
  const R = L.makeRunner('GRN');
  const { ctx, page, app, rpc, errors } = await L.openApp(browser);

  let suppliers = [], materials = [], recentGRNs = [];

  await R.check('getGRNFormInit returns suppliers + materials + docNumber', async () => {
    const init = await L.call(rpc, 'getGRNFormInit', []);
    if (!init || init.__err) return 'error: ' + JSON.stringify(init).slice(0, 120);
    suppliers = init.suppliers || [];
    materials = init.materials || [];
    const ok = suppliers.length > 0 && materials.length > 0 && !!init.docNumber;
    return ok ? true : 'suppliers=' + suppliers.length + ' materials=' + materials.length + ' docNumber=' + init.docNumber;
  });

  await R.check('getSuppliers returns array with code + name', async () => {
    const s = await L.call(rpc, 'getSuppliers', []);
    if (!Array.isArray(s) || !s.length) return 'empty or not array';
    const ok = s[0].code !== undefined && s[0].name !== undefined;
    return ok ? true : 'missing fields: ' + JSON.stringify(Object.keys(s[0]));
  });

  await R.check('getMaterials returns array with code + name', async () => {
    const m = await L.call(rpc, 'getMaterials', []);
    if (!Array.isArray(m) || !m.length) return 'empty or not array';
    materials = m;
    const ok = m[0].code !== undefined && (m[0].name !== undefined || m[0].desc !== undefined);
    return ok ? true : 'missing fields: ' + JSON.stringify(Object.keys(m[0]));
  });

  await R.check('getRecentGRNs returns array with grnNo + supplierName (no Date bug)', async () => {
    const g = await L.call(rpc, 'getRecentGRNs', []);
    if (!Array.isArray(g)) return 'NOT array — type=' + typeof g;
    recentGRNs = g;
    if (!g.length) return 'skip — no GRNs in sheet';
    const ok = g[0].grnNo !== undefined && g[0].supplierName !== undefined;
    return ok ? true : 'missing fields: ' + JSON.stringify(Object.keys(g[0]));
  });

  await R.check('GRN dates are serialized strings (not raw Date)', async () => {
    if (!recentGRNs.length) return 'skip — no GRNs';
    const d = recentGRNs[0].date || recentGRNs[0].receivedDate || recentGRNs[0].grnDate;
    if (d === undefined) return 'skip — no date field found';
    return (typeof d === 'string' || typeof d === 'number') ? true
      : 'date type=' + typeof d + ' (raw Date → {} bug)';
  });

  await R.check('getGRNPrintData returns data for most recent GRN', async () => {
    if (!recentGRNs.length) return 'skip — no GRNs';
    const grnNo = recentGRNs[0].grnNo;
    const d = await L.call(rpc, 'getGRNPrintData', [grnNo]);
    if (!d || d.__err) return 'error: ' + JSON.stringify(d).slice(0, 120);
    return (d.docNo !== undefined || d.grnNo !== undefined) ? true : 'missing docNo/grnNo: keys=' + Object.keys(d).join(',');
  });

  await R.check('UI: GRN form mounts and supplier select exists', async () => {
    await L.nav(app, page, 'GRN', null);
    // Poll for the supplier select to appear in any frame
    for (let i = 0; i < 20; i++) {
      for (const f of page.frames()) {
        try {
          const found = await f.evaluate(() => !!document.getElementById('supplier')).catch(() => false);
          if (found) return true;
        } catch (_) {}
      }
      await page.waitForTimeout(500);
    }
    return 'supplier select (#supplier) not found in any frame after 10s';
  });

  const summary = R.report();
  if (errors.length) console.log('\n[console errors]\n  ' + errors.slice(0, 5).join('\n  '));
  await ctx.close(); await browser.close();
  process.exit(summary.pass === summary.total ? 0 : 1);
})();
