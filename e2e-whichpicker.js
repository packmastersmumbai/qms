const { launch, openApp, nav, frameWith } = require('./e2e-lib');
(async () => {
  const b = await launch(); const s = await openApp(b);
  await nav(s.app, s.page, 'GRN'); await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSubmit', 20000);
  const r = await fr.evaluate(() => ({
    reqOpArity: window.QMS && window.QMS.requireOperator ? window.QMS.requireOperator.length : -1,
    showArity:  window.QMS && window.QMS.showOperatorPicker ? window.QMS.showOperatorPicker.length : -1,
    src: window.QMS && window.QMS.requireOperator ? String(window.QMS.requireOperator).slice(0,140) : ''
  }));
  console.log('requireOperator arity   :', r.reqOpArity, '(3 = OperatorPicker, 2 = Landing override)');
  console.log('showOperatorPicker arity:', r.showArity);
  console.log('source:', r.src.replace(/\s+/g,' '));
  await b.close();
})();
