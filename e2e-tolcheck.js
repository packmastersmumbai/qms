// e2e-tolcheck.js — verify the advisory tolerance check on the LIVE IQC form.
// Exercises the real shipped functions in the real page context; it does NOT
// re-implement them here, because a probe that reasons about its own copy of the
// logic proves nothing about what operators run.
//
// Deliberately does not drive a full GRN: the fixture gap (Phase 3A) is still
// open, and the units under test are the pure functions plus the row renderer.
const { launch, openApp, nav, frameWith } = require('./e2e-lib');

(async () => {
  const b = await launch();
  const s = await openApp(b);
  await nav(s.app, s.page, 'IQC');
  await s.page.waitForTimeout(13000);
  const fr = await frameWith(s.page, 'inspLevel', 20000);
  if (!fr) { console.log('IQC did not load'); await b.close(); return; }

  const r = await fr.evaluate(() => {
    const out = { present: {}, cases: [], render: {}, err: null };
    try {
      ['isMeasuredParam', 'checkTolerance', 'numericLimit', 'setParamValue',
       'renderToleranceHint', 'makeValueHandler'].forEach(function (fn) {
        out.present[fn] = (typeof window[fn] === 'function');
      });
      if (!out.present.checkTolerance) { out.err = 'functions not shipped'; return out; }

      // Gating: which params get a reading box.
      const measured    = { unit: 'mm',  method: 'Dimensional' };
      const qualitative = { unit: '',    method: 'Visual' };
      const dashUnit    = { unit: '-',   method: 'Visual' };
      const noMethod    = { unit: 'kPa', method: '' };
      out.cases.push(['measured mm/Dimensional -> input', isMeasuredParam(measured) === true]);
      out.cases.push(['visual no-unit -> no input',       isMeasuredParam(qualitative) === false]);
      out.cases.push(['unit "-" -> no input',             isMeasuredParam(dashUnit) === false]);
      out.cases.push(['unit but no method -> no input',   isMeasuredParam(noMethod) === false]);

      // The placeholder state every measured param is in TODAY: no real limits.
      const placeholder = { unit: 'kPa', method: 'Mechanical', tolMin: '', tolMax: '' };
      out.cases.push(['no limits -> state none', checkTolerance(placeholder, '450').state === 'none']);

      // Text limits must not be coerced. Number('Min as per spec') is NaN, but
      // Number('') is 0 — the trap this guards.
      const textLimit = { unit: 'kPa', method: 'Mechanical', tolMin: 'Min as per spec', tolMax: '' };
      out.cases.push(['text limit -> state none', checkTolerance(textLimit, '450').state === 'none']);
      out.cases.push(['numericLimit("") is null', numericLimit('') === null]);
      out.cases.push(['numericLimit("-") is null', numericLimit('-') === null]);
      out.cases.push(['numericLimit("0") is 0',    numericLimit('0') === 0]);

      // Real limits: the state QA's spec sheet will produce.
      const real = { unit: 'kPa', method: 'Mechanical', tolMin: 440, tolMax: 460 };
      out.cases.push(['450 in [440,460] -> ok',   checkTolerance(real, '450').state === 'ok']);
      out.cases.push(['430 -> low',               checkTolerance(real, '430').state === 'low']);
      out.cases.push(['470 -> high',              checkTolerance(real, '470').state === 'high']);
      out.cases.push(['440 boundary -> ok',       checkTolerance(real, '440').state === 'ok']);
      out.cases.push(['460 boundary -> ok',       checkTolerance(real, '460').state === 'ok']);
      out.cases.push(['blank reading -> none',    checkTolerance(real, '').state === 'none']);
      out.cases.push(['non-numeric reading -> none', checkTolerance(real, 'abc').state === 'none']);

      // One-sided limits.
      const minOnly = { unit: 'N', method: 'Mechanical', tolMin: 200, tolMax: '' };
      out.cases.push(['min-only, 250 -> ok',  checkTolerance(minOnly, '250').state === 'ok']);
      out.cases.push(['min-only, 150 -> low', checkTolerance(minOnly, '150').state === 'low']);
      const maxOnly = { unit: '%', method: 'Instrumental', tolMin: '', tolMax: 5 };
      out.cases.push(['max-only, 3 -> ok',   checkTolerance(maxOnly, '3').state === 'ok']);
      out.cases.push(['max-only, 8 -> high', checkTolerance(maxOnly, '8').state === 'high']);

      // Zero must behave as a real limit, not as absent.
      const zeroMin = { unit: 'mm', method: 'Dimensional', tolMin: 0, tolMax: 10 };
      out.cases.push(['zero min, -1 -> low', checkTolerance(zeroMin, '-1').state === 'low']);
      out.cases.push(['zero min, 0 -> ok',   checkTolerance(zeroMin, '0').state === 'ok']);

      // Renderer: does a real row get an input, and does a breach paint amber?
      if (typeof buildParamSection === 'function' && typeof itemData !== 'undefined') {
        window.IQC_PARAMS = [
          { id: 'T_MEAS', label: 'Test Burst', unit: 'kPa', method: 'Mechanical',
            tolMin: 440, tolMax: 460, ccp: false, hint: '', std: '' },
          { id: 'T_VIS',  label: 'Test Visual', unit: '', method: 'Visual',
            tolMin: '', tolMax: '', ccp: false, hint: '', std: '' }
        ];
        if (typeof currentIdx !== 'undefined' && itemData[currentIdx]) {
          itemData[currentIdx].params = itemData[currentIdx].params || {};
          itemData[currentIdx].paramValues = {};
          buildParamSection();
          out.render.measuredHasInput   = !!document.getElementById('paramVal_T_MEAS');
          out.render.qualitativeNoInput = !document.getElementById('paramVal_T_VIS');
          setParamValue('T_MEAS', '470');
          const hint = document.getElementById('tolHint_T_MEAS');
          const row  = document.getElementById('paramRow_T_MEAS');
          out.render.hintText   = hint ? hint.textContent : '(no hint el)';
          out.render.rowWarned  = row ? (row.style.background === 'rgb(255, 251, 235)') : false;
          setParamValue('T_MEAS', '450');
          out.render.hintCleared = row ? (row.style.background === '') : false;
        } else out.render.skipped = 'no active item (no GRN selected)';
      } else out.render.skipped = 'renderer not available';
    } catch (e) { out.err = e.message; }
    return out;
  });

  console.log('shipped functions:', JSON.stringify(r.present));
  if (r.err) console.log('ERROR:', r.err);
  let pass = 0, fail = 0;
  r.cases.forEach(function (c) {
    console.log((c[1] ? '  PASS  ' : '  FAIL  ') + c[0]);
    c[1] ? pass++ : fail++;
  });
  console.log('\nlogic: ' + pass + ' passed, ' + fail + ' failed');
  console.log('render:', JSON.stringify(r.render, null, 2));
  console.log(fail === 0 && !r.err ? '\nTOLERANCE CHECK: PASS' : '\nTOLERANCE CHECK: FAIL');
  await b.close();
})();
