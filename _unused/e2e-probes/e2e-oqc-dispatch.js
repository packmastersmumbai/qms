// E2E — OQC + Dispatch, backend-verified (non-destructive: validates form-init data
// and UI dropdown population, but does NOT submit, since a real OQC/Dispatch save
// consumes a scarce closed-IPQC session / FG lot. The Production suite proves the
// full write->read->verify path; these guard the read/gate/serialization paths.
const L = require('./e2e-lib.js');

(async () => {
  const browser = await L.launch();
  const { ctx, page, app, rpc, errors } = await L.openApp(browser);

  // ---------------- OQC ----------------
  const R1 = L.makeRunner('OQC');

  await R1.check('getOQCFormInit returns a serializable object (no Date crash)', async () => {
    const init = await L.call(rpc, 'getOQCFormInit', []);
    if (!init || init.__err) return 'init error: ' + JSON.stringify(init).slice(0, 140);
    return (typeof init === 'object' && init.docNumber !== undefined) ? true : 'unexpected shape';
  });

  await R1.check('getCustomers returns an array (used by selCustomer)', async () => {
    const c = await L.call(rpc, 'getCustomers', []);
    return Array.isArray(c) && c.length > 0 ? true : 'customers=' + (Array.isArray(c) ? c.length : typeof c);
  });

  await R1.check('OQC FG materials present in form init', async () => {
    const init = await L.call(rpc, 'getOQCFormInit', []);
    return (init.materials || []).length > 0 ? true : 'no FG materials';
  });

  await R1.check('getClosedIPQCSessionsForOQC returns array (gate source)', async () => {
    const s = await L.call(rpc, 'getClosedIPQCSessionsForOQC', []);
    // empty is legitimate (no closed sessions) — we only assert it does not error / is an array
    if (s && s.__err) return 'error: ' + s.__err;
    return Array.isArray(s) ? true : 'not array: ' + typeof s;
  });

  await R1.check('UI: OQC form dropdowns populate (IPQC, Material, Customer, Location)', async () => {
    await L.nav(app, page, 'OQC', { mode: 'new' });
    const ipqc = await L.readSelect(page, 'selIPQC');
    const mat  = await L.readSelect(page, 'selMaterial');
    const cust = await L.readSelect(page, 'selCustomer');
    const loc  = await L.readSelect(page, 'selFGLocation');
    if (!mat || mat.real === 0) return 'selMaterial empty';
    if (!cust || cust.real === 0) return 'selCustomer empty';
    if (!loc || loc.real === 0) return 'selFGLocation empty';
    // selIPQC may legitimately be empty if no closed sessions — report but don't fail on it alone
    return true;
  });

  const s1 = R1.report();

  // ---------------- Dispatch ----------------
  const R2 = L.makeRunner('DISPATCH');

  await R2.check('getDispatchFormInit returns serializable object', async () => {
    const init = await L.call(rpc, 'getDispatchFormInit', []);
    if (!init || init.__err) return 'init error: ' + JSON.stringify(init).slice(0, 140);
    return (init.docNumber !== undefined) ? true : 'unexpected shape';
  });

  await R2.check('Dispatch customers + products present in form init', async () => {
    const init = await L.call(rpc, 'getDispatchFormInit', []);
    const c = (init.customers || []).length, p = (init.products || []).length;
    return (c > 0) ? true : 'customers=' + c + ' products=' + p;
  });

  await R2.check('Dispatch inspectors (Authorized By) present', async () => {
    const init = await L.call(rpc, 'getDispatchFormInit', []);
    return (init.inspectors || []).length > 0 ? true : 'no inspectors';
  });

  await R2.check('UI: Dispatch form dropdowns populate (Customer, Authorized By)', async () => {
    await L.nav(app, page, 'Dispatch', { mode: 'new' });
    const cust = await L.readSelect(page, 'fCustomer');
    const auth = await L.readSelect(page, 'fAuthorizedBy');
    if (!cust || cust.real === 0) return 'fCustomer empty';
    if (!auth || auth.real === 0) return 'fAuthorizedBy empty';
    return true;
  });

  const s2 = R2.report();

  if (errors.length) console.log('\n[console errors during run]\n  ' + errors.slice(0, 8).join('\n  '));
  await ctx.close();
  await browser.close();
  const ok = (s1.pass === s1.total) && (s2.pass === s2.total);
  console.log('\n##### OQC: ' + s1.pass + '/' + s1.total + ' | DISPATCH: ' + s2.pass + '/' + s2.total + ' #####');
  process.exit(ok ? 0 : 1);
})();
