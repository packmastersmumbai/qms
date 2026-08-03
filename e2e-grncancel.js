// e2e-grncancel.js — prove the GRN save latch survives an operator-modal cancel.
//
// Regression guard for the "GRN issue in saving" bug: onCancel restored the
// button label but left _grnSaveInFlight true, so every later press hit the
// in-flight guard and did nothing. The form was dead until reload.
//
// Fills the form, opens the operator modal, cancels it, then asserts the form
// is still submittable. Writes nothing (saveGRN is intercepted).
const { launch, openApp, nav, frameWith } = require('./e2e-lib');

(async () => {
  const b = await launch();
  const s = await openApp(b);
  await nav(s.app, s.page, 'GRN');
  await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSubmit', 20000);
  if (!fr) { console.log('GRN did not load'); await b.close(); return; }

  const r = await fr.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = String(v);
      e.dispatchEvent(new Event('input',  { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const optsOf = (id) => {
      const e = document.getElementById(id);
      return e && e.options ? Array.from(e.options).map(o => o.value).filter(Boolean) : [];
    };

    let saveCalls = 0;
    try {
      const real = google.script.run;
      const shim = {
        withSuccessHandler() { return this; },
        withFailureHandler() { return this; },
        saveGRN() { saveCalls++; return this; }
      };
      Object.keys(real).forEach(k => { if (!(k in shim)) shim[k] = function () { return shim; }; });
      google.script.run = shim;
    } catch (e) {}

    const sup = optsOf('supplier');
    if (sup.length) set('supplier', sup[0]);
    await sleep(3500);
    const items = optsOf('item');
    if (items.length) set('item', items[0]);
    await sleep(1200);
    set('qtyReceived', 100);
    set('batchNo', 'TESTBATCH1');
    await sleep(1200);

    const out = {};
    const btn = document.getElementById('btnSubmit');
    out.beforeDisabled = btn.disabled;

    // 1) press Save -> operator modal should open, WITHOUT claiming "Saving…"
    doSave();
    await sleep(2000);
    out.labelWhileModalOpen = (btn.innerHTML || '').replace(/<[^>]*>/g, '').trim().slice(0, 30);
    out.saysSavingTooEarly  = /saving/i.test(btn.innerHTML || '');
    out.inFlightDuringModal = (typeof _grnSaveInFlight !== 'undefined') ? _grnSaveInFlight : '(undef)';

    // 2) cancel the modal the way a user would (Esc / close / backdrop)
    const modal = Array.from(document.querySelectorAll('div,dialog')).find(function (d) {
      const cs = getComputedStyle(d);
      return cs.display !== 'none' && /fixed|absolute/.test(cs.position) &&
             (parseInt(cs.zIndex, 10) || 0) > 100 && /who are you/i.test(d.textContent || '');
    });
    out.modalFound = !!modal;
    if (modal) {
      const closer = Array.from(modal.querySelectorAll('button')).find(x =>
        /cancel|close|×|✕/i.test((x.textContent || '') + (x.getAttribute('aria-label') || '')));
      if (closer) { closer.click(); out.closedVia = 'cancel button'; }
      else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        out.closedVia = 'Escape';
      }
    }
    await sleep(2000);

    // 3) THE ASSERTION: is the form still usable?
    out.inFlightAfterCancel = (typeof _grnSaveInFlight !== 'undefined') ? _grnSaveInFlight : '(undef)';
    out.disabledAfterCancel = btn.disabled;
    out.labelAfterCancel    = (btn.innerHTML || '').replace(/<[^>]*>/g, '').trim().slice(0, 30);

    // 4) can a second press still reach the save path?
    doSave();
    await sleep(1500);
    out.secondPressReopenedModal = !!Array.from(document.querySelectorAll('div,dialog')).find(function (d) {
      const cs = getComputedStyle(d);
      return cs.display !== 'none' && /fixed|absolute/.test(cs.position) &&
             (parseInt(cs.zIndex, 10) || 0) > 100 && /who are you/i.test(d.textContent || '');
    });
    out.saveCalls = saveCalls;
    return out;
  });

  Object.keys(r).forEach(k => console.log('  ' + k.padEnd(26) + r[k]));

  const ok = r.inFlightAfterCancel === false && r.disabledAfterCancel === false && r.secondPressReopenedModal === true;
  console.log('\n' + (ok ? 'PASS — form still submittable after cancel'
                         : 'FAIL — form is stuck after cancelling the operator modal'));
  await b.close();
})();
