// E2E — Production module, backend-verified via google.script.run.
// Exercises: form init -> material lots -> FIFO plan -> issue -> read-back in Recent list.
// Guards the @298 regression (getRecentProductionIssues returning {} over google.script.run
// because of a raw Date in the payload).
const L = require('./e2e-lib.js');
const TAG = 'E2E';

(async () => {
  const browser = await L.launch();
  const R = L.makeRunner('PRODUCTION');
  const { ctx, page, app, rpc, errors } = await L.openApp(browser);

  let chosenMat = null, chosenUnit = '', issuedId = null, baselineCount = 0;

  await R.check('getProductionFormInit returns materials + inspectors', async () => {
    const init = await L.call(rpc, 'getProductionFormInit', []);
    if (!init || init.__err) return 'init error: ' + JSON.stringify(init).slice(0, 120);
    const mats = (init.materials || []).length, insp = (init.inspectors || []).length;
    return (mats > 0 && insp > 0) ? true : 'materials=' + mats + ' inspectors=' + insp;
  });

  await R.check('a material yields a FIFO plan (has IQC-passed lots)', async () => {
    const mats = await L.call(rpc, 'getMaterials', []);
    if (!Array.isArray(mats)) return 'getMaterials not array';
    for (const m of mats.slice(0, 25)) {
      const code = m.code || m.itemCode;
      const plan = await L.call(rpc, 'planFIFOAllocation', [code, 1]);
      if (plan && plan.success && plan.plan && plan.plan.length) {
        chosenMat = code; chosenUnit = m.unit || 'EA';
        return true;
      }
    }
    return 'no material had an allocatable lot in first 25';
  });

  await R.check('getRecentProductionIssues returns a real ARRAY (regression @298)', async () => {
    const recent = await L.call(rpc, 'getRecentProductionIssues', [20]);
    if (recent && recent.__err) return 'error: ' + recent.__err;
    if (!Array.isArray(recent)) return 'NOT AN ARRAY — Date-serialization regression: ' + typeof recent;
    baselineCount = recent.length;
    return true;
  });

  await R.check('issueRMMultiLot writes a record (success + issueId)', async () => {
    if (!chosenMat) return 'no material chosen';
    const res = await L.call(rpc, 'issueRMMultiLot', [{
      materialCode: chosenMat, qtyToIssue: 1, unit: chosenUnit,
      productionOrderNo: TAG + '-PROD', issuedBy: 'Tarun Mishra', remarks: TAG + ' automated'
    }]);
    if (!res || res.__err) return 'issue error: ' + JSON.stringify(res).slice(0, 140);
    if (!res.success || !res.issueId) return 'no success/issueId: ' + JSON.stringify(res).slice(0, 140);
    issuedId = res.issueId;
    return true;
  });

  await R.check('issued record is READABLE in Recent list (the core bug)', async () => {
    const recent = await L.call(rpc, 'getRecentProductionIssues', [20]);
    if (!Array.isArray(recent)) return 'getRecent not array after write';
    const found = recent.find(r => r.issueId === issuedId);
    if (!found) return 'issued ' + issuedId + ' NOT in recent (' + recent.length + ' rows)';
    return true;
  });

  await R.check('Recent list timestamps are serialized (string, not {})', async () => {
    const recent = await L.call(rpc, 'getRecentProductionIssues', [5]);
    if (!Array.isArray(recent) || !recent.length) return 'empty';
    const ts = recent[0].timestamp;
    return (typeof ts === 'string' || typeof ts === 'number') ? true : 'timestamp type=' + typeof ts;
  });

  await R.check('UI: Production Recent tab renders cards', async () => {
    await L.nav(app, page, 'Production', { mode: 'new' });
    const ff = await L.frameWith(page, 'fMaterial', 12000);
    if (!ff) return 'form did not mount';
    await ff.evaluate(() => { if (typeof switchTab === 'function') switchTab('recent'); if (typeof reloadRecent === 'function') reloadRecent(); });
    await page.waitForTimeout(5000);
    const cards = await ff.evaluate(() => document.querySelectorAll('#recentList .prd-rec').length);
    return cards > 0 ? true : 'no cards rendered in Recent tab';
  });

  const summary = R.report();
  if (errors.length) console.log('\n[console errors during run]\n  ' + errors.slice(0, 8).join('\n  '));
  console.log('\nNOTE: test left issue record ' + issuedId + ' (Prod Order ' + TAG + '-PROD) in the live sheet.');
  await ctx.close();
  await browser.close();
  process.exit(summary.pass === summary.total ? 0 : 1);
})();
