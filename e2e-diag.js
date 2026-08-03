// Fetch a ?diag= JSON/text endpoint from the deployed GAS web app using the stored
// Google session. Usage: node e2e-diag.js folderlist
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const STATE = path.join(__dirname, 'e2e-storageState.json');
const EXEC = 'https://script.google.com/macros/s/AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ/exec';

(async () => {
  const q = process.argv.slice(2).join('&');
  if (!q) { console.log('usage: node e2e-diag.js folderlist   |   foldermigrate&confirm=YES'); process.exit(1); }
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ storageState: fs.existsSync(STATE) ? STATE : undefined });
  const page = await ctx.newPage();
  const url = EXEC + '?diag=' + q;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(3000);
  // GAS text output renders inside a nested frame. Collect every frame's text,
  // then PREFER one that parses as JSON.
  //
  // WHY NOT just "largest": a short JSON payload loses to the SPA shell's own
  // body text, so a working ?diag= endpoint silently reported the dashboard
  // instead of its result (hit 2026-08-04 with ?diag=iqcinittiming). Length is
  // not evidence of being the response; parseability is.
  const texts = [];
  for (const f of page.frames()) {
    try { const t = await f.evaluate(() => document.body ? document.body.innerText : ''); if (t) texts.push(t.trim()); } catch (_) {}
  }
  const isJson = (t) => { try { JSON.parse(t); return true; } catch (_) { return false; } };
  const jsonHit = texts.find(isJson);
  const best = jsonHit || texts.sort((a, b) => b.length - a.length)[0] || '';
  if (!jsonHit && best) console.error('[warn] no JSON frame found — showing largest body text; endpoint may not have matched.');
  console.log(best || '(empty response)');
  await b.close();
})();
