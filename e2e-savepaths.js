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

// Seeded by ?diag=fixtureseed&confirm=YES (_Fixtures.js). Forms that need a
// known-state GRN drive this one instead of whatever live data happens to exist.
const FIX_GRN_PREFIX = 'TEST-FIX/GRN';

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

          // THE BUG THIS FIXES (measured with e2e-grnprobe.js, not reasoned):
          // real call sites chain the handlers FIRST —
          //   google.script.run.withSuccessHandler(f).withFailureHandler(g).saveGRN(d)
          // (GRN_F.html:1296-1334). The inherited withSuccessHandler returns the
          // REAL GAS proxy, so `.saveGRN` was invoked on that, never on `wrapped`.
          // The shim overrode a method the page never reached: doSave ran, the
          // operator modal was answered, the button showed "Saving…", and the
          // probe still counted 0 dispatches for 12.5s. That is the whole reason
          // GRN read INCONCLUSIVE across four earlier fix attempts.
          //
          // Fix: make the handler chain STAY on `wrapped` by re-declaring the
          // chainers to return `wrapped`, while REMEMBERING the callbacks. The
          // earlier objection — that stubbing handlers strands real read calls —
          // is answered by actually invoking the stored success handler for any
          // non-write function, so reads behave exactly as before.
          var pendingSuccess = null, pendingFailure = null;

          wrapped.withSuccessHandler = function (f) { pendingSuccess = f; return wrapped; };
          wrapped.withFailureHandler = function (f) { pendingFailure = f; return wrapped; };

          wrapped[writeFnName] = function (payload) {
            captured = payload;
            calls.push(writeFnName);
            // Dead-end deliberately: the write must NOT reach the server, and no
            // handler is fired, so the form stays mid-save. Non-destructive.
            return wrapped;
          };

          // Any OTHER server function is a genuine read the form needs. Forward it
          // to the real proxy with the handlers the caller supplied, so cascades
          // (getOpenPOsForSupplier, image upload) still resolve.
          Object.keys(real).forEach(function (k) {
            if (k === writeFnName || typeof real[k] !== 'function') return;
            if (k === 'withSuccessHandler' || k === 'withFailureHandler') return;
            wrapped[k] = function () {
              var runner = real;
              if (pendingSuccess) runner = runner.withSuccessHandler(pendingSuccess);
              if (pendingFailure) runner = runner.withFailureHandler(pendingFailure);
              return runner[k].apply(runner, arguments);
            };
          });

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

  // Select the seeded fixture GRN (?diag=fixtureseed). Without it this test can
  // only ever skip: IQC's items come from a linked GRN, and whether ANY live GRN
  // happens to be un-inspected varies run to run — which is exactly why coverage
  // drifted 3 -> 1 -> 2 across one session with no code change.
  const picked = await fr.evaluate((prefix) => {
    const sel = document.getElementById('grnNo');
    if (!sel) return { ok: false, why: 'no grnNo select' };
    const opt = [...sel.options].find(o => (o.value || '').indexOf(prefix) === 0);
    if (!opt) return { ok: false, why: 'fixture GRN not in dropdown — run ?diag=fixtureseed&confirm=YES' };
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, grn: opt.value };
  }, FIX_GRN_PREFIX);
  if (!picked.ok) return { skip: picked.why };
  await s.page.waitForTimeout(6000);

  // IQC's items come from the linked GRN; if none loaded there's nothing to score.
  const hasItems = await fr.evaluate(() => (typeof currentItems !== 'undefined' && currentItems && currentItems.length > 0));
  if (!hasItems) return { skip: 'fixture GRN selected but no items loaded — check ?diag=fixtures' };

  // Score every parameter so saveIQC's readiness check passes, and set the
  // overall disposition through the real UI path rather than poking the global.
  await fr.evaluate(() => {
    try { if (typeof setAllParams === 'function') setAllParams('PASS'); } catch (e) {}
    try { if (typeof setOverallDisp === 'function') setOverallDisp('ACCEPTED'); } catch (e) {}
  });
  await s.page.waitForTimeout(1200);

  const r = await fr.evaluate(() => {
    const shim = window.__installShim('saveIQC');
    const btn = document.getElementById('saveBtn');
    const btnExists = !!btn;
    const beforeDisabled = btn ? btn.disabled : null;

    // IQC gates the save behind the same operator-identity modal as GRN
    // (QMS.requireOperator). saveIQC() therefore does NOT reach the server on its
    // own — it waits for a human. Confirm ships DISABLED until a name is picked,
    // and a disabled click is a no-op the DOM silently swallows.
    const answerOperatorModal = () => {
      const name = document.querySelector('.op-name-btn');
      if (name) name.click();
      const confirm = document.getElementById('opConfirmBtn');
      if (confirm && !confirm.disabled) { confirm.click(); return true; }
      return false;
    };

    if (btn && !btn.disabled) { try { saveIQC(); } catch (e) {} }
    return new Promise(resolve => setTimeout(() => {
      answerOperatorModal();
      setTimeout(() => {
        const afterFirst = { disabled: btn ? btn.disabled : null,
          html: btn ? (btn.innerHTML||'').replace(/<[^>]*>/g,'').trim().slice(0,30) : '' };
        // Second tap — the double-dispatch check.
        if (btn && !btn.disabled) { try { saveIQC(); } catch (e) {} }
        setTimeout(async () => {
          answerOperatorModal();
          // Poll rather than guess: the save is async, and a fixed short wait is
          // what made GRN read "write never dispatched" while it was in flight.
          for (let i = 0; i < 20 && !shim.calls.length; i++) {
            await new Promise(r2 => setTimeout(r2, 500));
          }
          resolve({ btnExists, beforeDisabled, afterFirst, calls: shim.calls, captured: shim.captured });
        }, 600);
      }, 1500);
    }, 800));
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
    // Pick a NON-FG material type deliberately. refreshSaveBtn (Gatepass_F.html:411)
    // additionally requires an oqcRef when the type is 'Finished Goods', and
    // __pickFirst took whatever happened to be first — so the button stayed
    // disabled and the form was wrongly reported as un-fillable.
    const mt = document.getElementById('materialType');
    if (mt) {
      const nonFg = [...mt.options].map(o => o.value)
        .filter(v => v && v !== 'Finished Goods');
      if (nonFg.length) window.__set('materialType', nonFg[0]);
      else window.__pickFirst('materialType');
    }
    window.__set('description', 'TEST');
    window.__set('qty', 1);
    window.__pickFirst('unit');
    window.__set('vehicleNo', 'MH00TEST0000');
    window.__set('driverName', 'TEST DRIVER');
    window.__pickFirst('authorizedBy');
    // Validation is event-driven; nudge it after the programmatic fill.
    try { if (typeof refreshSaveBtn === 'function') refreshSaveBtn(); } catch (e) {}
  });
  await s.page.waitForTimeout(800);
  const dispOk = await fr.evaluate(() => {
    // disposition is a button click that sets a module var, not a form field
    const b = document.getElementById('btnApproved');
    if (b) { b.click(); return true; }
    return false;
  });
  await s.page.waitForTimeout(600);
  // authorizedBy/unit populate from the server AFTER mount, so the first fill can
  // land before the options exist. Re-apply the select-backed fields, then poll
  // for readiness rather than asserting once.
  let gpReady = false;
  for (let i = 0; i < 10 && !gpReady; i++) {
    gpReady = await fr.evaluate(() => {
      window.__pickFirst('unit');
      window.__pickFirst('authorizedBy');
      try { if (typeof refreshSaveBtn === 'function') refreshSaveBtn(); } catch (e) {}
      const b = document.getElementById('btnSave');
      return b ? !b.disabled : false;
    });
    if (!gpReady) await s.page.waitForTimeout(700);
  }
  if (!gpReady) {
    const why = await fr.evaluate(() => {
      const g = id => { const e = document.getElementById(id); return e ? e.value : '(MISSING)'; };
      return 'unmet fields: ' + JSON.stringify({ mt: g('materialType'), auth: g('authorizedBy'),
        unit: g('unit'), oqcRef: g('oqcRef'),
        disp: (typeof _disposition !== 'undefined' ? _disposition : '(undef)') });
    });
    return { skip: 'btnSave still disabled after fill + disposition — ' + why };
  }

  const r = await fr.evaluate(() => {
    const shim = window.__installShim('saveGatepass');
    const btn = document.getElementById('btnSave');
    const btnExists = !!btn;
    const beforeDisabled = btn ? btn.disabled : null;

    // Same operator-identity gate as GRN/IQC — doSave() waits for a human.
    const answerOperatorModal = () => {
      const name = document.querySelector('.op-name-btn');
      if (name) name.click();
      const confirm = document.getElementById('opConfirmBtn');
      if (confirm && !confirm.disabled) { confirm.click(); return true; }
      return false;
    };

    if (btn) { try { doSave(); } catch (e) {} }
    return new Promise(resolve => setTimeout(() => {
      answerOperatorModal();
      setTimeout(() => {
        const afterFirst = { disabled: btn ? btn.disabled : null,
          html: btn ? (btn.innerHTML||'').replace(/<[^>]*>/g,'').trim().slice(0,30) : '' };
        if (btn && !btn.disabled) { try { doSave(); } catch (e) {} }
        setTimeout(async () => {
          answerOperatorModal();
          for (let i = 0; i < 20 && !shim.calls.length; i++) {
            await new Promise(r2 => setTimeout(r2, 500));
          }
          resolve({ btnExists, beforeDisabled, afterFirst, calls: shim.calls, captured: shim.captured });
        }, 600);
      }, 1500);
    }, 800));
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

  // Fill the first line. collectLines (POP_F.html:378-390) reads THREE inputs per
  // card — qty-, price- and pdate- — and canonicalizePO_ rejects the line unless
  // BOTH qtyOrdered and unitPrice are > 0. The old fill set only qty-, so
  // previewPO returned {ok:false, errors:['Line 1: qty must be > 0.']}, doPreview
  // never opened the modal, and the probe reported this as "needs live master/GST
  // data". It was a missing field in the TEST, not missing data in the product —
  // verified by calling previewPO directly with qtyOrdered+unitPrice: ok=true.
  const lineOk = await fr.evaluate(() => {
    const card = document.getElementById('linesBody') && document.getElementById('linesBody').querySelector('.line-card');
    if (!card) return false;
    const sel = card.querySelector('select');
    if (sel) { const opt = Array.from(sel.options).find(o => o.value); if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
    const id = card.id.replace('line-', '');
    const setNum = (prefix, v) => {
      const e = document.getElementById(prefix + id);
      if (!e) return false;
      e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    setNum('qty-', 1);
    setNum('price-', 10);
    try { if (typeof recomputeTotals === 'function') recomputeTotals(); } catch (e) {}
    return !!(sel && sel.value);
  });
  if (!lineOk) return { skip: 'no material options in PO line — no live master data' };
  await s.page.waitForTimeout(800);

  // doPreview() calls server previewPO — that's a read, not a write, so it's fine to let
  // through; we only intercept the actual savePO/updateDraftPO write before confirmSubmit.
  // Run doPreview against the REAL google.script.run. The shim must NOT be armed
  // yet: it re-declares withSuccessHandler, so pre-arming it swallowed the
  // previewPO callback that opens the modal (POP_F.html:459) — the probe then
  // blamed "previewPO likely needs live master/GST data". Verified otherwise by
  // calling previewPO directly, which returns a full preview with a poNo.
  // The shim is installed AFTER the modal is open, before confirmSubmit.
  const previewOk = await fr.evaluate(() => new Promise(resolve => {
    try {
      doPreview();
      const t0 = Date.now();
      const poll = setInterval(() => {
        const m = document.getElementById('previewModal');
        const open = !!(m && !m.classList.contains('hidden'));
        if (open || Date.now() - t0 > 12000) { clearInterval(poll); resolve(open); }
      }, 400);
    } catch (e) { resolve(false); }
  }));
  if (!previewOk) return { skip: 'preview step did not open confirm modal' };

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
