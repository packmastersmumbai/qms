// e2e-grnsave.js — DRY probe of the GRN save path.
//
// Fills the form the way an operator would (supplier -> material -> qty -> batch),
// then INTERCEPTS google.script.run.saveGRN so nothing is written. Reports the
// exact payload the client would send and whether the Save button unlatches.
//
// Purpose: diagnose "GRN issue in saving" without creating a real record.
const { launch, openApp, nav, frameWith } = require('./e2e-lib');

(async () => {
  const b = await launch();
  const s = await openApp(b);
  const errs = [];
  s.page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await nav(s.app, s.page, 'GRN');
  await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSubmit', 20000);
  if (!fr) { console.log('GRN did not load'); await b.close(); return; }

  const r = await fr.evaluate(async () => {
    const log = [];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const set = (id, v) => {
      const e = document.getElementById(id);
      if (!e) { log.push(id + ': MISSING'); return false; }
      e.value = String(v);
      e.dispatchEvent(new Event('input',  { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const optsOf = (id) => {
      const e = document.getElementById(id);
      return e && e.options ? Array.from(e.options).map(o => o.value).filter(Boolean) : [];
    };

    // ---- INTERCEPT the save so nothing is written ----
    let captured = null;
    const calls = [];
    try {
      const realRun = google.script.run;
      const shim = {
        _s: null, _f: null,
        withSuccessHandler(fn) { this._s = fn; return this; },
        withFailureHandler(fn) { this._f = fn; return this; },
        saveGRN(payload) { captured = payload; calls.push('saveGRN'); return this; }
      };
      // Record EVERY server call attempted, so a save that stops at some earlier
      // RPC is visible instead of looking like "nothing happened".
      Object.keys(realRun).forEach(k => {
        if (!(k in shim)) shim[k] = function () { calls.push(k); return shim; };
      });
      google.script.run = shim;
    } catch (e) { log.push('intercept failed: ' + e.message); }

    // ---- Fill like an operator ----
    const sup = optsOf('supplier');
    log.push('supplier options: ' + sup.length);
    if (sup.length) { set('supplier', sup[0]); log.push('picked supplier=' + sup[0]); }
    await sleep(3500);   // materials load per supplier

    const items = optsOf('item');
    log.push('item options after supplier: ' + items.length);
    if (items.length) { set('item', items[0]); log.push('picked item=' + items[0]); }
    await sleep(1500);

    set('qtyReceived', 100);
    set('batchNo', 'TESTBATCH1');
    const dt = document.getElementById('date');
    if (dt && !dt.value) set('date', new Date().toISOString().slice(0, 10));
    await sleep(1200);

    const btn = document.getElementById('btnSubmit');
    const before = { disabled: btn ? btn.disabled : null, title: btn ? btn.title : '' };

    // Read the blocking hint if still latched
    let hint = '';
    const hintEl = document.getElementById('submitHint') || document.querySelector('.submit-hint');
    if (hintEl) hint = (hintEl.textContent || '').trim().slice(0, 160);

    let clickErr = '';
    let visibleErr = '';
    if (btn && !btn.disabled) {
      // window.onerror catches throws that happen inside handlers the page owns,
      // which a try/catch around doSave() alone can miss.
      window.addEventListener('error', function (ev) {
        if (!clickErr) clickErr = (ev.message || '') + ' @ ' + (ev.filename || '').split('/').pop() + ':' + ev.lineno;
      });
      try { doSave(); } catch (e) { clickErr = e.message + ' || ' + String(e.stack || '').slice(0, 300); }
      await sleep(2500);
      const eb = document.getElementById('errBox') || document.querySelector('.err-box,#formErr,.error');
      if (eb) visibleErr = (eb.textContent||'').trim().slice(0,160);

      // Is an operator modal now on screen, blocking the save?
      const modal = Array.from(document.querySelectorAll('div,dialog')).find(function (d) {
        const cs = getComputedStyle(d);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (!/fixed|absolute/.test(cs.position)) return false;
        const z = parseInt(cs.zIndex, 10) || 0;
        return z > 100 && /who|operator|inspector|name/i.test(d.textContent || '');
      });
      window.__modalFound = modal ? (modal.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    }

    return {
      log: log,
      btnBefore: before,
      hint: hint,
      captured: captured,
      calls: calls,
      clickErr: clickErr,
      visibleErr: visibleErr,
      state: {
        supplierObj: (typeof supplierObj !== 'undefined') ? JSON.stringify(supplierObj).slice(0, 90) : '(undef)',
        itemObj:     (typeof itemObj     !== 'undefined') ? JSON.stringify(itemObj).slice(0, 90)     : '(undef)',
        inFlight:    (typeof _grnSaveInFlight !== 'undefined') ? _grnSaveInFlight : '(undef)',
        activePO:    (typeof _activePO !== 'undefined' && _activePO) ? String(_activePO.poNo) : 'null',
        disposition: (typeof disposition !== 'undefined') ? disposition : '(undef)',
        btnHtml:     ((document.getElementById('btnSubmit') || {}).innerHTML || '').slice(0, 50),
        operatorModal: window.__modalFound || "(none visible)"
      },
      values: {
        supplier: (document.getElementById('supplier') || {}).value,
        item:     (document.getElementById('item') || {}).value,
        qty:      (document.getElementById('qtyReceived') || {}).value,
        batch:    (document.getElementById('batchNo') || {}).value,
        date:     (document.getElementById('date') || {}).value
      }
    };
  });

  r.log.forEach(l => console.log('  ' + l));
  console.log('\nFIELD VALUES  ' + JSON.stringify(r.values));
  console.log('SAVE BUTTON   disabled=' + r.btnBefore.disabled + (r.btnBefore.title ? '  title="' + r.btnBefore.title + '"' : ''));
  if (r.hint) console.log('BLOCKING HINT ' + r.hint);
  console.log('\nSERVER CALLS ATTEMPTED: ' + ((r.calls && r.calls.join(' -> ')) || '(none)'));
  console.log('\nCLIENT STATE');
  Object.keys(r.state).forEach(k => console.log('  ' + k.padEnd(14) + r.state[k]));
  console.log('\nPAYLOAD saveGRN would receive:');
  console.log(r.captured ? JSON.stringify(r.captured, null, 2).slice(0, 1400) : '  (save never fired — button stayed latched)');
  if (errs.length) { console.log('\nCONSOLE ERRORS'); errs.slice(0, 6).forEach(e => console.log('  ' + e)); }

  await b.close();
})();
