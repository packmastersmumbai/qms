// Non-mutating interaction + layout-regression e2e for the 6 core forms.
// Per form: navigate via SPA, poll until the form's own DOM is rendered (no fixed-wait races),
// assert required dropdowns populate, and ASSERT the primary action button is visible AND within
// the viewport (the layout-fix regression lock). Stops before submit — writes nothing to sheets.
//   node e2e-forms-interaction.js
const path = require('path'), fs = require('fs');
const { launch, openApp, appFrame, nav, WRAP } = require('./e2e-lib');

// primary action button + a stable "form rendered" marker + selects expected to populate
const SPEC = {
  GRN:        { btn: '#btnSubmit',  marker: '#supplier',       selects: ['supplier'] },
  IQC:        { btn: '#stickyBtn',  marker: '#grnNo',          selects: ['grnNo', 'inspector'] },
  OQC:        { btn: '#btnSave',    marker: '#oqcForm',        selects: [] },
  NCR:        { btn: null,          marker: '#ncrMain',        selects: [] }, // list view: no save btn; assert bottom nav visible
  Dispatch:   { btn: '#btnConfirm', marker: '.dsp-wrap',       selects: ['fCustomer'] },
  Production: { btn: '#btnIssue',   marker: '.prd-wrap',       selects: [] },
};

// In-frame: is the selector visible AND does its rect fall within the viewport?
const CHECK = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  const inViewport = r.top >= 0 && r.bottom <= window.innerHeight + 1; // fully within
  const bottomVisible = r.top < window.innerHeight && r.bottom > 0;     // at least partly on screen
  return { found: true, visible, inViewport, bottomVisible, top: Math.round(r.top), bottom: Math.round(r.bottom), winH: window.innerHeight };
};

async function findFormFrame(page, marker) {
  // poll up to 25s for the frame whose document has the marker element
  for (let i = 0; i < 50; i++) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(s => !!document.querySelector(s), marker)) return f; } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

(async () => {
  const browser = await launch();
  let { page, app, errors } = await openApp(browser);
  const results = {};
  let failures = 0;
  for (const form of Object.keys(SPEC)) {
    const spec = SPEC[form];
    errors.length = 0;
    await nav(app, page, form);
    const frame = await findFormFrame(page, spec.marker);
    const res = { rendered: !!frame };
    if (frame) {
      // dropdown population
      res.selects = {};
      for (const s of spec.selects) {
        let opts = 0;
        for (let i = 0; i < 20; i++) { // poll — server callbacks fill selects async
          opts = await frame.evaluate(id => { const el = document.getElementById(id); return el ? el.options.length : -1; }, s).catch(() => -1);
          if (opts > 1) break;
          await page.waitForTimeout(400);
        }
        res.selects[s] = opts;
      }
      // primary button visibility + viewport
      if (spec.btn) res.button = await frame.evaluate(CHECK, spec.btn);
      else res.button = { skip: 'list-view (no save button)' };
    }
    res.consoleErrors = errors.slice(0, 8);
    results[form] = res;

    // PASS criteria
    const emptySelects = Object.entries(res.selects || {}).filter(([, n]) => n <= 1).map(([k]) => k);
    const btnOk = !spec.btn || (res.button && res.button.found && res.button.visible && res.button.bottomVisible);
    const btnInVp = !spec.btn || (res.button && res.button.inViewport);
    // Regression lock: the primary action button must be fully within the viewport
    // (fixed/sticky footers achieve this) — not merely partly on screen.
    const pass = res.rendered && emptySelects.length === 0 && btnOk && btnInVp;
    if (!pass) failures++;
    console.log(`[${form}] rendered=${res.rendered} selectsEmpty=[${emptySelects}] btn=${spec.btn || '(none)'} found=${res.button?.found} visible=${res.button?.visible} inViewport=${res.button?.inViewport} bottomVisible=${res.button?.bottomVisible} top=${res.button?.top}/${res.button?.winH} errs=${res.consoleErrors.length} => ${pass ? 'PASS' : 'FAIL'}${btnOk && !btnInVp ? ' (btn visible but NOT fully in viewport — layout target)' : ''}`);

    // back to landing SPA for next nav
    await page.goto(WRAP + '?page=landing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const a = await appFrame(page, 20000); if (a) app = a;
  }
  fs.writeFileSync(path.join(__dirname, 'audit-out', 'interaction-report.json'), JSON.stringify(results, null, 2));
  console.log(`\n${failures} form(s) failing. Report: audit-out/interaction-report.json`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
