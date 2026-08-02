// E2E — GRN → IQC chain, backend-verified via google.script.run.
// Exercises: getIQCFormInit → getUnInspectedGRNs → getGRNItems → prefill path.
// Does NOT write an IQC record (no saveIQC) — IQC_LOG rows are scarce / hard to archive.
// Guards the "next product not loading" bug: IQC form gets blank items for multi-item GRNs.
const L = require('./e2e-lib.js');

(async () => {
  const browser = await L.launch();
  const R = L.makeRunner('GRN-IQC');
  const { ctx, page, app, rpc, errors } = await L.openApp(browser);

  let formInit = null, uninspected = [], targetGrn = null, grnItems = [];

  // ── 1. Form init ──────────────────────────────────────────────────────────
  await R.check('getIQCFormInit returns docNumber + recentGRNs + inspectors', async () => {
    formInit = await L.call(rpc, 'getIQCFormInit', []);
    if (!formInit || formInit.__err) return 'init error: ' + JSON.stringify(formInit).slice(0, 120);
    const hasDoc  = !!formInit.docNumber;
    const hasGRNs = Array.isArray(formInit.recentGRNs);
    const hasInsp = Array.isArray(formInit.inspectors) && formInit.inspectors.length > 0;
    return (hasDoc && hasGRNs && hasInsp) ? true
      : 'docNumber=' + hasDoc + ' recentGRNs=' + hasGRNs + ' inspectors=' + formInit.inspectors.length;
  });

  // ── 2. Uninspected GRNs ───────────────────────────────────────────────────
  await R.check('getUnInspectedGRNs returns an array (no raw-Date serialization bug)', async () => {
    const raw = await L.call(rpc, 'getUnInspectedGRNs', []);
    if (!Array.isArray(raw)) return 'NOT array — type=' + typeof raw + ' val=' + JSON.stringify(raw).slice(0, 80);
    uninspected = raw;
    return true;
  });

  await R.check('uninspected GRNs have grnNo + supplierName fields', async () => {
    if (!uninspected.length) return 'skip — no uninspected GRNs in sheet right now';
    const g = uninspected[0];
    return (g.grnNo && g.supplierName !== undefined) ? true
      : 'missing fields: ' + JSON.stringify(Object.keys(g));
  });

  // ── 3. getGRNItems — the core path that must not return [] ────────────────
  await R.check('getGRNItems returns items for a real GRN (not empty array)', async () => {
    if (!uninspected.length) {
      // Fallback: use formInit.recentGRNs which may include already-inspected GRNs
      const fallback = (formInit && formInit.recentGRNs) || [];
      if (!fallback.length) return 'skip — no GRNs in sheet';
      targetGrn = fallback[0].grnNo;
    } else {
      targetGrn = uninspected[0].grnNo;
    }
    grnItems = await L.call(rpc, 'getGRNItems', [targetGrn]);
    if (!Array.isArray(grnItems)) return 'NOT array: ' + JSON.stringify(grnItems).slice(0, 80);
    if (!grnItems.length) return 'EMPTY — getGRNItems returned [] for ' + targetGrn + ' (this is the prefill bug)';
    return true;
  });

  await R.check('GRN items have materialCode + materialDesc + batchNo', async () => {
    if (!grnItems.length) return 'skip — no items loaded';
    const item = grnItems[0];
    const ok = item.materialCode !== undefined && item.materialDesc !== undefined && item.batchNo !== undefined;
    return ok ? true : 'missing fields: ' + JSON.stringify(Object.keys(item));
  });

  // ── 4. Multi-item GRNs: every item in a multi-row GRN must have a materialCode ──
  await R.check('multi-item GRN: no blank materialCode in any row (prefill-blank-item bug)', async () => {
    if (grnItems.length < 2) return 'skip — target GRN is single-item (or no items)';
    const blanks = grnItems.filter(i => !i.materialCode || !i.materialCode.trim());
    return blanks.length === 0 ? true
      : blanks.length + '/' + grnItems.length + ' items have blank materialCode — prefill would show blank';
  });

  // ── 5. UI smoke: IQC form mounts and GRN dropdown populates ───────────────
  await R.check('UI: IQC form mounts (navigateTo IQC)', async () => {
    await L.nav(app, page, 'IQC', null);
    // After navigateTo IQC the SPA re-renders; poll for a known IQC DOM element
    for (let i = 0; i < 20; i++) {
      for (const f of page.frames()) {
        try {
          const found = await f.evaluate(() =>
            !!(document.getElementById('grnNo') || document.getElementById('stickyBtn') || document.getElementById('prefillStrip'))
          ).catch(() => false);
          if (found) return true;
        } catch (_) {}
      }
      await page.waitForTimeout(500);
    }
    return 'IQC DOM elements not found after 10s';
  });

  await R.check('UI: IQC GRN dropdown populated', async () => {
    const sel = await L.readSelect(page, 'grnNo');
    if (!sel) return 'grnNo select not found';
    return sel.real > 0 ? true : 'dropdown empty (real=' + sel.real + ', total=' + sel.total + ')';
  });

  // ── 6. Selecting a GRN triggers item load (itemProgressLabel updates) ─────
  await R.check('UI: selecting a GRN from dropdown shows item progress label', async () => {
    // Find whichever frame has #grnNo
    let ff = null;
    for (const f of page.frames()) {
      try { if (await f.evaluate(() => !!document.getElementById('grnNo'))) { ff = f; break; } } catch (_) {}
    }
    if (!ff) return 'grnNo frame not found';
    const opts = await ff.evaluate(() => {
      const s = document.getElementById('grnNo');
      return s ? Array.from(s.options).map(o => o.value).filter(v => v && v.trim()) : [];
    });
    if (!opts.length) return 'skip — no GRNs in dropdown';
    await ff.selectOption('#grnNo', opts[0]);
    await page.waitForTimeout(4000);
    const label = await ff.evaluate(() => {
      const e = document.getElementById('itemProgressLabel');
      return e ? e.textContent.trim() : null;
    }).catch(() => null);
    if (!label) return 'itemProgressLabel not found after GRN select';
    const hasBlank = label.includes('—') || label === '';
    return !hasBlank ? true : 'label is blank/placeholder after GRN select: "' + label + '"';
  });

  const summary = R.report();
  if (errors.length) console.log('\n[console errors during run]\n  ' + errors.slice(0, 8).join('\n  '));
  await ctx.close();
  await browser.close();
  process.exit(summary.pass === summary.total ? 0 : 1);
})();
