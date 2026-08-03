// e2e-tipcheck.js — verify the ISO 2859-1 guidance ⓘ buttons are attached to the
// sampling controls on the LIVE form, and that tapping one renders its popover.
const { launch, openApp, nav, frameWith } = require('./e2e-lib');

(async () => {
  const b = await launch();
  const s = await openApp(b);
  await nav(s.app, s.page, 'IQC');
  await s.page.waitForTimeout(13000);
  const fr = await frameWith(s.page, 'inspLevel', 20000);
  if (!fr) { console.log('IQC did not load'); await b.close(); return; }

  const r = await fr.evaluate(() => {
    const ids = ['lotSize', 'aqlLevel', 'inspLevel', 'samplingSeverity', 'defectsFound'];
    const attached = {};
    ids.forEach(function (id) {
      const lab = document.querySelector('label[for="' + id + '"]');
      attached[id] = lab ? !!lab.querySelector('.info-btn') : 'NO LABEL';
    });
    const btn = document.querySelector('label[for="inspLevel"] .info-btn');
    let popText = '(not opened)';
    if (btn) {
      btn.click();
      const p = document.getElementById('infoPop');
      popText = p ? p.innerText.trim().slice(0, 220) : '(no popover)';
    }
    return { attached: attached, popText: popText };
  });

  console.log('ⓘ attached per field:');
  Object.keys(r.attached).forEach(function (k) {
    console.log('  ' + k.padEnd(20) + r.attached[k]);
  });
  console.log('\nLevel popover text:\n' + r.popText);
  await b.close();
})();
