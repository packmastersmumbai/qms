// e2e-fast-render.js — offline render smoke for all 9 write forms.
// Proves each form assembles and boots without the live deploy.
'use strict';
const { launch, openForm, makeRunner, WRITE_FORMS } = require('./e2e-fast-lib');

(async () => {
  const t0 = Date.now();
  const browser = await launch();
  const R = makeRunner('offline render — 9 write forms');
  const detail = [];

  for (const name of Object.keys(WRITE_FORMS)) {
    let ctx;
    try {
      const o = await openForm(browser, name, {});
      ctx = o.context;
      const p = o.page;

      const stats = await p.evaluate(() => ({
        inputs:  document.querySelectorAll('input,select,textarea').length,
        buttons: document.querySelectorAll('button').length,
        text:    (document.body.innerText || '').length,
        calls:   (window.__gasCalls || []).length,
      }));

      await R.check(name + ' — renders controls', async () =>
        stats.inputs > 0 || stats.buttons > 0 ? true : 'no interactive controls');
      await R.check(name + ' — has visible text', async () =>
        stats.text > 40 ? true : 'body text only ' + stats.text + ' chars');
      await R.check(name + ' — no page errors', async () =>
        o.errors.length === 0 ? true : o.errors.slice(0, 2).join(' | '));
      // The write name is a SERVER function invoked through google.script.run —
      // it is never a client global (my first version checked window[w] and
      // wrongly failed 7 forms). What matters offline is that the form's source
      // actually references it, so the save path exists to be driven.
      await R.check(name + ' — references its write fn', async () =>
        await p.evaluate(w => {
          const src = Array.from(document.querySelectorAll('script'))
            .map(s => s.textContent || '').join('\n');
          return src.indexOf(w) !== -1;
        }, o.write) ? true : o.write + ' not referenced in any script');

      detail.push(name.padEnd(15) + 'in=' + String(stats.inputs).padStart(3) +
        ' btn=' + String(stats.buttons).padStart(3) +
        ' txt=' + String(stats.text).padStart(5) +
        ' gasCalls=' + stats.calls +
        (o.errors.length ? '  ERR: ' + o.errors[0].slice(0, 50) : ''));
    } catch (e) {
      await R.check(name + ' — opens', async () => 'THREW: ' + e.message.slice(0, 90));
      detail.push(name.padEnd(15) + 'THREW ' + e.message.slice(0, 60));
    } finally {
      try { if (ctx) await ctx.close(); } catch (_) {}
    }
  }

  const sum = R.report();
  console.log('\n===== per-form =====');
  detail.forEach(d => console.log(d));
  console.log('\nelapsed: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  await browser.close();
  process.exit(sum.pass === sum.total ? 0 : 1);
})();
