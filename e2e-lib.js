// Shared E2E helpers for PM QMS (Playwright, GAS double-iframe).
// Inspired by the TaskFlow DWM harness (e2e-lib.js) — adapted for QMS:
//  - QMS has no window.APP RPC wrapper; we inject a promise wrapper over google.script.run
//  - Auth is a Google session restored from e2e-storageState.json (lands as MANAGER)
//  - The SPA lives in the deepest GAS frame; we locate it by `typeof navigateTo === 'function'`
const PW = 'C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium } = require(PW);
const fs = require('fs');
const path = require('path');

const WRAP = 'https://packmastersmumbai.github.io/qms';
const STATE = path.join(__dirname, 'e2e-storageState.json');

// Headed when E2E_HEADED=1 (watch the run) or --headed flag passed; else headless.
function launch() {
  const headed = process.env.E2E_HEADED === '1' || process.argv.includes('--headed');
  return chromium.launch({ headless: !headed, slowMo: headed ? 350 : 0 });
}

// Locate the SPA frame (defines navigateTo). Polls because the double-iframe mounts late.
async function appFrame(page, timeoutMs) {
  const deadline = Date.now ? null : null; // Date.now unavailable in some sandboxes; use loop count
  for (let i = 0; i < (timeoutMs ? timeoutMs / 500 : 60); i++) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(() => typeof window.navigateTo === 'function')) return f; } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// The frame that owns google.script.run (may differ from the SPA frame).
async function rpcFrame(page) {
  for (let i = 0; i < 60; i++) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(() => !!(window.google && google.script && google.script.run))) return f; } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// Fresh context with restored Google auth. Returns { ctx, page, app, rpc, errors[] }.
async function openApp(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: fs.existsSync(STATE) ? STATE : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  await page.goto(WRAP, { waitUntil: 'networkidle', timeout: 60000 });
  const app = await appFrame(page);
  if (!app) throw new Error('SPA frame (navigateTo) not found — auth state may be expired');
  const rpc = await rpcFrame(page);
  if (!rpc) throw new Error('google.script.run frame not found');
  // Wait until landing actually rendered (MANAGER chip / Home tile)
  for (let i = 0; i < 30; i++) {
    const ready = await app.evaluate(() => /MANAGER|Home|Records|Production/.test(document.body.innerText)).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(500);
  }
  return { ctx, page, app, rpc, errors };
}

// Promise wrapper over google.script.run. Returns the server fn's value, or { __err } on failure.
function call(rpc, fn, args) {
  return rpc.evaluate(({ fn, args }) => new Promise((resolve) => {
    try {
      const runner = google.script.run
        .withSuccessHandler(v => resolve(v))
        .withFailureHandler(e => resolve({ __err: (e && e.message) ? e.message : String(e) }));
      runner[fn].apply(runner, args || []);
    } catch (e) { resolve({ __err: 'invoke threw: ' + (e && e.message || e) }); }
  }), { fn, args: args || [] });
}

// Navigate to a module/form via the SPA. mode:'new' opens the entry form.
async function nav(app, page, module, opts) {
  const r = await app.evaluate(({ m, o }) => {
    try { window.navigateTo(m, o || undefined); return true; } catch (e) { return 'ERR: ' + e.message; }
  }, { m: module, o: opts || null });
  await page.waitForTimeout(1500);
  return r;
}

// Navigate to the records list for a module.
async function navRecords(app, page, module, params) {
  await app.evaluate(({ m, p }) => { window.navigateToRecords(m, p || {}); }, { m: module, p: params || null });
  await page.waitForTimeout(2000);
}

// Wait until an element id appears in ANY frame; returns the hosting frame or null.
async function frameWith(page, id, timeoutMs) {
  for (let i = 0; i < (timeoutMs ? timeoutMs / 500 : 30); i++) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(x => !!document.getElementById(x), id)) return f; } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// Read a <select>'s options from whichever frame hosts it. Returns {total, real, sample} or null.
async function readSelect(page, id) {
  const f = await frameWith(page, id, 12000);
  if (!f) return null;
  // poll until populated (server callbacks fill selects after mount)
  for (let i = 0; i < 16; i++) {
    const r = await f.evaluate((x) => {
      const s = document.getElementById(x);
      if (!s) return null;
      const opts = [...s.options].map(o => o.textContent.trim());
      const real = opts.filter(t => t && !/^[—-]\s*(select|loading|pick|select a)/i.test(t) && !/^loading/i.test(t));
      return { total: opts.length, real: real.length, sample: real.slice(0, 3) };
    }, id);
    if (r && r.real > 0) return r;
    await page.waitForTimeout(800);
  }
  // return last-known (possibly empty — caller decides if that's legit)
  return f.evaluate((x) => {
    const s = document.getElementById(x); if (!s) return null;
    const opts = [...s.options].map(o => o.textContent.trim());
    return { total: opts.length, real: opts.filter(t => t && !/^[—-]/.test(t)).length, sample: [] };
  }, id);
}

// PASS/FAIL check runner (ported from DWM).
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

module.exports = { launch, openApp, appFrame, rpcFrame, call, nav, navRecords, frameWith, readSelect, makeRunner, WRAP, chromium };
