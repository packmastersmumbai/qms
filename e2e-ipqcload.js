/* Is IPQC's #loading overlay actually dismissed (opacity 0 + .hidden), or left open? */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, page, app } = await openApp(b);
  await nav(app, page, 'IPQC');
  await page.waitForTimeout(12000);
  let fr = null, len = 0;
  for (const f of page.frames()) {
    try { const n = await f.evaluate(() => (document.body.innerText || '').length); if (n > len) { len = n; fr = f; } } catch (_) {}
  }
  console.log(JSON.stringify(await fr.evaluate(() => {
    const el = document.getElementById('loading');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      hasHiddenClass: el.classList.contains('hidden'),
      opacity: cs.opacity, display: cs.display, visibility: cs.visibility,
      pointerEvents: cs.pointerEvents, position: cs.position,
      box: { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) },
      // does it sit over the form and eat clicks?
      elementAtCentre: (() => {
        const e = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return e ? (e.id || e.tagName + '.' + String(e.className).slice(0, 30)) : null;
      })(),
    };
  }), null, 1));
  await ctx.close(); await b.close();
})();
