/* Triage the 6 suite failures: is each a real product bug or a harness artifact?
 * For every suspect we pull the actual surrounding DOM instead of trusting the assertion. */
const { launch, openApp, nav } = require('./e2e-lib');

async function biggest(page) {
  let best = null, len = 0;
  for (const f of page.frames()) {
    try { const n = await f.evaluate(() => (document.body.innerText || '').length); if (n > len) { len = n; best = f; } } catch (_) {}
  }
  return best;
}

const CASES = {
  IPQC: fr => fr.evaluate(() => {
    const hits = [...document.querySelectorAll('*')].filter(e =>
      e.children.length === 0 && /Loading/i.test(e.textContent));
    return hits.map(e => {
      const r = e.getBoundingClientRect();
      const panel = e.closest('[id]');
      return { txt: e.textContent.trim().slice(0, 50), id: e.id || '(none)',
               host: panel ? panel.id : '?', visible: r.width > 0 && r.height > 0,
               display: getComputedStyle(e).display };
    });
  }),
  KPI: fr => fr.evaluate(() => {
    const hits = [...document.querySelectorAll('*')].filter(e =>
      e.children.length === 0 && /Loading/i.test(e.textContent));
    return hits.map(e => {
      const r = e.getBoundingClientRect();
      return { txt: e.textContent.trim().slice(0, 50), id: e.id || '(none)',
               visible: r.width > 0 && r.height > 0 };
    });
  }),
  NCR: fr => fr.evaluate(() => {
    const lines = (document.body.innerText || '').split('\n')
      .filter(l => /error|failed|could not|not a function/i.test(l));
    return { lines: lines.slice(0, 6) };
  }),
  Production: fr => fr.evaluate(() => {
    const out = {};
    for (const id of ['fgClient', 'bkJob', 'fgItem', 'bkIpqc']) {
      const s = document.getElementById(id);
      if (!s) { out[id] = 'MISSING'; continue; }
      const r = s.getBoundingClientRect();
      const tab = s.closest('[id*="tab"],[id*="Tab"],section,div[hidden]');
      out[id] = { opts: s.options.length, first: s.options[0] ? s.options[0].textContent.trim().slice(0, 30) : '',
                  visible: r.width > 0 && r.height > 0, host: tab ? (tab.id || tab.tagName) : '?' };
    }
    return out;
  }),
  CustomerReturn: fr => fr.evaluate(() => ({
    text: (document.body.innerText || '').slice(0, 300),
    forms: document.querySelectorAll('form').length,
    hiddenBlocks: [...document.querySelectorAll('[id]')]
      .filter(e => e.children.length > 2 && e.getBoundingClientRect().height === 0)
      .map(e => e.id).slice(0, 10),
  })),
  Scan: fr => fr.evaluate(() => {
    const s = document.getElementById('grnSelect');
    if (!s) return 'MISSING';
    const r = s.getBoundingClientRect();
    return { opts: [...s.options].map(o => o.textContent.trim()).slice(0, 4),
             disabled: s.disabled, visible: r.width > 0 && r.height > 0,
             dependsOn: document.getElementById('opSelect')
               ? document.getElementById('opSelect').value : '(no opSelect)' };
  }),
};

(async () => {
  const b = await launch();
  for (const [mod, fn] of Object.entries(CASES)) {
    const { ctx, page, app, errors } = await openApp(b);
    await nav(app, page, mod);
    await page.waitForTimeout(mod === 'Production' ? 13000 : 11000);
    const fr = await biggest(page);
    let out;
    try { out = fr ? await fn(fr) : 'NO FRAME'; } catch (e) { out = 'PROBE THREW ' + e.message; }
    console.log('\n===== ' + mod + ' =====');
    console.log(JSON.stringify(out, null, 1));
    const pe = errors.filter(e => e.startsWith('PAGEERR'));
    if (pe.length) console.log('PAGEERR:', pe.slice(0, 3));
    await ctx.close();
  }
  await b.close();
})();
