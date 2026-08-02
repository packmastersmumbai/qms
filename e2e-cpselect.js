/* 1) Confirm the Suppliers Email drift is gone.
 * 2) ControlPlan: is 1 checkbox pre-selection a cascade, or a broken render?
 *    Pick a real FG product and re-count. READ-ONLY (no save clicked). */
const { launch, openApp, nav, call } = require('./e2e-lib');

(async () => {
  const b = await launch();

  {
    const { ctx, rpc } = await openApp(b);
    const t = await call(rpc, 'getMastersTable', ['Suppliers']);
    const r = t && t.rows && t.rows[0];
    console.log('===== Suppliers after fix =====');
    console.log(t && t.ok === false ? ('GUARD FIRED: ' + t.error)
      : ' fields: ' + JSON.stringify(r).slice(0, 220) +
        '\n hasEmailKey=' + (r ? ('email' in r) : '?') +
        ' _lastModified=' + (r && String(r._lastModified).slice(0, 24)));
    await ctx.close();
  }

  {
    const { ctx, page, app, errors } = await openApp(b);
    await nav(app, page, 'ControlPlan');
    await page.waitForTimeout(12000);
    let fr = null, len = 0;
    for (const f of page.frames()) {
      try { const n = await f.evaluate(() => (document.body.innerText || '').length); if (n > len) { len = n; fr = f; } } catch (_) {}
    }
    const before = await fr.evaluate(() => ({
      cb: document.querySelectorAll('input[type=checkbox]').length,
      fg: document.getElementById('fgSelect') ? document.getElementById('fgSelect').options.length : -1,
    }));
    // choose the first REAL fg option and fire change
    const chosen = await fr.evaluate(() => {
      const s = document.getElementById('fgSelect');
      const opt = [...s.options].find(o => o.value && !/^[—–-]/.test(o.textContent.trim()));
      if (!opt) return null;
      s.value = opt.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return { value: opt.value, label: opt.textContent.trim().slice(0, 40) };
    });
    await page.waitForTimeout(6000);
    const after = await fr.evaluate(() => ({
      cb: document.querySelectorAll('input[type=checkbox]').length,
      checked: [...document.querySelectorAll('input[type=checkbox]')].filter(c => c.checked).length,
      rows: document.querySelectorAll('tr,[class*=param-row],[class*=cp-row]').length,
      readonly: [...document.querySelectorAll('input[type=checkbox]')].filter(c => c.disabled).length,
    }));
    console.log('\n===== ControlPlan =====');
    console.log(' before select:', JSON.stringify(before));
    console.log(' chose:', JSON.stringify(chosen));
    console.log(' after  select:', JSON.stringify(after));
    console.log(' PAGEERR:', errors.filter(e => e.startsWith('PAGEERR')).slice(0, 2));
    await ctx.close();
  }

  await b.close();
})();
