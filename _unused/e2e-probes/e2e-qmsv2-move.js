// E2E (LIVE, self-reverting) — T6 Tier-1 Move proof-of-write.
// Drives runAction('move',...) through the real google.script.run bridge and
// asserts STOCK_LEDGER balance shifts via getStockSummary/getOnHand. Each move
// is undone by an equal reverse move, so production stock nets to zero.
//
// NOTE: this is the ONE destructive-path suite for QMSv2; it writes real
// LOCATION_TRANSFER rows (then reverses). Excluded from the fast logic suite;
// run explicitly or via e2e-run-all.js.
const L = require('./e2e-lib.js');

(async () => {
  const browser = await L.launch();
  const { page, rpc, errors } = await L.openApp(browser);
  const R = L.makeRunner('QMSv2-MOVE');

  // Find a lot with real stock at a known location.
  const summary = await L.call(rpc, 'getStockSummary', []);
  const locs = await L.call(rpc, 'getLocations', []);

  let seed = null, toLoc = null;
  if (Array.isArray(summary) && Array.isArray(locs)) {
    seed = summary.find(s => Number(s.balance) > 0 && s.materialCode && s.locationId);
    if (seed) toLoc = (locs.find(l => String(l.id) !== String(seed.locationId)) || {}).id;
  }

  await R.check('found a seed lot with stock + a distinct destination', () => {
    if (!seed) return 'no stock row with balance>0';
    if (!toLoc) return 'no distinct destination location';
    return true;
  });

  if (seed && toLoc) {
    const mat = seed.materialCode, lot = seed.batchOrLotNo || '', from = seed.locationId;
    const moveQty = Math.max(1, Math.floor(Number(seed.balance) / 2));

    const srcBefore = await L.call(rpc, 'getOnHand', [mat, lot, from]);
    const dstBefore = await L.call(rpc, 'getOnHand', [mat, lot, toLoc]);

    // ---- forward move ----
    const res = await L.call(rpc, 'runAction', ['move',
      { material: mat, lot: lot, fromLoc: from, toLoc: toLoc, qty: moveQty, by: 'e2e' }]);

    await R.check('runAction(move) returns success + transferId', () =>
      (res && res.success && res.transferId) ? true : 'res=' + JSON.stringify(res).slice(0, 160));

    const srcAfter = await L.call(rpc, 'getOnHand', [mat, lot, from]);
    const dstAfter = await L.call(rpc, 'getOnHand', [mat, lot, toLoc]);

    await R.check('source balance decreased by qty', () =>
      (srcBefore - srcAfter === moveQty) ? true : `src ${srcBefore}->${srcAfter} (qty ${moveQty})`);
    await R.check('destination balance increased by qty', () =>
      (dstAfter - dstBefore === moveQty) ? true : `dst ${dstBefore}->${dstAfter} (qty ${moveQty})`);

    // ---- reverse move (restore production) ----
    const rev = await L.call(rpc, 'runAction', ['move',
      { material: mat, lot: lot, fromLoc: toLoc, toLoc: from, qty: moveQty, by: 'e2e-revert' }]);
    await R.check('reverse move succeeds', () =>
      (rev && rev.success) ? true : 'rev=' + JSON.stringify(rev).slice(0, 160));

    const srcFinal = await L.call(rpc, 'getOnHand', [mat, lot, from]);
    const dstFinal = await L.call(rpc, 'getOnHand', [mat, lot, toLoc]);
    await R.check('source restored to original balance', () =>
      (srcFinal === srcBefore) ? true : `src final ${srcFinal} != ${srcBefore}`);
    await R.check('destination restored to original balance', () =>
      (dstFinal === dstBefore) ? true : `dst final ${dstFinal} != ${dstBefore}`);

    // ---- guard checks ----
    const sameLoc = await L.call(rpc, 'runAction', ['move',
      { material: mat, lot: lot, fromLoc: from, toLoc: from, qty: 1, by: 'e2e' }]);
    // server allows it (no same-loc guard server-side) but a 0-net move is harmless;
    // the real guard is client-side. Just assert it doesn't corrupt:
    await R.check('same-loc move does not error the server', () =>
      (sameLoc && sameLoc.success !== undefined) ? true : 'unexpected: ' + JSON.stringify(sameLoc).slice(0,120));
    // undo the +1/-1 same-loc (net zero already since from==to writes OUT then IN same loc)

    const over = await L.call(rpc, 'runAction', ['move',
      { material: mat, lot: lot, fromLoc: from, toLoc: toLoc, qty: 999999999, by: 'e2e' }]);
    await R.check('over-qty move is rejected (insufficient stock)', () =>
      (over && over.success === false) ? true : 'should have failed: ' + JSON.stringify(over).slice(0,120));
  }

  const r = R.report();
  if (errors.length) console.log('  (page errors: ' + errors.length + ')');
  await browser.close();
  process.exit(r.pass === r.total ? 0 : 1);
})();
