// Can the GAS sandboxed iframe use the History API at all?
const { launch, openApp, nav, frameWith } = require('./e2e-lib');
(async () => {
  const b = await launch(); const s = await openApp(b);
  await nav(s.app, s.page, 'GRN'); await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSubmit', 20000);
  if (!fr) { console.log('no frame'); await b.close(); return; }
  const r = await fr.evaluate(() => {
    const out = {};
    out.origin = location.origin;
    out.lenBefore = history.length;
    try { history.pushState({t:'x'}, '', location.href); out.pushState = 'OK'; }
    catch (e) { out.pushState = 'BLOCKED: ' + e.name + ' ' + e.message.slice(0,80); }
    out.lenAfter = history.length;
    try { history.replaceState({t:'y'}, '', location.href); out.replaceState = 'OK'; }
    catch (e) { out.replaceState = 'BLOCKED: ' + e.name; }
    out.hasPopstate = typeof window.onpopstate !== 'undefined';
    return out;
  });
  Object.keys(r).forEach(k => console.log('  ' + k.padEnd(14) + r[k]));
  await b.close();
})();
