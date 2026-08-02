// Forms audit — navigate each core form the REAL way (SPA navigateTo -> document.write),
// then measure button visibility + capture console errors + screenshot.
//   node e2e-forms-audit.js
const path = require('path'), fs = require('fs');
const { launch, openApp, appFrame, nav } = require('./e2e-lib');

const OUT = path.join(__dirname, 'audit-out');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

// module name as navigateTo() expects (matches getFormHtml pageMap keys)
const FORMS = ['GRN', 'IQC', 'OQC', 'NCR', 'Dispatch', 'Production'];

const MEASURE = () => {
  const btns = [...document.querySelectorAll('button')].map(b => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    return {
      id: b.id || ('.' + b.className.split(' ')[0]).slice(0, 28),
      text: (b.textContent || '').trim().slice(0, 22),
      visible, w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top), bg: cs.backgroundColor,
      offscreen: r.top > window.innerHeight + 50 || r.bottom < -50
    };
  });
  const sel = [...document.querySelectorAll('select')].map(s => ({ id: s.id, opts: s.options.length }));
  return {
    title: document.title,
    btnCount: btns.length,
    invisible: btns.filter(b => !b.visible).map(b => b.id + '|' + b.text),
    offscreen: btns.filter(b => b.offscreen && b.visible).map(b => b.id + '|' + b.text + '|top' + b.top),
    transparentBg: btns.filter(b => b.bg === 'rgba(0, 0, 0, 0)' && b.visible).length,
    docHeight: document.body.scrollHeight,
    winHeight: window.innerHeight,
    selects: sel,
    btns
  };
};

(async () => {
  const browser = await launch();
  let { page, app, errors } = await openApp(browser);
  const report = {};
  for (const form of FORMS) {
    errors.length = 0;
    const navRes = await nav(app, page, form);
    await page.waitForTimeout(2500);
    // After document.write the form replaces the Landing frame. Find frame with the most buttons.
    let frame = null, maxBtns = -1;
    for (const f of page.frames()) {
      try { const n = await f.evaluate(() => document.querySelectorAll('button,select,input').length); if (n > maxBtns) { maxBtns = n; frame = f; } } catch (_) {}
    }
    let audit = { navRes, foundFrame: !!frame };
    if (frame) { try { audit = { ...audit, ...(await frame.evaluate(MEASURE)) }; } catch (e) { audit.measureErr = String(e).slice(0, 120); } }
    audit.consoleErrors = errors.slice(0, 15);
    report[form] = audit;
    await page.screenshot({ path: path.join(OUT, form + '.png'), fullPage: true }).catch(() => {});
    console.log(`[${form}] title="${audit.title || '?'}" nav=${navRes} btns=${audit.btnCount || 0} invis=${(audit.invisible || []).length} offscr=${(audit.offscreen || []).length} transp=${audit.transparentBg || 0} docH=${audit.docHeight} errs=${audit.consoleErrors.length}`);
    // Return to landing SPA for next nav (document.write destroyed navigateTo)
    await page.goto((require('./e2e-lib').WRAP) + '?page=landing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    var newApp = await appFrame(page, 20000);
    if (newApp) app = newApp; // eslint-disable-line
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nWrote audit-out/report.json + screenshots');
  await browser.close();
})();
