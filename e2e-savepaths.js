// e2e-savepaths.js — non-destructive regression test: verify every form's SAVE PATH
// is reachable and guarded, WITHOUT writing any records.
//
// For each form we:
//   a) load it and locate the save button
//   b) intercept google.script.run so the real write function NEVER reaches the
//      server (the shim just counts calls) — this is the load-bearing safety net
//   c) fill the minimum fields generically (first non-empty <select> option,
//      1/TEST for required inputs), or drive the form's own pick/preview flow
//      when a generic fill can't reach the save button
//   d) double-tap the save control with the shim installed and count dispatches
//   e) inspect the captured payload for a clientTxnId-like idempotency key
//   f) check whether the button/UI shows an in-flight state after the first tap
//
// Forms that cannot be brought to a submittable state generically (they depend
// on live server data — an existing gatepass, an open rework item, FIFO lot
// picks, IPQC sessions, filled AQL parameter grids) are reported SKIPPED with
// the reason. We do not fabricate a PASS for those.
//
// Settle times per e2e-suite.js: most forms 11s, IQC 13s.
const { launch, openApp, nav, frameWith } = require('./e2e-lib');

// ---- generic DOM helpers, installed onto `window` inside the target frame ----
function installHelpers() {
  window.__set = function (id, v) {
    var e = document.getElementById(id);
    if (!e) return false;
    e.value = String(v);
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  window.__optsOf = function (id) {
    var e = document.getElementById(id);
    return e && e.options ? Array.from(e.options).map(function (o) { return o.value; }).filter(Boolean) : [];
  };
  window.__pickFirst = function (id) {
    var opts = window.__optsOf(id);
    if (!opts.length) return null;
    return window.__set(id, opts[0]) ? opts[0] : null;
  };
  window.__installShim = function (writeFnName) {
    var calls = [];
    var captured = null;
    try {
      // Intercept via a PROPERTY GETTER on google.script, not by assigning to
      // google.script.run.
      //
      // In GAS, `google.script.run` yields a NEW proxy object on every property
      // access. So `run.saveGRN = fn` decorates a snapshot the page never reads
      // again — the next `google.script.run.saveGRN(...)` gets a fresh proxy with
      // the original function. That is why every earlier version of this probe
      // reported "button reachable but write never dispatched": the save WAS
      // firing, the shim just could not see it. Two prior fixes (fill-order, then
      // mutate-in-place) both missed this and left GRN wrongly INCONCLUSIVE.
      //
      // Wrapping the getter returns a per-access object that inherits every real
      // read method (so the save path's own reads still work) while overriding
      // only the write, which is swallowed.
      var real = google.script.run;
      Object.defineProperty(google.script, 'run', {
        configurable: true,
        get: function () {
          var wrapped = Object.create(real);
          // Only the write is swallowed. withSuccessHandler/withFailureHandler are
          // NOT overridden here — the save path chains them onto REAL read calls
          // (getPOById, image upload), and stubbing them would strand those
          // callbacks and re-create the very stall this fix removes. The dead-end
          // is returned from the write itself, which is the last hop.
          wrapped[writeFnName] = function (payload) {
            captured = payload;
            calls.push(writeFnName);
            return { withSuccessHandler: function () { return this; },
                     withFailureHandler: function () { return this; } };
          };
          return wrapped;
        }
      });
    } catch (e) { /* leave real run in place; caller sees 0 calls */ }
    return { calls: calls, get captured() { return captured; } };
  };
}

// ---- per-form drivers ----
// GRN/IQC/Gatepass/PO/Rework each need their own multi-stage cascade (cascading
// selects, preview-then-confirm modals, live-data gating), so each gets an
// explicit async function below rather than forcing one generic shape.

async function runGRN(s) {
  await nav(s.app, s.page, 'GRN');
  await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSubmit', 20000);
  if (!fr) return { skip: 'form did not render (btnSubmit not found)' };
  await fr.evaluate(installHelpers);

  const sup = await fr.evaluate(() => window.__optsOf('supplier'));
  if (!sup.length) return { skip: 'supplier select empty — no live data to pick' };
  await fr.evaluate(() => window.__pickFirst('supplier'));
  await s.page.waitForTimeout(3500);

  const items = await fr.evaluate(() => window.__optsOf('item'));
  if (!items.length) return { skip: 'item select empty after supplier pick — no live data' };
  await fr.evaluate(() => window.__pickFirst('item'));
  await s.page.waitForTimeout(1500);

  await fr.evaluate(() => { window.__set('qtyReceived', 100); window.__set('batchNo', 'TESTBATCH1'); });
  const dt = await fr.evaluate(() => !!document.getElementById('date'));
  if (dt) await fr.evaluate(() => { if (!document.getElementById('date').value) window.__set('date', new Date().toISOString().slice(0, 10)); });
  await s.page.waitForTimeout(1200);

  const r = await fr.evaluate(() => {
    const shim = window.__installShim('saveGRN');
    const btn = document.getElementById('btnSubmit');
    const btnExists = !!btn;
    const beforeDisabled = btn ? btn.disabled : null;

    // GRN gates the save behind an operator-identity modal ("Who are you?"), so
    // doSave() does NOT reach saveGRN on its own — it waits for a human. The old
    // probe pressed Save, waited 300ms and reported "write never dispatched",
    // which measured the modal, not the save path.
    //
    // Answer the modal the way an operator would, then let the real chain run.
    const answerOperatorModal = () => {
      const modal = Array.from(document.querySelectorAll('div,dialog')).find(d => {
        const cs = getComputedStyle(d);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (!/fixed|absolute/.test(cs.position)) return false;
        return (parseInt(cs.zIndex, 10) || 0) > 100 && /who are you/i.test(d.textContent || '');
      });
      if (!modal) return false;
      // OperatorPicker renders each name as <button class="op-name-btn" data-name>.
      // Target that explicitly — a text-shape regex also matched the Confirm
      // button and other chrome, so the operator was never actually selected and
      // Confirm stayed inert.
      const name = document.querySelector('.op-name-btn');
      if (name) name.click();
      // Confirm ships DISABLED (OperatorPicker.html:61) and is only enabled once a
      // name is selected. Clicking it while disabled is a no-op the DOM silently
      // swallows, so the callback never fires and the save stalls on "Saving…".
      const confirm = document.getElementById('opConfirmBtn') ||
        Array.from(modal.querySelectorAll('button')).find(b => /confirm/i.test(b.textContent || ''));
      if (confirm && confirm.disabled) return false;   // selection did not register
      if (confirm) confirm.click();
      return !!(name && confirm);
    };

    const dbg = [];
    if (btn && !btn.disabled) { try { doSave(); dbg.push('doSave ok'); } catch (e) { dbg.push('doSave threw: '+e.message); } }
    return new Promise(resolve => setTimeout(() => {
      const modalAnswered = answerOperatorModal();
      dbg.push('modalAnswered=' + modalAnswered);
      dbg.push('opConfirm disabled=' + (function(){var c=document.getElementById('opConfirmBtn');return c?c.disabled:'no-btn';})());
      dbg.push('name btns=' + document.querySelectorAll('.op-name-btn').length);
      setTimeout(() => {
        const afterFirst = { disabled: btn ? btn.disabled : null,
          html: btn ? (btn.innerHTML||'').replace(/<[^>]*>/g,'').trim().slice(0,30) : '' };
        // Second tap — the double-dispatch check.
        if (btn && !btn.disabled) { try { doSave(); } catch (e) {} }
        setTimeout(async () => {
          answerOperatorModal();
          // The save is async (operator -> image upload -> saveGRN). Poll rather
          // than guess a fixed delay: a fixed 300ms wait is what made this report
          // "write never dispatched" when the write was simply still in flight.
          for (let i = 0; i < 20 && !shim.calls.length; i++) {
            await new Promise(r => setTimeout(r, 500));
          }
          dbg.push('calls=' + shim.calls.length);
          resolve({ btnExists, beforeDisabled, modalAnswered, dbg,
            afterFirst, calls: shim.calls, captured: shim.captured });
        }, 600);
      }, 1500);
    }, 800));
  });
  return finish(r, 'saveGRN');
}

async function runIQC(s) {
  await nav(s.app, s.page, 'IQC');
  await s.page.waitForTimeout(13000);
  const fr = await frameWith(s.page, 'saveBtn', 20000);
  if (!fr) return { skip: 'form did not render (saveBtn not found)' };
  await fr.evaluate(installHelpers);
  // IQC's items come from the linked GRN; if none loaded there's nothing to score.
  const hasItems = await fr.evaluate(() => (typeof currentItems !== 'undefined' && currentItems && currentItems.length > 0));
  if (!hasItems) return { skip: 'no GRN-linked items loaded — cannot fill inspection grid generically' };

  const r = await fr.evaluate(() => {
    // Best-effort: mark overall disposition if a global exists, so saveIQC's first guard passes.
    try { if (typeof overallDisp !== 'undefined') overallDisp = overallDisp || 'ACCEPTED'; } catch (e) {}
    const shim = window.__installShim('saveIQC');
    const btn = document.getElementById('saveBtn');
    const btnExists = !!btn;
    const beforeDisabled = btn ? btn.disabled : null;
    if (btn && !btn.disabled) { try { saveIQC(); } catch (e) {} }
    return new Promise(resolve => setTimeout(() => {
      const afterFirst = { disabled: btn ? btn.disabled : null, html: btn ? (btn.innerHTML||'').replace(/<[^>]*>/g,'').trim().slice(0,30) : '' };
      if (btn && !btn.disabled) { try { saveIQC(); } catch (e) {} }
      setTimeout(() => resolve({ btnExists, beforeDisabled, afterFirst, calls: shim.calls, captured: shim.captured }), 500);
    }, 300));
  });
  if (!r.btnExists || r.beforeDisabled !== false) return { skip: 'saveBtn stayed disabled — could not satisfy form-specific validation generically' };
  return finish(r, 'saveIQC');
}

async function runGatepass(s) {
  await nav(s.app, s.page, 'Gatepass');
  await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'btnSave', 20000);
  if (!fr) return { skip: 'form did not render (btnSave not found)' };
  await fr.evaluate(installHelpers);
  await fr.evaluate(() => {
    window.__pickFirst('materialType');
    window.__set('description', 'TEST');
    window.__set('qty', 1);
    window.__pickFirst('unit');
    window.__set('vehicleNo', 'MH00TEST0000');
    window.__set('driverName', 'TEST DRIVER');
    window.__pickFirst('authorizedBy');
  });
  await s.page.waitForTimeout(800);
  const dispOk = await fr.evaluate(() => {
    // disposition is a button click that sets a module var, not a form field
    const b = document.getElementById('btnApproved');
    if (b) { b.click(); return true; }
    return false;
  });
  await s.page.waitForTimeout(300);

  const r = await fr.evaluate(() => {
    const shim = window.__installShim('saveGatepass');
    const btn = document.getElementById('btnSave');
    const btnExists = !!btn;
    const beforeDisabled = btn ? btn.disabled : null;
    if (btn) { try { doSave(); } catch (e) {} }
    return new Promise(resolve => setTimeout(() => {
      const afterFirst = { disabled: btn ? btn.disabled : null, html: btn ? (btn.innerHTML||'').replace(/<[^>]*>/g,'').trim().slice(0,30) : '' };
      if (btn && !btn.disabled) { try { doSave(); } catch (e) {} }
      setTimeout(() => resolve({ btnExists, beforeDisabled, afterFirst, calls: shim.calls, captured: shim.captured }), 500);
    }, 300));
  });
  return finish(r, 'saveGatepass');
}

async function runPOP(s) {
  await nav(s.app, s.page, 'PO');
  await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'supplierCode', 20000);
  if (!fr) return { skip: 'form did not render (supplierCode not found)' };
  await fr.evaluate(installHelpers);

  const supPicked = await fr.evaluate(() => window.__pickFirst('supplierCode'));
  if (!supPicked) return { skip: 'supplierCode select empty — no live supplier data' };
  await s.page.waitForTimeout(500);

  // fill first line: pick a material, qty=1
  const lineOk = await fr.evaluate(() => {
    const card = document.getElementById('linesBody') && document.getElementById('linesBody').querySelector('.line-card');
    if (!card) return false;
    const sel = card.querySelector('select');
    if (sel) { const opt = Array.from(sel.options).find(o => o.value); if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
    const id = card.id.replace('line-', '');
    const q = document.getElementById('qty-' + id);
    if (q) { q.value = '1'; q.dispatchEvent(new Event('change', { bubbles: true })); }
    return !!(sel && sel.value);
  });
  if (!lineOk) return { skip: 'no material options in PO line — no live master data' };
  await s.page.waitForTimeout(500);

  // doPreview() calls server previewPO — that's a read, not a write, so it's fine to let
  // through; we only intercept the actual savePO/updateDraftPO write before confirmSubmit.
  const previewOk = await fr.evaluate(() => new Promise(resolve => {
    try {
      const realRun = google.script.run;
      const origPreview = realRun.previewPO ? realRun.previewPO.bind(realRun) : null;
      window.__installShim('savePO'); // pre-arm so confirmSubmit's later save is caught too
      doPreview();
      setTimeout(() => resolve(!!(document.getElementById('previewModal') && !document.getElementById('previewModal').classList.contains('hidden'))), 3000);
    } catch (e) { resolve(false); }
  }));
  if (!previewOk) return { skip: 'preview step did not open confirm modal (previewPO likely needs live master/GST data)' };

  const r = await fr.evaluate(() => {
    const shim = window.__installShim('savePO');
    const btn = document.getElementById('btnConfirm');
    const btnExists = !!btn;
    const beforeDisabled = btn ? btn.disabled : null;
    if (btn && !btn.disabled) { try { confirmSubmit(); } catch (e) {} }
    return new Promise(resolve => setTimeout(() => {
      const afterFirst = { disabled: btn ? btn.disabled : null, html: btn ? (btn.innerHTML||'').replace(/<[^>]*>/g,'').trim().slice(0,30) : '' };
      // btnConfirm disables itself synchronously in confirmSubmit; tapping again while
      // disabled simulates the "double click before disable paints" race.
      if (btn) { try { confirmSubmit(); } catch (e) {} }
      setTimeout(() => resolve({ btnExists, beforeDisabled, afterFirst, calls: shim.calls, captured: shim.captured }), 500);
    }, 300));
  });
  return finish(r, 'savePO');
}

async function runRework(s) {
  await nav(s.app, s.page, 'Rework');
  await s.page.waitForTimeout(11000);
  const fr = await frameWith(s.page, 'itemList', 20000);
  if (!fr) return { skip: 'form did not render (itemList not found)' };
  const hasItems = await fr.evaluate(() => (typeof ITEMS !== 'undefined' && ITEMS && ITEMS.length > 0));
  if (!hasItems) return { skip: 'no open rework items in the live queue — nothing to complete' };

  await fr.evaluate(() => openForm(0));
  await s.page.waitForTimeout(500);
  await fr.evaluate(installHelpers);
  const r = await fr.evaluate(() => {
    const isFG = document.getElementById('reOQCBlock').style.display !== 'none';
    window.__set('qtyReworked', 1);
    if (isFG) window.__set('reOQCRef', 'TESTREF'); else window.__set('reIQCRef', 'TESTREF');
    window.__set('completedBy', 'TEST');
    const shim = window.__installShim('submitReworkCompletion');
    const btn = document.getElementById('submitBtn');
    const btnExists = !!btn;
    const beforeDisabled = btn ? btn.disabled : null;
    if (btn && !btn.disabled) { try { submitCompletion(); } catch (e) {} }
    return new Promise(resolve => setTimeout(() => {
      const afterFirst = { disabled: btn ? btn.disabled : null, html: btn ? (btn.innerHTML||'').replace(/<[^>]*>/g,'').trim().slice(0,30) : '' };
      if (btn && !btn.disabled) { try { submitCompletion(); } catch (e) {} }
      setTimeout(() => resolve({ btnExists, beforeDisabled, afterFirst, calls: shim.calls, captured: shim.captured }), 500);
    }, 300));
  });
  return finish(r, 'submitReworkCompletion');
}

// Shared "make sense of the result" step for every driver above.
function finish(r, writeFn) {
  if (!r.btnExists) return { skip: 'save button not found in DOM' };
  const calls = r.calls || [];
  const writeCalls = calls.filter(c => c === writeFn).length;
  // If the button was already disabled before we ever tapped it, the generic
  // fill did not satisfy the form's own readiness check — the save path was
  // never actually exercised. That is a SKIP (unproven), not a PASS.
  if (r.beforeDisabled === true && writeCalls === 0) {
    return { skip: 'save button stayed disabled after generic fill — could not satisfy form-specific validation (readiness check never passed, so the write path was never exercised)' };
  }
  const payload = r.captured;
  const txnKey = payload ? Object.keys(payload).find(k => /txn|idempot/i.test(k)) : null;
  const inFlightShown = !!(r.afterFirst && (r.afterFirst.disabled === true || /saving/i.test(r.afterFirst.html)));
  return {
    ok: true,
    btnExists: true,
    beforeDisabled: r.beforeDisabled,
    writeCalls,
    allCalls: calls,
    hasTxnKey: !!txnKey,
    txnKey: txnKey || null,
    inFlightShown,
  };
}

// Forms not driven above (require deep live-data-dependent multi-step UI that a
// generic script cannot responsibly fabricate: FIFO lot pick lists, IPQC's
// start-check + per-parameter grid, OQC's disposition+AQL+IPQC-session gate,
// CustomerReturn's existing-gatepass item picker). Reported honestly as SKIPPED.
const STATIC_SKIPS = {
  OQC:            'requires live IPQC session pick + full AQL parameter grid (allParamsFilled) + disposition + FG location — no generic fill path without risking a false PASS',
  IPQC:           'requires "Start Check" flow then a per-parameter measurement grid seeded from live tolerances — no generic fill path',
  Dispatch:       'requires FIFO lot selection UI per item (chosenPlan/skipped state) built from live stock — no generic fill path',
  CustomerReturn: 'requires picking an existing live Gatepass and ticking specific returned items — no generic fill path',
};

const RUNNERS = { GRN: runGRN, IQC: runIQC, Gatepass: runGatepass, PO: runPOP, Rework: runRework };

(async () => {
  const b = await launch();
  const rows = [];

  for (const name of ['GRN', 'IQC', 'Gatepass', 'PO', 'Rework']) {
    let s;
    try {
      s = await openApp(b);
      const res = await RUNNERS[name](s);
      rows.push({ name, res });
    } catch (e) {
      rows.push({ name, res: { skip: 'THREW: ' + e.message.slice(0, 120) } });
    } finally {
      try { if (s) await s.ctx.close(); } catch (_) {}
    }
  }
  for (const name of Object.keys(STATIC_SKIPS)) {
    rows.push({ name, res: { skip: STATIC_SKIPS[name] } });
  }

  // ---- report ----
  const order = ['GRN', 'IQC', 'OQC', 'IPQC', 'Dispatch', 'Gatepass', 'CustomerReturn', 'PO', 'Rework'];
  rows.sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name));

  console.log('\n===== e2e-savepaths — per-form table =====');
  console.log(
    'FORM'.padEnd(16) + 'BTN'.padEnd(6) + 'DOUBLE-TAP'.padEnd(12) +
    'TXN-KEY'.padEnd(10) + 'IN-FLIGHT'.padEnd(11) + 'RESULT'
  );
  const doubleDispatch = [];
  const noTxnKey = [];
  const noInFlight = [];

  for (const { name, res } of rows) {
    if (res.skip) {
      console.log(name.padEnd(16) + '-'.padEnd(6) + '-'.padEnd(12) + '-'.padEnd(10) + '-'.padEnd(11) + 'SKIPPED — ' + res.skip);
      continue;
    }
    const dt = res.writeCalls > 1 ? `FAIL(${res.writeCalls}x)` : `PASS(${res.writeCalls}x)`;
    if (res.writeCalls > 1) doubleDispatch.push(name);
    if (!res.hasTxnKey) noTxnKey.push(name);
    if (!res.inFlightShown) noInFlight.push(name);
    const verdict = res.writeCalls > 1 ? 'FAIL — duplicate-record risk'
      : res.writeCalls === 0 ? 'INCONCLUSIVE — button reachable but write never dispatched'
      : 'PASS';
    console.log(
      name.padEnd(16) +
      'YES'.padEnd(6) +
      dt.padEnd(12) +
      (res.hasTxnKey ? 'YES' : 'NO').padEnd(10) +
      (res.inFlightShown ? 'YES' : 'NO').padEnd(11) +
      verdict
    );
  }

  const tested = rows.filter(r => !r.res.skip).length;
  const skipped = rows.filter(r => r.res.skip).length;
  console.log('\n----- ' + tested + ' tested, ' + skipped + ' skipped, ' + rows.length + ' total -----');
  console.log('Forms allowing DOUBLE-DISPATCH on rapid double-tap: ' + (doubleDispatch.length ? doubleDispatch.join(', ') : 'NONE'));
  console.log('Forms with NO clientTxnId-like idempotency key:    ' + (noTxnKey.length ? noTxnKey.join(', ') : 'NONE'));
  console.log('Forms with NO visible in-flight state after tap:   ' + (noInFlight.length ? noInFlight.join(', ') : 'NONE'));

  await b.close();
  process.exit(doubleDispatch.length ? 1 : 0);
})();
