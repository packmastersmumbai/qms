/* Two survivors of the visibility filter — these are genuinely rendered. Real bugs? */
const { launch, openApp, nav } = require('./e2e-lib');

async function biggest(page) {
  let best = null, len = 0;
  for (const f of page.frames()) {
    try { const n = await f.evaluate(() => (document.body.innerText || '').length); if (n > len) { len = n; best = f; } } catch (_) {}
  }
  return best;
}

(async () => {
  const b = await launch();

  // ---- IPQC: which element still says Loading, and did its server call ever return? ----
  {
    const { ctx, page, app, errors } = await openApp(b);
    await nav(app, page, 'IPQC');
    await page.waitForTimeout(11000);
    const fr = await biggest(page);
    const early = await fr.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(e => e.children.length === 0 && /^loading/i.test(e.textContent.trim()))
      .map(e => {
        const r = e.getBoundingClientRect();
        let host = e.parentElement, chain = [];
        while (host && chain.length < 4) { chain.push(host.id || host.className.toString().slice(0, 24) || host.tagName); host = host.parentElement; }
        return { txt: e.textContent.trim(), tag: e.tagName, id: e.id || '(none)',
                 top: Math.round(r.top), h: Math.round(r.height), chain };
      }));
    // wait a lot longer — is it slow, or permanently stuck?
    await page.waitForTimeout(20000);
    const late = await fr.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(e => e.children.length === 0 && /^loading/i.test(e.textContent.trim()))
      .map(e => e.textContent.trim()));
    console.log('\n===== IPQC =====');
    console.log('at 11s:', JSON.stringify(early, null, 1));
    console.log('at 31s:', JSON.stringify(late));
    console.log('PAGEERR:', errors.filter(e => e.startsWith('PAGEERR')).slice(0, 2));
    await ctx.close();
  }

  // ---- Scan: 39 chars. What is actually on the screen? ----
  {
    const { ctx, page, app, errors } = await openApp(b);
    await nav(app, page, 'Scan');
    await page.waitForTimeout(11000);
    const fr = await biggest(page);
    const out = await fr.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return {
        visibleText: [...document.querySelectorAll('body *')]
          .filter(e => e.children.length === 0 && vis(e)).map(e => e.textContent.trim()).filter(Boolean),
        allText: (document.body.innerText || '').slice(0, 200),
        hiddenTopLevel: [...document.querySelectorAll('body > *, main > *, #scanRoot > *')]
          .filter(e => !vis(e)).map(e => e.id || e.tagName + '.' + String(e.className).slice(0, 20)).slice(0, 12),
        bodyH: document.body.getBoundingClientRect().height,
        cameraNeeded: /camera|scan|permission/i.test(document.body.innerHTML),
      };
    });
    console.log('\n===== Scan =====');
    console.log(JSON.stringify(out, null, 1));
    console.log('PAGEERR:', errors.filter(e => e.startsWith('PAGEERR')).slice(0, 2));
    await ctx.close();
  }

  await b.close();
})();
