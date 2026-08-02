// E2E — NCR, Records, Trace, Dashboard, CustomerReturn, Rework (read-only checks).
const L = require('./e2e-lib.js');

(async () => {
  const browser = await L.launch();
  const R = L.makeRunner('NCR-RECORDS-TRACE');
  const { ctx, page, app, rpc, errors } = await L.openApp(browser);

  // ── NCR ──────────────────────────────────────────────────────────────────
  await R.check('getOpenNCRs returns array', async () => {
    const r = await L.call(rpc, 'getOpenNCRs', []);
    if (!Array.isArray(r)) return 'NOT array: ' + typeof r;
    return true;
  });

  await R.check('getNCRDispositions returns non-empty array', async () => {
    const r = await L.call(rpc, 'getNCRDispositions', []);
    return (Array.isArray(r) && r.length > 0) ? true : 'empty or not array: ' + JSON.stringify(r).slice(0, 80);
  });

  await R.check('getAllNCRs returns array (no Date serialization bug)', async () => {
    const r = await L.call(rpc, 'getAllNCRs', []);
    if (!Array.isArray(r)) return 'NOT array: ' + typeof r;
    if (r.length) {
      const d = r[0].date || r[0].raisedDate || r[0].createdAt;
      if (d !== undefined && typeof d === 'object' && d !== null)
        return 'date is raw object (Date serialization bug): ' + JSON.stringify(d);
    }
    return true;
  });

  // ── Records ───────────────────────────────────────────────────────────────
  await R.check('getRecordsList GRN returns array', async () => {
    const r = await L.call(rpc, 'getRecordsList', ['GRN', {}]);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getRecordsList IQC returns array', async () => {
    const r = await L.call(rpc, 'getRecordsList', ['IQC', {}]);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getRecordsList OQC returns array', async () => {
    const r = await L.call(rpc, 'getRecordsList', ['OQC', {}]);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getRecordsList Dispatch returns array', async () => {
    const r = await L.call(rpc, 'getRecordsList', ['Dispatch', {}]);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getRecordsCounts returns counts object', async () => {
    const r = await L.call(rpc, 'getRecordsCounts', []);
    return (r && typeof r === 'object' && !r.__err) ? true : 'error: ' + JSON.stringify(r).slice(0, 80);
  });

  // ── Trace ─────────────────────────────────────────────────────────────────
  await R.check('traceBatch with a real GRN docNo returns trace object', async () => {
    const grns = await L.call(rpc, 'getRecentGRNs', []);
    if (!Array.isArray(grns) || !grns.length) return 'skip — no GRNs';
    const docNo = grns[0].grnNo;
    const t = await L.call(rpc, 'traceBatch', [docNo, {}]);
    if (!t || t.__err) return 'error: ' + JSON.stringify(t).slice(0, 120);
    // traceBatch returns {success, anchor, upstream, downstream, thisBatch, meta, message, issues}
    return (t.success !== undefined && (t.anchor !== undefined || t.upstream !== undefined)) ? true
      : 'unexpected shape: ' + JSON.stringify(Object.keys(t));
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────
  await R.check('getDashboardData returns data object (no crash)', async () => {
    const d = await L.call(rpc, 'getDashboardData', [{}]);
    if (!d || d.__err) return 'error: ' + JSON.stringify(d).slice(0, 120);
    return typeof d === 'object' ? true : 'unexpected type: ' + typeof d;
  });

  // ── Customer Returns ──────────────────────────────────────────────────────
  await R.check('getCustomerReturnFormInit returns customers + dispositions', async () => {
    const init = await L.call(rpc, 'getCustomerReturnFormInit', []);
    if (!init || init.__err) return 'error: ' + JSON.stringify(init).slice(0, 120);
    const ok = Array.isArray(init.customers) && init.customers.length > 0;
    return ok ? true : 'customers missing or empty';
  });

  await R.check('getOpenCustomerReturns returns array', async () => {
    const r = await L.call(rpc, 'getOpenCustomerReturns', []);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  await R.check('getCustomerReturnDispositions returns non-empty array', async () => {
    const r = await L.call(rpc, 'getCustomerReturnDispositions', []);
    return (Array.isArray(r) && r.length > 0) ? true : 'empty: ' + JSON.stringify(r);
  });

  // ── Rework ────────────────────────────────────────────────────────────────
  await R.check('getReworkItems returns array', async () => {
    const r = await L.call(rpc, 'getReworkItems', []);
    return Array.isArray(r) ? true : 'NOT array: ' + typeof r;
  });

  // ── UI smoke: Records list renders ────────────────────────────────────────
  await R.check('UI: Records view mounts', async () => {
    await L.nav(app, page, 'Records', null);
    for (let i = 0; i < 20; i++) {
      for (const f of page.frames()) {
        try {
          const ok = await f.evaluate(() =>
            !!(document.querySelector('.pm-tab-bar, .pm-record-card, #recordsList, [id*="tab"]'))
          ).catch(() => false);
          if (ok) return true;
        } catch (_) {}
      }
      await page.waitForTimeout(500);
    }
    return 'Records UI elements not found after 10s';
  });

  const summary = R.report();
  if (errors.length) console.log('\n[console errors]\n  ' + errors.slice(0, 5).join('\n  '));
  await ctx.close(); await browser.close();
  process.exit(summary.pass === summary.total ? 0 : 1);
})();
