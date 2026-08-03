// Where exactly does the GRN save path stop? Instruments each stage rather than
// inferring from "saveGRN was never called".
const { launch, openApp, nav, frameWith } = require('./e2e-lib');
(async () => {
  const b = await launch(); const s = await openApp(b);
  await nav(s.app, s.page, 'GRN'); await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSubmit', 20000);
  if (!fr) { console.log('no frame'); await b.close(); return; }

  const r = await fr.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const set = (id,v) => { const e=document.getElementById(id); if(!e) return;
      e.value=String(v); e.dispatchEvent(new Event('input',{bubbles:true}));
      e.dispatchEvent(new Event('change',{bubbles:true})); };
    const opts = id => { const e=document.getElementById(id);
      return e&&e.options?Array.from(e.options).map(o=>o.value).filter(Boolean):[]; };

    const trace = [];
    // Fill with the real bridge.
    const sup = opts('supplier'); if (sup.length) set('supplier', sup[0]);
    await sleep(3500);
    const it = opts('item'); if (it.length) set('item', it[0]);
    await sleep(1200);
    set('qtyReceived', 100); set('batchNo','TRACE1');
    await sleep(1200);

    // Instrument the pipeline WITHOUT replacing google.script.run.
    // Intercept via the PROTOTYPE-level accessor rather than assigning to the
    // object: google.script.run returns a NEW proxy on each property access in
    // GAS, so `realRun.saveGRN = fn` decorates a snapshot the page never uses
    // again. Wrapping the getter is what actually observes the call.
    const realRun = google.script.run;
    let sawSave = false;
    try {
      Object.defineProperty(google.script, 'run', {
        configurable: true,
        get: function () {
          const r = realRun;
          const wrapped = Object.create(r);
          wrapped.saveGRN = function (p) {
            sawSave = true; window.__payload = p; trace.push('saveGRN CALLED');
            return wrapped;   // swallow — never reaches the server
          };
          wrapped.withSuccessHandler = function () { return wrapped; };
          wrapped.withFailureHandler = function () { return wrapped; };
          return wrapped;
        }
      });
    } catch (e) { trace.push('defineProperty failed: ' + e.message); }
    const origSave = null;
    if (typeof uploadImagesAndSave_ === 'function') {
      const u = uploadImagesAndSave_;
      window.uploadImagesAndSave_ = function(cb){ trace.push('uploadImagesAndSave_'); return u(cb); };
    }
    if (typeof _doSaveProceed === 'function') {
      const d = _doSaveProceed;
      window._doSaveProceed = function(){ trace.push('_doSaveProceed'); return d.apply(this, arguments); };
    }
    // Instrument the last hop: doActualSave_ is a CLOSURE inside _doSaveProceed,
    // so it cannot be wrapped from outside. Instead detect whether the offline
    // gate or the watchdog fired, and capture any visible error.
    const errs = [];
    window.addEventListener('error', ev => errs.push('ERR ' + ev.message));
    void origSave;

    trace.push('btn.disabled=' + document.getElementById('btnSubmit').disabled);
    try { doSave(); trace.push('doSave returned'); } catch(e){ trace.push('doSave THREW: '+e.message); }
    await sleep(1500);

    const picker = document.querySelector('.op-name-btn');
    trace.push('op-name-btn present: ' + !!picker);
    if (picker) {
      picker.click(); trace.push('clicked operator');
      await sleep(600);
      const conf = Array.from(document.querySelectorAll('button'))
        .find(x => /confirm/i.test(x.textContent||''));
      trace.push('confirm btn: ' + !!conf + ' disabled=' + (conf ? conf.disabled : '?'));
      if (conf && !conf.disabled) { conf.click(); trace.push('clicked confirm'); }
      else if (conf) trace.push('CONFIRM STILL DISABLED — operator not registered as selected');
      // The save is async: uploadImagesAndSave_ -> doActualSave_ -> saveGRN.
      // Poll instead of a fixed wait so a slow bridge is not read as "never fired".
      for (let i = 0; i < 20 && !window.__payload; i++) await sleep(500);
    }
    trace.push('inFlight=' + (typeof _grnSaveInFlight!=='undefined'?_grnSaveInFlight:'?'));
    trace.push('payload had clientTxnId: ' + !!(window.__payload && window.__payload.clientTxnId));
    trace.push('navigator.onLine=' + navigator.onLine);
    const eb = document.getElementById('errBox') || document.querySelector('.err-box,#formErr');
    trace.push('visible error: ' + (eb ? (eb.textContent||'').trim().slice(0,90) : '(none)'));
    const btnNow = document.getElementById('btnSubmit');
    trace.push('btn now: disabled=' + btnNow.disabled + ' text=' + (btnNow.textContent||'').trim().slice(0,24));
    trace.push('js errors: ' + (errs.join(' | ') || 'none'));
    trace.push('_grnImages len: ' + (typeof _grnImages!=='undefined'?_grnImages.length:'?'));
    trace.push('img-upload-status hidden: ' + (function(){var e=document.getElementById('img-upload-status');return e?e.className.indexOf('hidden')>=0:'?';})());
    trace.push('img msg: ' + (function(){var e=document.getElementById('img-upload-msg');return e?(e.textContent||'').trim().slice(0,50):'?';})());
    return trace;
  });
  r.forEach(l => console.log('  ' + l));
  await b.close();
})();
