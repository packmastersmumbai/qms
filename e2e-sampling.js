// e2e-sampling.js — audit the IQC/OQC sampling panel AS RENDERED.
//
// Reads the live DOM: which Level/AQL/Severity are actually selected on load,
// and what plan the panel computes across lot sizes. Source inspection is not
// evidence here — a default declared server-side may never be applied to the
// control (IQC applies defaultAql but NOT defaultLevel).
//
// Usage: node e2e-sampling.js
const { launch, openApp, nav, frameWith } = require('./e2e-lib');

const LOTS = [100, 500, 1000, 5000, 20000];

(async () => {
  const browser = await launch();

  // ---------- IQC ----------
  console.log('===== IQC =====');
  let s = await openApp(browser);
  await nav(s.app, s.page, 'IQC');
  await s.page.waitForTimeout(13000);
  let fr = await frameWith(s.page, 'inspLevel', 20000);

  if (!fr) {
    console.log('  inspLevel NOT FOUND — form did not load');
  } else {
    const d = await fr.evaluate(() => ({
      level:    (document.getElementById('inspLevel') || {}).value,
      aql:      (document.getElementById('aqlLevel') || {}).value,
      severity: (document.getElementById('samplingSeverity') || {}).value,
      panelCls: (document.getElementById('samplingPanel') || {}).className || ''
    }));
    console.log('  ON LOAD  level=' + d.level + '  aql=' + d.aql + '  severity=' + d.severity);
    console.log('  panel hidden on load:', /hidden/.test(d.panelCls));

    for (const lot of LOTS) {
      const r = await fr.evaluate(async (lotSize) => {
        const set = (id, v) => {
          const el = document.getElementById(id); if (!el) return;
          el.value = String(v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('lotSize', lotSize);
        await new Promise(r => setTimeout(r, 800));
        const txt = (id) => { const e = document.getElementById(id); return e ? (e.textContent || '').trim() : '(missing)'; };
        const val = (id) => { const e = document.getElementById(id); return e ? String(e.value) : '(missing)'; };
        const errEl = document.getElementById('samplingErr') || {};
        return {
          sample: txt('planSample'), ac: txt('planAc'), re: txt('planRe'),
          defects: val('defectsFound'), verdict: txt('planVerdict'),
          err: (errEl.textContent || '').trim(),
          errShown: !/hidden/.test(errEl.className || '')
        };
      }, lot);
      console.log('  lot=' + String(lot).padEnd(6) +
        ' n=' + String(r.sample).padEnd(6) +
        ' Ac=' + String(r.ac).padEnd(4) + ' Re=' + String(r.re).padEnd(4) +
        ' defects=' + String(r.defects).padEnd(3) +
        ' | ' + r.verdict.slice(0, 40) +
        (r.errShown && r.err ? '  ERR:' + r.err : ''));
    }

    // Does the verdict actually react to defects crossing Re?
    const react = await fr.evaluate(async () => {
      const set = (id, v) => { const el = document.getElementById(id); if (!el) return;
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('lotSize', 1000);
      await new Promise(r => setTimeout(r, 700));
      const re = parseInt((document.getElementById('planRe') || {}).textContent, 10);
      const out = { re: re };
      set('defectsFound', re);
      await new Promise(r => setTimeout(r, 600));
      out.atRe = ((document.getElementById('planVerdict') || {}).textContent || '').trim();
      set('defectsFound', re + 5);
      await new Promise(r => setTimeout(r, 600));
      out.atRePlus5 = ((document.getElementById('planVerdict') || {}).textContent || '').trim();
      set('defectsFound', 0);
      await new Promise(r => setTimeout(r, 600));
      out.atZero = ((document.getElementById('planVerdict') || {}).textContent || '').trim();
      return out;
    });
    console.log('  --- verdict reaction (lot 1000, Re=' + react.re + ') ---');
    console.log('  defects=0      :', react.atZero.slice(0, 46));
    console.log('  defects=Re     :', react.atRe.slice(0, 46));
    console.log('  defects=Re+5   :', react.atRePlus5.slice(0, 46));
  }
  await s.ctx.close();

  // ---------- OQC ----------
  console.log('\n===== OQC =====');
  s = await openApp(browser);
  await nav(s.app, s.page, 'OQC');
  await s.page.waitForTimeout(13000);
  fr = await frameWith(s.page, 'oqcLevel', 20000);
  if (!fr) {
    console.log('  oqcLevel NOT FOUND — form did not load');
  } else {
    const d = await fr.evaluate(() => ({
      level:    (document.getElementById('oqcLevel') || {}).value,
      aql:      (document.getElementById('oqcAql') || {}).value,
      severity: (document.getElementById('oqcSamplingSeverity') || {}).value
    }));
    console.log('  ON LOAD  level=' + d.level + '  aql=' + d.aql + '  severity=' + d.severity);
  }
  await s.ctx.close();

  await browser.close();
})();
