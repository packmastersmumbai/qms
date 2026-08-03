// e2e-grnprobe.js — one-shot diagnostic: WHY does e2e-savepaths report GRN
// INCONCLUSIVE when e2e-grntrace proves saveGRN fires?
//
// Instruments the exact same sequence savepaths uses, but reports the state of
// every gate along the way instead of only the final call count. Writes nothing:
// the getter shim swallows saveGRN.
const { launch, openApp, nav, frameWith } = require('./e2e-lib');

(async () => {
  const b = await launch();
  const s = await openApp(b);
  await nav(s.app, s.page, 'GRN');
  await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSubmit', 20000);
  if (!fr) { console.log('GRN did not render'); await b.close(); return; }

  // Same fill savepaths does.
  const fill = await fr.evaluate(async () => {
    const set = (id, v) => {
      const e = document.getElementById(id);
      if (!e) return false;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const opts = id => {
      const e = document.getElementById(id);
      return e && e.options ? [...e.options].map(o => o.value).filter(Boolean) : [];
    };
    const sup = opts('supplier');
    if (!sup.length) return { stop: 'supplier empty' };
    set('supplier', sup[0]);
    await new Promise(r => setTimeout(r, 3500));
    const items = opts('item');
    if (!items.length) return { stop: 'item empty after supplier', supplier: sup[0] };
    set('item', items[0]);
    await new Promise(r => setTimeout(r, 1500));
    set('qtyReceived', 100);
    set('batchNo', 'TESTBATCH1');
    const dt = document.getElementById('date');
    if (dt && !dt.value) set('date', new Date().toISOString().slice(0, 10));
    return { supplier: sup[0], item: items[0], supCount: sup.length, itemCount: items.length };
  });
  console.log('fill:', JSON.stringify(fill));
  if (fill.stop) { console.log('STOPPED:', fill.stop); await b.close(); return; }
  await s.page.waitForTimeout(1500);

  const r = await fr.evaluate(() => {
    const log = [];
    let captured = null;
    const calls = [];

    // Getter shim — the known-correct interception point.
    const real = google.script.run;
    Object.defineProperty(google.script, 'run', {
      configurable: true,
      get: function () {
        const w = Object.create(real);
        w.saveGRN = function (payload) {
          captured = payload;
          calls.push('saveGRN');
          log.push('>>> saveGRN INTERCEPTED');
          return { withSuccessHandler() { return this; }, withFailureHandler() { return this; } };
        };
        return w;
      }
    });

    const btn = document.getElementById('btnSubmit');
    log.push('btnSubmit disabled=' + (btn ? btn.disabled : 'MISSING'));
    log.push('typeof doSave=' + typeof doSave);

    // Does the form think it is valid? Report whatever validation surface exists.
    try {
      if (typeof validateForm === 'function') log.push('validateForm()=' + validateForm());
    } catch (e) { log.push('validateForm threw: ' + e.message); }

    try { doSave(); log.push('doSave() returned'); }
    catch (e) { log.push('doSave THREW: ' + e.message); }

    return new Promise(resolve => {
      setTimeout(() => {
        // What is on screen 800ms after doSave?
        const modals = [...document.querySelectorAll('div,dialog')].filter(d => {
          const cs = getComputedStyle(d);
          return cs.display !== 'none' && cs.visibility !== 'hidden' &&
                 /fixed|absolute/.test(cs.position) && (parseInt(cs.zIndex, 10) || 0) > 100;
        });
        log.push('visible overlays: ' + modals.length);
        modals.slice(0, 3).forEach((m, i) => {
          log.push('  overlay[' + i + '] z=' + getComputedStyle(m).zIndex +
                   ' text="' + (m.textContent || '').trim().slice(0, 70).replace(/\s+/g, ' ') + '"');
        });
        log.push('op-name-btn count: ' + document.querySelectorAll('.op-name-btn').length);
        const conf = document.getElementById('opConfirmBtn');
        log.push('opConfirmBtn: ' + (conf ? ('disabled=' + conf.disabled) : 'ABSENT'));

        // Answer the operator modal the way the probe does.
        const nameBtn = document.querySelector('.op-name-btn');
        if (nameBtn) { nameBtn.click(); log.push('clicked op-name-btn "' + (nameBtn.textContent || '').trim().slice(0, 20) + '"'); }
        setTimeout(() => {
          const c2 = document.getElementById('opConfirmBtn');
          log.push('after name click, opConfirmBtn disabled=' + (c2 ? c2.disabled : 'ABSENT'));
          if (c2 && !c2.disabled) { c2.click(); log.push('clicked Confirm'); }
          else if (c2) log.push('Confirm STILL DISABLED — cannot proceed');

          // Poll for the dispatch.
          let ticks = 0;
          const iv = setInterval(() => {
            ticks++;
            if (calls.length || ticks > 24) {
              clearInterval(iv);
              log.push('final calls=' + calls.length + ' after ' + (ticks * 500) + 'ms');
              log.push('btnSubmit now: disabled=' + (btn ? btn.disabled : '?') +
                       ' text="' + (btn ? (btn.innerHTML || '').replace(/<[^>]*>/g, '').trim().slice(0, 24) : '') + '"');
              const toast = document.querySelector('.toast, #toast, [class*="toast"]');
              if (toast) log.push('toast: "' + (toast.textContent || '').trim().slice(0, 80) + '"');
              resolve({ log, calls, captured });
            }
          }, 500);
        }, 900);
      }, 800);
    });
  });

  r.log.forEach(l => console.log('  ' + l));
  console.log('\ncalls:', r.calls.length);
  if (r.captured) {
    console.log('payload keys:', Object.keys(r.captured).join(', '));
    console.log('clientTxnId present:', !!r.captured.clientTxnId);
  }
  await b.close();
})();
