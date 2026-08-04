// e2e-fast-lib.js — OFFLINE form harness for PM QMS.
//
// WHY THIS EXISTS
// The live harness (e2e-lib.js) drives the real deploy through the GitHub Pages
// -> GAS double iframe. Every form costs an 11-13s settle, so the full gate runs
// >10 minutes and cannot be run inline. Measured comparison: the QrAtt project's
// offline harness does 28 checks in 9.9s — ~60x faster per check — because it
// never touches the network.
//
// The technique, borrowed from PackMastersQrAtt/e2e-lib.js:
//   1. Read the form HTML from disk.
//   2. Resolve the GAS scriptlets ourselves. Verified across all 9 write forms:
//      EVERY <?!= ... ?> is a STATIC file include (Theme, TailwindBundle,
//      FormKit, HtmlCache, OperatorPicker) — none templates server data — so a
//      faithful page can be assembled without running doGet.
//   3. Inject a google.script.run mock so form init resolves instantly.
//   4. Load via data: URL. No deploy, no iframe, no auth.
//
// WHAT THIS DOES AND DOES NOT REPLACE
// It tests CLIENT logic: rendering, validation gating, save dispatch, payload
// shape, idempotency keys. It does NOT test the server, the sheets, or the real
// GAS bridge — e2e-savepaths against the live deploy remains the authority for
// those. Fast feedback here; live gate before shipping.
'use strict';

const fs   = require('fs');
const path = require('path');
const PW   = 'C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium } = require(PW);

const ROOT = __dirname;

// Forms with a write path, and the client fn that dispatches their save.
const WRITE_FORMS = {
  GRN:            { file: 'GRN_F.html',            write: 'saveGRN' },
  IQC:            { file: 'IQC_F.html',            write: 'saveIQC' },
  OQC:            { file: 'OQC_F.html',            write: 'saveOQC' },
  IPQC:           { file: 'IPQC_F.html',           write: 'saveRound' },
  Dispatch:       { file: 'Dispatch_F.html',       write: 'saveDispatchWithFIFO' },
  Gatepass:       { file: 'Gatepass_F.html',       write: 'saveGatepass' },
  CustomerReturn: { file: 'CustomerReturn_F.html', write: 'saveCustomerReturnMulti' },
  PO:             { file: 'POP_F.html',            write: 'savePO' },
  Rework:         { file: 'Rework_F.html',         write: 'submitReworkCompletion' },
};

function launch() {
  const headed = process.env.E2E_HEADED === '1' || process.argv.includes('--headed');
  return chromium.launch({ headless: !headed, slowMo: headed ? 120 : 0 });
}

// Resolve <?!= include('X') ?> and <?!= HtmlService.createHtmlOutputFromFile('X')… ?>
// recursively, exactly as GAS would. Depth-capped: a circular include in the
// real app would hang the server too, but here it must fail loudly, not spin.
function resolveScriptlets(html, depth) {
  depth = depth || 0;
  if (depth > 6) return html;
  return html.replace(/<\?!?=?\s*(?:include\(\s*['"]([\w-]+)['"]\s*\)|HtmlService\.createHtmlOutputFromFile\(\s*['"]([\w-]+)['"]\s*\)\.getContent\(\s*\);?)\s*;?\s*\?>/g,
    function (_m, a, b) {
      const name = a || b;
      const f = path.join(ROOT, name + '.html');
      if (!fs.existsSync(f)) return '<!-- missing include: ' + name + ' -->';
      return resolveScriptlets(fs.readFileSync(f, 'utf8'), depth + 1);
    });
}

// Mock google.script.run. Mirrors the REAL chaining contract — every call site
// in this app does .withSuccessHandler(f).withFailureHandler(g).fn(args), and a
// mock that ignores that chain is how the live probe spent four sessions
// reporting a working save as dead.
function gasMock(fixtures) {
  return `
(function(){
  // Chromium blocks sessionStorage on the about:blank origin used by
  // setContent(), but the real app is always served over https — HtmlCache.html
  // would throw here while working fine in production. Shimmed inline (not via
  // addInitScript, which does NOT run for setContent). Same fix
  // PackMastersQrAtt/e2e-lib.js documents for the same reason.
  var mk = function(){ var m = {};
    return { getItem: function(k){ return Object.prototype.hasOwnProperty.call(m,k) ? m[k] : null; },
             setItem: function(k,v){ m[k] = String(v); },
             removeItem: function(k){ delete m[k]; },
             clear: function(){ m = {}; },
             key: function(i){ return Object.keys(m)[i] || null; },
             get length(){ return Object.keys(m).length; } }; };
  try { Object.defineProperty(window,'sessionStorage',{configurable:true,value:mk()}); } catch(e){}
  try { Object.defineProperty(window,'localStorage',{configurable:true,value:mk()}); } catch(e){}
  window.__gasCalls = [];
  window.__gasPayloads = {};
  var DATA = ${JSON.stringify(fixtures)};
  function ctx(){
    var sh = null, fh = null;
    // The chainers must return the PROXY, not the bare api object — otherwise
    // .withSuccessHandler(f).getFoo() lands on a plain object with no getFoo and
    // throws "is not a function". This is the same class of bug that made the
    // live savepaths shim miss every dispatch for four sessions: in this app
    // EVERY call site chains the handlers before naming the server function.
    var proxy;
    var api = {
      withSuccessHandler: function(f){ sh = f; return proxy; },
      withFailureHandler: function(f){ fh = f; return proxy; },
      withUserObject:     function(){ return proxy; }
    };
    proxy = new Proxy(api, {
      get: function(t, k){
        if (k in t) return t[k];
        if (typeof k !== 'string') return undefined;
        return function(){
          var args = Array.prototype.slice.call(arguments);
          window.__gasCalls.push(k);
          window.__gasPayloads[k] = args.length === 1 ? args[0] : args;
          var v = Object.prototype.hasOwnProperty.call(DATA, k) ? DATA[k] : null;
          // Async like the real bridge, but ~0ms instead of a network round trip.
          setTimeout(function(){ if (sh) { try { sh(v); } catch(e){} } }, 0);
          return proxy;
        };
      }
    });
    return proxy;
  }
  window.google = window.google || {};
  window.google.script = { get run(){ return ctx(); },
    host: { close: function(){}, setHeight: function(){}, setWidth: function(){} },
    url:  { getLocation: function(cb){ cb({ parameter: {} }); } } };
})();`;
}

async function openForm(browser, formName, fixtures) {
  const meta = WRITE_FORMS[formName];
  if (!meta) throw new Error('unknown form: ' + formName);
  const file = path.join(ROOT, meta.file);
  if (!fs.existsSync(file)) throw new Error('missing form file: ' + meta.file);

  let html = resolveScriptlets(fs.readFileSync(file, 'utf8'));
  // Mock must run BEFORE any inline form script that touches google.script.run.
  html = html.replace(/<head([^>]*)>/i, '<head$1><script>' + gasMock(fixtures || {}) + '</script>');

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => {
    if (!/net::ERR|fonts\.googleapis|Failed to load resource/.test(e.message)) errors.push(e.message);
  });
  page.on('console', m => {
    if (m.type() === 'error' && !/net::ERR|fonts/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);   // let init callbacks flush (mock resolves at ~0ms)
  return { page, context, errors, write: meta.write };
}

// PASS/FAIL runner, same shape as e2e-lib's so output reads identically.
function makeRunner(label) {
  const results = [];
  return {
    async check(name, fn) {
      try {
        const ok = await fn();
        results.push({ name, pass: ok === true, detail: ok === true ? '' : String(ok) });
      } catch (e) {
        results.push({ name, pass: false, detail: 'THREW: ' + (e && e.message || e) });
      }
    },
    results,
    report() {
      const pass = results.filter(r => r.pass).length;
      console.log('\n===== ' + label + ' =====');
      results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : '')));
      console.log('----- ' + pass + '/' + results.length + ' passed -----');
      return { pass, total: results.length };
    }
  };
}

module.exports = { launch, openForm, makeRunner, resolveScriptlets, WRITE_FORMS };
