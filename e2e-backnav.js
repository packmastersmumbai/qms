// Does Back stay inside the SPA instead of exiting to the v1 landing page?
const { launch, openApp, nav, frameWith } = require('./e2e-lib');
(async () => {
  const b = await launch(); const s = await openApp(b);
  await nav(s.app, s.page, 'GRN');
  await s.page.waitForTimeout(11000);
  let fr = await frameWith(s.page, 'btnSubmit', 20000);
  console.log('  on GRN            :', !!fr);
  const before = await s.page.evaluate(() => location.href).catch(()=> '');

  await s.page.goBack({ waitUntil: 'domcontentloaded' }).catch(e => console.log('  goBack err:', e.message.slice(0,60)));
  await s.page.waitForTimeout(9000);

  // Where did we land? Look for SPA landing markers vs the GRN form.
  const state = await (async () => {
    for (const f of s.page.frames()) {
      try {
        const r = await f.evaluate(() => ({
          hasGrn:     !!document.getElementById('btnSubmit'),
          hasLanding: !!document.querySelector('.pm-topnav-btn, .pm-kpi-card'),
          title: (document.title||'').slice(0,40),
          txt: (document.body ? document.body.innerText : '').slice(0,60).replace(/\s+/g,' ')
        }));
        if (r.hasGrn || r.hasLanding) return r;
      } catch(_) {}
    }
    return null;
  })();
  console.log('  after Back        :', state ? JSON.stringify(state) : '(nothing recognised — likely left the app)');
  const ok = state && (state.hasLanding || state.hasGrn);
  console.log('\n' + (ok ? 'PASS — stayed inside the SPA' : 'FAIL — Back left the application'));
  await b.close();
})();
